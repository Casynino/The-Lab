'use strict';

// The daily, weekly and monthly report PDFs and the figures behind them.
// Run with: npm test
//
// What these guard: a report must never fail to draw (an empty week, a rep with
// an emoji in the name, 80 reps), a sale must land on the business's day (EAT,
// not the server's), the chart columns must add up to the revenue printed above
// them, and the evening WhatsApp message must stay inside what CallMeBot sends
// with the PDF link at the top.

const test = require('node:test');
const assert = require('node:assert/strict');

// ── stubs: the database and the two finance services reportData reads ────────
const sales = [];     // { soldAt, lineTotal, unitCost, baseQuantity, saleId, repId }
const expenseRows = [];
const prismaStub = {
  saleItem: {
    findMany: async ({ select }) => sales.map((s) => ({
      baseQuantity: s.baseQuantity, lineTotal: s.lineTotal, unitCost: s.unitCost, saleId: s.saleId,
      sale: { soldAt: s.soldAt, salesRepId: s.repId },
    })).filter((x) => (select.sale.select.salesRepId ? x.sale.salesRepId : true)),
  },
  salesRepresentative: { findMany: async () => [{ id: 'r1', code: 'R1', user: { name: 'Asha Mwinyi' } }, { id: 'r2', code: 'R2', user: { name: 'John Kileo' } }] },
  financeTransaction: { groupBy: async () => expenseRows },
  sale: { count: async () => sales.length },
  reportArchive: { findMany: async (args) => { prismaStub.lastArchiveQuery = args; return []; } },
};
const stub = (rel, exports) => { require.cache[require.resolve(rel)] = { id: rel, filename: rel, loaded: true, exports }; };
stub('../src/config/prisma', prismaStub);
stub('../src/services/finance.service', {});
stub('../src/services/reports.service', { financeEpoch: async () => null });

const data = require('../src/services/reportData.service');
const kit = require('../src/services/reportKit');
const { dailyPdf, weeklyPdf, monthlyPdf } = require('../src/services/reportPdf.service');
const daily = require('../src/services/dailyBusinessReport.service');

const pagesOf = (buf) => (buf.toString('latin1').match(/\/Type \/Page(?!s)/g) || []).length;
const isPdf = (buf) => Buffer.isBuffer(buf) && buf.subarray(0, 5).toString() === '%PDF-';

// ── the figures ──────────────────────────────────────────────────────────────
test('a sale at 00:30 Tanzania time lands on that day, not the one before it (server clock is UTC)', async () => {
  sales.length = 0;
  // 21:30 UTC on 9 Nov = 00:30 EAT on 10 Nov
  sales.push({ soldAt: new Date('2026-11-09T21:30:00Z'), lineTotal: 100000, unitCost: 40000, baseQuantity: 2, saleId: 's1', repId: 'r1' });
  // 20:59 UTC on 9 Nov = 23:59 EAT on 9 Nov
  sales.push({ soldAt: new Date('2026-11-09T20:59:00Z'), lineTotal: 50000, unitCost: 20000, baseQuantity: 1, saleId: 's2', repId: null });
  const days = await data.salesByDay(new Date('2026-11-08T21:00:00Z'), new Date('2026-11-10T20:59:59Z'));
  assert.deepEqual(days.map((d) => d.date), ['2026-11-09', '2026-11-10']);
  assert.equal(days[0].revenue, 50000);
  assert.equal(days[1].revenue, 100000);
  assert.equal(days[1].profit, 100000 - 40000 * 2);
  assert.equal(days[1].boxes, 2);
});

test('the daily columns add up to the revenue, and empty days are zeros, not gaps', async () => {
  sales.length = 0;
  sales.push({ soldAt: new Date('2026-11-03T08:00:00Z'), lineTotal: 300, unitCost: 100, baseQuantity: 1, saleId: 'a', repId: null });
  sales.push({ soldAt: new Date('2026-11-05T08:00:00Z'), lineTotal: 700, unitCost: 300, baseQuantity: 3, saleId: 'b', repId: null });
  const days = await data.salesByDay(new Date('2026-11-02T21:00:00Z'), new Date('2026-11-09T20:59:59Z')); // Mon 3 – Sun 9 Nov (EAT)
  assert.equal(days.length, 7);
  assert.equal(days.reduce((s, d) => s + d.revenue, 0), 1000);
  assert.equal(days.filter((d) => d.revenue === 0).length, 5);
});

