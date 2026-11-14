'use strict';

// ── Report figures, audit round 3 (11 Nov 2026) ────────────────────────────────────────────────────────
// Pinned: "Commission paid" in the weekly and monthly reports is money actually handed over, counted in
// the period it was handed over — an approved-but-unpaid withdrawal is not in it, and one approved in
// one week and paid the next is counted once (#81). The sales report's days, weeks and months are
// Tanzania's, not the server's (#82).

// The server's clock on Vercel. Set before anything date-shaped loads, so the test means the same on a
// laptop in Dar es Salaam as it does on the server.
process.env.TZ = 'UTC';

const test = require('node:test');
const assert = require('node:assert/strict');

const stub = (rel, exports) => {
  const f = require.resolve(rel);
  require.cache[f] = { id: f, filename: f, loaded: true, exports };
};
const fresh = (rel) => {
  delete require.cache[require.resolve(rel)];
  return require(rel);
};

// Just enough of Prisma's `where` to read the withdrawal filters: equality, { in }, null, date ranges, OR.
function matches(row, where) {
  return Object.entries(where).every(([k, v]) => {
    if (k === 'OR') return v.some((w) => matches(row, w));
    if (v === null) return row[k] == null;
    if (v && typeof v === 'object' && Array.isArray(v.in)) return v.in.includes(row[k]);
    if (v && typeof v === 'object' && ('gte' in v || 'lte' in v)) {
      return row[k] != null && (!v.gte || row[k] >= v.gte) && (!v.lte || row[k] <= v.lte);
    }
    return row[k] === v;
  });
}
const at = (iso) => new Date(iso);

function stubReportDeps(withdrawals) {
  // Every withdrawal before 14 Nov 2026 is COMMISSION (the column's default); a BONUS payout is not commission paid.
  withdrawals.forEach((w) => { if (!w.source) w.source = 'COMMISSION'; });
  const count = async () => 0;
  stub('../src/config/prisma', {
    setting: { findUnique: async () => null },
    whatsAppNotification: { findFirst: async () => null },
    $transaction: (list) => Promise.all(list),
    stockRequest: { count }, settlementSubmission: { count }, return: { count },
    inventoryTransaction: { groupBy: async () => [], aggregate: async () => ({ _sum: { baseQuantity: 0 } }) },
    commissionWithdrawal: {
      aggregate: async ({ where }) => ({
        _sum: { amount: withdrawals.filter((w) => matches(w, where)).reduce((s, w) => s + w.amount, 0) },
      }),
      groupBy: async ({ where }) => {
        const by = new Map();
        withdrawals.filter((w) => matches(w, where)).forEach((w) => by.set(w.salesRepId, (by.get(w.salesRepId) || 0) + w.amount));
        return [...by].map(([salesRepId, amount]) => ({ salesRepId, _sum: { amount } }));
      },
    },
  });
  const report = { revenue: 0, cogs: 0, grossProfit: 0, expenses: 0, netProfit: 0, cashFlow: { moneyIn: 0, moneyOut: 0, net: 0 }, boxesSold: 0, topProducts: [] };
  stub('../src/services/finance.service', {
    report: async () => report, cashflow: async () => ({ closingBalance: 0 }), accountBalances: async () => [], supplierSummaries: async () => [],
  });
  stub('../src/services/reports.service', { profitOverview: async () => ({ byBrand: [], byProduct: [] }) });
  stub('../src/services/inventory.service', { valuation: async () => ({}) });
  stub('../src/services/reorder.service', { lowStock: async () => [] });
  stub('../src/services/settlement.service', { summary: async () => ({ overdueCount: 0 }) });
  stub('../src/services/reportData.service', {
    periodExtras: async () => ({ reps: [{ id: 'r1', name: 'Rep One' }, { id: 'r2', name: 'Rep Two' }], prev: null }),
    stockBlock: () => ({ costValue: 0, units: 0 }),
  });
  stub('../src/services/commission.service', { summaryAllReps: async () => ({ items: [] }), earnedBetween: async () => ({ total: 0, byRep: new Map() }) });
}

