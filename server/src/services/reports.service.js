'use strict';

const prisma = require('../config/prisma');
const inventory = require('./inventory.service');
const credit = require('./credit.service');
const { toNumber, round2 } = require('../utils/money');
const { dayjs, resolveRange } = require('../utils/dates');

const NON_CANCELLED = { status: { not: 'CANCELLED' } };

function bucketKey(date, granularity) {
  const d = dayjs(date);
  switch (granularity) {
    case 'month':
      return d.format('YYYY-MM');
    case 'week':
      return `${d.isoWeekYear()}-W${String(d.isoWeek()).padStart(2, '0')}`;
    case 'day':
    default:
      return d.format('YYYY-MM-DD');
  }
}

function pickGranularity(range, requested) {
  if (requested) return requested;
  const days = dayjs(range.end).diff(dayjs(range.start), 'day');
  if (days <= 1) return 'day';
  if (days <= 92) return 'day';
  if (days <= 366) return 'week';
  return 'month';
}

// Time-bucketed sales with revenue, cost and profit. Powers daily/weekly/
// monthly/annual reports depending on the period + granularity supplied.
async function salesReport(params = {}) {
  const range = await clampToEpoch(resolveRange(params));
  const granularity = pickGranularity(range, params.groupBy);

  const where = { ...NON_CANCELLED, soldAt: { gte: range.start, lte: range.end } };
  if (params.salesRepId) where.salesRepId = params.salesRepId;
  if (params.region) where.region = params.region;
  if (params.type) where.type = params.type;

  const sales = await prisma.sale.findMany({
    where,
    select: { soldAt: true, total: true, costTotal: true, discount: true, type: true },
    orderBy: { soldAt: 'asc' },
  });

  const buckets = new Map();
  let revenue = 0;
  let cost = 0;
  let discounts = 0;
  let cashRevenue = 0;
  let creditRevenue = 0;

  for (const s of sales) {
    const key = bucketKey(s.soldAt, granularity);
    const tot = toNumber(s.total);
    const cst = toNumber(s.costTotal);
    revenue += tot;
    cost += cst;
    discounts += toNumber(s.discount);
    if (s.type === 'CASH') cashRevenue += tot;
    else creditRevenue += tot;

    const b = buckets.get(key) || { period: key, revenue: 0, cost: 0, profit: 0, orders: 0 };
    b.revenue = round2(b.revenue + tot);
    b.cost = round2(b.cost + cst);
    b.profit = round2(b.revenue - b.cost);
    b.orders += 1;
    buckets.set(key, b);
  }

  const series = [...buckets.values()].sort((a, b) => a.period.localeCompare(b.period));

  return {
    range: { start: range.start, end: range.end, label: range.label, granularity },
    totals: {
      revenue: round2(revenue),
      cost: round2(cost),
      grossProfit: round2(revenue - cost),
      margin: revenue > 0 ? round2(((revenue - cost) / revenue) * 100) : 0,
      discounts: round2(discounts),
      orders: sales.length,
      cashRevenue: round2(cashRevenue),
      creditRevenue: round2(creditRevenue),
      averageOrderValue: sales.length ? round2(revenue / sales.length) : 0,
    },
    series,
  };
}

