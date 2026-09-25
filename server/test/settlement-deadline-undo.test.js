'use strict';

// ── Time given by mistake has to be takeable back, without inventing debt ────
// The owner extended an order he did not mean to extend. Until now there was no
// way out: the rep's own 96 hours could not be undone at all, and they carry a
// doubled daily fine.
//
// Taking time back moves the deadline into the past, and that is where money
// goes wrong if nobody is careful — a rep billed for days he was told he had,
// fines left standing at the extended rate, or the hours a return spent waiting
// on The Lab swallowed with the extension. Each of those is a test here.
//
// The service is a pure function of the row once the database is swapped for an
// in-memory one, so this runs the real code against real rows.

const test = require('node:test');
const assert = require('node:assert');

const HOUR = 3_600_000;
const now = () => new Date();
const hours = (n) => new Date(Date.now() + n * HOUR);
const at = (d) => new Date(d).getTime();

let row = null;
let fines = 0; // daily late-fines already charged on the order
const prismaStub = {
  settlement: {
    findUnique: async ({ where }) => (row && row.id === where.id ? { ...row } : null),
    // The real claim: it only writes if the row is still as it was read.
    updateMany: async ({ where, data }) => {
      if (!row || row.id !== where.id) return { count: 0 };
      if (where.status?.not && row.status === where.status.not) return { count: 0 };
      if (typeof where.status === 'string' && row.status !== where.status) return { count: 0 };
      if (where.penalties?.none && fines > 0) return { count: 0 };
      if (where.deadlineAt && at(where.deadlineAt) !== at(row.deadlineAt)) return { count: 0 };
      row = { ...row, ...data };
      return { count: 1 };
    },
    update: async ({ where, data }) => {
      assert.equal(where.id, row.id);
      row = { ...row, ...data };
      return { ...row };
    },
  },
  settlementPenalty: { count: async () => fines },
};

const noop = { notifyUser: async () => {}, notifyAdmins: async () => {} };
const install = (path, exports) => {
  const filename = require.resolve(path);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
};
install('../src/config/prisma', prismaStub);
install('../src/services/notification.service', noop);

const settlement = require('../src/services/settlement.service');
const penalty = require('../src/services/penalty.service');

