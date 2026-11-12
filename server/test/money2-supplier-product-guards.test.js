'use strict';

// ── Final audit, round 2 (12 Nov 2026): supplier, purchase-order, product and order-close guards ───────
// Pinned here:
//  - an expense is never saved under the form's "+ New category…" placeholder (money-flows-6);
//  - a brand settles to one active account, also when an account is edited (money-flows-9);
//  - removing a supplier says whether it was deleted or switched off, and one with returns or balance
//    payments is never deleted (money-flows-8);
//  - a purchase order cannot be edited below what was paid on it, and deleting, cancelling or lowering one
//    never leaves the supplier overpaid (reversals-stock-2, -3);
//  - receiving an order already received answers 409, and a new order defaults to TZS (reversals-stock-5, -8);
//  - removing a product says what happened, refuses while a settlement of it waits, and names the order
//    that holds a never-stocked one (reversals-stock-1, -7);
//  - "Close this order" closes it once and tells the rep once (reversals-stock-6).

const test = require('node:test');
const assert = require('node:assert/strict');

const stub = (rel, exports) => {
  const f = require.resolve(rel);
  require.cache[f] = { id: f, filename: f, loaded: true, exports };
};
const fresh = (rel) => {
  delete require.cache[require.resolve(rel)];
  return require(rel);
};
const tick = () => new Promise((r) => setImmediate(r));

// A database stand-in that answers every table with "nothing"; a test fills in only what it is about.
function db(tables = {}) {
  const empty = {
    findMany: async () => [], findFirst: async () => null, findUnique: async () => null,
    count: async () => 0, groupBy: async () => [], aggregate: async () => ({ _sum: {}, _count: 0 }),
  };
  const proxy = new Proxy({}, {
    get(_t, name) {
      if (name === 'then') return undefined;
      if (name === '$transaction') return (fn) => fn(proxy); // not serialised: the claims must hold alone
      if (name === '$queryRaw' || name === '$executeRaw') return async () => [];
      return { ...empty, ...(tables[name] || {}) };
    },
  });
  return proxy;
}

const notified = [];
stub('../src/services/notification.service', {
  notifyUser: async (userId, data) => { notified.push({ to: userId, ...data }); },
  notifyAdmins: async (data) => { notified.push({ to: 'admins', ...data }); },
  createIfAbsent: async () => {},
});

// ── money-flows-6 ────────────────────────────────────────────────────────────────────────────────────
test('an expense under the "+ New category…" placeholder is refused, in a new row and in an edit', async () => {
  let wrote = 0;
  stub('../src/config/prisma', db({
    financeTransaction: { findUnique: async () => ({ id: 't1', amount: 1000 }), update: async () => { wrote += 1; } },
  }));
  const finance = fresh('../src/services/finance.service');
  await assert.rejects(async () => finance.recordExpense({ accountId: 'a1', amount: 1000, category: '__new' }, { id: 'admin' }),
    (e) => e.statusCode === 400 && /name for the new category/.test(e.message));
  await assert.rejects(async () => finance.recordIncome({ accountId: 'a1', amount: 1000, category: ' __new ' }, { id: 'admin' }),
    (e) => e.statusCode === 400);
  await assert.rejects(finance.updateTransaction('t1', { category: '__new' }), (e) => e.statusCode === 400);
  assert.equal(wrote, 0);
});

