/*
  IS WHAT IS ON SCREEN FRESH?

  A page keeps the figures it already has when asking again fails (no signal,
  a dropped line): the last good answer is worth more than an empty screen. But
  figures kept that way must never pass for live ones (audit pwa-brand-load-1),
  so Layout shows one quiet line above the page whenever:

    - the device says it is offline, or
    - a query a screen is showing failed its last ask and is still showing the
      answer from before.

  Pure, so node --test can drive it.
*/

/**
 * When the oldest figures still on screen were loaded, if any screen is showing
 * figures whose refresh failed; else 0. `queries` are { active, state } — active
 * = a screen is showing it right now, state = the query's own state.
 */
export function staleSince(queries) {
  let oldest = 0;
  for (const q of queries || []) {
    const s = q?.state;
    if (!q?.active || !s || s.status !== 'error' || s.data === undefined || !s.dataUpdatedAt) continue;
    if (!oldest || s.dataUpdatedAt < oldest) oldest = s.dataUpdatedAt;
  }
  return oldest;
}

/**
 * Which notice to show: 'offline', 'stale' or null. Offline wins: a failed
 * refresh is the expected result of having no signal, and one line is enough.
 */
export function noticeKind({ online, since }) {
  if (online === false) return 'offline';
  if (since > 0) return 'stale';
  return null;
}

/**
 * May money be moved on these figures? Only when the server gave them in this
 * visit (the page asked since it opened, or an answer in memory is still
 * within its fresh window). Figures put back from the copy saved on this device
 * read as a success until the server answers, but they can be hours old — a
 * balance correction worked out from one would write the wrong difference
 * (audit pwa-brand-load-2). `q` is a useQuery result.
 */
export function figuresAreLive(q) {
  if (!q || !q.isSuccess) return false;
  return Boolean(q.isFetchedAfterMount || !q.isStale);
}
