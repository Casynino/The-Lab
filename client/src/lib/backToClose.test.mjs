import test from 'node:test';
import assert from 'node:assert/strict';
import {
  installBackToClose, openLayer, closeLayer, isTopLayer, layerOf, resetBackToCloseForTests,
} from './backToClose.js';

// A browser's history, small enough to read: entries, the current one, popstate a moment after go().
function fakeWindow(start = '/a') {
  const listeners = [];
  const entries = [{ state: null, url: start }];
  let index = 0;
  const location = {};
  const sync = () => {
    const u = new URL(entries[index].url, 'http://app.test');
    Object.assign(location, { pathname: u.pathname, search: u.search, hash: u.hash, href: u.href });
  };
  const abs = (url) => {
    if (url == null) return entries[index].url;
    const u = new URL(String(url), location.href);
    return u.pathname + u.search + u.hash;
  };
  const copy = (s) => (s == null ? null : JSON.parse(JSON.stringify(s)));
  sync();
  const router = []; // what a router listening after us was told
  const history = {
    get state() { return entries[index].state; },
    get length() { return entries.length; },
    pushState(state, _t, url) {
      const next = { state: copy(state), url: abs(url) };
      entries.splice(index + 1);
      entries.push(next);
      index += 1;
      sync();
    },
    replaceState(state, _t, url) {
      entries[index] = { state: copy(state), url: abs(url) };
      sync();
    },
    go(n) {
      setTimeout(() => {
        const to = Math.max(0, Math.min(entries.length - 1, index + n));
        if (to === index) return;
        index = to;
        sync();
        const e = { state: entries[index].state, stopped: false, stopImmediatePropagation() { this.stopped = true; } };
        for (const fn of listeners) { if (e.stopped) break; fn(e); }
      }, 0);
    },
  };
  const win = {
    history,
    location,
    setTimeout,
    clearTimeout,
    addEventListener: (type, fn) => { if (type === 'popstate') listeners.push(fn); },
  };
  return {
    win,
    entries,
    router,
    at: () => index,
    url: () => entries[index].url,
    listenAsRouter: () => listeners.push((e) => router.push(location.pathname + location.search)),
  };
}

const tick = () => new Promise((r) => setTimeout(r, 10));

function setup(start) {
  resetBackToCloseForTests();
  const f = fakeWindow(start);
  installBackToClose(f.win);
  f.listenAsRouter();
  // The router writes its own state on the first entry, as React Router does.
  f.win.history.replaceState({ key: 'k1', idx: 0 }, '');
  return f;
}

// A window as the components use it: open, and close() unmounts it.
function windowOn(f, { busy = () => false } = {}) {
  const w = { closedBy: null };
  w.layer = openLayer({ close: () => { w.closedBy = 'back'; closeLayer(w.layer); }, busy });
  w.shut = () => { w.closedBy = 'x'; closeLayer(w.layer); };
  return w;
}

test('opening a window adds one entry at the same address; its X steps back over it', async () => {
  const f = setup('/settlements');
  const w = windowOn(f);
  assert.equal(f.entries.length, 2);
  assert.equal(f.url(), '/settlements');
  assert.equal(layerOf(f.win.history.state), 1);
  assert.equal(f.win.history.state.key, 'k1', 'the router state is kept');
  w.shut();
  await tick();
  assert.equal(f.at(), 0, 'back on the page entry');
  assert.deepEqual(f.router, [], 'the router never saw it');
});

test('Back with a window open closes the window and stays on the page', async () => {
  const f = setup('/stock-requests');
  const w = windowOn(f);
  f.win.history.go(-1);
  await tick();
  assert.equal(w.closedBy, 'back');
  assert.equal(f.url(), '/stock-requests');
  assert.deepEqual(f.router, []);
  // and nothing else moves: the next Back is the page's own
  assert.equal(f.at(), 0);
});

test('a window over a window: Back closes only the top one, then the next', async () => {
  const f = setup('/settlements');
  const order = windowOn(f);
  const settle = windowOn(f);
  assert.equal(layerOf(f.win.history.state), 2);
  assert.ok(isTopLayer(settle.layer));
  f.win.history.go(-1);
  await tick();
  assert.equal(settle.closedBy, 'back');
  assert.equal(order.closedBy, null);
  f.win.history.go(-1);
  await tick();
  assert.equal(order.closedBy, 'back');
  assert.equal(f.at(), 0);
});