// ── money-flows-9 ────────────────────────────────────────────────────────────────────────────────────
test('an account edit cannot give a brand a second active account; renaming one is fine', async () => {
  const accounts = [
    { id: 'mpesa', name: 'M-Pesa', type: 'MOBILE_MONEY', brandId: 'ohis', isActive: true },
    { id: 'cash', name: 'Cash in hand', type: 'OTHER', brandId: null, isActive: true },
    { id: 'old', name: 'Old OHIS till', type: 'OTHER', brandId: 'ohis', isActive: false },
  ];
  const updates = [];
  stub('../src/config/prisma', db({
    businessAccount: {
      findUnique: async ({ where }) => accounts.find((a) => a.id === where.id) || null,
      findFirst: async ({ where }) => accounts.find((a) => a.brandId === where.brandId && a.isActive && a.id !== where.id.not) || null,
      update: async ({ where, data }) => { updates.push({ id: where.id, ...data }); return { ...accounts.find((a) => a.id === where.id), ...data }; },
    },
  }));
  const finance = fresh('../src/services/finance.service');
  await assert.rejects(finance.updateAccount('cash', { brandId: 'ohis' }),
    (e) => e.statusCode === 400 && /M-Pesa is already this brand's settlement account/.test(e.message));
  await assert.rejects(finance.updateAccount('old', { isActive: true }), (e) => e.statusCode === 400);
  assert.equal(updates.length, 0);
  await finance.updateAccount('mpesa', { name: 'M-Pesa OHIS', brandId: 'ohis' });
  await finance.updateAccount('cash', { brandId: null, notes: 'drawer' });
  assert.equal(updates.length, 2);
});

// ── Purchases: one stand-in for suppliers, orders and their money ────────────────────────────────────
function loadPurchase({ orders = [], poPayments = {}, balancePaid = 0, credits = 0, supplierCredits = 0 } = {}) {
  const pos = orders.map((o) => ({ supplierId: 'sup1', status: 'DRAFT', shippingCost: 0, clearingCost: 0, otherCost: 0, ...o }));
  const writes = [];
  const supplier = { id: 'sup1', name: 'RSV Supplier B', isActive: true };
  stub('../src/config/prisma', db({
    supplier: {
      findUnique: async () => supplier,
      update: async ({ data }) => { writes.push({ supplier: data }); return { ...supplier, ...data }; },
      delete: async () => { writes.push({ supplier: 'deleted' }); },
    },
    supplierCredit: { count: async () => supplierCredits },
    purchaseOrder: {
      count: async () => pos.length,
      findUnique: async ({ where }) => pos.find((p) => p.id === where.id) || null,
      update: async ({ where, data }) => {
        writes.push({ po: where.id, ...data });
        const { items, ...fields } = data; // eslint-disable-line no-unused-vars
        return Object.assign(pos.find((p) => p.id === where.id), fields);
      },
      delete: async ({ where }) => { writes.push({ po: where.id, deleted: true }); },
      create: async ({ data }) => ({ id: 'new', ...data }),
    },
    purchaseOrderItem: { deleteMany: async () => {} },
    financeTransaction: {
      count: async ({ where }) => (where.refType === 'Supplier' && balancePaid > 0 ? 1 : 0),
      aggregate: async ({ where }) => ({
        _sum: { amount: where.refType === 'Supplier' ? balancePaid : (poPayments[where.refId] || 0) },
      }),
    },
  }));
  // The supplier window's own figures: live orders − returned − every payment.
  stub('../src/services/finance.service', {
    supplierDetail: async () => {
      const live = pos.filter((p) => p.status !== 'CANCELLED');
      const purchased = live.reduce((s, p) => s + p.totalCost, 0);
      const paid = live.reduce((s, p) => s + (poPayments[p.id] || 0), 0) + balancePaid;
      return { supplier, totals: { purchased, paid, returned: credits, outstanding: purchased - credits - paid } };
    },
  });
  stub('../src/services/inventory.service', {
    convertToBase: async (_tx, _p, _u, quantity) => ({ baseQuantity: quantity }),
    increaseStock: async () => {},
    LOCATION: { WAREHOUSE: 'WAREHOUSE' },
  });
  return { purchase: fresh('../src/services/purchase.service'), writes, pos };
}

// ── money-flows-8 ────────────────────────────────────────────────────────────────────────────────────
test('removing a supplier with history switches it off and says so; one with returns only is not deleted', async () => {
  const withPo = loadPurchase({ orders: [{ id: 'po1', totalCost: 1000 }] });
  const r1 = await withPo.purchase.removeSupplier('sup1');
  assert.equal(r1.deactivated, true);
  assert.equal(r1.deleted, false);
  assert.match(r1.message, /1 purchase order, so it was switched off, not deleted/);
  assert.deepEqual(withPo.writes, [{ supplier: { isActive: false } }]);

  const returnsOnly = loadPurchase({ supplierCredits: 2 });
  const r2 = await returnsOnly.purchase.removeSupplier('sup1');
  assert.equal(r2.deactivated, true);
  assert.match(r2.message, /2 returns/);
  assert.ok(!returnsOnly.writes.some((w) => w.supplier === 'deleted'));

  const clean = loadPurchase();
  const r3 = await clean.purchase.removeSupplier('sup1');
  assert.equal(r3.deleted, true);
  assert.deepEqual(clean.writes, [{ supplier: 'deleted' }]);
});

// ── reversals-stock-2 ────────────────────────────────────────────────────────────────────────────────
test('a purchase order cannot be edited below what was paid against it', async () => {
  const { purchase, writes } = loadPurchase({
    orders: [{ id: 'po1', poNumber: 'PO-8', totalCost: 50000, goodsCost: 40000, shippingCost: 10000 }],
    poPayments: { po1: 40000 },
  });
  const oneBox = [{ productId: 'p1', packagingUnitId: 'box', quantity: 1, unitCost: 10000 }];
  // New lines: 1 box at 10,000 plus the 10,000 shipping = 20,000.
  await assert.rejects(purchase.updatePurchaseOrder('po1', { items: oneBox, shippingCost: 0 }),
    (e) => e.statusCode === 400 && /TSh\s40,000 has been paid against this order; the new total TSh\s10,000 is less/.test(e.message));
  // A cost taken off alone is checked the same way (40,000 goods, no shipping, 40,000 paid: allowed; less: not).
  await assert.rejects(purchase.updatePurchaseOrder('po1', { shippingCost: 0, otherCost: 0, clearingCost: 0, notes: 'x' }).then(
    () => purchase.updatePurchaseOrder('po1', { items: [{ ...oneBox[0], quantity: 3 }] }),
  ), (e) => e.statusCode === 400);
  assert.equal(writes.length, 1, 'only the edit down to exactly what was paid was written');
  assert.equal(writes[0].totalCost, 40000);
  // Raising it, or lowering it to what was paid, is fine.
  await purchase.updatePurchaseOrder('po1', { items: [{ ...oneBox[0], quantity: 4 }] });
  assert.equal(writes.at(-1).totalCost, 40000);
});

// ── reversals-stock-3 ────────────────────────────────────────────────────────────────────────────────
test('deleting or cancelling an order is refused when a balance payment would leave the supplier overpaid', async () => {
  const setup = () => loadPurchase({
    orders: [{ id: 'poA', poNumber: 'PO-9', totalCost: 10000, status: 'ORDERED' }, { id: 'poB', poNumber: 'PO-10', totalCost: 30000 }],
    balancePaid: 40000,
  });
  const a = setup();
  await assert.rejects(a.purchase.deletePurchaseOrder('poA'),
    (e) => e.statusCode === 400 && /Deleting PO-9 would leave RSV Supplier B overpaid by TSh\s10,000/.test(e.message) && /TSh\s40,000 of it on the balance/.test(e.message));
  await assert.rejects(a.purchase.updatePurchaseOrder('poB', { status: 'CANCELLED' }),
    (e) => e.statusCode === 400 && /Cancelling PO-10 would leave RSV Supplier B overpaid by TSh\s30,000/.test(e.message));
  await assert.rejects(a.purchase.updatePurchaseOrder('poB', { supplierId: 'other' }), (e) => e.statusCode === 400);
  assert.equal(a.writes.length, 0);

  // With only part of the bill paid there is room: deleting the small order is fine.
  const b = loadPurchase({
    orders: [{ id: 'poA', poNumber: 'PO-9', totalCost: 10000 }, { id: 'poB', poNumber: 'PO-10', totalCost: 30000 }],
    balancePaid: 25000,
  });
  await b.purchase.deletePurchaseOrder('poA');
  assert.deepEqual(b.writes, [{ po: 'poA', deleted: true }]);
});

// ── reversals-stock-5 / -8 ───────────────────────────────────────────────────────────────────────────
test('receiving an order already received answers 409; a new order without a currency is TZS', async () => {
  const po = { id: 'po1', poNumber: 'PO-1', status: 'RECEIVED', items: [{ id: 'i1' }] };
  stub('../src/config/prisma', { $transaction: async (fn) => fn({ purchaseOrder: { findUnique: async () => po } }) });
  const purchase = fresh('../src/services/purchase.service');
  await assert.rejects(purchase.receivePurchaseOrder('po1', { id: 'a' }), (e) => e.statusCode === 409);

  let created;
  const tx = {
    purchaseOrder: {
      findFirst: async () => null, findMany: async () => [], count: async () => 0,
      create: async ({ data }) => { created = data; return { id: 'new', ...data }; },
      findUnique: async () => ({ id: 'new', ...created }),
    },
  };
  stub('../src/config/prisma', { $transaction: async (fn) => fn(tx) });
  stub('../src/services/inventory.service', { convertToBase: async (_t, _p, _u, q) => ({ baseQuantity: q }) });
  stub('../src/utils/numbering', { nextDocNumber: async () => 'PO-20261112-0099' });
  const p2 = fresh('../src/services/purchase.service');
  await p2.createPurchaseOrder({ supplierId: 's', items: [{ productId: 'p1', packagingUnitId: 'box', quantity: 1, unitCost: 1000 }] });
  assert.equal(created.currency, 'TZS');
  delete require.cache[require.resolve('../src/utils/numbering')];
});

// ── reversals-stock-1 / -7 ───────────────────────────────────────────────────────────────────────────
function loadProducts({ movements = 0, poLines = [], requestLines = [], pending = [], warehouse = 0, reps = [] } = {}) {
  const writes = [];
  const product = { id: 'p1', name: 'RSV Verify Box', baseUnitName: 'Box', isActive: true };
  stub('../src/config/prisma', db({
    product: {
      findUnique: async () => product,
      update: async ({ data }) => { writes.push(data); return { ...product, ...data }; },
      delete: async () => { writes.push('deleted'); return product; },
    },
    inventoryTransaction: {
      count: async () => movements,
      aggregate: async () => ({ _sum: { baseQuantity: warehouse } }),
      groupBy: async () => reps.map((r) => ({ salesRepId: r.id, _sum: { baseQuantity: r.boxes } })),
    },
    purchaseOrderItem: { findMany: async () => poLines.map((n) => ({ purchaseOrder: { poNumber: n } })) },
    stockRequestItem: { findMany: async () => requestLines.map((n) => ({ stockRequest: { requestNumber: n } })) },
    settlementSubmission: {
      count: async () => pending.length,
      findMany: async () => pending.map((id) => ({ salesRepId: id })),
    },
    salesRepresentative: {
      findMany: async () => [{ id: 'kp', code: 'REP-002', user: { name: 'KP' } }],
    },
  }));
  stub('../src/services/inventory.service', {});
  return { products: fresh('../src/services/products.service'), writes };
}

test('a never-stocked product on a purchase order is refused by name, not with a database error', async () => {
  const { products, writes } = loadProducts({ poLines: ['PO-20261112-0012'] });
  await assert.rejects(products.deleteProduct('p1'),
    (e) => e.statusCode === 400 && /RSV Verify Box is on purchase order PO-20261112-0012, so it cannot be removed/.test(e.message));
  assert.equal(writes.length, 0);
});

test('a product with stock history is switched off, not removed, and the answer says where its boxes are', async () => {
  const { products, writes } = loadProducts({ movements: 5, warehouse: 29, reps: [{ id: 'kp', boxes: 5 }] });
  const r = await products.deleteProduct('p1');
  assert.equal(r.deactivated, true);
  assert.equal(r.deleted, false);
  assert.match(r.message, /switched off, not removed: it has stock history/);
  assert.match(r.message, /29 in the warehouse; 5 with reps \(KP 5\)/);
  assert.deepEqual(writes, [{ isActive: false }]);
});

test('a product with a settlement waiting for approval cannot be switched off, by Remove or by Edit', async () => {
  const a = loadProducts({ movements: 5, pending: ['kp'] });
  await assert.rejects(a.products.deleteProduct('p1'),
    (e) => e.statusCode === 400 && /1 settlement of RSV Verify Box is waiting for approval \(KP\)/.test(e.message));
  await assert.rejects(a.products.updateProduct('p1', { isActive: false }), (e) => e.statusCode === 400);
  assert.equal(a.writes.length, 0);

  const b = loadProducts();
  const r = await b.products.deleteProduct('p1');
  assert.equal(r.deleted, true);
  assert.deepEqual(b.writes, ['deleted']);
});

// ── reversals-stock-6 ────────────────────────────────────────────────────────────────────────────────
test('three Close presses at once close the order once and tell the rep once', async () => {
  const order = {
    id: 'stl1', settlementNumber: 'STL-16', status: 'OPEN', transferId: null, salesRepId: 'kp',
    assignedValue: 0, settledValue: 0, returnedValue: 0, deadlineAt: new Date(), issuedAt: new Date(),
    salesRep: { user: { id: 'u-kp', name: 'KP' } }, deadlineChanges: [],
  };
  let settledWrites = 0;
  stub('../src/config/prisma', db({
    settlement: {
      findUnique: async () => { await tick(); return { ...order }; },
      updateMany: async ({ where, data }) => {
        await tick();
        if (order.status === where.status.not) return { count: 0 };
        Object.assign(order, data);
        settledWrites += 1;
        return { count: 1 };
      },
    },
  }));
  stub('../src/services/commission.service', { getRule: async () => ({}), ratesOn: async () => [] });
  stub('../src/services/whatsappNotify.service', { background: () => {} });
  notified.length = 0;
  const settlement = fresh('../src/services/settlement.service');
  const results = await Promise.allSettled([1, 2, 3].map(() => settlement.settle('stl1', { id: 'admin' })));
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  results.filter((r) => r.status === 'rejected').forEach((r) => assert.equal(r.reason.statusCode, 409));
  assert.equal(settledWrites, 1);
  await tick();
  assert.equal(notified.filter((n) => n.to === 'u-kp').length, 1, 'the rep is told once');
  assert.equal(notified.filter((n) => n.to === 'admins').length, 1);
});
