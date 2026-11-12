/*
 * Phone and browser Back close the window on top, not the page under it (audit 12 Nov 2026, navigation-1).
 *
 * Before this, every window (Modal, SideSheet, the phone menu, the bell) was plain component state, so the
 * Android Back button left the page and threw away a half-filled request, settlement or return.
 *
 * Now each open window owns one history entry at the page's own address, marked with its depth (1 for the
 * first window, 2 for one opened over it). Back lands on the entry below and the windows above it close.
 * Closing a window any other way (X, Escape, Cancel, Done) steps back over its entry, so no dead Back press
 * is left behind. React Router is never told about these steps: they stay on the same page.
 *
 * - A page opened from inside a window (a link in it, a menu item) takes the window's place in history
 *   instead of stacking above it, so Back from that page goes to the page under the window.
 * - A page that REPLACES the current one while a window is open (signing out from the menu) is written over
 *   the page under the window too, once we are back down there.
 * - A window opening in the same moment another one shuts (a form turning into its receipt, Change password
 *   opened from the menu, React's StrictMode re-running effects) takes over that entry.
 * - A window busy saving keeps its entry: Back does nothing until the save has answered (rep-app-10).
 * - A reload with a window open, or Forward onto a window already shut, steps past the empty entry.
 *
 * installBackToClose() runs once in main.jsx, before the router starts, so its popstate listener is the
 * first one and can keep React Router out of steps that never leave the page.
 */

const KEY = 'zlLayer';

let env = null; // { history, location, setTimeout, clearTimeout }
let nativePush = null;
let nativeReplace = null;
let open = []; // windows on screen, in the order they opened: { depth, close, busy }
let closing = []; // shut in this same moment; their entry is still in history
let steps = 0; // our own history.go() calls that have not landed yet
let afterSteps = []; // work waiting for them to land
let guard = 0; // a step that never lands must not hold everything for ever
let settleQueued = false;
let cur = null; // where history is now: { key, address, layer }
let baseFix = null; // the page under the windows was replaced: { key, address, state, url } to write on it when we get there

export const layerOf = (state) => {
  const n = Number(state && typeof state === 'object' ? state[KEY] : 0);
  return Number.isInteger(n) && n > 0 ? n : 0;
};

const withLayer = (state, depth) => {
  const next = { ...(state && typeof state === 'object' ? state : {}) };
  if (depth > 0) next[KEY] = depth;
  else delete next[KEY];
  return next;
};

const addressOf = (loc) => `${loc.pathname}${loc.search}${loc.hash}`;
const here = () => layerOf(env.history.state);
const snapshot = () => ({ key: env.history.state?.key, address: addressOf(env.location), layer: here() });
const deepest = () => open.reduce((m, w) => Math.max(m, w.depth), 0);
const pathOf = (url) => {
  if (url == null || url === '') return env.location.pathname;
  try {
    return new URL(String(url), env.location.href).pathname;
  } catch {
    return null;
  }
};

function whenSettled(fn) {
  if (steps > 0) afterSteps.push(fn);
  else fn();
}

function release() {
  env.clearTimeout(guard);
  steps = 0;
  const work = afterSteps;
  afterSteps = [];
  work.forEach((fn) => fn());
}

function stepBack(n) {
  if (!(n > 0)) return;
  steps += 1;
  env.clearTimeout(guard);
  guard = env.setTimeout(release, 1500);
  env.history.go(-n);
}

// The windows' entries are gone (a page took their place): closing them later touches no history.
function leaveWindows() {
  for (const w of open) w.depth = 0;
  closing = [];
}

function giveEntry(w) {
  whenSettled(() => {
    if (!open.includes(w) || w.depth) return;
    w.depth = Math.max(deepest(), here()) + 1;
    nativePush(withLayer(env.history.state, w.depth), '');
    cur = snapshot();
  });
}

function settle() {
  settleQueued = false;
  whenSettled(() => {
    closing = [];
    const keep = deepest();
    const at = here();
    if (at > keep) stepBack(at - keep);
  });
}

/** A window opened. `close` shuts it; `busy` says it is saving and must stay. */
export function openLayer({ close, busy } = {}) {
  const w = { depth: 0, close: close || (() => {}), busy: busy || (() => false) };
  if (!env) {
    open.push(w);
    return w;
  }
  // Take over the lowest entry of a window that shut in this same moment, if it is above every open one.
  const top = deepest();
  closing.sort((a, b) => a.depth - b.depth);
  const i = closing.findIndex((c) => c.depth > top);
  open.push(w);
  if (i >= 0) w.depth = closing.splice(i, 1)[0].depth;
  else giveEntry(w);
  return w;
}

