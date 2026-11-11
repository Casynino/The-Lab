'use strict';

// ===========================================================================
// YEARLY BUSINESS REPORT — the whole year, month by month.
//
// Nino, 11 Nov 2026: "at the end of the year I should get the full report of the
// whole year — well designed, with graphs and the months, which month made more
// or a loss." Sent on 1 January at 08:00 Tanzania time (after December's monthly
// report), always covering the ENTIRE previous year. The PDF is archived with the
// other reports (Profile > Reports) and the WhatsApp message carries the link.
//
// Every figure comes from finance.report() — the call the Finance screen, the
// dashboard and the monthly report read — once for the year and once per month,
// so a month here is exactly the month in its own monthly report. The rest of the
// report (brands, products, reps, stock, accounts) is the monthly report's own
// builder run over the year. Nothing here writes to the database except the
// archived PDF and the queued WhatsApp message.
// ===========================================================================

const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const finance = require('./finance.service');
const { buildPeriodBody } = require('./monthlyReport.service');
const { dayjs, eatNow, eatRange } = require('../utils/dates');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// The year a report covers: a 'YYYY' key pins it; otherwise the previous EAT year (it always looks back).
function reportYear(yearKey) {
  const anchor = yearKey ? dayjs.utc(`${yearKey}-07-01`).add(3, 'hour') : eatNow().subtract(1, 'year');
  return eatRange('year', anchor);
}

function assertYearKey(yearKey) {
  if (yearKey == null) return;
  const y = Number(yearKey);
  if (!/^\d{4}$/.test(String(yearKey)) || y < 2000 || y > 2100) throw ApiError.badRequest(`Not a year: ${yearKey} (use YYYY)`);
}

/**
 * The twelve months of the year: what each one sold, kept and spent. A month that has not started yet is
 * marked `future`; the month still under way (only in a preview of the current year) is marked `partial`.
 * A month with nothing recorded is `quiet` — it is shown, but it never counts as the best or the weakest.
 */
async function monthsOf(eatStart, now = eatNow()) {
  const rows = await Promise.all(Array.from({ length: 12 }, async (_, i) => {
    const m = eatRange('month', eatStart.add(i, 'month'));
    const base = { index: i, key: m.eatStart.format('YYYY-MM'), short: m.eatStart.format('MMM'), label: m.eatStart.format('MMMM YYYY') };
    if (m.eatStart.isAfter(now)) {
      return { ...base, future: true, partial: false, quiet: true, revenue: 0, cogs: 0, grossProfit: 0, expenses: 0, netProfit: 0, boxes: 0, moneyIn: 0, moneyOut: 0 };
    }
    const partial = !m.eatEnd.isBefore(now);
    const r = await finance.report({ start: m.start, end: m.end });
    const row = {
      ...base,
      future: false,
      partial,
      revenue: round2(r.revenue),
      cogs: round2(r.cogs),
      grossProfit: round2(r.grossProfit),
      expenses: round2(r.expenses),
      netProfit: round2(r.netProfit),
      boxes: r.boxesSold || 0,
      moneyIn: round2(r.cashFlow.moneyIn),
      moneyOut: round2(r.cashFlow.moneyOut),
    };
    row.quiet = !(row.revenue || row.expenses || row.boxes || row.moneyIn || row.moneyOut);
    row.margin = row.revenue > 0 ? Math.round((row.grossProfit / row.revenue) * 1000) / 10 : null;
    return row;
  }));
  // Change on the month before (only between two months that both traded).
  rows.forEach((r, i) => {
    const p = rows[i - 1];
    r.vsPrev = p && !p.quiet && !r.quiet && p.revenue > 0 ? Math.round(((r.revenue - p.revenue) / p.revenue) * 1000) / 10 : null;
  });
  return rows;
}

function summariseMonths(months) {
  const traded = months.filter((m) => !m.quiet && !m.future);
  const byNet = [...traded].sort((a, b) => b.netProfit - a.netProfit);
  const byRevenue = [...traded].sort((a, b) => b.revenue - a.revenue);
  const quarters = [0, 1, 2, 3].map((q) => {
    const ms = months.slice(q * 3, q * 3 + 3);
    return {
      label: `Q${q + 1}`,
      months: ms.map((m) => m.short).join(' – '),
      revenue: round2(ms.reduce((s, m) => s + m.revenue, 0)),
      netProfit: round2(ms.reduce((s, m) => s + m.netProfit, 0)),
      boxes: ms.reduce((s, m) => s + m.boxes, 0),
    };
  });
  return {
    tradedCount: traded.length,
    bestProfit: byNet[0] || null,
    weakestProfit: byNet.length > 1 ? byNet[byNet.length - 1] : null,
    bestRevenue: byRevenue[0] || null,
    lossMonths: traded.filter((m) => m.netProfit < 0),
    profitMonths: traded.filter((m) => m.netProfit > 0),
    avgRevenue: traded.length ? round2(traded.reduce((s, m) => s + m.revenue, 0) / traded.length) : 0,
    avgNetProfit: traded.length ? round2(traded.reduce((s, m) => s + m.netProfit, 0) / traded.length) : 0,
    quarters,
  };
}

