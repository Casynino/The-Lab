'use strict';

// ── Admin pages, audit round (11 Nov 2026) ─────────────────────────────────────────────────────────
// Pinned: a warehouse sale cannot be paid more than its total (the excess was booked as income); the
// minimum-stock level is measured on the warehouse shelves (Reorder, Products and Inventory counted the
// reps' boxes and called a LOW product OK); a purchase order cannot arrive before it was ordered; and a
// direct Warehouse → Rep transfer tells the rep about the order it opened, once.

const test = require('node:test');
const assert = require('node:assert/strict');

const install = (path, exports) => {
  const filename = require.resolve(path);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
};

// One database stand-in for the whole file; each test sets the tables it reads.
const db = {};
install('../src/config/prisma', db);
install('../src/config/env', { business: { reorderLookbackDays: 30, defaultCreditTermDays: 30 } });
const notified = [];
let notifyFails = false;
install('../src/services/notification.service', {
  notifyUser: async (userId, data) => {
    if (notifyFails) throw new Error('db down');
    notified.push({ userId, ...data });
  },
});
let createdTransfer = null;
install('../src/services/transfers.service', { createTransfer: async () => createdTransfer });
install('../src/services/audit.service', { record: async () => {} });

const inventory = require('../src/services/inventory.service');
const sales = require('../src/services/sales.service');
const reorder = require('../src/services/reorder.service');
const products = require('../src/services/products.service');
const purchase = require('../src/services/purchase.service');
const transfersCtrl = require('../src/controllers/transfers.controller');
const wt = require('../src/services/whatsappText');

// ── Sale: paid more than the total ───────────────────────────────────────────────────────────────────
function saleTx() {
  const calls = { created: [] };
  const tx = {
    product: { findMany: async () => [{ id: 'p1', name: 'Pepa', isActive: true, sellingPrice: 2500, purchasePrice: 1000 }] },
    warehouse: { findUnique: async () => ({ region: null }) },
    sale: {
      findMany: async () => [],
      count: async () => 0,
      findFirst: async () => null,
      create: async ({ data }) => { calls.created.push(data); return { id: 's1', soldAt: new Date(), ...data }; },
      findUnique: async () => ({ id: 's1', ...calls.created[calls.created.length - 1] }),
    },
  };
  return { tx, calls };
}
inventory.convertToBase = async () => ({ packaging: { baseQuantity: 1, unitPrice: 2500, packagingUnit: { name: 'Box' } } });
inventory.decreaseStock = async () => {};
const cashSale = (extra) => ({ type: 'CASH', warehouseId: 'wh1', items: [{ productId: 'p1', packagingUnitId: 'u1', quantity: 1 }], ...extra });

test('a cash sale paid more than its total is refused before anything is written', async () => {
  const { tx, calls } = saleTx();
  await assert.rejects(sales.createSaleTx(tx, cashSale({ amountPaid: 3000 }), { id: 'staff' }), (e) => {
    assert.equal(e.statusCode, 400);
    assert.match(e.message, /more than the sale total/);
    return true;
  });
  assert.equal(calls.created.length, 0);
});

test('paying the total, or leaving it empty, still records a paid sale', async () => {
  for (const extra of [{ amountPaid: 2500 }, {}]) {
    const { tx, calls } = saleTx();
    await sales.createSaleTx(tx, cashSale(extra), { id: 'staff' });
    assert.equal(calls.created[0].status, 'PAID');
    assert.equal(calls.created[0].amountPaid, 2500);
  }
});

// ── Minimum stock is a warehouse level ───────────────────────────────────────────────────────────────
// OHIS: 21 boxes in the warehouse, 42 out with reps (63 in all), minimum 50 — LOW, although 63 > 50.
// Civ: 80 in the warehouse, none with reps — fine.
function stockDb() {
  db.product = {
    findMany: async () => [
      { id: 'ohis', name: 'OHIS Pepa Ndogo', sku: 'O1', minStockLevel: 50, reorderQuantity: 0, purchasePrice: 1000, baseUnitName: 'Box', isActive: true },
      { id: 'civ', name: 'Civ Kubwa', sku: 'C1', minStockLevel: 50, reorderQuantity: 0, purchasePrice: 1000, baseUnitName: 'Box', isActive: true },
    ],
    count: async () => 2,
  };
  db.inventoryTransaction = {
    groupBy: async ({ where = {} }) => {
      if (where.type) return [{ productId: 'ohis', _sum: { baseQuantity: -30 } }]; // sold in the window
      if (where.warehouseId) return [{ productId: 'ohis', _sum: { baseQuantity: 21 } }, { productId: 'civ', _sum: { baseQuantity: 80 } }];
      return [{ productId: 'ohis', _sum: { baseQuantity: 63 } }, { productId: 'civ', _sum: { baseQuantity: 80 } }];
    },
  };
}

