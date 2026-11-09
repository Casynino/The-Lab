'use strict';

// ===========================================================================
// WEEKLY BUSINESS REPORT — WhatsApp summary + PDF statement
//
// buildWeeklyData() assembles one structured snapshot (finance, accounts,
// brands, stock, settlements, alerts) from the same sources as the dashboard.
// The WhatsApp message is the quick health check; the PDF (served from a
// signed public link, generated on demand) is the full bank-statement-style
// report. Configured via Settings: whatsapp.phone / whatsapp.apikey.
// ===========================================================================

const crypto = require('crypto');
const prisma = require('../config/prisma');
const env = require('../config/env');
const finance = require('./finance.service');
const reports = require('./reports.service');
const inventory = require('./inventory.service');
const reorder = require('./reorder.service');
const settlement = require('./settlement.service');
const { dayjs } = require('../utils/dates');

const APP_URL = env.appUrl;
const fmt = (n) => `TSh ${Math.round(Number(n) || 0).toLocaleString('en-US')}`;

async function getSetting(key) {
  const row = await prisma.setting.findUnique({ where: { key } }).catch(() => null);
  return row?.value || null;
}
async function setSetting(key, value, group = 'whatsapp') {
  await prisma.setting.upsert({ where: { key }, create: { key, value, group }, update: { value } });
}

// The week a report covers: on Mondays (cron day) the COMPLETED Mon–Sun week
// that just ended; other days (manual sends) the current ISO week to date.
// A weekKey like "2026-W27" pins an exact week (used by the PDF link).
function reportWeek(weekKey) {
  if (weekKey) {
    const m = /^(\d{4})-W(\d{2})$/.exec(weekKey);
    if (m) {
      // Jan 4 is always inside ISO week 1 of its year (isoWeekYear has no setter).
      const start = dayjs(`${m[1]}-01-04`).isoWeek(Number(m[2])).startOf('isoWeek');
      return { start, end: start.add(6, 'day') };
    }
  }
  const now = dayjs();
  const start = now.isoWeekday() === 1 ? now.startOf('isoWeek').subtract(7, 'day') : now.startOf('isoWeek');
  const end = now.isoWeekday() === 1 ? now.startOf('isoWeek').subtract(1, 'day') : now;
  return { start, end };
}

const weekKeyOf = (start) => `${start.isoWeekYear()}-W${String(start.isoWeek()).padStart(2, '0')}`;

// Signature so the PDF link opens without a login but can't be guessed.
function signWeek(weekKey) {
  return crypto.createHmac('sha256', env.jwt.secret).update(`weekly-statement:${weekKey}`).digest('hex').slice(0, 32);
}
function pdfLink(weekKey) {
  return `${APP_URL}/api/public/weekly-statement.pdf?week=${weekKey}&sig=${signWeek(weekKey)}`;
}

