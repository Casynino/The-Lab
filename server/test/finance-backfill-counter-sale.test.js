'use strict';

// ── The Finance self-heal banks what a counter sale was PAID, not its total (12 Nov 2026) ─────────────
// recordSaleIncome posts a counter sale's amountPaid ("what actually reached the till"), and nothing for
// an unpaid one. The backfill re-created a missing row at the sale's TOTAL, so an unpaid counter sale got
// money in that nobody handed over — and a customer refund on it (which takes off only the cash that
// goes back) left that phantom money in the account. A settled rep sale still banks its total.

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://stub@localhost:1/none';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only';

const stub = (rel, exports) => {
  const f = require.resolve(rel);
  require.cache[f] = { id: f, filename: f, loaded: true, exports };
};

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

test('backfill: a counter sale banks its amountPaid, an unpaid one nothing, a settled rep sale its total', async () => {
  const created = [];
  const sales = [
    { id: 'paid', saleNumber: 'S-1', total: 100000, amountPaid: 100000, soldAt: new Date(), settlementId: null },
    { id: 'part', saleNumber: 'S-2', total: 140000, amountPaid: 50000, soldAt: new Date(), settlementId: null },
    { id: 'unpaid', saleNumber: 'S-3', total: 105000, amountPaid: 0, soldAt: new Date(), settlementId: null },
    { id: 'settled', saleNumber: 'S-4', total: 70000, amountPaid: 0, soldAt: new Date(), settlementId: 'st1' },
  ];
  stub('../src/config/prisma', db({
    businessAccount: {
      count: async () => 1,
      findFirst: async () => ({ id: 'acc-1', name: 'Cash', isActive: true }),
      findMany: async () => [],
    },
    expenseCategory: { count: async () => 1 },
    sale: { findMany: async () => sales },
    financeTransaction: { create: async ({ data }) => { created.push(data); return data; } },
  }));
  stub('../src/services/reports.service', { financeEpoch: async () => null });
  stub('../src/services/inventory.service', {});
  stub('../src/services/commission.service', {});
  delete require.cache[require.resolve('../src/services/finance.service')];
  const finance = require('../src/services/finance.service');

  await finance.backfillFromHistory();
  const byRef = Object.fromEntries(created.filter((r) => r.refType === 'Sale').map((r) => [r.refId, r.amount]));
  assert.deepEqual(byRef, { paid: 100000, part: 50000, settled: 70000 });
});
