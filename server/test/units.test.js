'use strict';

// Unit tests for pure business logic (no database required).
// Run with: npm test   (uses Node's built-in test runner)

const test = require('node:test');
const assert = require('node:assert/strict');

const money = require('../src/utils/money');
const numbering = require('../src/utils/numbering');
const credit = require('../src/services/credit.service');

test('money.round2 avoids float drift', () => {
  assert.equal(money.round2(1.005), 1.01);
  assert.equal(money.round2(700 * 0.65), 455);
  assert.equal(money.round2('1234.567'), 1234.57);
});

test('money.toNumber coerces strings and nullish', () => {
  assert.equal(money.toNumber('250'), 250);
  assert.equal(money.toNumber(null), 0);
  assert.equal(money.toNumber(undefined), 0);
});

test('money.sum totals a mixed list', () => {
  assert.equal(money.sum([700, '800', 1700]), 3200);
});

test('numbering.pad / compactDate produce stable formats', () => {
  assert.equal(numbering.pad(7, 4), '0007');
  assert.match(numbering.compactDate(new Date('2026-06-16')), /^\d{8}$/);
  assert.equal(numbering.randomCode(6).length, 6);
});

test('credit.computeStatus reflects balance, due date and payments', () => {
  const future = new Date(Date.now() + 7 * 864e5);
  const past = new Date(Date.now() - 7 * 864e5);

  assert.equal(credit.computeStatus({ balance: 0, amountPaid: 1000, dueDate: future }), 'PAID');
  assert.equal(credit.computeStatus({ balance: 500, amountPaid: 0, dueDate: future }), 'OPEN');
  assert.equal(credit.computeStatus({ balance: 500, amountPaid: 200, dueDate: future }), 'PARTIAL');
  assert.equal(credit.computeStatus({ balance: 500, amountPaid: 200, dueDate: past }), 'OVERDUE');
});

// ── Capital block ────────────────────────────────────────────────────────────
// buildCapital is pure, so the balance-sheet arithmetic is provable without a
// database. The numbers below are production's: 476,000 contributed, 501,000
// of commission paid to reps out of the owner's own pocket.
const finance = require('../src/services/finance.service');

const CAP = {
  cash: 2915500,
  stockAtCost: 4130000,
  stockInWarehouse: 3940000,
  stockWithReps: 190000,
  stockAtSellingPrice: 5400000,
  stockUnits: 308,
  customersOwe: 120000,
  customersOweCount: 2,
  supplierOutstanding: 3000000,
  supplierDueNow: 1200000,
  supplierLabel: 'Bonge',
  repCommissionPayable: 65000,
  // One shape, straight from ownerFigures() — the same object the period strip
  // and the cash-flow tab are built from.
  owner: {
    intoAccounts: 476000,
    commissionFromPocket: 501000,
    drawn: 0,
    repFundingExcluded: 0,
    putIn: 977000,
    accountMovement: 476000,
    total: 977000,
  },
};

test('capital: holds − owes = what is left, to the shilling', () => {
  const c = finance.buildCapital(CAP);
  assert.equal(c.holds.total, 2915500 + 4130000);
  assert.equal(c.owes.total, c.owes.suppliers.total + c.owes.reps + c.owes.owner.total);
  assert.equal(c.holds.total - c.owes.total, c.left);
  // ...and the owner's capital is the same sheet stopped one line earlier.
  assert.equal(c.holds.total - c.owes.outside, c.yourCapital);
  assert.equal(c.yourCapital - c.owes.owner.total, c.left);
  // The displayed lines add up to the totals they head.
  assert.equal(c.holds.lines.reduce((s, l) => s + l.amount, 0), c.holds.total);
  assert.equal(c.owes.lines.reduce((s, l) => s + l.amount, 0), c.owes.total);
});

test("capital: the owner's money is separate lines that add up, never one", () => {
  const o = finance.buildCapital(CAP).owes.owner;
  assert.equal(o.intoAccounts, 476000); // cash he moved into an account
  assert.equal(o.commissionFromPocket, 501000); // never touched an account
  assert.equal(o.intoAccounts + o.commissionFromPocket - o.drawn, o.total);
  assert.equal(o.total, 977000);
});

