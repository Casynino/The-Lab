/*
 * Which saves keep a window locked (audit rep-app-10), for useBackToClose.
 *
 * A save (a react-query mutation) started while the window was the one on top keeps it open until the server
 * answers - but never for longer than `limit`. axios has no timeout, so on a bad phone connection a request
 * can hang for minutes, and the window must not trap the person meanwhile. When the limit passes the window
 * can be closed again and `onExpire` tells the person; the request itself is not stopped, and its own button
 * (loading while it is pending) stays disabled.
 */

export const BUSY_LIMIT_MS = 25000;

export function watchSaves(cache, { isOnTop, onChange, onExpire, limit = BUSY_LIMIT_MS, timers = globalThis }) {
  const mine = new Set();
  const expired = new Set(); // still pending, but past the limit: they no longer hold the window
  let busy = false;
  let timer = 0;

  const holding = (m) => m.state?.status === 'pending' && !expired.has(m);

  function expire() {
    timer = 0;
    for (const m of mine) if (holding(m)) expired.add(m);
    set(false);
    onExpire?.();
  }

  function set(now) {
    if (now === busy) return;
    busy = now;
    if (now) {
      timer = timers.setTimeout(expire, limit);
    } else if (timer) {
      timers.clearTimeout(timer);
      timer = 0;
    }
    onChange(now);
  }

  const stop = cache.subscribe((event) => {
    const m = event?.mutation;
    if (!m) return;
    if (event.type === 'added' && isOnTop()) mine.add(m);
    if (!mine.has(m)) return;
    if (event.type === 'removed') {
      mine.delete(m);
      expired.delete(m);
    }
    set([...mine].some(holding));
  });

  return () => {
    stop();
    if (timer) timers.clearTimeout(timer);
    timer = 0;
  };
}
