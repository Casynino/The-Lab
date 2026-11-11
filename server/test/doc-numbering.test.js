'use strict';

// ── Document numbers survive a deletion (audit #35, 11 Nov 2026) ─────────────────────────────────────
// Numbers were "today's count + 1": after one row of the day was deleted, every later create that day
// reused a number still in use and hit the unique key (manual entries 409; automatic income and payout
// records silently missing until midnight). Pinned: the next number is the highest used today + 1.

const test = require('node:test');
const assert = require('node:assert/strict');
const { nextDocNumber, compactDate } = require('../src/utils/numbering');

const day = compactDate();
const delegateOf = (numbers) => ({
  findMany: async ({ where }) => numbers.filter((n) => n.startsWith(where.txnNumber.startsWith)).map((txnNumber) => ({ txnNumber })),
  count: async () => { throw new Error('count must not decide the number'); },
});

test('the first number of the day is 0001', async () => {
  assert.equal(await nextDocNumber(delegateOf([]), 'txnNumber', 'FTX'), `FTX-${day}-0001`);
});

test('after a deletion the next number is above the highest, not count + 1', async () => {
  // 0004 was deleted: four rows left, the highest is 0006 — count + 1 would give 0005... then 0006 (taken)
  const left = ['0001', '0002', '0003', '0005', '0006'].map((n) => `FTX-${day}-${n}`);
  assert.equal(await nextDocNumber(delegateOf(left), 'txnNumber', 'FTX'), `FTX-${day}-0007`);
});

test('other days and other prefixes do not count', async () => {
  const rows = [`FTX-20200101-0099`, `SALE-${day}-0050`, `FTX-${day}-0002`];
  assert.equal(await nextDocNumber(delegateOf(rows), 'txnNumber', 'FTX'), `FTX-${day}-0003`);
});

test('past 9999 the order is numeric, not alphabetical', async () => {
  const rows = [`FTX-${day}-9999`, `FTX-${day}-10000`];
  assert.equal(await nextDocNumber(delegateOf(rows), 'txnNumber', 'FTX'), `FTX-${day}-10001`);
});
