'use strict';

// ── Stock bought with the cash in the drawer is not a debt ───────────────────
// A purchase could only ever be recorded as money owed: the form said so out
// loud — "No money moves now — pay later" — and the only way to show it had
// been paid was a separate payment afterwards, dated whenever somebody got
// round to it. So 3,300,000 of stock that was paid for in cash in September
// sat under "owed to suppliers", and would have taken its money out of
// October's books when it was finally cleared.
//
// A purchase may now carry its own payment. These tests hold the two things
// that make that safe: the money is written in the SAME transaction as the
// purchase, and it is dated the day of the purchase rather than today.

const test = require('node:test');
const assert = require('node:assert');

let tables;
let txCalls;

const model = (name) => ({
  create: async ({ data }) => {
    const row = { id: `${name}-${tables[name].length + 1}`, ...data };
    tables[name].push(row);
    txCalls.push(`${name}.create`);
    return row;
  },
  findUnique: async ({ where }) => tables[name].find((r) => r.id === where.id) || null,
  count: async () => tables[name].length,
});

const tx = {
  purchaseOrder: model('purchaseOrder'),
  financeTransaction: model('financeTransaction'),
  supplier: { findUnique: async () => ({ name: 'OHIS yiwu', brandId: 'brand-ohis' }) },
  businessAccount: { findUnique: async () => ({ id: 'acct-1', isActive: true, type: 'CASH' }) },
};

const prismaStub = {
  $transaction: async (work) => work(tx),
  // The finance service reads these at module load through its own handle.
  businessAccount: tx.businessAccount,
  financeTransaction: tx.financeTransaction,
};

const install = (path, exports) => {
  const filename = require.resolve(path);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
};
install('../src/config/prisma', prismaStub);
install('../src/services/inventory.service', {
  convertToBase: async (_c, _p, _u, quantity) => ({ baseQuantity: quantity }),
});

const purchase = require('../src/services/purchase.service');

const payload = (over = {}) => ({
  supplierId: 'sup-1',
  orderedAt: '2026-09-26T12:00:00.000Z',
  items: [{ productId: 'p1', packagingUnitId: 'u1', quantity: 50, unitCost: 14_000 }],
  ...over,
});

test.beforeEach(() => {
  tables = { purchaseOrder: [], financeTransaction: [] };
  txCalls = [];
});

const money = () => tables.financeTransaction[0];

test('a purchase with no payment is money owed, exactly as before', async () => {
  await purchase.createPurchaseOrder(payload(), { id: 'admin-1' });
  assert.equal(tables.financeTransaction.length, 0);
});

test('paid in full: the money leaves on the day of the purchase, not today', async () => {
  await purchase.createPurchaseOrder(
    payload({ payment: { accountId: 'acct-1' } }), // no amount: the whole bill
    { id: 'admin-1' },
  );

  const t = money();
  assert.ok(t, 'a payment was recorded');
  assert.equal(t.amount, 700_000);              // 50 boxes x 14,000
  assert.equal(t.direction, 'OUT');
  assert.equal(t.type, 'STOCK_PURCHASE');
  assert.equal(t.refType, 'PurchaseOrder');
  assert.equal(t.refId, tables.purchaseOrder[0].id); // so the PO shows as settled
  assert.equal(t.brandId, 'brand-ohis');             // the brand whose stock it is
  assert.equal(new Date(t.occurredAt).toISOString().slice(0, 10), '2026-09-26');
});

test('the payment is written inside the purchase\'s own transaction', async () => {
  // Not two round trips: a purchase that saved while its payment did not is
  // the debt this feature exists to stop creating.
  await purchase.createPurchaseOrder(payload({ payment: { accountId: 'acct-1' } }), { id: 'admin-1' });
  assert.deepEqual(txCalls, ['purchaseOrder.create', 'financeTransaction.create']);
});

test('part payment leaves the rest owed', async () => {
  await purchase.createPurchaseOrder(
    payload({ payment: { accountId: 'acct-1', amount: 300_000 } }),
    { id: 'admin-1' },
  );
  assert.equal(money().amount, 300_000);
  assert.equal(tables.purchaseOrder[0].totalCost, 700_000); // the rest stands as owed
});

test('shipping and the other costs are part of what was paid', async () => {
  await purchase.createPurchaseOrder(
    payload({ shippingCost: 50_000, otherCost: 25_000, payment: { accountId: 'acct-1' } }),
    { id: 'admin-1' },
  );
  assert.equal(money().amount, 775_000);
});

test('paying more than the purchase cost is refused, and nothing is written', async () => {
  await assert.rejects(
    () => purchase.createPurchaseOrder(
      payload({ payment: { accountId: 'acct-1', amount: 900_000 } }),
      { id: 'admin-1' },
    ),
    (e) => /more than it cost/i.test(e.message),
  );
  // The throw is inside the transaction, so the order goes with it.
  assert.equal(tables.financeTransaction.length, 0);
});

test('a payment of nothing is not a payment', async () => {
  await purchase.createPurchaseOrder(payload({ payment: { accountId: 'acct-1', amount: 0 } }), { id: 'admin-1' });
  assert.equal(tables.financeTransaction.length, 0);
});
