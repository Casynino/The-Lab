'use strict';

const asyncHandler = require('../utils/asyncHandler');
const { ok, created, paginated } = require('../utils/response');
const { parsePagination } = require('../utils/pagination');
const prisma = require('../config/prisma');
const transfers = require('../services/transfers.service');
const audit = require('../services/audit.service');
const notification = require('../services/notification.service');
const { dateTime, boxes: unitCount } = require('../services/whatsappText'); // "3 Boxes"

// A direct Warehouse → Rep transfer opens the rep's 72-hour order, and he was never told: only a
// stock-request approval told him (audit, 11 Nov 2026). Told here, not in createTransferTx, because the
// approval runs that too and already tells him — he would hear it twice. The transfer is saved by now,
// so a message that fails is let go rather than failing it.
async function tellRepOfIssue(transfer) {
  try {
    if (transfer.direction !== 'WAREHOUSE_TO_REP' || !transfer.toRep?.userId) return;
    const order = await prisma.settlement.findFirst({
      where: { transferId: transfer.id },
      select: { id: true, settlementNumber: true, deadlineAt: true },
    });
    const items = (transfer.items || []).map((i) => ({
      name: i.product?.name || 'Product',
      quantity: i.quantity,
      unit: i.packagingUnit?.name || null,
    }));
    const boxes = (transfer.items || []).reduce((n, i) => n + (i.baseQuantity || 0), 0);
    const orderPart = order ? ` Order ${order.settlementNumber}: settle or return them by ${dateTime(order.deadlineAt)}.` : '';
    await notification.notifyUser(transfer.toRep.userId, {
      type: 'GENERAL',
      severity: 'INFO',
      title: 'Stock issued to you',
      message: `${unitCount(boxes)} issued to you (${transfer.transferNumber}).${orderPart} Check your open orders.`,
      whatsapp: {
        kind: 'STOCK_ISSUED',
        transfer: transfer.transferNumber,
        order: order?.settlementNumber || null,
        deadline: order?.deadlineAt || null,
        items,
      },
      entityType: order ? 'Settlement' : 'StockTransfer',
      entityId: order ? order.id : transfer.id,
    });
  } catch {
    /* the transfer stands; a missed message is not worth failing it */
  }
}

const create = asyncHandler(async (req, res) => {
  const transfer = await transfers.createTransfer(req.body, req.user);
  await audit.record(req, {
    action: 'CREATE',
    entityType: 'StockTransfer',
    entityId: transfer.id,
    newValues: { transferNumber: transfer.transferNumber, direction: transfer.direction, items: transfer.items.length },
  });
  await tellRepOfIssue(transfer);
  return created(res, transfer);
});

const list = asyncHandler(async (req, res) => {
  const q = req.validatedQuery || req.query;
  const pagination = parsePagination(q, { defaultSortBy: 'dispatchedAt', defaultSortDir: 'desc', allowedSortFields: ['dispatchedAt', 'createdAt'] });
  const { items, total, summary } = await transfers.listTransfers(q, pagination);
  return paginated(res, items, { page: pagination.page, limit: pagination.limit, total, summary });
});

const get = asyncHandler(async (req, res) => {
  const transfer = await transfers.getTransfer(req.params.id);
  return ok(res, transfer);
});

const cancel = asyncHandler(async (req, res) => {
  const transfer = await transfers.cancelTransfer(req.params.id, req.user, req.body.reason);
  await audit.record(req, { action: 'CANCEL', entityType: 'StockTransfer', entityId: req.params.id, newValues: { reason: req.body.reason } });
  return ok(res, transfer);
});

module.exports = { create, list, get, cancel };
