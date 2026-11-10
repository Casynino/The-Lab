'use strict';

// The rep's commission page as pictures. Run with: npm test
//
// What these guard: the figures are only GROUPED here, never priced (they come from the commission
// service's own lines); a box settled just after midnight in Tanzania belongs to the new month even
// though the server clock is still on the old one; the shares add up; and a rep with nothing yet gets
// zeros and nulls, not NaN.

const test = require('node:test');
const assert = require('node:assert/strict');

let lines = [];
let orders = [];
let fines = [];
const stub = (rel, exports) => { require.cache[require.resolve(rel)] = { id: rel, filename: rel, loaded: true, exports }; };
stub('../src/config/prisma', {
  settlement: { findMany: async () => orders },
  settlementPenalty: { findMany: async () => fines },
});
stub('../src/services/commission.service', { earnedLinesForRep: async () => lines });

const { insightsForRep } = require('../src/services/repInsights.service');
const { eatNow, eatRange } = require('../src/utils/dates');

const thisMonth = () => eatRange('month', eatNow());
const line = (soldAt, brand, product, boxes, amount) => ({ soldAt, brand, product, boxes, amount });

test('six Tanzanian months, oldest first, the last one is this month', async () => {
  lines = []; orders = []; fines = [];
  const r = await insightsForRep('rep1');
  assert.equal(r.months.length, 6);
  assert.equal(r.months[5].key, thisMonth().eatStart.format('YYYY-MM'));
  assert.deepEqual(r.months.map((m) => m.earned), [0, 0, 0, 0, 0, 0]);
});

test('a box settled at 00:30 Tanzania time on the 1st counts for the new month, not the one before', async () => {
  const m = thisMonth();
  lines = [
    line(new Date(m.start.getTime() + 30 * 60 * 1000), 'OHIS', 'P1', 2, 10000), // 00:30 EAT on the 1st
    line(new Date(m.start.getTime() - 30 * 60 * 1000), 'OHIS', 'P1', 1, 5000),  // 23:30 EAT the day before
  ];
  orders = []; fines = [];
  const r = await insightsForRep('rep1');
  assert.equal(r.months[5].earned, 10000);
  assert.equal(r.months[5].boxes, 2);
  assert.equal(r.months[4].earned, 5000);
  assert.equal(r.totals.earned, 15000);
  assert.equal(r.totals.boxes, 3);
  assert.deepEqual(r.best, { label: r.months[5].label, earned: 10000 });
});

test('by brand and by product: biggest first, shares add up, top five products only', async () => {
  const t = new Date(thisMonth().start.getTime() + 3600e3);
  lines = [
    line(t, 'OHIS', 'A', 10, 50000), line(t, 'OHIS', 'B', 4, 20000), line(t, 'Civlily', 'C', 10, 35000),
    line(t, 'Civlily', 'D', 1, 3500), line(t, 'Civlily', 'E', 1, 3000), line(t, 'Civlily', 'F', 1, 2000), line(t, 'Civlily', 'G', 1, 1000),
  ];
  orders = []; fines = [];
  const r = await insightsForRep('rep1');
  assert.deepEqual(r.byBrand.map((b) => [b.brand, b.earned]), [['OHIS', 70000], ['Civlily', 44500]]);
  assert.ok(Math.abs(r.byBrand.reduce((s, b) => s + b.share, 0) - 100) < 0.2, 'shares add up to 100');
  assert.equal(r.topProducts.length, 5);
  assert.deepEqual(r.topProducts.slice(0, 3).map((p) => p.name), ['A', 'C', 'B']);
});

test('settlement record: settled orders split into on time and late; waived fines still mark an order late but are not owed', async () => {
  lines = [];
  orders = [
    { id: 'o1', status: 'SETTLED' }, { id: 'o2', status: 'SETTLED' }, { id: 'o3', status: 'SETTLED' },
    { id: 'o4', status: 'PARTIAL' }, { id: 'o5', status: 'OPEN' }, { id: 'o6', status: 'OVERDUE' },
  ];
  fines = [
    { settlementId: 'o2', kind: 'LATE_FINE', amount: 10000, status: 'APPLIED' },
    { settlementId: 'o2', kind: 'LATE_FINE', amount: 10000, status: 'APPLIED' },
    { settlementId: 'o3', kind: 'LATE_FINE', amount: 10000, status: 'WAIVED' },
    { settlementId: null, kind: 'ADJUSTMENT', amount: 5000, status: 'APPLIED' },
  ];
  const r = await insightsForRep('rep1');
  assert.deepEqual(r.settlement, {
    orders: 6, settled: 3, onTime: 1, late: 2, open: 2, overdue: 1, onTimeRate: 33,
    fines: { count: 3, amount: 25000 },
  });
});

test('a rep with nothing yet: zeros and nulls, never NaN', async () => {
  lines = []; orders = []; fines = [];
  const r = await insightsForRep('rep1');
  assert.equal(r.totals.earned, 0);
  assert.equal(r.best, null);
  assert.deepEqual(r.byBrand, []);
  assert.deepEqual(r.topProducts, []);
  assert.equal(r.settlement.onTimeRate, null);
  assert.ok(!JSON.stringify(r).includes('NaN'));
});
