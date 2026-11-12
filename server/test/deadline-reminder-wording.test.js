'use strict';

// ── What the deadline reminders say (audit, 12 Nov 2026) ─────────────────────────────────────────────
// The final reminder promised the order "will be auto-processed soon" (nothing is: the daily fine
// starts), no reminder gave the deadline or the fine, and the first one always said "24 hours" although
// the sweep that sends it may run with 8 hours left. Pinned against a tiny in-memory order table.

const test = require('node:test');
const assert = require('node:assert/strict');

const H = 3_600_000;

function load(orders) {
  const sent = [];
  const prisma = new Proxy({
    settlement: {
      findMany: async () => orders,
      updateMany: async ({ where, data }) => {
        const o = orders.find((x) => x.id === where.id);
        if (!o || (o.reminderStage || 0) >= where.reminderStage.lt) return { count: 0 };
        o.reminderStage = data.reminderStage;
        return { count: 1 };
      },
    },
  }, { get: (t, k) => t[k] || { findMany: async () => [], count: async () => 0 } });
  const stub = (rel, exports) => { const f = require.resolve(rel); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };
  stub('../src/config/prisma', prisma);
  stub('../src/services/notification.service', { notifyUser: async (userId, d) => { sent.push({ userId, ...d }); } });
  delete require.cache[require.resolve('../src/services/penalty.service')];
  delete require.cache[require.resolve('../src/services/settlement.service')];
  return { svc: require('../src/services/settlement.service'), sent };
}

const order = (id, hoursLeft, extra = {}) => ({
  id, settlementNumber: `STL-${id}`, deadlineAt: new Date(Date.now() + hoursLeft * H), selfExtendedAt: null,
  reminderStage: 0, salesRep: { user: { id: `user-${id}` } }, ...extra,
});

test('each reminder gives the deadline and the daily fine, and none promises auto-processing', async () => {
  const { svc, sent } = load([order('A', 8.2), order('B', 4), order('C', 0.5, { selfExtendedAt: new Date() })]);
  const r = await svc.sendDueReminders();
  assert.equal(r.sent, 3);
  const [a, b, c] = sent;
  // The first one says the hours really left, not a fixed 24.
  assert.equal(a.title, 'Settlement due in 8 hours');
  assert.match(a.message, /^Order STL-A is due at \d{1,2} \w{3} \d{4} \| \d\d:\d\d EAT\. Settle or return its boxes before then\. From the deadline a TSh\s10,000 fine is charged every day until every box is settled or returned\.$/);
  assert.equal(b.title, 'Final reminder — settle soon');
  assert.match(b.message, /^Final reminder: Order STL-B is due at .+ EAT\. Settle or return its boxes now\. From the deadline a TSh\s10,000 fine/);
  // An order on its self-extension is fined at the higher rate.
  assert.match(c.message, /^Urgent: Order STL-C is due at .+ EAT, in less than an hour\. .*TSh\s20,000 fine is charged every day/);
  for (const n of sent) assert.doesNotMatch(n.message, /auto-processed/);
  // The WhatsApp copy gets the same deadline and rate.
  assert.deepEqual(sent.map((n) => [n.whatsapp.stage, n.whatsapp.rate]), [[1, 10000], [2, 10000], [3, 20000]]);
  assert.ok(sent.every((n) => n.whatsapp.deadline instanceof Date));
});

test('a reminder already sent is not sent again', async () => {
  const { svc, sent } = load([order('A', 20, { reminderStage: 1 }), order('B', 30)]);
  const r = await svc.sendDueReminders();
  assert.equal(r.sent, 0);
  assert.equal(sent.length, 0);
});
