'use strict';

// The whole road a WhatsApp text travels, with the database and CallMeBot
// stubbed: an event happens -> the in-app notice is saved WITHOUT the
// WhatsApp-only data -> the right text reaches the right phone.
// Run with: npm test

const test = require('node:test');
const assert = require('node:assert/strict');

const saved = [];      // rows written to the notification table
const logged = [];     // rows written to the WhatsApp log
const sent = [];       // URLs "sent" to CallMeBot
const everSent = [];   // every text sent in this file, for the last check
const settings = { 'whatsapp.phone': '255700000000', 'whatsapp.apikey': 'ownerkey' };

const prismaStub = {
  notification: {
    create: async ({ data }) => { saved.push(data); return { id: `n${saved.length}`, ...data }; },
    findFirst: async () => null,
  },
  setting: { findUnique: async ({ where }) => (where.key in settings ? { value: settings[where.key] } : null) },
  salesRepresentative: {
    findFirst: async () => ({ id: 'rep1' }),
    findUnique: async () => ({ whatsappPhone: '255711111111', whatsappApiKey: 'repkey' }),
  },
  whatsAppNotification: {
    create: async ({ data }) => { const row = { id: `w${logged.length + 1}`, attempts: 0, ...data }; logged.push(row); return row; },
    count: async () => 0,
    updateMany: async () => ({ count: 1 }),
    update: async ({ data }) => ({ ...data }),
    findFirst: async () => null,
  },
};
const stub = (rel, exports) => { require.cache[require.resolve(rel)] = { id: rel, filename: rel, loaded: true, exports }; };
stub('../src/config/prisma', prismaStub);
global.fetch = async (url) => { sent.push(String(url)); everSent.push(decodeURIComponent(new URL(String(url)).searchParams.get('text'))); return { ok: true, status: 200, text: async () => 'Message queued' }; };

const notification = require('../src/services/notification.service');
const wa = require('../src/services/whatsappNotify.service');

const textOf = (url) => decodeURIComponent(new URL(url).searchParams.get('text'));
const settle = async () => { for (let i = 0; i < 20 && !sent.length; i += 1) await new Promise((r) => setImmediate(r)); };
const reset = () => { saved.length = 0; logged.length = 0; sent.length = 0; };

test('a rep event: the bell row has no WhatsApp field, and the rep\'s phone gets Nino\'s text', async () => {
  reset();
  await notification.notifyUser('user1', {
    type: 'GENERAL', severity: 'CRITICAL',
    title: 'TSh 10,000 late settlement fine applied',
    message: 'long in-app sentence',
    whatsapp: { kind: 'LATE_FINE', fine: 10000, order: 'STL-20261110-0001', days: 1 },
    entityType: 'Settlement', entityId: 'e1',
  });
  await settle();
  assert.equal(saved.length, 1);
  assert.ok(!('whatsapp' in saved[0]), 'the WhatsApp-only data never reaches the notification table');
  assert.equal(saved[0].title, 'TSh 10,000 late settlement fine applied', 'the in-app bell keeps its own words');
  assert.equal(sent.length, 1);
  assert.match(sent[0], /phone=255711111111&apikey=repkey/, 'goes to the rep\'s own number and key');
  assert.equal(textOf(sent[0]), '*LATE SETTLEMENT FINE*\n\nFine Applied: TSh 10,000\nOrder: STL-20261110-0001\nOverdue: 1 Day\n\nZELab');
});

test('a rep alert with no template yet still goes out in the new shape, never the old emoji one', async () => {
  reset();
  await notification.notifyUser('user1', { type: 'GENERAL', severity: 'INFO', title: '📦 Something new', message: 'It happened.', entityType: 'X', entityId: 'e2' });
  await settle();
  assert.equal(textOf(sent[0]), '*SOMETHING NEW*\n\nIt happened.\n\nZELab');
});

