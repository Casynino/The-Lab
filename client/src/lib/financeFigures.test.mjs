import test from 'node:test';
import assert from 'node:assert/strict';
import { statementRows, poPayCap } from './financeFigures.js';

const EPOCH = '2026-07-05T09:36:54.333Z';

// Audit admin-money-3: M-Pesa's last statement page walked its balance back through rows from before
// go-live and showed -1,396,000 on 19 Jun. Those rows are in no balance.
test('statement rows before go-live get no balance and do not move the running balance', () => {
  const rows = [
    { id: 'a', occurredAt: '2026-07-10T08:00:00Z', direction: 'IN', amount: 48000 },
    { id: 'b', occurredAt: '2026-07-06T08:00:00Z', direction: 'OUT', amount: 10000 },
    { id: 'c', occurredAt: '2026-07-04T08:00:00Z', direction: 'IN', amount: 48000 },
    { id: 'd', occurredAt: '2026-06-19T08:00:00Z', direction: 'IN', amount: 32500 },
  ];
  const out = statementRows(rows, 100000, 0, EPOCH);
  assert.deepEqual(out.map((t) => t.balanceAfter), [100000, 52000, null, null]);
  assert.deepEqual(out.map((t) => t.beforeBooks), [false, false, true, true]);
});

test('a later page starts below the newer rows, and no epoch means every row is in the balance', () => {
  const rows = [
    { id: 'a', occurredAt: '2026-06-01T08:00:00Z', direction: 'OUT', amount: 1000 },
    { id: 'b', occurredAt: '2026-05-01T08:00:00Z', direction: 'IN', amount: 500 },
  ];
  assert.deepEqual(statementRows(rows, 10000, 2500, null).map((t) => t.balanceAfter), [7500, 8500]);
  assert.deepEqual(statementRows(rows, 10000, 2500, undefined).map((t) => t.beforeBooks), [false, false]);
});

// Audit admin-money-1: Pay PO offered the full PO cost although balance payments and returns had
// already covered it, so a supplier could be paid twice.
test('a PO can be paid at most what the PO and the supplier are still owed', () => {
  assert.equal(poPayCap(3700000, 12000000), 3700000);
  assert.equal(poPayCap(9617000, 1000), 1000);
  assert.equal(poPayCap(1000, 0), 0);
  assert.equal(poPayCap(1000, -1000), 0);
  assert.equal(poPayCap(0, 5000), 0);
  assert.equal(poPayCap(2500, undefined), 2500);
});
