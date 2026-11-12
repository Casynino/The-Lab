import test from 'node:test';
import assert from 'node:assert/strict';
import { watchSaves, BUSY_LIMIT_MS } from './busyLock.js';

// A mutation cache small enough to read, and timers that move only when told.
function fakeCache() {
  let listener = null;
  return {
    subscribe(fn) { listener = fn; return () => { listener = null; }; },
    emit(type, mutation) { listener?.({ type, mutation }); },
    get live() { return !!listener; },
  };
}
function fakeTimers() {
  let now = 0;
  let id = 0;
  const due = new Map();
  return {
    setTimeout(fn, ms) { id += 1; due.set(id, { at: now + ms, fn }); return id; },
    clearTimeout(t) { due.delete(t); },
    tick(ms) {
      now += ms;
      for (const [t, d] of [...due]) if (d.at <= now) { due.delete(t); d.fn(); }
    },
    get waiting() { return due.size; },
  };
}
const save = () => ({ state: { status: 'pending' } });

function watch(onTop = true) {
  const cache = fakeCache();
  const timers = fakeTimers();
  const seen = [];
  let expired = 0;
  const stop = watchSaves(cache, {
    isOnTop: () => onTop,
    onChange: (b) => seen.push(b),
    onExpire: () => { expired += 1; },
    timers,
  });
  return { cache, timers, seen, stop, expired: () => expired };
}

test('a save keeps the window locked until the server answers', () => {
  const w = watch();
  const m = save();
  w.cache.emit('added', m);
  assert.deepEqual(w.seen, [true]);
  m.state.status = 'success';
  w.cache.emit('updated', m);
  assert.deepEqual(w.seen, [true, false]);
  assert.equal(w.timers.waiting, 0, 'the limit is cleared when it answers');
  w.timers.tick(BUSY_LIMIT_MS * 2);
  assert.equal(w.expired(), 0);
});

test('a save that hangs unlocks the window after the limit, and says so', () => {
  const w = watch();
  const m = save();
  w.cache.emit('added', m);
  w.timers.tick(BUSY_LIMIT_MS - 1);
  assert.deepEqual(w.seen, [true], 'still locked just before the limit');
  w.timers.tick(1);
  assert.deepEqual(w.seen, [true, false]);
  assert.equal(w.expired(), 1);
  // It is still on its way; more news about it does not lock the window again.
  w.cache.emit('updated', m);
  assert.deepEqual(w.seen, [true, false]);
  m.state.status = 'error';
  w.cache.emit('updated', m);
  assert.deepEqual(w.seen, [true, false]);
  // A new save locks it again, with a fresh limit.
  const n = save();
  w.cache.emit('added', n);
  assert.deepEqual(w.seen, [true, false, true]);
  w.timers.tick(BUSY_LIMIT_MS);
  assert.deepEqual(w.seen, [true, false, true, false]);
  assert.equal(w.expired(), 2);
});

test('a save started under another window does not lock this one; closing stops the clock', () => {
  const below = watch(false);
  below.cache.emit('added', save());
  assert.deepEqual(below.seen, []);
  const w = watch();
  w.cache.emit('added', save());
  w.stop();
  assert.equal(w.cache.live, false);
  assert.equal(w.timers.waiting, 0);
  w.timers.tick(BUSY_LIMIT_MS);
  assert.equal(w.expired(), 0);
});
