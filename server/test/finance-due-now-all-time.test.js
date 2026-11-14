'use strict';

// ── What the supplier is owed today does not depend on the period chip ────────
// The overview's "Whose money is this?" block worked out each wallet's
// "due now" from the SELECTED period's cost of sales, while the bill and the
// payments it was set against are all-time. On the same day, for the same
// debt, "Today" said "none of it is due yet" (and gave the whole wallet to the
// owner) and "All time" said 2,717,500 was due now. The balance sheet on the
// same page already used all-time cost, so the page quoted two figures.
//
// This runs the real overview() over a stubbed database: one brand, one
// supplier, one wallet. The period changes only what the brand SOLD in the
// window; what is owed, due, set aside and his must stay put.

const test = require('node:test');
const assert = require('node:assert');

// The database is stubbed below; these only satisfy config/env.js.
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://stub@localhost:1/none';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only';

const BRAND = 'brand-pepa';
const PERIOD_COST = { today: 1000000, week: 1500000, month: 2500000, all: 7717500 };
let supplierPaid = 5000000;
const PURCHASED = 17118000; // so 12,118,000 is still outstanding at 5,000,000 paid
const WALLET = 4688999;

const profitFor = (period) => {
  const cost = PERIOD_COST[period];
  const revenue = cost * 2;
  return {
    totals: { revenue, cost, profit: revenue - cost, commission: 0, boxes: 10 },
    byBrand: [{ brandId: BRAND, revenue, cost, profit: revenue - cost, contribution: revenue - cost, commission: 0, boxes: 10, margin: 50 }],
    byProduct: [],
  };
};

// Any model the overview touches and this test does not care about answers
// "nothing": no rows, zero sums. The ones that carry the story are named.
const zeroSum = new Proxy({}, { get: () => 0 });
const generic = () => ({
  findMany: async () => [],
  findFirst: async () => null,
  findUnique: async () => null,
  count: async () => 0,
  aggregate: async () => ({ _sum: zeroSum, _count: 0, _max: {} }),
  groupBy: async () => [],
  create: async () => ({}),
  createMany: async () => ({ count: 0 }),
  update: async () => ({}),
});
const named = {
  businessAccount: {
    ...generic(),
    count: async () => 1,
    findMany: async () => [{ id: 'acc-1', name: 'Pepa M-Pesa', type: 'MOBILE_MONEY', brandId: BRAND, isActive: true, openingBalance: WALLET }],
  },
  expenseCategory: { ...generic(), count: async () => 1 },
  brand: { ...generic(), findMany: async () => [{ id: BRAND, name: 'Pepa' }] },
  supplier: { ...generic(), findMany: async () => [{ id: 'sup-1', name: 'Bonge', brandId: BRAND, isActive: true }] },
  purchaseOrder: {
    ...generic(),
    findMany: async () => [{ id: 'po-1', supplierId: 'sup-1', totalCost: PURCHASED, receivedAt: null, createdAt: new Date('2026-10-01') }],
    aggregate: async () => ({ _sum: { totalCost: PURCHASED } }),
  },
  financeTransaction: {
    ...generic(),
    // Supplier payments: keyed to the PO in supplierSummaries, and in the
    // overview's own aggregate of what has been paid.
    groupBy: async ({ where }) => (where && where.refType === 'PurchaseOrder'
      ? [{ refId: 'po-1', _sum: { amount: supplierPaid } }]
      : []),
    aggregate: async ({ where }) => (where && Array.isArray(where.OR) && where.OR.some((c) => c.refType === 'PurchaseOrder')
      ? { _sum: { amount: supplierPaid } }
      : { _sum: zeroSum, _count: 0 }),
  },
};
const prismaStub = new Proxy(named, { get: (t, k) => (k in t ? t[k] : (t[k] = generic())) });

const install = (path, exports) => {
  const filename = require.resolve(path);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
};
install('../src/config/prisma', prismaStub);
install('../src/services/reports.service', { financeEpoch: async () => null, profitOverview: async (p) => profitFor(p) });
install('../src/services/inventory.service', {
  valuation: async () => ({ items: [], totals: { totalValue: 0, warehouseValue: 0, repValue: 0, retailValue: 0, totalBaseUnits: 0 } }),
});
install('../src/services/commission.service', { summaryAllReps: async () => ({ totals: { available: 0, requested: 0 } }) });
// The reps' bonus wallets (14 Nov 2026), read only by Finance. Nil unless a test sets them.
let bonusTotals = { available: 0, pending: 0, paid: 0, earned: 0 };
let bonusHeal = null;
install('../src/services/bonus.service', { summaryAllReps: async (o) => { bonusHeal = o && o.heal; return { items: [], totals: bonusTotals }; } });

const finance = require('../src/services/finance.service');

const PERIODS = ['today', 'week', 'month', 'all'];

test('due now, set aside and "yours" are the same on every period chip', async () => {
  supplierPaid = 5000000;
  for (const period of PERIODS) {
    const o = await finance.overview(period);
    const s = o.cashSplit;
    const [b] = s.buckets;
    // 7,717,500 of boxes sold all time, 5,000,000 paid: 2,717,500 is due.
    assert.equal(s.dueNow, 2717500, `${period}: due now`);
    assert.equal(s.owedTotal, 12118000, `${period}: the whole bill`);
    assert.equal(s.setAside, 2717500, `${period}: set aside`);
    assert.equal(s.yours, WALLET - 2717500, `${period}: yours`);
    assert.equal(s.paidAhead, 0, `${period}: nothing paid ahead`);
    assert.equal(b.dueLater, 12118000 - 2717500, `${period}: due later`);
    // ...and it is the balance sheet's figure, not a second opinion.
    assert.equal(s.dueNow, o.capital.owes.suppliers.dueNow, `${period}: matches the balance sheet`);
    // What the brand SOLD stays the period's.
    assert.equal(b.costOfSold, PERIOD_COST[period], `${period}: cost of sales is the period's`);
    assert.equal(b.revenue, PERIOD_COST[period] * 2, `${period}: revenue is the period's`);
  }
});

test('paid ahead is measured against everything sold, not the period', async () => {
  supplierPaid = 9000000; // more than the 7,717,500 of boxes ever sold
  for (const period of PERIODS) {
    const s = (await finance.overview(period)).cashSplit;
    assert.equal(s.dueNow, 0, `${period}: nothing due`);
    assert.equal(s.paidAhead, 1282500, `${period}: paid ahead`);
    assert.equal(s.setAside, 0, `${period}: nothing to set aside`);
    assert.equal(s.yours, WALLET, `${period}: the wallet is his`);
  }
});

test('a credited bonus and a bonus withdrawal not yet paid are owed to the reps; Finance never credits', async () => {
  supplierPaid = 5000000;
  const before = await finance.overview('all');
  bonusTotals = { available: 1000000, pending: 500000, paid: 1500000, earned: 3000000 };
  const o = await finance.overview('all');
  assert.equal(bonusHeal, false, 'Finance reads the bonus wallets without crediting');
  assert.equal(o.capital.owes.reps, before.capital.owes.reps + 1500000);
  assert.equal(o.outstandingCommission, o.capital.owes.reps, 'one figure in both places');
  assert.equal(o.capital.left, before.capital.left - 1500000);
  bonusTotals = { available: 0, pending: 0, paid: 0, earned: 0 };
});
