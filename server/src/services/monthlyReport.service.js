'use strict';

// ===========================================================================
// MONTHLY BUSINESS REPORT — full financial report for a completed month.
//
// Sent on the 1st of each month at 08:00 Tanzania time, always covering the
// ENTIRE previous month (never partial data). The PDF is archived permanently
// and the WhatsApp message carries an executive summary + the archived link.
// ===========================================================================

const prisma = require('../config/prisma');
const finance = require('./finance.service');
const reports = require('./reports.service');
const reorder = require('./reorder.service');
const inventorySvc = require('./inventory.service');
const reportData = require('./reportData.service');
const { dayjs, eatNow, eatRange } = require('../utils/dates');

const fmt = (n) => `TSh ${Math.round(Number(n) || 0).toLocaleString('en-US')}`;
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const pct = (cur, prev) => (prev > 0 ? Math.round(((cur - prev) / prev) * 1000) / 10 : null);

// The month a report covers: a 'YYYY-MM' key pins an exact month; otherwise
// the previous completed EAT month (the report always looks back).
function reportMonth(monthKey) {
  let anchor;
  const m = monthKey ? /^(\d{4})-(\d{2})$/.exec(monthKey) : null;
  if (m) anchor = dayjs.utc(`${monthKey}-15`).add(3, 'hour');
  else anchor = eatNow().subtract(1, 'month');
  return eatRange('month', anchor);
}

const monthKeyOf = (eatStart) => eatStart.format('YYYY-MM');

// Whole-business stock (boxes) as of an instant, from the movement ledger.
// Transfers post both sides, so summing every delta nets internal moves out.
async function stockBoxesAt(when) {
  const agg = await prisma.inventoryTransaction.aggregate({
    where: { occurredAt: { lte: when } },
    _sum: { baseQuantity: true },
  });
  return agg._sum.baseQuantity || 0;
}

async function buildMonthlyData(monthKey) {
  const { start, end, eatStart } = reportMonth(monthKey);
  const prev = eatRange('month', eatStart.subtract(1, 'month'));

  const [rep, prof, prevRep, cf, accounts, low, movementRows, pending, stlSummary, suppliers, val] = await Promise.all([
    finance.report({ start, end }),
    reports.profitOverview({ start, end }),
    finance.report({ start: prev.start, end: prev.end }),
    finance.cashflow({ start, end }),
    finance.accountBalances(),
    reorder.lowStock(),
    prisma.inventoryTransaction.groupBy({
      by: ['type'],
      where: { occurredAt: { gte: start, lte: end } },
      _sum: { baseQuantity: true },
    }).catch(() => []),
    prisma.$transaction([
      prisma.stockRequest.count({ where: { status: 'PENDING' } }),
      prisma.settlementSubmission.count({ where: { status: 'PENDING' } }),
      prisma.return.count({ where: { status: 'PENDING' } }),
    ]),
    require('./settlement.service').summary(),
    finance.supplierSummaries(),
    inventorySvc.valuation(prisma),
  ]);

  // Sales day by day, expenses by category, what the money was made of, who sold what — and the
  // month before (already read above) for the arrows.
  const extras = await reportData.periodExtras({ start, end }, null, { prevReport: prevRep, cashflow: cf });

  // Commission per rep for the month.
  const [paidRows, commissionAll] = await Promise.all([
    prisma.commissionWithdrawal.groupBy({
      by: ['salesRepId'],
      where: { status: { in: ['APPROVED', 'PAID'] }, decidedAt: { gte: start, lte: end } },
      _sum: { amount: true },
    }).catch(() => []),
    require('./commission.service').summaryAllReps().catch(() => ({ items: [] })),
  ]);

  let earnedByRep = new Map();
  let earnedTotal = 0;
  try {
    const earned = await require('./commission.service').earnedBetween(start, end);
    earnedByRep = earned.byRep;
    earnedTotal = earned.total;
  } catch { /* no rule */ }

  const paidByRep = new Map(paidRows.map((r) => [r.salesRepId, Number(r._sum.amount) || 0]));
  const outstandingByRep = new Map((commissionAll.items || []).map((r) => [r.salesRepId, Number(r.available) || 0]));
  const repPerformance = extras.reps.map((r) => ({
    ...r,
    commissionEarned: round2(earnedByRep.get(r.id) || 0),
    commissionPaid: paidByRep.get(r.id) || 0,
    outstanding: outstandingByRep.get(r.id) ?? null,
  }));

  // Inventory summary: opening/closing from the ledger + monthly movement.
  const mv = new Map(movementRows.map((mrow) => [mrow.type, mrow._sum.baseQuantity || 0]));
  const closingBoxes = await stockBoxesAt(end);
  const netMove = movementRows.reduce((s, mrow) => s + (mrow._sum.baseQuantity || 0), 0);
  const inventory = {
    openingBoxes: closingBoxes - netMove,
    closingBoxes,
    stockInBoxes: mv.get('STOCK_IN') || 0,
    purchasedBoxes: mv.get('PURCHASE_RECEIPT') || 0,
    soldBoxes: -((mv.get('CASH_SALE') || 0) + (mv.get('CREDIT_SALE') || 0)),
    returnedBoxes: mv.get('CUSTOMER_RETURN') || 0,
    adjustedBoxes: (mv.get('ADJUSTMENT') || 0) + (mv.get('CORRECTION') || 0) + (mv.get('STOCK_COUNT') || 0) + (mv.get('DAMAGE') || 0),
  };

  const supplierDue = suppliers.reduce((s, x) => s + x.outstanding, 0);
  const cashPosition = accounts.reduce((s, a) => s + a.balance, 0);
  const days = eatStart.daysInMonth();

  const attention = [];
  if (pending[0]) attention.push(`${pending[0]} stock request(s) waiting for approval`);
  if (pending[1]) attention.push(`${pending[1]} settlement(s) waiting for approval`);
  if (pending[2]) attention.push(`${pending[2]} return(s) waiting for approval`);
  if (stlSummary.overdueCount) attention.push(`${stlSummary.overdueCount} order(s) OVERDUE worth ${fmt(stlSummary.overdueValue)}`);
  if (low.length) attention.push(`${low.length} product(s) low on stock`);
  if (supplierDue > 0) attention.push(`Owed to suppliers: ${fmt(supplierDue)}`);

  return {
    period: {
      start: eatStart,
      label: eatStart.format('MMMM YYYY'),
      monthKey: monthKeyOf(eatStart),
      from: start,
      to: end,
    },
    generatedAt: eatNow().format('D MMM YYYY, HH:mm') + ' EAT',
    number: `ZL-${monthKeyOf(eatStart)}`,
    prevLabel: prev.eatStart.format('MMMM YYYY'),
    extras,
    finance: {
      revenue: rep.revenue,
      cogs: rep.cogs,
      grossProfit: rep.grossProfit,
      expenses: rep.expenses,
      netProfit: rep.netProfit,
      moneyIn: rep.cashFlow.moneyIn,
      moneyOut: rep.cashFlow.moneyOut,
      netCash: rep.cashFlow.net,
      boxesSold: rep.boxesSold,
      supplierPayments: rep.supplierPayments || 0,
      closingBalance: cf.closingBalance,
    },
    growth: {
      revenuePct: pct(rep.revenue, prevRep.revenue),
      netProfitPct: pct(rep.netProfit, prevRep.netProfit),
      prevRevenue: prevRep.revenue,
      prevNetProfit: prevRep.netProfit,
      prevLabel: prev.eatStart.format('MMMM YYYY'),
    },
    accounts: accounts.map((a) => ({ name: a.name, balance: a.balance })),
    cashPosition,
    brands: (prof.byBrand || []).map((b) => ({
      name: b.name, revenue: b.revenue, cost: b.cost, profit: b.profit, margin: b.margin, boxes: b.boxes,
    })),
    topProducts: (prof.byProduct || []).slice(0, 8).map((p) => ({ name: p.name, revenue: p.revenue, boxes: p.boxes })),
    repPerformance,
    inventory,
    movement: inventory,
    stock: reportData.stockBlock(val, low),
    commission: {
      earned: earnedTotal,
      paid: [...paidByRep.values()].reduce((a, b) => a + b, 0),
      outstanding: [...outstandingByRep.values()].reduce((a, b) => a + Math.max(0, b), 0),
    },
    metrics: {
      avgDailyRevenue: round2(rep.revenue / days),
      marginPct: rep.revenue > 0 ? Math.round((rep.grossProfit / rep.revenue) * 1000) / 10 : 0,
      activeReps: repPerformance.length,
      lowStockCount: low.length,
    },
    settlements: {
      active: stlSummary.outstandingCount,
      activeValue: stlSummary.outstandingValue,
      overdue: stlSummary.overdueCount,
      overdueValue: stlSummary.overdueValue,
    },
    pending: { requests: pending[0], settlements: pending[1], returns: pending[2] },
    attention,
    supplierDue,
  };
}

