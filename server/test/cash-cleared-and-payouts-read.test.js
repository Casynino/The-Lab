'use strict';

// ── THE LAST OF THE CASH, AND A PAYOUT THAT READS LIKE A TRANSACTION ─────────
// Two of the owner's instructions, pinned:
//
//   (A) "i dont know why this 46,000 is there but ... i really want to keep the
//       commission data". Migration 20260902000005 empties the Cash account by
//       re-filing what is on it, then retires it. The migration itself is SQL
//       and is proved against a real Postgres; what is pinned HERE is the
//       invariant it must not break — re-filing a row moves no money, and an
//       account is only ever deactivated at zero, because deactivating one that
//       still holds money deletes that money from every total on every screen.
//
//   (B) "when i pay commission show it on its account name and etc so i can
//       know just like other transactions". A payout is a full ledger row: the
//       Commission account by name, the amount, the rep it went to, the date —
//       and it is still absent from money in/out, because none moved.
//
// The database is swapped for an in-memory one running the SAME where-clauses
// the service sends, over real rows, so a filter that matched nothing (or
// everything) fails here rather than in production.

const test = require('node:test');
const assert = require('node:assert');

const rows = [];
const accounts = [];
const withdrawals = [];
let epoch = null;
let seq = 0;

function matches(row, where) {
  if (!where) return true;
  for (const [key, cond] of Object.entries(where)) {
    if (key === 'AND') { if (!cond.every((c) => matches(row, c))) return false; continue; }
    if (key === 'OR') { if (!cond.some((c) => matches(row, c))) return false; continue; }
    if (key === 'NOT') { if (matches(row, cond)) return false; continue; }
    const value = row[key];
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      for (const [op, operand] of Object.entries(cond)) {
        if (op === 'gte') { if (!(value >= operand)) return false; } else if (op === 'lte') { if (!(value <= operand)) return false; } else if (op === 'in') { if (!operand.includes(value)) return false; } else if (op === 'notIn') { if (operand.includes(value)) return false; } else if (op === 'not') { if (value === operand) return false; } else throw new Error(`stub: unsupported operator ${op}`);
      }
      continue;
    }
    if (value !== cond) return false;
  }
  return true;
}

const sortBy = (list, orderBy) => {
  const keys = [].concat(orderBy || []);
  return [...list].sort((a, b) => {
    for (const k of keys) {
      const [field, dir] = Object.entries(k)[0];
      if (a[field] === b[field]) continue;
      return (a[field] > b[field] ? 1 : -1) * (dir === 'desc' ? -1 : 1);
    }
    return 0;
  });
};

const prismaStub = {
  brand: { findMany: async () => [{ id: 'brand-ohis', name: 'OHIS' }, { id: 'brand-civlily', name: 'CIVILLY' }] },
  expenseCategory: { count: async () => 1 },
  commissionWithdrawal: {
    findMany: async ({ where } = {}) => withdrawals.filter((w) => matches(w, where)),
  },
  businessAccount: {
    count: async () => accounts.length,
    findMany: async ({ where, orderBy } = {}) => sortBy(accounts.filter((a) => matches(a, where)), orderBy),
    findFirst: async ({ where, orderBy } = {}) => sortBy(accounts.filter((a) => matches(a, where)), orderBy)[0] || null,
    findUnique: async ({ where }) => accounts.find((a) => matches(a, where)) || null,
    create: async ({ data }) => { const a = { id: `acc-${++seq}`, isActive: true, isDefault: false, openingBalance: 0, brandId: null, ...data }; accounts.push(a); return a; },
    update: async ({ where, data }) => { const a = accounts.find((x) => x.id === where.id); Object.assign(a, data); return a; },
  },
  financeTransaction: {
    count: async ({ where } = {}) => rows.filter((r) => matches(r, where)).length,
    findMany: async ({ where, include, skip = 0, take = 100, orderBy } = {}) => sortBy(rows.filter((r) => matches(r, where)), orderBy)
      .slice(skip, skip + take)
      .map((r) => (include?.account ? { ...r, account: accounts.find((a) => a.id === r.accountId) || null } : r)),
    create: async ({ data }) => { const t = { id: `txn-${++seq}`, refType: null, refId: null, brandId: null, ...data }; rows.push(t); return t; },
    groupBy: async ({ by, where, _sum }) => {
      const buckets = new Map();
      for (const r of rows.filter((x) => matches(x, where))) {
        const key = by.map((k) => r[k]).join(' ');
        const cur = buckets.get(key) || { row: r, sum: 0, n: 0 };
        cur.sum += Number(r.amount); cur.n += 1;
        buckets.set(key, cur);
      }
      return [...buckets.values()].map(({ row, sum, n }) => {
        const out = { _count: n };
        by.forEach((k) => { out[k] = row[k]; });
        if (_sum) out._sum = { amount: sum };
        return out;
      });
    },
    aggregate: async ({ where }) => ({ _sum: { amount: rows.filter((r) => matches(r, where)).reduce((a, r) => a + Number(r.amount), 0) } }),
  },
};

