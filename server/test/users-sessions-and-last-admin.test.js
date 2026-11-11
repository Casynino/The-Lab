'use strict';

// ── Users: Suspend ends sessions for good; the last administrator stays (audit 11 Nov 2026) ─────────
// admin-system-2 / auth-device-1: Users > Suspend (DELETE /users/:id) switched the account off without moving
//   its session version on, so after Activate every old sign-in key worked again. It now ends them for good,
//   as the edit form's Active switch already did.
// admin-system-3: an administrator could give his own account another role and lock everyone out of Users,
//   Settings and the audit log. Your own role cannot be changed, and the last active administrator can never
//   be demoted, switched off, suspended or deleted.
// Run with: npm test

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://stub@localhost:1/none';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only';

const ROLES = { rAdmin: 'ADMIN', rStaff: 'WAREHOUSE_STAFF', rRep: 'SALES_REP' };
let people;
let updates;
const withRole = (u) => (u ? { ...u, role: { id: u.roleId, name: ROLES[u.roleId] } } : null);

const prismaStub = {
  user: {
    findUnique: async ({ where }) => withRole(people.find((u) => u.id === where.id)),
    count: async ({ where }) => people.filter((u) => (
      (!where.id?.not || u.id !== where.id.not)
      && (where.isActive === undefined || u.isActive === where.isActive)
      && (!where.role?.name || ROLES[u.roleId] === where.role.name)
    )).length,
    update: async ({ where, data }) => {
      updates.push({ id: where.id, data });
      return { id: where.id, ...withRole(people.find((u) => u.id === where.id)) };
    },
  },
  role: { findUnique: async ({ where }) => (ROLES[where.id] ? { name: ROLES[where.id] } : null) },
  salesRepresentative: { findUnique: async () => null, findFirst: async () => null },
};

const install = (path, exports) => {
  const filename = require.resolve(path);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
};
install('../src/config/prisma', prismaStub);
install('../src/services/audit.service', { record: async () => {} });

const ctrl = require('../src/controllers/users.controller');

const call = (handler, { id, body = {}, actor = 'owner' }) => new Promise((resolve, reject) => {
  const res = { status: () => res, json: (payload) => resolve(payload) };
  handler({ params: { id }, body, user: { id: actor } }, res, (err) => (err ? reject(err) : resolve(null)));
});
const refused = (re) => (e) => e.statusCode === 400 && re.test(e.message);

test.beforeEach(() => {
  people = [
    { id: 'owner', name: 'Owner', roleId: 'rAdmin', isActive: true },
    { id: 'staff', name: 'Store', roleId: 'rStaff', isActive: true },
  ];
  updates = [];
});

test('Suspend switches the account off AND ends every session it had', async () => {
  await call(ctrl.remove, { id: 'staff' });
  assert.equal(updates.length, 1);
  assert.equal(updates[0].data.isActive, false);
  assert.deepEqual(updates[0].data.sessionVersion, { increment: 1 });
});

test('an administrator cannot change his own role (nobody could reach Users again)', async () => {
  await assert.rejects(call(ctrl.update, { id: 'owner', body: { roleId: 'rStaff' } }), refused(/your own role/));
  assert.equal(updates.length, 0);
  // His own name, phone and the same role still save.
  await call(ctrl.update, { id: 'owner', body: { name: 'Nino', roleId: 'rAdmin' } });
  assert.equal(updates[0].data.name, 'Nino');
  assert.equal('sessionVersion' in updates[0].data, false);
});

test('nor switch his own account off', async () => {
  await assert.rejects(call(ctrl.update, { id: 'owner', body: { isActive: false } }), refused(/your own account/));
  assert.equal(updates.length, 0);
});

test('the last active administrator can never be demoted, switched off, suspended or deleted', async () => {
  // Whoever is asking (here an account that is no longer an active admin itself), the owner stays.
  const by = 'gone';
  await assert.rejects(call(ctrl.update, { id: 'owner', actor: by, body: { roleId: 'rStaff' } }), refused(/last active administrator/));
  await assert.rejects(call(ctrl.update, { id: 'owner', actor: by, body: { isActive: false } }), refused(/last active administrator/));
  await assert.rejects(call(ctrl.remove, { id: 'owner', actor: by }), refused(/last active administrator/));
  await assert.rejects(call(ctrl.remove, { id: 'owner', actor: by, body: { purge: true, confirm: 'x' } }), refused(/last active administrator/));
  assert.equal(updates.length, 0);
});

test('with a second active administrator, one admin can demote or suspend the other', async () => {
  people.push({ id: 'admin2', name: 'Partner', roleId: 'rAdmin', isActive: true });
  await call(ctrl.update, { id: 'admin2', body: { roleId: 'rStaff' } });
  assert.equal(updates[0].data.roleId, 'rStaff');
  assert.deepEqual(updates[0].data.sessionVersion, { increment: 1 });
  await call(ctrl.remove, { id: 'admin2' });
  assert.equal(updates[1].data.isActive, false);
});

test('an administrator account already switched off is not "the last one" and can be suspended or edited', async () => {
  people.push({ id: 'old', name: 'Old admin', roleId: 'rAdmin', isActive: false });
  await call(ctrl.update, { id: 'old', actor: 'gone', body: { roleId: 'rStaff' } });
  assert.equal(updates[0].data.roleId, 'rStaff');
});
