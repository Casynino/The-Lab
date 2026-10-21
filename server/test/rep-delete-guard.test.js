'use strict';

// ── A rep may be removed once their boxes are back ───────────────────────────
// The owner asked to be able to delete a rep outright, with their data, "as
// long as they have returned the boxes". That last clause is the whole safety
// of this feature: boxes still out are goods the business is owed, and once the
// rep is gone there is nobody left to chase them. So the guard is tested first
// and the confirmation second.

const test = require('node:test');
const assert = require('node:assert');

let boxesHeld = 0;
let deleted;

const prismaStub = {
  salesRepresentative: {
    findUnique: async () => ({ id: 'rep-1', code: 'REP-007', user: { id: 'user-1', name: 'Patra', email: 'patra@example.com' } }),
    findFirst: async () => null,
    delete: async ({ where }) => { deleted.rep = where.id; return { id: where.id }; },
    update: async ({ where }) => ({ id: where.id, isActive: false }),
  },
  user: { delete: async ({ where }) => { deleted.user = where.id; return { id: where.id }; } },
  inventoryTransaction: {
    aggregate: async () => ({ _sum: { baseQuantity: boxesHeld } }),
    count: async () => 3,
    deleteMany: async () => ({ count: 3 }),
  },
  settlement: { count: async () => 2, findMany: async () => [], deleteMany: async () => ({ count: 0 }) },
  sale: { aggregate: async () => ({ _count: { _all: 4 }, _sum: { total: 120000 } }), findMany: async () => [], deleteMany: async () => ({ count: 0 }) },
  return: { count: async () => 1, findMany: async () => [], deleteMany: async () => ({ count: 0 }) },
  commissionWithdrawal: { aggregate: async () => ({ _sum: { amount: 0 } }), findMany: async () => [], deleteMany: async () => ({ count: 0 }) },
  repStock: { deleteMany: async () => ({ count: 0 }) },
  creditSale: { deleteMany: async () => ({ count: 0 }) },
  settlementPenalty: { deleteMany: async () => ({ count: 0 }) },
  settlementSubmission: { deleteMany: async () => ({ count: 0 }) },
  stockRequest: { findMany: async () => [], deleteMany: async () => ({ count: 0 }) },
  stockTransfer: { findMany: async () => [], deleteMany: async () => ({ count: 0 }) },
  stockCount: { deleteMany: async () => ({ count: 0 }) },
  notification: { deleteMany: async () => ({ count: 0 }) },
  $transaction: async (work) => (typeof work === 'function' ? work(prismaStub) : Promise.all(work)),
};

const install = (path, exports) => {
  const filename = require.resolve(path);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
};
install('../src/config/prisma', prismaStub);
install('../src/services/audit.service', { record: async () => {} });
install('../src/services/inventory.service', { recomputeAllCaches: async () => {}, LOCATION: {}, });
install('../src/services/commission.service', { computeForRep: async () => ({ earned: 20000, available: 20000 }) });

const ctrl = require('../src/controllers/salesReps.controller');

// Minimal express doubles: asyncHandler passes errors to next().
const run = (handler, { body = {}, params = { id: 'rep-1' } } = {}) => new Promise((resolve, reject) => {
  const res = { status: () => res, json: (payload) => resolve(payload) };
  handler({ params, body, user: { id: 'admin-1' } }, res, (err) => (err ? reject(err) : resolve(null)));
});

test.beforeEach(() => { boxesHeld = 0; deleted = {}; });

test('a rep still holding boxes cannot be deleted, and nothing is touched', async () => {
  boxesHeld = 19;
  await assert.rejects(
    () => run(ctrl.remove, { body: { purge: true, confirm: 'REP-007' } }),
    (e) => /still holding 19 boxes/i.test(e.message) && /settle them or record a return/i.test(e.message),
  );
  assert.equal(deleted.rep, undefined);
  assert.equal(deleted.user, undefined);
});

test('one box left is still a box', async () => {
  boxesHeld = 1;
  await assert.rejects(
    () => run(ctrl.remove, { body: { purge: true, confirm: 'REP-007' } }),
    (e) => /still holding 1 box\b/i.test(e.message),
  );
});

test('deleting for good needs the rep code typed back', async () => {
  await assert.rejects(
    () => run(ctrl.remove, { body: { purge: true, confirm: 'REP-008' } }),
    (e) => /send \{ "confirm": "REP-007" \}/.test(e.message),
  );
  assert.equal(deleted.rep, undefined);
});

test('with the boxes back and the code typed, the rep and their login are gone', async () => {
  const out = await run(ctrl.remove, { body: { purge: true, confirm: 'REP-007' } });
  assert.equal(out.data.deleted, true);
  assert.equal(out.data.purged, true);
  assert.equal(deleted.rep, 'rep-1');
  assert.equal(deleted.user, 'user-1');  // "deleted" has to mean they cannot sign in
});

test('without purge, a rep with history is only suspended', async () => {
  const out = await run(ctrl.remove, { body: {} });
  assert.equal(out.data.deactivated, true);
  assert.equal(deleted.rep, undefined);
});

test('the delete screen is told what would be destroyed before anything happens', async () => {
  boxesHeld = 0;
  const out = await run(ctrl.deletionPreview);
  assert.equal(out.data.canDelete, true);
  assert.equal(out.data.willDestroy.settlements, 2);
  assert.equal(out.data.willDestroy.sales, 4);
  assert.equal(out.data.willDestroy.salesValue, 120000);
  assert.equal(out.data.willDestroy.commissionAvailable, 20000);
});

test('and told why not, when boxes are still out', async () => {
  boxesHeld = 19;
  const out = await run(ctrl.deletionPreview);
  assert.equal(out.data.canDelete, false);
  assert.match(out.data.blockedReason, /19 boxes/);
});