test('a page opened from inside a window takes its place: Back from it goes to the page under the window', async () => {
  const f = setup('/commissions');
  const sheet = windowOn(f);
  // "Open full profile" inside the window: the router pushes the new page
  f.win.history.pushState({ key: 'k2', idx: 1 }, '', '/reps/r1');
  sheet.shut(); // the page changed, so the window unmounts
  await tick();
  assert.deepEqual(f.entries.map((e) => e.url), ['/commissions', '/reps/r1']);
  assert.equal(f.url(), '/reps/r1', 'closing it did not step back');
  f.win.history.go(-1);
  await tick();
  assert.equal(f.url(), '/commissions');
  assert.deepEqual(f.router, ['/commissions'], 'a real page change reaches the router');
});

test('a window busy saving stays open on Back, and keeps its entry', async () => {
  const f = setup('/commissions');
  let saving = true;
  const w = windowOn(f, { busy: () => saving });
  f.win.history.go(-1);
  await tick();
  assert.equal(w.closedBy, null);
  assert.equal(layerOf(f.win.history.state), 1, 'its entry is back on top');
  saving = false;
  f.win.history.go(-1);
  await tick();
  assert.equal(w.closedBy, 'back');
});

test('a window that turns into another in the same moment keeps one entry', async () => {
  const f = setup('/');
  const menu = windowOn(f);
  menu.shut(); // Change password from the menu: the menu shuts...
  const password = windowOn(f); // ...and the window opens at once
  await tick();
  assert.equal(f.entries.length, 2);
  assert.equal(layerOf(f.win.history.state), 1);
  password.shut();
  await tick();
  assert.equal(f.at(), 0);
});

test('replacing the page from inside a window (signing out) writes the new page over the page entry', async () => {
  const f = setup('/inventory');
  f.win.history.pushState({ key: 'k0', idx: 1 }, '', '/inventory'); // some earlier page entry under it
  f.win.history.replaceState({ key: 'k1', idx: 1 }, '');
  const menu = windowOn(f);
  f.win.history.replaceState({ key: 'k9', idx: 1 }, '', '/login');
  menu.shut();
  await tick();
  assert.equal(f.url(), '/login');
  assert.equal(f.entries[f.at()].url, '/login');
  assert.equal(f.entries[f.at() - 1].url, '/inventory', 'the page before is untouched');
  assert.equal(f.entries[f.at()].state.key, 'k9');
});

test('a filter written into the address while a window is open is kept when the window closes', async () => {
  const f = setup('/sales');
  const w = windowOn(f);
  f.win.history.replaceState({ key: 'k5', idx: 0 }, '', '/sales?page=2');
  assert.equal(layerOf(f.win.history.state), 1, 'the window keeps its entry');
  w.shut();
  await tick();
  assert.equal(f.url(), '/sales?page=2');
  assert.equal(f.win.history.state.key, 'k5');
  assert.equal(layerOf(f.win.history.state), 0);
});

test('Forward onto a window already shut steps back to the page', async () => {
  const f = setup('/returns');
  const w = windowOn(f);
  w.shut();
  await tick();
  assert.equal(f.at(), 0);
  f.win.history.go(1); // the shut window's entry is still ahead
  await tick();
  await tick();
  assert.equal(f.at(), 0);
  assert.deepEqual(f.router, []);
});

test('a reload with a window open goes back to the page entry', async () => {
  resetBackToCloseForTests();
  const f = fakeWindow('/finance');
  f.win.history.replaceState({ key: 'k1', idx: 0 }, '');
  f.win.history.pushState({ key: 'k1', idx: 0, zlLayer: 1 }, '');
  installBackToClose(f.win); // the app starting again on the window's entry
  await tick();
  assert.equal(f.at(), 0);
});

test('a link from a page with no window open is an ordinary push', async () => {
  const f = setup('/');
  f.win.history.pushState({ key: 'k2', idx: 1 }, '', '/settlements');
  assert.deepEqual(f.entries.map((e) => e.url), ['/', '/settlements']);
  assert.equal(layerOf(f.win.history.state), 0);
});
