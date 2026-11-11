import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionRefused, retryDelay, renewsOn401, accountRefusal } from './sessionCheck.js';

const answered = (status, data) => ({ response: { status, data } });
const appSaid = (status, message) => answered(status, { success: false, error: { message, code: status } });

test('the app refusing the sign-in ends the session', () => {
  assert.equal(sessionRefused(appSaid(401, 'Invalid or expired token')), true);
  assert.equal(sessionRefused(appSaid(401, 'Account not found or deactivated')), true);
  assert.equal(sessionRefused(appSaid(403, 'This account has no sales-rep profile yet.')), true);
});

test('no signal, a server error or the host in the way keeps the session (audit #116)', () => {
  // No answer at all: what axios gives when the phone has no signal.
  assert.equal(sessionRefused({ message: 'Network Error', code: 'ERR_NETWORK' }), false);
  assert.equal(sessionRefused({ code: 'ECONNABORTED', message: 'timeout of 0ms exceeded' }), false);
  assert.equal(sessionRefused(appSaid(500, 'Internal server error')), false);
  assert.equal(sessionRefused(answered(502, '<html>Bad gateway</html>')), false);
  // The host's firewall: a bare 403 or 429 with nothing from the app in it.
  assert.equal(sessionRefused(answered(403, '')), false);
  assert.equal(sessionRefused(answered(401, undefined)), false);
  assert.equal(sessionRefused(answered(429, '')), false);
  // Something in front of the app answering in JSON of its own is still not the app.
  assert.equal(sessionRefused(answered(403, { error: 'Forbidden' })), false);
  assert.equal(sessionRefused(answered(401, { error: { code: 'UNAUTHORIZED' } })), false);
  assert.equal(sessionRefused(undefined), false);
});

test('opening the app with an expired key renews it: /auth/me tries the renewal key; sign-in and renewal do not', () => {
  for (const url of ['/auth/me', '/auth/change-password', '/auth/logout', '/settlements', '/products?limit=5']) {
    assert.equal(renewsOn401(url), true, url);
  }
  for (const url of ['/auth/login', '/auth/refresh', '/api/auth/login', '/auth/refresh?x=1']) {
    assert.equal(renewsOn401(url), false, url);
  }
  // Not fooled by a longer address that only starts the same way.
  assert.equal(renewsOn401('/auth/login-history'), true);
  assert.equal(renewsOn401(undefined), true);
});

test('a refusal about the account is kept for the sign-in page; a key or password refusal is not', () => {
  assert.equal(accountRefusal(appSaid(401, 'Your sales-rep account is suspended. Ask ZELab to reactivate it.')), 'Your sales-rep account is suspended. Ask ZELab to reactivate it.');
  assert.equal(accountRefusal(appSaid(401, 'Account not found or deactivated')), 'Account not found or deactivated');
  assert.equal(accountRefusal(appSaid(403, 'Your account has been deactivated')), 'Your account has been deactivated');
  for (const m of ['Invalid or expired token', 'Invalid or expired refresh token', 'Authentication token missing',
    'Your session has ended. Please sign in again.', 'Invalid email or password']) {
    assert.equal(accountRefusal(appSaid(401, m)), null, m);
  }
  // The phone-only rule has its own message and hint, shown its own way.
  const device = answered(403, { success: false, error: { message: 'Access restricted', details: { reason: 'DEVICE_RESTRICTED', hint: 'Use a phone' } } });
  assert.equal(accountRefusal(device), null);
  // Not the app speaking (no signal, the host, too many tries): nothing to show.
  assert.equal(accountRefusal({ message: 'Network Error' }), null);
  assert.equal(accountRefusal(answered(403, '')), null);
  assert.equal(accountRefusal(appSaid(429, 'Too many login attempts, try again later')), null);
});

test('the wait between tries starts short and stops growing at 30 seconds', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 9].map(retryDelay), [2000, 4000, 8000, 16000, 30000, 30000, 30000]);
});
