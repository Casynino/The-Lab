'use strict';

// ── More time on an order is given once per tap, and only from input that makes sense ───────────────
// #95: the rep's own extension and an admin extension were read-then-write. Two taps at once both passed
//      the checks and both wrote, so the history held the change twice and "undo all" took the time back
//      twice. Pinned: one wins, the other is told the order changed, one history row, undo gives back once.
// #126: the extend-deadline body was not checked, so a bad value reached the database. Pinned: it is
//      refused at the door with a clear answer; what the screen sends still passes.

const test = require('node:test');
const assert = require('node:assert/strict');

const HOUR = 3_600_000;
const at = (d) => new Date(d).getTime();
const hours = (n) => new Date(Date.now() + n * HOUR);

let row = null;
let changes = [];
let seq = 0;

const prismaStub = {
  settlement: {
    findUnique: async ({ where }) =>
      (row && row.id === where.id ? { ...row, deadlineChanges: changes.slice().sort((a, b) => at(b.createdAt) - at(a.createdAt)) } : null),
    // A conditional write, as Postgres does it: only while the row is still as it was read.
    updateMany: async ({ where, data }) => {
      if (!row || row.id !== where.id) return { count: 0 };
      if (typeof where.status === 'string' && row.status !== where.status) return { count: 0 };
      if (where.deadlineAt && at(where.deadlineAt) !== at(row.deadlineAt)) return { count: 0 };
      if (where.selfExtendedAt === null && row.selfExtendedAt) return { count: 0 };
      if (where.penalties?.none && row._count.penalties > 0) return { count: 0 };
      row = { ...row, ...data };
      return { count: 1 };
    },
  },
  settlementPenalty: { count: async () => 0 },
  settlementDeadlineChange: {
    create: async ({ data }) => {
      const created = { id: `chg-${++seq}`, createdAt: data.createdAt || new Date(), undoneAt: null, unrecorded: false, ...data };
      changes.push(created);
      return created;
    },
    updateMany: async ({ where, data }) => {
      const hit = changes.filter((c) => where.id.in.includes(c.id));
      hit.forEach((c) => Object.assign(c, data));
      return { count: hit.length };
    },
  },
  $transaction: async (work) => (typeof work === 'function' ? work(prismaStub) : Promise.all(work)),
};
const install = (path, exports) => {
  const filename = require.resolve(path);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
};
install('../src/config/prisma', prismaStub);
install('../src/services/notification.service', { notifyUser: async () => {}, notifyAdmins: async () => {} });
install('../src/services/whatsappNotify.service', { background: () => {}, extensionTaken: async () => {} });

const settlement = require('../src/services/settlement.service');
const { settlementExtendDeadline } = require('../src/validators/phase2.validator');

const order = (over = {}) => ({
  id: 'stl-1',
  settlementNumber: 'STL-1',
  salesRepId: 'rep-1',
  salesRep: { user: { id: 'user-1', name: 'KP' } },
  status: 'OPEN',
  assignedValue: 100000,
  settledValue: 0,
  returnedValue: 0,
  issuedAt: hours(-24),
  deadlineAt: hours(48),
  reminderStage: 0,
  selfExtendedAt: null,
  selfExtendedById: null,
  preExtensionDeadline: null,
  deadlineBefore: null,
  deadlineChangedAt: null,
  deadlineChangedById: null,
  deadlineChangeKind: null,
  deadlineShiftSeconds: null,
  penaltyFrom: null,
  _count: { penalties: 0 },
  ...over,
});

test.beforeEach(() => { changes = []; });

test('two taps on the rep\'s own extension: one extension, one history row', async () => {
  row = order();
  const before = row.deadlineAt;
  const rep = { id: 'user-1', salesRepId: 'rep-1' };
  const results = await Promise.allSettled([settlement.selfExtend('stl-1', rep), settlement.selfExtend('stl-1', rep)]);
  const won = results.filter((r) => r.status === 'fulfilled');
  const lost = results.filter((r) => r.status === 'rejected');
  assert.equal(won.length, 1);
  assert.equal(lost.length, 1);
  assert.equal(lost[0].reason.statusCode, 409);
  assert.match(lost[0].reason.message, /already been extended/);
  assert.equal(changes.length, 1, 'the history holds the 96 hours once');
  assert.equal(at(row.deadlineAt), at(before) + 96 * HOUR);
  assert.equal(won[0].value.deadlineHistory.length, 1, 'the reply carries the new history row');
});

test('a double submit of an admin extension writes it once, and "undo all" gives back exactly that time', async () => {
  row = order();
  const before = row.deadlineAt;
  const admin = { id: 'admin-1', name: 'Nino' };
  const results = await Promise.allSettled([
    settlement.extendDeadline('stl-1', { additionalHours: 24 }, admin),
    settlement.extendDeadline('stl-1', { additionalHours: 24 }, admin),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  const lost = results.find((r) => r.status === 'rejected');
  assert.equal(lost.reason.statusCode, 409);
  assert.match(lost.reason.message, /changed while you were looking at it/);
  assert.equal(changes.length, 1);
  assert.equal(at(row.deadlineAt), at(before) + 24 * HOUR);

  const out = await settlement.undoDeadlineChange('stl-1', admin, { all: true });
  assert.equal(at(out.deadlineAt), at(before), 'the 24 hours come off once, not twice');
});

test('an admin extension of an overdue order still brings it back to Open', async () => {
  row = order({ status: 'OVERDUE', deadlineAt: hours(-2) });
  const out = await settlement.extendDeadline('stl-1', { additionalHours: 24 }, { id: 'admin-1' });
  assert.equal(row.status, 'OPEN');
  assert.equal(out.status, 'OPEN');
  assert.equal(changes.length, 1);
});

test('extend-deadline input: bad values are refused at the door, what the screen sends passes', () => {
  const ok = (body) => settlementExtendDeadline.body.safeParse(body).success;
  assert.equal(ok({ additionalHours: 24 }), true);
  assert.equal(ok({ deadlineAt: new Date(Date.now() + HOUR).toISOString() }), true);
  assert.equal(ok({ deadlineAt: '2026-11-20T09:00:00+03:00' }), true);
  assert.equal(ok({}), false, 'nothing to change');
  assert.equal(ok({ deadlineAt: 'tomorrow' }), false);
  assert.equal(ok({ additionalHours: 'abc' }), false);
  assert.equal(ok({ additionalHours: -5 }), false);
  assert.equal(ok({ additionalHours: 1e12 }), false, 'an hours figure that would overflow the date');
});
