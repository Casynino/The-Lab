'use strict';

// ── A purchase is received once, and a sale is cancelled once (audit #40, #41 — 11 Nov 2026) ─────────
// Two clicks on Receive both brought the stock in; two clicks on Cancel sale both put the stock back.
// And an edit could mark a purchase RECEIVED with no stock ever received. Pinned here.

const test = require('node:test');
const assert = require('node:assert/strict');

const stub = (rel, exports) => { const f = require.resolve(rel); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };
const tick = () => new Promise((r) => setImmediate(r));

function loadPurchase() {
  const po = { id: 'po1', poNumber: 'PO-1', status: 'ORDERED', warehouseId: 'w1', shippingCost: 0, clearingCost: 0, otherCost: 0,
    items: [{ id: 'i1', productId: 'p1', packagingUnitId: 'box', quantity: 10, baseQuantity: 10, unitCost: 1000 }] };
  const moved = { stockIn: 0 };
  const tx = {
    purchaseOrder: {
      findUnique: async () => ({ ...po, items: po.items }),
      updateMany: async ({ where, data }) => { await tick(); if (where.status.notIn.includes(po.status)) return { count: 0 }; Object.assign(po, data); return { count: 1 }; },
      update: async ({ data }) => Object.assign(po, data),
    },
    purchaseOrderItem: { update: async () => ({}) },
    product: { update: async () => ({}) },
    warehouse: { findFirst: async () => ({ id: 'w1' }) },
  };
  stub('../src/config/prisma', { $transaction: async (fn) => fn(tx), purchaseOrder: { findUnique: async () => ({ ...po }) } });
  stub('../src/services/inventory.service', { increaseStock: async () => { moved.stockIn += 1; }, LOCATION: { WAREHOUSE: 'WAREHOUSE' } });
  delete require.cache[require.resolve('../src/services/purchase.service')];
  return { svc: require('../src/services/purchase.service'), po, moved };
}

test('two Receive clicks at once: the stock comes in once, the second is told it was received', async () => {
  const { svc, po, moved } = loadPurchase();
  const r = await Promise.allSettled([svc.receivePurchaseOrder('po1', { id: 'a' }), svc.receivePurchaseOrder('po1', { id: 'a' })]);
  assert.equal(r.filter((x) => x.status === 'fulfilled').length, 1);
  assert.equal(r.find((x) => x.status === 'rejected').reason.statusCode, 409);
  assert.equal(moved.stockIn, 1);
  assert.equal(po.status, 'RECEIVED');
});

test('an edit cannot mark a purchase RECEIVED (only Receive brings stock in)', async () => {
  const { svc, po } = loadPurchase();
  await assert.rejects(svc.updatePurchaseOrder('po1', { status: 'RECEIVED' }), (e) => e.statusCode === 400);
  assert.equal(po.status, 'ORDERED');
});

test('two Cancel clicks on one sale: the stock goes back once', async () => {
  const sale = { id: 's1', saleNumber: 'SALE-1', status: 'PAID', warehouseId: 'w1', salesRepId: null, settlementId: null, total: 30000, notes: null,
    items: [{ productId: 'p1', packagingUnitId: 'box', quantity: 1, baseQuantity: 1, unitCost: 20000 }], creditSale: null };
  const moved = { stockBack: 0 };
  const tx = {
    sale: {
      findUnique: async () => ({ ...sale }),
      updateMany: async ({ where, data }) => { await tick(); if (sale.status === 'CANCELLED') return { count: 0 }; Object.assign(sale, data); return { count: 1 }; },
      update: async ({ data }) => Object.assign(sale, data),
    },
    financeTransaction: { deleteMany: async () => ({ count: 1 }) },
  };
  stub('../src/config/prisma', { $transaction: async (fn) => fn(tx) });
  stub('../src/services/inventory.service', { increaseStock: async () => { moved.stockBack += 1; }, LOCATION: { WAREHOUSE: 'WAREHOUSE', REP: 'REP' } });
  delete require.cache[require.resolve('../src/services/sales.service')];
  const svc = require('../src/services/sales.service');
  const r = await Promise.allSettled([svc.cancelSale('s1', { id: 'a' }), svc.cancelSale('s1', { id: 'a' })]);
  assert.equal(r.filter((x) => x.status === 'fulfilled').length, 1);
  assert.equal(moved.stockBack, 1);
  assert.equal(sale.status, 'CANCELLED');
});
