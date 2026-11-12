import test from 'node:test';
import assert from 'node:assert/strict';
import { staleSince, noticeKind, figuresAreLive, correctionFrom } from './freshness.js';

const ok = (t) => ({ status: 'success', data: { rows: 1 }, dataUpdatedAt: t });
const failedWithData = (t) => ({ status: 'error', data: { rows: 1 }, dataUpdatedAt: t });
const failedEmpty = { status: 'error', data: undefined, dataUpdatedAt: 0 };

test('nothing is stale while every shown query has its fresh answer', () => {
  assert.equal(staleSince([{ active: true, state: ok(100) }, { active: true, state: ok(200) }]), 0);
  assert.equal(staleSince([]), 0);
  assert.equal(staleSince(undefined), 0);
});

test('a shown query whose refresh failed but kept its old answer is stale, from when that answer came', () => {
  assert.equal(staleSince([{ active: true, state: ok(500) }, { active: true, state: failedWithData(300) }]), 300);
});

test('the oldest kept answer is the one named', () => {
  assert.equal(staleSince([{ active: true, state: failedWithData(300) }, { active: true, state: failedWithData(120) }]), 120);
});

test('a failure with nothing kept is the page\'s own "Couldn\'t load", not this notice', () => {
  assert.equal(staleSince([{ active: true, state: failedEmpty }]), 0);
});

test('a query no screen is showing does not raise the notice', () => {
  assert.equal(staleSince([{ active: false, state: failedWithData(300) }]), 0);
});

test('offline wins over stale; online and fresh shows nothing', () => {
  assert.equal(noticeKind({ online: false, since: 0 }), 'offline');
  assert.equal(noticeKind({ online: false, since: 300 }), 'offline');
  assert.equal(noticeKind({ online: true, since: 300 }), 'stale');
  assert.equal(noticeKind({ online: true, since: 0 }), null);
});

test('balances put back from the saved copy are not live until the server answers', () => {
  // Restored and marked out of date, the page has not asked yet (or is still asking).
  assert.equal(figuresAreLive({ isSuccess: true, isFetchedAfterMount: false, isStale: true }), false);
  // The server answered since the page opened.
  assert.equal(figuresAreLive({ isSuccess: true, isFetchedAfterMount: true, isStale: false }), true);
  // ... and they stay usable once they age past the fresh window.
  assert.equal(figuresAreLive({ isSuccess: true, isFetchedAfterMount: true, isStale: true }), true);
  // An answer in memory from a moment ago (another tab of the page) is usable at once.
  assert.equal(figuresAreLive({ isSuccess: true, isFetchedAfterMount: false, isStale: false }), true);
});

test('figures whose refresh failed, or that never came, are never live', () => {
  assert.equal(figuresAreLive({ isSuccess: false, isError: true, isFetchedAfterMount: true, isStale: true }), false);
  assert.equal(figuresAreLive({ isSuccess: false, isPending: true }), false);
  assert.equal(figuresAreLive(undefined), false);
});

test('a correction is written from the balance the server gives right before it (freshness-1)', () => {
  assert.deepEqual(correctionFrom({ shown: 2297900, live: 2297900, target: 2332900 }),
    { kind: 'write', direction: 'IN', amount: 35000, from: 2297900 });
  assert.deepEqual(correctionFrom({ shown: 500, live: 500, target: 120.5 }),
    { kind: 'write', direction: 'OUT', amount: 379.5, from: 500 });
});

test('money that moved while the window was open stops the write and names both balances', () => {
  // The screen still showed the balance from before a settlement of 35,000 was approved.
  assert.deepEqual(correctionFrom({ shown: 2297900, live: 2332900, target: 2332900 }),
    { kind: 'moved', from: 2297900, to: 2332900 });
  // Float noise below a cent is not a move.
  assert.equal(correctionFrom({ shown: 0.1 + 0.2, live: 0.3, target: 1 }).kind, 'write');
});

test('nothing to record when it already holds that, and nothing when the account is gone', () => {
  assert.deepEqual(correctionFrom({ shown: 100, live: 100, target: 100 }), { kind: 'nothing' });
  assert.deepEqual(correctionFrom({ shown: 100, live: null, target: 50 }), { kind: 'gone' });
  assert.deepEqual(correctionFrom({ shown: 100, live: undefined, target: 50 }), { kind: 'gone' });
});
