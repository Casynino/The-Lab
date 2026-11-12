import test from 'node:test';
import assert from 'node:assert/strict';
import { makeOnce, wentThrough } from './once.js';

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

test('a 409 means the same press already went through; any other failure is a real error', () => {
  assert.equal(wentThrough({ response: { status: 409 } }), true);
  assert.equal(wentThrough({ response: { status: 400 } }), false);
  assert.equal(wentThrough({ response: { status: 500 } }), false);
  // A lost answer (no response at all) is not "it went through": the window stays open to try again.
  assert.equal(wentThrough({ message: 'Network Error' }), false);
  assert.equal(wentThrough(undefined), false);
});
