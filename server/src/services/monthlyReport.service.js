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

  const [rep, prof, prevRep, cf, accounts, low, movementRows, pending, stlSummary, suppliers] = await Promise.all([
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
  ]);

  // Rep performance for the month.
  const [repItems, repsAll, paidRows, commissionAll] = await Promise.all([
    prisma.saleItem.findMany({
      where: { sale: { is: { soldAt: { gte: start, lte: end }, status: { not: 'CANCELLED' }, salesRepId: { not: null } } } },
      select: { baseQuantity: true, lineTotal: true, sale: { select: { salesRepId: true } } },
    }).catch(() => []),
    prisma.salesRepresentative.findMany({ include: { user: { select: { name: true } } } }).catch(() => []),
    prisma.commissionWithdrawal.groupBy({
      by: ['salesRepId'],
      where: { status: { in: ['APPROVED', 'PAID'] }, decidedAt: { gte: start, lte: end } },
      _sum: { amount: true },
    }).catch(() => []),
    require('./commission.service').summaryAllReps().catch(() => ({ items: [] })),
  ]);

  let earnedByRep = new Map();
  try { earnedByRep = (await require('./commission.service').earnedBetween(start, end)).byRep; } catch { /* no rule */ }

  const repName = new Map(repsAll.map((r) => [r.id, r.user?.name || r.code]));
  const paidByRep = new Map(paidRows.map((r) => [r.salesRepId, Number(r._sum.amount) || 0]));
  const outstandingByRep = new Map((commissionAll.items || []).map((r) => [r.salesRepId, Number(r.available) || 0]));
  const perRep = new Map();
  for (const it of repItems) {
    const id = it.sale.salesRepId;
    const row = perRep.get(id) || { name: repName.get(id) || 'Rep', revenue: 0, boxes: 0 };
    row.revenue += Number(it.lineTotal) || 0;
    row.boxes += it.baseQuantity || 0;
    perRep.set(id, row);
  }
  const repPerformance = [...perRep.entries()]
    .map(([id, r]) => ({
      ...r,
      revenue: round2(r.revenue),
      commissionEarned: round2(earnedByRep.get(id) || 0),
      commissionPaid: paidByRep.get(id) || 0,
      outstanding: outstandingByRep.get(id) ?? null,
    }))
    .sort((a, b) => b.revenue - a.revenue);

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

// WhatsApp: executive summary + growth + archived PDF link.
function buildWhatsAppText(d, link) {
  const g = d.growth.revenuePct;
  const growthLine = g == null ? null : `${g >= 0 ? '📈' : '📉'} Revenue ${g >= 0 ? '+' : ''}${g}% vs ${d.growth.prevLabel}`;
  const top = (d.topProducts || [])[0];
  const lines = [
    `📊 *ZELAB — MONTHLY REPORT*`,
    `_${d.period.label}_`,
    '',
    `💰 Revenue: ${fmt(d.finance.revenue)}`,
    `*Net profit: ${fmt(d.finance.netProfit)}* (expenses ${fmt(d.finance.expenses)})`,
    `🏦 Cash: *${fmt(d.cashPosition)}*`,
    ...(growthLine ? [growthLine] : []),
    ...(top ? [`🏆 ${top.name}: ${fmt(top.revenue)}`] : []),
    ...(d.repPerformance[0] ? [`⭐ Top rep: ${d.repPerformance[0].name} (${fmt(d.repPerformance[0].revenue)})`] : []),
    '',
    '📄 *Full monthly report (PDF):*',
    link,
    '',
    `📦 Boxes sold: ${d.finance.boxesSold} / Stock now: ${d.inventory.closingBoxes} boxes`,
    d.attention.length ? `⚠️ ${d.attention.length} alert(s) — details in the PDF` : '✅ Nothing needs attention',
  ];
  return lines.join('\n');
}

// Generate → archive → send. Deduped per month; `force` bypasses for tests;
// `silent` regenerates/repairs the archived PDF without sending WhatsApp.
async function sendMonthlyReport({ force = false, silent = false, monthKey } = {}) {
  const wa = require('./whatsappNotify.service');
  const archive = require('./reportArchive.service');
  const { monthlyStatementPdf } = require('./monthlyPdf.service');

  const data = await buildMonthlyData(monthKey);
  const key = data.period.monthKey;

  const pdf = await monthlyStatementPdf(data);
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