test('rep leaderboard: revenue, boxes and distinct orders per rep, best first', async () => {
  sales.length = 0;
  sales.push({ soldAt: new Date('2026-11-04T08:00:00Z'), lineTotal: 500, unitCost: 0, baseQuantity: 5, saleId: 's1', repId: 'r2' });
  sales.push({ soldAt: new Date('2026-11-04T09:00:00Z'), lineTotal: 500, unitCost: 0, baseQuantity: 5, saleId: 's1', repId: 'r2' }); // same order, second line
  sales.push({ soldAt: new Date('2026-11-04T10:00:00Z'), lineTotal: 2000, unitCost: 0, baseQuantity: 20, saleId: 's2', repId: 'r1' });
  const board = await data.repLeaderboard(new Date('2026-11-01T00:00:00Z'), new Date('2026-11-30T00:00:00Z'));
  assert.deepEqual(board.map((r) => [r.name, r.revenue, r.boxes, r.orders]), [['Asha Mwinyi', 2000, 20, 1], ['John Kileo', 1000, 10, 1]]);
});

test('expenses by category: biggest first, zero rows dropped, blank category named', async () => {
  expenseRows.length = 0;
  expenseRows.push({ category: 'Rent', _sum: { amount: 200 }, _count: 1 }, { category: null, _sum: { amount: 50 }, _count: 2 }, { category: 'Zero', _sum: { amount: 0 }, _count: 1 }, { category: 'Transport', _sum: { amount: 250 }, _count: 3 });
  const cats = await data.expensesByCategory(new Date('2026-11-01T00:00:00Z'), new Date('2026-11-30T00:00:00Z'));
  assert.deepEqual(cats.map((c) => [c.category, c.amount]), [['Transport', 250], ['Rent', 200], ['Uncategorised', 50]]);
});

test('money in/out by kind: split by direction, labelled, biggest first', () => {
  const { moneyInKinds, moneyOutKinds } = data.splitKinds([
    { type: 'SETTLEMENT', direction: 'IN', amount: 900, count: 4 },
    { type: 'WAREHOUSE_SALE', direction: 'IN', amount: 100, count: 2 },
    { type: 'EXPENSE', direction: 'OUT', amount: 300, count: 5 },
    { type: 'STOCK_PURCHASE', direction: 'OUT', amount: 800, count: 1 },
    { type: 'ADJUSTMENT', direction: 'OUT', amount: 0, count: 1 },
  ]);
  assert.deepEqual(moneyInKinds.map((k) => k.label), ['Settlements from reps', 'Counter (warehouse) sales']);
  assert.deepEqual(moneyOutKinds.map((k) => k.label), ['Stock bought from suppliers', 'Business expenses']);
});

test('percent change: nothing to compare with is null, never infinity', () => {
  assert.equal(kit.pct(150, 100), 50);
  assert.equal(kit.pct(50, 100), -50);
  assert.equal(kit.pct(10, 0), null);
  assert.equal(kit.pct(10, -5), null);
});

