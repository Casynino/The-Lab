'use strict';

// ── A rep with two or more cities says which city a stock request is for ─────
// Nino, 11 Nov 2026: "when the rep has two cities, every time he requests stock he should pick which
// city — from the cities he is registered to. If he has one city, don't change anything." Pinned here:
// a one-city rep stores nothing and is never asked; a multi-city rep must name one of HIS cities; the
// service refuses before anything is written; an edit keeps the city already chosen; and the owner's
// WhatsApp text shows the city under the rep's name.

const test = require('node:test');
const assert = require('node:assert/strict');

const { requestRegion } = require('../src/constants/regions');

const ONE = { region: 'Arusha', regions: ['Arusha'] };
const OLD = { region: 'Arusha', regions: [] }; // a rep from before the list existed
const TWO = { region: 'Arusha', regions: ['Arusha', 'Kilimanjaro'] };

test('a one-city rep is never asked: his one city is the request\'s city, whatever is sent', () => {
  assert.deepEqual(requestRegion(ONE, undefined), { region: 'Arusha' });
  assert.deepEqual(requestRegion(ONE, 'Kilimanjaro'), { region: 'Arusha' });
  assert.deepEqual(requestRegion(OLD, undefined), { region: 'Arusha' });
});

test('a rep with no city on record stores none', () => {
  assert.deepEqual(requestRegion(null, 'Arusha'), { region: null });
  assert.deepEqual(requestRegion({ region: null, regions: [] }, 'Arusha'), { region: null });
});

test('a rep with two cities must pick one', () => {
  assert.ok(requestRegion(TWO, undefined).error);
  assert.ok(requestRegion(TWO, '').error);
  assert.ok(requestRegion(TWO, null).error);
});

test('the pick must be one of the rep\'s own cities, in its official spelling', () => {
  assert.deepEqual(requestRegion(TWO, 'Kilimanjaro'), { region: 'Kilimanjaro' });
  assert.deepEqual(requestRegion(TWO, 'kilimanjaro'), { region: 'Kilimanjaro' });
  assert.match(requestRegion(TWO, 'Mwanza').error, /not one of your cities/);
  assert.ok(requestRegion(TWO, 'Nowhere').error);
});

// ── The service: refuses before writing, stores the pick, keeps it on an edit ──
function loadService({ rep, existing }) {
  const written = { create: null, update: null, transactions: 0 };
  const tx = {
    product: { findMany: async () => [{ id: 'p1', sellingPrice: 36000 }] },
    stockRequest: {
      count: async () => 0,
      findMany: async () => [], // document numbers read today's numbers
      updateMany: async () => ({ count: 1 }),
      create: async ({ data }) => { written.create = data; return { id: 'r1', requestNumber: 'REQ-1', totalValue: data.totalValue, ...data }; },
      update: async ({ data }) => { written.update = data; return { id: 'r1', requestNumber: 'REQ-1', totalValue: data.totalValue, ...data }; },
    },
    stockRequestItem: { deleteMany: async () => ({}) },
  };
  const prisma = {
    salesRepresentative: { findUnique: async () => rep },
    stockRequest: { findUnique: async () => existing },
    warehouse: { findFirst: async () => ({ id: 'w1' }) },
    $transaction: async (fn) => { written.transactions += 1; return fn(tx); },
  };
  const stub = (rel, exports) => {
    const file = require.resolve(rel);
    require.cache[file] = { id: file, filename: file, loaded: true, exports };
  };
  stub('../src/config/prisma', prisma);
  stub('../src/services/inventory.service', {
    convertToBase: async (_tx, _p, _u, qty) => ({ packaging: { unitPrice: 36000, baseQuantity: 1 }, baseQuantity: qty }),
    warehouseBalances: async () => [{ productId: 'p1', baseQuantity: 999 }],
  });
  stub('../src/services/transfers.service', {});
  stub('../src/services/notification.service', { notifyAdmins: async () => {}, notifyUser: async () => {} });
  stub('../src/services/whatsappNotify.service', { background: () => {}, stockRequestSubmitted: async () => {} });
  delete require.cache[require.resolve('../src/services/stockRequest.service')];
  return { svc: require('../src/services/stockRequest.service'), written };
}

const ITEMS = [{ productId: 'p1', packagingUnitId: 'u1', quantity: 4 }];

