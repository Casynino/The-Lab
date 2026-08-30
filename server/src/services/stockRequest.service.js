'use strict';

const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const inventory = require('./inventory.service');
const transfers = require('./transfers.service');
const notification = require('./notification.service');
const { nextDocNumber } = require('../utils/numbering');
const { toNumber, round2, formatCurrency } = require('../utils/money');

const INCLUDE = {
  salesRep: { include: { user: { select: { name: true } } } },
  warehouse: { select: { id: true, name: true } },
  decidedBy: { select: { id: true, name: true } },
  // product.packagings carries each packaging's baseQuantity, which is what
  // turns a carton count into a box count.
  items: { include: { product: { include: { packagings: true } }, packagingUnit: true } },
};

async function resolveWarehouseId(requested) {
  if (requested) return requested;
  const wh = await prisma.warehouse.findFirst({
    where: { isActive: true },
    orderBy: { isPrimary: 'desc' },
  });
  if (!wh) throw ApiError.badRequest('No active warehouse available to fulfil from');
  return wh.id;
}

// Boxes available to issue from the fulfilling warehouse, keyed by product.
async function availabilityMap(client, warehouseId) {
  const whId = await resolveWarehouseId(warehouseId);
  const rows = await inventory.warehouseBalances(client, whId);
  return new Map(rows.map((r) => [r.productId, r.baseQuantity]));
}

// Throw if any product's requested base units exceed warehouse stock. The
// quantities/levels themselves are never surfaced to the rep (Rule 5).
async function assertWithinStock(client, warehouseId, requestedByProduct, message) {
  const avail = await availabilityMap(client, warehouseId);
  for (const [productId, reqBase] of requestedByProduct) {
    if (reqBase > (avail.get(productId) || 0)) throw ApiError.badRequest(message);
  }
}

// Product ids currently in stock at the fulfilling warehouse (no counts exposed).
async function availableProductIds() {
  const avail = await availabilityMap(prisma);
  return [...avail.entries()].filter(([, qty]) => qty > 0).map(([pid]) => pid);
}

const STOCK_EXCEEDED_MSG = 'Requested quantity exceeds available stock..contact the lab';

async function create(salesRepId, payload) {
  if (!payload.items || payload.items.length === 0) {
    throw ApiError.badRequest('A stock request needs at least one item');
  }

  const result = await prisma.$transaction(async (tx) => {
    const productIds = [...new Set(payload.items.map((i) => i.productId))];
    const products = await tx.product.findMany({ where: { id: { in: productIds } } });
    const pMap = new Map(products.map((p) => [p.id, p]));
    if (pMap.size !== productIds.length) throw ApiError.badRequest('One or more products were not found');

    // Price every line at the selling price for its chosen unit (Box/Carton).
    const lines = [];
    let totalValue = 0;
    const requestedByProduct = new Map();
    for (const i of payload.items) {
      const { packaging, baseQuantity } = await inventory.convertToBase(tx, i.productId, i.packagingUnitId, i.quantity);
      requestedByProduct.set(i.productId, (requestedByProduct.get(i.productId) || 0) + baseQuantity);
      const product = pMap.get(i.productId);
      const unitPrice =
        packaging.unitPrice != null
          ? toNumber(packaging.unitPrice)
          : round2(toNumber(product.sellingPrice) * packaging.baseQuantity);
      const lineTotal = round2(unitPrice * i.quantity);
      totalValue += lineTotal;
      lines.push({
        productId: i.productId,
        packagingUnitId: i.packagingUnitId,
        quantityRequested: i.quantity,
        unitPrice,
        lineTotal,
      });
    }

    // Can't request products/quantities beyond what The Lab currently holds.
    await assertWithinStock(tx, payload.warehouseId, requestedByProduct, STOCK_EXCEEDED_MSG);

    const requestNumber = await nextDocNumber(tx.stockRequest, 'requestNumber', 'REQ');
    return tx.stockRequest.create({
      data: {
        requestNumber,
        salesRepId,
        warehouseId: payload.warehouseId || null,
        notes: payload.notes || null,
        status: 'PENDING',
        totalValue: round2(totalValue),
        items: { create: lines },
      },
      include: INCLUDE,
    });
  });

  notification.notifyAdmins({
    type: 'GENERAL',
    severity: 'INFO',
    title: `New stock request: ${result.requestNumber}`,
    message: `${result.salesRep?.user?.name || 'A rep'} requested stock worth ${formatCurrency(result.totalValue)}. Review and approve.`,
    entityType: 'StockRequest',
    entityId: result.id,
  }).catch(() => {});
  const wa = require('./whatsappNotify.service');
  wa.background(wa.stockRequestSubmitted(result));

  return result;
}

