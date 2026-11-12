'use strict';

const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
// reorder / credit / dashboard are lazy-required inside generateSystemAlerts()
// to avoid circular deps (settlement → notification → dashboard → settlement).

// Visibility rule: admins see the admin notices (userId null) and every targeted one except those
// addressed to warehouse staff — those are the staff's own copies of business alerts (below) and their
// own notices, so the owner's bell does not show each alert once more per staff member, and the owner's
// "mark all read" never clears a staff member's bell. All other roles see only notifications explicitly
// addressed to them.
const STAFF_ROLE = 'WAREHOUSE_STAFF';
function visibilityWhere(user) {
  if (!user) return {};
  if (user.role === 'ADMIN') return { OR: [{ userId: null }, { user: { role: { name: { not: STAFF_ROLE } } } }] };
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
  // Only a notification the user can see (the visibility rule above, the very same where): anyone else
  // could clear another person's alert, or an admin broadcast, by its id. Not found, so ids are not confirmed.
  const n = await prisma.notification.findFirst({ where: { id, ...visibilityWhere(user) }, select: { id: true } });
  if (!n) throw ApiError.notFound('Notification not found');
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
// `dedupeSalt` is the same: it only tells the WhatsApp duplicate guard that this is a new event. Left on the
// row it made Prisma refuse the notice, and the WhatsApp after it was never sent (audit, 11 Nov 2026).
async function create(data) {
  const { whatsapp, dedupeSalt, ...row } = data; // eslint-disable-line no-unused-vars
  return prisma.notification.create({ data: row });
}

// Create a notification only if an equivalent unread one does not already
// exist (avoid spamming the same alert every run). The check is per recipient (userId null = the owner's
// copy): an unread staff copy of a stock alert must not stop the owner's, nor the other way round.
async function createIfAbsent(data) {
  const existing = await prisma.notification.findFirst({
    where: { type: data.type, entityId: data.entityId ?? null, isRead: false, userId: data.userId ?? null },
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

// Low and out-of-stock alerts: the owner's copy, plus one for each active warehouse-staff member, who
// looks after the stock (audit staff-settings-2, 12 Nov 2026: his bell never got them). Each copy has its
// own read state; a staff user is not a rep, so no WhatsApp follows his copy. `staffIds` lets a scan load
// the staff once; a missed staff copy never undoes the owner's.
async function activeStaffIds() {
  const staff = await prisma.user.findMany({ where: { isActive: true, role: { name: STAFF_ROLE } }, select: { id: true } });
  return staff.map((u) => u.id);
}

async function stockAlert(data, staffIds) {
  const created = await createIfAbsent({ ...data, userId: null });
  try {
    for (const id of staffIds || (await activeStaffIds())) await createIfAbsent({ ...data, userId: id });
  } catch {
    // The owner's alert is already written.
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

  const staffIds = lowStock.length ? await activeStaffIds().catch(() => []) : [];
  for (const p of lowStock) {
    await stockAlert({
      type: 'LOW_STOCK',
      severity: 'WARNING',
      title: `Low stock: ${p.name}`,
      message: `${p.name} is at ${p.onHand} ${p.baseUnitName}(s), at or below the minimum of ${p.minStockLevel}.`,
      entityType: 'Product',
      entityId: p.id,
    }, staffIds);
    created += 1;
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
// `forStaff: true` also puts a copy in every active warehouse-staff bell (audit staff-settings-2, 12 Nov
// 2026: staff approve stock requests, returns and settlements, yet their bell was always empty). Each
// staff member gets his own row, so reading it never touches the owner's copy or another's. Only the
// callers of approvals staff can do today set it; money alerts (withdrawals, fines, bonuses) never do.
async function notifyAdmins(data) {
  const { forStaff, ...row } = data;
  const created = await create({ ...row, userId: null });
  if (forStaff) {
    try {
      const { whatsapp, dedupeSalt, ...plain } = row; // eslint-disable-line no-unused-vars
      const staff = await prisma.user.findMany({ where: { isActive: true, role: { name: STAFF_ROLE } }, select: { id: true } });
      if (staff.length) await prisma.notification.createMany({ data: staff.map((u) => ({ ...plain, userId: u.id })) });
    } catch {
      // The owner's notice is already written; a missed staff copy never undoes it.
    }
  }
  return created;
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
  // The in-app notice it copies goes with it: each notice is one event, so it is one WhatsApp (audit #45).
  wa.background(wa.mirrorToRep(userId, { ...data, notificationId: created?.id }));
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
      await stockAlert({
        type: 'LOW_STOCK',
        severity: 'CRITICAL',
        title: `Out of stock: ${product.name}`,
        message: `${product.name} is OUT OF STOCK across all warehouses. Immediate restock required.`,
        entityType: 'Product',
        entityId: productId,
      });
    } else if (onHand <= product.minStockLevel) {
      await stockAlert({
        type: 'LOW_STOCK',
        severity: 'WARNING',
        title: `Low stock: ${product.name}`,
        message: `${product.name} has ${onHand} ${product.baseUnitName}(s) remaining — below minimum of ${product.minStockLevel}. Restock needed.`,
        entityType: 'Product',
        entityId: productId,
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
  stockAlert,
  notifyAdmins,
  notifyUser,
  broadcast,
  checkProductLowStock,
  generateSystemAlerts,
};
