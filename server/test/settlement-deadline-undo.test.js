'use strict';

// ── Time given by mistake has to be takeable back, without inventing debt ────
// The owner extended an order he did not mean to extend. Until now there was no
// way out: the rep's own 96 hours could not be undone at all, they carry a
// doubled daily fine, and an order given time twice could only be put right
// once, because only the last change was remembered.
//
// Taking time back moves the deadline into the past, and that is where money
// goes wrong if nobody is careful — a rep billed for days he was told he had,
// fines left standing at the extended rate, or the hours a return spent waiting
// on The Lab swallowed with the extension. Each of those is a test here.
//
// The service is a pure function of the rows once the database is swapped for
// an in-memory one, so this runs the real code against real rows.

const test = require('node:test');
const assert = require('node:assert');

const HOUR = 3_600_000;
const now = () => new Date();
const hours = (n) => new Date(Date.now() + n * HOUR);
const at = (d) => new Date(d).getTime();

let row = null;
let changes = [];
let fines = 0; // fines already charged on the order
let seq = 0;

const prismaStub = {
  settlement: {
    findUnique: async ({ where }) =>
      (row && row.id === where.id ? { ...row, deadlineChanges: changes.slice().sort((a, b) => at(b.createdAt) - at(a.createdAt)) } : null),
    // The real claim: it only writes if the row is still as it was read, and
    // only while the order carries no fine.
    updateMany: async ({ where, data }) => {
      if (!row || row.id !== where.id) return { count: 0 };
      if (where.status?.not && row.status === where.status.not) return { count: 0 };
      if (typeof where.status === 'string' && row.status !== where.status) return { count: 0 };
      if (where.deadlineAt && at(where.deadlineAt) !== at(row.deadlineAt)) return { count: 0 };
      if (where.penalties?.none && fines > 0) return { count: 0 };
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
  settlementDeadlineChange: {
    create: async ({ data }) => {
      const created = { id: `chg-${++seq}`, createdAt: data.createdAt || new Date(), undoneAt: null, unrecorded: false, ...data };
      changes.push(created);
      return created;
    },
    update: async ({ where, data }) => {
      const found = changes.find((c) => c.id === where.id);
      assert.ok(found, 'change row exists');
      Object.assign(found, data);
      return found;
    },
    updateMany: async ({ where, data }) => {
      const ids = where.id?.in || [where.id];
      const hit = changes.filter((c) => ids.includes(c.id));
      hit.forEach((c) => Object.assign(c, data));
      return { count: hit.length };
    },
  },
  // The deadline and the history move together or not at all.
  $transaction: async (work) => (typeof work === 'function' ? work(prismaStub) : Promise.all(work)),
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

const change = ({ kind, fromAt, hours: h, at: madeAt, byName = 'KP', unrecorded = false }) => ({
  id: `chg-${++seq}`,
  settlementId: 'stl-1',
  kind,
  fromAt,
  toAt: new Date(at(fromAt) + h * HOUR),
  shiftSeconds: Math.round(h * 3600),
  byUserId: 'user-1',
  byName,
  unrecorded,
  createdAt: madeAt,
  undoneAt: null,
  undoneById: null,
});

// An order the rep extended themselves, recorded the way selfExtend records it.
// A rep can only take it BEFORE the deadline passes, so the fixture puts the
// activation three hours ahead of it.
const selfExtended = (over = {}) => {
  const was = over.was || hours(-2);
  const rest = { ...over };
  delete rest.was;
  const takenAt = new Date(at(was) - 3 * HOUR);
  changes = [change({ kind: 'SELF_EXTENSION', fromAt: was, hours: SELF_HOURS, at: takenAt })];
  return order({
    deadlineAt: new Date(at(was) + SELF_HOURS * HOUR),
    selfExtendedAt: takenAt,
    selfExtendedById: 'user-1',
    preExtensionDeadline: was,
    ...rest,
  });
};

test.beforeEach(() => { fines = 0; changes = []; });
const withFines = (n) => { fines = n; row._count = { penalties: n }; };
// The database hands them back newest first; so does this.
const live = () => settlement.decorate({
  ...row,
  deadlineChanges: changes.slice().sort((a, b) => at(b.createdAt) - at(a.createdAt)),
});

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
  // The change is kept, marked taken back — history is not rewritten.
  assert.equal(changes.length, 1);
  assert.ok(changes[0].undoneAt);
  assert.equal(out.deadlineHistory[0].undoneAt !== null, true);
});

test('two lots of time come back one at a time, newest first', async () => {
  // The owner's own case: the rep took 96 hours, then The Lab added five days.
  const first = hours(-14);
  const afterRep = new Date(at(first) + SELF_HOURS * HOUR);
  const afterLab = new Date(at(afterRep) + 120 * HOUR);
  row = order({
    deadlineAt: afterLab,
    selfExtendedAt: new Date(at(first) - 3 * HOUR),
    selfExtendedById: 'user-1',
    preExtensionDeadline: first,
  });
  changes = [
    change({ kind: 'SELF_EXTENSION', fromAt: first, hours: SELF_HOURS, at: new Date(at(first) - 3 * HOUR) }),
    change({ kind: 'ADMIN_EXTENSION', fromAt: afterRep, hours: 120, at: hours(-1), byName: 'The Lab' }),
  ];

  const before = live();
  assert.equal(before.deadlineHistory.length, 2);
  assert.equal(before.deadlineHistory[0].kind, 'ADMIN_EXTENSION'); // newest first
  assert.equal(before.undoDeadlineKind, 'ADMIN_EXTENSION');
  assert.equal(at(before.undoDeadlineTo), at(afterRep));

  const first_undo = await settlement.undoDeadlineChange('stl-1', { id: 'admin-1' });
  assert.equal(at(first_undo.deadlineAt), at(afterRep));
  assert.equal(first_undo.extensionUsed, true);      // the rep's 96h still stands
  assert.equal(first_undo.canUndoDeadline, true);    // and can go next
  assert.equal(first_undo.undoDeadlineKind, 'SELF_EXTENSION');

  const second_undo = await settlement.undoDeadlineChange('stl-1', { id: 'admin-1' });
  assert.equal(at(second_undo.deadlineAt), at(first));
  assert.equal(second_undo.extensionUsed, false);    // now it is cancelled too
  assert.equal(second_undo.penaltyPerDay, penalty.PENALTY_PER_DAY);
  assert.equal(second_undo.canUndoDeadline, false);  // nothing left to take back
  assert.equal(second_undo.deadlineHistory.filter((c) => c.undoneAt).length, 2);
});

test('an order extended before this app kept a history still lists both lots', async () => {
  // Nothing recorded: the rep's 96 hours are read from the fields that have
  // always been written, and whatever is beyond them is time added later.
  const first = hours(-14);
  const afterRep = new Date(at(first) + SELF_HOURS * HOUR);
  row = order({
    deadlineAt: new Date(at(afterRep) + 120 * HOUR),
    selfExtendedAt: new Date(at(first) - 3 * HOUR),
    selfExtendedById: 'user-1',
    preExtensionDeadline: first,
  });

  const dec = live();
  assert.equal(dec.deadlineHistory.length, 2);
  assert.equal(dec.deadlineHistory[0].kind, 'ADMIN_EXTENSION');
  assert.equal(dec.deadlineHistory[0].unrecorded, true);   // the app cannot say who
  assert.equal(dec.deadlineHistory[1].kind, 'SELF_EXTENSION');
  assert.equal(dec.deadlineHistory[1].unrecorded, false);
  assert.equal(at(dec.undoDeadlineTo), at(afterRep));
  assert.equal(dec.undoDropsLaterTime, true);

  const one = await settlement.undoDeadlineChange('stl-1', { id: 'admin-1' });
  assert.equal(at(one.deadlineAt), at(afterRep));
  assert.equal(one.extensionUsed, true);
  // The change nobody recorded is written down now, already taken back.
  assert.equal(changes.length, 1);
  assert.equal(changes[0].unrecorded, true);
  assert.ok(changes[0].undoneAt);

  const two = await settlement.undoDeadlineChange('stl-1', { id: 'admin-1' });
  assert.equal(at(two.deadlineAt), at(first));
  assert.equal(two.extensionUsed, false);
  assert.equal(two.canUndoDeadline, false);
});

test('the days the extension covered are not billed afterwards', async () => {
  // Four days of extension, none of it charged: the fine clock starts at the
  // cancellation, so the sweep owes one day from today, not five.
  row = selfExtended({ was: hours(-96) });
  const out = await settlement.undoDeadlineChange('stl-1', { id: 'admin-1' });

  assert.ok(out.penaltyFrom, 'the fine clock is stamped');
  assert.ok(Math.abs(at(out.penaltyFrom) - Date.now()) < 60_000);
  assert.equal(penalty.penaltyDaysDue(penalty.fineClockStart(out), Date.now()), 1);
  // Without the stamp it would have been five days of fines at once.
  assert.equal(penalty.penaltyDaysDue(at(out.deadlineAt), Date.now()), 5);
  assert.equal(at(out.finesFrom), at(out.penaltyFrom));
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
  // it sat pending. Undoing takes back 48h, not the old date, so the 24h the
  // rep is never to be fined for stay on the clock.
  const beforeExtension = hours(20);
  const afterExtension = new Date(at(beforeExtension) + 48 * HOUR);
  row = order({ deadlineAt: new Date(at(afterExtension) + 24 * HOUR) }); // extension + pause credit
  changes = [change({ kind: 'ADMIN_EXTENSION', fromAt: beforeExtension, hours: 48, at: hours(-4), byName: 'The Lab' })];

  const out = await settlement.undoDeadlineChange('stl-1', { id: 'admin-1' });

  assert.equal(at(out.deadlineAt), at(beforeExtension) + 24 * HOUR);
  assert.equal(out.penaltyFrom, null);
});

test('undoing The Lab\'s own extension leaves the rep\'s extension alone', async () => {
  const takenAt = hours(-30);
  const beforeLab = hours(6);
  row = order({
    deadlineAt: new Date(at(beforeLab) + 194 * HOUR),
    selfExtendedAt: takenAt,
    selfExtendedById: 'user-1',
    preExtensionDeadline: hours(-90),
  });
  changes = [
    change({ kind: 'SELF_EXTENSION', fromAt: hours(-90), hours: SELF_HOURS, at: takenAt }),
    change({ kind: 'ADMIN_EXTENSION', fromAt: beforeLab, hours: 194, at: hours(-2), byName: 'The Lab' }),
  ];

  const out = await settlement.undoDeadlineChange('stl-1', { id: 'admin-1' });

  assert.equal(at(out.deadlineAt), at(beforeLab));
  assert.equal(at(out.selfExtendedAt), at(takenAt));
  assert.equal(out.extensionUsed, true);
  assert.equal(out.penaltyPerDay, penalty.EXTENDED_PENALTY_PER_DAY);
  assert.equal(out.canSelfExtend, false);
  assert.equal(out.canUndoDeadline, true);           // the rep's own is next
  assert.equal(out.undoDeadlineKind, 'SELF_EXTENSION');
});

test('an order that has already been fined is left to the ledger', async () => {
  // Any fine at all — daily, or a 30,000 failed-return fine — was priced
  // against the deadline as it stood, so the undo refuses and says so.
  row = selfExtended({ was: hours(-120) });
  withFines(3);

  assert.equal(live().canUndoDeadline, false); // the button is not offered
  await assert.rejects(
    () => settlement.undoDeadlineChange('stl-1', { id: 'admin-1' }),
    (e) => /already has 3 fines charged/i.test(e.message),
  );
  assert.equal(row.selfExtendedAt !== null, true); // nothing moved
});

test('time given to an order that was ALREADY overdue is not taken back here', async () => {
  // The fine clock cannot charge the days before the change and forgive the
  // days after it at the same time, so this one is refused out loud.
  const deadline = hours(46);
  row = order({ deadlineAt: deadline });
  changes = [change({ kind: 'ADMIN_EXTENSION', fromAt: hours(-50), hours: 96, at: hours(-2), byName: 'The Lab' })];

  await assert.rejects(
    () => settlement.undoDeadlineChange('stl-1', { id: 'admin-1' }),
    (e) => /already overdue when that time was given/i.test(e.message),
  );
  assert.equal(at(row.deadlineAt), at(deadline)); // nothing moved
});

test('an overdue order whose restored deadline is still ahead comes back to life', async () => {
  const deadline = hours(-1);
  const wasBefore = new Date(at(deadline) + 21 * HOUR);
  row = order({ status: 'OVERDUE', settledValue: 100, deadlineAt: deadline });
  // The deadline had been pulled IN by 21 hours; undoing puts it back out.
  changes = [change({ kind: 'ADMIN_EXTENSION', fromAt: wasBefore, hours: -21, at: hours(-2), byName: 'The Lab' })];

  const out = await settlement.undoDeadlineChange('stl-1', { id: 'admin-1' });

  assert.equal(at(out.deadlineAt), at(wasBefore));
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
    return { ...beforeSettle, deadlineChanges: changes };
  };

  await assert.rejects(
    () => settlement.undoDeadlineChange('stl-1', { id: 'admin-1' }),
    (e) => /changed while you were looking at it/i.test(e.message),
  );
  assert.equal(row.status, 'SETTLED');
  assert.equal(at(row.deadlineAt), at(beforeSettle.deadlineAt));
});