require.cache[require.resolve('../src/config/prisma')] = { id: 'prisma', filename: 'prisma', loaded: true, exports: prismaStub };
const reportsPath = require.resolve('../src/services/reports.service');
require.cache[reportsPath] = {
  id: reportsPath, filename: reportsPath, loaded: true,
  exports: { financeEpoch: async () => epoch, profitOverview: async () => ({ totals: { revenue: 0, cost: 0, profit: 0, margin: 0, boxes: 0, commission: 0 }, byProduct: [], byBrand: [] }) },
};

const finance = require('../src/services/finance.service');

const OHIS = 'brand-ohis';
const CIVLILY = 'brand-civlily';
const D = (s) => new Date(`${s}T09:00:00.000Z`);

let cash; let mpesa; let airtel; let commission;

// Production as the owner sees it TODAY: Cash still alive, still holding a
// 46,000 nobody can explain, with a commission payout parked on it too.
function reset() {
  rows.length = 0;
  accounts.length = 0;
  withdrawals.length = 0;
  epoch = null;
  cash = { id: 'acc-cash', name: 'Cash', type: 'CASH', brandId: null, isActive: true, isDefault: false, openingBalance: 0, sortOrder: 0, createdAt: D('2026-01-01') };
  mpesa = { id: 'acc-mpesa', name: 'M-Pesa', type: 'MOBILE_MONEY', brandId: OHIS, isActive: true, isDefault: false, openingBalance: 0, sortOrder: 1, createdAt: D('2026-01-01') };
  airtel = { id: 'acc-airtel', name: 'Airtel Money', type: 'MOBILE_MONEY', brandId: CIVLILY, isActive: true, isDefault: false, openingBalance: 0, sortOrder: 2, createdAt: D('2026-01-01') };
  commission = { id: 'acc-commission', name: 'Commission', type: 'COMMISSION', brandId: null, isActive: true, isDefault: false, openingBalance: 0, sortOrder: 90, createdAt: D('2026-01-01') };
  accounts.push(cash, mpesa, airtel, commission);
}

const add = (t) => { const r = { id: `txn-${++seq}`, refType: null, refId: null, brandId: null, ...t }; rows.push(r); return r; };
const account = (list, name) => list.find((a) => a.name === name);
// What the Accounts screen prints at the top: every ACTIVE wallet's balance.
// The commission record is not a wallet and is never inside it.
const position = (list) => Math.round(list.filter((a) => !a.isCommissionRecord).reduce((s, a) => s + a.balance, 0) * 100) / 100;

// What migration 20260902000005 does, expressed against the stub: re-file the
// rows, then deactivate Cash. Nothing is created, deleted, or re-priced.
function runMigration({ retireEvenIfHolding = false } = {}) {
  for (const r of rows) {
    if (r.accountId !== cash.id) continue;
    if (r.type === 'COMMISSION_PAYMENT' || (r.type === 'OWNER_CONTRIBUTION' && r.refType === 'CommissionWithdrawal')) {
      r.accountId = commission.id; // step 1 — the record lives in one place
      continue;
    }
    // steps 2a–2d — the evidence ladder. Whichever rung answers, the row keeps
    // its amount and its direction; only the account changes.
    r.accountId = r.brandId === CIVLILY ? airtel.id : mpesa.id;
  }
  const held = rows
    .filter((r) => r.accountId === cash.id && !(r.type === 'COMMISSION_PAYMENT' || (r.type === 'OWNER_CONTRIBUTION' && r.refType === 'CommissionWithdrawal')))
    .reduce((s, r) => s + (r.direction === 'IN' ? Number(r.amount) : -Number(r.amount)), Number(cash.openingBalance));
  if (held === 0 || retireEvenIfHolding) { cash.isActive = false; cash.isDefault = false; }
  return held;
}

