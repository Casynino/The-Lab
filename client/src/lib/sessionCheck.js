/*
  OPENING THE APP WITH NO SIGNAL MUST NOT SIGN ANYBODY OUT.

  On opening, the app asks the server who is signed in (/auth/me). It used to
  forget the session on ANY failure, so a rep who opened it in a dead spot found
  the sign-in screen and had to type the password again (audit #116).

  Only the app itself saying no ends the session: a 401 or 403 that carries the
  app's own error body. No answer at all (no signal), a server error, or a bare
  401/403/429 from the host in front of the app is not a refusal; the session is
  kept and the question is asked again a little later.
*/

/** Did the server itself refuse this sign-in? */
export function sessionRefused(error) {
  const res = error?.response;
  if (!res) return false;
  return (res.status === 401 || res.status === 403) && !!res.data?.error;
}

/** How long to wait before asking again: 2 s, then double, never more than 30 s. */
export function retryDelay(attempt) {
  return Math.min(2000 * 2 ** Math.max(0, attempt), 30_000);
}