// WhatsApp: the short summary, same shape as the weekly one, PDF link at the foot.
// Wording and fitting live in whatsappText.js.
function buildWhatsAppText(d, link) {
  return require('./whatsappText').owner.monthlyReport({
    period: d.period.label,
    revenue: d.finance.revenue,
    netProfit: d.finance.netProfit,
    expenses: d.finance.expenses,
    cashBalance: d.cashPosition,
    growthPct: d.growth.revenuePct,
    topProduct: (d.topProducts || [])[0] || null,
    topRep: d.repPerformance[0] || null,
    brands: [...(d.brands || [])].sort((a, b) => b.revenue - a.revenue),
    stockValue: d.stock.costValue,
    stockBoxes: d.stock.units,
    alerts: d.attention.length,
    link,
  });
}

// Generate → archive → send. Deduped per month; `force` bypasses for tests;
// `silent` regenerates/repairs the archived PDF without sending WhatsApp.
async function sendMonthlyReport({ force = false, silent = false, monthKey } = {}) {
  const wa = require('./whatsappNotify.service');
  const archive = require('./reportArchive.service');
  const { monthlyPdf } = require('./reportPdf.service');

  const data = await buildMonthlyData(monthKey);
  const key = data.period.monthKey;

  const pdf = await monthlyPdf(data);
  const saved = await archive.save({
    type: 'MONTHLY',
    periodKey: key,
    label: data.period.label,
    from: data.period.from,
    to: data.period.to,
    pdf,
    meta: { revenue: data.finance.revenue, netProfit: data.finance.netProfit, boxes: data.finance.boxesSold },
  });
  const link = archive.publicLink(saved.id);
  if (silent) return { sent: false, reason: 'silent-regeneration', monthKey: key, pdf: link, archiveId: saved.id };

  const text = buildWhatsAppText(data, link);
  const result = await wa.queue('MONTHLY_REPORT', {
    dedupeKey: force ? `monthly:${key}:${Date.now()}` : `monthly:${key}`,
    refType: 'ReportArchive',
    refId: saved.id,
    text,
  });
  if (result.reason === 'duplicate') return { sent: false, reason: `Already sent for ${key}`, monthKey: key };
  return { ...result, monthKey: key, pdf: link, archiveId: saved.id, chars: text.length };
}

module.exports = { buildMonthlyData, buildWhatsAppText, sendMonthlyReport, reportMonth };