// Per-product units sold, revenue and profit. Returns both top sellers and the
// slowest movers (active products ranked by units sold ascending).
async function productPerformance(params = {}) {
  const range = await clampToEpoch(resolveRange(params));
  const limit = params.limit || 10;

  const items = await prisma.saleItem.findMany({
    where: { sale: { is: { ...NON_CANCELLED, soldAt: { gte: range.start, lte: range.end } } } },
    select: {
      productId: true,
      baseQuantity: true,
      lineTotal: true,
      unitCost: true,
      product: { select: { name: true, sku: true, baseUnitName: true, brand: { select: { name: true } } } },
    },
  });

  const agg = new Map();
  for (const it of items) {
    const cur =
      agg.get(it.productId) ||
      {
        productId: it.productId,
        name: it.product.name,
        sku: it.product.sku,
        brand: it.product.brand?.name,
        baseUnitName: it.product.baseUnitName,
        unitsSold: 0,
        revenue: 0,
        cost: 0,
      };
    cur.unitsSold += it.baseQuantity;
    cur.revenue = round2(cur.revenue + toNumber(it.lineTotal));
    cur.cost = round2(cur.cost + it.baseQuantity * toNumber(it.unitCost));
    agg.set(it.productId, cur);
  }

  const ranked = [...agg.values()].map((r) => ({
    ...r,
    profit: round2(r.revenue - r.cost),
    margin: r.revenue > 0 ? round2(((r.revenue - r.cost) / r.revenue) * 100) : 0,
  }));

  const topSelling = [...ranked].sort((a, b) => b.unitsSold - a.unitsSold).slice(0, limit);

  // Slow movers: every active product, including those with zero sales.
  const activeProducts = await prisma.product.findMany({
    where: { isActive: true },
    select: { id: true, name: true, sku: true, baseUnitName: true, brand: { select: { name: true } } },
  });
  const slowMoving = activeProducts
    .map((p) => {
      const sold = agg.get(p.id);
      return {
        productId: p.id,
        name: p.name,
        sku: p.sku,
        brand: p.brand?.name,
        baseUnitName: p.baseUnitName,
        unitsSold: sold ? sold.unitsSold : 0,
        revenue: sold ? sold.revenue : 0,
      };
    })
    .sort((a, b) => a.unitsSold - b.unitsSold)
    .slice(0, limit);

  return {
    range: { start: range.start, end: range.end, label: range.label },
    topSelling,
    slowMoving,
    all: ranked.sort((a, b) => b.revenue - a.revenue),
  };
}

async function regionalPerformance(params = {}) {
  const range = await clampToEpoch(resolveRange(params));
  // Bucket revenue by the rep's CURRENT region (live join), not a region copied
  // onto the sale when it happened — so editing a rep's region immediately
  // re-buckets all their sales. Sales with no rep (admin direct) → "Unspecified".
  const [grouped, reps, primaryWh] = await Promise.all([
    prisma.sale.groupBy({
      by: ['salesRepId'],
      where: { ...NON_CANCELLED, soldAt: { gte: range.start, lte: range.end } },
      _sum: { total: true, costTotal: true },
      _count: true,
    }),
    prisma.salesRepresentative.findMany({ select: { id: true, region: true } }),
    prisma.warehouse.findFirst({ where: { isActive: true }, orderBy: { isPrimary: 'desc' }, select: { region: true } }),
  ]);

  // Direct (no-rep) sales come straight from The Lab — a normal cash sale from
  // the warehouse — so they belong to the warehouse's region. Rep sales use the
  // rep's CURRENT region (live).
  const labRegion = (primaryWh?.region || '').trim() || 'Unspecified';
  const regionByRep = new Map(reps.map((r) => [r.id, (r.region || '').trim() || 'Unspecified']));

  const byRegion = new Map();
  for (const g of grouped) {
    const region = g.salesRepId ? (regionByRep.get(g.salesRepId) || 'Unspecified') : labRegion;
    const cur = byRegion.get(region) || { region, revenue: 0, cost: 0, orders: 0 };
    cur.revenue += toNumber(g._sum.total);
    cur.cost += toNumber(g._sum.costTotal);
    cur.orders += g._count;
    byRegion.set(region, cur);
  }

  const items = [...byRegion.values()]
    .map((x) => ({
      region: x.region,
      revenue: round2(x.revenue),
      cost: round2(x.cost),
      profit: round2(x.revenue - x.cost),
      orders: x.orders,
    }))
    .sort((a, b) => b.revenue - a.revenue);

  return { range: { start: range.start, end: range.end, label: range.label }, items };
}

async function salesRepPerformance(params = {}) {
  const range = await clampToEpoch(resolveRange(params));

  const [grouped, reps, commissionSummary] = await Promise.all([
    prisma.sale.groupBy({
      by: ['salesRepId'],
      where: { ...NON_CANCELLED, soldAt: { gte: range.start, lte: range.end } },
      _sum: { total: true, costTotal: true },
      _count: true,
    }),
    prisma.salesRepresentative.findMany({
      where: { isActive: true },
      include: { user: { select: { name: true } } },
    }),
    require('./commission.service').summaryAllReps().catch(() => ({ items: [] })),
  ]);

  const salesMap = new Map(grouped.map((g) => [g.salesRepId, g]));
  const commMap = new Map((commissionSummary.items || []).map((c) => [c.salesRepId, toNumber(c.available)]));

  const items = reps.map((rep) => {
    const s = salesMap.get(rep.id);
    const revenue = s ? round2(toNumber(s._sum.total)) : 0;
    const cost = s ? round2(toNumber(s._sum.costTotal)) : 0;
    const target = toNumber(rep.monthlyTarget);
    return {
      salesRepId: rep.id,
      name: rep.user?.name,
      code: rep.code,
      region: rep.region,
      revenue,
      cost,
      profit: round2(revenue - cost),
      orders: s ? s._count : 0,
      commissionOwed: round2(commMap.get(rep.id) || 0),
      monthlyTarget: target,
      attainment: target > 0 ? round2((revenue / target) * 100) : null,
    };
  });

  items.sort((a, b) => b.revenue - a.revenue);
  return { range: { start: range.start, end: range.end, label: range.label }, items };
}

