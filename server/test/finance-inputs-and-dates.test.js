'use strict';

// ── Finance inputs and dates, audit round 3 (11 Nov 2026) ──────────────────────────────────────────────
// Pinned: a hand-typed entry cannot carry the links that tie a row to a sale, an order, a supplier or a
// payout, cannot put one brand's money on another brand's account, and is shape-checked before it
// reaches the ledger (#79). A date picked in a finance form is a Tanzanian day: "today" at 01:30 EAT
// stays today, and correcting a row from the small hours neither moves nor re-times it (#62).

const test = require('node:test');
const assert = require('node:assert/strict');

const stub = (rel, exports) => {
  const f = require.resolve(rel);
  require.cache[f] = { id: f, filename: f, loaded: true, exports };
};

const OHIS = 'brand-ohis';
const CIVLILY = 'brand-civlily';
const accounts = new Map([
  ['acc-mpesa', { id: 'acc-mpesa', name: 'M-Pesa', type: 'MOBILE_MONEY', brandId: OHIS, isActive: true }],
  ['acc-bank', { id: 'acc-bank', name: 'Bank', type: 'BANK', brandId: null, isActive: true }],
]);
const created = [];
const updates = [];
let existingRow = null;
stub('../src/config/prisma', {
  businessAccount: { findUnique: async ({ where }) => accounts.get(where.id) || null },
  financeTransaction: {
    findMany: async () => [],
    create: async ({ data }) => { created.push(data); return { id: `t${created.length}`, ...data }; },
    findUnique: async () => existingRow,
    findFirst: async () => null,
    update: async ({ data }) => { updates.push(data); return { ...existingRow, ...data }; },
  },
});
stub('../src/services/reports.service', { financeEpoch: async () => null });
const finance = require('../src/services/finance.service');
const v = require('../src/validators/finance.validator');

const reset = () => { created.length = 0; updates.length = 0; };

// ── #79 ──────────────────────────────────────────────────────────────────────────────────────────────
test('a hand-typed entry never keeps a link to a sale, order, supplier or payout', async () => {
  reset();
  const body = v.financeMoney.body.parse({
    accountId: 'acc-bank', amount: 5000, category: 'Fuel', refType: 'PurchaseOrder', refId: 'po-1', type: 'SETTLEMENT', createdById: 'x',
  });
  assert.deepEqual(Object.keys(body).sort(), ['accountId', 'amount', 'category']);

  // And the service drops them even when called without the route in front of it.
  await finance.recordExpense({ accountId: 'acc-bank', amount: 5000, category: 'Fuel', refType: 'PurchaseOrder', refId: 'po-1' }, null);
  await finance.recordIncome({ accountId: 'acc-bank', amount: 7000, refType: 'Sale', refId: 's-1' }, null);
  await finance.recordOwnerMoney({ direction: 'IN', accountId: 'acc-bank', amount: 9000, refType: 'CommissionWithdrawal', refId: 'w-1' }, null);
  created.forEach((row) => {
    assert.equal(row.refType, null);
    assert.equal(row.refId, null);
  });
  assert.deepEqual(created.map((r) => r.type), ['EXPENSE', 'INCOME', 'OWNER_CONTRIBUTION']);
});

test('a brand-reserved account takes only its own brand\'s money on a new entry, as it already did on a correction', async () => {
  reset();
  for (const record of [finance.recordExpense, finance.recordIncome]) {
    await assert.rejects(record({ accountId: 'acc-mpesa', amount: 1000, category: 'Fuel', brandId: CIVLILY }, null),
      (e) => e.statusCode === 400 && /M-Pesa is reserved for another brand/.test(e.message));
  }
  await assert.rejects(finance.recordOwnerMoney({ direction: 'OUT', accountId: 'acc-mpesa', amount: 1000, brandId: CIVLILY }, null), /reserved/);
  assert.equal(created.length, 0);

  // Its own brand, no brand at all, or a general account: all as before.
  await finance.recordExpense({ accountId: 'acc-mpesa', amount: 1000, category: 'Fuel', brandId: OHIS }, null);
  await finance.recordExpense({ accountId: 'acc-mpesa', amount: 1000, category: 'Fuel' }, null);
  await finance.recordIncome({ accountId: 'acc-bank', amount: 1000, brandId: CIVLILY }, null);
  assert.equal(created.length, 3);
});

