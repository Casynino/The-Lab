'use strict';

// ── "Correct balance" is worked out on the server (audit freshness-1, second round) ─────────────────────
// The window used to send the difference it had worked out itself, so money that landed between its last
// read and the write (a settlement approved, a payout, a second admin's correction) left the account at a
// figure nobody typed. Now it sends what the account really holds and the balance it showed; the server
// locks the account, reads its balance by the screens' own formula, writes nothing if that is no longer the
// balance shown, and otherwise records target − live. The old { direction, amount } body still works.
// The lock itself was also run once against a copy of the live database (raw SQL is not trusted to stubs).

const test = require('node:test');
const assert = require('node:assert/strict');

const stub = (rel, exports) => {
  const f = require.resolve(rel);
  require.cache[f] = { id: f, filename: f, loaded: true, exports };
};

const accounts = [
  { id: 'acc-airtel', name: 'Airtel', type: 'MOBILE_MONEY', brandId: null, isActive: true, openingBalance: 1000, currency: 'TZS' },
  { id: 'acc-old', name: 'Old till', type: 'CASH', brandId: null, isActive: false, openingBalance: 0, currency: 'TZS' },
];
const ledger = []; // { accountId, direction, amount }
const created = [];
const locks = [];
const tx = {
  $queryRaw: async (strings, ...values) => {
    locks.push({ sql: strings.join('?'), values });
    return accounts.some((a) => a.id === values[0]) ? [{ id: values[0] }] : [];
  },
  businessAccount: {
    count: async () => 1,
    findMany: async ({ where }) => accounts.filter((a) => a.isActive === where.isActive && (!where.id || a.id === where.id)),
    findUnique: async ({ where }) => accounts.find((a) => a.id === where.id) || null,
  },
  expenseCategory: { count: async () => 1 },
  financeTransaction: {
    // The second query (the off-account rows, it carries OR) finds none here.
    groupBy: async ({ where }) => {
      if (where.OR) return [];
      const sums = new Map();
      for (const r of ledger) {
        if (where.accountId && r.accountId !== where.accountId) continue;
        const k = `${r.accountId}|${r.direction}`;
        sums.set(k, (sums.get(k) || 0) + r.amount);
      }
      return [...sums].map(([k, v]) => {
        const [accountId, direction] = k.split('|');
        return { accountId, direction, _sum: { amount: v } };
      });
    },
    findMany: async () => [],
    create: async ({ data }) => { created.push(data); ledger.push({ accountId: data.accountId, direction: data.direction, amount: data.amount }); return { id: `t${created.length}`, ...data }; },
  },
};
stub('../src/config/prisma', { ...tx, $transaction: async (fn) => fn(tx) });
stub('../src/services/reports.service', { financeEpoch: async () => null });
const finance = require('../src/services/finance.service');
const v = require('../src/validators/finance.validator');

const reset = () => { ledger.length = 0; created.length = 0; locks.length = 0; };

test('the difference is worked out from the balance at the moment of writing, under a lock on the account', async () => {
  reset();
  ledger.push({ accountId: 'acc-airtel', direction: 'IN', amount: 4000 }); // balance 5,000
  const row = await finance.recordBalanceCorrection({ accountId: 'acc-airtel', targetBalance: 3500, expectedBalance: 5000 }, { id: 'u1' });
  assert.equal(row.type, 'ADJUSTMENT');
  assert.equal(row.direction, 'OUT');
  assert.equal(row.amount, 1500);
  assert.equal(locks.length, 1);
  assert.match(locks[0].sql, /FROM "business_accounts" WHERE id = \? FOR UPDATE/);
  assert.deepEqual(locks[0].values, ['acc-airtel']);
  // The balance is now exactly what the owner typed.
  const [after] = await finance.accountBalances({ accountId: 'acc-airtel' });
  assert.equal(after.balance, 3500);
});

test('money that moved since the window read the balance: nothing is written, the new balance comes back', async () => {
  reset();
  ledger.push({ accountId: 'acc-airtel', direction: 'IN', amount: 4000 }); // the window showed 5,000
  ledger.push({ accountId: 'acc-airtel', direction: 'IN', amount: 2000 }); // a settlement approved meanwhile: 7,000
  await assert.rejects(
    finance.recordBalanceCorrection({ accountId: 'acc-airtel', targetBalance: 3500, expectedBalance: 5000 }, null),
    (e) => e.statusCode === 409 && e.details?.code === 'BALANCE_MOVED' && e.details.balance === 7000
      && /Airtel changed to .*7,000/.test(e.message),
  );
  assert.equal(created.length, 0);
});

test('a second correction queued behind the first finds the first one written and is refused', async () => {
  reset(); // balance 1,000 (opening)
  await finance.recordBalanceCorrection({ accountId: 'acc-airtel', targetBalance: 800, expectedBalance: 1000 }, null);
  await assert.rejects(
    finance.recordBalanceCorrection({ accountId: 'acc-airtel', targetBalance: 900, expectedBalance: 1000 }, null),
    (e) => e.statusCode === 409 && e.details.balance === 800,
  );
  assert.equal(created.length, 1);
});

test('nothing to record when it already holds that; a missing or switched-off account is refused', async () => {
  reset();
  await assert.rejects(finance.recordBalanceCorrection({ accountId: 'acc-airtel', targetBalance: 1000, expectedBalance: 1000 }, null),
    (e) => e.statusCode === 400 && /already holds/.test(e.message));
  await assert.rejects(finance.recordBalanceCorrection({ accountId: 'nope', targetBalance: 10 }, null), (e) => e.statusCode === 400);
  await assert.rejects(finance.recordBalanceCorrection({ accountId: 'acc-old', targetBalance: 10 }, null), (e) => e.statusCode === 400);
  assert.equal(created.length, 0);
});

test('without the balance it showed, it still corrects to the target from the live balance (IN when short)', async () => {
  reset();
  const row = await finance.recordBalanceCorrection({ accountId: 'acc-airtel', targetBalance: 1250.5 }, null);
  assert.equal(row.direction, 'IN');
  assert.equal(row.amount, 250.5);
});

test('the body: target and shown balance are optional numbers, never "" read as 0; the old body is unchanged', () => {
  const body = v.financeAdjustment.body;
  assert.deepEqual(body.parse({ accountId: 'a', targetBalance: '3500', expectedBalance: 5000 }),
    { accountId: 'a', targetBalance: 3500, expectedBalance: 5000 });
  assert.equal(body.safeParse({ accountId: 'a', targetBalance: '' }).success, false);
  assert.equal(body.safeParse({ accountId: 'a', targetBalance: 'abc' }).success, false);
  assert.deepEqual(body.parse({ accountId: 'a', direction: 'OUT', amount: 2000 }), { accountId: 'a', direction: 'OUT', amount: 2000 });
});
