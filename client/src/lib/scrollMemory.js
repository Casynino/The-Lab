/*
 * Where each page entry was scrolled to (audit 12 Nov 2026, navigation-3 / navigation-6).
 *
 * A new page starts at the top; Back and Forward put you back where you were. The browser's own restore
 * runs at the moment of Back, before React has drawn the page it is going back to, so it either clamps on
 * the page being left or lands half-way down a list that has changed. So the app keeps the places itself,
 * by the router's entry key, and puts them back once the page has drawn (Layout's useScrollMemory).
 * Kept in sessionStorage too, so a reload comes back to the same place.
 */

const STORE = 'zl.scroll';
const MAX = 60;
const spots = new Map();

export function remember(key, y) {
  // 'default' is React Router's name for an entry with no key of its own: never a place (keyFirstEntry).
  if (!key || key === 'default' || !Number.isFinite(y)) return;
  spots.delete(key); // newest last, so the oldest go first
  spots.set(key, Math.max(0, Math.round(y)));
  while (spots.size > MAX) spots.delete(spots.keys().next().value);
}

export function recall(key) {
  return key && spots.has(key) ? spots.get(key) : null;
}

export function restoreSpots(raw) {
  try {
    const list = JSON.parse(raw);
    if (Array.isArray(list)) for (const [k, y] of list) remember(String(k), Number(y));
  } catch {
    /* nothing kept, or not ours */
  }
}

export const keptSpots = () => JSON.stringify([...spots]);

export function forgetSpotsForTests() {
  spots.clear();
}

/*
 * React Router calls the first entry of every freshly loaded page 'default' and never writes a real key into
 * history.state, so every fresh load in a tab (a typed address, a bookmark, a link opened in the installed
 * app, Back across pages without the browser's cache) would share one place (navigation-3). So the entry gets
 * a key of its own before the router starts; the router reads it as location.key and a reload keeps it.
 */
export function keyFirstEntry(win = globalThis.window) {
  try {
    const state = win.history.state;
    const kept = state && typeof state === 'object' ? state : {};
    if (kept.key) return;
    win.history.replaceState({ ...kept, key: Math.random().toString(36).slice(2, 10) }, '');
  } catch {
    /* no history to write to: the entry stays 'default', which keeps no place */
  }
}

/*
 * Keys the entry and loads the kept places. The browser's own restore is switched off only while the app's
 * pages are on screen (Layout's useScrollMemory), so the sign-in page and /nino keep it (navigation-3b).
 */
export function installScrollMemory(win = globalThis.window) {
  if (!win?.history) return;
  keyFirstEntry(win);
  try {
    restoreSpots(win.sessionStorage.getItem(STORE));
  } catch {
    /* storage blocked */
  }
  const save = () => {
    try {
      win.sessionStorage.setItem(STORE, keptSpots());
    } catch {
      /* storage blocked or full: the places live only until this tab closes */
    }
  };
  win.addEventListener('pagehide', save);
  win.document?.addEventListener('visibilitychange', () => {
    if (win.document.visibilityState === 'hidden') save();
  });
}

/**
 * The router has landed on an entry. Back and Forward (POP) go to its kept place; a new page starts at the
 * top; a new entry on the same page (a tab, chip or page number written into the address) stays where the
 * page is and keeps that place at once, so Back to it comes here even if nobody scrolls (navigation-6).
 * `from` is the entry before ({ key, pathname }), or null. Returns a stop function, or undefined.
 */
export function arrive({ key, pathname, navType, from }, win = globalThis.window) {
  if (navType === 'POP') return returnTo(recall(key) ?? 0, win);
  if (!from || pathname !== from.pathname) {
    win.scrollTo(0, 0);
    return undefined;
  }
  // The phone menu pins the page (position: fixed) and the window reads 0 meanwhile: use the last place.
  const pinned = win.document?.body?.style?.position === 'fixed';
  const y = pinned ? recall(from.key) : win.scrollY;
  if (y != null) remember(key, y);
  return undefined;
}

const STOPS = ['wheel', 'touchstart', 'pointerdown', 'keydown'];

/**
 * Scroll to `y` as soon as the page is tall enough to get there: tries every frame for up to two seconds
 * (the page may still be drawing its list), and gives up the moment the person scrolls or taps themselves.
 * Returns a stop function.
 */
export function returnTo(y, win = globalThis.window) {
  let frame = 0;
  let tries = 0;
  const stop = () => {
    win.cancelAnimationFrame(frame);
    frame = 0;
    STOPS.forEach((t) => win.removeEventListener(t, stop, true));
  };
  const step = () => {
    win.scrollTo(0, y);
    tries += 1;
    if (Math.abs(win.scrollY - y) <= 1 || tries > 120) {
      stop();
      return;
    }
    frame = win.requestAnimationFrame(step);
  };
  STOPS.forEach((t) => win.addEventListener(t, stop, { capture: true, passive: true }));
  step();
  return stop;
}
