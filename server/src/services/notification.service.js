'use strict';

const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
// reorder / credit / dashboard are lazy-required inside generateSystemAlerts()
// to avoid circular deps (settlement → notification → dashboard → settlement).

// Visibility rule: admins see every notification (broadcasts + targeted).
// All other roles see only notifications explicitly addressed to them.
function visibilityWhere(user) {
  if (!user) return {};
  if (user.role === 'ADMIN') return {};
  return { userId: user.id };
}

async function list(user, filters, pagination) {
  const where = { ...visibilityWhere(user) };
  if (filters.type) where.type = filters.type;
  if (filters.isRead !== undefined) where.isRead = filters.isRead;
  if (filters.severity) where.severity = filters.severity;

  const [items, total, unread] = await Promise.all([
    prisma.notification.findMany({
      where,
      skip: pagination.skip,
      take: pagination.take,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { ...visibilityWhere(user), isRead: false } }),
  ]);
  return { items, total, unread };
}

async function unreadCount(user) {
  return prisma.notification.count({ where: { ...visibilityWhere(user), isRead: false } });
}

async function markRead(id, user) {
  const n = await prisma.notification.findUnique({ where: { id } });
  // Only a notification the user can see (the visibility rule above): anyone else could clear
  // another person's alert, or an admin broadcast, by its id. Not found, so ids are not confirmed.
  const visible = n && (!user || user.role === 'ADMIN' || n.userId === user.id);
  if (!visible) throw ApiError.notFound('Notification not found');
  return prisma.notification.update({ where: { id }, data: { isRead: true, readAt: new Date() } });
}

async function markAllRead(user) {
  const result = await prisma.notification.updateMany({
    where: { ...visibilityWhere(user), isRead: false },
    data: { isRead: true, readAt: new Date() },
  });
  return { updated: result.count };
}

// `whatsapp` rides along on the same object as the in-app notification: it is the
// structured version of the event that the WhatsApp text is built from (see
// whatsappText.js). It is not a column, so it never goes into the database.
async function create(data) {
  const { whatsapp, ...row } = data; // eslint-disable-line no-unused-vars
  return prisma.notification.create({ data: row });
}

// Create a notification only if an equivalent unread one does not already
// exist (avoid spamming the same alert every run).
async function createIfAbsent(data) {
  const existing = await prisma.notification.findFirst({
    where: { type: data.type, entityId: data.entityId ?? null, isRead: false },
  });
  if (existing) return existing;
  const created = await create(data);
  // Mirror rep-targeted alerts (e.g. commission-ready) to WhatsApp too.
  if (data.userId) {
    const wa = require('./whatsappNotify.service');
    wa.background(wa.mirrorToRep(data.userId, data));
  }
  return created;
}

// Scan current business state and raise system alerts. Safe to run on a
// schedule or on demand.
async function generateSystemAlerts() {
  const reorder = require('./reorder.service');
  const credit = require('./credit.service');
  const dashboard = require('./dashboard.service');

  const [reorderData, lowStock, debt, repStock] = await Promise.all([
    reorder.reorderAnalysis(),
    reorder.lowStock(),
    credit.debtSummary(),
    dashboard.outstandingRepStock(),
  ]);

  let created = 0;
  const push = async (data) => {
    await createIfAbsent(data);
    created += 1;
  };

  for (const r of reorderData.recommendations) {
    await push({
      type: 'REORDER',
      severity: r.urgency === 'CRITICAL' ? 'CRITICAL' : 'WARNING',
      title: `Reorder: ${r.name}`,
      message: r.message,
      entityType: 'Product',
      entityId: r.productId,
      data: { recommendedQty: r.recommendedQty, daysRemaining: r.daysRemaining },
    });
  }

  for (const p of lowStock) {
    await push({
      type: 'LOW_STOCK',
      severity: 'WARNING',
      title: `Low stock: ${p.name}`,
      message: `${p.name} is at ${p.onHand} ${p.baseUnitName}(s), at or below the minimum of ${p.minStockLevel}.`,
      entityType: 'Product',
      entityId: p.id,
    });
  }

  if (debt.overdueAccounts > 0) {
    await push({
      type: 'OVERDUE_DEBT',
      severity: 'CRITICAL',
      title: `${debt.overdueAccounts} overdue debt account(s)`,
      message: `Overdue receivables total ${debt.overdueAmount}. Follow up required.`,
      entityType: 'Debt',
      entityId: 'overdue-summary',
    });
  }

  for (const rep of repStock) {
    await push({
      type: 'OUTSTANDING_REP_STOCK',
      severity: 'INFO',
      title: `${rep.name} holds ${rep.heldBaseUnits} unit(s)`,
      message: `${rep.name} (${rep.code}) is still holding ${rep.heldBaseUnits} base units of stock.`,
      entityType: 'SalesRepresentative',
      entityId: rep.salesRepId,
    });
  }

  return { created };
}

