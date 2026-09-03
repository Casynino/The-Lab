'use strict';

const prisma = require('../config/prisma');
const inventory = require('./inventory.service');
const credit = require('./credit.service');
const reports = require('./reports.service');
const reorder = require('./reorder.service');
const stockCount = require('./stockCount.service');
const settlement = require('./settlement.service');
const { toNumber, round2 } = require('../utils/money');
const { resolveRange } = require('../utils/dates');

async function periodSales(period) {
  const r = await reports.salesReport({ period });
  return { revenue: r.totals.revenue, profit: r.totals.grossProfit, orders: r.totals.orders };
}

// Money windows on the dashboard start at the finance epoch — pre-go-live
// activity stays in the database but never counts as money.
async function epochRange(period) {
  const range = resolveRange({ period });
  const epoch = await reports.financeEpoch();
  if (epoch && range.start < epoch) return { ...range, start: epoch };
  return range;
}

async function paymentsCollected(period) {
  const range = await epochRange(period);
  const [credits, cash] = await Promise.all([
    prisma.creditPayment.aggregate({
      where: { paidAt: { gte: range.start, lte: range.end } },
      _sum: { amount: true },
    }),
    prisma.sale.aggregate({
      where: { type: 'CASH', status: { not: 'CANCELLED' }, soldAt: { gte: range.start, lte: range.end } },
      _sum: { amountPaid: true },
    }),
  ]);
  return {
    creditPayments: round2(toNumber(credits._sum.amount)),
    cashCollected: round2(toNumber(cash._sum.amountPaid)),
    total: round2(toNumber(credits._sum.amount) + toNumber(cash._sum.amountPaid)),
  };
}

// Reps still holding stock — "outstanding salesperson stock" alert source.
async function outstandingRepStock() {
  const rows = await inventory.repBalances(prisma);
  const positive = rows.filter((r) => r.baseQuantity > 0);
  const byRep = new Map();
  positive.forEach((r) => byRep.set(r.salesRepId, (byRep.get(r.salesRepId) || 0) + r.baseQuantity));

  const reps = await prisma.salesRepresentative.findMany({
    where: { id: { in: [...byRep.keys()] } },
    include: { user: { select: { name: true } } },
  });
  return reps
    .map((rep) => ({
      salesRepId: rep.id,
      name: rep.user?.name,
      code: rep.code,
      region: rep.region,
      heldBaseUnits: byRep.get(rep.id) || 0,
    }))
    .sort((a, b) => b.heldBaseUnits - a.heldBaseUnits);
}

