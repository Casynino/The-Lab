'use strict';

const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const inventory = require('./inventory.service');
const transfers = require('./transfers.service');
const notification = require('./notification.service');
const { nextDocNumber, withDocNumberRetry } = require('../utils/numbering');
const { toNumber, round2, formatCurrency } = require('../utils/money');
const { requestItemRegions } = require('../constants/regions');
const { dateTime, boxes: unitCount } = require('./whatsappText'); // "3 Boxes", "1 Carton"

// A product switched off in Products cannot be requested or issued any more (audit, 11 Nov 2026): the
// app hid it, but the API took it, and an approved order for it could never be settled.
function assertAllActive(products) {
  const off = products.find((p) => p.isActive === false);
  if (off) throw ApiError.badRequest(`${off.name} is no longer available — remove it from the request.`);
}

// The same product, unit and city sent twice becomes one line (a defensive merge; the app sends each once).
function mergeLines(items) {
  const out = [];
  for (const i of items) {
    const same = out.find((o) => o.productId === i.productId && o.packagingUnitId === i.packagingUnitId && (o.region || null) === (i.region || null));
    if (same) same.quantity += i.quantity; else out.push({ ...i });
  }
  return out;
}

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

async function resolveWarehouseIdTx(client, requested) {
  if (requested) return requested;
  const wh = await client.warehouse.findFirst({ where: { isActive: true }, orderBy: { isPrimary: 'desc' } });
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
// `message` is a string, or a function of the short product's id.
async function assertWithinStock(client, warehouseId, requestedByProduct, message) {
  const avail = await availabilityMap(client, warehouseId);
  for (const [productId, reqBase] of requestedByProduct) {
    if (reqBase > (avail.get(productId) || 0)) {
      throw ApiError.badRequest(typeof message === 'function' ? message(productId) : message);
    }
  }
}

// Product ids currently in stock at the fulfilling warehouse (no counts exposed). Only products that
// are still switched on: the rep's list must not offer one he can no longer request.
async function availableProductIds() {
  const avail = await availabilityMap(prisma);
  const ids = [...avail.entries()].filter(([, qty]) => qty > 0).map(([pid]) => pid);
  if (ids.length === 0) return ids;
  const active = await prisma.product.findMany({ where: { id: { in: ids }, isActive: true }, select: { id: true } });
  const on = new Set(active.map((p) => p.id));
  return ids.filter((pid) => on.has(pid));
}

// Names the product that is short, never how many are left (Rule 5).
const stockExceeded = (pMap) => (productId) =>
  `Not enough ${pMap.get(productId)?.name || 'of one product'} in stock — lower that line or contact the lab.`;

async function create(salesRepId, payload) {
  if (!payload.items || payload.items.length === 0) {
    throw ApiError.badRequest('A stock request needs at least one item');
  }

  // Every line's city: a one-city rep's own, or — for a rep with two or more — the one he chose for it.
  const rep = await prisma.salesRepresentative.findUnique({ where: { id: salesRepId }, select: { region: true, regions: true } });
  const city = requestItemRegions(rep, payload.items, payload.region);
  if (city.error) throw ApiError.badRequest(city.error);
  const items = mergeLines(city.items);

  // Two requests sent at the same moment can pick the same REQ number; the loser is run again.
  const result = await withDocNumberRetry(() => prisma.$transaction(async (tx) => {
    const productIds = [...new Set(items.map((i) => i.productId))];
    const products = await tx.product.findMany({ where: { id: { in: productIds } } });
    const pMap = new Map(products.map((p) => [p.id, p]));
    if (pMap.size !== productIds.length) throw ApiError.badRequest('One or more products were not found');
    assertAllActive(products);

    // Price every line at the selling price for its chosen unit (Box/Carton).
    const lines = [];
    let totalValue = 0;
    const requestedByProduct = new Map();
    for (const i of items) {
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
        region: i.region || null,
      });
    }

    // Can't request products/quantities beyond what ZELab currently holds.
    await assertWithinStock(tx, payload.warehouseId, requestedByProduct, stockExceeded(pMap));

    const requestNumber = await nextDocNumber(tx.stockRequest, 'requestNumber', 'REQ');
    return tx.stockRequest.create({
      data: {
        requestNumber,
        salesRepId,
        warehouseId: payload.warehouseId || null,
        notes: payload.notes || null,
        region: city.region,
        status: 'PENDING',
        totalValue: round2(totalValue),
        items: { create: lines },
      },
      include: INCLUDE,
    });
  }));

  notification.notifyAdmins({
    type: 'GENERAL',
    severity: 'INFO',
    title: `New stock request: ${result.requestNumber}`,
    forStaff: true, // staff approve stock requests
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
  // `decided`: the admin's history table, which leaves the pending ones to the approval strip. They are
  // left out here, before paging, so the rows and the pager's count agree (they were dropped on screen
  // after paging: 12 rows under a pager counting 15 a page). The summary below still covers everything.
  const pageWhere = filters.decided && !filters.status ? { ...where, status: { not: 'PENDING' } } : where;
  const [items, total] = await Promise.all([
    prisma.stockRequest.findMany({ where: pageWhere, include: INCLUDE, skip: pagination.skip, take: pagination.take, orderBy: pagination.orderBy }),
    prisma.stockRequest.count({ where: pageWhere }),
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
// enforced by the controller. `actor` is who made the edit: the rep himself,
// or staff changing the rep's order (then the rep is told, and the notice to
// the admins says who changed it).
async function update(id, payload, actor = null) {
  if (!payload.items || payload.items.length === 0) {
    throw ApiError.badRequest('A stock request needs at least one item');
  }
  const existing = await prisma.stockRequest.findUnique({ where: { id } });
  if (!existing) throw ApiError.notFound('Stock request not found');
  if (existing.status !== 'PENDING') {
    throw ApiError.badRequest(`Only pending orders can be edited (this one is ${existing.status})`);
  }

  // An edit may change the cities; a line that does not name one keeps the request's city.
  const rep = await prisma.salesRepresentative.findUnique({ where: { id: existing.salesRepId }, select: { region: true, regions: true } });
  const city = requestItemRegions(rep, payload.items, payload.region !== undefined ? payload.region : existing.region);
  if (city.error) throw ApiError.badRequest(city.error);
  const items = mergeLines(city.items);

  const result = await prisma.$transaction(async (tx) => {
    // Hold the request for the whole edit, and only while it is still pending: an approval, a rejection
    // or a cancel that lands meanwhile waits for this to finish, or this finds it already decided.
    const held = await tx.stockRequest.updateMany({ where: { id, status: 'PENDING' }, data: { updatedAt: new Date() } });
    if (held.count !== 1) throw ApiError.conflict('This request was already decided, so it can no longer be edited.');

    const productIds = [...new Set(items.map((i) => i.productId))];
    const products = await tx.product.findMany({ where: { id: { in: productIds } } });
    const pMap = new Map(products.map((p) => [p.id, p]));
    if (pMap.size !== productIds.length) throw ApiError.badRequest('One or more products were not found');
    assertAllActive(products);

    const lines = [];
    let totalValue = 0;
    const requestedByProduct = new Map();
    for (const i of items) {
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
        region: i.region || null,
      });
    }

    // Same stock guard as creation applies to edits.
    await assertWithinStock(tx, payload.warehouseId !== undefined ? payload.warehouseId : existing.warehouseId, requestedByProduct, stockExceeded(pMap));

    // The request is still pending — nothing issued — so swap the items wholesale.
    await tx.stockRequestItem.deleteMany({ where: { stockRequestId: id } });
    return tx.stockRequest.update({
      where: { id },
      data: {
        warehouseId: payload.warehouseId !== undefined ? payload.warehouseId : existing.warehouseId,
        notes: payload.notes !== undefined ? payload.notes : existing.notes,
        region: city.region,
        totalValue: round2(totalValue),
        items: { create: lines },
      },
      include: INCLUDE,
    });
  });

  // Staff changing a rep's order is said as such, and the rep is told what his order is now (it used to
  // be announced as the rep's own edit, and the rep heard nothing).
  const repName = result.salesRep?.user?.name || 'A rep';
  const byStaff = !!actor && actor.role !== 'SALES_REP';
  notification.notifyAdmins({
    type: 'GENERAL',
    severity: 'INFO',
    title: `Stock request updated: ${result.requestNumber}`,
    forStaff: true, // staff approve stock requests
    message: byStaff
      ? `${actor.name || 'Staff'} changed ${repName}'s pending order — now worth ${formatCurrency(result.totalValue)}. Review and approve.`
      : `${repName} edited their pending order — now worth ${formatCurrency(result.totalValue)}. Review and approve.`,
    entityType: 'StockRequest',
    entityId: result.id,
  }).catch(() => {});
  if (byStaff) {
    const now = (result.items || []).map((i) => `${i.product?.name || 'Product'}: ${unitCount(i.quantityRequested, i.packagingUnit?.name)}`).join(', ');
    notification.notifyUser(result.salesRep?.userId, {
      type: 'GENERAL',
      severity: 'INFO',
      title: 'Stock request changed',
      message: `${actor.name || 'ZELab'} changed your pending request (${result.requestNumber}). It is now ${now}, worth ${formatCurrency(result.totalValue)}.`,
      // Its own WhatsApp: one line per product, and a long list never loses the total (audit, 11 Nov 2026).
      whatsapp: {
        kind: 'STOCK_REQUEST_CHANGED',
        request: result.requestNumber,
        by: actor.name || 'ZELab',
        items: (result.items || []).map((i) => ({ name: i.product?.name || 'Product', quantity: i.quantityRequested, unit: i.packagingUnit?.name || null })),
        total: Number(result.totalValue),
      },
      entityType: 'StockRequest',
      entityId: result.id,
    }).catch(() => {});
  }

  return result;
}

// Approve a request: optionally adjust quantities, then dispatch a warehouse->rep transfer (which posts the
// ledger and opens the 72-hour order). Audit, 11 Nov 2026: this used to check "pending", move the stock and
// mark the request in three separate commits, so a double tap, a retry after a timeout, or a rep editing or
// cancelling at the same moment could issue the stock twice or leave a cancelled request with an open order.
// Now it is ONE transaction that first claims the request (only if it is still PENDING): a second approval
// waits for the first, then finds it decided and stops; any failure undoes everything.
async function approve(id, actor, approvals = []) {
  const approvalMap = new Map(approvals.map((a) => [a.itemId, a.quantityApproved]));

  // Two approvals of two requests at the same moment can pick the same TRF/STL number; the one that loses
  // the race is undone completely and run again (its claim too, so it is still pending for the retry).
  const { finalResult, request, toIssue, settlement } = await withDocNumberRetry(() => prisma.$transaction(async (tx) => {
    const claimed = await tx.stockRequest.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'FULFILLED', decidedAt: new Date(), decidedById: actor ? actor.id : null },
    });
    if (claimed.count !== 1) {
      const exists = await tx.stockRequest.findUnique({ where: { id }, select: { status: true } });
      if (!exists) throw ApiError.notFound('Stock request not found');
      throw ApiError.conflict(`This request is already ${exists.status.toLowerCase()}.`);
    }
    const request = await tx.stockRequest.findUnique({ where: { id }, include: { items: true } });
    // Every named line must be one of this request's own lines, named once. An unknown id (a stale
    // screen, a hand-made call) used to be ignored, and the whole request was issued at the asked
    // amounts instead of the amounts the approver meant (audit backend-integrity-7). Thrown inside the
    // transaction, so the claim above is undone and the request stays pending.
    const own = new Set(request.items.map((it) => it.id));
    const seen = new Set();
    for (const a of approvals) {
      if (!own.has(a.itemId)) throw ApiError.badRequest('A line in this approval is not on the request — reload and try again.');
      if (seen.has(a.itemId)) throw ApiError.badRequest('A line is named twice in this approval — reload and try again.');
      seen.add(a.itemId);
    }
    const fromWarehouseId = await resolveWarehouseIdTx(tx, request.warehouseId);

    // Decide approved quantity per line (default: full requested amount).
    const decided = request.items.map((it) => {
      const qty = approvalMap.has(it.id) ? Number(approvalMap.get(it.id)) : it.quantityRequested;
      return { ...it, quantityApproved: Math.max(0, qty) };
    });
    const toIssue = decided.filter((d) => d.quantityApproved > 0);
    if (toIssue.length === 0) throw ApiError.badRequest('Nothing approved to issue');

    // A product switched off since the request was made is not issued: its order could never be settled.
    const issuing = await tx.product.findMany({
      where: { id: { in: [...new Set(toIssue.map((d) => d.productId))] } },
      select: { id: true, name: true, isActive: true },
    });
    const off = issuing.find((p) => p.isActive === false);
    if (off) throw ApiError.badRequest(`${off.name} is no longer active — set its line to 0 to approve the rest.`);

    // The approved order value from the issued lines only.
    const approvedTotal = round2(toIssue.reduce((acc, d) => acc + round2(toNumber(d.unitPrice) * d.quantityApproved), 0));

    // Re-validate against current warehouse stock (it may have dropped since the request was raised).
    const approvedByProduct = new Map();
    for (const d of toIssue) {
      const { baseQuantity } = await inventory.convertToBase(tx, d.productId, d.packagingUnitId, d.quantityApproved);
      approvedByProduct.set(d.productId, (approvedByProduct.get(d.productId) || 0) + baseQuantity);
    }
    await assertWithinStock(tx, fromWarehouseId, approvedByProduct, 'Insufficient stock available for approval.');

    // Dispatch the transfer (posts ledger + creates the 72h order) in this same transaction.
    const transfer = await transfers.createTransferTx(tx, {
      direction: 'WAREHOUSE_TO_REP',
      fromWarehouseId,
      toRepId: request.salesRepId,
      // One line per product and unit, as before cities: a product split between two cities is one
      // issue of stock to the rep (the cities stay on the request's own lines).
      items: mergeLines(toIssue.map((d) => ({ productId: d.productId, packagingUnitId: d.packagingUnitId, quantity: d.quantityApproved })))
        .map(({ productId, packagingUnitId, quantity }) => ({ productId, packagingUnitId, quantity })),
      notes: `Stock request ${request.requestNumber}`,
    }, actor);
    const settlement = await tx.settlement.findFirst({ where: { transferId: transfer.id } });

    // Approved quantities and resolved base amounts on the request's own lines.
    for (const d of decided) {
      let baseQuantity = 0;
      if (d.quantityApproved > 0) {
        const conv = await inventory.convertToBase(tx, d.productId, d.packagingUnitId, d.quantityApproved);
        baseQuantity = conv.baseQuantity;
      }
      await tx.stockRequestItem.update({
        where: { id: d.id },
        data: { quantityApproved: d.quantityApproved, baseQuantity, lineTotal: round2(d.quantityApproved * toNumber(d.unitPrice)) },
      });
    }

    const finalResult = await tx.stockRequest.update({
      where: { id },
      data: {
        warehouseId: fromWarehouseId,
        transferId: transfer.id,
        settlementId: settlement ? settlement.id : null,
        totalValue: approvedTotal,
      },
      include: INCLUDE,
    });
    return { finalResult, request, toIssue, settlement };
  }, { timeout: 30000 }));

  // Notify the rep their request was approved: which order it opened, its deadline, and what was issued
  // against what he asked for (a cut line reads "3 of 4 Boxes"), so a part-approval is never a surprise.
  const rep = await prisma.salesRepresentative.findUnique({
    where: { id: request.salesRepId },
    select: { userId: true },
  });
  const issuedLines = (finalResult.items || []).map((i) => ({
    name: i.product?.name || 'Product',
    approved: i.quantityApproved ?? 0,
    requested: i.quantityRequested,
    unit: i.packagingUnit?.name || null,
    city: i.region || null, // shown per line only when the request is split between cities
  }));
  const cut = issuedLines.some((l) => l.approved < l.requested);
  const order = settlement?.settlementNumber || null;
  const deadline = settlement?.deadlineAt || null;
  const orderPart = order ? ` Order ${order}${deadline ? `, settle by ${dateTime(deadline)}` : ''}.` : '';
  notification.notifyUser(rep?.userId, {
    type: 'GENERAL',
    severity: 'INFO',
    title: 'Stock request approved',
    message: `Your request (${request.requestNumber}) has been approved and issued${cut ? ', with less than you asked for on some products' : ''}.${orderPart} Check your open orders.`,
    whatsapp: { kind: 'STOCK_REQUEST_APPROVED', request: request.requestNumber, order, deadline, items: issuedLines },
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
  // Only if it is still pending at the moment of writing (an approval may be landing at the same time).
  // The reason is added under the rep's own note, never written over it (there is one notes column).
  const done = await prisma.stockRequest.updateMany({
    where: { id, status: 'PENDING' },
    data: {
      status: 'REJECTED',
      decidedAt: new Date(),
      decidedById: actor ? actor.id : null,
      notes: notes ? [request.notes, `Rejected: ${notes}`].filter(Boolean).join('\n') : request.notes,
    },
  });
  if (done.count !== 1) throw ApiError.conflict('This request was already decided.');
  const result = await prisma.stockRequest.findUnique({ where: { id }, include: INCLUDE });

  const rep = await prisma.salesRepresentative.findUnique({
    where: { id: request.salesRepId },
    select: { userId: true },
  });
  notification.notifyUser(rep?.userId, {
    type: 'GENERAL',
    severity: 'WARNING',
    title: 'Stock request not approved',
    message: `Your request (${request.requestNumber}) was not approved.${notes ? ' Reason: ' + notes : ''}`,
    whatsapp: { kind: 'STOCK_REQUEST_REJECTED', request: request.requestNumber, reason: notes },
    entityType: 'StockRequest',
    entityId: id,
  }).catch(() => {});

  return result;
}

async function cancel(id, actor) {
  const request = await prisma.stockRequest.findUnique({ where: { id } });
  if (!request) throw ApiError.notFound('Stock request not found');
  const done = await prisma.stockRequest.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'CANCELLED' } });
  if (done.count !== 1) throw ApiError.conflict('Only pending requests can be cancelled — this one was already decided.');
  const result = await prisma.stockRequest.findUnique({ where: { id }, include: INCLUDE });

  notification.notifyAdmins({
    type: 'GENERAL',
    severity: 'INFO',
    title: `Stock request cancelled: ${result.requestNumber}`,
    forStaff: true, // staff approve stock requests
    message: `${result.salesRep?.user?.name || 'A rep'} cancelled stock request ${result.requestNumber}.`,
    entityType: 'StockRequest',
    entityId: result.id,
  }).catch(() => {});

  return result;
}

module.exports = { create, list, get, update, approve, reject, cancel, availableProductIds };
