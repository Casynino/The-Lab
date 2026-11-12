'use strict';

// ── One LOW STOCK — RESTOCK list instead of one WhatsApp per product (Nino, 12 Nov 2026) ──────────────
// At 09:00 every low product sent its own message, used up the owner's 14-per-4-hours budget and the
// daily report that evening never went. Now: one list per check, rewritten while it waits, a new one later
// in the day only for products no list of the day has carried, the switches still deciding.
// The database and CallMeBot are stubbed; the rows behave as Postgres would (unique dedupe key).

const test = require('node:test');
const assert = require('node:assert/strict');

const rows = [];
const sent = [];
const settings = { 'whatsapp.phone': '255700000000', 'whatsapp.apikey': 'ownerkey' };
let lowNow = []; // what reorder.lowStock() answers: [{ id, name, minStockLevel, onHand }]
const brandOf = {};
const stock = {}; // warehouse stock per product, for the real-time check
const catalog = {};
let staleOnce = null; // a row as a flush read it before it was rewritten
let beforeUpdateOnce = null; // runs once just before an updateMany lands: another check writing in between

// A where-clause matcher for the shapes the service uses (equality, startsWith, lt, not, OR, NOT).
function matches(row, where = {}) {
  return Object.entries(where).every(([k, v]) => {
    if (k === 'OR') return v.some((w) => matches(row, w));
    if (k === 'NOT') return !matches(row, v);
    if (k === 'AND') return v.every((w) => matches(row, w));
    const val = row[k] ?? null;
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      if ('startsWith' in v) return typeof val === 'string' && val.startsWith(v.startsWith);
      if ('lt' in v) return val !== null && val < v.lt;
      if ('gt' in v) return val !== null && val > v.gt;
      if ('not' in v) return val !== v.not;
      if ('in' in v) return v.in.includes(val);
      return false;
    }
    return val === v;
  });
}

const prismaStub = {
  setting: { findUnique: async ({ where }) => (where.key in settings ? { value: settings[where.key] } : null) },
  product: {
    findMany: async ({ where }) => where.id.in.map((id) => ({ id, brand: brandOf[id] ? { name: brandOf[id] } : null })),
    findUnique: async ({ where }) => catalog[where.id] || null,
  },
  warehouseStock: { aggregate: async ({ where }) => ({ _sum: { baseQuantity: stock[where.productId] ?? 0 } }) },
  notification: { create: async ({ data }) => ({ id: 'n1', ...data }), findFirst: async () => null },
  whatsAppNotification: {
    create: async ({ data }) => {
      if (data.dedupeKey && rows.some((r) => r.dedupeKey === data.dedupeKey)) { const e = new Error('unique'); e.code = 'P2002'; throw e; }
      const row = { id: `w${rows.length + 1}`, attempts: 0, status: 'PENDING', lastAttemptAt: null, sentAt: null, lastError: null, toPhone: null, toApiKey: null, createdAt: new Date(), ...data };
      rows.push(row);
      return { ...row };
    },
    findMany: async ({ where }) => {
      if (staleOnce && where.priority) { const r = staleOnce; staleOnce = null; return [r]; } // flush's read
      return rows.filter((r) => matches(r, where)).map((r) => ({ ...r }));
    },
    groupBy: async () => [],
    findUnique: async ({ where }) => {
      const r = rows.find((x) => Object.entries(where).every(([k, v]) => x[k] === v));
      return r ? { ...r } : null;
    },
    updateMany: async ({ where, data }) => {
      if (beforeUpdateOnce && where.id) { const f = beforeUpdateOnce; beforeUpdateOnce = null; f(); } // a row's rewrite
      const hit = rows.filter((r) => matches(r, where));
      hit.forEach((r) => Object.assign(r, data));
      return { count: hit.length };
    },
    update: async ({ where, data }) => { const r = rows.find((x) => x.id === where.id); Object.assign(r, data); return { ...r }; },
    count: async ({ where }) => rows.filter((r) => matches(r, where)).length,
  },
};
const stub = (rel, exports) => { const f = require.resolve(rel); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };
stub('../src/config/prisma', prismaStub);
stub('../src/services/reorder.service', { lowStock: async () => lowNow.map((p) => ({ ...p })) });
global.fetch = async (url) => { sent.push(new URL(String(url)).searchParams.get('text')); return { ok: true, status: 200, text: async () => 'Message queued' }; };

