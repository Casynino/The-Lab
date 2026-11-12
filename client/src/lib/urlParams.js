/*
 * Tabs, filter chips and the page number live in the address (audit 12 Nov 2026, navigation-4/6/7/11):
 * Back from a row's page comes back to the same chip and page, a link can open a tab, and a reload keeps
 * them. Pages write them with `{ replace: true }`, so changing a tab or a filter is not a Back step.
 *
 *   const status = pickParam(params, 'status', CHIPS);            // '' when missing or unknown
 *   setParams((p) => withParams(p, { status: next, page: null }), { replace: true });
 */

export function pickParam(params, name, allowed, fallback = '') {
  const v = params.get(name);
  return v != null && allowed.includes(v) ? v : fallback;
}

export function pageParam(params, name = 'page') {
  const n = Number(params.get(name));
  return Number.isInteger(n) && n > 1 ? n : 1;
}

/** A copy of `params` with each change set, or removed when it is empty (null, undefined, '', page 1). */
export function withParams(params, changes) {
  const next = new URLSearchParams(params);
  for (const [k, v] of Object.entries(changes)) {
    if (v == null || v === '' || (k === 'page' && Number(v) <= 1)) next.delete(k);
    else next.set(k, String(v));
  }
  return next;
}
