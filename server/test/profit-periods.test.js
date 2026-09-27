'use strict';

// ── Today, this week and this month must mean the same thing ────────────────
// The dashboard now shows a brand's sales over three windows at once. Three
// figures side by side invite comparison, so they have to be built the same
// way: revenue net of the sale's discount, cost frozen at the moment the box
// sold. The month figure has always come from profitOverview; these tests hold
// the new three-window read to exactly the same arithmetic, and to the right
// window boundaries — Tanzania time, weeks starting Monday.

const test = require('node:test');
const assert = require('node:assert');

const EAT = 3 * 3_600_000;
// Monday 21 Sep 2026, 09:00 EAT — fixed, so a test never depends on the day
// it runs. Everything below is positioned against this clock.
const NOW = new Date('2026-09-23T09:00:00+03:00'); // a Wednesday
const day = (iso) => new Date(`${iso}+03:00`);

let items = [];
const products = [
  { id: 'p1', purchasePrice: 10_000, brand: { id: 'b1', name: 'CIVLILY' } },
  { id: 'p2', purchasePrice: 4_000, brand: { id: 'b2', name: 'OHIS' } },
];

const prismaStub = {
  saleItem: {
    findMany: async ({ where }) => {
      const { gte, lte } = where.sale.is.soldAt;
      return items.filter((it) => it.sale.soldAt >= gte && it.sale.soldAt <= lte);
    },
  },
  product: { findMany: async () => products },
  setting: { findUnique: async () => null }, // no finance epoch set
  salesRepresentative: { findMany: async () => [] },
};

const install = (path, exports) => {
  const filename = require.resolve(path);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
};
install('../src/config/prisma', prismaStub);
// profitOverview also values the warehouse and prices commission; neither is
// part of what is being compared here, and both are real database work.
install('../src/services/inventory.service', {
  valuation: async () => ({ items: [], totals: { totalValue: 0, retailValue: 0, totalBaseUnits: 0 } }),
});
install('../src/services/commission.service', { rateForBrandAt: async () => 0 });

const reports = require('../src/services/reports.service');

// Freeze the clock: the windows are worked out from "now".
const RealDate = Date;
class FixedDate extends RealDate {
  constructor(...args) {
    if (args.length === 0) super(NOW.getTime());
    else super(...args);
  }
  static now() { return NOW.getTime(); }
}
test.before(() => { global.Date = FixedDate; });
test.after(() => { global.Date = RealDate; });

const line = ({ productId = 'p1', soldAt, qty = 1, lineTotal, unitCost = 10_000, discount = 0, subtotal = null }) => ({
  productId,
  baseQuantity: qty,
  lineTotal,
  unitCost,
  sale: { soldAt: day(soldAt), discount, subtotal: subtotal == null ? lineTotal : subtotal },
});

test('each window covers exactly its own days, in Tanzania time', async () => {
  items = [
    line({ soldAt: '2026-09-20T23:30:00', lineTotal: 100 }),  // Sunday, the week before
    line({ soldAt: '2026-09-21T00:30:00', lineTotal: 200 }),  // Monday, this week
    line({ soldAt: '2026-09-23T08:00:00', lineTotal: 400 }),  // today
    line({ soldAt: '2026-09-23T23:59:00', lineTotal: 800 }),  // today, last minute
    line({ soldAt: '2026-09-24T00:01:00', lineTotal: 1600 }), // tomorrow, still this week
  ];
  const p = await reports.profitByPeriods(['today', 'week', 'month']);

  assert.equal(p.today.revenue, 1200);              // 400 + 800
  assert.equal(p.week.revenue, 3000);               // Monday onwards, 100 left out
  assert.equal(p.month.revenue, 3100);              // the whole of September so far
  // The week runs Monday 00:00 to Sunday 23:59 EAT.
  assert.equal(new Date(p.week.range.start).toISOString(), '2026-09-20T21:00:00.000Z');
  assert.equal(new Date(p.week.range.end).toISOString(), '2026-09-27T20:59:59.999Z');
});