// ── One structured snapshot consumed by both outputs ─────────────────────────
async function buildWeeklyData(weekKey) {
  const { start, end } = reportWeek(weekKey);
  const from = start.format('YYYY-MM-DD');
  const to = end.format('YYYY-MM-DD');

  const [rep, prof, accounts, val, stlSummary, suppliers, low, pending] = await Promise.all([
    finance.report({ from, to }),
    reports.profitOverview({ from, to }),
    finance.accountBalances(),
    inventory.valuation(prisma),
    settlement.summary(),
    finance.supplierSummaries(),
    reorder.lowStock(),
    prisma.$transaction([
      prisma.stockRequest.count({ where: { status: 'PENDING' } }),
      prisma.settlementSubmission.count({ where: { status: 'PENDING' } }),
      prisma.return.count({ where: { status: 'PENDING' } }),
    ]),
  ]);

  const supplierDue = suppliers.reduce((s, x) => s + x.outstanding, 0);
  const outOfStock = val.items.filter((i) => i.totalBase <= 0).length;

  const rangeStart = start.startOf('day').toDate();
  const rangeEnd = end.endOf('day').toDate();

  // Sales rep performance for the period (revenue + boxes per rep).
  const [repItems, repsAll, movementRows, paidAgg, commissionAll] = await Promise.all([
    prisma.saleItem.findMany({
      where: { sale: { is: { soldAt: { gte: rangeStart, lte: rangeEnd }, status: { not: 'CANCELLED' }, salesRepId: { not: null } } } },
      select: { baseQuantity: true, lineTotal: true, sale: { select: { salesRepId: true } } },
    }).catch(() => []),
    prisma.salesRepresentative.findMany({ include: { user: { select: { name: true } } } }).catch(() => []),
    prisma.inventoryTransaction.groupBy({
      by: ['type'],
      where: { occurredAt: { gte: rangeStart, lte: rangeEnd } },
      _sum: { baseQuantity: true },
    }).catch(() => []),
    prisma.commissionWithdrawal.aggregate({
      where: { status: { in: ['APPROVED', 'PAID'] }, decidedAt: { gte: rangeStart, lte: rangeEnd } },
      _sum: { amount: true },
    }).catch(() => ({ _sum: { amount: 0 } })),
    require('./commission.service').summaryAllReps().catch(() => ({ items: [] })),
  ]);

  const repName = new Map(repsAll.map((r) => [r.id, r.user?.name || r.code]));
  const perRep = new Map();
  for (const it of repItems) {
    const id = it.sale.salesRepId;
    const row = perRep.get(id) || { name: repName.get(id) || 'Rep', revenue: 0, boxes: 0 };
    row.revenue += Number(it.lineTotal) || 0;
    row.boxes += it.baseQuantity || 0;
    perRep.set(id, row);
  }
  const repPerformance = [...perRep.values()].sort((a, b) => b.revenue - a.revenue);
  const topRep = repPerformance[0] || null;

  // Whole-business inventory movement from the ledger (transfers cancel out).
  const mv = new Map(movementRows.map((m) => [m.type, m._sum.baseQuantity || 0]));
  const movement = {
    stockInBoxes: mv.get('STOCK_IN') || 0,
    purchasedBoxes: mv.get('PURCHASE_RECEIPT') || 0,
    soldBoxes: -((mv.get('CASH_SALE') || 0) + (mv.get('CREDIT_SALE') || 0)),
    returnedBoxes: mv.get('CUSTOMER_RETURN') || 0,
    adjustedBoxes: (mv.get('ADJUSTMENT') || 0) + (mv.get('CORRECTION') || 0) + (mv.get('STOCK_COUNT') || 0) + (mv.get('DAMAGE') || 0),
  };

  // Commission: earned this period (boxes settled × rate), paid this period,
  // and what is payable right now across all reps.
  let earnedThisPeriod = 0;
  try { earnedThisPeriod = (await require('./commission.service').earnedBetween(rangeStart, rangeEnd)).total; } catch { /* no rule */ }
  const commission = {
    earned: earnedThisPeriod,
    paid: Number(paidAgg._sum.amount) || 0,
    outstanding: (commissionAll.items || []).reduce((s, r) => s + Math.max(0, Number(r.available) || 0), 0),
  };

  const attention = [];
  if (pending[0]) attention.push(`${pending[0]} stock request(s) waiting for approval`);
  if (pending[1]) attention.push(`${pending[1]} settlement(s) waiting for approval`);
  if (pending[2]) attention.push(`${pending[2]} return(s) waiting for approval`);
  if (stlSummary.overdueCount) attention.push(`${stlSummary.overdueCount} order(s) OVERDUE worth ${fmt(stlSummary.overdueValue)}`);
  if (low.length) attention.push(`${low.length} product(s) low on stock (${low.slice(0, 3).map((l) => l.name).join(', ')})`);
  if (supplierDue > 0) attention.push(`Owed to suppliers: ${fmt(supplierDue)}`);

  return {
    period: {
      start,
      end,
      label: `${start.format('D MMM')} – ${end.format('D MMM YYYY')}`,
      weekKey: weekKeyOf(start),
    },
    generatedAt: dayjs().format('D MMM YYYY, HH:mm [UTC]'),
    accounts: accounts.map((a) => ({ name: a.name, balance: a.balance })),
    cashPosition: accounts.reduce((s, a) => s + a.balance, 0),
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
    brands: (prof.byBrand || []).map((b) => ({
      name: b.name, revenue: b.revenue, cost: b.cost, profit: b.profit, margin: b.margin, boxes: b.boxes,
    })),
    topProducts: (rep.topProducts || []).slice(0, 5).map((p) => ({ name: p.name, revenue: p.revenue, boxes: p.boxes })),
    topRep,
    repPerformance,
    commission,
    movement,
    pending: { requests: pending[0], settlements: pending[1], returns: pending[2] },
    stock: {
      costValue: val.totals.totalValue,
      retailValue: val.totals.retailValue,
      potential: Math.round((val.totals.retailValue - val.totals.totalValue) * 100) / 100,
      units: val.totals.totalBaseUnits,
      warehouseBoxes: val.items.reduce((s, i) => s + i.warehouseBase, 0),
      repBoxes: val.items.reduce((s, i) => s + i.repBase, 0),
      lowCount: low.length,
      outOfStock,
    },
    settlements: {
      active: stlSummary.outstandingCount,
      activeValue: stlSummary.outstandingValue,
      overdue: stlSummary.overdueCount,
      overdueValue: stlSummary.overdueValue,
      pendingApprovals: pending[1],
    },
    attention,
    supplierDue,
  };
}

