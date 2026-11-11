'use strict';

// ── A withdrawal is decided once, and a payout is recorded once (audit #31, 11 Nov 2026) ──────────────
// Two taps on "Approve & pay", or a PAY racing a REJECT, used to both pass the status check and both
// write; every PAID answer then booked a payout in finance. Pinned: exactly one caller wins, the other
// gets 409 and nothing else happens.

const test = require('node:test');
const assert = require('node:assert/strict');

function load(initial) {
  const row = { id: 'w1', salesRepId: 'r1', amount: 50000, status: 'PENDING', underEmergency: false, paidAt: null, ...initial };
  const calls = { updates: 0, notified: 0 };
  const prisma = {
    commissionWithdrawal: {
      findUnique: async ({ where }) => (where.id === row.id ? { ...row, salesRep: { user: { id: 'u1', name: 'Rep' } } } : null),
      // Conditional update, as Postgres does it: only while the status is still the one asked for.
      updateMany: async ({ where, data }) => {
        await new Promise((r) => setImmediate(r)); // let the other caller interleave
        if (where.id !== row.id || where.status !== row.status) return { count: 0 };
        Object.assign(row, data); calls.updates += 1; return { count: 1 };
      },
    },
    salesRepresentative: { update: async () => ({}) },
  };
  const stub = (rel, exports) => { const f = require.resolve(rel); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };
  stub('../src/config/prisma', prisma);
  stub('../src/services/notification.service', { notifyUser: async () => { calls.notified += 1; }, notifyAdmins: async () => {} });
  delete require.cache[require.resolve('../src/services/commission.service')];
  return { svc: require('../src/services/commission.service'), row, calls };
}

test('two "Approve & pay" taps at once: one pays, the other is told it is already paid', async () => {
  const { svc, row, calls } = load();
  const results = await Promise.allSettled([svc.decideWithdrawal('w1', 'PAY', { id: 'admin' }), svc.decideWithdrawal('w1', 'PAY', { id: 'admin' })]);
  const ok = results.filter((r) => r.status === 'fulfilled');
  const refused = results.filter((r) => r.status === 'rejected');
  assert.equal(ok.length, 1);
  assert.equal(refused.length, 1);
  assert.equal(refused[0].reason.statusCode, 409);
  assert.equal(row.status, 'PAID');
  assert.equal(calls.updates, 1);
  assert.equal(calls.notified, 1); // one "you have been paid" message, not two
});

test('PAY racing REJECT: exactly one wins', async () => {
  const { svc, row, calls } = load();
  const results = await Promise.allSettled([svc.decideWithdrawal('w1', 'PAY', { id: 'a' }), svc.decideWithdrawal('w1', 'REJECT', { id: 'b' })]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.ok(['PAID', 'REJECTED'].includes(row.status));
  assert.equal(calls.updates, 1);
});

test('a decided request cannot be decided again', async () => {
  const { svc } = load({ status: 'PAID' });
  await assert.rejects(svc.decideWithdrawal('w1', 'PAY', { id: 'a' }), (e) => e.statusCode === 400);
  await assert.rejects(svc.decideWithdrawal('w1', 'REJECT', { id: 'a' }), (e) => e.statusCode === 400);
});

test('APPROVE then PAY is still allowed, once each', async () => {
  const { svc, row } = load();
  await svc.decideWithdrawal('w1', 'APPROVE', { id: 'a' });
  assert.equal(row.status, 'APPROVED');
  await svc.decideWithdrawal('w1', 'PAY', { id: 'a' });
  assert.equal(row.status, 'PAID');
  assert.ok(row.paidAt instanceof Date);
});