// settlementId is a plain reference (no Prisma relation), so attach the linked
// settlement's status separately. Lets the UI show Approved vs Settled.
async function attachSettlements(items) {
  const ids = [...new Set(items.map((i) => i.settlementId).filter(Boolean))];
  if (ids.length === 0) return items.map((i) => ({ ...i, settlement: null }));
  const settlements = await prisma.settlement.findMany({
    where: { id: { in: ids } },
    select: { id: true, status: true, settlementNumber: true, settledAt: true },
  });
  const map = new Map(settlements.map((s) => [s.id, s]));
  return items.map((i) => ({ ...i, settlement: i.settlementId ? map.get(i.settlementId) || null : null }));
}

// Boxes, not "2 line(s)". A line count says how many products were on the
// request; it never says how many boxes left the warehouse — which is the
// thing anyone reading this page actually wants to know. Requested and
// approved are both carried, because they differ whenever an order is only
// part-filled, and the difference is the story.
function withBoxes(rows) {
  return rows.map((r) => {
    let requested = 0;
    let approved = 0;
    for (const it of r.items || []) {
      // How many boxes one unit of the chosen packaging holds. That lives on
      // ProductPackaging (this product in this packaging), NOT on the
      // packaging unit itself — reading it from the unit always yielded
      // undefined, so a request for 2 cartons counted as 2 boxes.
      const factor = (it.product?.packagings || [])
        .find((k) => k.packagingUnitId === it.packagingUnitId)?.baseQuantity ?? 1;
      requested += (it.quantityRequested || 0) * factor;
      // baseQuantity is written on approval; before that there is nothing to
      // count, and quantityApproved falls back to what was asked for.
      approved += it.baseQuantity || (it.quantityApproved != null ? it.quantityApproved * factor : 0);
    }
    return { ...r, boxesRequested: requested, boxesApproved: approved };
  });
}

async function list(filters, pagination) {
  const where = {};
  if (filters.salesRepId) where.salesRepId = filters.salesRepId;
  if (filters.status) where.status = filters.status;
  const [items, total] = await Promise.all([
    prisma.stockRequest.findMany({ where, include: INCLUDE, skip: pagination.skip, take: pagination.take, orderBy: pagination.orderBy }),
    prisma.stockRequest.count({ where }),
  ]);
  // Totals over EVERY matching request, not the page on screen. Page-scoped
  // figures changed when you turned the page and their counts did not add up
  // to the orders shown — a rejected order is neither open nor settled — so
  // they read as broken arithmetic. These cover the whole filtered history
  // and every request falls into exactly one bucket.
  const allMatching = await prisma.stockRequest.findMany({
    where,
    select: {
      id: true,
      status: true,
      requestedAt: true,
      totalValue: true,
      // The request points AT its settlement; the settlement does not carry a
      // stockRequestId. Querying the reverse direction found nothing and
      // reported every issued order as unsettled.
      settlementId: true,
      // Only fulfilled requests contribute boxes, and their items carry
      // baseQuantity — written at approval, which is the moment stock moved.
      items: { select: { baseQuantity: true } },
    },
    orderBy: { requestedAt: 'asc' },
  });
  const issuedStatuses = new Set(['FULFILLED']);
  const linkedIds = allMatching.map((r) => r.settlementId).filter(Boolean);
  const settledSettlementIds = new Set(
    linkedIds.length
      ? (await prisma.settlement.findMany({
          where: { id: { in: linkedIds }, status: 'SETTLED' },
          select: { id: true },
        })).map((x) => x.id)
      : [],
  );
  let boxes = 0;
  let value = 0;
  let issued = 0;
  let settled = 0;
  let pending = 0;
  let refused = 0;
  for (const r of allMatching) {
    if (issuedStatuses.has(r.status)) {
      issued += 1;
      for (const it of r.items) boxes += it.baseQuantity || 0;
      value += toNumber(r.totalValue);
      if (r.settlementId && settledSettlementIds.has(r.settlementId)) settled += 1;
    } else if (r.status === 'PENDING') pending += 1;
    else refused += 1; // rejected or cancelled — never left the warehouse
  }
  const summary = {
    boxes,
    value: round2(value),
    issued,
    settled,
    stillOpen: issued - settled,
    pending,
    refused,
    totalRequests: allMatching.length,
    firstAt: allMatching[0]?.requestedAt || null,
    lastAt: allMatching[allMatching.length - 1]?.requestedAt || null,
  };

  return { items: withBoxes(await attachSettlements(items)), total, summary };
}

