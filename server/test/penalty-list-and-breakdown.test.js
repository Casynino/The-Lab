'use strict';

// ── Fines: the owner's list by status, and the rep's "Fines by order" rate (11 Nov 2026) ─────────────
// 1. GET /penalties loaded one page of applied AND forgiven fines together, newest first, so applied fines
//    older than the 50th row never reached the owner's table — the only place a fine can be forgiven.
//    The list now takes status=APPLIED|WAIVED; the counts stay over the whole table. A rep still only
//    ever sees applied fines, whatever he asks for.
// 2. "Fines by order" quoted the order's rate today (20,000 once it was extended) beside a closed order
//    charged 10,000 a day, and gave a manual deduction a daily rate of its own.

const test = require('node:test');
const assert = require('node:assert/strict');

const ROWS = [
  { id: 'p1', salesRepId: 'r1', settlementId: 's1', kind: 'LATE_FINE', amount: 10000, daysOverdue: 1, status: 'APPLIED' },
  { id: 'p2', salesRepId: 'r1', settlementId: 's2', kind: 'LATE_FINE', amount: 20000, daysOverdue: 1, status: 'APPLIED' },
  { id: 'p3', salesRepId: 'r1', settlementId: null, kind: 'ADJUSTMENT', amount: 35000, daysOverdue: 0, status: 'APPLIED' },
  { id: 'p4', salesRepId: 'r1', settlementId: 's1', kind: 'LATE_FINE', amount: 10000, daysOverdue: 2, status: 'WAIVED' },
  { id: 'p5', salesRepId: 'r2', settlementId: 's3', kind: 'LATE_FINE', amount: 10000, daysOverdue: 1, status: 'WAIVED' },
];
const SETTLEMENTS = [
  // Closed, charged 10,000 a day, but stamped as extended afterwards.
  { id: 's1', settlementNumber: 'STL-1', status: 'SETTLED', selfExtendedAt: new Date('2026-09-22') },
  // Still open and extended: the next fine is 20,000.
  { id: 's2', settlementNumber: 'STL-2', status: 'OVERDUE', selfExtendedAt: new Date('2026-07-01') },
];

const matches = (row, where = {}) => Object.entries(where).every(([k, v]) => {
  if (v && typeof v === 'object' && Array.isArray(v.in)) return v.in.includes(row[k]);
  return row[k] === v;
});

function groupBy(rows, { by, where, _sum, _count, _max }) {
  const groups = new Map();
  for (const r of rows.filter((x) => matches(x, where))) {
    const key = by.map((b) => r[b]).join('|');
    if (!groups.has(key)) groups.set(key, { rows: [], keys: Object.fromEntries(by.map((b) => [b, r[b]])) });
    groups.get(key).rows.push(r);
  }
  return [...groups.values()].map(({ rows: rs, keys }) => {
    const out = { ...keys };
    if (_sum) out._sum = Object.fromEntries(Object.keys(_sum).map((f) => [f, rs.reduce((s, r) => s + r[f], 0)]));
    if (_count) out._count = rs.length;
    if (_max) out._max = Object.fromEntries(Object.keys(_max).map((f) => [f, Math.max(...rs.map((r) => r[f]))]));
    return out;
  });
}

function load() {
  const seen = [];
  const prisma = {
    settlementPenalty: {
      findMany: async ({ where, skip = 0, take }) => { seen.push(where); return ROWS.filter((r) => matches(r, where)).slice(skip, skip + take); },
      count: async ({ where }) => ROWS.filter((r) => matches(r, where)).length,
      groupBy: async (args) => groupBy(ROWS, args),
    },
    settlement: { findMany: async ({ where }) => SETTLEMENTS.filter((s) => where.id.in.includes(s.id)) },
    return: { groupBy: async () => [] },
  };
  const stub = (rel, exports) => { const f = require.resolve(rel); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };
  stub('../src/config/prisma', prisma);
  stub('../src/services/notification.service', { notifyUser: async () => {}, notifyAdmins: async () => {} });
  delete require.cache[require.resolve('../src/services/penalty.service')];
  delete require.cache[require.resolve('../src/controllers/penalties.controller')];
  return {
    svc: require('../src/services/penalty.service'),
    ctrl: require('../src/controllers/penalties.controller'),
    seen,
  };
}

// Runs an asyncHandler-wrapped controller and returns the JSON it sent.
function call(handler, req) {
  return new Promise((resolve, reject) => {
    const res = { status() { return this; }, json(b) { resolve(b); return this; } };
    handler(req, res, (e) => reject(e || new Error('next() called without a response')));
  });
}

test('owner: status=APPLIED returns only fines still charged, and the counts still cover both', async () => {
  const { ctrl } = load();
  const body = await call(ctrl.list, { user: { role: 'ADMIN' }, query: { status: 'APPLIED', limit: '200' } });
  assert.deepEqual(body.data.map((p) => p.id).sort(), ['p1', 'p2', 'p3']);
  assert.equal(body.meta.total, 3);
  assert.deepEqual(body.meta.counts, { applied: 3, waived: 2 });
});

test('owner: status=WAIVED returns only forgiven fines; no status returns both as before', async () => {
  const { ctrl } = load();
  const waived = await call(ctrl.list, { user: { role: 'ADMIN' }, query: { status: 'WAIVED' } });
  assert.deepEqual(waived.data.map((p) => p.id).sort(), ['p4', 'p5']);
  const all = await call(ctrl.list, { user: { role: 'ADMIN' }, query: {} });
  assert.equal(all.meta.total, 5);
  const junk = await call(ctrl.list, { user: { role: 'ADMIN' }, query: { status: 'anything' } });
  assert.equal(junk.meta.total, 5);
});

test('rep: asking for forgiven fines still returns only his applied ones', async () => {
  const { ctrl } = load();
  const body = await call(ctrl.list, { user: { role: 'SALES_REP', salesRepId: 'r1' }, query: { status: 'WAIVED', salesRepId: 'r2' } });
  assert.deepEqual(body.data.map((p) => p.id).sort(), ['p1', 'p2', 'p3']);
  assert.ok(body.data.every((p) => p.salesRepId === 'r1' && p.status === 'APPLIED'));
});

test('Fines by order: a closed order quotes the rate it was charged, an open one the next rate, a deduction none', async () => {
  const { svc } = load();
  const { total, breakdown } = await svc.penaltyBreakdownForRep('r1');
  const by = Object.fromEntries(breakdown.map((b) => [b.settlementId ?? 'manual', b]));
  assert.equal(total, 65000);
  assert.equal(by.s1.penaltyPerDay, 10000); // closed, extended later: charged 10,000, not today's 20,000
  assert.equal(by.s1.closed, true);
  assert.equal(by.s2.penaltyPerDay, 20000); // open and extended: the next fine is 20,000
  assert.equal(by.manual.penaltyPerDay, null);
  assert.equal(by.manual.daysOverdue, 0);
  assert.equal(by.manual.settlementNumber, 'Manual deduction');
});