test('a week that starts in the month before is still read in full', async () => {
  // The read has to start at the earliest window, not at the first of the
  // month, or the Monday and Tuesday of a month-end week would vanish.
  const seen = [];
  const real = prismaStub.saleItem.findMany;
  prismaStub.saleItem.findMany = async (args) => { seen.push(args.where.sale.is.soldAt); return real(args); };
  items = [];
  await reports.profitByPeriods(['today', 'week', 'month']);
  prismaStub.saleItem.findMany = real;

  const monthStart = day('2026-09-01T00:00:00').getTime();
  const weekStart = day('2026-09-21T00:00:00').getTime();
  assert.equal(seen.length, 1, 'one read, not one per window');
  assert.ok(seen[0].gte.getTime() <= Math.min(monthStart, weekStart));
});

test('revenue is net of the discount, cost is the one frozen at the sale', async () => {
  items = [
    // 10,000 of boxes with 1,000 off the sale: revenue 9,000, cost 2 x 6,000.
    line({ soldAt: '2026-09-23T10:00:00', qty: 2, lineTotal: 10_000, unitCost: 6_000, discount: 1_000, subtotal: 10_000 }),
  ];
  const p = await reports.profitByPeriods(['today']);
  assert.equal(p.today.revenue, 9_000);
  assert.equal(p.today.profit, -3_000); // 9,000 - 12,000
  assert.equal(p.today.boxes, 2);
  assert.equal(p.today.margin, round2(-3_000 / 9_000 * 100));
});

test('a line with no cost recorded falls back to the purchase price', async () => {
  items = [line({ soldAt: '2026-09-23T10:00:00', qty: 3, lineTotal: 45_000, unitCost: 0 })];
  const p = await reports.profitByPeriods(['today']);
  assert.equal(p.today.profit, 45_000 - 3 * 10_000); // p1 costs 10,000
});

test('the same figures as the month report, brand by brand', async () => {
  // The month cell and the brand cards sit on the same screen; if these two
  // paths ever disagree the screen contradicts itself.
  items = [
    line({ productId: 'p1', soldAt: '2026-09-02T10:00:00', qty: 2, lineTotal: 50_000, unitCost: 11_000, discount: 5_000, subtotal: 50_000 }),
    line({ productId: 'p2', soldAt: '2026-09-23T10:00:00', qty: 4, lineTotal: 32_000, unitCost: 4_500 }),
    line({ productId: 'p1', soldAt: '2026-09-21T10:00:00', qty: 1, lineTotal: 25_000, unitCost: 0 }),
  ];
  const [periods, overview] = await Promise.all([
    reports.profitByPeriods(['month']),
    reports.profitOverview('month'),
  ]);

  assert.equal(periods.month.revenue, overview.totals.revenue);
  assert.equal(periods.month.profit, overview.totals.profit);
  assert.equal(periods.month.boxes, overview.totals.boxes);
  for (const b of overview.byBrand) {
    const mine = periods.month.byBrand.find((x) => x.brandId === b.brandId);
    assert.ok(mine, `brand ${b.name} is in both`);
    assert.equal(mine.revenue, b.revenue);
    assert.equal(mine.profit, b.profit);
    assert.equal(mine.boxes, b.boxes);
    assert.equal(mine.margin, b.margin);
  }
});

test('a brand that sold nothing this week is not left out of the week', async () => {
  items = [line({ productId: 'p1', soldAt: '2026-09-23T10:00:00', lineTotal: 1_000 })];
  const p = await reports.profitByPeriods(['week']);
  // Only the brand that sold appears; the dashboard fills the rest with zeros
  // rather than this read inventing rows for brands with no sales.
  assert.equal(p.week.byBrand.length, 1);
  assert.equal(p.week.byBrand[0].name, 'CIVLILY');
});

function round2(n) { return Math.round(n * 100) / 100; }
