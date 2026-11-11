import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultUserRoleId } from './constants.js';

// Users > New user (audit 11 Nov 2026, admin-system-1): the roles come back sorted by name, Administrator first.
const roles = [
  { id: 'r-admin', name: 'ADMIN' },
  { id: 'r-rep', name: 'SALES_REP' },
  { id: 'r-staff', name: 'WAREHOUSE_STAFF' },
];

test('a new account starts as a Sales rep, never as the first role in the list (Administrator)', () => {
  assert.equal(defaultUserRoleId(roles), 'r-rep');
  assert.equal(defaultUserRoleId([...roles].reverse()), 'r-rep');
});

test('with no Sales rep role (or roles not loaded yet) nothing is pre-selected, so a role must be chosen', () => {
  assert.equal(defaultUserRoleId([{ id: 'r-admin', name: 'ADMIN' }]), '');
  assert.equal(defaultUserRoleId([]), '');
  assert.equal(defaultUserRoleId(), '');
});