// Gross & net profit. Net subtracts the cost value of shrinkage/damage in the
// window (the only "loss" the system tracks today).
async function profitReport(params = {}) {
  const range = await clampToEpoch(resolveRange(params));

  const [salesAgg, lossRows] = await Promise.all([
    prisma.sale.aggregate({
      where: { ...NON_CANCELLED, soldAt: { gte: range.start, lte: range.end } },
      _sum: { total: true, costTotal: true, discount: true },
      _count: true,
    }),
    prisma.inventoryTransaction.findMany({
      where: {
        type: { in: ['DAMAGE', 'STOCK_COUNT'] },
        baseQuantity: { lt: 0 },
        occurredAt: { gte: range.start, lte: range.end },
      },
      select: { baseQuantity: true, unitCost: true },
    }),
  ]);

  const revenue = round2(toNumber(salesAgg._sum.total));
  const cogs = round2(toNumber(salesAgg._sum.costTotal));
  const grossProfit = round2(revenue - cogs);
  const lossValue = round2(
    lossRows.reduce((s, r) => s + Math.abs(r.baseQuantity) * toNumber(r.unitCost), 0),
  );

  return {
    range: { start: range.start, end: range.end, label: range.label },
    revenue,
    cogs,
    grossProfit,
    grossMargin: revenue > 0 ? round2((grossProfit / revenue) * 100) : 0,
    discounts: round2(toNumber(salesAgg._sum.discount)),
    shrinkageAndDamageValue: lossValue,
    netProfit: round2(grossProfit - lossValue),
    orders: salesAgg._count,
  };
}

// Full profit picture for The Doctor. COGS is computed from each product's
// CURRENT cost price × boxes sold (deterministic, works even for sales recorded
// before cost prices existed). Profit is only counted on actual sales (settled
// boxes create CASH sales) — never on stock requests, transfers or warehouse
// inventory. period: today | week | month | year | all.
// --- Finance epoch -----------------------------------------------------------
// The Finance go-live moment (setting `finance.epochAt`). Revenue, profit and
// money-flow figures count ONLY from this instant — everything before it is
// kept in the database for audit but excluded from financial aggregates.
// Null (unset) = no cutoff. Cached briefly to avoid a query per request.
let _epochCache = { at: 0, value: undefined };
async function financeEpoch() {
  if (Date.now() - _epochCache.at < 60_000 && _epochCache.value !== undefined) return _epochCache.value;
  const row = await prisma.setting.findUnique({ where: { key: 'finance.epochAt' } }).catch(() => null);
  // A bare date like "2026-07-05" is parsed as UTC midnight, which is 03:00
  // in Dar es Salaam — so the first three hours of that business day fell
  // outside the books, and the same setting meant a different instant on a
  // developer's machine than on the server. A date-only value is read as the
  // start of that day in Tanzania; a full timestamp is respected as given.
  const raw = row?.value ? String(row.value).trim() : null;
  const value = !raw
    ? null
    : /^\d{4}-\d{2}-\d{2}$/.test(raw)
      ? new Date(`${raw}T00:00:00+03:00`)
      : new Date(raw);
  _epochCache = { at: Date.now(), value };
  return value;
}

// Clamp a report range to the finance epoch so every revenue/profit figure
// counts only real post-go-live activity. Stock/debt reports are not clamped.
async function clampToEpoch(range) {
  const epoch = await financeEpoch();
  if (!epoch || !range) return range;
  return range.start < epoch ? { ...range, start: epoch } : range;
}

