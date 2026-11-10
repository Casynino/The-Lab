'use strict';

// ===========================================================================
// DAILY BUSINESS REPORT — the 21:00 (Tanzania time) evening report.
//
// (Not to be confused with dailyReport.service.js, which holds the opening and
// closing reports the sales reps submit themselves.)
//
// Same shape as the weekly and monthly reports: a full PDF (archived for good,
// opened from a signed link) and a short WhatsApp summary with that link right
// under the header. The day is the business's day (EAT), never the server's.
// Every figure comes from the services the dashboard reads; nothing is
// recomputed here (see reportData.service.js).
// ===========================================================================

const prisma = require('../config/prisma');
const logger = require('../utils/logger');
const finance = require('./finance.service');
const reorder = require('./reorder.service');
const settlementSvc = require('./settlement.service');
const inventorySvc = require('./inventory.service');
const reportData = require('./reportData.service');
const { dayjs, eatNow, eatRange, eatToUtc } = require('../utils/dates');

const fmt = (n) => `TSh ${Math.round(Number(n) || 0).toLocaleString('en-US')}`;

/** The report for one EAT day: 'YYYY-MM-DD', or today when omitted. */
async function buildDailyData(dateKey) {
  const anchor = dateKey && /^\d{4}-\d{2}-\d{2}$/.test(dateKey) ? dayjs.utc(`${dateKey}T12:00:00`) : eatNow();
  const day = eatRange('day', anchor);
  const before = eatRange('day', anchor.subtract(1, 'day'));
  const key = day.eatStart.format('YYYY-MM-DD');
  // The little chart shows this day and the six before it.
  const chartStart = eatToUtc(day.eatStart.subtract(6, 'day')).toDate();

  const [rep, accounts, val, low, stl, counts, suppliers, extras, mvRows] = await Promise.all([
    finance.report({ start: day.start, end: day.end }),
    finance.accountBalances(),
    inventorySvc.valuation(prisma),
    reorder.lowStock(),
    settlementSvc.summary(),
    prisma.$transaction([
      prisma.stockRequest.count({ where: { status: 'PENDING' } }),
      prisma.settlementSubmission.count({ where: { status: 'PENDING' } }),
      prisma.return.count({ where: { status: 'PENDING' } }),
      prisma.settlementSubmission.count({ where: { status: 'APPROVED', decidedAt: { gte: day.start, lte: day.end } } }),
      prisma.return.count({ where: { createdAt: { gte: day.start, lte: day.end } } }),
      prisma.stockRequest.count({ where: { createdAt: { gte: day.start, lte: day.end } } }),
    ]),
    finance.supplierSummaries(),
    reportData.periodExtras({ start: day.start, end: day.end }, before, { dayWindow: { start: chartStart, end: day.end } }),
    // the day's stock movement, for the PDF's "boxes moved"
    prisma.inventoryTransaction.groupBy({
      by: ['type'],
      where: { occurredAt: { gte: day.start, lte: day.end } },
      _sum: { baseQuantity: true },
    }).catch(() => []),
  ]);

  const mv = new Map(mvRows.map((m) => [m.type, m._sum.baseQuantity || 0]));
  const movement = {
    stockInBoxes: mv.get('STOCK_IN') || 0,
    purchasedBoxes: mv.get('PURCHASE_RECEIPT') || 0,
    soldBoxes: -((mv.get('CASH_SALE') || 0) + (mv.get('CREDIT_SALE') || 0)),
    returnedBoxes: mv.get('CUSTOMER_RETURN') || 0,
    adjustedBoxes: (mv.get('ADJUSTMENT') || 0) + (mv.get('CORRECTION') || 0) + (mv.get('STOCK_COUNT') || 0) + (mv.get('DAMAGE') || 0),
  };

  const supplierDue = suppliers.reduce((s, x) => s + x.outstanding, 0);
  const cashPosition = accounts.reduce((s, a) => s + a.balance, 0);
  const negAccounts = accounts.filter((a) => a.balance < 0);
  const pendingTotal = counts[0] + counts[1] + counts[2];

  const attention = [];
  if (pendingTotal) attention.push(`${pendingTotal} approval(s) waiting: ${counts[0]} stock request(s), ${counts[1]} settlement(s), ${counts[2]} return(s)`);
  if (stl.overdueCount) attention.push(`${stl.overdueCount} order(s) OVERDUE worth ${fmt(stl.overdueValue)}`);
  if (negAccounts.length) attention.push(`Account below zero: ${negAccounts.map((a) => a.name).join(', ')}`);
  if (low.length) attention.push(`${low.length} product(s) low on stock (${low.slice(0, 3).map((l) => l.name).join(', ')})`);
  if (supplierDue > 0) attention.push(`Owed to suppliers: ${fmt(supplierDue)}`);

  return {
    period: { label: day.eatStart.format('dddd D MMMM YYYY'), key, start: day.start, end: day.end },
    generatedAt: `${eatNow().format('D MMM YYYY, HH:mm')} EAT`,
    number: `ZL-D-${key}`,
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
    },
    brands: (rep.topBrands || []).map((b) => ({ name: b.name, revenue: b.revenue, cost: b.cost, profit: b.profit, margin: b.margin, boxes: b.boxes })),
    topProducts: (rep.topProducts || []).slice(0, 5).map((p) => ({ name: p.name, revenue: p.revenue, boxes: p.boxes })),
    repPerformance: extras.reps,
    accounts: accounts.map((a) => ({ name: a.name, balance: a.balance })),
    cashPosition,
    stock: reportData.stockBlock(val, low),
    movement,
    settlements: {
      active: stl.outstandingCount,
      activeValue: stl.outstandingValue,
      overdue: stl.overdueCount,
      overdueValue: stl.overdueValue,
    },
    pending: { requests: counts[0], settlements: counts[1], returns: counts[2] },
    activity: { newOrders: counts[5], settlements: counts[3], returns: counts[4] },
    attention,
    supplierDue,
  };
}