test('there is nothing to undo on an untouched order', async () => {
  row = order();
  assert.equal(live().canUndoDeadline, false);
  assert.deepEqual(live().deadlineHistory, []);
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
  assert.equal(changes[0].undoneAt, null);
});

test('the newest change is the one taken back, even when the older one was never recorded', async () => {
  // Half remembered, half recorded: the rep's 96 hours predate the history
  // table, The Lab's 24 are a row in it. Taking one back must take the LAST
  // one — putting the deadline back to a date the order never held is how a
  // rep ends up fined for days nobody gave him.
  const first = hours(-10);
  const afterRep = new Date(at(first) + SELF_HOURS * HOUR);
  const afterLab = new Date(at(afterRep) + 24 * HOUR);
  row = order({
    deadlineAt: afterLab,
    selfExtendedAt: new Date(at(first) - 3 * HOUR),
    selfExtendedById: 'user-1',
    preExtensionDeadline: first,
  });
  changes = [change({ kind: 'ADMIN_EXTENSION', fromAt: afterRep, hours: 24, at: hours(-1), byName: 'The Lab' })];

  const dec = live();
  assert.equal(dec.deadlineHistory.length, 2);
  assert.equal(dec.deadlineHistory[0].kind, 'ADMIN_EXTENSION'); // newest first
  assert.equal(dec.deadlineHistory[1].kind, 'SELF_EXTENSION');
  assert.equal(at(dec.undoDeadlineTo), at(afterRep));
  // Nothing is unaccounted for here, so nothing is called unrecorded.
  assert.equal(dec.deadlineHistory.some((c) => c.unrecorded), false);

  const out = await settlement.undoDeadlineChange('stl-1', { id: 'admin-1' });
  assert.equal(at(out.deadlineAt), at(afterRep));
  assert.equal(out.extensionUsed, true); // the rep's own is still standing
});