test('create: a two-city rep with no city is refused before anything is written', async () => {
  const { svc, written } = loadService({ rep: TWO });
  await assert.rejects(svc.create('s1', { items: ITEMS }), (e) => e.statusCode === 400 || e.status === 400 || /city/i.test(e.message));
  assert.equal(written.transactions, 0);
  assert.equal(written.create, null);
});

test('create: a two-city rep\'s pick is stored', async () => {
  const { svc, written } = loadService({ rep: TWO });
  await svc.create('s1', { items: ITEMS, region: 'Kilimanjaro' });
  assert.equal(written.create.region, 'Kilimanjaro');
});

test('create: a one-city rep sends nothing and the request still gets his city', async () => {
  const { svc, written } = loadService({ rep: ONE });
  await svc.create('s1', { items: ITEMS });
  assert.equal(written.create.region, 'Arusha');
});

test('update: an edit that does not mention the city keeps the one already chosen', async () => {
  const { svc, written } = loadService({ rep: TWO, existing: { id: 'r1', salesRepId: 's1', status: 'PENDING', region: 'Kilimanjaro', warehouseId: null, notes: null } });
  await svc.update('r1', { items: ITEMS });
  assert.equal(written.update.region, 'Kilimanjaro');
});

test('update: the city can be changed to another of the rep\'s cities', async () => {
  const { svc, written } = loadService({ rep: TWO, existing: { id: 'r1', salesRepId: 's1', status: 'PENDING', region: 'Kilimanjaro', warehouseId: null, notes: null } });
  await svc.update('r1', { items: ITEMS, region: 'Arusha' });
  assert.equal(written.update.region, 'Arusha');
});

// ── The owner's WhatsApp text ────────────────────────────────────────────────
test('STOCK REQUEST text shows the city under the name, only when there is one', () => {
  const t = require('../src/services/whatsappText');
  const at = new Date('2026-11-10T11:32:00Z');
  const withCity = t.owner.stockRequest({ by: 'Juma', city: 'Kilimanjaro', items: [{ name: 'Pepa', qty: 4 }], total: 144000, when: at });
  assert.equal(withCity, `*STOCK REQUEST*
10 Nov 2026 | 14:32 EAT

By: Juma
City: Kilimanjaro

(a) Pepa: 4 Boxes

Total Value: TSh 144,000`);
  const without = t.owner.stockRequest({ by: 'Juma', items: [{ name: 'Pepa', qty: 4 }], total: 144000, when: at });
  assert.ok(!/City:/.test(without));
});

// ── One request, several cities (Nino, 11 Nov 2026: "tell which box belongs to which city") ─────────
const { requestItemRegions } = require('../src/constants/regions');

test('each line keeps its own city; the request has one only when every line shares it', () => {
  const split = requestItemRegions(TWO, [{ productId: 'p1', region: 'Arusha' }, { productId: 'p1', region: 'kilimanjaro' }]);
  assert.deepEqual(split.items.map((i) => i.region), ['Arusha', 'Kilimanjaro']);
  assert.equal(split.region, null);
  const same = requestItemRegions(TWO, [{ productId: 'p1', region: 'Arusha' }, { productId: 'p2', region: 'Arusha' }]);
  assert.equal(same.region, 'Arusha');
});

test('a line with no city takes the request\'s city; a line for a city not his is refused', () => {
  assert.equal(requestItemRegions(TWO, [{ productId: 'p1' }], 'Kilimanjaro').items[0].region, 'Kilimanjaro');
  assert.ok(requestItemRegions(TWO, [{ productId: 'p1', region: 'Arusha' }, { productId: 'p2' }]).error);
  assert.match(requestItemRegions(TWO, [{ productId: 'p1', region: 'Mwanza' }]).error, /not one of your cities/);
});

test('a one-city rep\'s lines are all his city, whatever is sent', () => {
  const r = requestItemRegions(ONE, [{ productId: 'p1', region: 'Kilimanjaro' }, { productId: 'p2' }]);
  assert.deepEqual(r.items.map((i) => i.region), ['Arusha', 'Arusha']);
  assert.equal(r.region, 'Arusha');
});

