import test from 'node:test';
import assert from 'node:assert/strict';

// A tiny stand-in for the browser's storage, installed before the module loads.
const store = () => {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
};
globalThis.localStorage = store();
globalThis.sessionStorage = store();

const { idle, IDLE_LIMIT_MS, ACTIVE_KEY } = await import('./idle.js');

const agoMs = (ms) => localStorage.setItem(ACTIVE_KEY, String(Date.now() - ms));

test('no record at all is not expired (a first visit, or a session from before this existed)', () => {
  localStorage.removeItem(ACTIVE_KEY);
  assert.equal(idle.expired(), false);
});

test('used a moment ago is not expired', () => {
  agoMs(60_000);
  assert.equal(idle.expired(), false);
});

test('the limit is one hour', () => {
  assert.equal(IDLE_LIMIT_MS, 60 * 60_000);
});

test('just inside the limit is not expired, just outside is', () => {
  agoMs(IDLE_LIMIT_MS - 5_000);
  assert.equal(idle.expired(), false);
  agoMs(IDLE_LIMIT_MS + 5_000);
  assert.equal(idle.expired(), true);
});

test('touching writes a fresh time and clears expiry', () => {
  agoMs(IDLE_LIMIT_MS * 3);
  assert.equal(idle.expired(), true);
  idle.touch(true);
  assert.equal(idle.expired(), false);
});

test('an unforced touch right after a forced one is throttled (storage is not written on every scroll)', () => {
  idle.touch(true);
  const first = localStorage.getItem(ACTIVE_KEY);
  localStorage.setItem(ACTIVE_KEY, 'marker');
  idle.touch();
  assert.equal(localStorage.getItem(ACTIVE_KEY), 'marker');
  assert.ok(first);
});

test('reset forgets the clock, so the next sign-in starts clean', () => {
  idle.touch(true);
  idle.reset();
  assert.equal(localStorage.getItem(ACTIVE_KEY), null);
  assert.equal(idle.expired(), false);
});

test('a future timestamp (clock moved back) is not treated as expired', () => {
  localStorage.setItem(ACTIVE_KEY, String(Date.now() + 3_600_000));
  assert.equal(idle.expired(), false);
});
