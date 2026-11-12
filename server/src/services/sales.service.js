'use strict';

const prisma = require('../config/prisma');
const env = require('../config/env');
const ApiError = require('../utils/ApiError');
const inventory = require('./inventory.service');
const { nextDocNumber } = require('../utils/numbering');
const { round2, toNumber, formatCurrency } = require('../utils/money');
const { dayjs, eatNow, eatDayBounds } = require('../utils/dates');
const { DEFAULT_REGION, regionWhere } = require('../constants/regions');

const SALE_INCLUDE = {
  items: { include: { product: true, packagingUnit: true } },
  customer: true,
  salesRep: { include: { user: { select: { name: true } } } },
  warehouse: true,
  creditSale: { include: { payments: true } },
  createdBy: { select: { id: true, name: true } },
};

// Resolve the source stock location for a sale. A rep sells from their van
// stock; otherwise the goods leave a warehouse.
function resolveSource({ salesRepId, warehouseId }) {
  if (salesRepId) return { type: inventory.LOCATION.SALES_REP, salesRepId };
  if (warehouseId) return { type: inventory.LOCATION.WAREHOUSE, warehouseId };
  throw ApiError.badRequest('A sale needs a source: provide salesRepId or warehouseId');
}

// Compute a priced line from raw input + product/packaging data.
function priceLine(input, product, packaging) {
  const factor = packaging.baseQuantity;
  const baseQuantity = input.quantity * factor;

  // Price for ONE unit of the chosen packaging, straight from the catalogue.
  const cataloguePrice =
    packaging.unitPrice != null
      ? toNumber(packaging.unitPrice)
      : round2(toNumber(product.sellingPrice) * factor);

  // Goods are never sold below the listed price. A caller may price ABOVE it,
  // but anything under is refused rather than quietly accepted — a discount is
  // the way to sell for less, and it is recorded as one.
  const packagingUnitPrice = input.unitPrice != null ? Number(input.unitPrice) : cataloguePrice;
  if (packagingUnitPrice < cataloguePrice) {
    throw ApiError.badRequest(
      `${product.name} sells for ${formatCurrency(cataloguePrice)} per ${packaging.packagingUnit?.name || 'unit'}. ` +
      `${formatCurrency(packagingUnitPrice)} is below that — use Discount to sell for less.`,
    );
  }

  const perBasePrice = round2(packagingUnitPrice / factor);
  const lineDiscount = round2(input.lineDiscount || 0);
  const lineTotal = round2(packagingUnitPrice * input.quantity - lineDiscount);
  const unitCost = toNumber(product.purchasePrice);

  return {
    productId: product.id,
    packagingUnitId: input.packagingUnitId,
    quantity: input.quantity,
    baseQuantity,
    unitPrice: perBasePrice,
    lineDiscount,
    lineTotal,
    unitCost,
    costTotal: round2(baseQuantity * unitCost),
  };
}

function deriveStatus(total, amountPaid) {
  const balance = round2(total - amountPaid);
  if (balance <= 0) return { status: 'PAID', balanceDue: 0 };
  if (amountPaid > 0) return { status: 'PARTIAL', balanceDue: balance };
  return { status: 'UNPAID', balanceDue: balance };
}

// Core sale creation that runs inside a caller-provided transaction. Settlement
// reuses this so each settled box becomes a CASH sale — meaning revenue,
// product performance, analytics and inventory all flow through one path.
/**
 * The region a sale is filed under, for the regional report: what the caller
 * said > the customer's > the rep's. With none of those and NO rep, this is a
 * direct sale out of the warehouse, so it belongs to the warehouse's region —
 * Dar es Salaam unless that warehouse says otherwise. (It used to be saved blank
 * and show as "Unassigned"; owner, 10 Nov 2026.) A rep's sale whose rep has no
 * region stays blank: that is genuinely not known, and it is not the warehouse's.
 */
