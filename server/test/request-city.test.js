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

test('a one-city rep is never asked and nothing is stored, whatever is sent', () => {
  assert.deepEqual(requestRegion(ONE, undefined), { region: null });
  assert.deepEqual(requestRegion(ONE, 'Kilimanjaro'), { region: null });
  assert.deepEqual(requestRegion(OLD, undefined), { region: null });
  assert.deepEqual(requestRegion(null, 'Arusha'), { region: null });
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

test('create: a one-city rep\'s request is exactly as before (no city stored)', async () => {
  const { svc, written } = loadService({ rep: ONE });
  await svc.create('s1', { items: ITEMS });
  assert.equal(written.create.region, null);
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
