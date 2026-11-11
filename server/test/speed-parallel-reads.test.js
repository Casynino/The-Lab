'use strict';

// ── Faster pages, same figures (11 Nov 2026) ─────────────────────────────────
// From Tanzania every page waits on the server, and the slowest server answers
// (Dashboard, Finance, Commissions, Sales reps) were slow because reads that do
// not depend on each other were made one after another: every rep's commission
// in turn, Finance's four periods in turn, and the same heavy blocks worked out
// two or three times in one dashboard request. They are now asked for together
// or once. These tests pin the rules that keep the figures identical:
//   - rows still come out in the reps' own order (so ties and totals are unchanged);
//   - the Finance self-heal runs once for the overview and cash flow opened together,
//     and again on the next request (a missed ledger row is still picked up);
//   - one dashboard load values the stock, sums the reps' commission and reads
//     the suppliers once, not two or three times.

const test = require('node:test');
const assert = require('node:assert/strict');

// The database is stubbed below; these only satisfy config/env.js.
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://stub@localhost:1/none';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only';

const stub = (rel, exports) => {
  const f = require.resolve(rel);
  require.cache[f] = { id: f, filename: f, loaded: true, exports };
};
const fresh = (rel) => {
  delete require.cache[require.resolve(rel)];
  return require(rel);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// A database where every table answers "nothing" unless a test names it.
function db(tables = {}) {
  const empty = {
    findMany: async () => [], findFirst: async () => null, findUnique: async () => null,
    count: async () => 0, groupBy: async () => [], aggregate: async () => ({ _sum: {}, _count: 0 }),
    create: async () => ({}), createMany: async () => ({ count: 0 }), update: async () => ({}),
  };
  return new Proxy({}, {
    get(_t, name) {
      if (name === 'then') return undefined;
      if (name === '$transaction') return async (ops) => Promise.all(ops);
      return { ...empty, ...(tables[name] || {}) };
    },
  });
}

// How many calls were in flight at once: >1 proves the reads overlapped.
function gauge() {
  let now = 0;
  let max = 0;
  return {
    async run(fn) {
      now += 1; max = Math.max(max, now);
      try { return await fn(); } finally { now -= 1; }
    },
    get max() { return max; },
  };
}

stub('../src/services/notification.service', {
  notifyUser: async () => {}, notifyAdmins: async () => {}, createIfAbsent: async () => {},
});
stub('../src/services/penalty.service', { penaltyBreakdownForRep: async () => ({ total: 0, breakdown: [] }) });

test('commission for every rep is read at once, but the list and totals come out exactly as before', async () => {
  // The slowest rep answers last; rows must still follow the reps' order, so a tie keeps its place.
  const reps = [
    { id: 'r1', code: 'A', isActive: true, user: { name: 'Asha' }, adjustment: 50000, delay: 40 },
    { id: 'r2', code: 'B', isActive: true, user: { name: 'Baraka' }, adjustment: 50000, delay: 25 },
    { id: 'r3', code: 'C', isActive: true, user: { name: 'Chausiku' }, adjustment: 90000, delay: 10 },
    { id: 'r4', code: 'D', isActive: true, user: { name: 'Daudi' }, adjustment: 0, delay: 1 },
  ];
  const byId = new Map(reps.map((r) => [r.id, r]));
  const g = gauge();
  stub('../src/config/prisma', db({
    salesRepresentative: {
      findMany: async () => reps,
      findUnique: ({ where }) => g.run(async () => {
        const r = byId.get(where.id);
        await wait(r.delay);
        return { withdrawalThreshold: null, commissionAdjustment: r.adjustment, earnsCommission: true };
      }),
    },
  }));
  const commission = fresh('../src/services/commission.service');

  const s = await commission.summaryAllReps();
  assert.ok(g.max > 1, 'the reps were read at the same time');
  assert.deepEqual(s.items.map((i) => i.salesRepId), ['r3', 'r1', 'r2', 'r4'], 'by earned, ties in the reps\' order');
  assert.deepEqual(s.items.map((i) => i.earned), [90000, 50000, 50000, 0]);
  assert.equal(s.totals.earned, 190000);
  assert.equal(s.totals.available, 190000);
});

test('bonus progress for every rep is read at once and keeps the reps\' order', async () => {
  const reps = [
    { id: 'b1', code: 'A', isActive: true, user: { name: 'Asha' }, delay: 30 },
    { id: 'b2', code: 'B', isActive: true, user: { name: 'Baraka' }, delay: 15 },
    { id: 'b3', code: 'C', isActive: true, user: { name: null }, delay: 1 },
  ];
  const byId = new Map(reps.map((r) => [r.id, r]));
  const g = gauge();
  stub('../src/config/prisma', db({
    salesRepresentative: { findMany: async () => reps },
    bonusRule: { findMany: async () => [{ id: 't1', salesTarget: 1000000, bonusAmount: 50000, effectiveFrom: new Date('2026-01-01'), isActive: true }] },
    bonusAward: { findFirst: ({ where }) => g.run(async () => { await wait(byId.get(where.salesRepId).delay); return null; }) },
  }));
  const bonus = fresh('../src/services/bonus.service');

  const s = await bonus.summaryAllReps();
  assert.ok(g.max > 1, 'the reps were read at the same time');
  assert.deepEqual(s.items.map((i) => i.salesRepId), ['b1', 'b2', 'b3']);
  assert.deepEqual(s.items.map((i) => i.name), ['Asha', 'Baraka', 'C'], 'a rep with no name shows the code, as before');
});

// ── Finance ──────────────────────────────────────────────────────────────────
function financeWorld() {
  const counts = { backfill: 0, valuation: 0, summaryAllReps: 0, suppliers: 0 };
  const flows = gauge();
  const prisma = db({
    businessAccount: {
      count: async () => 1,
      findFirst: async () => ({ id: 'acc-1', name: 'Cash', isActive: true }),
      findMany: async () => [{ id: 'acc-1', name: 'Cash', type: 'CASH', brandId: null, isActive: true, openingBalance: 100000 }],
      aggregate: async () => ({ _sum: { openingBalance: 100000 } }),
    },
    expenseCategory: { count: async () => 1 },
    // The self-heal's first read: counted, and slow enough for two callers to overlap.
    sale: { findMany: async ({ where } = {}) => { if (where && where.type === 'CASH') { counts.backfill += 1; await wait(20); } return []; } },
    supplier: { findMany: async () => { counts.suppliers += 1; return []; } },
    // Trade money in/out (the type: { notIn: [...] } reads): 1,000 in and 400 out in every window.
    // Everything else (the owner's own money, expenses) is nil here.
    financeTransaction: {
      aggregate: ({ where }) => flows.run(async () => {
        await wait(2);
        const trade = where && where.type && where.type.notIn;
        return { _sum: { amount: trade ? (where.direction === 'IN' ? 1000 : 400) : 0 }, _count: 0 };
      }),
    },
  });
  stub('../src/config/prisma', prisma);
  const profit = { totals: { revenue: 0, cost: 0, profit: 0, commission: 0, boxes: 0 }, byBrand: [], byProduct: [] };
  stub('../src/services/reports.service', {
    financeEpoch: async () => null,
    profitOverview: async () => profit,
    profitByPeriods: async () => null,
  });
  stub('../src/services/inventory.service', {
    valuation: async () => { counts.valuation += 1; return { items: [], totals: { totalValue: 0, retailValue: 0, totalBaseUnits: 0 } }; },
    repBalances: async () => [],
  });
  stub('../src/services/commission.service', {
    summaryAllReps: async () => { counts.summaryAllReps += 1; return { items: [], totals: { available: 0, requested: 0 } }; },
  });
  const finance = fresh('../src/services/finance.service');
  return { finance, counts, flows };
}

test('Finance opened together runs the self-heal once; the next request runs it again', async () => {
  const { finance, counts, flows } = financeWorld();

  const [o, cf] = await Promise.all([finance.overview('all'), finance.cashflow({ period: 'all' })]);
  assert.equal(counts.backfill, 1, 'overview and cash flow shared one pass');
  assert.ok(flows.max > 1, 'the money-in/out reads were sent together');
  // The figures are still worked out from those reads.
  assert.equal(o.flow.today.moneyIn, 1000);
  assert.equal(o.flow.all.net, 600);
  assert.deepEqual(Object.keys(o.flow), ['today', 'week', 'month', 'all']);
  assert.equal(cf.openingBalance, 100000);
  assert.equal(cf.moneyIn, 1000);
  assert.equal(cf.closingBalance, 100000 + 600);
  assert.equal(cf.series.length, 6);
  assert.ok(cf.series.every((m) => m.moneyIn === 1000 && m.net === 600));

  await finance.overview('month');
  assert.equal(counts.backfill, 2, 'a later request starts a fresh pass');
  await finance.backfillFromHistory();
  assert.equal(counts.backfill, 3, 'the explicit rebuild still runs its own pass');
});

test('a dashboard load values the stock, sums commission and reads suppliers once', async () => {
  const { counts } = financeWorld();
  stub('../src/services/settlement.service', { summary: async () => ({ overdueCount: 0, overdueValue: 0 }) });
  stub('../src/services/reorder.service', { lowStock: async () => [] });
  stub('../src/services/credit.service', {});
  stub('../src/services/stockCount.service', {});
  const dashboard = fresh('../src/services/dashboard.service');

  const d = await dashboard.command();
  assert.equal(counts.valuation, 1, 'stock valued once (was three times)');
  assert.equal(counts.summaryAllReps, 1, 'commission summed once (was twice)');
  assert.equal(counts.suppliers, 1, 'suppliers read once (was twice)');
  assert.equal(counts.backfill, 1);
  assert.equal(d.today.moneyIn, 1000);
  assert.equal(d.today.netCash, 600);
  assert.equal(d.totalFunds, 100000);

  // The Finance page and the Brands card on their own still read for themselves.
  await dashboard.brandBreakdown();
  assert.equal(counts.valuation, 2);
});
