'use strict';

// The yearly business report (Nino, 11 Nov 2026: "the full report of the whole year — with graphs and the
// months, which month made more or a loss"). Run with: npm test
//
// What these guard: the twelve months are each read with the same finance.report() the monthly report uses;
// a month with nothing in it is never "the weakest"; a loss month is found; a month not reached yet is never
// counted; the quarters add up; the PDF always draws (a good year, a quiet year); the WhatsApp text stays
// inside CallMeBot's limit with the link kept; and a year that is not over, or a bad year, is refused before
// anything is built or sent.

const test = require('node:test');
const assert = require('node:assert/strict');

// ── stubs ────────────────────────────────────────────────────────────────────
const calls = { report: [], findFirst: 0 };
// Figures per EAT month of 2025: Jan quiet, Mar a loss, Jul the best.
const FIG = {
  '2025-01': null,
  '2025-02': { revenue: 1000000, gp: 400000, exp: 100000, boxes: 30 },
  '2025-03': { revenue: 800000, gp: 300000, exp: 900000, boxes: 25 },
  '2025-04': { revenue: 1200000, gp: 500000, exp: 100000, boxes: 36 },
  '2025-07': { revenue: 3000000, gp: 1400000, exp: 200000, boxes: 90 },
  '2025-12': { revenue: 1500000, gp: 600000, exp: 50000, boxes: 44 },
  '2026-10': { revenue: 2000000, gp: 800000, exp: 100000, boxes: 60 },
  '2026-11': { revenue: 500000, gp: 200000, exp: 10000, boxes: 12 },
};
const eatKey = (d) => new Date(new Date(d).getTime() + 3 * 3600 * 1000).toISOString().slice(0, 7);
const financeStub = {
  report: async ({ start }) => {
    calls.report.push(start);
    const f = FIG[eatKey(start)];
    const r = f || { revenue: 0, gp: 0, exp: 0, boxes: 0 };
    return {
      revenue: r.revenue, cogs: r.revenue - r.gp, grossProfit: r.gp, expenses: r.exp, netProfit: r.gp - r.exp,
      boxesSold: r.boxes, cashFlow: { moneyIn: r.revenue, moneyOut: r.exp, net: r.revenue - r.exp },
    };
  },
};
const prismaStub = {
  whatsAppNotification: { findFirst: async () => { calls.findFirst += 1; return null; } },
};
const stub = (rel, exports) => { require.cache[require.resolve(rel)] = { id: rel, filename: rel, loaded: true, exports }; };
stub('../src/config/prisma', prismaStub);
stub('../src/services/finance.service', financeStub);
stub('../src/services/reports.service', { financeEpoch: async () => null });
stub('../src/services/reorder.service', {});
stub('../src/services/inventory.service', {});

const yearly = require('../src/services/yearlyReport.service');
const { yearlyPdf } = require('../src/services/reportPdf.service');
const { owner, MAX_REPORT_CHARS } = require('../src/services/whatsappText');
const { dayjs, eatNow } = require('../src/utils/dates');

const isPdf = (buf) => Buffer.isBuffer(buf) && buf.subarray(0, 5).toString() === '%PDF-';
const pagesOf = (buf) => (buf.toString('latin1').match(/\/Type \/Page(?!s)/g) || []).length;

// ── the months ───────────────────────────────────────────────────────────────
test('a finished year: twelve months, each read once on its own EAT month; best, weakest and the loss month found', async () => {
  calls.report.length = 0;
  const { eatStart } = yearly.reportYear('2025');
  const months = await yearly.monthsOf(eatStart, dayjs.utc('2026-11-11T08:00:00Z'));
  assert.equal(months.length, 12);
  assert.equal(calls.report.length, 12, 'one finance.report per month');
  assert.deepEqual(months.map((m) => m.key), Array.from({ length: 12 }, (_, i) => `2025-${String(i + 1).padStart(2, '0')}`));
  // January 2025 starts at 00:00 EAT = 21:00 UTC on 31 Dec 2024
  assert.equal(new Date(calls.report.map(Number).sort((a, b) => a - b)[0]).toISOString(), '2024-12-31T21:00:00.000Z');
  assert.ok(months.every((m) => !m.future && !m.partial));
  assert.equal(months[0].quiet, true, 'January sold nothing');
  assert.equal(months[2].netProfit, -600000, 'March lost money');

  const s = yearly.summariseMonths(months);
  assert.equal(s.tradedCount, 5);
  assert.equal(s.bestProfit.key, '2025-07');
  assert.equal(s.weakestProfit.key, '2025-03');
  assert.deepEqual(s.lossMonths.map((m) => m.short), ['Mar']);
  assert.notEqual(s.weakestProfit.key, '2025-01', 'a quiet month is never the weakest');
  assert.equal(s.quarters[0].revenue, 1800000);
  assert.equal(s.quarters[2].revenue, 3000000);
  assert.equal(s.quarters.reduce((a, q) => a + q.revenue, 0), months.reduce((a, m) => a + m.revenue, 0), 'the quarters add up to the months');
  assert.equal(s.avgRevenue, 1500000);
  assert.equal(months[1].vsPrev, null, 'no change is printed against a quiet month');
  assert.equal(months[3].vsPrev, 50, 'April on March: +50%');
});