test('reorder: below minimum is judged on the warehouse, cover on everything', async () => {
  stockDb();
  const r = await reorder.reorderAnalysis();
  const ohis = r.items.find((i) => i.productId === 'ohis');
  assert.equal(ohis.onHand, 63);
  assert.equal(ohis.inWarehouse, 21);
  assert.equal(ohis.withReps, 42);
  assert.equal(ohis.belowMin, true);
  assert.equal(ohis.daysRemaining, 63, '63 boxes at 1 a day');
  assert.match(ohis.reason, /21 in the warehouse, below your minimum of 50/);
  assert.equal(r.items.find((i) => i.productId === 'civ').belowMin, false);
  assert.equal(r.summary.belowMinCount, 1);
});

test('low stock (Dashboard) lists the product the alerts call low, with its warehouse figure', async () => {
  stockDb();
  const low = await reorder.lowStock();
  assert.deepEqual(low.map((l) => [l.id, l.onHand, l.withReps]), [['ohis', 21, 42]]);
});

test('Products marks it Low while still showing every box on hand', async () => {
  stockDb();
  const { items } = await products.listProducts({}, { skip: 0, take: 15, orderBy: {} });
  const ohis = items.find((p) => p.id === 'ohis');
  assert.equal(ohis.onHandBase, 63);
  assert.equal(ohis.warehouseBase, 21);
  assert.equal(ohis.lowStock, true);
  assert.equal(items.find((p) => p.id === 'civ').lowStock, false);
});

// ── Purchase order dates ─────────────────────────────────────────────────────────────────────────────
test('a purchase order cannot be expected before it was ordered (same day is fine)', async () => {
  let ran = 0;
  db.$transaction = async () => { ran += 1; return {}; };
  const po = { supplierId: 's', items: [{ productId: 'p1', packagingUnitId: 'u1', quantity: 1 }] };
  await assert.rejects(
    purchase.createPurchaseOrder({ ...po, orderedAt: '2026-11-20', expectedArrival: '2026-11-01' }),
    /Expected arrival cannot be before the order date/,
  );
  assert.equal(ran, 0);
  await purchase.createPurchaseOrder({ ...po, orderedAt: '2026-11-20T09:00:00.000Z', expectedArrival: '2026-11-20' });
  assert.equal(ran, 1);
});

test('editing a purchase order checks a changed date against the stored one, and nothing else', async () => {
  const stored = { id: 'po1', status: 'ORDERED', orderedAt: new Date('2026-11-20'), expectedArrival: new Date('2026-11-01') };
  const updates = [];
  db.purchaseOrder = {
    findUnique: async () => stored,
    update: async ({ data }) => { updates.push(data); return { ...stored, ...data }; },
  };
  await assert.rejects(purchase.updatePurchaseOrder('po1', { expectedArrival: '2026-11-10' }), /cannot be before the order date/);
  // An older order already holding odd dates can still have its notes changed.
  await purchase.updatePurchaseOrder('po1', { notes: 'call the supplier' });
  await purchase.updatePurchaseOrder('po1', { expectedArrival: '2026-11-25' });
  assert.equal(updates.length, 2);
});

// ── The rep is told about a direct transfer ──────────────────────────────────────────────────────────
// asyncHandler does not hand back its promise, so the call is awaited until it answers or fails.
const call = (handler) => new Promise((resolve) => {
  const out = { code: null, failed: null };
  const res = { status: (code) => { out.code = code; return { json: () => resolve(out) }; } };
  handler({ body: {}, user: { id: 'admin' } }, res, (e) => { out.failed = e; resolve(out); });
});
const transfer = (direction) => ({
  id: 't1', transferNumber: 'TRF-20261111-0011', direction,
  toRep: direction === 'WAREHOUSE_TO_REP' ? { userId: 'rep-user', user: { name: 'Meyo' } } : null,
  items: [
    { quantity: 3, baseQuantity: 3, product: { name: 'OHIS Pepa Ndogo (Brown)' }, packagingUnit: { name: 'Box' } },
    { quantity: 1, baseQuantity: 1, product: { name: 'Civlily Pepa Kubwa (White)' }, packagingUnit: { name: 'Box' } },
  ],
});
const deadline = new Date('2026-11-14T04:48:14Z'); // 07:48 in Tanzania