async function get(id) {
  const r = await prisma.stockRequest.findUnique({ where: { id }, include: INCLUDE });
  if (!r) throw ApiError.notFound('Stock request not found');
  const [enriched] = withBoxes(await attachSettlements([r]));
  return enriched;
}

// Edit a still-pending request: replace its line items wholesale and reprice.
// Only allowed while PENDING (nothing has been issued yet). Ownership is
// enforced by the controller.
async function update(id, payload) {
  if (!payload.items || payload.items.length === 0) {
    throw ApiError.badRequest('A stock request needs at least one item');
  }
  const existing = await prisma.stockRequest.findUnique({ where: { id } });
  if (!existing) throw ApiError.notFound('Stock request not found');
  if (existing.status !== 'PENDING') {
    throw ApiError.badRequest(`Only pending orders can be edited (this one is ${existing.status})`);
  }

  const result = await prisma.$transaction(async (tx) => {
    const productIds = [...new Set(payload.items.map((i) => i.productId))];
    const products = await tx.product.findMany({ where: { id: { in: productIds } } });
    const pMap = new Map(products.map((p) => [p.id, p]));
    if (pMap.size !== productIds.length) throw ApiError.badRequest('One or more products were not found');

    const lines = [];
    let totalValue = 0;
    const requestedByProduct = new Map();
    for (const i of payload.items) {
      const { packaging, baseQuantity } = await inventory.convertToBase(tx, i.productId, i.packagingUnitId, i.quantity);
      requestedByProduct.set(i.productId, (requestedByProduct.get(i.productId) || 0) + baseQuantity);
      const product = pMap.get(i.productId);
      const unitPrice =
        packaging.unitPrice != null
          ? toNumber(packaging.unitPrice)
          : round2(toNumber(product.sellingPrice) * packaging.baseQuantity);
      const lineTotal = round2(unitPrice * i.quantity);
      totalValue += lineTotal;
      lines.push({
        productId: i.productId,
        packagingUnitId: i.packagingUnitId,
        quantityRequested: i.quantity,
        unitPrice,
        lineTotal,
      });
    }

    // Same stock guard as creation applies to edits.
    await assertWithinStock(tx, payload.warehouseId !== undefined ? payload.warehouseId : existing.warehouseId, requestedByProduct, STOCK_EXCEEDED_MSG);

    // The request is still pending — nothing issued — so swap the items wholesale.
    await tx.stockRequestItem.deleteMany({ where: { stockRequestId: id } });
    return tx.stockRequest.update({
      where: { id },
      data: {
        warehouseId: payload.warehouseId !== undefined ? payload.warehouseId : existing.warehouseId,
        notes: payload.notes !== undefined ? payload.notes : existing.notes,
        totalValue: round2(totalValue),
        items: { create: lines },
      },
      include: INCLUDE,
    });
  });

  notification.notifyAdmins({
    type: 'GENERAL',
    severity: 'INFO',
    title: `Stock request updated: ${result.requestNumber}`,
    message: `${result.salesRep?.user?.name || 'A rep'} edited their pending order — now worth ${formatCurrency(result.totalValue)}. Review and approve.`,
    entityType: 'StockRequest',
    entityId: result.id,
  }).catch(() => {});

  return result;
}

