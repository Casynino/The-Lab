import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionRefused, retryDelay } from './sessionCheck.js';

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

test('the wait between tries starts short and stops growing at 30 seconds', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 9].map(retryDelay), [2000, 4000, 8000, 16000, 30000, 30000, 30000]);
});