/** A window closed (by its X, Escape, Cancel, Done, or because Back closed it). */
export function closeLayer(w) {
  const i = open.indexOf(w);
  if (i < 0) return;
  open.splice(i, 1);
  if (!env || !w.depth) return; // Back already took its entry, or a page opened from it took its place
  closing.push(w);
  if (!settleQueued) {
    settleQueued = true;
    queueMicrotask(settle);
  }
}

export const isTopLayer = (w) => open[open.length - 1] === w;

function pushState(state, title, url) {
  if (layerOf(state) === 0 && here() > 0 && (open.length || closing.length)) {
    // A page opened from inside a window takes the window's place.
    leaveWindows();
    nativeReplace(state, title, url);
  } else {
    nativePush(state, title, url);
  }
  cur = snapshot();
}

function replaceState(state, title, url) {
  const d = here();
  if (layerOf(state) === 0 && d > 0 && (open.length || closing.length)) {
    // The page under the window is being replaced (a link to the page already open, a filter written into
    // the address, signing out from the menu). The page's own entry, below the window's, is written over
    // when we are back down there.
    baseFix = { key: env.history.state?.key, address: addressOf(env.location), state, url };
    if (pathOf(url) === env.location.pathname) {
      nativeReplace(withLayer(state, d), title, url); // same page: the window stays and keeps its entry
    } else {
      leaveWindows(); // another page: it takes the window's entry now, and we go down to fix the page's own
      nativeReplace(state, title, url);
      stepBack(d);
    }
    cur = snapshot();
    return;
  }
  nativeReplace(state, title, url);
  cur = snapshot();
}

function onPop(e) {
  const before = cur;
  const landed = env.history.state;
  if (baseFix && landed?.key === baseFix.key && layerOf(landed) === 0 && addressOf(env.location) === baseFix.address) {
    // Back on the page under the windows, which was replaced meanwhile: write the new page on it before
    // the router reads it.
    const fix = baseFix;
    baseFix = null;
    nativeReplace(fix.state, '', fix.url);
  }
  cur = snapshot();
  if (steps > 0) {
    // One of our own steps: nothing on the page moves, so React Router is not told.
    e.stopImmediatePropagation();
    steps -= 1;
    if (steps === 0) release();
    return;
  }
  const samePage = !!before && before.key === cur.key && before.address === cur.address
    && (before.layer > 0 || cur.layer > 0);
  if (samePage) e.stopImmediatePropagation();

  const d = cur.layer;
  const shut = open.filter((w) => w.depth > d || w.depth === 0);
  if (shut.length && samePage && shut.some((w) => w.busy())) {
    // A window still saving stays open, and so does its entry: put it back.
    for (let k = d + 1; k <= deepest(); k += 1) nativePush(withLayer(env.history.state, k), '');
    cur = snapshot();
    return;
  }
  for (const w of shut.reverse()) {
    w.depth = 0;
    w.close();
  }
  // Landed on an entry no open window owns (Forward onto a window already shut, one a reload left behind):
  // step past it to the page itself.
  const keep = deepest();
  if (d > keep) stepBack(d - keep);
}

export function installBackToClose(win = globalThis.window) {
  if (env || !win?.history) return;
  const h = win.history;
  env = {
    history: h,
    location: win.location,
    setTimeout: win.setTimeout.bind(win),
    clearTimeout: win.clearTimeout.bind(win),
  };
  nativePush = h.pushState.bind(h);
  nativeReplace = h.replaceState.bind(h);
  h.pushState = pushState;
  h.replaceState = replaceState;
  // Capture, and installed before the router: our steps can be kept from it.
  win.addEventListener('popstate', onPop, true);
  cur = snapshot();
  // Reloaded with a window open: nothing is open now, so go back to the page's own entry.
  if (cur.layer > 0) stepBack(cur.layer);
}

// Tests only.
export function resetBackToCloseForTests() {
  if (env) env.clearTimeout(guard);
  env = null;
  nativePush = null;
  nativeReplace = null;
  open = [];
  closing = [];
  steps = 0;
  afterSteps = [];
  guard = 0;
  settleQueued = false;
  cur = null;
  baseFix = null;
}
