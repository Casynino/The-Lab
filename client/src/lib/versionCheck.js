// How often lib/version.js may ask the server whether a new build is out.
//
// It asked on EVERY window focus and every return to the tab, with no limit:
// three clicks between windows in four seconds were three full downloads of
// index.html, each a request billed at the host (audit pwa-brand-load-6). A
// deploy is not missed by waiting a minute.
export const MIN_GAP_MS = 60_000;

/** May a check run now? `last` is when the previous one ran (0 = never). */
export function dueForCheck(now, last, minGap = MIN_GAP_MS) {
  if (!last) return true;
  return now - last >= minGap;
}