const wa = require('../src/services/whatsappNotify.service');

const product = (id, name, brand, minStockLevel, onHand) => {
  brandOf[id] = brand; stock[id] = onHand; catalog[id] = { minStockLevel };
  return { id, name, minStockLevel, onHand };
};
const OHIS = product('o1', 'OHIS Ndogo (Brown) – Bila Filter', 'OHIS', 50, 20);
const CIV1 = product('c3', 'Civlily Ndogo (Brown) – Na Filter', 'Civlily', 50, 34);
const CIV2 = product('c5', 'Civlily Kubwa (White) – Bila Filter', 'Civlily', 50, 42);
const OHIS2 = product('o2', 'OHIS Ndogo (White) – Bila Filter', 'OHIS', 50, 50);
const EMPTY = product('c4', 'Civlily Kubwa (Brown) – Bila Filter', 'Civlily', 50, 0);

const quietNow = () => {
  const h = (new Date().getUTCHours() + 3) % 24;
  settings['whatsapp.quietFrom'] = String(h);
  settings['whatsapp.quietTo'] = String((h + 1) % 24);
};
const reset = () => {
  rows.length = 0; sent.length = 0; lowNow = [];
  delete settings['whatsapp.quietFrom']; delete settings['whatsapp.quietTo'];
  delete settings['whatsapp.notify.LOW_STOCK']; delete settings['whatsapp.notify.OUT_OF_STOCK'];
};
const stockRows = () => rows.filter((r) => r.refType === 'ProductList');

test('the sweep sends ONE message for every low product, and running it again sends nothing more', async () => {
  reset();
  lowNow = [CIV2, OHIS, CIV1];
  const first = await wa.scanStockAlerts();
  assert.equal(first.queued, true);
  assert.equal(stockRows().length, 1);
  assert.equal(sent.length, 1);
  assert.equal(sent[0], `*LOW STOCK — RESTOCK*

(1)- OHIS Ndogo (Brown) – Bila Filter
20 Boxes Remaining | Restock: 80 Boxes

(2)- Civlily Ndogo (Brown) – Na Filter
34 Boxes Remaining | Restock: 66 Boxes

(3)- Civlily Kubwa (White) – Bila Filter
42 Boxes Remaining | Restock: 58 Boxes`);
  const [row] = stockRows();
  assert.match(row.dedupeKey, /^stockalerts:\d{4}-\d{2}-\d{2}$/);
  assert.equal(row.type, 'LOW_STOCK');
  assert.equal(row.priority, 'WARNING');
  assert.deepEqual(row.refId.split(','), ['o1', 'c3', 'c5']);

  const second = await wa.scanStockAlerts();
  assert.equal(second.queued, false);
  assert.equal(stockRows().length, 1, 'no second row');
  assert.equal(sent.length, 1, 'nothing sent twice');
});