test('createIfAbsent (used by the commission-ready and bonus alerts) strips the field too and mirrors the right text', async () => {
  reset();
  await notification.createIfAbsent({
    type: 'GENERAL', severity: 'INFO', title: 'Commission ready for withdrawal', message: 'in-app words',
    whatsapp: { kind: 'COMMISSION_READY', available: 210000, minimum: 100000 },
    entityType: 'Commission', entityId: 'commready-rep1', userId: 'user1',
  });
  await settle();
  assert.ok(!('whatsapp' in saved[0]));
  assert.equal(textOf(sent[0]), '*COMMISSION READY*\n\nAvailable: TSh 210,000\nMinimum Withdrawal: TSh 100,000\n\nYou can request a withdrawal.\n\nZELab');
});

test('an admin notice carries no WhatsApp field into the table either', async () => {
  reset();
  await notification.notifyAdmins({ type: 'GENERAL', severity: 'INFO', title: 't', message: 'm', whatsapp: { kind: 'X' } });
  assert.ok(!('whatsapp' in saved[0]));
});

test('owner alerts go to the owner\'s number in the new shape', async () => {
  reset();
  await wa.stockRequestSubmitted({
    id: 'sr1', requestNumber: 'SR-0001', totalValue: 760000, createdAt: new Date('2026-11-10T11:32:00Z'),
    salesRep: { code: 'REP-001', user: { name: 'Asha Mwinyi' } },
    items: [{ product: { name: 'Pepa King Size' }, quantityRequested: 20, packagingUnit: null }],
  });
  assert.match(sent[0], /phone=255700000000&apikey=ownerkey/);
  assert.equal(textOf(sent[0]), '*STOCK REQUEST*\n10 Nov 2026 | 14:32 EAT\n\nBy: Asha Mwinyi\n\nPepa King Size: 20 Boxes\nTotal Value: TSh 760,000');
  assert.equal(logged[0].type, 'STOCK_REQUEST');
  assert.equal(logged[0].priority, 'ACTION', 'priority still decides quiet-hours and budget; only the emoji is gone');
});

test('the test message and the samples use the new text', async () => {
  reset();
  await wa.test();
  assert.equal(textOf(sent[0]), '*ZELAB — TEST NOTIFICATION*\n\nWhatsApp notifications are working.');
  reset();
  await wa.test('deadline');
  assert.match(textOf(sent[0]), /^\*SETTLEMENT DEADLINE\*\nSTL-20261110-0001\n\nRep: Paul\nTime Remaining: 8 Minutes/);
});

test('no text that reaches WhatsApp has an emoji, in any of the paths above', async () => {
  const everything = logged.map((r) => r.text).concat(sent.map(textOf));
  for (const text of everything) assert.ok(!/[\u{1F000}-\u{1FFFF}\u{2190}-\u{2BFF}️]/u.test(text));
});

test('a stock request with several products arrives numbered, with the boxes of every carton counted', async () => {
  reset();
  const pk = (unitId, base) => ({ packagingUnitId: unitId, baseQuantity: base });
  await wa.stockRequestSubmitted({
    id: 'sr2', requestNumber: 'SR-0002', totalValue: 30000, createdAt: new Date('2026-11-10T16:01:00Z'),
    salesRep: { code: 'REP-009', user: { name: 'Nyoya' } },
    items: [
      { product: { name: 'OHIS Pepa Ndogo (Brown) – Bila Filter', packagings: [pk('box', 1), pk('ctn', 10)] }, packagingUnitId: 'box', quantityRequested: 1, packagingUnit: { name: 'Box' } },
      { product: { name: 'OHIS Pepa Ndogo (Blue)', packagings: [pk('box', 1), pk('ctn', 10)] }, packagingUnitId: 'ctn', quantityRequested: 2, packagingUnit: { name: 'Carton' } },
    ],
  });
  assert.equal(textOf(sent[0]),
    '*STOCK REQUEST*\n10 Nov 2026 | 19:01 EAT\n\nBy: Nyoya\n\nProduct 1: OHIS Pepa Ndogo (Brown) – Bila Filter\nQuantity: 1 Box\n\nProduct 2: OHIS Pepa Ndogo (Blue)\nQuantity: 2 Cartons\n\nTotal Boxes: 21\nTotal Value: TSh 30,000');
});