// ── (A) The 46,000 moves pocket, not out of existence ───────────────────────
test('emptying Cash and retiring it leaves the total cash position identical', async () => {
  reset();
  add({ accountId: mpesa.id, direction: 'IN', type: 'SETTLEMENT', amount: 300000, occurredAt: D('2026-08-01'), refType: 'Sale', brandId: OHIS });
  add({ accountId: airtel.id, direction: 'IN', type: 'SETTLEMENT', amount: 120000, occurredAt: D('2026-08-01'), refType: 'Sale', brandId: CIVLILY });
  // The mixed-brand sale the previous migration refused to guess at.
  add({ accountId: cash.id, direction: 'IN', type: 'SETTLEMENT', amount: 46000, occurredAt: D('2026-08-02'), refType: 'Sale', refId: 'sale-mixed' });
  // A row that carries its own brand, and a payout parked on Cash beside them.
  add({ accountId: cash.id, direction: 'IN', type: 'INCOME', amount: 12000, occurredAt: D('2026-08-02'), brandId: CIVLILY });
  add({ accountId: cash.id, direction: 'OUT', type: 'COMMISSION_PAYMENT', amount: 501000, occurredAt: D('2026-08-03'), refType: 'CommissionWithdrawal', refId: 'wd-1' });

  const before = await finance.accountBalances();
  assert.equal(account(before, 'Cash').balance, 58000, 'the stranded cash is not what the screen shows');
  const posBefore = position(before);

  const leftOnCash = runMigration();
  assert.equal(leftOnCash, 0, 'Cash still holds money after the sweep');

  const after = await finance.accountBalances();
  assert.equal(position(after), posBefore, 'the total cash position moved — money was created or destroyed');
  assert.ok(!after.some((a) => a.name === 'Cash'), 'Cash is still on screen after being retired');
  assert.equal(account(after, 'M-Pesa').balance, 346000, 'the 46,000 did not land');
  assert.equal(account(after, 'Airtel Money').balance, 132000, 'the branded row did not land');
});

test('the commission parked on Cash was never cash, and does not become a wallet balance', async () => {
  reset();
  add({ accountId: cash.id, direction: 'IN', type: 'SETTLEMENT', amount: 46000, occurredAt: D('2026-08-02'), refType: 'Sale' });
  add({ accountId: cash.id, direction: 'OUT', type: 'COMMISSION_PAYMENT', amount: 501000, occurredAt: D('2026-08-03'), refType: 'CommissionWithdrawal', refId: 'wd-1' });

  const before = await finance.accountBalances();
  // Cash reads 46,000 — not −455,000. The payout never counted as money out.
  assert.equal(account(before, 'Cash').balance, 46000);
  assert.equal(account(before, 'Cash').moneyOut, 0);

  runMigration();
  const after = await finance.accountBalances();
  assert.equal(account(after, 'M-Pesa').balance, 46000);
  assert.equal(account(after, 'M-Pesa').moneyOut, 0, 'a payout landed on a wallet and drained it');
  const record = account(after, 'Commission');
  assert.equal(record.balance, 0, 'the record grew a balance');
  assert.equal(record.recorded, 501000, 'the record of what was paid was lost in the move');
});

test('retiring an account that still holds money would delete that money — hence the zero guard', async () => {
  // Not a hypothetical: the guard is the only thing standing between the owner
  // and a total that silently drops. This is what it prevents.
  reset();
  add({ accountId: mpesa.id, direction: 'IN', type: 'SETTLEMENT', amount: 300000, occurredAt: D('2026-08-01'), brandId: OHIS });
  add({ accountId: cash.id, direction: 'IN', type: 'SETTLEMENT', amount: 46000, occurredAt: D('2026-08-02') });

  const before = await finance.accountBalances();
  const posBefore = position(before);

  // Deactivate WITHOUT re-filing what is on it — the wrong order.
  cash.isActive = false;
  const after = await finance.accountBalances();
  assert.equal(posBefore - position(after), 46000, 'the guard is guarding nothing');

  // And the right order: re-file first, then retire. Same total, no Cash card.
  cash.isActive = true;
  runMigration();
  const fixed = await finance.accountBalances();
  assert.equal(position(fixed), posBefore, 'money went missing on the correct path');
  assert.ok(!fixed.some((a) => a.name === 'Cash'));
});

test('a second run of the migration changes nothing', async () => {
  reset();
  add({ accountId: cash.id, direction: 'IN', type: 'SETTLEMENT', amount: 46000, occurredAt: D('2026-08-02') });
  add({ accountId: cash.id, direction: 'OUT', type: 'COMMISSION_PAYMENT', amount: 90000, occurredAt: D('2026-08-03'), refType: 'CommissionWithdrawal', refId: 'wd-1' });
  runMigration();
  const once = JSON.stringify([...rows].sort((a, b) => a.id.localeCompare(b.id)));
  const onceAccounts = JSON.stringify(accounts);
  const balancesOnce = await finance.accountBalances();

  runMigration();
  assert.equal(JSON.stringify([...rows].sort((a, b) => a.id.localeCompare(b.id))), once, 'the second run re-filed rows');
  assert.equal(JSON.stringify(accounts), onceAccounts, 'the second run touched an account');
  assert.deepEqual(await finance.accountBalances(), balancesOnce);
});