test('while the list waits, a product that runs low is added to it in place (still one row), CRITICAL once one is out', async () => {
  reset();
  quietNow();
  lowNow = [OHIS, CIV1];
  await wa.scanStockAlerts();
  assert.equal(stockRows().length, 1);
  assert.equal(stockRows()[0].status, 'PENDING', 'held by quiet hours');
  assert.equal(sent.length, 0);

  lowNow = [OHIS, CIV1, OHIS2];
  await wa.stockAlertForProduct('o2');
  assert.equal(stockRows().length, 1, 'still one row');
  assert.match(stockRows()[0].text, /\(1\)- OHIS Ndogo \(Brown\) – Bila Filter\n20 Boxes.*\n\n\(2\)- OHIS Ndogo \(White\) – Bila Filter\n50 Boxes Remaining \| Restock: 50 Boxes\n\n\(3\)- Civlily Ndogo \(Brown\) – Na Filter/);
  assert.equal(stockRows()[0].priority, 'WARNING');
  assert.equal(sent.length, 0, 'quiet hours still hold a WARNING');

  // An empty product makes the waiting list CRITICAL, which quiet hours do not hold: it goes now, as one.
  lowNow = [OHIS, CIV1, OHIS2, EMPTY];
  await wa.stockAlertForProduct('c4');
  assert.equal(stockRows().length, 1);
  assert.equal(stockRows()[0].type, 'OUT_OF_STOCK');
  assert.equal(stockRows()[0].priority, 'CRITICAL');
  assert.equal(stockRows()[0].status, 'SENT');
  assert.equal(sent.length, 1);
  assert.match(sent[0], /\(4\)- Civlily Kubwa \(Brown\) – Bila Filter\n0 Boxes Remaining \| Restock: 100 Boxes$/);
});

test('flush sends the waiting list as it is NOW, even if it was rewritten after flush read it', async () => {
  reset();
  quietNow();
  lowNow = [OHIS];
  await wa.scanStockAlerts();
  const stale = { ...stockRows()[0] };
  lowNow = [OHIS, CIV1];
  await wa.scanStockAlerts();
  delete settings['whatsapp.quietFrom']; delete settings['whatsapp.quietTo'];
  // A flush that read the row before the rewrite hands deliver the old text.
  staleOnce = stale;
  await wa.flush({ throttleMs: 0 });
  assert.equal(sent.length, 1);
  assert.ok(sent[0].includes('Civlily Ndogo (Brown) – Na Filter'), 'the rewritten text went, not the one read first');
  assert.notEqual(stale.text, sent[0]);
});

test('after the list went out, a product that runs low gets ONE new message with only that product; nothing is repeated', async () => {
  reset();
  lowNow = [OHIS, CIV1];
  await wa.scanStockAlerts();
  assert.equal(sent.length, 1);

  lowNow = [OHIS, CIV1, CIV2];
  const r = await wa.stockAlertForProduct('c5');
  assert.equal(r.queued, true);
  assert.equal(stockRows().length, 2);
  assert.match(stockRows()[1].dedupeKey, /^stockalerts:\d{4}-\d{2}-\d{2}:2$/);
  assert.equal(sent[1], '*LOW STOCK — RESTOCK*\n\n(1)- Civlily Kubwa (White) – Bila Filter\n42 Boxes Remaining | Restock: 58 Boxes');
  assert.equal(stockRows()[1].refId, 'c5');

  // Nothing new: nothing sent, no row.
  await wa.scanStockAlerts();
  await wa.stockAlertForProduct('o1');
  assert.equal(stockRows().length, 2);
  assert.equal(sent.length, 2);

  // CIV1 recovers, then runs low again the same day: not repeated.
  lowNow = [OHIS, CIV2];
  await wa.scanStockAlerts();
  lowNow = [OHIS, CIV2, CIV1];
  await wa.stockAlertForProduct('c3');
  assert.equal(stockRows().length, 2);
  assert.equal(sent.length, 2);
});

