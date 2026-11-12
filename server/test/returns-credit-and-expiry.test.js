'use strict';

// ── When a return closes without moving boxes, the order is told the truth ───────────────────────────
// #98: a rejected, cancelled or expired return gives its waiting hours back to the order. When that moved
//      the deadline ahead again, an order STORED as Overdue stayed Overdue: it showed overdue and the rep
//      could not take his own extension. Pinned: it goes back to Open (or Partial), as an admin extension
//      does; still past its deadline, it stays Overdue.
// #128: an expiry that charged no fine told the rep a "TSh 0 fine" was applied. Pinned: no fine, no figure.
// #67: a return from the order screen failed "Validation failed" when the product was switched off (the
//      screen could not look up its packaging). Pinned: with no unit sent, the product's box is used.

const test = require('node:test');
const assert = require('node:assert/strict');

const HOUR = 3_600_000;
const ago = (h) => new Date(Date.now() - h * HOUR);

let stl = null;
let ret = null;
const notices = [];
const fines = [];

const tx = {
  return: {
    updateMany: async ({ where, data }) => {
      if (ret.status !== where.status) return { count: 0 };
      Object.assign(ret, data);
      return { count: 1 };
    },
    findUnique: async () => ({ ...ret }),
  },
  settlement: {
    findUnique: async () => (stl ? { ...stl } : null),
    update: async ({ data }) => { Object.assign(stl, data); return { ...stl }; },
  },
  settlementPenalty: { create: async ({ data }) => { fines.push(data); return data; } },
};
// What a new return reads and writes (#67).
const created = [];
Object.assign(tx, {
  product: { findMany: async () => [{ id: 'p1', name: 'Pepa', isActive: false, sellingPrice: 2500, purchasePrice: 1000 }] },
  productPackaging: {
    findFirst: async ({ where }) => (where.isBaseUnit ? { packagingUnitId: 'box' } : null),
    findUnique: async ({ where }) => (where.productId_packagingUnitId.packagingUnitId === 'box' ? { isActive: true, baseQuantity: 1 } : null),
  },
  stockTransfer: { findUnique: async () => ({ items: [{ productId: 'p1', baseQuantity: 5 }] }) },
  saleItem: { groupBy: async () => [] },
  returnItem: { groupBy: async () => [] },
});
tx.return.findMany = async () => [];
tx.return.create = async ({ data }) => { created.push(data); return { id: 'r9', ...data, items: data.items.create }; };
const prismaStub = {
  ...tx,
  return: { ...tx.return, findUnique: async () => ({ ...ret }), findMany: async () => (ret.status === 'PENDING' ? [{ ...ret }] : []) },
  $transaction: async (fn) => fn(tx),
};
const install = (path, exports) => {
  const filename = require.resolve(path);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
};
install('../src/config/prisma', prismaStub);
install('../src/services/settlement.service', { lockOrder: async () => {}, pendingSubmissionBoxes: async () => new Map() });
install('../src/services/whatsappNotify.service', { background: () => {}, returnSubmitted: async () => {} });
install('../src/services/notification.service', {
  notifyUser: async (userId, data) => { notices.push({ userId, ...data }); },
  notifyAdmins: async () => {},
});
install('../src/services/penalty.service', { returnFailureRateFor: () => 15000 });

const returns = require('../src/services/returns.service');

const order = (over = {}) => ({ id: 'o1', settlementNumber: 'STL-1', status: 'OVERDUE', deadlineAt: ago(1), penaltyFrom: null, selfExtendedAt: null, settledValue: 0, returnedValue: 0, ...over });
const pendingReturn = (over = {}) => ({
  id: 'r1', returnNumber: 'RET-1', type: 'SALES_RETURN', status: 'PENDING', settlementId: 'o1', salesRepId: 'rep1',
  processedAt: ago(5), items: [{ quantity: 2 }], salesRep: { user: { id: 'u1', name: 'Paul' } }, ...over,
});

test.beforeEach(() => { notices.length = 0; fines.length = 0; });

test('a rejected return that puts the deadline ahead again brings an Overdue order back to Open', async () => {
  stl = order();
  ret = pendingReturn();
  await returns.rejectReturn('r1', { id: 'admin' }, 'wrong boxes');
  assert.ok(new Date(stl.deadlineAt) > new Date(), 'the five waiting hours were given back');
  assert.equal(stl.status, 'OPEN');
});

test('an order with money already settled comes back as Partial', async () => {
  stl = order({ settledValue: 25000 });
  ret = pendingReturn();
  await returns.cancelReturn('r1', { id: 'u1', salesRepId: 'rep1' }, { asRep: true });
  assert.equal(stl.status, 'PARTIAL');
});