// Accepts a period string ('today'|'week'|'month'|'year'|'all') or an options
// object { period, from, to } for custom date ranges. All ranges are clamped
// to the finance epoch — pre-epoch sales never count toward profit figures.
async function profitOverview(opts = 'month') {
  const o = typeof opts === 'string' ? { period: opts } : opts || {};
  let range = o.start && o.end
    ? resolveRange({ start: o.start, end: o.end })
    : o.from || o.to
      ? resolveRange({ from: o.from, to: o.to })
      : o.period && o.period !== 'all' ? resolveRange({ period: o.period }) : null;
  const epoch = await financeEpoch();
  if (epoch) {
    if (!range) range = { start: epoch, end: new Date() };
    else if (range.start < epoch) range = { ...range, start: epoch };
  }
  const period = o.period || 'custom';
  const where = { sale: { is: { ...NON_CANCELLED } } };
  if (range) where.sale.is.soldAt = { gte: range.start, lte: range.end };

  const [items, products, reps, val] = await Promise.all([
    prisma.saleItem.findMany({
      where,
      select: {
        baseQuantity: true,
        lineTotal: true,
        unitCost: true,
        productId: true,
        sale: {
          select: {
            salesRepId: true,
            discount: true,
            subtotal: true,
            settlementId: true,
            settlement: { select: { issuedAt: true, createdAt: true } },
          },
        },
      },
    }),
    prisma.product.findMany({ select: { id: true, name: true, purchasePrice: true, sellingPrice: true, brand: { select: { id: true, name: true } } } }),
    prisma.salesRepresentative.findMany({ include: { user: { select: { name: true } } } }),
    inventory.valuation(prisma),
  ]);

  const pMap = new Map(products.map((p) => [p.id, p]));
  const repName = new Map(reps.map((r) => [r.id, r.user?.name || r.code]));
  const fin = (o) => {
    const revenue = round2(o.revenue);
    const cost = round2(o.cost);
    const commission = round2(o.commission || 0);
    const profit = round2(revenue - cost);
    return {
      ...o,
      revenue,
      cost,
      profit,
      margin: revenue > 0 ? round2((profit / revenue) * 100) : 0,
      // Reported, never deducted. The owner pays every rep from his own
      // pocket, so commission never comes out of the business's money and has
      // no business reducing what the business made. It is carried here so a
      // screen can say what the boxes earned reps, as information.
      commission,
      // What the business keeps: the money in, less what the boxes cost.
      contribution: profit,
      contributionMargin: revenue > 0 ? round2((profit / revenue) * 100) : 0,
    };
  };

  let revenue = 0;
  let cost = 0;
  let boxes = 0;
  let commissionTotal = 0;
  const byBrand = new Map();
  const byProduct = new Map();
  const byRep = new Map();

  const commission = require('./commission.service');
  for (const it of items) {
    const p = pMap.get(it.productId);
    if (!p) continue;
    // Revenue net of the sale-level discount, allocated to each line by its
    // share of the subtotal. lineTotal alone is pre-discount, so summing it
    // would report money the customer never owed.
    const saleDiscount = toNumber(it.sale?.discount);
    const saleSubtotal = toNumber(it.sale?.subtotal);
    const gross = toNumber(it.lineTotal);
    const rev = saleDiscount > 0 && saleSubtotal > 0
      ? round2(gross - saleDiscount * (gross / saleSubtotal))
      : gross;
    // COGS at the cost frozen when the box sold (SaleItem.unitCost) — the same
    // basis every other report uses. Pricing history at the CURRENT purchase
    // price silently rewrote past profit on every import. Old rows that
    // predate cost capture carry 0 and fall back to today's price.
    const unitCost = toNumber(it.unitCost);
    const c = it.baseQuantity * (unitCost > 0 ? unitCost : toNumber(p.purchasePrice));
    // Commission accrues the moment a box settles, priced by the ORDER's date
    // — so it is a real cost of these very boxes, not of some later payout.
    // Direct warehouse sales have no settlement and no commission.
    const comm = it.sale?.settlementId
      ? it.baseQuantity * (await commission.rateForBrandAt(p.brand?.name, it.sale.settlement?.issuedAt || it.sale.settlement?.createdAt))
      : 0;
    revenue += rev;
    cost += c;
    boxes += it.baseQuantity;
    commissionTotal += comm;

    const bId = p.brand?.id || 'none';
    const b = byBrand.get(bId) || { brandId: bId, name: p.brand?.name || '—', revenue: 0, cost: 0, boxes: 0, commission: 0 };
    b.revenue += rev; b.cost += c; b.boxes += it.baseQuantity; b.commission += comm; byBrand.set(bId, b);

    const pr = byProduct.get(it.productId) || {
      productId: it.productId, name: p.name, brandName: p.brand?.name || '—',
      revenue: 0, cost: 0, boxes: 0, commission: 0,
      catalogueProfitPerBox: toNumber(p.sellingPrice) - toNumber(p.purchasePrice),
    };
    pr.revenue += rev; pr.cost += c; pr.boxes += it.baseQuantity; pr.commission += comm; byProduct.set(it.productId, pr);

    const rid = it.sale?.salesRepId || 'direct';
    const r = byRep.get(rid) || { salesRepId: rid, name: rid === 'direct' ? 'Direct (admin)' : (repName.get(rid) || '—'), revenue: 0, cost: 0, boxes: 0, commission: 0 };
    r.revenue += rev; r.cost += c; r.boxes += it.baseQuantity; r.commission += comm; byRep.set(rid, r);
  }

  return {
    period: period || 'custom',
    // The window the figures actually cover — with an epoch set, "All time"
    // is really "since go-live", and the client must be able to say so.
    range: range ? { start: range.start, end: range.end } : null,
    epochAt: epoch || null,
    totals: { ...fin({ revenue, cost, commission: commissionTotal }), boxes },
    byBrand: [...byBrand.values()].map(fin).sort((a, b) => b.profit - a.profit),
    byProduct: [...byProduct.values()]
      .map((p) => ({
        ...fin(p),
        // Actual money per box in THIS period, not today's catalogue spread —
        // the catalogue figure is returned alongside, labelled as such.
        profitPerBox: p.boxes > 0 ? round2((p.revenue - p.cost) / p.boxes) : 0,
        catalogueProfitPerBox: round2(p.catalogueProfitPerBox),
      }))
      .sort((a, b) => b.profit - a.profit),
    byRep: [...byRep.values()].filter((r) => r.boxes > 0).map(fin).sort((a, b) => b.profit - a.profit),
    inventoryValue: {
      costValue: val.totals.totalValue,
      potentialRevenue: val.totals.retailValue,
      potentialProfit: round2(toNumber(val.totals.retailValue) - toNumber(val.totals.totalValue)),
      units: val.totals.totalBaseUnits,
    },
  };
}