async function resolveSaleRegion(tx, { region, customerId, salesRepId, warehouseId }) {
  let resolved = region || null;
  if (!resolved && customerId) {
    const c = await tx.customer.findUnique({ where: { id: customerId }, select: { region: true } });
    resolved = c?.region || null;
  }
  if (!resolved && salesRepId) {
    const r = await tx.salesRepresentative.findUnique({ where: { id: salesRepId }, select: { region: true } });
    resolved = r?.region || null;
  }
  if (!resolved && !salesRepId) {
    const wh = warehouseId ? await tx.warehouse.findUnique({ where: { id: warehouseId }, select: { region: true } }) : null;
    resolved = wh?.region || DEFAULT_REGION;
  }
  return resolved;
}

async function createSaleTx(tx, payload, actor) {
  const {
    type,
    customerId = null,
    salesRepId = null,
    settlementId = null,
    warehouseId = null,
    items,
    discount = 0,
    amountPaid,
    dueDate,
    region,
    notes,
    soldAt,
  } = payload;

  if (!items || items.length === 0) {
    throw ApiError.badRequest('A sale must contain at least one item');
  }
  if (type === 'CREDIT' && !customerId) {
    throw ApiError.badRequest('Credit sales require a customer');
  }

  // Rep stock leaves ONLY through the settlement contract or a return. A
  // plain sale from a rep's stock would deplete their inventory and book the
  // revenue while their open order still shows the boxes as owed — the same
  // box counted as sold and unaccounted at once, and no commission earned on
  // it. Nothing in production ever used this path; now nothing can.
  if (salesRepId && !settlementId) {
    throw ApiError.badRequest(
      "A rep's boxes are settled through their order, not sold past it — open the order in Settlements and settle the boxes there, so the contract, the commission and the stock all move together.",
    );
  }

  const source = resolveSource({ salesRepId, warehouseId });

  // Load products referenced by the items.
  const productIds = [...new Set(items.map((i) => i.productId))];
  const products = await tx.product.findMany({ where: { id: { in: productIds } } });
  const productMap = new Map(products.map((p) => [p.id, p]));
  if (productMap.size !== productIds.length) {
    throw ApiError.badRequest('One or more products were not found');
  }

  // Price each line and resolve packaging conversions.
  const lines = [];
  for (const input of items) {
    const product = productMap.get(input.productId);
    if (!product.isActive) {
      throw ApiError.badRequest(`Product "${product.name}" is inactive`);
    }
    const { packaging } = await inventory.convertToBase(
      tx,
      input.productId,
      input.packagingUnitId,
      input.quantity,
    );
    lines.push(priceLine(input, product, packaging));
  }

  const subtotal = round2(lines.reduce((s, l) => s + l.lineTotal, 0));
  const saleDiscount = round2(discount);
  const total = round2(subtotal - saleDiscount);
  if (total < 0) throw ApiError.badRequest('Discount cannot exceed the sale subtotal');
  const costTotal = round2(lines.reduce((s, l) => s + l.costTotal, 0));

  const paid =
    type === 'CASH'
      ? amountPaid != null
        ? round2(amountPaid)
        : total
      : round2(amountPaid || 0);
  // Change goes back to the customer; it is not takings. 3,000 paid on a 2,500 sale was saved as
  // 3,000 paid and the whole 3,000 booked into the brand's account (audit, 11 Nov 2026).
  if (paid > total) {
    throw ApiError.badRequest(
      `Amount paid (${formatCurrency(paid)}) is more than the sale total (${formatCurrency(total)}). Enter what the sale costs — any change goes back to the customer.`,
    );
  }
  const { status, balanceDue } = deriveStatus(total, paid);

  const saleNumber = await nextDocNumber(tx.sale, 'saleNumber', 'SALE');

  const resolvedRegion = await resolveSaleRegion(tx, { region, customerId, salesRepId, warehouseId });

  const sale = await tx.sale.create({
    data: {
      saleNumber,
      type,
      status,
      customerId,
      salesRepId,
      settlementId,
      warehouseId,
      region: resolvedRegion,
      subtotal,
      discount: saleDiscount,
      total,
      amountPaid: paid,
      balanceDue,
      costTotal,
      notes: notes || null,
      soldAt: soldAt ? new Date(soldAt) : new Date(),
      createdById: actor ? actor.id : null,
      items: {
        create: lines.map((l) => ({
          productId: l.productId,
          packagingUnitId: l.packagingUnitId,
          quantity: l.quantity,
          baseQuantity: l.baseQuantity,
          unitPrice: l.unitPrice,
          lineDiscount: l.lineDiscount,
          lineTotal: l.lineTotal,
          unitCost: l.unitCost,
        })),
      },
    },
  });

  // Post the inventory ledger movements (out of the source location).
  const movementType = type === 'CASH' ? 'CASH_SALE' : 'CREDIT_SALE';
  for (const l of lines) {
    await inventory.decreaseStock(tx, {
      productId: l.productId,
      packagingUnitId: l.packagingUnitId,
      quantity: l.quantity,
      baseQuantity: l.baseQuantity,
      type: movementType,
      location: source,
      referenceType: 'SALE',
      referenceId: sale.id,
      userId: actor ? actor.id : null,
      unitCost: l.unitCost,
      notes: notes || `Sale ${saleNumber}`,
      occurredAt: sale.soldAt,
    });
  }

  // Credit bookkeeping.
  if (type === 'CREDIT') {
    const due = dueDate
      ? new Date(dueDate)
      : dayjs().add(env.business.defaultCreditTermDays, 'day').toDate();
    const creditStatus = balanceDue <= 0 ? 'PAID' : paid > 0 ? 'PARTIAL' : 'OPEN';
    const creditSale = await tx.creditSale.create({
      data: {
        saleId: sale.id,
        customerId,
        salesRepId,
        principal: total,
        amountPaid: paid,
        balance: balanceDue,
        dueDate: due,
        status: creditStatus,
      },
    });
    if (paid > 0) {
      await tx.creditPayment.create({
        data: {
          creditSaleId: creditSale.id,
          amount: paid,
          method: 'CASH',
          reference: `Down payment on ${saleNumber}`,
          receivedById: actor ? actor.id : null,
        },
      });
    }
  }

  return tx.sale.findUnique({ where: { id: sale.id }, include: SALE_INCLUDE });
}

