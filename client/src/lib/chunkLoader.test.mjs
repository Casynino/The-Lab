import test from 'node:test';
import assert from 'node:assert/strict';
import { createChunkLoader, warmInTurn, shouldWarm, isPageLoadError } from './chunkLoader.js';

// A loader whose fetch we finish by hand, counting how often it was asked.
function manual() {
  const calls = [];
  const loader = () => new Promise((resolve, reject) => calls.push({ resolve, reject }));
  return { loader, calls };
}

test('a page is fetched once, however many ask for it', async () => {
  const a = manual();
  const pages = createChunkLoader({ A: a.loader });
  const p1 = pages.load('A', { ahead: true });
  const p2 = pages.load('A');
  assert.equal(a.calls.length, 1);
  assert.equal(p1, p2);
  a.calls[0].resolve({ default: 'PageA' });
  assert.deepEqual(await p2, { default: 'PageA' });
  assert.equal(pages.loaded('A'), 'PageA');
  await pages.load('A');
  assert.equal(a.calls.length, 1, 'a page already here is not fetched again');
});

test('loaded() is null until the file is here, and reads named exports', async () => {
  const pages = createChunkLoader({ charts: async () => ({ TrendChart: 'T' }) });
  assert.equal(pages.loaded('charts', 'TrendChart'), null);
  await pages.load('charts');
  assert.equal(pages.loaded('charts', 'TrendChart'), 'T');
  assert.equal(pages.loaded('charts', 'Nope'), null);
});

test('only fetch-ahead in flight -> a failure must not reload the app', async () => {
  const a = manual();
  const pages = createChunkLoader({ A: a.loader });
  assert.equal(pages.aheadOnly(), false, 'nothing in flight');
  const p = pages.load('A', { ahead: true });
  assert.equal(pages.aheadOnly(), true);
  a.calls[0].reject(new TypeError('Failed to fetch dynamically imported module'));
  await assert.rejects(p, (e) => e.pageLoadFailed === true);
  assert.equal(pages.aheadOnly(), false);
  assert.deepEqual(pages.inFlight(), { waiting: 0, ahead: 0 });
});

// Vite fires 'vite:preloadError' from inside the import's own chain
// (`baseModule().catch(handlePreloadError)`), so main.jsx asks while the fetch
// still counts as in flight. Model that chain exactly.
function viteLike(fail, onPreloadError) {
  return () => Promise.reject(fail).catch((err) => { onPreloadError(); throw err; });
}

test('main.jsx, asked from inside the failing import, sees the right kind', async () => {
  let seen = null;
  const pages = createChunkLoader({
    A: viteLike(new TypeError('404'), () => { seen = pages.aheadOnly(); }),
  });
  await assert.rejects(pages.load('A', { ahead: true }));
  assert.equal(seen, true, 'a fetch-ahead failing: no reload');
  await assert.rejects(pages.load('A'));
  assert.equal(seen, false, 'a page being opened failing: reload');
});

test('a screen joining a fetch-ahead makes its failure a real one', async () => {
  const a = manual();
  const pages = createChunkLoader({ A: a.loader });
  pages.load('A', { ahead: true }).catch(() => {});
  pages.load('A').catch(() => {});
  assert.deepEqual(pages.inFlight(), { waiting: 1, ahead: 0 });
  assert.equal(pages.aheadOnly(), false);
  a.calls[0].resolve({ default: 'A' });
  await pages.load('A');
  assert.deepEqual(pages.inFlight(), { waiting: 0, ahead: 0 });
});

test('a screen waiting and a fetch-ahead of another page: a failure reloads', () => {
  const a = manual();
  const b = manual();
  const pages = createChunkLoader({ A: a.loader, B: b.loader });
  pages.load('A').catch(() => {});
  pages.load('B', { ahead: true }).catch(() => {});
  assert.equal(pages.aheadOnly(), false);
});

test('a failed fetch is forgotten, so the next open asks again', async () => {
  let n = 0;
  const pages = createChunkLoader({
    A: () => { n += 1; return n === 1 ? Promise.reject(new Error('offline')) : Promise.resolve({ default: 'A' }); },
  });
  await assert.rejects(pages.load('A', { ahead: true }));
  assert.equal(pages.loaded('A'), null);
  assert.deepEqual(await pages.load('A'), { default: 'A' });
  assert.equal(n, 2);
});