// ── the PDFs ─────────────────────────────────────────────────────────────────
const dayRows = (n) => Array.from({ length: n }, (_, i) => ({ date: `2026-11-${String(1 + i).padStart(2, '0')}`, day: String(1 + i), short: 'Mon', long: 'Monday 3 Nov', revenue: (i % 5) * 250000, profit: 0, boxes: i }));
const report = (over = {}) => ({
  number: 'ZL-2026-W45',
  period: { label: '3 – 9 Nov 2026', key: '2026-W45' },
  generatedAt: '10 Nov 2026, 21:00 EAT',
  prevLabel: 'October 2026',
  finance: { revenue: 7460000, cogs: 5120000, grossProfit: 2340000, expenses: 610000, netProfit: 1730000, moneyIn: 6900000, moneyOut: 5320000, netCash: 1580000, boxesSold: 196 },
  extras: {
    byDay: dayRows(7),
    expensesByCategory: [{ category: 'Transport', amount: 250000, count: 3 }, { category: 'Rent', amount: 200000, count: 1 }],
    moneyInKinds: [{ label: 'Settlements from reps', amount: 5400000 }],
    moneyOutKinds: [{ label: 'Stock bought from suppliers', amount: 4100000 }, { label: 'Business expenses', amount: 610000 }],
    cashStatement: { opening: 8200000, moneyIn: 6900000, moneyOut: 5320000, ownerNet: 500000, closing: 10280000 },
    orders: 41,
    reps: [{ id: 'a', name: 'Asha Mwinyi', revenue: 3100000, boxes: 82, orders: 14 }, { id: 'b', name: 'John Kileo', revenue: 1900000, boxes: 51, orders: 11 }],
    prev: { revenue: 6500000, grossProfit: 2100000, expenses: 700000, netProfit: 1400000, boxesSold: 170, moneyIn: 6000000, moneyOut: 5600000 },
  },
  brands: [{ name: 'Pepa', revenue: 4800000, cost: 3300000, profit: 1500000, margin: 31.3, boxes: 120 }, { name: 'Hao Gold', revenue: 2100000, cost: 1500000, profit: 600000, margin: 28.6, boxes: 54 }],
  topProducts: [{ name: 'Pepa King Size', revenue: 2400000, boxes: 60 }, { name: 'Pepa Roll', revenue: 900000 }],
  accounts: [{ name: 'Cash on hand', balance: 3120000 }, { name: 'Tigo Pesa', balance: -120000 }],
  cashPosition: 3000000,
  stock: { costValue: 12400000, retailValue: 18950000, potential: 6550000, units: 612, warehouseBoxes: 402, repBoxes: 210, lowCount: 3, outOfStock: 1 },
  movement: { stockInBoxes: 300, purchasedBoxes: 0, soldBoxes: 196, returnedBoxes: 4, adjustedBoxes: -3 },
  settlements: { active: 9, activeValue: 5100000, overdue: 2, overdueValue: 880000 },
  pending: { requests: 2, settlements: 1, returns: 0 },
  supplierDue: 2500000,
  attention: ['2 stock request(s) waiting for approval', '2 order(s) OVERDUE worth TSh 880,000'],
  commission: { earned: 312000, paid: 250000, outstanding: 410000 },
  ...over,
});

test('daily, weekly and monthly all draw, with the logo, and run to several pages', async () => {
  for (const [name, fn] of [['daily', dailyPdf], ['weekly', weeklyPdf], ['monthly', monthlyPdf]]) {
    const pdf = await fn(report());
    assert.ok(isPdf(pdf), `${name} is a PDF`);
    assert.ok(pagesOf(pdf) >= 2, `${name} has several pages, got ${pagesOf(pdf)}`);
    assert.match(pdf.toString('latin1'), /\/Subtype \/Image/, `${name} carries the logo`);
  }
});

test('a quiet period (no sales, no money, no reps, no accounts) still draws', async () => {
  const empty = report({
    finance: { revenue: 0, cogs: 0, grossProfit: 0, expenses: 0, netProfit: 0, moneyIn: 0, moneyOut: 0, netCash: 0, boxesSold: 0 },
    brands: [], topProducts: [], accounts: [], cashPosition: 0, attention: [], commission: { earned: 0, paid: 0, outstanding: 0 },
  });
  empty.extras = { ...empty.extras, byDay: dayRows(7).map((d) => ({ ...d, revenue: 0 })), expensesByCategory: [], moneyInKinds: [], moneyOutKinds: [], orders: 0, reps: [], prev: null, cashStatement: { opening: 0, moneyIn: 0, moneyOut: 0, ownerNet: 0, closing: 0 } };
  for (const fn of [dailyPdf, weeklyPdf, monthlyPdf]) assert.ok(isPdf(await fn(empty)));
});

test('names the built-in font cannot print (emoji, long names) do not break the page', async () => {
  const d = report();
  d.extras.reps = [{ id: 'x', name: 'Mama Neema 🌸 wa Kariakoo ya Mashariki na Magharibi sana sana sana', revenue: 1000, boxes: 1, orders: 1 }];
  d.brands = [{ name: 'Pepa 🔥', revenue: 1, cost: 1, profit: 0, margin: 0, boxes: 1 }];
  assert.ok(isPdf(await weeklyPdf(d)));
});