// ── WhatsApp message: the quick, sectioned business health check ─────────────
// Two hard delivery constraints shape this format:
// 1. CallMeBot's firewall 403s "spammy" tokens — no divider runs, and the PDF
//    link is scheme-less (WhatsApp still makes bare domains tappable).
// 2. CallMeBot TRUNCATES messages at roughly 700–750 characters. The PDF link
//    therefore sits right under the header (a cut tail can never remove it)
//    and the body is kept compact — the PDF carries the full detail.
// Executive summary first (understand the business in seconds), then the PDF
// link, then a compact detail block. `link` is the archived report's signed
// URL; kept as a full https:// URL so WhatsApp renders it tappable.
function buildWhatsAppText(d, link) {
  const top = (d.topProducts || [])[0];
  const alertLine = d.attention.length
    ? `⚠️ ${d.attention.length} alert(s) — details in the PDF`
    : '✅ Nothing needs attention';
  const lines = [
    '📊 *ZELAB — WEEKLY REPORT*',
    `_${d.period.label}_`,
    '',
    `💰 Revenue: ${fmt(d.finance.revenue)}`,
    `*Net profit: ${fmt(d.finance.netProfit)}* (expenses ${fmt(d.finance.expenses)})`,
    `🏦 Cash: *${fmt(d.cashPosition)}*`,
    ...(top ? [`🏆 ${top.name}: ${fmt(top.revenue)}`] : []),
    ...(d.topRep ? [`⭐ Top rep: ${d.topRep.name} (${fmt(d.topRep.revenue)})`] : []),
    '',
    '📄 *Full statement (PDF):*',
    link || pdfLink(d.period.weekKey),
    '',
    ...(d.brands.length
      ? [`🏷️ ${d.brands.map((b) => `${b.name} ${fmt(b.revenue)}`).join(' / ')}`]
      : []),
    `📦 Stock: ${fmt(d.stock.costValue)} (${d.stock.units} boxes)`,
    alertLine,
  ];
  return lines.join('\n');
}

// ── Delivery ──────────────────────────────────────────────────────────────────
// One raw sender for the whole app lives in whatsappNotify.service; this
// re-export keeps older callers working.
const sendWhatsApp = (text) => require('./whatsappNotify.service').sendRaw(text);

// Generate the PDF, archive it permanently, then send the WhatsApp summary
// with the archived report's signed link. Deduped per reported week (a retried
// cron never double-sends); failed sends are retried by flush(). `force`
// bypasses the dedupe for tests (and refreshes the archived PDF).
async function sendWeeklyReport({ force = false, silent = false } = {}) {
  const wa = require('./whatsappNotify.service');
  const archive = require('./reportArchive.service');
  const { weeklyStatementPdf } = require('./weeklyPdf.service');

  const data = await buildWeeklyData();
  const weekKey = data.period.weekKey;
  // Legacy dedupe guard (pre-dated the notification log) — still honored so
  // weeks sent before the log existed can't repeat.
  if (!force && (await getSetting('whatsapp.lastWeeklySent')) === weekKey) {
    return { sent: false, reason: `Already sent for ${weekKey}`, weekKey };
  }

  // Archive first — the message links to the stored PDF, so the report the
  // owner opens is exactly the one that was generated, forever.
  const pdf = await weeklyStatementPdf(data);
  const saved = await archive.save({
    type: 'WEEKLY',
    periodKey: weekKey,
    label: data.period.label,
    from: data.period.start.toDate(),
    to: data.period.end.toDate(),
    pdf,
    meta: { revenue: data.finance.revenue, netProfit: data.finance.netProfit, boxes: data.finance.boxesSold },
  });
  const link = archive.publicLink(saved.id);
  if (silent) return { sent: false, reason: 'silent-regeneration', weekKey, pdf: link, archiveId: saved.id };

  const text = buildWhatsAppText(data, link);
  const result = await wa.queue('WEEKLY_REPORT', {
    dedupeKey: force ? `weekly:${weekKey}:${Date.now()}` : `weekly:${weekKey}`,
    refType: 'ReportArchive',
    refId: saved.id,
    text,
  });
  if (result.reason === 'duplicate') return { sent: false, reason: `Already sent for ${weekKey}`, weekKey };
  // Only the scheduled send marks the week as done — a forced test send must
  // never make Monday's real report skip itself as a "duplicate".
  if (result.sent && !force) await setSetting('whatsapp.lastWeeklySent', weekKey);
  return { ...result, weekKey, pdf: link, archiveId: saved.id, chars: text.length };
}

module.exports = { buildWeeklyData, buildWhatsAppText, sendWhatsApp, sendWeeklyReport, signWeek, pdfLink };
