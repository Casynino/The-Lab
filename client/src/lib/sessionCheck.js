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
  // The app's own error body is { success: false, error: { message } } (server errorHandler).
  return (res.status === 401 || res.status === 403) && res.data?.success === false && !!res.data?.error?.message;
}

/*
  WHICH REFUSED CALLS TRY THE 30-DAY RENEWAL KEY FIRST (audit 11 Nov 2026, auth-device-3).
  A 401 on any call renews the sign-in once and retries the call — including /auth/me, the question the
  app asks on opening: it used to be left out with every /auth/ address, so opening the app with an expired
  sign-in key signed the person out although the renewal key was still good. Only signing in and the
  renewal itself are left out: their 401 is the answer.
*/
export function renewsOn401(url) {
  return !/\/auth\/(login|refresh)(?:[/?#]|$)/.test(String(url || ''));
}

/*
  WHEN A FAILED RENEWAL ENDS THE SESSION (audit 11 Nov 2026, auth-device-3 rework).
  Only when the server itself refused the 30-day key (expired, ended, account switched off or suspended), or
  the person was signed out while the renewal was on its way. The renewal getting no answer (no signal, a
  server error, the host's firewall, a Wi-Fi login page) is not a refusal: the keys are kept, so opening
  the app in a dead spot waits and asks again (audit #116) instead of signing the rep out.
*/
export const SIGNED_OUT_MEANWHILE = 'Signed out';
export function renewalFailureEndsSession(error) {
  return error?.message === SIGNED_OUT_MEANWHILE || sessionRefused(error);
}

/*
  A REFUSAL THAT IS ABOUT THE ACCOUNT, NOT THE KEY (audit 11 Nov 2026, auth-device-4).
  A rep suspended, an account switched off or not set up: the person must read why on the sign-in page,
  not land there with no word (an open session) or see it pass in a toast (signing in). An expired or
  ended key, a wrong password, and the phone-only rule (shown with its own hint) are not such a reason.
  Returns the server's sentence, or null.
*/
const ABOUT_THE_KEY = new Set([
  'Authentication token missing',
  'Invalid or expired token',
  'Invalid or expired refresh token',
  'Your session has ended. Please sign in again.',
  'Invalid email or password',
]);
export function accountRefusal(error) {
  if (!sessionRefused(error)) return null;
  const { message, details } = error.response.data.error;
  if (details?.reason === 'DEVICE_RESTRICTED' || ABOUT_THE_KEY.has(message)) return null;
  return message;
}

/** How long to wait before asking again: 2 s, then double, never more than 30 s. */
export function retryDelay(attempt) {
  return Math.min(2000 * 2 ** Math.max(0, attempt), 30_000);
}