async function createSale(payload, actor) {
  return prisma.$transaction((tx) => createSaleTx(tx, payload, actor), { timeout: 30000 });
}

async function listSales(filters, pagination) {
  const where = {};
  if (filters.type) where.type = filters.type;
  if (filters.status) where.status = filters.status;
  if (filters.salesRepId) where.salesRepId = filters.salesRepId;
  if (filters.customerId) where.customerId = filters.customerId;
  if (filters.warehouseId) where.warehouseId = filters.warehouseId;
  // The sales a customer can bring boxes back from: counter sales (no rep, no order), not cancelled.
  if (filters.refundable) where.AND = [...(where.AND || []), { salesRepId: null, settlementId: null, status: { not: 'CANCELLED' } }];
  // Dar es Salaam also finds the sales with no region, which are its own.
  const regionClause = regionWhere(filters.region);
  if (regionClause) where.AND = [...(where.AND || []), regionClause];
  if (filters.from || filters.to) {
    // A day is a Dar es Salaam day (audit backend-integrity-8).
    const bounds = eatDayBounds({ from: filters.from, to: filters.to });
    if (!bounds) throw ApiError.badRequest('Use dates like 2026-11-11 for from and to');
    where.soldAt = bounds;
  }
  if (filters.search) {
    where.OR = [
      { saleNumber: { contains: filters.search, mode: 'insensitive' } },
      { customer: { name: { contains: filters.search, mode: 'insensitive' } } },
    ];
  }

  const [items, total] = await Promise.all([
    prisma.sale.findMany({
      where,
      include: {
        customer: { select: { id: true, name: true, region: true } },
        salesRep: { include: { user: { select: { name: true } } } },
        // baseQuantity: Returns > Customer return tells counter sales apart by their boxes.
        items: { select: { id: true, baseQuantity: true } },
      },
      skip: pagination.skip,
      take: pagination.take,
      orderBy: pagination.orderBy,
    }),
    prisma.sale.count({ where }),
  ]);

  // Totals over EVERY matching sale, not the page. A list of sales with no
  // total is a receipt spike: you can read each line and still not know what
  // the business sold. Cancelled sales are excluded from the money — they
  // are still listed, but they earned nothing.
  // The exclusion is an AND rather than an overwrite: spreading it over `where`
  // dropped a caller's own status filter, so asking for cancelled sales came
  // back with the revenue of every sale that was not cancelled.
  const moneyWhere = { AND: [where, { status: { not: 'CANCELLED' } }] };
  // Chip counts stay put while you click through them, so each filter is
  // counted over the others rather than over itself.
  const whereAnyStatus = { ...where };
  delete whereAnyStatus.status;
  const whereAnyType = { ...where };
  delete whereAnyType.type;

  const [agg, boxAgg, cancelled, unpaid, byStatusRows, byTypeRows, first, last] = await Promise.all([
    prisma.sale.aggregate({ where: moneyWhere, _sum: { total: true, costTotal: true, balanceDue: true }, _count: true }),
    prisma.saleItem.aggregate({ where: { sale: { is: moneyWhere } }, _sum: { baseQuantity: true } }),
    prisma.sale.count({ where: { AND: [where, { status: 'CANCELLED' }] } }),
    prisma.sale.count({ where: { AND: [where, { status: { not: 'CANCELLED' }, balanceDue: { gt: 0 } }] } }),
    prisma.sale.groupBy({ by: ['status'], where: whereAnyStatus, _count: { _all: true } }),
    prisma.sale.groupBy({ by: ['type'], where: whereAnyType, _count: { _all: true } }),
    prisma.sale.findFirst({ where, orderBy: { soldAt: 'asc' }, select: { soldAt: true } }),
    prisma.sale.findFirst({ where, orderBy: { soldAt: 'desc' }, select: { soldAt: true } }),
  ]);
  const revenue = round2(toNumber(agg._sum.total));
  const cost = round2(toNumber(agg._sum.costTotal));
  const summary = {
    sales: agg._count,
    cancelled,
    unpaid,
    revenue,
    cost,
    profit: round2(revenue - cost),
    margin: revenue > 0 ? round2(((revenue - cost) / revenue) * 100) : 0,
    boxes: boxAgg._sum.baseQuantity || 0,
    owed: round2(toNumber(agg._sum.balanceDue)),
    byStatus: Object.fromEntries(byStatusRows.map((r) => [r.status, r._count._all])),
    byType: Object.fromEntries(byTypeRows.map((r) => [r.type, r._count._all])),
    firstAt: first?.soldAt || null,
    lastAt: last?.soldAt || null,
  };

  return { items, total, summary };
}