test('a long table runs onto more pages instead of off the page', async () => {
  const many = Array.from({ length: 80 }, (_, i) => ({ id: `r${i}`, name: `Rep number ${i + 1}`, revenue: 100000 - i, boxes: 10, orders: 2 }));
  const short = pagesOf(await weeklyPdf(report()));
  const long = pagesOf(await weeklyPdf(report({ extras: { ...report().extras, reps: many } })));
  assert.ok(long > short, `80 reps should need more pages (${long} vs ${short})`);
});

// ── the evening WhatsApp message ─────────────────────────────────────────────
const LINK = 'https://www.zelab.site/api/public/report/ckabcdefghijklmnopqrstuvw.pdf?sig=0123456789abcdef0123456789abcdef';
const dayData = () => ({
  ...report(),
  period: { label: 'Tuesday 10 November 2026', shortLabel: '10 November 2026', key: '2026-11-10' },
  activity: { newOrders: 12, settlements: 3, returns: 1 },
});

test('daily message: Nino\'s format, PDF link last, inside the 700 characters CallMeBot keeps', () => {
  const text = daily.buildWhatsAppText(dayData(), LINK);
  const lines = text.split('\n');
  assert.equal(lines[0], '*ZELAB — DAILY REPORT*');
  assert.equal(lines[1], '10 November 2026');
  assert.equal(lines[lines.length - 2], 'Full Report (PDF):');
  assert.equal(lines[lines.length - 1], LINK);
  assert.ok(text.length <= 700, `message is ${text.length} characters`);
  assert.match(text, /Net Profit: TSh 1,730,000/);
  assert.match(text, /Top Reps:\nAsha TSh 3,100,000\nJohn TSh 1,900,000/);
});

test('daily message without a PDF (it failed to build) still carries the numbers and no link line', () => {
  const text = daily.buildWhatsAppText(dayData(), null);
  assert.ok(!text.includes('https://') && !text.includes('PDF'));
  assert.match(text, /Net Profit: TSh 1,730,000/);
});

// Final audit, 12 Nov 2026: the WhatsApp "Cash Balance" was the accounts at the time of sending, so
// October's report said TSh 4,548,999 while its own PDF closed October at 3,434,000. Every report's text
// now quotes the balance at the end of its period, the figure its PDF's cash statement shows.
test('every report text quotes the cash balance at the end of its period, as its PDF does', () => {
  const weekly = require('../src/services/weeklyReport.service');
  const monthly = require('../src/services/monthlyReport.service');
  const d = { ...dayData(), growth: { revenuePct: 5 }, repPerformance: [] }; // closing 10,280,000; accounts now 3,000,000
  const late = { late: new Date('2026-11-11T06:00:00Z') };
  for (const [kind, text] of [
    ['daily', daily.buildWhatsAppText(d, LINK)],
    ['daily, sent late', daily.buildWhatsAppText(d, LINK, late)],
    ['weekly', weekly.buildWhatsAppText(d, LINK)],
    ['monthly', monthly.buildWhatsAppText(d, LINK)],
  ]) {
    assert.match(text, /Cash Balance: TSh 10,280,000/, kind);
    assert.ok(!text.includes('3,000,000'), kind);
  }
  // A late daily says only its stock is the morning's: its cash balance is the day's own.
  assert.match(daily.buildWhatsAppText(d, LINK, late), /\(stock as at then\)/);
});

// Rule changed 11 Nov 2026 (Nino: "why only weekly and monthly — we should see the daily ones too"): by
// default the archive lists EVERY report, with room for a year of dailies; a kind still narrows it.
test('the archive lists every report by default, dailies included; a kind narrows it', async () => {
  const archive = require('../src/services/reportArchive.service');
  await archive.list({});
  assert.equal(prismaStub.lastArchiveQuery.where.type, undefined);
  assert.ok(prismaStub.lastArchiveQuery.take >= 300, 'room for a year of daily reports');
  await archive.list({ type: 'DAILY' });
  assert.equal(prismaStub.lastArchiveQuery.where.type, 'DAILY');
});