test('a Warehouse → Rep transfer tells the rep the order, its deadline and what came', async () => {
  notified.length = 0;
  notifyFails = false;
  db.settlement = { findFirst: async ({ where }) => (where.transferId === 't1' ? { id: 'stl1', settlementNumber: 'STL-20261111-0011', deadlineAt: deadline } : null) };
  createdTransfer = transfer('WAREHOUSE_TO_REP');
  const out = await call(transfersCtrl.create);
  assert.equal(out.failed, null);
  assert.equal(out.code, 201);
  assert.equal(notified.length, 1);
  const n = notified[0];
  assert.equal(n.userId, 'rep-user');
  assert.equal(n.entityType, 'Settlement');
  assert.equal(n.entityId, 'stl1');
  assert.equal(n.message, '4 Boxes issued to you (TRF-20261111-0011). Order STL-20261111-0011: settle or return them by 14 Nov 2026 | 07:48 EAT. Check your open orders.');
  assert.equal(n.whatsapp.kind, 'STOCK_ISSUED');
  assert.equal(wt.repText(n.whatsapp),
`*STOCK ISSUED*

Transfer: TRF-20261111-0011
Order: STL-20261111-0011
Deadline: 14 Nov 2026 | 07:48 EAT

(1)- OHIS Pepa Ndogo (Brown): 3 Boxes
(2)- Civlily Pepa Kubwa (White): 1 Box

Stock has been issued to you. Settle or return it before the deadline.

ZELab`);
});

test('other transfers tell nobody, and a failed message never fails the transfer', async () => {
  notified.length = 0;
  createdTransfer = transfer('WAREHOUSE_TO_WAREHOUSE');
  const out = await call(transfersCtrl.create);
  assert.equal(notified.length, 0);
  assert.equal(out.code, 201);

  notifyFails = true;
  createdTransfer = transfer('WAREHOUSE_TO_REP');
  const out2 = await call(transfersCtrl.create);
  assert.equal(out2.failed, null);
  assert.equal(out2.code, 201);
  notifyFails = false;
});

// ── A customer's phone is a phone number ─────────────────────────────────────────────────────────────
test('a customer phone must be a number written any usual way, or nothing', () => {
  const { customerCreate, customerUpdate } = require('../src/validators/people.validator');
  const ok = (phone) => customerCreate.body.safeParse({ name: 'Mama Neema', phone }).success;
  assert.equal(ok('not-a-phone!!'), false);
  assert.equal(ok('12345'), false, 'too few digits');
  for (const good of ['0712 345 678', '+255 712-345-678', '(0712) 345678', '+254 712 345 678', '', null, undefined]) {
    assert.equal(ok(good), true, String(good));
  }
  // An edit's phone is checked by the controller, against the saved one (next test).
  assert.equal(customerUpdate.body.safeParse({ notes: 'no phone sent' }).success, true);
  assert.equal(customerUpdate.body.safeParse({ phone: 'x'.repeat(41) }).success, false, 'still at most 40 characters');
});

// Since the check above, a customer whose SAVED phone is not a plain number ("0712.../0754...", "-")
// could not be saved at all, not even for a name change. The phone is now checked only when it changes.
test('editing a customer checks the phone only when it changes', async () => {
  const ctrl = require('../src/controllers/customers.controller');
  const { customerUpdate } = require('../src/validators/people.validator');
  const saved = { id: 'c1', name: 'Mama Neema', phone: '0712 345 678/0754 111 222', salesRepId: 'r1' };
  let written = null;
  db.customer = {
    findUnique: async () => ({ ...saved }),
    update: async ({ data }) => { written = data; return { ...saved, ...data }; },
  };
  const edit = (body, user = { id: 'admin', role: 'ADMIN' }) => new Promise((resolve) => {
    const out = { code: null, failed: null };
    const res = { status: (code) => { out.code = code; return { json: () => resolve(out) }; } };
    // The request goes through the route's validator first, as it does in the app.
    ctrl.update({ params: { id: 'c1' }, body: customerUpdate.body.parse(body), user }, res, (e) => { out.failed = e; resolve(out); });
  });

  // The whole form sent back with the old phone untouched: the name change is saved.
  let out = await edit({ name: 'Mama Neema Shop', phone: ` ${saved.phone} `, notes: '' });
  assert.equal(out.failed, null);
  assert.equal(out.code, 200);
  assert.equal(written.name, 'Mama Neema Shop');
  for (const old of ['-', 'call me']) {
    saved.phone = old;
    written = null;
    out = await edit({ name: 'Renamed', phone: old }, { id: 'u', role: 'SALES_REP', salesRepId: 'r1' });
    assert.equal(out.failed, null, old);
    assert.equal(written.name, 'Renamed');
  }

  // A NEW phone must still be a phone number; nothing is written.
  written = null;
  out = await edit({ name: 'Renamed', phone: 'not-a-phone!!' });
  assert.equal(out.failed.statusCode, 422);
  assert.equal(out.failed.details[0].path, 'phone');
  assert.match(out.failed.details[0].message, /phone number in digits/);
  assert.equal(written, null);

  // A real new number, or clearing it, is saved.
  for (const phone of ['0754 111 222', '', null]) {
    written = null;
    out = await edit({ phone });
    assert.equal(out.failed, null, String(phone));
    assert.equal(written.phone, phone);
  }
});
