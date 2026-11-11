/*
  THE LAST SCREEN, KEPT ON THIS DEVICE — FOR THE SAME PERSON ONLY.

  Nino, 11 Nov 2026: "when I click something the app takes time to load and
  then shows the data … I want it to open at once." From Tanzania every answer
  from the server costs about a third of a second, and opening the app asked
  twice in a row (who is this? then: the home page) before it showed anything.

  So the answers the app already had are written to this device as it works,
  and the next time it opens it shows them at once while it asks the server
  again for every one of them. Rules, because these are stock and money
  figures and a phone can change hands:

  - It belongs to ONE person: the account the stored sign-in names (`sub`).
    Anyone else's sign-in — or none — and it is not read, it is thrown away.
  - It belongs to ONE build. A deploy can change what an answer looks like,
    so a new build starts from nothing.
  - It is never older than MAX_AGE_MS (the one-hour idle sign-out clears it
    long before that anyway).
  - Signing out, being signed out (idle, refused, another tab) and signing in
    as someone else all delete it: see tokenStore.clear() in lib/api.js.

  This file has no browser or app imports so its rules can be tested on their
  own (cacheSnapshot.test.mjs). lib/persist.js wires it to the app.
*/

export const CACHE_KEY = 'zl.cache';
const FORMAT = 1;
export const MAX_AGE_MS = 12 * 60 * 60_000;
// localStorage holds about five million characters per site on the phones we
// have seen; this leaves most of it for everything else.
export const BUDGET_CHARS = 1_500_000;
// One answer bigger than this (a long list of returns) is simply asked again.
export const ONE_MAX_CHARS = 400_000;

// Never written to the device. Settings hold the owner's CallMeBot key and a
// rep's profile holds the rep's (SalesRepProfile's edit form reads it from
// there, so it cannot simply be blanked): those answers are asked again
// instead. Anywhere else a key or a sign-in can ride along inside an answer
// (a rep record nested in a list), the field itself is left out.
const NEVER_KEEP = new Set(['settings', 'sales-rep-profile']);
const SECRET_FIELD = /^(whatsappApiKey|apiKey|apikey|passwordHash|password|accessToken|refreshToken)$/;
const noSecrets = (k, v) => (SECRET_FIELD.test(k) ? undefined : v);

/** The claims inside a stored sign-in (a JWT), or null. Read only to choose; the server still decides. */
export function tokenClaims(token) {
  try {
    const part = String(token || '').split('.')[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64 + '==='.slice((b64.length + 3) % 4));
    const json = new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
    const c = JSON.parse(json);
    if (!c || typeof c !== 'object' || c.sub == null) return null;
    return { sub: String(c.sub), role: typeof c.role === 'string' ? c.role : null };
  } catch {
    return null;
  }
}

/**
 * The text to store, or null when it must not be stored: no sign-in, a build
 * we cannot name, or a sign-in that names somebody other than `user` (another
 * tab signed in as someone else — theirs is not ours to write).
 *
 * `entries` are { k: queryKey, d: data, t: updatedAt }. Newest first, each
 * under ONE_MAX_CHARS, until `budget` is used.
 */
export function serializeSnapshot({ build, token, user, entries, now, budget = BUDGET_CHARS }) {
  const claims = tokenClaims(token);
  if (!build || !claims || !user || String(user.id) !== claims.sub) return null;
  const head = JSON.stringify({ f: FORMAT, b: build, u: claims.sub, at: now, user }, noSecrets);
  let used = head.length;
  const parts = [];
  const newest = [...(entries || [])].sort((a, z) => (z.t || 0) - (a.t || 0));
  for (const e of newest) {
    if (!Array.isArray(e.k) || NEVER_KEEP.has(e.k[0])) continue;
    let text;
    try { text = JSON.stringify({ k: e.k, d: e.d, t: e.t }, noSecrets); } catch { continue; }
    if (!text || text.length > ONE_MAX_CHARS || used + text.length + 1 > budget) continue;
    used += text.length + 1;
    parts.push(text);
  }
  return `${head.slice(0, -1)},"q":[${parts.join(',')}]}`;
}

/**
 * What was stored, if — and only if — it belongs to the person this sign-in
 * names, on this build, and is recent: { user, entries }. Otherwise null.
 */
export function readSnapshot(raw, { build, token, now }) {
  if (!raw || !build) return null;
  const claims = tokenClaims(token);
  if (!claims) return null;
  let s;
  try { s = JSON.parse(raw); } catch { return null; }
  if (!s || s.f !== FORMAT || s.b !== build || s.u !== claims.sub) return null;
  if (!s.user || String(s.user.id) !== claims.sub) return null;
  // A changed role is a changed person as far as the screens go.
  if (claims.role && s.user.role !== claims.role) return null;
  const age = now - s.at;
  if (!(typeof s.at === 'number' && age >= 0 && age < MAX_AGE_MS)) return null;
  if (!Array.isArray(s.q)) return null;
  const entries = s.q.filter((e) => e && Array.isArray(e.k) && e.d !== undefined && typeof e.t === 'number');
  return { user: s.user, entries };
}