test('a loader that throws at once is a failed fetch, not a crash', async () => {
  const pages = createChunkLoader({ A: () => { throw new Error('boom'); } });
  await assert.rejects(pages.load('A'), (e) => e.pageLoadFailed === true && e.message === 'boom');
  assert.deepEqual(pages.inFlight(), { waiting: 0, ahead: 0 });
});

test('no module and no error (the reload guard took over) keeps waiting, never draws', async () => {
  const pages = createChunkLoader({ A: async () => undefined });
  let settled = false;
  pages.load('A').then(() => { settled = true; }, () => { settled = true; });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(settled, false);
  assert.equal(pages.loaded('A'), null);
  assert.deepEqual(pages.inFlight(), { waiting: 0, ahead: 0 });
});

test('an unknown page name is refused', async () => {
  const pages = createChunkLoader({});
  await assert.rejects(pages.load('Nope'), /Unknown page/);
});

test('warmInTurn: one at a time, in order, skipping failures', async () => {
  const order = [];
  let active = 0;
  let maxActive = 0;
  const load = async (name) => {
    active += 1; maxActive = Math.max(maxActive, active);
    await new Promise((r) => setTimeout(r, 2));
    active -= 1;
    order.push(name);
    if (name === 'B') throw new Error('offline');
  };
  await warmInTurn(['A', 'B', 'C'], load, { pause: async () => {} });
  assert.deepEqual(order, ['A', 'B', 'C']);
  assert.equal(maxActive, 1);
});

test('warmInTurn waits while the screen is still fetching, but not for ever', async () => {
  const pauses = [];
  let busyFor = 3;
  const loaded = [];
  await warmInTurn(['A'], async (n) => { loaded.push(n); }, {
    isBusy: () => busyFor-- > 0,
    pause: async (ms) => { pauses.push(ms); },
    step: 250,
  });
  assert.deepEqual(pauses, [250, 250, 250]);
  assert.deepEqual(loaded, ['A']);

  const capped = [];
  await warmInTurn(['B'], async (n) => { loaded.push(n); }, {
    isBusy: () => true, pause: async (ms) => { capped.push(ms); }, step: 250, maxWait: 1000,
  });
  assert.equal(capped.length, 4, 'gives up waiting after maxWait');
  assert.deepEqual(loaded, ['A', 'B']);
});

test('warmInTurn stops when the person leaves (signs out)', async () => {
  const loaded = [];
  let stop = false;
  await warmInTurn(['A', 'B', 'C'], async (n) => { loaded.push(n); if (n === 'A') stop = true; }, {
    stopped: () => stop, pause: async () => {},
  });
  assert.deepEqual(loaded, ['A']);
});

test('a page file that failed is told apart from a bug in a page', () => {
  assert.equal(isPageLoadError(Object.assign(new Error('x'), { pageLoadFailed: true })), true);
  // Chrome, Firefox, Safari wording for a failed import()
  assert.equal(isPageLoadError(new TypeError('Failed to fetch dynamically imported module: https://x/assets/Purchases-a1.js')), true);
  assert.equal(isPageLoadError(new TypeError('error loading dynamically imported module: https://x/assets/Purchases-a1.js')), true);
  assert.equal(isPageLoadError(new TypeError('Importing a module script failed.')), true);
  assert.equal(isPageLoadError(new Error('Unable to preload CSS for /assets/x.css')), true);
  // a real bug keeps going up, as it always did
  assert.equal(isPageLoadError(new TypeError("Cannot read properties of undefined (reading 'total')")), false);
  assert.equal(isPageLoadError(null), false);
  assert.equal(isPageLoadError('boom'), false);
});

test('no fetch-ahead with data saver on or on a 2G line', () => {
  assert.equal(shouldWarm(undefined), true, 'browsers without the API (iPhone) still warm');
  assert.equal(shouldWarm({ effectiveType: '4g' }), true);
  assert.equal(shouldWarm({ effectiveType: '3g' }), true);
  assert.equal(shouldWarm({ effectiveType: '2g' }), false);
  assert.equal(shouldWarm({ effectiveType: 'slow-2g' }), false);
  assert.equal(shouldWarm({ effectiveType: '4g', saveData: true }), false);
});