const SELF_HOURS = 96;
const order = (over = {}) => ({
  id: 'stl-1',
  settlementNumber: 'STL-20260919-0003',
  salesRepId: 'rep-1',
  salesRep: { user: { id: 'user-1', name: 'KP' } },
  status: 'OPEN',
  assignedValue: 1_387_500,
  settledValue: 0,
  returnedValue: 0,
  issuedAt: hours(-72),
  deadlineAt: hours(96),
  reminderStage: 2,
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

// An order the rep extended themselves, recorded the way selfExtend records it.
const selfExtended = (over = {}) => {
  const was = over.was || hours(-2);
  const rest = { ...over };
  delete rest.was;
  // A rep can only take the extension BEFORE the deadline passes, so the
  // fixture puts the activation three hours ahead of it.
  const takenAt = new Date(at(was) - 3 * HOUR);
  return order({
    deadlineAt: new Date(at(was) + SELF_HOURS * HOUR),
    selfExtendedAt: takenAt,
    selfExtendedById: 'user-1',
    preExtensionDeadline: was,
    deadlineBefore: was,
    deadlineChangedAt: takenAt,
    deadlineChangedById: 'user-1',
    deadlineChangeKind: 'SELF_EXTENSION',
    deadlineShiftSeconds: SELF_HOURS * 3600,
    ...rest,
  });
};

test.beforeEach(() => { fines = 0; });
const withFines = (n) => { fines = n; row._count = { penalties: n }; };

test('cancelling the rep\'s extension puts back the deadline and the normal fine rate', async () => {
  const was = hours(-2);
  row = selfExtended({ was });
  assert.equal(penalty.dailyRateFor(row), penalty.EXTENDED_PENALTY_PER_DAY);

  const out = await settlement.undoDeadlineChange('stl-1', { id: 'admin-1' });

  assert.equal(at(out.deadlineAt), at(was));
  assert.equal(out.selfExtendedAt, null);
  assert.equal(out.preExtensionDeadline, null);
  assert.equal(out.extensionUsed, false);
  assert.equal(out.penaltyPerDay, penalty.PENALTY_PER_DAY);
  assert.equal(out.returnFailurePenalty, penalty.RETURN_FAILURE_PENALTY);
  assert.equal(out.status, 'OVERDUE'); // the restored deadline is already past
  assert.equal(out.canUndoDeadline, false);
  assert.equal(out.undone.kind, 'SELF_EXTENSION');
});

test('the days the extension covered are not billed afterwards', async () => {
  // Four days of extension, none of it charged: the fine clock starts at the
  // cancellation, so the sweep owes one day from today, not five.
  row = selfExtended({ was: hours(-96) });
  const out = await settlement.undoDeadlineChange('stl-1', { id: 'admin-1' });

  assert.ok(out.penaltyFrom, 'the fine clock is stamped');
  assert.ok(Math.abs(at(out.penaltyFrom) - Date.now()) < 60_000);
  const clock = penalty.fineClockStart(out);
  assert.equal(penalty.penaltyDaysDue(clock, Date.now()), 1);
  // Without the stamp it would have been five days of fines at once.
  assert.equal(penalty.penaltyDaysDue(at(out.deadlineAt), Date.now()), 5);
});

test('a restored deadline still ahead charges nothing and re-arms the reminders', async () => {
  row = selfExtended({ was: hours(10) });
  const out = await settlement.undoDeadlineChange('stl-1', { id: 'admin-1' });

  assert.equal(out.status, 'OPEN');
  assert.equal(out.penaltyFrom, null);
  assert.equal(row.reminderStage, 0);
  assert.equal(out.canSelfExtend, true);        // the rep may take it again
  assert.equal(out.undone.extensionReturned, true);
});

test('an overdue order gets its extension back, but cannot take it until it is live again', async () => {
  row = selfExtended({ was: hours(-2) });
  const out = await settlement.undoDeadlineChange('stl-1', { id: 'admin-1' });

  assert.equal(out.undone.extensionReturned, true); // it is theirs again
  assert.equal(out.canSelfExtend, false);           // but not while overdue
  assert.equal(out.undone.overdueNow, true);
  assert.equal(row.reminderStage, 3); // no "due in 24 hours" for a passed deadline
});

test('hours a return spent waiting on The Lab survive the undo', async () => {
  // The Lab extended by 48h; a rejected return then gave back 24h for the time
  // it sat pending. Undoing the extension must take back 48h, not land on the
  // old date and swallow the 24h the rep is never to be fined for.
  const beforeExtension = hours(20);
  row = order({
    deadlineAt: new Date(at(beforeExtension) + 48 * HOUR + 24 * HOUR), // extension + pause credit
    deadlineBefore: beforeExtension,
    deadlineChangedAt: now(),
    deadlineChangedById: 'admin-1',
    deadlineChangeKind: 'ADMIN_EXTENSION',
    deadlineShiftSeconds: 48 * 3600,
  });

  const out = await settlement.undoDeadlineChange('stl-1', { id: 'admin-1' });

  assert.equal(at(out.deadlineAt), at(beforeExtension) + 24 * HOUR);
  assert.equal(out.penaltyFrom, null);
});

test('undoing The Lab\'s own extension leaves the rep\'s extension alone', async () => {
  const takenAt = hours(-30);
  row = order({
    deadlineAt: hours(200),
    selfExtendedAt: takenAt,
    selfExtendedById: 'user-1',
    preExtensionDeadline: hours(-90),
    deadlineBefore: hours(6),
    deadlineChangedAt: now(),
    deadlineChangedById: 'admin-1',
    deadlineChangeKind: 'ADMIN_EXTENSION',
    deadlineShiftSeconds: 194 * 3600,
  });

  const out = await settlement.undoDeadlineChange('stl-1', { id: 'admin-1' });

  assert.equal(at(out.deadlineAt), at(hours(6)));
  assert.equal(at(out.selfExtendedAt), at(takenAt));
  assert.equal(out.extensionUsed, true);
  assert.equal(out.penaltyPerDay, penalty.EXTENDED_PENALTY_PER_DAY);
  assert.equal(out.canSelfExtend, false);
  // The rep's own extension is now the change that can be taken back.
  assert.equal(out.canUndoDeadline, true);
  assert.equal(out.undoDeadlineKind, 'SELF_EXTENSION');
});

test('an order that has already been fined is left to the ledger', async () => {
  // Any fine at all — daily, or a 30,000 failed-return fine — was priced
  // against the deadline as it stood, so the undo refuses and says so.
  row = selfExtended({ was: hours(-120) });
  withFines(3);

  assert.equal(settlement.decorate(row).canUndoDeadline, false); // the button is not offered
  await assert.rejects(
    () => settlement.undoDeadlineChange('stl-1', { id: 'admin-1' }),
    (e) => /already has 3 fines charged/i.test(e.message),
  );
  assert.equal(row.selfExtendedAt !== null, true); // nothing moved
});

test('time given to an order that was ALREADY overdue is not taken back here', async () => {
  // The fine clock cannot charge the days before the change and forgive the
  // days after it at the same time, so this one is refused out loud.
  const was = hours(-50); // the deadline had already passed...
  row = order({
    deadlineAt: hours(46),
    deadlineBefore: was,
    deadlineChangedAt: hours(-2), // ...when the time was given
    deadlineChangeKind: 'ADMIN_EXTENSION',
    deadlineShiftSeconds: 96 * 3600,
  });
  await assert.rejects(
    () => settlement.undoDeadlineChange('stl-1', { id: 'admin-1' }),
    (e) => /already overdue when that time was given/i.test(e.message),
  );
  assert.equal(at(row.deadlineAt), at(hours(46))); // nothing moved
});

test('a legacy order whose deadline moved again after the extension is left alone', async () => {
  // 96 hours cannot be read back once something else has moved the deadline:
  // subtracting them would land on a date that never existed.
  row = order({
    deadlineAt: hours(200),
    selfExtendedAt: now(),
    preExtensionDeadline: hours(-2), // gap is no longer 96h
  });
  assert.equal(settlement.decorate(row).canUndoDeadline, false);
  await assert.rejects(
    () => settlement.undoDeadlineChange('stl-1', { id: 'admin-1' }),
    (e) => /nothing to undo/i.test(e.message),
  );
});

test('an order extended before this existed can still have its extension cancelled', async () => {
  // No recorded shift: the columns were added after the rep took the 96 hours.
  const was = hours(-2);
  row = order({
    deadlineAt: new Date(at(was) + SELF_HOURS * HOUR),
    selfExtendedAt: new Date(at(was) - 3 * HOUR),
    selfExtendedById: 'user-1',
    preExtensionDeadline: was,
  });
  const dec = settlement.decorate(row);
  assert.equal(dec.canUndoDeadline, true);
  assert.equal(dec.undoDeadlineKind, 'SELF_EXTENSION');
  assert.equal(at(dec.undoDeadlineTo), at(was));

  const out = await settlement.undoDeadlineChange('stl-1', { id: 'admin-1' });
  assert.equal(at(out.deadlineAt), at(was));
  assert.equal(out.extensionUsed, false);
  assert.equal(out.penaltyPerDay, penalty.PENALTY_PER_DAY);
  assert.equal(out.canUndoDeadline, false);
});

test('an overdue order whose restored deadline is still ahead comes back to life', async () => {
  row = order({
    status: 'OVERDUE',
    settledValue: 100,
    deadlineAt: hours(-1),
    deadlineBefore: hours(20),
    deadlineChangeKind: 'ADMIN_EXTENSION',
    deadlineShiftSeconds: -21 * 3600, // the deadline had been pulled IN
  });

  const out = await settlement.undoDeadlineChange('stl-1', { id: 'admin-1' });

  assert.equal(at(out.deadlineAt), at(hours(20)));
  assert.equal(out.status, 'PARTIAL'); // something was settled, so not back to OPEN
});

test('an order settled while the dialog was open is not dragged back', async () => {
  row = selfExtended({ was: hours(10) });
  const beforeSettle = { ...row };
  // Someone approves the last settlement between the read and the write.
  const original = prismaStub.settlement.findUnique;
  prismaStub.settlement.findUnique = async () => {
    prismaStub.settlement.findUnique = original;
    row = { ...beforeSettle, status: 'SETTLED' };
    return { ...beforeSettle };
  };

  await assert.rejects(
    () => settlement.undoDeadlineChange('stl-1', { id: 'admin-1' }),
    (e) => /changed while you were looking at it/i.test(e.message),
  );
  assert.equal(row.status, 'SETTLED');
  assert.equal(at(row.deadlineAt), at(beforeSettle.deadlineAt));
});

test('there is nothing to undo twice, and nothing to undo on an untouched order', async () => {
  row = order({
    deadlineAt: hours(96),
    deadlineBefore: hours(10),
    deadlineChangeKind: 'ADMIN_EXTENSION',
    deadlineShiftSeconds: 86 * 3600,
  });
  await settlement.undoDeadlineChange('stl-1', { id: 'admin-1' });
  await assert.rejects(
    () => settlement.undoDeadlineChange('stl-1', { id: 'admin-1' }),
    (e) => /nothing to undo/i.test(e.message),
  );

  row = order();
  await assert.rejects(
    () => settlement.undoDeadlineChange('stl-1', { id: 'admin-1' }),
    (e) => /nothing to undo/i.test(e.message),
  );
});

test('a closed order keeps its history', async () => {
  row = selfExtended({ status: 'SETTLED' });
  await assert.rejects(
    () => settlement.undoDeadlineChange('stl-1', { id: 'admin-1' }),
    (e) => /already closed/i.test(e.message),
  );
  assert.equal(row.selfExtendedAt !== null, true);
});
