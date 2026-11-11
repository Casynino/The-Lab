'use strict';

// ── Only a Sales rep account can be made a rep ───────────────────────────────
// The New rep window offered every user without a rep profile, the owner's own
// admin login included, and the server made a rep of whoever it was sent. An
// admin with a rep profile keeps every admin power and turns up as a phantom
// rep in rep lists and stock flows — the very thing users.update refuses when
// a rep's role is changed. The server now refuses it too.

const test = require('node:test');
const assert = require('node:assert');

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://stub@localhost:1/none';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only';

const USERS = {
  admin: { id: 'admin', name: 'Owner', role: { name: 'ADMIN' }, salesRep: null },
  staff: { id: 'staff', name: 'Store', role: { name: 'WAREHOUSE_STAFF' }, salesRep: null },
  rep: { id: 'rep', name: 'Patra', role: { name: 'SALES_REP' }, salesRep: null },
};
let created;

const prismaStub = {
  user: { findUnique: async ({ where }) => USERS[where.id] || null },
  salesRepresentative: {
    findFirst: async () => null,
    findMany: async () => [],
    create: async ({ data }) => { created.push(data); return { id: `sr-${data.userId}`, ...data }; },
  },
  $transaction: async (work) => (typeof work === 'function' ? work(prismaStub) : Promise.all(work)),
};

const install = (path, exports) => {
  const filename = require.resolve(path);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
};
install('../src/config/prisma', prismaStub);
install('../src/services/audit.service', { record: async () => {} });
install('../src/services/inventory.service', { recomputeAllCaches: async () => {}, LOCATION: {} });
install('../src/services/commission.service', {});
install('../src/utils/numbering', { nextRepCode: async () => 'REP-101', nextDocNumber: async () => 'X-1' });

const ctrl = require('../src/controllers/salesReps.controller');

const run = (body) => new Promise((resolve, reject) => {
  const res = { status: () => res, json: (payload) => resolve(payload) };
  ctrl.create({ params: {}, body, user: { id: 'admin' } }, res, (err) => (err ? reject(err) : resolve(null)));
});

test.beforeEach(() => { created = []; });

test('an administrator cannot be made a sales rep', async () => {
  await assert.rejects(() => run({ userId: 'admin' }), (e) => e.statusCode === 400 && /Sales rep role/.test(e.message));
  assert.equal(created.length, 0);
});

test('nor can warehouse staff', async () => {
  await assert.rejects(() => run({ userId: 'staff' }), /Sales rep role/);
  assert.equal(created.length, 0);
});

test('a Sales rep account still becomes a rep', async () => {
  const out = await run({ userId: 'rep' });
  assert.equal(created.length, 1);
  assert.equal(created[0].userId, 'rep');
  assert.equal(out.data.code, 'REP-101');
});