test('finance bodies are shape-checked, and every form\'s real payload still passes', () => {
  // What the Finance screens send today (client/src/pages/Finance.jsx).
  v.financeMoney.body.parse({ accountId: 'acc-bank', amount: 5000, category: 'Fuel', description: 'Diesel', occurredAt: '2026-11-11', notes: undefined, brandId: undefined });
  v.financeMoney.body.parse({ accountId: 'acc-bank', amount: 5000, occurredAt: '' }); // a cleared date field
  v.financeOwnerMoney.body.parse({ direction: 'IN', amount: 100, accountId: 'acc-bank', occurredAt: '2026-11-11', description: 'Owner put money in' });
  v.financeAdjustment.body.parse({ accountId: 'acc-bank', direction: 'OUT', amount: 250, description: 'Fix', notes: 'Corrected from TZS 1 to TZS 0.' });
  v.financeTransfer.body.parse({ fromAccountId: 'acc-bank', toAccountId: 'acc-mpesa', amount: 10, notes: '' });
  v.financeTxnUpdate.body.parse({ accountId: 'acc-bank', brandId: null, amount: 10, occurredAt: '2026-11-11', description: 'x', reason: 'typo' });
  v.financeSupplierPayment.body.parse({ purchaseOrderId: 'po-1', accountId: 'acc-bank', amount: 10, occurredAt: '2026-11-11', notes: undefined });
  v.financeSupplierBalancePayment.body.parse({ accountId: 'acc-bank', amount: 10, occurredAt: '2026-11-11' });
  v.financeSupplierCredit.body.parse({ amount: 10, reason: 'Damaged boxes' });
  v.financeAccountCreate.body.parse({ name: 'Equity', type: 'BANK', openingBalance: 0, notes: undefined, brandId: undefined });
  v.financeCategoryCreate.body.parse({ name: 'Repairs' });

  // What they refuse: a word for an amount, an unknown direction, a date that is not one, an object for an id.
  assert.throws(() => v.financeMoney.body.parse({ accountId: 'acc-bank', amount: 'lots' }));
  assert.throws(() => v.financeAdjustment.body.parse({ accountId: 'acc-bank', amount: 5, direction: 'SIDEWAYS' }));
  assert.throws(() => v.financeMoney.body.parse({ accountId: 'acc-bank', amount: 5, occurredAt: 'yesterday' }));
  assert.throws(() => v.financeTransfer.body.parse({ fromAccountId: { id: 1 }, toAccountId: 'acc-bank', amount: 5 }));
  assert.throws(() => v.financeSupplierPayment.body.parse({ accountId: 'acc-bank', amount: 5 })); // which order?
  assert.throws(() => v.financeTxnUpdate.body.parse({ amount: null })); // a correction cannot wipe an amount
});

test('the finance routes run the checks before the controller', () => {
  stub('../src/middleware/auth', { authenticate: (_req, _res, next) => next() });
  const router = require('../src/routes/finance.routes');
  const handlersOf = (method, path) => router.stack
    .find((l) => l.route && l.route.path === path && l.route.methods[method]).route.stack.map((s) => s.handle);
  for (const [method, path] of [
    ['post', '/income'], ['post', '/expenses'], ['post', '/owner-money'], ['post', '/adjustments'], ['post', '/transfers'],
    ['put', '/transactions/:id'], ['post', '/supplier-payments'], ['post', '/suppliers/:id/pay'], ['post', '/suppliers/:id/credits'],
    ['post', '/accounts'], ['put', '/accounts/:id'], ['post', '/categories'],
  ]) {
    assert.ok(handlersOf(method, path).length >= 2, `${method.toUpperCase()} ${path} has no check in front of it`);
  }
  // The income route's check strips the links before the controller sees the body.
  const [check] = handlersOf('post', '/income');
  const req = { body: { accountId: 'acc-bank', amount: 5, refType: 'Sale', refId: 's-1' } };
  let passed = false;
  check(req, {}, (err) => { assert.ifError(err); passed = true; });
  assert.ok(passed);
  assert.equal(req.body.refType, undefined);
  assert.equal(req.body.refId, undefined);
});

// ── #62 ──────────────────────────────────────────────────────────────────────────────────────────────
// 22:30 UTC on 11 November is 01:30 on 12 November in Dar es Salaam.
const NOW = new Date('2026-11-11T22:30:00.000Z');

test('a day picked in a finance form is Tanzania\'s: today at 01:30 EAT is recorded as now, not tomorrow', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  reset();
  await finance.recordIncome({ accountId: 'acc-bank', amount: 1000, occurredAt: '2026-11-12' }, null);
  assert.equal(created[0].occurredAt.toISOString(), NOW.toISOString());
  // An earlier day keeps the time of day it is in Tanzania now.
  await finance.recordExpense({ accountId: 'acc-bank', amount: 1000, category: 'Fuel', occurredAt: '2026-11-10' }, null);
  assert.equal(created[1].occurredAt.toISOString(), '2026-11-09T22:30:00.000Z'); // 10 Nov, 01:30 EAT
  // No date, or a full timestamp: as before.
  await finance.recordIncome({ accountId: 'acc-bank', amount: 1000 }, null);
  assert.equal(created[2].occurredAt.toISOString(), NOW.toISOString());
  await finance.recordIncome({ accountId: 'acc-bank', amount: 1000, occurredAt: '2026-11-01T08:00:00.000Z' }, null);
  assert.equal(created[3].occurredAt.toISOString(), '2026-11-01T08:00:00.000Z');
});

test('correcting a row from the small hours neither moves it nor re-times it', async () => {
  // Recorded at 01:30 EAT on 12 November; the correction form shows (and sends back) 12 November.
  existingRow = { id: 'tx1', type: 'EXPENSE', accountId: 'acc-bank', brandId: null, amount: 1000, refType: null, occurredAt: new Date('2026-11-11T22:30:00.000Z') };
  reset();
  await finance.updateTransaction('tx1', { description: 'Diesel', occurredAt: '2026-11-12' });
  assert.equal('occurredAt' in updates[0], false, 'saving the day it already is moved the row');

  // Moved to another day, it keeps its own time of day on the business's clock.
  await finance.updateTransaction('tx1', { occurredAt: '2026-11-14' });
  assert.equal(updates[1].occurredAt.toISOString(), '2026-11-13T22:30:00.000Z'); // 14 Nov, 01:30 EAT
});
