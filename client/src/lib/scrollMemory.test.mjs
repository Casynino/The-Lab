import test from 'node:test';
import assert from 'node:assert/strict';
import {
  remember, recall, restoreSpots, keptSpots, forgetSpotsForTests, returnTo, arrive, installScrollMemory, keyFirstEntry,
} from './scrollMemory.js';

test('a page entry keeps its own place; an unknown one has none', () => {
  forgetSpotsForTests();
  remember('k1', 813.4);
  remember('k2', 0);
  assert.equal(recall('k1'), 813);
  assert.equal(recall('k2'), 0);
  assert.equal(recall('nope'), null);
  assert.equal(recall(undefined), null);
  remember('k1', -20); // a bounce past the top is the top
  assert.equal(recall('k1'), 0);
});

test('only the newest sixty places are kept, and they survive a reload', () => {
  forgetSpotsForTests();
  for (let i = 0; i < 70; i += 1) remember(`k${i}`, i);
  assert.equal(recall('k0'), null);
  assert.equal(recall('k69'), 69);
  const saved = keptSpots();
  forgetSpotsForTests();
  restoreSpots(saved);
  assert.equal(recall('k69'), 69);
  restoreSpots('not json'); // someone else's value: ignored
  assert.equal(recall('k69'), 69);
});

// A window whose page grows a little each frame, like a list drawing in.
function growingPage(height, view = 800) {
  const frames = [];
  const listeners = new Map();
  const win = {
    scrollY: 0,
    height,
    scrollTo(_x, y) { this.scrollY = Math.max(0, Math.min(y, this.height - view)); },
    requestAnimationFrame(fn) { frames.push(fn); return frames.length; },
    cancelAnimationFrame() { frames.length = 0; },
    addEventListener(t, fn) { listeners.set(t, fn); },
    removeEventListener(t) { listeners.delete(t); },
  };
  const frame = () => { const f = frames.shift(); if (f) f(); return !!f; };
  return { win, frame, touch: () => listeners.get('touchstart')?.() };
}

test('Back waits for the page to be tall enough, then lands on the old place', () => {
  const p = growingPage(1000);
  returnTo(1500, p.win);
  assert.equal(p.win.scrollY, 200, 'clamped while the list is still short');
  p.win.height = 3000; // the rows have arrived
  assert.ok(p.frame());
  assert.equal(p.win.scrollY, 1500);
  assert.equal(p.frame(), false, 'and it stops trying');
});

test('the person scrolling first wins', () => {
  const p = growingPage(1000);
  returnTo(1500, p.win);
  p.touch();
  p.win.height = 3000;
  assert.equal(p.frame(), false);
  assert.equal(p.win.scrollY, 200);
});

// History as a freshly loaded page has it: no state, or the state a reload keeps.
function freshPage(state = null) {
  const listeners = new Map();
  const store = new Map();
  return {
    history: {
      state,
      replaceState(next) { this.state = JSON.parse(JSON.stringify(next)); },
    },
    sessionStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) },
    addEventListener: (t, fn) => listeners.set(t, fn),
    document: { addEventListener() {} },
  };
}

test('two fresh loads in one tab never share a place; a reload keeps its own', () => {
  forgetSpotsForTests();
  const a = freshPage();
  const b = freshPage({ idx: 0 });
  installScrollMemory(a);
  installScrollMemory(b);
  assert.ok(a.history.state.key && b.history.state.key);
  assert.notEqual(a.history.state.key, b.history.state.key);
  assert.equal(b.history.state.idx, 0, 'whatever else the entry holds stays');
  assert.equal(a.history.scrollRestoration, undefined, 'the browser restore is left to Layout');
  const reload = freshPage({ key: 'kept1', idx: 3 });
  installScrollMemory(reload);
  assert.equal(reload.history.state.key, 'kept1');
  const first = a.history.state.key;
  keyFirstEntry(a);
  assert.equal(a.history.state.key, first, 'keyed once');
  // React Router's name for an unkeyed entry is never a place.
  remember('default', 1200);
  assert.equal(recall('default'), null);
});

function pageWindow(height = 3000) {
  const p = growingPage(height);
  p.win.document = { body: { style: {} } };
  return p;
}

test('a page number written over the entry keeps its place for Back, without a scroll', () => {
  forgetSpotsForTests();
  const { win } = pageWindow();
  arrive({ key: 'k1', pathname: '/sales', navType: 'POP', from: null }, win);
  win.scrollTo(0, 480);
  remember('k1', 480);
  // Next page: /sales?page=2 replaces the entry, nobody scrolls.
  arrive({ key: 'k2', pathname: '/sales', navType: 'REPLACE', from: { key: 'k1', pathname: '/sales' } }, win);
  assert.equal(win.scrollY, 480, 'the same page does not jump');
  assert.equal(recall('k2'), 480);
  // Another page starts at the top.
  arrive({ key: 'k3', pathname: '/customers', navType: 'PUSH', from: { key: 'k2', pathname: '/sales' } }, win);
  assert.equal(win.scrollY, 0);
  // Back: page 2, where it was.
  arrive({ key: 'k2', pathname: '/sales', navType: 'POP', from: { key: 'k3', pathname: '/customers' } }, win);
  assert.equal(win.scrollY, 480);
});

test('with the phone menu pinning the page, the last kept place is carried over', () => {
  forgetSpotsForTests();
  const { win } = pageWindow();
  remember('k1', 640);
  win.document.body.style.position = 'fixed';
  win.scrollY = 0;
  arrive({ key: 'k2', pathname: '/profile', navType: 'PUSH', from: { key: 'k1', pathname: '/profile' } }, win);
  assert.equal(recall('k2'), 640);
});