// Broadcast to all admins (userId = null means every admin sees it).
async function notifyAdmins(data) {
  return create({ ...data, userId: null });
}

// Announcement to a whole audience ('reps' | 'staff' | 'all'): one targeted
// notification per active user, so everyone sees it in their own bell.
async function broadcast({ title, message, severity = 'INFO', audience = 'reps' }) {
  const roleFilter =
    audience === 'reps' ? { role: { name: 'SALES_REP' } }
    : audience === 'staff' ? { role: { name: { in: ['ADMIN', 'WAREHOUSE_STAFF'] } } }
    : {};
  const users = await prisma.user.findMany({ where: { isActive: true, ...roleFilter }, select: { id: true } });
  for (const u of users) {
    await create({ type: 'GENERAL', severity, title, message, userId: u.id, entityType: 'Announcement', entityId: null });
  }
  return { notified: users.length };
}

// Notify a specific user by their User.id. If that user is a sales rep with
// WhatsApp configured, the alert is ALSO pushed to their phone — one hook that
// covers every rep notification (approvals, rejections, penalties, deadline
// reminders, commission earned/ready). The WhatsApp send is backgrounded so it
// survives the serverless response freeze and never blocks the caller.
async function notifyUser(userId, data) {
  if (!userId) return;
  const created = await create({ ...data, userId });
  const wa = require('./whatsappNotify.service');
  wa.background(wa.mirrorToRep(userId, data));
  return created;
}

// After stock leaves a warehouse, check if any product is now at or below its
// minimum level and raise a LOW_STOCK / out-of-stock alert if needed.
// Safe to call fire-and-forget — never throws.
async function checkProductLowStock(productId) {
  try {
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, name: true, minStockLevel: true, baseUnitName: true },
    });
    if (!product || product.minStockLevel <= 0) return;

    // Mirror the alert to the owner's WhatsApp (dedupes per product per day).
    const wa = require('./whatsappNotify.service');
    wa.background(wa.stockAlertForProduct(productId));

    const agg = await prisma.warehouseStock.aggregate({
      where: { productId },
      _sum: { baseQuantity: true },
    });
    const onHand = agg._sum.baseQuantity || 0;

    if (onHand <= 0) {
      await createIfAbsent({
        type: 'LOW_STOCK',
        severity: 'CRITICAL',
        title: `Out of stock: ${product.name}`,
        message: `${product.name} is OUT OF STOCK across all warehouses. Immediate restock required.`,
        entityType: 'Product',
        entityId: productId,
        userId: null,
      });
    } else if (onHand <= product.minStockLevel) {
      await createIfAbsent({
        type: 'LOW_STOCK',
        severity: 'WARNING',
        title: `Low stock: ${product.name}`,
        message: `${product.name} has ${onHand} ${product.baseUnitName}(s) remaining — below minimum of ${product.minStockLevel}. Restock needed.`,
        entityType: 'Product',
        entityId: productId,
        userId: null,
      });
    }
  } catch {
    // Never let a stock alert break the main flow.
  }
}

module.exports = {
  list,
  unreadCount,
  markRead,
  markAllRead,
  create,
  createIfAbsent,
  notifyAdmins,
  notifyUser,
  broadcast,
  checkProductLowStock,
  generateSystemAlerts,
};
