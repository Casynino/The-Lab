import test from 'node:test';
import assert from 'node:assert/strict';
import { makeOnce } from './once.js';

// Audit admin-ops-3: a double tap on Approve sent two requests before the button's busy state arrived.
test('a second press of the same key is ignored until the first has finished', () => {
  const once = makeOnce();
  let sent = 0;
  assert.equal(once.run(() => { sent += 1; }, 'sub-1'), true);
  assert.equal(once.run(() => { sent += 1; }, 'sub-1'), false);
  assert.equal(sent, 1);
  // Another row is not blocked by it.
  assert.equal(once.run(() => { sent += 1; }, 'sub-2'), true);
  assert.equal(sent, 2);
  once.release('sub-1');
  assert.equal(once.run(() => { sent += 1; }, 'sub-1'), true);
  assert.equal(sent, 3);
});

test('done frees every key, whatever arguments onSettled passes it', () => {
  const once = makeOnce();
  once.run(() => {});
  once.run(() => {}, 'a');
  once.done({ some: 'data' }, null, 'a');
  assert.equal(once.isBusy(), false);
  assert.equal(once.isBusy('a'), false);
});
