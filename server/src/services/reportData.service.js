'use strict';

// ===========================================================================
// The extra figures the report PDFs draw (daily, weekly, monthly).
//
// The headline numbers — revenue, cost of goods, gross profit, expenses, net
// profit, money in and out — come from finance.report(), the same call the
// Finance screen and the dashboard read, and are never recomputed here. This
// file only adds the SHAPE around them: sales day by day, expenses by category,
// what the money in and out was made of, who sold what.
//
// Every query uses the definition the dashboard already uses (a sale line's
// lineTotal, its unitCost x boxes, cancelled sales left out, days on the
// Tanzanian clock), so a column in a PDF chart adds up to the revenue figure
// printed above it. Nothing here writes to the database.
// ===========================================================================

const prisma = require('../config/prisma');
const finance = require('./finance.service');
const reports = require('./reports.service');
const { dayjs } = require('../utils/dates');

const num = (v) => Number(v) || 0;
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
// A sale's day is the business's day (EAT, UTC+3), never the server's.
const eatDayKey = (d) => new Date(new Date(d).getTime() + 3 * 3600 * 1000).toISOString().slice(0, 10);

const KIND_LABEL = {
  SETTLEMENT: 'Settlements from reps',
  WAREHOUSE_SALE: 'Counter (warehouse) sales',
  INCOME: 'Other income',
  EXPENSE: 'Business expenses',
  STOCK_PURCHASE: 'Stock bought from suppliers',
  ADJUSTMENT: 'Adjustments',
};
const kindLabel = (t) => KIND_LABEL[t] || String(t || 'Other').replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());

const ACTIVE_SALE = { status: { not: 'CANCELLED' } };

/** Revenue, gross profit and boxes for every EAT day from `start` to `end` (empty days are zeros). */
async function salesByDay(start, end) {
  const items = await prisma.saleItem.findMany({
    where: { sale: { is: { ...ACTIVE_SALE, soldAt: { gte: start, lte: end } } } },
    select: { baseQuantity: true, lineTotal: true, unitCost: true, sale: { select: { soldAt: true } } },
  });
  const byDay = new Map();
  for (const it of items) {
    const k = eatDayKey(it.sale.soldAt);
    const row = byDay.get(k) || { revenue: 0, profit: 0, boxes: 0 };
    const rev = num(it.lineTotal);
    row.revenue += rev;
    row.profit += rev - num(it.unitCost) * (it.baseQuantity || 0);
    row.boxes += it.baseQuantity || 0;
    byDay.set(k, row);
  }
  const out = [];
  const last = eatDayKey(end);
  for (let d = dayjs.utc(eatDayKey(start)); d.format('YYYY-MM-DD') <= last; d = d.add(1, 'day')) {
    const k = d.format('YYYY-MM-DD');
    const row = byDay.get(k) || { revenue: 0, profit: 0, boxes: 0 };
    out.push({
      date: k,
      day: d.format('D'),
      short: d.format('ddd'),
      long: d.format('dddd D MMM'),
      revenue: round2(row.revenue),
      profit: round2(row.profit),
      boxes: row.boxes,
    });
  }
  return out;
}

/** Expenses (type EXPENSE, money out) by their category, clamped to the go-live date like finance.report(). */
async function expensesByCategory(start, end) {
  const epoch = await reports.financeEpoch();
  const from = epoch && epoch > start ? epoch : start;
  if (epoch && end < epoch) return [];
  const rows = await prisma.financeTransaction.groupBy({
    by: ['category'],
    where: { direction: 'OUT', type: 'EXPENSE', occurredAt: { gte: from, lte: end } },
    _sum: { amount: true },
    _count: true,
  });
  return rows
    .map((r) => ({ category: r.category || 'Uncategorised', amount: round2(num(r._sum.amount)), count: r._count }))
    .filter((r) => r.amount !== 0)
    .sort((a, b) => b.amount - a.amount);
}