async function getSale(id) {
  const sale = await prisma.sale.findUnique({ where: { id }, include: SALE_INCLUDE });
  if (!sale) throw ApiError.notFound('Sale not found');
  return sale;
}

// Cancel a sale, restoring stock to its source location via CORRECTION rows.
// `opts` lets a customer's full return (refundSale) share this exact path: the same
// claim, stock, credit, order and money reversal — only the movement is filed as the
// CUSTOMER_RETURN it is, with its own words on the sale.
async function cancelSaleTx(tx, id, actor, reason, opts = {}) {
  const { stockType = 'CORRECTION', stockNote = null, notesLine = null } = opts;
  const seen = await tx.sale.findUnique({ where: { id }, select: { id: true, status: true } });
  if (!seen) throw ApiError.notFound('Sale not found');
  if (seen.status === 'CANCELLED') throw ApiError.badRequest('Sale is already cancelled');
  // Claim the cancel before anything moves (audit #41): two clicks used to both pass the check above
  // and both put the stock back and both take the sale off its order. The second now waits, finds
  // it cancelled and stops with nothing written.
  const claimed = await tx.sale.updateMany({ where: { id, status: { not: 'CANCELLED' } }, data: { status: 'CANCELLED' } });
  if (claimed.count !== 1) throw ApiError.conflict('This sale was already cancelled.');
  // Read the sale AFTER the claim (12 Nov 2026): a customer refund that finished while this waited has
  // made the sale smaller, and only the boxes and money still on it may go back.
  const sale = await tx.sale.findUnique({
    where: { id },
    include: { items: true, creditSale: { include: { payments: true } } },
  });

  const source = resolveSource({ salesRepId: sale.salesRepId, warehouseId: sale.warehouseId });

  for (const item of sale.items) {
    if (!item.quantity) continue; // a line the customer already brought back in full
    await inventory.increaseStock(tx, {
      productId: item.productId,
      packagingUnitId: item.packagingUnitId,
      quantity: item.quantity,
      baseQuantity: item.baseQuantity,
      type: stockType,
      location: source,
      referenceType: 'SALE',
      referenceId: sale.id,
      userId: actor ? actor.id : null,
      unitCost: toNumber(item.unitCost),
      notes: stockNote || `Reversal of cancelled sale ${sale.saleNumber}${reason ? ` — ${reason}` : ''}`,
    });
  }

  if (sale.creditSale) {
    await tx.creditSale.update({
      where: { id: sale.creditSale.id },
      data: { status: 'WRITTEN_OFF', balance: 0 },
    });
  }

  // Settlement-linked sale: the boxes go back to being OWED on the order —
  // roll back the settled value, un-close the order if needed, and recompute
  // its status. (Lazy require: settlement.service requires this module.)
  if (sale.settlementId) {
    // eslint-disable-next-line global-require
    const settlementSvc = require('./settlement.service');
    // Under the order's row lock, like every other change to an order's settled value.
    await settlementSvc.lockOrder(tx, sale.settlementId);
    const stl = await tx.settlement.findUnique({ where: { id: sale.settlementId } });
    if (stl) {
      const newSettled = Math.max(0, round2(toNumber(stl.settledValue) - toNumber(sale.total)));
      await tx.settlement.update({
        where: { id: sale.settlementId },
        data: { settledValue: newSettled, settledAt: null },
      });
      await settlementSvc.recomputeStatus(tx, sale.settlementId);
    }
  }

  // Reverse the money: remove the ledger income posted for this sale so the
  // account gives the cash back. The backfill skips cancelled sales, so the
  // row will never be re-created.
  await tx.financeTransaction.deleteMany({ where: { refType: 'Sale', refId: sale.id, direction: 'IN' } });

  const line = notesLine || (reason ? `Cancelled: ${reason}` : null);
  return tx.sale.update({
    where: { id: sale.id },
    data: { status: 'CANCELLED', balanceDue: 0, notes: line ? `${sale.notes || ''}\n${line}`.trim() : sale.notes },
    include: SALE_INCLUDE,
  });
}

