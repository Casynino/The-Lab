'use strict';

// ── ONE HOME FOR COMMISSION, ONE WALLET PER BRAND, NO CASH ───────────────────
// The owner's four rules, each pinned to a test so it cannot be undone by a
// later change without something going red:
//
//   (a) there is no cash — a retired cash account is offered to nobody and is
//       never the fallback target for anything;
//   (b) a rep settling sees exactly ONE account: OHIS → M-Pesa, Civlily →
//       Airtel Money;
//   (c) paying commission touches neither wallet — it lands on an account of
//       its own, which holds no money and reports what has been RECORDED;
//   (d) commission is tracked, never deducted from profit.
//
// As in finance-aggregation.test.js, the database is swapped for an in-memory
// one that runs the SAME where-clauses the service sends over real rows, so a
// filter that silently matched nothing (or everything) fails here.

const test = require('node:test');
const assert = require('node:assert');

const rows = [];
const accounts = [];
let epoch = null;
let seq = 0;

function matches(row, where) {
  if (!where) return true;
  for (const [key, cond] of Object.entries(where)) {
    if (key === 'AND') { if (!cond.every((c) => matches(row, c))) return false; continue; }
    if (key === 'OR') { if (!cond.some((c) => matches(row, c))) return false; continue; }
    if (key === 'NOT') { if (matches(row, cond)) return false; continue; }
    if (key === 'account') {
      const acc = accounts.find((a) => a.id === row.accountId);
      if (!matches(acc || {}, cond.is)) return false;
      continue;
    }
    const value = row[key];
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      for (const [op, operand] of Object.entries(cond)) {
        if (op === 'gte') { if (!(value >= operand)) return false; } else if (op === 'lte') { if (!(value <= operand)) return false; } else if (op === 'gt') { if (!(value > operand)) return false; } else if (op === 'in') { if (!operand.includes(value)) return false; } else if (op === 'notIn') { if (operand.includes(value)) return false; } else if (op === 'not') { if (value === operand) return false; } else if (op === 'startsWith') { if (!String(value || '').startsWith(operand)) return false; } else throw new Error(`stub: unsupported operator ${op}`);
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
  brand: { findMany: async () => [] },
  expenseCategory: { count: async () => 1 },
  businessAccount: {
    count: async () => accounts.length,
    findMany: async ({ where, orderBy } = {}) => sortBy(accounts.filter((a) => matches(a, where)), orderBy),
    findFirst: async ({ where, orderBy } = {}) => sortBy(accounts.filter((a) => matches(a, where)), orderBy)[0] || null,
    findUnique: async ({ where }) => accounts.find((a) => matches(a, where)) || null,
    create: async ({ data }) => {
      const a = { id: `acc-${++seq}`, isActive: true, isDefault: false, openingBalance: 0, brandId: null, currency: 'TZS', createdAt: new Date(), ...data };
      accounts.push(a);
      return a;
    },
    update: async ({ where, data }) => {
      const a = accounts.find((x) => x.id === where.id);
      Object.assign(a, data);
      return a;
    },
    aggregate: async ({ where, _sum }) => {
      const hit = accounts.filter((a) => matches(a, where));
      const out = { _sum: {} };
      for (const f of Object.keys(_sum || {})) out._sum[f] = hit.reduce((s, a) => s + Number(a[f] || 0), 0);
      return out;
    },
  },
  financeTransaction: {
    count: async ({ where } = {}) => rows.filter((r) => matches(r, where)).length,
    findMany: async ({ where } = {}) => rows.filter((r) => matches(r, where)),
    findFirst: async ({ where } = {}) => rows.find((r) => matches(r, where)) || null, // one payout, one record
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
    aggregate: async ({ where }) => ({
      _sum: { amount: rows.filter((r) => matches(r, where)).reduce((a, r) => a + Number(r.amount), 0) },
    }),
  },
};

// A payout's ledger row is written in a transaction that first locks the withdrawal row (audit
// backend-integrity-1). Transactions here run one at a time, as that lock makes them run on Postgres.
let txChain = Promise.resolve();
prismaStub.$transaction = (fn) => {
  const run = txChain.then(() => fn(prismaStub));
  txChain = run.catch(() => {});
  return run;
};
prismaStub.$queryRaw = async () => [];

require.cache[require.resolve('../src/config/prisma')] = { id: 'prisma', filename: 'prisma', loaded: true, exports: prismaStub };
const reportsPath = require.resolve('../src/services/reports.service');
// Gross profit is the sales side's business, not finance's — stubbed at a
// fixed figure so any movement in netProfit can only have come from finance.
const PROFIT = { totals: { revenue: 3000000, cost: 1800000, profit: 1200000, margin: 40, boxes: 120, commission: 90000 }, byProduct: [], byBrand: [] };
require.cache[reportsPath] = {
  id: reportsPath,
  filename: reportsPath,
  loaded: true,
  exports: { financeEpoch: async () => epoch, profitOverview: async () => PROFIT },
};

const finance = require('../src/services/finance.service');

// ── The books, as production now stands ─────────────────────────────────────
const OHIS = 'brand-ohis';
const CIVLILY = 'brand-civlily';
const D = (s) => new Date(`${s}T09:00:00.000Z`);

let cash; let mpesa; let airtel; let commission;

function reset({ withCommissionAccount = true, cashStillActive = false } = {}) {
  rows.length = 0;
  accounts.length = 0;
  epoch = null;
  // Retired, never deleted — exactly what migration 20260902000003 leaves.
  cash = { id: 'acc-cash', name: 'Cash', type: 'CASH', brandId: null, isActive: cashStillActive, isDefault: false, openingBalance: 0, sortOrder: 0, createdAt: D('2026-01-01') };
  mpesa = { id: 'acc-mpesa', name: 'M-Pesa', type: 'MOBILE_MONEY', brandId: OHIS, isActive: true, isDefault: false, openingBalance: 0, sortOrder: 1, createdAt: D('2026-01-01') };
  airtel = { id: 'acc-airtel', name: 'Airtel Money', type: 'MOBILE_MONEY', brandId: CIVLILY, isActive: true, isDefault: false, openingBalance: 0, sortOrder: 2, createdAt: D('2026-01-01') };
  commission = { id: 'acc-commission', name: 'Commission', type: 'COMMISSION', brandId: null, isActive: true, isDefault: false, openingBalance: 0, sortOrder: 90, createdAt: D('2026-01-01') };
  accounts.push(cash, mpesa, airtel);
  if (withCommissionAccount) accounts.push(commission);
}
const add = (t) => rows.push({ refType: null, brandId: null, ...t });
const account = (list, name) => list.find((a) => a.name === name);

// ── (b) ONE settlement account per brand ────────────────────────────────────
test('a rep settling OHIS is offered exactly one account, and it is M-Pesa', async () => {
  reset();
  const offered = await finance.paymentAccountsForBrand(OHIS);
  assert.equal(offered.length, 1, `expected one option, got ${offered.map((a) => a.name).join(', ')}`);
  assert.equal(offered[0].name, 'M-Pesa');
});

test('a rep settling Civlily is offered exactly one account, and it is Airtel Money', async () => {
  reset();
  const offered = await finance.paymentAccountsForBrand(CIVLILY);
  assert.equal(offered.length, 1, `expected one option, got ${offered.map((a) => a.name).join(', ')}`);
  assert.equal(offered[0].name, 'Airtel Money');
});

// ── (a) No cash, anywhere ───────────────────────────────────────────────────
test('a cash account is offered to nobody — even while it is still active', async () => {
  // The unretired case: a Cash account that still holds money stays visible so
  // the owner can move it, but it must never take NEW money.
  reset({ cashStillActive: true });
  for (const brand of [OHIS, CIVLILY, null]) {
    const offered = await finance.paymentAccountsForBrand(brand);
    assert.ok(!offered.some((a) => a.type === 'CASH'), 'cash was offered as a payment account');
  }
  const fallback = await finance.defaultAccount();
  assert.notEqual(fallback.type, 'CASH', 'cash is still the fallback target for untagged money');
});

test('the commission account is never a payment option and never the fallback', async () => {
  reset();
  for (const brand of [OHIS, CIVLILY, null]) {
    const offered = await finance.paymentAccountsForBrand(brand);
    assert.ok(!offered.some((a) => a.type === 'COMMISSION'), 'the commission record was offered as a wallet');
  }
  // Even when it is the ONLY account flagged default — the trap that would
  // have sent settlement money into the record.
  commission.isDefault = true;
  const fallback = await finance.defaultAccount();
  assert.notEqual(fallback.type, 'COMMISSION');
  assert.equal(fallback.name, 'M-Pesa');
});

// ── (c) Commission has a home of its own ────────────────────────────────────
test('a commission payout lands on the commission account, not on a wallet', async () => {
  reset();
  const txn = await finance.recordCommissionPayment(
    { amount: 501000, who: 'Juma', refId: 'wd-1', occurredAt: D('2026-08-02') },
    null,
  );
  assert.ok(txn, 'no commission row was written at all');
  assert.equal(txn.accountId, commission.id, 'the payout was filed on a wallet');
  assert.equal(txn.type, 'COMMISSION_PAYMENT');
});

test('the commission account is created if it is missing, never substituted', async () => {
  // The dangerous case: the account has gone. The old code fell back to a
  // CASH account and then to the DEFAULT one — which after retiring cash is a
  // brand's wallet, exactly what the owner asked to prevent.
  reset({ withCommissionAccount: false });
  const txn = await finance.recordCommissionPayment({ amount: 120000, refId: 'wd-2', occurredAt: D('2026-08-03') }, null);
  assert.ok(txn);
  const landed = accounts.find((a) => a.id === txn.accountId);
  assert.equal(landed.type, 'COMMISSION');
  assert.ok(![mpesa.id, airtel.id, cash.id].includes(txn.accountId), 'the payout landed on a wallet');
});

test('one withdrawal is recorded once, however many times the payment is recorded (audit #31)', async () => {
  reset();
  const first = await finance.recordCommissionPayment({ amount: 75000, refId: 'wd-dup', occurredAt: D('2026-08-03') }, null);
  const second = await finance.recordCommissionPayment({ amount: 75000, refId: 'wd-dup', occurredAt: D('2026-08-03') }, null);
  assert.equal(second.id, first.id);
  assert.equal(rows.filter((r) => r.refId === 'wd-dup' && r.type === 'COMMISSION_PAYMENT').length, 1);
});

// Audit backend-integrity-1: Approve & pay writes the payout's row while a Finance page read runs the
// self-heal rebuild. Both used to read "no row yet" in the same few milliseconds and both write one, so
// a 20,000 payout was booked twice. Every read here yields first, so the two really interleave.
test('a payout paid while the ledger is being rebuilt is recorded once', async () => {
  reset();
  const tick = () => new Promise((r) => setImmediate(r));
  const ft = prismaStub.financeTransaction;
  const orig = { findFirst: ft.findFirst, findMany: ft.findMany, create: ft.create };
  ft.findFirst = async (a) => { await tick(); return orig.findFirst(a); };
  ft.findMany = async (a) => { await tick(); return orig.findMany(a); };
  // A slow write: the other side reads while it is still on its way.
  ft.create = async (a) => { await new Promise((r) => setTimeout(r, 15)); return orig.create(a); };
  const paid = { id: 'wd-race', status: 'PAID', amount: 20000, paidAt: D('2026-08-05'), decidedAt: D('2026-08-05'), createdAt: D('2026-08-04'), salesRep: { user: { name: 'KP' } } };
  Object.assign(prismaStub, {
    sale: { findMany: async () => [] },
    saleItem: { findMany: async () => [] },
    commissionWithdrawal: { findMany: async () => [paid] },
  });
  try {
    await Promise.all([
      finance.backfillFromHistory(),
      finance.recordCommissionPayment({ amount: 20000, refId: 'wd-race', who: 'KP', occurredAt: D('2026-08-05') }, { id: 'admin' }),
      finance.backfillFromHistory(),
    ]);
  } finally {
    Object.assign(ft, orig);
    delete prismaStub.sale; delete prismaStub.saleItem; delete prismaStub.commissionWithdrawal;
  }
  assert.equal(rows.filter((r) => r.refId === 'wd-race' && r.type === 'COMMISSION_PAYMENT').length, 1);
});

// Bonus in the wallet (owner, 14 Nov 2026): a paid BONUS withdrawal is the same kind of record as a commission
// payout — same type, same account, so every exclusion holds — named "Bonus paid", under "Bonus Payments",
// whether it is written when the owner pays or by the self-heal rebuild.
test('a paid bonus withdrawal is recorded like a commission payout, named as a bonus', async () => {
  reset();
  const txn = await finance.recordCommissionPayment({ amount: 500000, who: 'Juma', refId: 'wd-bonus', occurredAt: D('2026-08-02'), source: 'BONUS' }, null);
  assert.equal(txn.type, 'COMMISSION_PAYMENT');
  assert.equal(txn.accountId, commission.id);
  assert.equal(txn.category, 'Bonus Payments');
  assert.equal(txn.description, 'Bonus paid — Juma');
  const plain = await finance.recordCommissionPayment({ amount: 30000, who: 'Juma', refId: 'wd-comm', occurredAt: D('2026-08-02') }, null);
  assert.equal(plain.category, 'Commission Payments');
  assert.equal(plain.description, 'Commission paid — Juma');

  reset();
  const paid = [
    { id: 'wd-b', source: 'BONUS', status: 'PAID', amount: 1000000, paidAt: D('2026-08-05'), decidedAt: D('2026-08-05'), createdAt: D('2026-08-04'), salesRep: { user: { name: 'KP' } } },
    { id: 'wd-c', source: 'COMMISSION', status: 'PAID', amount: 20000, paidAt: D('2026-08-05'), decidedAt: D('2026-08-05'), createdAt: D('2026-08-04'), salesRep: { user: { name: 'KP' } } },
  ];
  Object.assign(prismaStub, {
    sale: { findMany: async () => [] },
    saleItem: { findMany: async () => [] },
    commissionWithdrawal: { findMany: async () => paid },
  });
  try {
    await finance.backfillFromHistory();
  } finally {
    delete prismaStub.sale; delete prismaStub.saleItem; delete prismaStub.commissionWithdrawal;
  }
  const b = rows.find((r) => r.refId === 'wd-b');
  const c = rows.find((r) => r.refId === 'wd-c');
  assert.equal(b.type, 'COMMISSION_PAYMENT');
  assert.equal(b.category, 'Bonus Payments');
  assert.equal(b.description, 'Bonus paid — KP');
  assert.equal(c.category, 'Commission Payments');
  assert.equal(c.description, 'Commission paid — KP');
});

test('a payout moves no balance on any money account, and the record is not a balance', async () => {
  reset();
  add({ accountId: mpesa.id, direction: 'IN', type: 'SETTLEMENT', amount: 48000, occurredAt: D('2026-08-01'), refType: 'Sale', brandId: OHIS });
  add({ accountId: airtel.id, direction: 'IN', type: 'SETTLEMENT', amount: 86000, occurredAt: D('2026-08-01'), refType: 'Sale', brandId: CIVLILY });
  const before = await finance.accountBalances();
  const cashHeldBefore = before.reduce((s, a) => s + a.balance, 0);

  await finance.recordCommissionPayment({ amount: 501000, refId: 'wd-3', occurredAt: D('2026-08-02') }, null);

  const after = await finance.accountBalances();
  assert.equal(account(after, 'M-Pesa').balance, 48000, 'a payout drained the OHIS wallet');
  assert.equal(account(after, 'Airtel Money').balance, 86000, 'a payout drained the Civlily wallet');
  assert.equal(account(after, 'M-Pesa').moneyOut, 0);
  assert.equal(account(after, 'Airtel Money').moneyOut, 0);
  assert.equal(after.reduce((s, a) => s + a.balance, 0), cashHeldBefore, 'the cash position moved');

  // The record itself: zero balance BY DESIGN, and the total reported apart.
  const record = account(after, 'Commission');
  assert.equal(record.balance, 0);
  assert.equal(record.isCommissionRecord, true);
  assert.equal(record.recorded, 501000, 'the record of what was paid is not there to be read');
});

test('nothing but commission may be filed on the commission account', async () => {
  reset();
  await assert.rejects(
    () => finance.recordExpense({ accountId: commission.id, amount: 40000, category: 'Fuel' }, null),
    /only holds the record of rep commission/i,
  );
});

test('there is no money in the record to transfer out of it', async () => {
  reset();
  await finance.recordCommissionPayment({ amount: 501000, refId: 'wd-4', occurredAt: D('2026-08-02') }, null);
  await assert.rejects(
    () => finance.transferBetweenAccounts({ fromAccountId: commission.id, toAccountId: mpesa.id, amount: 1000 }),
    /not a wallet/i,
  );
  await assert.rejects(
    () => finance.transferBetweenAccounts({ fromAccountId: mpesa.id, toAccountId: commission.id, amount: 1000 }),
    /not a wallet/i,
  );
});

// ── (d) Recorded, never deducted from profit ────────────────────────────────
test('commission is recorded on its own line and never reduces profit', async () => {
  reset();
  add({ accountId: mpesa.id, direction: 'IN', type: 'SETTLEMENT', amount: 3000000, occurredAt: D('2026-08-01'), refType: 'Sale', brandId: OHIS });
  add({ accountId: mpesa.id, direction: 'OUT', type: 'EXPENSE', amount: 40000, category: 'Fuel', occurredAt: D('2026-08-02') });

  const before = await finance.report({ period: 'all' });
  assert.equal(before.grossProfit, PROFIT.totals.profit);
  assert.equal(before.expenses, 40000);
  assert.equal(before.netProfit, PROFIT.totals.profit - 40000);
  assert.equal(before.commissionPaid, 0);

  // He pays a rep 501,000 out of his own pocket.
  await finance.recordCommissionPayment({ amount: 501000, refId: 'wd-5', occurredAt: D('2026-08-03') }, null);

  const after = await finance.report({ period: 'all' });
  assert.equal(after.commissionPaid, 501000, 'the payout is not reported anywhere');
  assert.equal(after.expenses, 40000, 'commission was counted as a business expense');
  assert.equal(after.netProfit, before.netProfit, 'commission reduced profit');
  assert.equal(after.cashFlow.moneyOut, before.cashFlow.moneyOut, 'commission showed up as money leaving the business');
  assert.equal(after.cashFlow.closingBalance, before.cashFlow.closingBalance, 'commission moved the closing balance');
});