test('create: one product split between two cities is saved as two lines, each with its city', async () => {
  const { svc, written } = loadService({ rep: TWO });
  await svc.create('s1', { items: [
    { productId: 'p1', packagingUnitId: 'u1', quantity: 2, region: 'Arusha' },
    { productId: 'p1', packagingUnitId: 'u1', quantity: 3, region: 'Kilimanjaro' },
  ] });
  const lines = written.create.items.create;
  assert.deepEqual(lines.map((l) => [l.region, l.quantityRequested]), [['Arusha', 2], ['Kilimanjaro', 3]]);
  assert.equal(written.create.region, null);
});

test('approve: the stock is issued as one line per product, the cities stay on the request', async () => {
  const issued = [];
  const updates = [];
  let claims = 0;
  const prisma = {
    $transaction: async (fn) => fn(prisma),
    stockRequest: {
      updateMany: async ({ where }) => { claims += 1; return { count: where.status === 'PENDING' && claims === 1 ? 1 : 0 }; },
      findUnique: async () => ({ id: 'r1', status: 'PENDING', salesRepId: 's1', warehouseId: null, requestNumber: 'REQ-1', items: [
        { id: 'i1', productId: 'p1', packagingUnitId: 'u1', quantityRequested: 2, unitPrice: 36000, region: 'Arusha' },
        { id: 'i2', productId: 'p1', packagingUnitId: 'u1', quantityRequested: 3, unitPrice: 36000, region: 'Kilimanjaro' },
        { id: 'i3', productId: 'p2', packagingUnitId: 'u1', quantityRequested: 1, unitPrice: 32000, region: 'Arusha' },
      ] }),
      update: async ({ data }) => ({ id: 'r1', ...data }),
    },
    stockRequestItem: { update: async ({ where, data }) => { updates.push([where.id, data.quantityApproved]); return {}; } },
    settlement: { findFirst: async () => ({ id: 'stl1' }) },
    salesRepresentative: { findUnique: async () => ({ userId: 'u1' }) },
    warehouse: { findFirst: async () => ({ id: 'w1' }) },
  };
  const stub = (rel, exports) => { const f = require.resolve(rel); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };
  stub('../src/config/prisma', prisma);
  stub('../src/services/inventory.service', {
    convertToBase: async (_c, _p, _u, qty) => ({ packaging: { unitPrice: 36000, baseQuantity: 1 }, baseQuantity: qty }),
    warehouseBalances: async () => [{ productId: 'p1', baseQuantity: 99 }, { productId: 'p2', baseQuantity: 99 }],
  });
  stub('../src/services/transfers.service', { createTransferTx: async (_tx, args) => { issued.push(args); return { id: 't1' }; } });
  stub('../src/services/notification.service', { notifyAdmins: async () => {}, notifyUser: async () => {}, checkProductLowStock: async () => {} });
  stub('../src/services/whatsappNotify.service', { background: () => {}, stockRequestSubmitted: async () => {} });
  delete require.cache[require.resolve('../src/services/stockRequest.service')];
  const svc = require('../src/services/stockRequest.service');
  await svc.approve('r1', { id: 'admin' });
  assert.equal(issued.length, 1);
  assert.deepEqual(issued[0].items, [
    { productId: 'p1', packagingUnitId: 'u1', quantity: 5 },
    { productId: 'p2', packagingUnitId: 'u1', quantity: 1 },
  ]);
  // every request line still gets its own approved quantity
  assert.deepEqual(updates.sort(), [['i1', 2], ['i2', 3], ['i3', 1]]);

  // A second approval (a double tap, a retry) finds the request already decided: nothing more is issued.
  await assert.rejects(svc.approve('r1', { id: 'admin' }), (e) => e.statusCode === 409);
  assert.equal(issued.length, 1);
});

test('STOCK REQUEST text split between cities says each line\'s city', () => {
  const t = require('../src/services/whatsappText');
  const at = new Date('2026-11-10T11:32:00Z');
  const text = t.owner.stockRequest({ by: 'Juma', items: [{ name: 'Pepa', qty: 2, city: 'Arusha' }, { name: 'Pepa', qty: 3, city: 'Kilimanjaro' }], total: 180000, when: at });
  assert.match(text, /\(a\) Pepa: 2 Boxes · Arusha/);
  assert.match(text, /\(b\) Pepa: 3 Boxes · Kilimanjaro/);
  assert.ok(!/City:/.test(text));
});
