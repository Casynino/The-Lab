import test from 'node:test';
import assert from 'node:assert/strict';
import { staleSince, noticeKind } from './freshness.js';

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