test('an order The Lab extended before this shipped can still be put right', async () => {
  // No row, no self-extension — only the columns the old code wrote. Losing
  // the undo on these was the regression this test guards.
  const was = hours(20);
  row = order({
    deadlineAt: new Date(at(was) + 48 * HOUR),
    deadlineBefore: was,
    deadlineChangedAt: hours(-2),
    deadlineChangedById: 'admin-1',
    deadlineChangeKind: 'ADMIN_EXTENSION',
    deadlineShiftSeconds: 48 * 3600,
  });

  const dec = live();
  assert.equal(dec.deadlineHistory.length, 1);
  assert.equal(dec.deadlineHistory[0].kind, 'ADMIN_EXTENSION');
  assert.equal(dec.deadlineHistory[0].hours, 48);
  assert.equal(dec.canUndoDeadline, true);

  const out = await settlement.undoDeadlineChange('stl-1', { id: 'admin-1' });
  assert.equal(at(out.deadlineAt), at(was));
  assert.equal(out.canUndoDeadline, false);
  assert.equal(out.deadlineBefore, null);
});

test('all the extra time can come off in one go', async () => {
  // The owner's order: the rep took 96 hours, then five days were added. One
  // step at a time would leave it overdue in between, the first fine would
  // land, and the rest could never be taken back. So it comes off together.
  const first = hours(-30);
  const afterRep = new Date(at(first) + SELF_HOURS * HOUR);
  row = order({
    deadlineAt: new Date(at(afterRep) + 120 * HOUR),
    selfExtendedAt: new Date(at(first) - 3 * HOUR),
    selfExtendedById: 'user-1',
    preExtensionDeadline: first,
  });

  const dec = live();
  assert.equal(dec.undoAllCount, 2);
  assert.equal(at(dec.undoAllDeadlineTo), at(first));

  const out = await settlement.undoDeadlineChange('stl-1', { id: 'admin-1' }, { all: true });

  assert.equal(at(out.deadlineAt), at(first));
  assert.equal(out.extensionUsed, false);                  // the rep's 96h are back on the shelf
  assert.equal(out.penaltyPerDay, penalty.PENALTY_PER_DAY); // at the normal rate
  assert.equal(out.undone.changes, 2);
  assert.equal(out.canUndoDeadline, false);
  assert.equal(out.undoAllCount, 0);
  // Both lots are written down, both marked taken back.
  assert.equal(changes.length, 2);
  assert.equal(changes.filter((c) => c.undoneAt).length, 2);
  // And the days that time covered are not billed.
  assert.equal(penalty.penaltyDaysDue(penalty.fineClockStart(out), Date.now()), 1);
});