test('the year under way: a month not reached yet is never read or counted; the current one is marked as so far', async () => {
  calls.report.length = 0;
  const { eatStart } = yearly.reportYear('2026');
  const now = dayjs.utc('2026-11-11T08:00:00Z').add(3, 'hour'); // EAT clock, as eatNow() gives it
  const months = await yearly.monthsOf(eatStart, now);
  assert.equal(calls.report.length, 11, 'December is not read');
  assert.equal(months[11].future, true);
  assert.equal(months[10].partial, true);
  const s = yearly.summariseMonths(months);
  assert.equal(s.bestProfit.key, '2026-10');
  assert.ok(!s.lossMonths.length);
});

test('a year with a single trading month has no "weakest" month to name', () => {
  const m = (i, net, quiet = false) => ({ index: i, key: `2025-${i}`, short: `M${i}`, label: `Month ${i}`, quiet, future: false, revenue: quiet ? 0 : 100, netProfit: net, boxes: 1 });
  const s = yearly.summariseMonths([m(0, 0, true), m(1, 500), ...Array.from({ length: 10 }, (_, i) => m(i + 2, 0, true))]);
  assert.equal(s.bestProfit.index, 1);
  assert.equal(s.weakestProfit, null);
});

// ── the PDF ──────────────────────────────────────────────────────────────────
const yearData = async (over = {}) => {
  const { eatStart } = yearly.reportYear('2025');
  const months = await yearly.monthsOf(eatStart, dayjs.utc('2026-11-11T08:00:00Z'));
  return {
    number: 'ZL-Y2025',
    period: { label: '2025', yearKey: '2025' },
    generatedAt: '1 Jan 2026, 08:00 EAT',
    prevLabel: '2024',
    finance: { revenue: 7500000, cogs: 4300000, grossProfit: 3200000, expenses: 1350000, netProfit: 1850000, moneyIn: 7500000, moneyOut: 1350000, netCash: 6150000, boxesSold: 225 },
    extras: {
      byDay: [], expensesByCategory: [{ category: 'Rent', amount: 900000, count: 3 }],
      moneyInKinds: [{ label: 'Settlements from reps', amount: 7500000 }], moneyOutKinds: [{ label: 'Business expenses', amount: 1350000 }],
      cashStatement: { opening: 0, moneyIn: 7500000, moneyOut: 1350000, ownerNet: 0, closing: 6150000 },
      orders: 120, reps: [{ id: 'a', name: 'Asha Mwinyi', revenue: 4000000, boxes: 120, orders: 60 }], prev: null,
    },
    brands: [{ name: 'OHIS', revenue: 4500000, cost: 2500000, profit: 2000000, margin: 44.4, boxes: 130 }],
    topProducts: [{ name: 'OHIS Pepa Ndogo', revenue: 3000000, boxes: 90 }],
    repPerformance: [{ id: 'a', name: 'Asha Mwinyi', revenue: 4000000, boxes: 120, orders: 60, commissionEarned: 300000, commissionPaid: 250000, outstanding: 50000 }],
    accounts: [{ name: 'M-Pesa', balance: 6150000 }],
    cashPosition: 6150000,
    stock: { costValue: 1000000, retailValue: 1500000, potential: 500000, units: 40, warehouseBoxes: 30, repBoxes: 10, lowCount: 0, outOfStock: 0 },
    movement: { openingBoxes: 0, closingBoxes: 40, stockInBoxes: 265, purchasedBoxes: 0, soldBoxes: 225, returnedBoxes: 0, adjustedBoxes: 0 },
    settlements: { active: 1, activeValue: 60000, overdue: 0, overdueValue: 0 },
    pending: { requests: 0, settlements: 0, returns: 0 },
    supplierDue: 0,
    attention: [],
    commission: { earned: 300000, paid: 250000, outstanding: 50000 },
    growth: { revenuePct: null, netProfitPct: null, prevLabel: '2024' },
    months,
    summary: yearly.summariseMonths(months),
    ...over,
  };
};

