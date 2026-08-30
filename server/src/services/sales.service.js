'use strict';

const prisma = require('../config/prisma');
const env = require('../config/env');
const ApiError = require('../utils/ApiError');
const inventory = require('./inventory.service');
const { nextDocNumber } = require('../utils/numbering');
const { round2, toNumber, formatCurrency } = require('../utils/money');
const { dayjs } = require('../utils/dates');

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
  const { status, balanceDue } = deriveStatus(total, paid);

  const saleNumber = await nextDocNumber(tx.sale, 'saleNumber', 'SALE');

  // Resolve a region for reporting: explicit > customer > rep.
  let resolvedRegion = region || null;
  if (!resolvedRegion && customerId) {
    const c = await tx.customer.findUnique({ where: { id: customerId }, select: { region: true } });
    resolvedRegion = c?.region || null;
  }
  if (!resolvedRegion && salesRepId) {
    const r = await tx.salesRepresentative.findUnique({ where: { id: salesRepId }, select: { region: true } });
    resolvedRegion = r?.region || null;
  }

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
  if (filters.region) where.region = filters.region;
  if (filters.from || filters.to) {
    where.soldAt = {};
    if (filters.from) where.soldAt.gte = new Date(filters.from);
    if (filters.to) where.soldAt.lte = new Date(filters.to);
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
        items: { select: { id: true } },
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
async function cancelSale(id, actor, reason) {
  return prisma.$transaction(async (tx) => {
    const sale = await tx.sale.findUnique({
      where: { id },
      include: { items: true, creditSale: { include: { payments: true } } },
    });
    if (!sale) throw ApiError.notFound('Sale not found');
    if (sale.status === 'CANCELLED') throw ApiError.badRequest('Sale is already cancelled');

    const source = resolveSource({ salesRepId: sale.salesRepId, warehouseId: sale.warehouseId });

    for (const item of sale.items) {
      await inventory.increaseStock(tx, {
        productId: item.productId,
        packagingUnitId: item.packagingUnitId,
        quantity: item.quantity,
        baseQuantity: item.baseQuantity,
        type: 'CORRECTION',
        location: source,
        referenceType: 'SALE',
        referenceId: sale.id,
        userId: actor ? actor.id : null,
        unitCost: toNumber(item.unitCost),
        notes: `Reversal of cancelled sale ${sale.saleNumber}${reason ? ` — ${reason}` : ''}`,
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
      const stl = await tx.settlement.findUnique({ where: { id: sale.settlementId } });
      if (stl) {
        const newSettled = Math.max(0, round2(toNumber(stl.settledValue) - toNumber(sale.total)));
        await tx.settlement.update({
          where: { id: sale.settlementId },
          data: { settledValue: newSettled, settledAt: null },
        });
        // eslint-disable-next-line global-require
        const settlementSvc = require('./settlement.service');
        await settlementSvc.recomputeStatus(tx, sale.settlementId);
      }
    }

    // Reverse the money: remove the ledger income posted for this sale so the
    // account gives the cash back. The backfill skips cancelled sales, so the
    // row will never be re-created.
    await tx.financeTransaction.deleteMany({ where: { refType: 'Sale', refId: sale.id, direction: 'IN' } });

    return tx.sale.update({
      where: { id: sale.id },
      data: { status: 'CANCELLED', balanceDue: 0, notes: reason ? `${sale.notes || ''}\nCancelled: ${reason}`.trim() : sale.notes },
      include: SALE_INCLUDE,
    });
  });
}

module.exports = { createSale, createSaleTx, listSales, getSale, cancelSale, SALE_INCLUDE };
