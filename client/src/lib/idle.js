/*
  SIGNING OUT PEOPLE WHO HAVE WALKED AWAY.

  Nino, 10 Nov 2026: "if the rep, or anyone using the system, is not using it
  for some time, the system should log them out, and next time they need to
  log in again." Phones get left in pockets and desk screens get left open on
  a stock and money system; whoever picks the device up next must not be
  inside somebody else's account.

  HOW. The last moment anybody touched the screen is kept in localStorage, not
  in memory, so every tab and the installed app agree on it — working in one
  keeps the others alive. A timer checks it, but a timer is not enough: a
  phone that has been asleep for three hours runs no timers at all. So it is
  also checked the instant the screen wakes (visibility, focus, page show),
  which is the moment that matters.

  WHAT COUNTS AS USING IT: pressing, typing, scrolling, wheeling. Not moving the
  mouse over it, and not the app asking the server for something by itself —
  otherwise a screen left open would keep itself signed in for ever.

  The limit is one number. Change it here and nowhere else.
*/

export const IDLE_LIMIT_MS = 30 * 60_000;
export const IDLE_LIMIT_MINUTES = IDLE_LIMIT_MS / 60_000;

export const ACTIVE_KEY = 'haostock.lastActive';
const NOTICE_KEY = 'haostock.idleNotice';
// Writing storage on every scroll event would be a cost for nothing: once in
// ten seconds is far finer than a thirty-minute limit needs.
const WRITE_EVERY_MS = 10_000;

let lastWrite = 0;

const readActive = () => {
  try { return Number(localStorage.getItem(ACTIVE_KEY)) || 0; } catch { return 0; }
};

export const idle = {
  /** Somebody just used it. Throttled unless `force` (signing in, opening the app). */
  touch(force = false) {
    const now = Date.now();
    if (!force && now - lastWrite < WRITE_EVERY_MS) return;
    lastWrite = now;
    try { localStorage.setItem(ACTIVE_KEY, String(now)); } catch { /* storage is blocked: nothing to remember with */ }
  },

  /**
   * Has it been longer than the limit? A device with no record at all is NOT
   * expired: that is a session from before this existed, or a first visit, and
   * the first thing it does is write one.
   */
  expired() {
    const t = readActive();
    return t > 0 && Date.now() - t > IDLE_LIMIT_MS;
  },

  reset() {
    lastWrite = 0;
    try { localStorage.removeItem(ACTIVE_KEY); } catch { /* ignore */ }
  },

  /** Leave a note for the sign-in page, so it can say why the person is there. */
  flag() {
    try { sessionStorage.setItem(NOTICE_KEY, '1'); } catch { /* ignore */ }
  },

  /** Read the note once. */
  takeNotice() {
    try {
      const had = sessionStorage.getItem(NOTICE_KEY) === '1';
      sessionStorage.removeItem(NOTICE_KEY);
      return had;
    } catch { return false; }
  },
};