// ── #81 weekly ───────────────────────────────────────────────────────────────────────────────────────
// Week 2026-W02 is Mon 5 – Sun 11 January; W03 is 12 – 18 January.
test('weekly "Commission paid": paid money only, in the week it was paid, and once', async () => {
  const paidInW02 = { salesRepId: 'r1', amount: 50000, status: 'PAID', decidedAt: at('2026-01-07T07:00:00Z'), paidAt: at('2026-01-07T07:00:00Z') };
  const approvedOnly = { salesRepId: 'r1', amount: 70000, status: 'APPROVED', decidedAt: at('2026-01-07T08:00:00Z'), paidAt: null };
  const legacyPaid = { salesRepId: 'r2', amount: 20000, status: 'PAID', decidedAt: at('2026-01-06T09:00:00Z'), paidAt: null };
  // Approved in W02, paid in W03: while the W02 report is built it is still only approved…
  const later = { salesRepId: 'r2', amount: 30000, status: 'APPROVED', decidedAt: at('2026-01-08T09:00:00Z'), paidAt: null };
  const bonusPaid = { salesRepId: 'r1', amount: 500000, status: 'PAID', source: 'BONUS', decidedAt: at('2026-01-07T09:00:00Z'), paidAt: at('2026-01-07T09:00:00Z') };
  const rows = [paidInW02, approvedOnly, legacyPaid, later, bonusPaid];
  stubReportDeps(rows);
  const weekly = fresh('../src/services/weeklyReport.service');

  assert.equal((await weekly.buildWeeklyData('2026-W02')).commission.paid, 70000);

  // …then it is paid on 14 January (paying moves decidedAt too), and counts in W03 — and only there.
  Object.assign(later, { status: 'PAID', decidedAt: at('2026-01-14T09:00:00Z'), paidAt: at('2026-01-14T09:00:00Z') });
  assert.equal((await weekly.buildWeeklyData('2026-W03')).commission.paid, 30000);
  assert.equal((await weekly.buildWeeklyData('2026-W02')).commission.paid, 70000);
});

// ── #81 monthly (and the yearly report, which shares the same body) ─────────────────────────────────
test('monthly "Commission paid" per rep: paid in the month on the business\'s clock, approved-only left out', async () => {
  stubReportDeps([
    { salesRepId: 'r1', amount: 50000, status: 'PAID', decidedAt: at('2026-01-10T07:00:00Z'), paidAt: at('2026-01-10T07:00:00Z') },
    { salesRepId: 'r1', amount: 40000, status: 'APPROVED', decidedAt: at('2026-01-20T07:00:00Z'), paidAt: null },
    { salesRepId: 'r2', amount: 10000, status: 'PAID', decidedAt: at('2026-01-15T07:00:00Z'), paidAt: null },
    // 01:00 EAT on 1 February: February's money.
    { salesRepId: 'r2', amount: 90000, status: 'PAID', decidedAt: at('2026-01-31T22:00:00Z'), paidAt: at('2026-01-31T22:00:00Z') },
    // A bonus payout is not commission paid (14 Nov 2026).
    { salesRepId: 'r1', amount: 500000, status: 'PAID', source: 'BONUS', decidedAt: at('2026-01-12T07:00:00Z'), paidAt: at('2026-01-12T07:00:00Z') },
  ]);
  const monthly = fresh('../src/services/monthlyReport.service');
  const d = await monthly.buildMonthlyData('2026-01');
  const paidBy = new Map(d.repPerformance.map((r) => [r.id, r.commissionPaid]));
  assert.equal(paidBy.get('r1'), 50000);
  assert.equal(paidBy.get('r2'), 10000);
  assert.equal(d.commission.paid, 60000);
});

// ── #82 sales report buckets ─────────────────────────────────────────────────────────────────────────
test('the sales report puts a sale on the Tanzanian day, week and month it happened', async () => {
  const sales = [
    { soldAt: at('2026-08-31T22:30:00Z'), total: 1000, costTotal: 400, discount: 0, type: 'CASH' }, // Tue 1 Sep, 01:30 EAT
    { soldAt: at('2026-08-31T12:00:00Z'), total: 500, costTotal: 200, discount: 0, type: 'CASH' }, // Mon 31 Aug, 15:00 EAT
    { soldAt: at('2026-09-06T21:30:00Z'), total: 200, costTotal: 100, discount: 0, type: 'CASH' }, // Mon 7 Sep, 00:30 EAT
  ];
  stub('../src/config/prisma', {
    setting: { findUnique: async () => null },
    sale: { findMany: async () => sales },
  });
  const reports = fresh('../src/services/reports.service');
  const series = async (groupBy) => (await reports.salesReport({ from: '2026-08-01', to: '2026-09-30', groupBy })).series
    .map((b) => [b.period, b.revenue]);

  assert.deepEqual(await series('day'), [['2026-08-31', 500], ['2026-09-01', 1000], ['2026-09-07', 200]]);
  assert.deepEqual(await series('month'), [['2026-08', 500], ['2026-09', 1200]]);
  // 31 Aug and 1 Sep share ISO week 36; Monday 7 Sep opens week 37.
  assert.deepEqual(await series('week'), [['2026-W36', 1500], ['2026-W37', 200]]);
});