async function recentActivity(limit = 12) {
  const rows = await prisma.inventoryTransaction.findMany({
    take: limit,
    orderBy: { createdAt: 'desc' },
    include: {
      product: { select: { name: true } },
      packagingUnit: { select: { name: true } },
      warehouse: { select: { name: true } },
      salesRep: { include: { user: { select: { name: true } } } },
      user: { select: { name: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    product: r.product.name,
    quantity: r.quantity,
    unit: r.packagingUnit?.name,
    baseQuantity: r.baseQuantity,
    location: r.locationType === 'WAREHOUSE' ? r.warehouse?.name : r.salesRep?.user?.name,
    by: r.user?.name,
    at: r.createdAt,
    notes: r.notes,
  }));
}

// One call powering the whole admin dashboard.
async function overview() {
  const [
    valuation,
    daily,
    weekly,
    monthly,
    debt,
    collected,
    profit,
    performance,
    regional,
    reorderData,
    low,
    missing,
    repStock,
    activity,
    counts,
    settlements,
  ] = await Promise.all([
    inventory.valuation(prisma),
    periodSales('today'),
    periodSales('week'),
    periodSales('month'),
    credit.debtSummary(),
    paymentsCollected('month'),
    reports.profitOverview('month'),
    reports.productPerformance({ period: 'month', limit: 5 }),
    reports.regionalPerformance({ period: 'month' }),
    reorder.reorderAnalysis(),
    reorder.lowStock(),
    stockCount.missingStockReport({}),
    outstandingRepStock(),
    recentActivity(12),
    prisma.$transaction([
      prisma.product.count({ where: { isActive: true } }),
      prisma.customer.count({ where: { isActive: true } }),
      prisma.salesRepresentative.count({ where: { isActive: true } }),
      prisma.warehouse.count({ where: { isActive: true } }),
    ]),
    settlement.summary(),
  ]);

  return {
    inventory: {
      totalValue: valuation.totals.totalValue,
      warehouseValue: valuation.totals.warehouseValue,
      repValue: valuation.totals.repValue,
      retailValue: valuation.totals.retailValue,
      totalBaseUnits: valuation.totals.totalBaseUnits,
      productCount: valuation.totals.productCount,
    },
    sales: { daily, weekly, monthly },
    profit: {
      grossProfit: profit.totals.profit,
      netProfit: profit.totals.profit,
      grossMargin: profit.totals.margin,
      revenue: profit.totals.revenue,
    },
    debt: {
      totalOutstanding: debt.totalOutstanding,
      overdueAmount: debt.overdueAmount,
      overdueAccounts: debt.overdueAccounts,
      openAccounts: debt.openAccounts,
      topDebtors: debt.topDebtors.slice(0, 5),
    },
    paymentsCollected: collected,
    topSelling: performance.topSelling,
    slowMoving: performance.slowMoving,
    regional: regional.items,
    alerts: {
      lowStock: { count: low.length, items: low.slice(0, 8) },
      reorder: {
        count: reorderData.summary.reorderCount,
        critical: reorderData.summary.criticalCount,
        items: reorderData.recommendations.slice(0, 8),
      },
      missingStock: { count: missing.totals.count, value: missing.totals.totalValue, items: missing.items.slice(0, 8) },
      outstandingRepStock: { count: repStock.length, items: repStock.slice(0, 8) },
      overdueDebts: { count: debt.overdueAccounts, amount: debt.overdueAmount },
      settlements: {
        outstanding: settlements.outstandingCount,
        approaching: settlements.approachingCount,
        overdue: settlements.overdueCount,
        overdueValue: settlements.overdueValue,
        items: settlements.items,
      },
    },
    counts: {
      products: counts[0],
      customers: counts[1],
      salesReps: counts[2],
      warehouses: counts[3],
    },
    recentActivity: activity,
  };
}

// Per-brand split (OHIS vs CIVILLY): stock on hand + this month's/today's sales.
// Everything is grouped by the product's brand, so no brand is ever mixed.
async function brandBreakdown() {
  const month = await epochRange('month');
  const today = await epochRange('today');
  const [brands, products, val, monthItems, todayItems] = await Promise.all([
    prisma.brand.findMany({ where: { isActive: true }, select: { id: true, name: true } }),
    prisma.product.findMany({ select: { id: true, brandId: true, purchasePrice: true } }),
    inventory.valuation(prisma),
    prisma.saleItem.groupBy({ by: ['productId'], where: { sale: { status: { not: 'CANCELLED' }, soldAt: { gte: month.start, lte: month.end } } }, _sum: { lineTotal: true, baseQuantity: true } }),
    prisma.saleItem.groupBy({ by: ['productId'], where: { sale: { status: { not: 'CANCELLED' }, soldAt: { gte: today.start, lte: today.end } } }, _sum: { lineTotal: true } }),
  ]);

  const brandOf = new Map(products.map((p) => [p.id, p.brandId]));
  const costOf = new Map(products.map((p) => [p.id, toNumber(p.purchasePrice)]));
  const mk = (b) => ({ brandId: b.id, name: b.name, stockValue: 0, stockUnits: 0, warehouseUnits: 0, salesMonth: 0, costMonth: 0, unitsSoldMonth: 0, salesToday: 0 });
  const byBrand = new Map(brands.map((b) => [b.id, mk(b)]));

  for (const it of val.items) {
    const b = byBrand.get(brandOf.get(it.productId));
    if (!b) continue;
    b.stockValue += it.costValue;
    b.stockUnits += it.totalBase;
    b.warehouseUnits += it.warehouseBase;
  }
  for (const r of monthItems) {
    const b = byBrand.get(brandOf.get(r.productId));
    if (!b) continue;
    b.salesMonth += toNumber(r._sum.lineTotal);
    b.costMonth += (r._sum.baseQuantity || 0) * (costOf.get(r.productId) || 0);
    b.unitsSoldMonth += r._sum.baseQuantity || 0;
  }
  for (const r of todayItems) {
    const b = byBrand.get(brandOf.get(r.productId));
    if (!b) continue;
    b.salesToday += toNumber(r._sum.lineTotal);
  }

  const items = [...byBrand.values()]
    .map((b) => {
      const profitMonth = round2(b.salesMonth - b.costMonth);
      return {
        ...b,
        stockValue: round2(b.stockValue),
        salesMonth: round2(b.salesMonth),
        salesToday: round2(b.salesToday),
        profitMonth,
        marginMonth: b.salesMonth > 0 ? round2((profitMonth / b.salesMonth) * 100) : 0,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  const sum = (k) => round2(items.reduce((t, b) => t + b[k], 0));
  return {
    brands: items,
    totals: { stockValue: sum('stockValue'), stockUnits: items.reduce((t, b) => t + b.stockUnits, 0), salesMonth: sum('salesMonth'), salesToday: sum('salesToday'), profitMonth: sum('profitMonth') },
  };
}

// ── Chart series for the dashboard ───────────────────────────────────────────
// The dashboard reported totals and nothing else, so it could say what today
// was worth but never whether that was good. These give the numbers a shape:
// where the money has been going, and which brand, region, rep and product
// carry it.

const eatDayKey = (d) => new Date(new Date(d).getTime() + 3 * 3600 * 1000).toISOString().slice(0, 10);

// Revenue, gross profit and boxes per day. Empty days are emitted as zeros — a
// gap in a line reads as missing data rather than as a quiet day, and a quiet
// day is itself the thing worth seeing.
async function dailySeries(days = 30) {
  const to = new Date();
  const from = new Date(to.getTime() - (days - 1) * 86400000);
  const items = await prisma.saleItem.findMany({
    where: { sale: { is: { status: { not: 'CANCELLED' }, soldAt: { gte: from, lte: to } } } },
    select: { baseQuantity: true, lineTotal: true, unitCost: true, sale: { select: { soldAt: true } } },
  });

  const byDay = new Map();
  for (const it of items) {
    const k = eatDayKey(it.sale.soldAt);
    const row = byDay.get(k) || { revenue: 0, profit: 0, boxes: 0 };
    const rev = toNumber(it.lineTotal);
    row.revenue += rev;
    row.profit += rev - toNumber(it.unitCost) * (it.baseQuantity || 0);
    row.boxes += it.baseQuantity || 0;
    byDay.set(k, row);
  }

  const out = [];
  const cur = new Date(from);
  for (let i = 0; i < days; i += 1) {
    const k = eatDayKey(cur);
    const row = byDay.get(k) || { revenue: 0, profit: 0, boxes: 0 };
    out.push({ date: k, revenue: round2(row.revenue), profit: round2(row.profit), boxes: row.boxes });
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

// "Which region is doing best" — a question only answerable now that regions
// come from a fixed list instead of free text.
async function revenueByRegion(range) {
  const rows = await prisma.sale.groupBy({
    by: ['region'],
    where: { status: { not: 'CANCELLED' }, soldAt: { gte: range.start, lte: range.end } },
    _sum: { total: true },
  });
  return rows
    .map((r) => ({ name: r.region || 'Unassigned', value: round2(toNumber(r._sum.total)) }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value);
}

async function revenueByRep(range) {
  const rows = await prisma.sale.groupBy({
    by: ['salesRepId'],
    where: { status: { not: 'CANCELLED' }, salesRepId: { not: null }, soldAt: { gte: range.start, lte: range.end } },
    _sum: { total: true },
  });
  if (!rows.length) return [];
  const reps = await prisma.salesRepresentative.findMany({
    where: { id: { in: rows.map((r) => r.salesRepId) } },
    include: { user: { select: { name: true } } },
  });
  const m = new Map(reps.map((r) => [r.id, r]));
  return rows
    .map((r) => ({
      name: m.get(r.salesRepId)?.user?.name || m.get(r.salesRepId)?.code || 'Rep',
      region: m.get(r.salesRepId)?.region || null,
      value: round2(toNumber(r._sum.total)),
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);
}

async function topProductsByRevenue(range, limit = 6) {
  const rows = await prisma.saleItem.groupBy({
    by: ['productId'],
    where: { sale: { is: { status: { not: 'CANCELLED' }, soldAt: { gte: range.start, lte: range.end } } } },
    _sum: { lineTotal: true, baseQuantity: true },
  });
  if (!rows.length) return [];
  const prods = await prisma.product.findMany({
    where: { id: { in: rows.map((r) => r.productId) } },
    select: { id: true, name: true },
  });
  const m = new Map(prods.map((x) => [x.id, x.name]));
  return rows
    .map((r) => ({ name: m.get(r.productId) || 'Product', value: round2(toNumber(r._sum.lineTotal)), boxes: r._sum.baseQuantity || 0 }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

// ── Command center ───────────────────────────────────────────────────────────
// One composed payload for the admin dashboard: where the money is, today's
// business (all from Finance), per-brand performance, rep performance, what
// needs attention, and the inventory picture. Every figure derives from the
// same Finance/epoch sources, so the dashboard can never disagree with Finance.
async function command() {
  const finance = require('./finance.service'); // lazy: avoids import cycles
  const reorderSvc = require('./reorder.service');
  const commission = require('./commission.service');

  const todayR = await epochRange('today');
  const monthR = await epochRange('month');

  // Chart data, gathered in parallel with the rest and never allowed to break
  // the dashboard: an empty chart is a far better failure than a blank page.
  const chartsPromise = Promise.all([
    dailySeries(30).catch(() => []),
    revenueByRegion(monthR).catch(() => []),
    revenueByRep(monthR).catch(() => []),
    topProductsByRevenue(monthR).catch(() => []),
  ]).then(([daily, byRegion, byRep, topProducts]) => ({ daily, byRegion, byRep, topProducts }));

  const [fin, profMonth, bd, stl, low, val, repsRows, repBal, commAll, supplierRows, products, pendCounts, pendingWithdrawals, salesTodayRows, salesMonthRows, activeStl, retTodayAgg, retSubmittedToday, retSubmittedTodayBoxes] = await Promise.all([
    finance.overview('today'),
    reports.profitOverview('month'),
    brandBreakdown(),
    settlement.summary(),
    reorderSvc.lowStock(),
    inventory.valuation(prisma),
    prisma.salesRepresentative.findMany({ where: { isActive: true }, include: { user: { select: { name: true } } } }),
    inventory.repBalances(prisma),
    commission.summaryAllReps(),
    finance.supplierSummaries(),
    prisma.product.findMany({ where: { isActive: true }, select: { id: true, brandId: true } }),
    prisma.$transaction([
      prisma.stockRequest.count({ where: { status: 'PENDING' } }),
      prisma.settlementSubmission.count({ where: { status: 'PENDING' } }),
      prisma.return.count({ where: { status: 'PENDING' } }),
    ]),
    prisma.commissionWithdrawal.findMany({
      where: { status: 'PENDING' },
      include: { salesRep: { select: { id: true, code: true, user: { select: { name: true } } } } },
      orderBy: { requestedAt: 'asc' },
    }),
    prisma.sale.groupBy({ by: ['salesRepId'], where: { status: { not: 'CANCELLED' }, soldAt: { gte: todayR.start, lte: todayR.end }, salesRepId: { not: null } }, _sum: { total: true } }),
    prisma.sale.groupBy({ by: ['salesRepId'], where: { status: { not: 'CANCELLED' }, soldAt: { gte: monthR.start, lte: monthR.end }, salesRepId: { not: null } }, _sum: { total: true } }),
    prisma.settlement.findMany({ where: { status: { in: ['OPEN', 'PARTIAL', 'OVERDUE'] } }, select: { salesRepId: true, deadlineAt: true } }),
    prisma.returnItem.aggregate({
      where: { return: { is: { status: { in: ['APPROVED', 'COMPLETED'] }, decidedAt: { gte: todayR.start, lte: todayR.end } } } },
      _sum: { baseQuantity: true },
    }),
    prisma.return.count({ where: { createdAt: { gte: todayR.start, lte: todayR.end } } }),
    prisma.returnItem.aggregate({
      where: { return: { is: { createdAt: { gte: todayR.start, lte: todayR.end } } } },
      _sum: { quantity: true },
    }),
  ]);

  // ── Brands: month P&L + stock split + top product ──
  const brandOf = new Map(products.map((p) => [p.id, p.brandId]));
  const topByBrand = new Map();
  for (const pr of profMonth.byProduct) {
    const b = brandOf.get(pr.productId);
    if (!b) continue;
    const cur = topByBrand.get(b);
    if (!cur || pr.revenue > cur.revenue) topByBrand.set(b, { name: pr.name, revenue: pr.revenue, boxes: pr.boxes });
  }
  const profBrand = new Map(profMonth.byBrand.map((b) => [b.brandId, b]));
  const brands = bd.brands.map((b) => {
    const pm = profBrand.get(b.brandId) || { revenue: 0, profit: 0, margin: 0, boxes: 0 };
    return {
      brandId: b.brandId,
      name: b.name,
      revenueMonth: pm.revenue,
      grossProfitMonth: pm.profit,
      marginMonth: pm.margin,
      boxesSoldMonth: pm.boxes,
      inventoryValue: b.stockValue,
      warehouseBoxes: b.warehouseUnits,
      repBoxes: b.stockUnits - b.warehouseUnits,
      topProduct: topByBrand.get(b.brandId) || null,
    };
  });

  // ── Reps: boxes held, sales today/month, commission, order status ──
  const heldByRep = new Map();
  repBal.forEach((r) => { if (r.baseQuantity > 0) heldByRep.set(r.salesRepId, (heldByRep.get(r.salesRepId) || 0) + r.baseQuantity); });
  const sToday = new Map(salesTodayRows.map((r) => [r.salesRepId, toNumber(r._sum.total)]));
  const sMonth = new Map(salesMonthRows.map((r) => [r.salesRepId, toNumber(r._sum.total)]));
  const commByRep = new Map(commAll.items.map((c) => [c.salesRepId, c]));
  const stlByRep = new Map();
  const now = Date.now();
  for (const x of activeStl) {
    const cur = stlByRep.get(x.salesRepId) || { active: 0, overdue: 0 };
    cur.active += 1;
    if (new Date(x.deadlineAt).getTime() < now) cur.overdue += 1;
    stlByRep.set(x.salesRepId, cur);
  }
  const reps = repsRows
    .map((r) => {
      const c = commByRep.get(r.id) || {};
      const st = stlByRep.get(r.id) || { active: 0, overdue: 0 };
      return {
        salesRepId: r.id,
        name: r.user?.name || r.code,
        code: r.code,
        boxesHeld: heldByRep.get(r.id) || 0,
        salesToday: round2(sToday.get(r.id) || 0),
        salesMonth: round2(sMonth.get(r.id) || 0),
        commissionAvailable: round2(c.available || 0),
        activeOrders: st.active,
        overdueOrders: st.overdue,
      };
    })
    .sort((a, b) => b.salesMonth - a.salesMonth);

  // ── Attention ──
  const onHandTotals = new Map();
  val.items.forEach((it) => onHandTotals.set(it.productId, it.totalBase));
  const outOfStock = products.filter((p) => (onHandTotals.get(p.id) || 0) <= 0).length;
  const supplierDue = round2(supplierRows.reduce((x, sup) => x + sup.outstanding, 0));

  // ── Inventory split ──
  const warehouseBoxes = val.items.reduce((x, it) => x + it.warehouseBase, 0);
  const repBoxes = val.items.reduce((x, it) => x + it.repBase, 0);

  const charts = await chartsPromise;

  return {
    accounts: fin.accounts,
    totalFunds: fin.cashPosition,
    today: {
      revenue: fin.revenue,
      grossProfit: fin.grossProfit,
      expenses: fin.expenses,
      netProfit: fin.netProfit,
      moneyIn: fin.flow.today.moneyIn,
      moneyOut: fin.flow.today.moneyOut,
      netCash: fin.flow.today.net,
      boxesSold: fin.boxesSold ?? 0,
    },
    month: { revenue: profMonth.totals.revenue, grossProfit: profMonth.totals.profit, boxes: profMonth.totals.boxes },
    brands,
    reps,
    attention: {
      stockRequests: pendCounts[0],
      settlements: pendCounts[1],
      returns: pendCounts[2],
      returnsToday: retSubmittedToday,
      returnsTodayBoxes: retSubmittedTodayBoxes._sum.quantity || 0,
      overdueSettlements: stl.overdueCount,
      overdueValue: stl.overdueValue,
      lowStock: { count: low.length, items: low.slice(0, 5).map((l) => ({ name: l.name, onHand: l.onHand })) },
      outOfStock,
      supplierDue,
      commissionRequests: {
        count: pendingWithdrawals.length,
        total: round2(pendingWithdrawals.reduce((n, w) => n + toNumber(w.amount), 0)),
        items: pendingWithdrawals.map((w) => {
          const bal = (commAll.items || []).find((c) => c.salesRepId === w.salesRepId);
          return {
            id: w.id,
            salesRepId: w.salesRepId,
            repName: w.salesRep?.user?.name || w.salesRep?.code || 'Rep',
            repCode: w.salesRep?.code || null,
            amount: round2(toNumber(w.amount)),
            // Where the rep asked for it to go — name, number and method.
            payTo: w.notes || null,
            requestedAt: w.requestedAt,
            // What they have earned and what is left after this request, so the
            // decision does not need a second screen.
            available: bal ? round2(toNumber(bal.available)) : null,
            earned: bal ? round2(toNumber(bal.earned)) : null,
          };
        }),
      },
    },
    inventory: {
      costValue: val.totals.totalValue,
      sellingValue: val.totals.retailValue,
      units: val.totals.totalBaseUnits,
      warehouseBoxes,
      repBoxes,
      returnedToday: retTodayAgg._sum.baseQuantity || 0,
    },
    // The shape behind the totals. Everything here is scoped to the same month
    // range the rest of the payload uses, except the trend, which is a rolling
    // 30 days so the line does not restart on the 1st.
    charts,
  };
}

module.exports = { overview, recentActivity, outstandingRepStock, paymentsCollected, brandBreakdown, command };