// ── DEFECT 2 ────────────────────────────────────────────────────────────────
// Collecting a credit sale posts no finance transaction, so a collected
// shilling leaves the receivable and arrives in no account. Counted inside the
// total it would make the owner's capital FALL every time a customer paid him.
test('capital: what customers owe is a memo, outside every total', () => {
  const c = finance.buildCapital(CAP);
  assert.equal(c.memo.customersOwe.amount, 120000);
  assert.equal(c.memo.customersOwe.count, 2);
  assert.equal(c.holds.total, c.holds.cash + c.holds.stock.atCost);
  assert.ok(!c.holds.lines.some((l) => l.key === 'customers'));
  // Collecting 50,000 must not move capital at all — the cash it becomes is
  // not recorded anywhere yet, so the sheet stays where it was.
  const after = finance.buildCapital({ ...CAP, customersOwe: 70000, customersOweCount: 1 });
  assert.equal(after.yourCapital, c.yourCapital);
  assert.equal(after.left, c.left);
  assert.equal(after.holds.total, c.holds.total);
});

test('capital: a rep-funding contribution is never counted twice', () => {
  // The same 501,000, recorded BOTH as a contribution funding the payout and
  // as the payout itself. ownerFigures() strips the funding row out of
  // intoAccounts (and out of the cash balance); the payout is the only count.
  const both = finance.buildCapital({
    ...CAP,
    owner: { ...CAP.owner, repFundingExcluded: 501000 },
  });
  assert.equal(both.owes.owner.intoAccounts, 476000);
  assert.equal(both.owes.owner.total, 977000);
  assert.equal(both.owes.owner.repFundingExcluded, 501000);
  // Identical to the books where no funding row was ever posted.
  const plain = finance.buildCapital(CAP);
  assert.equal(both.owes.owner.total, plain.owes.owner.total);
  assert.equal(both.left, plain.left);
});

test('capital: rep-held stock is counted once, at cost', () => {
  const c = finance.buildCapital(CAP);
  assert.equal(c.holds.stock.inWarehouse + c.holds.stock.withReps, c.holds.stock.atCost);
  // The selling value of stock is carried, but never enters the total.
  assert.equal(c.holds.total, c.holds.cash + c.holds.stock.atCost);
});

test('capital: the supplier split adds back to the whole bill', () => {
  const c = finance.buildCapital(CAP);
  assert.equal(c.owes.suppliers.dueNow + c.owes.suppliers.dueLater, c.owes.suppliers.total);
  // A due-now larger than the bill (over-recorded sales) is clamped, not shown.
  const odd = finance.buildCapital({ ...CAP, supplierDueNow: 9000000 });
  assert.equal(odd.owes.suppliers.dueNow, 3000000);
  assert.equal(odd.owes.suppliers.dueLater, 0);
});

test('capital: drawings reduce what the business owes the owner', () => {
  const c = finance.buildCapital({
    ...CAP,
    owner: { ...CAP.owner, drawn: 200000, accountMovement: 276000, total: 777000 },
  });
  assert.equal(c.owes.owner.total, 777000);
  assert.equal(c.left, c.holds.total - c.owes.outside - 777000);
});

// ── PRESENTATION C ──────────────────────────────────────────────────────────
test('capital: no negative share when the owner is ahead of his own money', () => {
  const c = finance.buildCapital({
    ...CAP,
    owner: { intoAccounts: 100000, commissionFromPocket: 0, drawn: 400000, repFundingExcluded: 0 },
  });
  assert.equal(c.owes.owner.total, -300000);
  // A share of capital "out of his own pocket" means nothing when he is owed
  // nothing. Zero, never a negative percentage on screen.
  assert.equal(c.owes.owner.shareOfCapitalPct, 0);
  // The sheet still balances with a negative owner line.
  assert.equal(c.holds.total - c.owes.total, c.left);
  assert.equal(c.holds.total - c.owes.outside, c.yourCapital);
});