test('the yearly PDF draws, with the logo, over several pages', async () => {
  const pdf = await yearlyPdf(await yearData());
  assert.ok(isPdf(pdf));
  assert.ok(pagesOf(pdf) >= 3, `expected several pages, got ${pagesOf(pdf)}`);
  assert.match(pdf.toString('latin1'), /\/Subtype \/Image/);
});

test('a year with nothing in it still draws (no sales, no months, no reps)', async () => {
  const quiet = Array.from({ length: 12 }, (_, i) => ({ index: i, key: `2025-${i + 1}`, short: 'M', label: `M ${i}`, quiet: true, future: false, partial: false, revenue: 0, cogs: 0, grossProfit: 0, expenses: 0, netProfit: 0, boxes: 0, moneyIn: 0, moneyOut: 0, margin: null, vsPrev: null }));
  const d = await yearData({
    months: quiet,
    summary: yearly.summariseMonths(quiet),
    finance: { revenue: 0, cogs: 0, grossProfit: 0, expenses: 0, netProfit: 0, moneyIn: 0, moneyOut: 0, netCash: 0, boxesSold: 0 },
    brands: [], topProducts: [], repPerformance: [], accounts: [], cashPosition: 0,
  });
  d.extras = { ...d.extras, orders: 0, reps: [], expensesByCategory: [], moneyInKinds: [], moneyOutKinds: [] };
  assert.ok(isPdf(await yearlyPdf(d)));
});

// ── the WhatsApp text ────────────────────────────────────────────────────────
const LINK = 'https://www.zelab.site/api/public/report/ckabcdefghijklmnopqrstuvw.pdf?sig=0123456789abcdef0123456789abcdef';

test('the yearly WhatsApp text: bold heading, best and weakest month, the loss months, the link last, inside the limit', async () => {
  const text = yearly.buildWhatsAppText(await yearData(), LINK);
  assert.ok(text.startsWith('*ZELAB — YEARLY REPORT*\n2025'));
  assert.match(text, /Best Month: July 2025 — TSh 1,200,000 profit/);
  assert.match(text, /Weakest Month: March 2025 — TSh -600,000/);
  assert.match(text, /Loss Months: Mar/);
  assert.ok(text.endsWith(`Full Year Report (PDF):\n${LINK}`));
  assert.ok(text.length <= MAX_REPORT_CHARS, `${text.length} chars`);
});

test('a long yearly text drops the leaders first and never the link', () => {
  const long = 'A very long product name that goes on and on and on '.repeat(4);
  const text = owner.yearlyReport({
    year: '2025', revenue: 1, grossProfit: 1, netProfit: 1, expenses: 1, boxes: 1, cashBalance: 1, growthPct: 12, prevLabel: '2024',
    bestMonth: { name: 'July 2025', netProfit: 1 }, weakestMonth: { name: 'March 2025', netProfit: -1 }, lossMonths: ['Mar'],
    topBrand: { name: long, revenue: 1 }, topRep: { name: long, revenue: 1 }, topProduct: { name: long }, link: LINK,
  });
  assert.ok(text.length <= MAX_REPORT_CHARS, `${text.length} chars`);
  assert.ok(text.endsWith(LINK));
  assert.ok(!text.includes('Top Brand'), 'the leaders went first');
  assert.match(text, /Loss Months: Mar/);
});

test('no loss month reads "None", and a year with no growth figure leaves the line out', () => {
  const text = owner.yearlyReport({ year: '2025', revenue: 1, grossProfit: 1, netProfit: 1, expenses: 1, boxes: 1, cashBalance: 1, growthPct: null, lossMonths: [], link: LINK });
  assert.match(text, /Loss Months: None/);
  assert.ok(!text.includes('Revenue Growth'));
});

// ── sending ──────────────────────────────────────────────────────────────────
test('a year that is not over, or a bad year, is refused before anything is read, built or sent', async () => {
  calls.findFirst = 0;
  calls.report.length = 0;
  const thisYear = eatNow().format('YYYY');
  await assert.rejects(yearly.sendYearlyReport({ yearKey: thisYear }), (e) => e.statusCode === 400 && /not over yet/.test(e.message));
  await assert.rejects(yearly.sendYearlyReport({ yearKey: '20x6' }), (e) => e.statusCode === 400);
  await assert.rejects(yearly.sendYearlyReport({ yearKey: '1999' }), (e) => e.statusCode === 400);
  assert.equal(calls.findFirst, 0);
  assert.equal(calls.report.length, 0);
});

test('a year already sent answers "already sent" without building the report again', async () => {
  calls.report.length = 0;
  prismaStub.whatsAppNotification.findFirst = async () => ({ id: 'w1' });
  const r = await yearly.sendYearlyReport({ yearKey: '2025' });
  assert.equal(r.sent, false);
  assert.match(r.reason, /Already sent for 2025/);
  assert.equal(calls.report.length, 0);
});