test('the switches still decide: LOW_STOCK off leaves the low products out, both off sends nothing', async () => {
  reset();
  settings['whatsapp.notify.LOW_STOCK'] = '0';
  lowNow = [OHIS, EMPTY, CIV1];
  await wa.scanStockAlerts();
  assert.equal(stockRows().length, 1);
  assert.equal(sent[0], '*LOW STOCK — RESTOCK*\n\n(1)- Civlily Kubwa (Brown) – Bila Filter\n0 Boxes Remaining | Restock: 100 Boxes');
  assert.equal(stockRows()[0].type, 'OUT_OF_STOCK');

  reset();
  settings['whatsapp.notify.OUT_OF_STOCK'] = '0';
  lowNow = [OHIS, EMPTY];
  await wa.scanStockAlerts();
  assert.ok(!sent[0].includes('Kubwa (Brown)'), 'the empty one is left out');
  assert.equal(stockRows()[0].type, 'LOW_STOCK');

  reset();
  settings['whatsapp.notify.LOW_STOCK'] = '0';
  settings['whatsapp.notify.OUT_OF_STOCK'] = '0';
  lowNow = [OHIS, EMPTY];
  const r = await wa.scanStockAlerts();
  assert.equal(r.queued, false);
  assert.equal(rows.length, 0);
  assert.equal(sent.length, 0);
});

test('a waiting list whose products all recovered is not sent', async () => {
  reset();
  quietNow();
  lowNow = [OHIS];
  await wa.scanStockAlerts();
  lowNow = [];
  await wa.scanStockAlerts();
  assert.equal(stockRows()[0].status, 'EXPIRED');
  delete settings['whatsapp.quietFrom']; delete settings['whatsapp.quietTo'];
  await wa.flush({ throttleMs: 0 });
  assert.equal(sent.length, 0);
});

test('a list too long for one message is queued as parts (1/2), (2/2) in order, the numbers running on', async () => {
  reset();
  quietNow(); // hold them, so the test does not wait the 8 seconds between parts
  const names = [
    ['OHIS Ndogo (Brown) – Bila Filter', 'OHIS'], ['OHIS Ndogo (White) – Bila Filter', 'OHIS'], ['OHIS Ndogo (Brown) – Na Filter', 'OHIS'],
    ['OHIS Kubwa (Brown) – Na Filter', 'OHIS'], ['OHIS Kubwa (Brown) – Bila Filter', 'OHIS'], ['Civlily Ndogo (Brown) – Bila Filter', 'Civlily'],
    ['Civlily Ndogo (White) – Bila Filter', 'Civlily'], ['Civlily Ndogo (Brown) – Na Filter', 'Civlily'], ['Civlily Kubwa (Brown) – Bila Filter', 'Civlily'],
    ['Civlily Kubwa (White) – Bila Filter', 'Civlily'], ['Civlily Kubwa (Brown) – Na Filter', 'Civlily'],
  ];
  lowNow = names.map(([n, b], k) => product(`p${k}`, n, b, 50, 10 + k));
  await wa.scanStockAlerts();
  const list = stockRows();
  assert.equal(list.length, 2);
  assert.match(list[0].dedupeKey, /^stockalerts:\d{4}-\d{2}-\d{2}$/);
  assert.match(list[1].dedupeKey, /^stockalerts:\d{4}-\d{2}-\d{2}:part2$/);
  assert.ok(list[0].text.startsWith('*LOW STOCK — RESTOCK (1/2)*\n\n(1)- OHIS Ndogo (Brown) – Bila Filter'));
  assert.ok(list[1].text.startsWith('*LOW STOCK — RESTOCK (2/2)*\n\n('));
  for (const r of list) assert.ok(r.text.length <= 700, `${r.text.length} characters`);
  assert.deepEqual([...list[0].refId.split(','), ...list[1].refId.split(',')], names.map((_, k) => `p${k}`));
  const numbers = list.flatMap((r) => [...r.text.matchAll(/^\((\d+)\)- /gm)].map((m) => Number(m[1])));
  assert.deepEqual(numbers, Array.from({ length: 11 }, (_, i) => i + 1));
});