async function cancelSale(id, actor, reason) {
  return prisma.$transaction((tx) => cancelSaleTx(tx, id, actor, reason));
}

// ── A customer brings boxes back from a counter sale: the sale and the money come out ──────────────
// Owner, 12 Nov 2026: "Yes, refund: the sale and the money come out of Finance. Do this when the
// customer returns — the money returns too, so the sale is cancelled."
//   • every box back  -> exactly what Cancel does (same code), the boxes filed as a CUSTOMER_RETURN;
//   • some boxes back -> the lines, the sale and its cost get smaller (maths: utils/saleRefund.js), the
//     boxes go back into the sale's warehouse, and the cash going back is taken off the sale's own IN
//     row(s) in the ledger, on the account the sale was paid into.
// Why the IN row is reduced rather than an OUT row added: the ledger row of a sale MIRRORS the sale (it
// cannot be edited or deleted by hand, Cancel deletes it, the backfill re-creates it from the sale). A
// smaller sale with a smaller row keeps every screen on one figure — the sale's revenue on its day, the
// money in on the same day, the account balance, and the Sales summary; an OUT row would leave the sale's
// day showing money in that its revenue no longer has, and a later Cancel would give the money back twice.
// The history is kept in words on the row (its notes), on the sale (its notes), in the CUSTOMER_RETURN
// stock rows, and in the audit log.
// One request per look at the sale: `version` is the sale's updatedAt as the window saw it. The claim
// below moves it on, so a double tap, a second window or a Cancel at the same moment finds the sale
// changed and stops with nothing written.
const REP_SALE_REFUSED = "Rep sales are returned through the rep's order.";
async function refundSale(id, { items, reason, version } = {}, actor) {
  const { planRefund, RefundInputError } = require('../utils/saleRefund'); // eslint-disable-line global-require
  return prisma.$transaction(async (tx) => {
    const seen = await tx.sale.findUnique({
      where: { id },
      select: { id: true, status: true, salesRepId: true, settlementId: true, updatedAt: true },
    });
    if (!seen) throw ApiError.notFound('Sale not found');
    if (seen.salesRepId || seen.settlementId) throw ApiError.badRequest(REP_SALE_REFUSED);
    if (seen.status === 'CANCELLED') throw ApiError.badRequest('This sale is already cancelled — nothing on it is left to return.');
    const when = version ? new Date(version) : null;
    if (!when || Number.isNaN(when.getTime())) throw ApiError.badRequest('Open the sale again and retry.');

    const claimed = await tx.sale.updateMany({
      where: { id, status: { not: 'CANCELLED' }, updatedAt: when },
      data: { updatedAt: new Date() },
    });
    if (claimed.count !== 1) {
      throw ApiError.conflict('This sale changed a moment ago (a refund or a cancel was just saved). Close it and open it again.');
    }

    // Read under the claim: these are the figures the refund is worked out from.
    const sale = await tx.sale.findUnique({
      where: { id },
      include: { items: { include: { product: { select: { name: true } } } }, creditSale: true },
    });
    let plan;
    try {
      plan = planRefund({
        subtotal: toNumber(sale.subtotal),
        discount: toNumber(sale.discount),
        total: toNumber(sale.total),
        amountPaid: toNumber(sale.amountPaid),
        costTotal: toNumber(sale.costTotal),
        items: sale.items.map((i) => ({
          id: i.id,
          productId: i.productId,
          packagingUnitId: i.packagingUnitId,
          quantity: i.quantity,
          baseQuantity: i.baseQuantity,
          lineTotal: toNumber(i.lineTotal),
          lineDiscount: toNumber(i.lineDiscount),
          unitCost: toNumber(i.unitCost),
        })),
      }, items);
    } catch (e) {
      if (e instanceof RefundInputError) throw ApiError.badRequest(e.message);
      throw e;
    }

    const nameOf = new Map(sale.items.map((i) => [i.id, i.product?.name || 'Product']));
    // quantity = in the line's own unit (what the window stepped); boxes = the warehouse's boxes it puts back.
    const lines = plan.lines.map((l) => ({ saleItemId: l.saleItemId, product: nameOf.get(l.saleItemId), quantity: l.quantityBack, boxes: l.baseBack, value: l.valueBack }));
    const before = {
      subtotal: toNumber(sale.subtotal), discount: toNumber(sale.discount), total: toNumber(sale.total),
      amountPaid: toNumber(sale.amountPaid), balanceDue: toNumber(sale.balanceDue), costTotal: toNumber(sale.costTotal), status: sale.status,
    };
    const boxWord = plan.boxesBack === 1 ? 'box' : 'boxes';
    const said = reason ? `: ${reason}` : '';
    const moneyRows = await tx.financeTransaction.findMany({
      where: { refType: 'Sale', refId: id, direction: 'IN' },
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
      include: { account: { select: { id: true, name: true } } },
    });

    if (plan.everything) {
      const done = await cancelSaleTx(tx, id, actor, reason, {
        stockType: 'CUSTOMER_RETURN',
        stockNote: `Customer return — refunded (${sale.saleNumber}, every box back)`,
        notesLine: `Customer returned every box — sale cancelled, ${formatCurrency(plan.cashBack)} refunded${said}`,
      });
      const ledger = moneyRows.map((r) => ({
        txnNumber: r.txnNumber, account: r.account?.name || null, before: toNumber(r.amount), after: 0, taken: toNumber(r.amount), removed: true,
      }));
      return { sale: done, refund: { everything: true, saleNumber: sale.saleNumber, boxes: plan.boxesBack, lines, refundValue: plan.refundValue, cashBack: plan.cashBack, owedCleared: plan.owedCleared, ledger, before, after: { total: 0, amountPaid: 0, balanceDue: 0, status: 'CANCELLED' }, reason: reason || null } };
    }

    // A credit sale keeps a ledger of its own payments; only a whole return (above) may undo it.
    if (sale.type === 'CREDIT' || sale.creditSale) {
      throw ApiError.badRequest('A credit sale comes back whole: return every box on it, or cancel it.');
    }
    if (!sale.warehouseId) throw ApiError.badRequest("This sale's warehouse no longer exists, so its boxes have nowhere to go back to.");

    for (const l of plan.lines) {
      await tx.saleItem.update({ where: { id: l.saleItemId }, data: l.next });
      await inventory.increaseStock(tx, {
        productId: l.productId,
        packagingUnitId: l.packagingUnitId,
        quantity: l.quantityBack,
        baseQuantity: l.baseBack,
        type: 'CUSTOMER_RETURN',
        location: { type: inventory.LOCATION.WAREHOUSE, warehouseId: sale.warehouseId },
        referenceType: 'SALE',
        referenceId: sale.id,
        userId: actor ? actor.id : null,
        unitCost: l.unitCost,
        notes: `Customer return — refunded (${sale.saleNumber})`,
      });
    }

    // The cash going back comes off the money this sale brought in, newest row first, never below zero.
    // A row is kept (at a smaller amount) rather than deleted: its refId is what stops the backfill from
    // re-creating the sale's income at the full figure.
    let left = plan.cashBack;
    const ledger = [];
    const today = eatNow().format('D MMM YYYY'); // the business's day, not the server's
    for (const r of moneyRows) {
      if (left <= 0) break;
      const amt = toNumber(r.amount);
      const take = round2(Math.min(amt, left));
      if (take <= 0) continue;
      const after = round2(amt - take);
      await tx.financeTransaction.update({
        where: { id: r.id },
        data: {
          amount: after,
          notes: `${r.notes ? `${r.notes}\n` : ''}Refund to customer ${today}: −${formatCurrency(take)} (${plan.boxesBack} ${boxWord} back)`,
        },
      });
      ledger.push({ txnNumber: r.txnNumber, account: r.account?.name || null, before: amt, after, taken: take, removed: false });
      left = round2(left - take);
    }

    const updated = await tx.sale.update({
      where: { id },
      data: {
        ...plan.next,
        notes: `${sale.notes || ''}\nCustomer returned ${plan.boxesBack} ${boxWord} — ${formatCurrency(plan.cashBack)} refunded${plan.owedCleared > 0 ? `, ${formatCurrency(plan.owedCleared)} off what is owed` : ''}${said}`.trim(),
      },
      include: SALE_INCLUDE,
    });
    return {
      sale: updated,
      refund: {
        everything: false, saleNumber: sale.saleNumber, boxes: plan.boxesBack, lines,
        refundValue: plan.refundValue, cashBack: plan.cashBack, owedCleared: plan.owedCleared,
        // Money the sale says was paid that no ledger row carries (an old sale before the books began, or
        // one whose income was never recorded) — nothing to take off, said rather than hidden.
        notInLedger: left > 0 ? left : 0,
        ledger, before, after: { ...plan.next }, reason: reason || null,
      },
    };
  }, { timeout: 30000 });
}