// The WhatsApp summary. CallMeBot cuts messages at about 700 characters and
// 403s anything that looks spammy, so: the PDF link sits right under the
// header (a cut tail can never remove it), there are no divider runs, and the
// detail stays in the PDF. `link` is the archived report's signed https URL.
function buildWhatsAppText(d, link) {
  const f = d.finance;
  const reps = d.extras.reps.slice(0, 3).map((r) => `${String(r.name).split(' ')[0]} ${fmt(r.revenue)}`);
  const lines = [
    '🟢 *ZELAB — DAILY REPORT*',
    `_${d.period.label}_`,
    '',
    ...(link ? ['📄 *Full report (PDF):*', link, ''] : []),
    `💰 Sales: ${fmt(f.revenue)} (${f.boxesSold} boxes)`,
    `*Net profit: ${fmt(f.netProfit)}* (expenses ${fmt(f.expenses)})`,
    `💵 In ${fmt(f.moneyIn)} / Out ${fmt(f.moneyOut)}`,
    `🏦 Cash: *${fmt(d.cashPosition)}*`,
    `📋 Orders ${d.activity.newOrders} / Settlements ${d.activity.settlements} / Returns ${d.activity.returns}`,
    ...(reps.length ? [`⭐ ${reps.join(' · ')}`] : []),
    `📦 Stock: ${fmt(d.stock.costValue)} (${d.stock.units} boxes)`,
    d.attention.length ? `⚠️ ${d.attention.length} item(s) need attention, see the PDF` : '✅ All clear',
  ];
  return lines.join('\n');
}

/**
 * Build, archive and send the day's report. `queue` is whatsappNotify's queue();
 * it is passed in so this file never has to require that one back.
 * If the PDF cannot be made, the summary still goes out, without a link: the
 * owner must always get the evening numbers.
 */
async function sendDailyReport({ force = false, dateKey, queue } = {}) {
  const archive = require('./reportArchive.service');
  const data = await buildDailyData(dateKey);

  let link = null;
  let archiveId = null;
  try {
    const { dailyPdf } = require('./reportPdf.service');
    const pdf = await dailyPdf(data);
    const saved = await archive.save({
      type: 'DAILY',
      periodKey: data.period.key,
      label: data.period.label,
      from: data.period.start,
      to: data.period.end,
      pdf,
      meta: { revenue: data.finance.revenue, netProfit: data.finance.netProfit, boxes: data.finance.boxesSold },
    });
    archiveId = saved.id;
    link = archive.publicLink(saved.id);
  } catch (e) {
    logger.error('[daily-report] PDF failed, sending the summary without it:', e.message);
  }

  const text = buildWhatsAppText(data, link);
  const result = await queue('DAILY_SUMMARY', {
    dedupeKey: force ? `daily:${data.period.key}:${Date.now()}` : `daily:${data.period.key}`,
    ...(archiveId ? { refType: 'ReportArchive', refId: archiveId } : {}),
    text,
  });
  return { ...result, pdf: link, archiveId, chars: text.length };
}

module.exports = { buildDailyData, buildWhatsAppText, sendDailyReport };