test('a product sent as low that then runs OUT the same day is sent once more, as out (CRITICAL)', async () => {
  reset();
  const civ = product('c9', 'Civlily Ndogo (White) – Bila Filter', 'Civlily', 50, 20);
  lowNow = [OHIS, civ];
  await wa.scanStockAlerts();
  assert.equal(sent.length, 1);
  assert.deepEqual(stockRows()[0].refId.split(','), ['o1', 'c9']);

  lowNow = [OHIS, { ...civ, onHand: 0 }];
  const r = await wa.stockAlertForProduct('c9');
  assert.equal(r.queued, true);
  assert.equal(stockRows().length, 2);
  assert.equal(stockRows()[1].type, 'OUT_OF_STOCK');
  assert.equal(stockRows()[1].priority, 'CRITICAL');
  assert.equal(stockRows()[1].refId, 'c9!', 'remembered as out');
  assert.equal(sent[1], '*LOW STOCK — RESTOCK*\n\n(1)- Civlily Ndogo (White) – Bila Filter\n0 Boxes Remaining | Restock: 100 Boxes');

  // Once as out is enough: still out, or back to low after a small restock, nothing more that day.
  await wa.scanStockAlerts();
  lowNow = [OHIS, { ...civ, onHand: 10 }];
  await wa.scanStockAlerts();
  assert.equal(stockRows().length, 2);
  assert.equal(sent.length, 2);
});

test('a later part waits while the part before it has not gone, so (2/2) never arrives before (1/2)', async () => {
  reset();
  quietNow();
  lowNow = Array.from({ length: 11 }, (_, k) => product(`q${k}`, `Civlily Kubwa (Brown) – Bila Filter ${k}`, 'Civlily', 50, 10 + k));
  await wa.scanStockAlerts();
  const [p1, p2] = stockRows();
  assert.match(p2.dedupeKey, /:part2$/);
  delete settings['whatsapp.quietFrom']; delete settings['whatsapp.quietTo'];

  // Part 1 was tried and failed a moment ago, so flush's cool-down skips it and reads only part 2.
  const r1 = rows.find((r) => r.id === p1.id);
  Object.assign(r1, { attempts: 1, lastAttemptAt: new Date(), lastError: 'send failed' });
  await wa.flush({ throttleMs: 0 });
  assert.equal(sent.length, 0, 'part 2 did not jump the queue');
  assert.equal(rows.find((r) => r.id === p2.id).attempts, 0, 'not even tried');

  // Once part 1 has gone, part 2 follows.
  Object.assign(r1, { status: 'SENT', sentAt: new Date() });
  await wa.flush({ throttleMs: 0 });
  assert.equal(sent.length, 1);
  assert.ok(sent[0].startsWith('*LOW STOCK — RESTOCK (2/2)*'));
});

test('a rewrite that read older stock does not overwrite a newer one written meanwhile', async () => {
  reset();
  quietNow();
  lowNow = [OHIS];
  await wa.scanStockAlerts();
  // This check read [OHIS, CIV1]; before its write lands, another check that saw CIV2 low too writes.
  lowNow = [OHIS, CIV1];
  beforeUpdateOnce = () => {
    lowNow = [OHIS, CIV1, CIV2];
    stockRows()[0].text = 'written by the other check';
  };
  await wa.scanStockAlerts();
  assert.equal(stockRows().length, 1);
  assert.ok(stockRows()[0].text.includes('Civlily Kubwa (White) – Bila Filter'), 'the newer product is kept');
  assert.equal(stockRows()[0].refId, 'o1,c3,c5');
});

test('a list from an earlier day that quiet hours held is closed by flush, not sent with old numbers', async () => {
  reset();
  rows.push({
    id: 'old1', type: 'LOW_STOCK', priority: 'WARNING', status: 'PENDING', attempts: 0, lastAttemptAt: null,
    dedupeKey: 'stockalerts:2026-01-01', refType: 'ProductList', refId: 'o1', text: '*LOW STOCK — RESTOCK*\n\n(a) old',
    toPhone: null, toApiKey: null, createdAt: new Date(),
  });
  await wa.flush({ throttleMs: 0 });
  assert.equal(sent.length, 0);
  assert.equal(rows[0].status, 'EXPIRED');
});
