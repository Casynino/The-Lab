import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultUserRoleId } from './constants.js';

// Users > New user (audit 11 Nov 2026, admin-system-1): the roles come back sorted by name, Administrator first.
const roles = [
  { id: 'r-admin', name: 'ADMIN' },
  { id: 'r-rep', name: 'SALES_REP' },
  { id: 'r-staff', name: 'WAREHOUSE_STAFF' },
];

test('a new account starts with no role, so one must be chosen: never Administrator, never Sales rep', () => {
  // Administrator first in the list handed out owner powers; Sales rep made a phone-only rep that cannot become staff.
  assert.equal(defaultUserRoleId(roles), '');
  assert.equal(defaultUserRoleId([...roles].reverse()), '');
  assert.equal(defaultUserRoleId([{ id: 'r-admin', name: 'ADMIN' }]), '');
  assert.equal(defaultUserRoleId([]), '');
  assert.equal(defaultUserRoleId(), '');
});
