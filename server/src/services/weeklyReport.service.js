'use strict';

// ===========================================================================
// WEEKLY BUSINESS REPORT — WhatsApp summary + PDF report
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
const ApiError = require('../utils/ApiError');
const finance = require('./finance.service');
const reports = require('./reports.service');
const inventory = require('./inventory.service');
const reorder = require('./reorder.service');
const settlement = require('./settlement.service');
const { dayjs, resolveRange, eatNow } = require('../utils/dates');
const reportData = require('./reportData.service');

const APP_URL = env.appUrl;
const fmt = (n) => `TSh ${Math.round(Number(n) || 0).toLocaleString('en-US')}`;

async function getSetting(key) {
  const row = await prisma.setting.findUnique({ where: { key } }).catch(() => null);
  return row?.value || null;
}
async function setSetting(key, value, group = 'whatsapp') {
  await prisma.setting.upsert({ where: { key }, create: { key, value, group }, update: { value } });
}

// The weekly report goes out on TUESDAY at 08:00 EAT (business rule, Nino 11 Nov 2026; vercel.json
// "0 5 * * 2" = 05:00 UTC). It covers the COMPLETED Monday–Sunday week that just ended — sent a day
// later so Monday's approvals of the weekend's settlements are in it. On Monday or Tuesday (the cron
// day, or a manual send before it) that is last week; later in the week a manual send shows the
// current week to date. Days are Tanzania days. A weekKey like "2026-W27" pins an exact week (PDF link).
const REPORT_WEEKDAY = 2; // ISO weekday: 1 = Monday, 2 = Tuesday
function reportWeek(weekKey, now = eatNow()) {
  if (weekKey) {
    const m = /^(\d{4})-W(\d{2})$/.exec(weekKey);
    if (m) {
      // Jan 4 is always inside ISO week 1 of its year (isoWeekYear has no setter).
      const start = dayjs(`${m[1]}-01-04`).isoWeek(Number(m[2])).startOf('isoWeek');
      return { start, end: start.add(6, 'day') };
    }
  }
  const lastWeek = now.isoWeekday() <= REPORT_WEEKDAY;
  const start = lastWeek ? now.startOf('isoWeek').subtract(7, 'day') : now.startOf('isoWeek');
  const end = lastWeek ? now.startOf('isoWeek').subtract(1, 'day') : now;
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

  // The week on the BUSINESS's clock (Tanzania). finance.report reads the same days from from/to;
  // everything below uses these instants so no figure counts a different slice of the week.
  const range = resolveRange({ from, to });
  // The arrows compare with the week before — the same number of days, so a part-week send
  // is not measured against a whole one.
  const spanDays = end.startOf('day').diff(start.startOf('day'), 'day') + 1;
  const priorStart = start.subtract(7, 'day');
  const prior = resolveRange({ from: priorStart.format('YYYY-MM-DD'), to: priorStart.add(spanDays - 1, 'day').format('YYYY-MM-DD') });

  const [rep, prof, accounts, val, stlSummary, suppliers, low, pending, extras] = await Promise.all([
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
    reportData.periodExtras(range, prior),
  ]);

  const supplierDue = suppliers.reduce((s, x) => s + x.outstanding, 0);

  const rangeStart = range.start;
  const rangeEnd = range.end;

  // Movement, commission paid and commission owed (rep sales come from extras.reps).
  const [movementRows, paidAgg, commissionAll] = await Promise.all([
    prisma.inventoryTransaction.groupBy({
      by: ['type'],
      where: { occurredAt: { gte: rangeStart, lte: rangeEnd } },
      _sum: { baseQuantity: true },
    }).catch(() => []),
    // Money actually handed over in the week, on the day it was handed over (audit #81). APPROVED is not
    // paid, and decidedAt moves when an approved request is later paid, so one withdrawal was counted in
    // the week it was approved AND again in the week it was paid. Rows paid before paidAt existed fall
    // back to their decision date.
    prisma.commissionWithdrawal.aggregate({
      where: {
        status: 'PAID',
        OR: [{ paidAt: { gte: rangeStart, lte: rangeEnd } }, { paidAt: null, decidedAt: { gte: rangeStart, lte: rangeEnd } }],
      },
      _sum: { amount: true },
    }).catch(() => ({ _sum: { amount: 0 } })),
    require('./commission.service').summaryAllReps().catch(() => ({ items: [] })),
  ]);

  const repPerformance = extras.reps;
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
    generatedAt: `${eatNow().format('D MMM YYYY, HH:mm')} EAT`,
    number: `ZL-${weekKeyOf(start)}`,
    extras,
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
    stock: reportData.stockBlock(val, low),
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

// ── WhatsApp message: the short summary, with the PDF link at the foot ───────
// The wording and the 700-character fitting live in whatsappText.js (the link
// is never the part that gets cut). `link` is the archived report's signed
// https URL.
function buildWhatsAppText(d, link) {
  const { pct } = require('./reportKit');
  const prev = d.extras && d.extras.prev;
  return require('./whatsappText').owner.weeklyReport({
    period: d.period.label,
    revenue: d.finance.revenue,
    netProfit: d.finance.netProfit,
    expenses: d.finance.expenses,
    cashBalance: d.cashPosition,
    growthPct: prev ? pct(d.finance.revenue, prev.revenue) : null,
    topProduct: (d.topProducts || [])[0] || null,
    topRep: d.topRep,
    brands: [...(d.brands || [])].sort((a, b) => b.revenue - a.revenue),
    stockValue: d.stock.costValue,
    stockBoxes: d.stock.units,
    alerts: d.attention.length,
    link: link || pdfLink(d.period.weekKey),
  });
}

// ── Delivery ──────────────────────────────────────────────────────────────────
// One raw sender for the whole app lives in whatsappNotify.service; this
// re-export keeps older callers working.
const sendWhatsApp = (text) => require('./whatsappNotify.service').sendRaw(text);

// Generate the PDF, archive it permanently, then send the WhatsApp summary
// with the archived report's signed link. Deduped per reported week (a retried
// cron never double-sends); failed sends are retried by flush(). `force`
// bypasses the dedupe for tests (linking to the PDF already on file, never
// replacing it); `silent` rewrites the archived PDF without sending. `weekKey`
// pins a finished week (the morning catch-up of a missed report).
async function sendWeeklyReport({ force = false, silent = false, weekKey: pinned } = {}) {
  const wa = require('./whatsappNotify.service');
  const archive = require('./reportArchive.service');
  const { weeklyPdf } = require('./reportPdf.service');

  // Decided before anything is built: the period, whether it is over, and whether it already went out.
  const now = eatNow();
  const period = reportWeek(pinned, now);
  const weekKey = weekKeyOf(period.start);
  // A week still under way is not the week's report: sending or archiving it used up the key the
  // real report needs on Tuesday, which then skipped itself as "already sent". A forced send is
  // still allowed (a manual look at the week so far).
  if (!force && period.end.format('YYYY-MM-DD') >= now.format('YYYY-MM-DD')) {
    throw ApiError.badRequest(`The week ${weekKey} is not over yet`);
  }
  if (!force && !silent) {
    // Legacy guard (pre-dated the notification log), then the log itself. Checked first so a re-run
    // never rebuilds and overwrites the PDF the owner was already sent.
    const done = (await getSetting('whatsapp.lastWeeklySent')) === weekKey
      || (await prisma.whatsAppNotification.findFirst({ where: { dedupeKey: `weekly:${weekKey}` }, select: { id: true } }));
    if (done) return { sent: false, reason: `Already sent for ${weekKey}`, weekKey };
  }

  const data = await buildWeeklyData(pinned);

  // Archive first — the message links to the stored PDF, so the report the
  // owner opens is exactly the one that was generated, forever.
  const pdf = await weeklyPdf(data);
  const saved = await archive.save({
    type: 'WEEKLY',
    periodKey: weekKey,
    label: data.period.label,
    from: data.period.start.toDate(),
    to: data.period.end.toDate(),
    pdf,
    meta: { revenue: data.finance.revenue, netProfit: data.finance.netProfit, boxes: data.finance.boxesSold },
    keep: force && !silent,
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
  // never make Tuesday's real report skip itself as a "duplicate".
  if (result.sent && !force) await setSetting('whatsapp.lastWeeklySent', weekKey);
  return { ...result, weekKey, pdf: link, archiveId: saved.id, chars: text.length };
}

module.exports = { buildWeeklyData, buildWhatsAppText, sendWhatsApp, sendWeeklyReport, signWeek, pdfLink, reportWeek, weekKeyOf, REPORT_WEEKDAY };