/** Who sold what in the window: revenue, boxes and number of orders per sales rep. */
async function repLeaderboard(start, end) {
  const [items, reps] = await Promise.all([
    prisma.saleItem.findMany({
      where: { sale: { is: { ...ACTIVE_SALE, soldAt: { gte: start, lte: end }, salesRepId: { not: null } } } },
      select: { baseQuantity: true, lineTotal: true, saleId: true, sale: { select: { salesRepId: true } } },
    }).catch(() => []),
    prisma.salesRepresentative.findMany({ include: { user: { select: { name: true } } } }).catch(() => []),
  ]);
  const name = new Map(reps.map((r) => [r.id, r.user?.name || r.code]));
  const per = new Map();
  for (const it of items) {
    const id = it.sale.salesRepId;
    const row = per.get(id) || { id, name: name.get(id) || 'Rep', revenue: 0, boxes: 0, sales: new Set() };
    row.revenue += num(it.lineTotal);
    row.boxes += it.baseQuantity || 0;
    row.sales.add(it.saleId);
    per.set(id, row);
  }
  return [...per.values()]
    .map((r) => ({ id: r.id, name: r.name, revenue: round2(r.revenue), boxes: r.boxes, orders: r.sales.size }))
    .sort((a, b) => b.revenue - a.revenue);
}

/** What the money in and out was MADE of, by kind (transfers, owner money and commission records excluded, as in finance). */
function splitKinds(byType) {
  const pick = (dir) => (byType || [])
    .filter((r) => r.direction === dir && r.amount !== 0)
    .map((r) => ({ type: r.type, label: kindLabel(r.type), amount: r.amount, count: r.count }))
    .sort((a, b) => b.amount - a.amount);
  return { moneyInKinds: pick('IN'), moneyOutKinds: pick('OUT') };
}

/**
 * Everything beyond the headline report for one window.
 *   range:  { start, end }            real instants (Dates)
 *   prior:  { start, end } | null     the window just before, for the arrows
 *   opts.prevReport: that window's finance.report(), when the caller already has it
 *   opts.cashflow:   this window's finance.cashflow({start,end}), likewise
 */
async function periodExtras(range, prior, { dayWindow, prevReport, cashflow } = {}) {
  // cashflow() is awaited once: it carries the by-kind split AND the account statement.
  const [days, cats, cf, orders, board, prev] = await Promise.all([
    salesByDay(dayWindow?.start || range.start, dayWindow?.end || range.end),
    expensesByCategory(range.start, range.end),
    cashflow || finance.cashflow({ start: range.start, end: range.end }),
    prisma.sale.count({ where: { ...ACTIVE_SALE, soldAt: { gte: range.start, lte: range.end } } }).catch(() => 0),
    repLeaderboard(range.start, range.end),
    prevReport || (prior ? finance.report({ start: prior.start, end: prior.end }).catch(() => null) : Promise.resolve(null)),
  ]);
  const cashStatement = {
    opening: cf.openingBalance,
    moneyIn: cf.moneyIn,
    moneyOut: cf.moneyOut,
    ownerNet: cf.ownerNet,
    closing: cf.closingBalance,
  };
  return {
    byDay: days,
    expensesByCategory: cats,
    ...splitKinds(cf.byType),
    cashStatement,
    orders,
    reps: board,
    prev: prev && {
      revenue: prev.revenue,
      grossProfit: prev.grossProfit,
      expenses: prev.expenses,
      netProfit: prev.netProfit,
      boxesSold: prev.boxesSold,
      moneyIn: prev.cashFlow.moneyIn,
      moneyOut: prev.cashFlow.moneyOut,
    },
  };
}

/** The stock block every report prints, from inventory.valuation() and reorder.lowStock(). */
function stockBlock(val, low) {
  return {
    costValue: val.totals.totalValue,
    retailValue: val.totals.retailValue,
    potential: round2(val.totals.retailValue - val.totals.totalValue),
    units: val.totals.totalBaseUnits,
    warehouseBoxes: val.items.reduce((s, i) => s + i.warehouseBase, 0),
    repBoxes: val.items.reduce((s, i) => s + i.repBase, 0),
    lowCount: low.length,
    outOfStock: val.items.filter((i) => i.totalBase <= 0).length,
  };
}

module.exports = { stockBlock, salesByDay, expensesByCategory, repLeaderboard, splitKinds, periodExtras, kindLabel, eatDayKey };