test('taking it all off never charges for a change that is already undone', async () => {
  // One lot was taken back yesterday. "All of it" means everything that still
  // stands — it must not subtract the hours that were already removed.
  const first = hours(-6);
  const afterRep = new Date(at(first) + SELF_HOURS * HOUR);
  row = order({
    deadlineAt: afterRep,
    selfExtendedAt: new Date(at(first) - 3 * HOUR),
    selfExtendedById: 'user-1',
    preExtensionDeadline: first,
  });
  changes = [
    change({ kind: 'SELF_EXTENSION', fromAt: first, hours: SELF_HOURS, at: new Date(at(first) - 3 * HOUR) }),
    { ...change({ kind: 'ADMIN_EXTENSION', fromAt: afterRep, hours: 48, at: hours(-2), byName: 'The Lab' }), undoneAt: hours(-1) },
  ];

  const dec = live();
  assert.equal(dec.undoAllCount, 0);                       // only one lot still stands
  assert.equal(at(dec.undoDeadlineTo), at(first));

  const out = await settlement.undoDeadlineChange('stl-1', { id: 'admin-1' }, { all: true });
  assert.equal(at(out.deadlineAt), at(first));             // 96h off, not 144h
});

test('a list that did not ask for the history does not pretend there is none', async () => {
  // decorate runs on list rows too, and those are read without the changes.
  row = selfExtended({ was: hours(10) });
  const listed = settlement.decorate({ ...row });
  assert.equal(listed.deadlineHistory, null);
  assert.equal(listed.canUndoDeadline, false);
  assert.equal(listed.undoAllCount, 0);
});