test('when the hours given back still leave the deadline behind, the order stays Overdue', async () => {
  stl = order({ deadlineAt: ago(10) });
  ret = pendingReturn({ processedAt: ago(3) });
  await returns.rejectReturn('r1', { id: 'admin' });
  assert.ok(new Date(stl.deadlineAt) < new Date());
  assert.equal(stl.status, 'OVERDUE');
});

test('an order that was Open is left Open (nothing else changes)', async () => {
  stl = order({ status: 'OPEN', deadlineAt: new Date(Date.now() + 20 * HOUR) });
  ret = pendingReturn();
  await returns.rejectReturn('r1', { id: 'admin' });
  assert.equal(stl.status, 'OPEN');
});

test('an expiry that charges a fine names it', async () => {
  stl = order({ status: 'OPEN', deadlineAt: new Date(Date.now() + 20 * HOUR) });
  ret = pendingReturn({ processedAt: ago(25) });
  await returns.expireStaleReturns();
  assert.equal(fines.length, 1);
  const n = notices.find((x) => x.userId === 'u1');
  assert.equal(n.title, 'Return RET-1 expired — TSh 15,000 fine');
  assert.match(n.message, /a TSh 15,000 delay fine was applied/);
});

test('an expiry that charges no fine does not say "TSh 0 fine"', async () => {
  stl = order({ status: 'SETTLED' }); // the order closed meanwhile: no fine is charged
  ret = pendingReturn({ processedAt: ago(25) });
  await returns.expireStaleReturns();
  assert.equal(fines.length, 0);
  const n = notices.find((x) => x.userId === 'u1');
  assert.equal(n.title, 'Return RET-1 expired');
  assert.doesNotMatch(n.title + n.message, /TSh 0/);
  assert.match(n.message, /cancelled automatically\. The boxes are back on your order/);
});

test('a return on an order with no unit sent uses the product\'s box, even for a switched-off product', async () => {
  created.length = 0;
  stl = { id: 'o1', settlementNumber: 'STL-1', status: 'OPEN', transferId: 't1', salesRepId: 'rep1' };
  const out = await returns.createReturn(
    { type: 'SALES_RETURN', salesRepId: 'rep1', warehouseId: 'w1', settlementId: 'o1', items: [{ productId: 'p1', quantity: 2 }] },
    { id: 'u1', salesRepId: 'rep1' },
  );
  assert.equal(created.length, 1);
  assert.deepEqual(created[0].items.create.map((i) => [i.packagingUnitId, i.quantity, i.baseQuantity]), [['box', 2, 2]]);
  assert.equal(out.settlementId, 'o1');
});

test('the request the order screen sends without a unit passes the input check', () => {
  const { returnCreate } = require('../src/validators/inventory.validator');
  const body = { type: 'SALES_RETURN', salesRepId: 'rep1', warehouseId: 'w1', settlementId: 'o1', items: [{ productId: 'p1', quantity: 2 }], reason: 'Return on order STL-1' };
  assert.equal(returnCreate.body.safeParse(body).success, true);
  assert.equal(returnCreate.body.safeParse({ ...body, items: [{ productId: 'p1', packagingUnitId: 'box', quantity: 2 }] }).success, true);
  assert.equal(returnCreate.body.safeParse({ ...body, items: [{ productId: 'p1', quantity: 0 }] }).success, false);
});

// backend-integrity-6 (audit 11 Nov 2026): returning more boxes than a rep's open orders hold was refused
// with "your open orders" even when the owner sent it for the rep. The rep still reads "your"; staff read
// the rep's name.
test('too many boxes back: the rep reads "your open orders", staff read the rep\'s name', async () => {
  created.length = 0;
  stl = { id: 'o1', settlementNumber: 'STL-1', status: 'OPEN', transferId: 't1', salesRepId: 'rep1' };
  tx.settlement.findMany = async () => [{ id: 'o1', settlementNumber: 'STL-1', transferId: 't1' }];
  tx.salesRepresentative = { findUnique: async () => ({ code: 'REP-001', user: { name: 'Paul' } }) };
  const body = { type: 'SALES_RETURN', salesRepId: 'rep1', warehouseId: 'w1', items: [{ productId: 'p1', quantity: 9 }] };
  await assert.rejects(
    returns.createReturn(body, { id: 'u1', role: 'SALES_REP', salesRepId: 'rep1' }),
    (e) => e.statusCode === 400 && /^Pepa: only 5 boxes are still unaccounted on your open orders/.test(e.message),
  );
  await assert.rejects(
    returns.createReturn(body, { id: 'owner', role: 'ADMIN', salesRepId: null }),
    (e) => e.statusCode === 400 && /^Pepa: Paul has only 5 boxes still unaccounted on his open orders/.test(e.message)
      && !/your/.test(e.message),
  );
  assert.equal(created.length, 0, 'nothing is written either way');
});
