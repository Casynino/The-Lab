'use strict';

// ── The WhatsApp duplicate guard drops retries, never real events (audit #45, 11 Nov 2026) ─────────────
// a) A rep's WhatsApp copy is keyed on the in-app notice it copies: two real events in the same words on
//    the same order the same day both arrive (the second used to be dropped while its bell notice came).
// b) The owner's "fine is about to start" warning is keyed on the order AND its deadline: an order given
//    more time is warned again before the new deadline (it was warned once per order, ever).

const test = require('node:test');
const assert = require('node:assert/strict');

const notices = [];
const logged = [];
const sent = [];
let orders = [];
const keys = new Set();

const prismaStub = {
  notification: {
    create: async ({ data }) => { notices.push(data); return { id: `n${notices.length}`, ...data }; },
    findFirst: async () => null,
  },
  setting: { findUnique: async ({ where }) => ({ 'whatsapp.phone': { value: '255700000000' }, 'whatsapp.apikey': { value: 'ownerkey' } })[where.key] || null },
  salesRepresentative: {
    findFirst: async () => ({ id: 'rep1' }),
    findUnique: async () => ({ whatsappPhone: '255711111111', whatsappApiKey: 'repkey' }),
  },
  settlement: { findMany: async () => orders },
  return: { count: async () => 0 },
  whatsAppNotification: {
    // The unique index on dedupeKey, as Postgres enforces it.
    create: async ({ data }) => {
      if (data.dedupeKey && keys.has(data.dedupeKey)) { const e = new Error('unique'); e.code = 'P2002'; throw e; }
      if (data.dedupeKey) keys.add(data.dedupeKey);
      const row = { id: `w${logged.length + 1}`, attempts: 0, ...data };
      logged.push(row);
      return row;
    },
    count: async () => 0,
    updateMany: async () => ({ count: 1 }),
    update: async ({ data }) => ({ ...data }),
    findFirst: async () => null,
  },
};
const stub = (rel, exports) => { const f = require.resolve(rel); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };
stub('../src/config/prisma', prismaStub);
stub('../src/services/penalty.service', { dailyRateFor: () => 10000 });
global.fetch = async (url) => { sent.push(String(url)); return { ok: true, status: 200, text: async () => 'Message queued' }; };

const notification = require('../src/services/notification.service');
const wa = require('../src/services/whatsappNotify.service');

const settle = async () => { for (let i = 0; i < 30; i += 1) await new Promise((r) => setImmediate(r)); };
const reset = () => { notices.length = 0; logged.length = 0; sent.length = 0; keys.clear(); };

const rejection = {
  type: 'GENERAL', severity: 'WARNING', title: 'Settlement rejected',
  message: 'Your settlement of 2 box(es) of Pepa was rejected. Please review and resubmit. Reason: wrong account',
  whatsapp: { kind: 'SETTLEMENT_REJECTED', boxes: 2, product: 'Pepa', reason: 'wrong account' },
  entityType: 'Settlement', entityId: 'order1',
};

test('two rejections in the same words on the same order the same day: both reach the rep\'s phone', async () => {
  reset();
  await notification.notifyUser('user1', rejection);
  await settle();
  await notification.notifyUser('user1', rejection);
  await settle();
  assert.equal(notices.length, 2, 'two bell notices');
  assert.equal(logged.length, 2, 'two WhatsApp rows, not one');
  assert.notEqual(logged[0].dedupeKey, logged[1].dedupeKey);
  assert.equal(sent.length, 2);
  assert.match(sent[0], /phone=255711111111/);
});

test('one notice is still one WhatsApp: mirroring the same notice again is caught', async () => {
  reset();
  await wa.mirrorToRep('user1', { ...rejection, notificationId: 'n9' });
  const again = await wa.mirrorToRep('user1', { ...rejection, notificationId: 'n9' });
  assert.equal(logged.length, 1);
  assert.equal(again.reason, 'duplicate');
});

test('without a notice (createIfAbsent alerts) the day-and-words guard still applies', async () => {
  reset();
  const alert = { ...rejection, title: 'Commission ready for withdrawal', entityType: 'Commission', entityId: 'commready-rep1' };
  await wa.mirrorToRep('user1', alert);
  const again = await wa.mirrorToRep('user1', alert);
  assert.equal(logged.length, 1);
  assert.equal(again.reason, 'duplicate');
});

const order = (deadlineAt) => ({
  id: 'o1', settlementNumber: 'STL-1', status: 'OPEN', deadlineAt, assignedValue: 50000, settledValue: 0, returnedValue: 0,
  salesRep: { code: 'R1', user: { id: 'u1', name: 'Paul' } },
});

test('the owner is warned once per deadline, and again after the order is given more time', async () => {
  reset();
  const first = new Date(Date.now() + 5 * 60_000);
  orders = [order(first)];
  const a = await wa.deadlineWarnings();
  const b = await wa.deadlineWarnings(); // the sweep runs again inside the window
  assert.equal(a.queued, 1);
  assert.equal(b.queued, 0, 'the same deadline is not warned twice');

  // An admin extension (or a return giving time back) moves the deadline; ten minutes before it, warn again.
  const later = new Date(Date.now() + 8 * 60_000);
  orders = [order(later)];
  const c = await wa.deadlineWarnings();
  assert.equal(c.queued, 1, 'the new deadline gets its own warning');
  const owner = logged.filter((r) => r.type === 'DEADLINE_IMMINENT');
  assert.equal(owner.length, 2);
  orders = [];
});