// Approve a request: optionally adjust quantities, then dispatch a
// warehouse→rep transfer (which posts the ledger and opens a settlement).
async function approve(id, actor, approvals = []) {
  const request = await prisma.stockRequest.findUnique({ where: { id }, include: { items: true } });
  if (!request) throw ApiError.notFound('Stock request not found');
  if (request.status !== 'PENDING') throw ApiError.badRequest(`Request is already ${request.status}`);

  const approvalMap = new Map(approvals.map((a) => [a.itemId, a.quantityApproved]));
  const fromWarehouseId = await resolveWarehouseId(request.warehouseId);

  // Decide approved quantity per line (default: full requested amount).
  const decided = request.items.map((it) => {
    const qty = approvalMap.has(it.id) ? Number(approvalMap.get(it.id)) : it.quantityRequested;
    return { ...it, quantityApproved: Math.max(0, qty) };
  });
  const toIssue = decided.filter((d) => d.quantityApproved > 0);
  if (toIssue.length === 0) throw ApiError.badRequest('Nothing approved to issue');

  // Compute the approved order value from actually issued lines only.
  const approvedTotal = round2(
    toIssue.reduce((acc, d) => acc + round2(toNumber(d.unitPrice) * d.quantityApproved), 0),
  );

  // Re-validate against current warehouse stock (it may have dropped since the
  // request was raised). Clear message so the Doctor can adjust or reject.
  const approvedByProduct = new Map();
  for (const d of toIssue) {
    const { baseQuantity } = await inventory.convertToBase(prisma, d.productId, d.packagingUnitId, d.quantityApproved);
    approvedByProduct.set(d.productId, (approvedByProduct.get(d.productId) || 0) + baseQuantity);
  }
  await assertWithinStock(prisma, fromWarehouseId, approvedByProduct, 'Insufficient stock available for approval.');

  // Dispatch the transfer (posts ledger + creates the 72h settlement).
  const transfer = await transfers.createTransfer(
    {
      direction: 'WAREHOUSE_TO_REP',
      fromWarehouseId,
      toRepId: request.salesRepId,
      items: toIssue.map((d) => ({ productId: d.productId, packagingUnitId: d.packagingUnitId, quantity: d.quantityApproved })),
      notes: `Stock request ${request.requestNumber}`,
    },
    actor,
  );

  const settlement = await prisma.settlement.findFirst({ where: { transferId: transfer.id } });

  // Persist approved quantities and resolved base amounts on the request items.
  for (const d of decided) {
    let baseQuantity = 0;
    if (d.quantityApproved > 0) {
      const conv = await inventory.convertToBase(prisma, d.productId, d.packagingUnitId, d.quantityApproved);
      baseQuantity = conv.baseQuantity;
    }
    await prisma.stockRequestItem.update({
      where: { id: d.id },
      data: {
        quantityApproved: d.quantityApproved,
        baseQuantity,
        lineTotal: round2(d.quantityApproved * toNumber(d.unitPrice)),
      },
    });
  }

  const finalResult = await prisma.stockRequest.update({
    where: { id },
    data: {
      status: 'FULFILLED',
      decidedAt: new Date(),
      decidedById: actor ? actor.id : null,
      warehouseId: fromWarehouseId,
      transferId: transfer.id,
      settlementId: settlement ? settlement.id : null,
      totalValue: approvedTotal,
    },
    include: INCLUDE,
  });

  // Notify the rep their request was approved
  const rep = await prisma.salesRepresentative.findUnique({
    where: { id: request.salesRepId },
    select: { userId: true },
  });
  notification.notifyUser(rep?.userId, {
    type: 'GENERAL',
    severity: 'INFO',
    title: 'Stock request approved',
    message: `Your request (${request.requestNumber}) has been approved and issued. Check your open orders.`,
    entityType: 'StockRequest',
    entityId: id,
  }).catch(() => {});

  // Trigger low-stock check for every product that left the warehouse
  const productIds = [...new Set(toIssue.map((d) => d.productId))];
  Promise.all(productIds.map((pid) => notification.checkProductLowStock(pid))).catch(() => {});

  return finalResult;
}

async function reject(id, actor, notes) {
  const request = await prisma.stockRequest.findUnique({ where: { id } });
  if (!request) throw ApiError.notFound('Stock request not found');
  if (request.status !== 'PENDING') throw ApiError.badRequest(`Request is already ${request.status}`);
  const result = await prisma.stockRequest.update({
    where: { id },
    data: { status: 'REJECTED', decidedAt: new Date(), decidedById: actor ? actor.id : null, notes: notes || request.notes },
    include: INCLUDE,
  });

  const rep = await prisma.salesRepresentative.findUnique({
    where: { id: request.salesRepId },
    select: { userId: true },
  });
  notification.notifyUser(rep?.userId, {
    type: 'GENERAL',
    severity: 'WARNING',
    title: 'Stock request not approved',
    message: `Your request (${request.requestNumber}) was not approved.${notes ? ' Reason: ' + notes : ''}`,
    entityType: 'StockRequest',
    entityId: id,
  }).catch(() => {});

  return result;
}

async function cancel(id, actor) {
  const request = await prisma.stockRequest.findUnique({ where: { id } });
  if (!request) throw ApiError.notFound('Stock request not found');
  if (request.status !== 'PENDING') throw ApiError.badRequest('Only pending requests can be cancelled');
  const result = await prisma.stockRequest.update({ where: { id }, data: { status: 'CANCELLED' }, include: INCLUDE });

  notification.notifyAdmins({
    type: 'GENERAL',
    severity: 'INFO',
    title: `Stock request cancelled: ${result.requestNumber}`,
    message: `${result.salesRep?.user?.name || 'A rep'} cancelled stock request ${result.requestNumber}.`,
    entityType: 'StockRequest',
    entityId: result.id,
  }).catch(() => {});

  return result;
}

module.exports = { create, list, get, update, approve, reject, cancel, availableProductIds };
