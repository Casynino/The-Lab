import test from 'node:test';
import assert from 'node:assert/strict';
import { matchingCodes } from './auditSearch.js';

const actions = {
  LOGIN: 'signed in sign in log in login',
  LOGOUT: 'signed out sign out log out logout',
  LOGIN_FAILED: 'refused a sign-in failed sign in wrong password',
  DEACTIVATE: 'deactivated suspended suspend switched off',
  DELETE: 'deleted',
};
const entities = { SalesRepresentative: 'a rep', User: 'a user account', Settlement: 'an order' };

test('the words on the screen find their codes', () => {
  assert.deepEqual(matchingCodes('signed in', actions), ['LOGIN']);
  assert.deepEqual(matchingCodes('Signed In', actions), ['LOGIN']);
  assert.deepEqual(matchingCodes('refused', actions), ['LOGIN_FAILED']);
  assert.deepEqual(matchingCodes('suspended', actions), ['DEACTIVATE']);
  assert.deepEqual(matchingCodes('deleted', actions), ['DELETE']);
  // "sign-in", "sign in" and "sign  in" are the same words
  assert.deepEqual(matchingCodes('sign-in', actions), ['LOGIN', 'LOGIN_FAILED']);
  assert.deepEqual(matchingCodes('rep', entities), ['SalesRepresentative']);
  assert.deepEqual(matchingCodes('order', entities), ['Settlement']);
});

test('a name, an email or a very short search matches no words (the server matches people itself)', () => {
  assert.deepEqual(matchingCodes('Nino', actions), []);
  assert.deepEqual(matchingCodes('nino@zelab.site', actions), []);
  assert.deepEqual(matchingCodes('in', actions), []);
  assert.deepEqual(matchingCodes('', actions), []);
  assert.deepEqual(matchingCodes('   ', actions), []);
  assert.deepEqual(matchingCodes('signed in'), []);
});
