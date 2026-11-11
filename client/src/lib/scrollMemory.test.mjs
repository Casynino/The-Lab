import test from 'node:test';
import assert from 'node:assert/strict';
import {
  remember, recall, restoreSpots, keptSpots, forgetSpotsForTests, returnTo,
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