// ── (B) A payout reads like every other transaction ─────────────────────────
test('a payout is a full ledger row: the account by name, the amount, the rep, the date', async () => {
  reset();
  withdrawals.push({ id: 'wd-1', status: 'PAID', paidAt: D('2026-08-03'), requestedAt: D('2026-08-02'), salesRep: { code: 'REP-004', user: { name: 'Juma Nassoro' } } });
  add({
    accountId: commission.id, direction: 'OUT', type: 'COMMISSION_PAYMENT', amount: 501000,
    category: 'Commission Payments', description: 'Commission paid — Juma Nassoro',
    refType: 'CommissionWithdrawal', refId: 'wd-1', occurredAt: D('2026-08-03'),
  });

  const { items } = await finance.listTransactions({}, { skip: 0, take: 25, orderBy: { occurredAt: 'desc' } });
  const row = items[0];
  assert.equal(row.account.name, 'Commission', 'the row does not name the account it is filed on');
  assert.equal(Number(row.amount), 501000, 'the amount is not on the row');
  assert.equal(row.payee, 'Juma Nassoro', 'the row does not say who was paid');
  assert.equal(row.payeeCode, 'REP-004');
  assert.equal(row.payoutStatus, 'PAID');
  assert.ok(row.occurredAt, 'the row does not say when');
  // …and it is still unmistakably not money leaving a wallet.
  assert.equal(row.offAccount, true, 'the row claims to have moved an account balance');
});

test('a payout stays out of money in and money out, and is reported beside them', async () => {
  reset();
  add({ accountId: mpesa.id, direction: 'IN', type: 'SETTLEMENT', amount: 300000, occurredAt: D('2026-08-01'), brandId: OHIS });
  add({ accountId: mpesa.id, direction: 'OUT', type: 'EXPENSE', amount: 40000, category: 'Fuel', occurredAt: D('2026-08-02') });
  add({ accountId: commission.id, direction: 'OUT', type: 'COMMISSION_PAYMENT', amount: 501000, category: 'Commission Payments', description: 'Commission paid — Juma', refType: 'CommissionWithdrawal', refId: 'wd-9', occurredAt: D('2026-08-03') });

  const { sums, byCategory } = await finance.listTransactions({}, { skip: 0, take: 25, orderBy: { occurredAt: 'desc' } });
  assert.equal(sums.in, 300000);
  assert.equal(sums.out, 40000, 'the payout was counted as money the business spent');
  assert.equal(sums.fromPocket, 501000, 'the payout is not reported anywhere the owner can see it');
  assert.ok(!byCategory.some((c) => c.category === 'Commission Payments'), 'the payout is inside spending by category');
});

test('only a payout names a payee — a settlement names the rep who handed money OVER', async () => {
  reset();
  add({ accountId: mpesa.id, direction: 'IN', type: 'SETTLEMENT', amount: 300000, category: 'Settlement received', description: 'Settlement received — Juma Nassoro', refType: 'Sale', refId: 'sale-1', occurredAt: D('2026-08-01'), brandId: OHIS });
  const { items } = await finance.listTransactions({}, { skip: 0, take: 25, orderBy: { occurredAt: 'desc' } });
  assert.equal(items[0].payee, null, 'a settlement was rendered as though someone had been paid');
  assert.equal(items[0].offAccount, false);
});

test('a payout written before the withdrawal could be joined still names the rep', async () => {
  // Legacy rows: no refId to join on. The name is in the description, which is
  // where recordCommissionPayment has always written it.
  reset();
  add({ accountId: commission.id, direction: 'OUT', type: 'COMMISSION_PAYMENT', amount: 120000, category: 'Commission Payments', description: 'Commission paid — Neema', occurredAt: D('2026-07-01') });
  const { items } = await finance.listTransactions({}, { skip: 0, take: 25, orderBy: { occurredAt: 'desc' } });
  assert.equal(items[0].payee, 'Neema');
  assert.equal(finance.payeeFromDescription('Commission paid — Neema'), 'Neema');
  assert.equal(finance.payeeFromDescription('Commission paid'), null);
  assert.equal(finance.payeeFromDescription(null), null);
});
