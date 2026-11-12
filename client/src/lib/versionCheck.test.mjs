import test from 'node:test';
import assert from 'node:assert/strict';
import { dueForCheck, MIN_GAP_MS } from './versionCheck.js';

test('the first check always runs', () => {
  assert.equal(dueForCheck(1_000, 0), true);
});

test('a focus a few seconds after the last check does not ask again', () => {
  const last = 1_000_000;
  assert.equal(dueForCheck(last + 800, last), false);
  assert.equal(dueForCheck(last + 2_400, last), false);
  assert.equal(dueForCheck(last + MIN_GAP_MS - 1, last), false);
});

test('a minute later it may ask again (the 3-minute timer is never held back)', () => {
  const last = 1_000_000;
  assert.equal(dueForCheck(last + MIN_GAP_MS, last), true);
  assert.equal(dueForCheck(last + 3 * 60_000, last), true);
});