async function inventoryMovementReport(params = {}) {
  const range = resolveRange(params);
  const where = { occurredAt: { gte: range.start, lte: range.end } };
  if (params.productId) where.productId = params.productId;
  if (params.type) where.type = params.type;
  if (params.warehouseId) where.warehouseId = params.warehouseId;
  if (params.salesRepId) where.salesRepId = params.salesRepId;

  const [rows, byType] = await Promise.all([
    prisma.inventoryTransaction.findMany({
      where,
      include: {
        product: { select: { name: true, sku: true, baseUnitName: true } },
        packagingUnit: { select: { name: true } },
        warehouse: { select: { name: true } },
        salesRep: { include: { user: { select: { name: true } } } },
        user: { select: { name: true } },
      },
      orderBy: { occurredAt: 'desc' },
      take: params.limit || 500,
    }),
    prisma.inventoryTransaction.groupBy({
      by: ['type'],
      where,
      _sum: { baseQuantity: true },
      _count: true,
    }),
  ]);

  return {
    range: { start: range.start, end: range.end, label: range.label },
    summaryByType: byType.map((t) => ({
      type: t.type,
      netBase: t._sum.baseQuantity || 0,
      count: t._count,
    })),
    movements: rows.map((r) => ({
      id: r.id,
      occurredAt: r.occurredAt,
      type: r.type,
      product: r.product.name,
      sku: r.product.sku,
      quantity: r.quantity,
      unit: r.packagingUnit?.name,
      baseQuantity: r.baseQuantity,
      location:
        r.locationType === 'WAREHOUSE' ? r.warehouse?.name : r.salesRep?.user?.name,
      user: r.user?.name,
      notes: r.notes,
    })),
  };
}

// Convenience bundle for the debt report screen / export.
async function debtReport() {
  return credit.debtSummary();
}

async function inventoryValuationReport() {
  return inventory.valuation(prisma);
}

module.exports = {
  salesReport,
  productPerformance,
  regionalPerformance,
  salesRepPerformance,
  profitReport,
  profitOverview,
  financeEpoch,
  inventoryMovementReport,
  debtReport,
  inventoryValuationReport,
};
