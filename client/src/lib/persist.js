/*
  Wires lib/cacheSnapshot.js (the rules) to the app: write the answers the app
  holds to this device as it works, and put them back when it opens. Read the
  rules there; this file only decides when.
*/
import { queryClient } from '@/lib/queryClient';
import { tokenStore, clientForm } from '@/lib/api';
import { idle } from '@/lib/idle';
import { CACHE_KEY, BUDGET_CHARS, serializeSnapshot, readSnapshot } from '@/lib/cacheSnapshot';

// The build, named by the hashed entry file that loaded this page (lib/version.js reads the same tag).
// A build we cannot name keeps nothing: an answer must never outlive the code that understood it.
const BUILD = (() => {
  if (import.meta.env.DEV) return 'dev';
  try {
    const tag = document.querySelector('script[type=module][src*="/assets/index-"]');
    const m = (tag?.src || '').match(/assets\/index-([A-Za-z0-9_-]+)\.js/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
})();

const SAVE_AFTER_MS = 3000;

let person = null; // who this tab is showing; null = nobody, nothing is written
let timer = 0;
let started = false;

export function forgetCache() {
  try { localStorage.removeItem(CACHE_KEY); } catch { /* storage blocked: nothing was kept */ }
}

/**
 * On opening: if this device holds the last answers of the person the stored
 * sign-in names, put them in the app — every one marked out of date, so each
 * screen shows it at once and asks the server again — and return that person.
 * Otherwise forget them and return null (the app asks the server first, as it
 * always did).
 */
export function restoreSession() {
  if (!BUILD) return null;
  let raw = null;
  try { raw = localStorage.getItem(CACHE_KEY); } catch { return null; }
  if (!raw) return null;
  const token = tokenStore.get();
  // Away longer than the idle limit: the session is about to be ended, so nothing is shown first.
  const snap = token && !idle.expired() ? readSnapshot(raw, { build: BUILD, token, now: Date.now() }) : null;
  if (!snap) {
    forgetCache();
    return null;
  }
  // A rep's account works on a phone only, and the server answers anything else with a sign-out. Never
  // show a rep's figures first on anything else; ask the server, as before.
  if (snap.user.role === 'SALES_REP' && clientForm() !== 'phone') return null;
  for (const e of snap.entries) queryClient.setQueryData(e.k, e.d, { updatedAt: e.t });
  queryClient.invalidateQueries({ refetchType: 'none' });
  person = snap.user;
  return snap.user;
}

function save() {
  timer = 0;
  if (!BUILD || !person) return;
  const token = tokenStore.get();
  if (!token) return;
  const entries = [];
  for (const q of queryClient.getQueryCache().getAll()) {
    const s = q.state;
    if (s.status === 'success' && s.data !== undefined) entries.push({ k: q.queryKey, d: s.data, t: s.dataUpdatedAt });
  }
  const now = Date.now();
  const text = serializeSnapshot({ build: BUILD, token, user: person, entries, now });
  // Null: the stored sign-in names somebody else now (signed in on another tab). Theirs is not ours to write.
  if (!text) return;
  try {
    localStorage.setItem(CACHE_KEY, text);
  } catch {
    // Storage full: keep less rather than nothing; failing that, keep nothing (never a half-old copy).
    try {
      localStorage.setItem(CACHE_KEY, serializeSnapshot({ build: BUILD, token, user: person, entries, now, budget: BUDGET_CHARS / 4 }));
    } catch {
      forgetCache();
    }
  }
}

function schedule() {
  if (timer || !person || !BUILD) return;
  timer = window.setTimeout(() => {
    if (window.requestIdleCallback) window.requestIdleCallback(save, { timeout: 2000 });
    else save();
  }, SAVE_AFTER_MS);
}

function flush() {
  if (!timer) return;
  window.clearTimeout(timer);
  save();
}

/** Who this tab is showing now (null after signing out: nothing more is written). */
export function rememberUser(user) {
  person = user || null;
  if (person) schedule();
  else if (timer) { window.clearTimeout(timer); timer = 0; }
}

/** Write as answers arrive (a few seconds after, when the phone is idle) and when the app is put away. */
export function startPersisting() {
  if (started || !BUILD) return;
  started = true;
  queryClient.getQueryCache().subscribe((event) => {
    if (event.type === 'updated' && event.action?.type === 'success') schedule();
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  window.addEventListener('pagehide', flush);
}