async function buildYearlyData(yearKey, now = eatNow()) {
  assertYearKey(yearKey);
  const { start, end: yearEnd, eatStart, eatEnd } = reportYear(yearKey);
  // A preview of the year still under way stops at the end of today, never in the future.
  const ytd = !eatEnd.isBefore(now);
  const end = ytd ? eatRange('day', now).end : yearEnd;
  const prev = eatRange('year', eatStart.subtract(1, 'year'));
  const [body, months] = await Promise.all([
    buildPeriodBody({ start, end, prev, topProducts: 10 }),
    monthsOf(eatStart, now),
  ]);
  const year = eatStart.format('YYYY');
  const summary = summariseMonths(months);
  const prevLabel = prev.eatStart.format('YYYY');
  return {
    period: { start: eatStart, label: ytd ? `${year} (to ${now.format('D MMM')})` : year, yearKey: year, from: start, to: end, ytd },
    generatedAt: `${now.format('D MMM YYYY, HH:mm')} EAT`,
    number: `ZL-Y${year}`,
    prevLabel,
    ...body,
    growth: { ...body.growth, prevLabel },
    metrics: { ...body.metrics, avgMonthlyRevenue: summary.avgRevenue },
    months,
    summary,
  };
}

// WhatsApp: the year in a few lines, PDF link at the foot. Wording lives in whatsappText.js.
function buildWhatsAppText(d, link) {
  const s = d.summary;
  return require('./whatsappText').owner.yearlyReport({
    year: d.period.label,
    revenue: d.finance.revenue,
    grossProfit: d.finance.grossProfit,
    netProfit: d.finance.netProfit,
    expenses: d.finance.expenses,
    boxes: d.finance.boxesSold,
    cashBalance: d.cashPosition,
    growthPct: d.growth.revenuePct,
    prevLabel: d.prevLabel,
    bestMonth: s.bestProfit && { name: s.bestProfit.label, netProfit: s.bestProfit.netProfit, revenue: s.bestProfit.revenue },
    weakestMonth: s.weakestProfit && { name: s.weakestProfit.label, netProfit: s.weakestProfit.netProfit },
    lossMonths: s.lossMonths.map((m) => m.short),
    topBrand: [...(d.brands || [])].sort((a, b) => b.revenue - a.revenue)[0] || null,
    topRep: d.repPerformance[0] || null,
    topProduct: (d.topProducts || [])[0] || null,
    link,
  });
}

// Generate → archive → send. Deduped per year; `force` sends again for a test (linking to the PDF already on
// file, never replacing it); `silent` (re)builds the archived PDF without sending WhatsApp. Only a finished year
// is ever sent: a year still under way would use up the key of the real report.
async function sendYearlyReport({ force = false, silent = false, yearKey } = {}) {
  const wa = require('./whatsappNotify.service');
  const archive = require('./reportArchive.service');
  const { yearlyPdf } = require('./reportPdf.service');

  assertYearKey(yearKey);
  const { eatStart, eatEnd } = reportYear(yearKey);
  const key = eatStart.format('YYYY');
  if (!eatEnd.isBefore(eatNow())) throw ApiError.badRequest(`${key} is not over yet`);
  if (!force && !silent && (await prisma.whatsAppNotification.findFirst({ where: { dedupeKey: `yearly:${key}` }, select: { id: true } }))) {
    return { sent: false, reason: `Already sent for ${key}`, yearKey: key };
  }

  const data = await buildYearlyData(key);
  const pdf = await yearlyPdf(data);
  const saved = await archive.save({
    type: 'YEARLY',
    periodKey: key,
    label: `The year ${key}`,
    from: data.period.from,
    to: data.period.to,
    pdf,
    meta: { revenue: data.finance.revenue, netProfit: data.finance.netProfit, boxes: data.finance.boxesSold },
    keep: force && !silent,
  });
  const link = archive.publicLink(saved.id);
  if (silent) return { sent: false, reason: 'silent-regeneration', yearKey: key, pdf: link, archiveId: saved.id };

  const text = buildWhatsAppText(data, link);
  const result = await wa.queue('YEARLY_REPORT', {
    dedupeKey: force ? `yearly:${key}:${Date.now()}` : `yearly:${key}`,
    refType: 'ReportArchive',
    refId: saved.id,
    text,
  });
  if (result.reason === 'duplicate') return { sent: false, reason: `Already sent for ${key}`, yearKey: key };
  return { ...result, yearKey: key, pdf: link, archiveId: saved.id, chars: text.length };
}

module.exports = { buildYearlyData, buildWhatsAppText, sendYearlyReport, reportYear, monthsOf, summariseMonths };
