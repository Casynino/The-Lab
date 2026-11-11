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
  if (!key || !Number.isFinite(y)) return;
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

export function installScrollMemory(win = globalThis.window) {
  if (!win?.history) return;
  try {
    win.history.scrollRestoration = 'manual';
  } catch {
    /* an old browser: it keeps its own restore, which is what we had */
  }
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