test('capital: empty books balance at zero', () => {
  const c = finance.buildCapital({});
  assert.equal(c.holds.total, 0);
  assert.equal(c.owes.total, 0);
  assert.equal(c.yourCapital, 0);
  assert.equal(c.left, 0);
  assert.equal(c.owes.owner.shareOfCapitalPct, 0);
  assert.equal(c.memo.customersOwe.amount, 0);
});

// ── DEFECT 1 ────────────────────────────────────────────────────────────────
// Commission the owner pays a rep from his own hand touches no business
// account. The ledger row stays as the RECORD of what the rep was paid; the
// aggregation layer must treat it as no money moved and nothing spent.
test('off-account: a rep payout is a record, not a movement', () => {
  assert.equal(finance.isOffAccount({ type: 'COMMISSION_PAYMENT' }), true);
  // Both legs. Legacy rows that "funded" a payout are off-account too —
  // excluding only the payout would leave the funding row inflating cash.
  assert.equal(finance.isOffAccount({ type: 'OWNER_CONTRIBUTION', refType: 'CommissionWithdrawal' }), true);
  // Ordinary money is untouched. refType is NULL on every normal contribution.
  assert.equal(finance.isOffAccount({ type: 'OWNER_CONTRIBUTION', refType: null }), false);
  assert.equal(finance.isOffAccount({ type: 'OWNER_CONTRIBUTION' }), false);
  assert.equal(finance.isOffAccount({ type: 'EXPENSE' }), false);
  assert.equal(finance.isOffAccount({ type: 'STOCK_PURCHASE', refType: 'PurchaseOrder' }), false);
  assert.equal(finance.isOffAccount({ type: 'SETTLEMENT', refType: 'Sale' }), false);
  assert.equal(finance.isOffAccount({}), false);
});

// ── DEFECT 4 ────────────────────────────────────────────────────────────────
// What the supplier is owed cannot change when a period tab is clicked.
test('supplier split: due now is the cost of what has sold, less what he was paid', () => {
  assert.equal(finance.supplierDueNow({ outstanding: 3000000, costOfSold: 1700000, alreadyPaid: 500000 }), 1200000);
  // Paid ahead of the sold boxes: nothing is due, never a negative.
  assert.equal(finance.supplierDueNow({ outstanding: 3000000, costOfSold: 400000, alreadyPaid: 900000 }), 0);
  // Never more than he is actually invoiced for.
  assert.equal(finance.supplierDueNow({ outstanding: 250000, costOfSold: 9000000, alreadyPaid: 0 }), 250000);
});

test('supplier split: the balance sheet figure is all-time, not the selected period', () => {
  const suppliers = new Map([
    ['brandA', { outstanding: 3000000, paid: 500000 }],
    ['general', { outstanding: 250000, paid: 0 }],
  ]);
  // Cost of goods SOLD, all time versus what sold today.
  const allTime = new Map([['brandA', { cost: 1700000 }], ['general', { cost: 900000 }]]);
  const today = new Map([['brandA', { cost: 40000 }], ['general', { cost: 0 }]]);

  const sheet = finance.supplierDueNowAcross(suppliers, allTime);
  assert.equal(sheet, 1200000 + 250000);

  // This is the figure that used to reach the capital block when the owner
  // clicked "Today" — the same bill, a completely different split. The block
  // is fed the all-time map so it cannot happen.
  assert.notEqual(finance.supplierDueNowAcross(suppliers, today), sheet);

  // And the identity that hid the bug still holds on both, which is exactly
  // why no assertion caught it: dueNow and dueLater moved together.
  for (const costs of [allTime, today]) {
    const dueNow = finance.supplierDueNowAcross(suppliers, costs);
    const bill = [...suppliers.values()].reduce((a, s) => a + s.outstanding, 0);
    const c = finance.buildCapital({ supplierOutstanding: bill, supplierDueNow: dueNow });
    assert.equal(c.owes.suppliers.dueNow + c.owes.suppliers.dueLater, c.owes.suppliers.total);
  }
});