// What the refund window needs besides the sale: the account(s) its money went into, and the refunds
// already made on it (from the audit log, where each refund is recorded with its figures).
async function saleMoneyAndRefunds(id) {
  const [rows, logs] = await Promise.all([
    prisma.financeTransaction.findMany({
      where: { refType: 'Sale', refId: id, direction: 'IN' },
      orderBy: { occurredAt: 'asc' },
      select: { amount: true, account: { select: { id: true, name: true } } },
    }),
    prisma.auditLog.findMany({
      where: { entityType: 'Sale', entityId: id, action: 'REFUND' },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true, newValues: true, user: { select: { name: true } } },
    }),
  ]);
  return {
    paidInto: rows.map((r) => ({ accountId: r.account?.id || null, account: r.account?.name || null, amount: toNumber(r.amount) })),
    refunds: logs.map((l) => {
      const v = l.newValues || {};
      return { at: l.createdAt, by: l.user?.name || null, boxes: v.boxes || 0, cashBack: v.cashBack || 0, owedCleared: v.owedCleared || 0, everything: !!v.everything, lines: v.lines || [], reason: v.reason || null };
    }),
  };
}

module.exports = { createSale, createSaleTx, listSales, getSale, cancelSale, cancelSaleTx, refundSale, saleMoneyAndRefunds, resolveSaleRegion, SALE_INCLUDE, REP_SALE_REFUSED };
