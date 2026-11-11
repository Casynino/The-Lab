'use strict';

// Submitting several products on one order in one go. Run with: npm test
//
// What these guard: the batch goes through the SAME per-line checks as a single
// submission (stock left, boxes already pending, the brand's own payment
// account), it saves ALL lines or NONE, a rep can never touch another rep's
// order, and the owner is told once — not once per product.

const test = require('node:test');
const assert = require('node:assert/strict');

// ── a tiny database with real transaction behaviour: rows only exist if the callback finishes ──
const db = { committed: [], pendingByProduct: {} };
const calls = { notify: [], waSingle: [], waBatch: [] };
const ORDER = { id: 'ord1', settlementNumber: 'STL-20261110-0001', status: 'OPEN', salesRepId: 'repA', salesRep: { user: { id: 'u1', name: 'Mrema' } } };
const PRODUCTS = {
  p1: { id: 'p1', name: 'OHIS Pepa Ndogo (White) – Bila Filter', sellingPrice: 30000, brandId: 'ohis' },
  p2: { id: 'p2', name: 'Civlily Pepa Kubwa (Brown) – Bila Filter', sellingPrice: 35000, brandId: 'civ' },
};
const OUTSTANDING = { p1: 5, p2: 2 };
const ACCOUNTS = { ohis: [{ id: 'mpesa', name: 'M-Pesa' }], civ: [{ id: 'airtel', name: 'Airtel Money' }] };

const prismaStub = {
  async $transaction(cb) {
    const staged = [];
    const tx = {
      settlement: { findUnique: async () => ORDER },
      product: { findUnique: async ({ where }) => PRODUCTS[where.id] || null },
      productPackaging: { findFirst: async ({ where }) => ({ productId: where.productId, packagingUnitId: 'box', isBaseUnit: true }) },
      settlementSubmission: {
        aggregate: async ({ where }) => ({ _sum: { boxes: db.pendingByProduct[where.productId] || 0 } }),
        count: async () => db.committed.length + staged.length,
        findMany: async () => [...db.committed, ...staged], // document numbers read today's numbers
        create: async ({ data }) => { const row = { id: `sub${db.committed.length + staged.length + 1}`, createdAt: new Date(), ...data }; staged.push(row); return row; },
      },
    };
    const result = await cb(tx); // throws -> nothing is committed
    db.committed.push(...staged);
    return result;
  },
};
const stub = (rel, exports) => { require.cache[require.resolve(rel)] = { id: rel, filename: rel, loaded: true, exports }; };
stub('../src/config/prisma', prismaStub);
stub('../src/services/inventory.service', { convertToBase: async (tx, pid, unit, qty) => ({ baseQuantity: qty }) });
stub('../src/services/settlement.service', {
  productOutstanding: async (tx, s, pid) => OUTSTANDING[pid],
  lockOrder: async () => {},
  pendingSubmissionBoxes: async () => new Map(Object.entries(db.pendingByProduct || {})),
  pendingReturnBoxes: async () => new Map(Object.entries(db.pendingReturnByProduct || {})),
});
stub('../src/services/finance.service', { paymentAccountsForBrand: async (brandId) => ACCOUNTS[brandId] || [] });
stub('../src/services/notification.service', { notifyAdmins: async (n) => { calls.notify.push(n); } });
stub('../src/services/whatsappNotify.service', {
  background: (p) => p,
  settlementSubmitted: async (a) => { calls.waSingle.push(a); },
  settlementSubmittedBatch: async (a) => { calls.waBatch.push(a); },
});

const svc = require('../src/services/settlementSubmission.service');
const rep = { id: 'u1', name: 'Mrema', salesRepId: 'repA' };
const reset = () => { db.committed.length = 0; db.pendingByProduct = {}; calls.notify.length = 0; calls.waSingle.length = 0; calls.waBatch.length = 0; };

test('two products: two PENDING submissions, one bell notice, one WhatsApp message', async () => {
  reset();
  const subs = await svc.submitMany('ord1', { items: [{ productId: 'p1', boxes: 2, accountId: 'mpesa' }, { productId: 'p2', boxes: 1, accountId: 'airtel' }] }, rep);
  assert.equal(subs.length, 2);
  assert.deepEqual(db.committed.map((s) => [s.productId, s.boxes, s.amount, s.status, s.method]), [
    ['p1', 2, 60000, 'PENDING', 'M-Pesa'],
    ['p2', 1, 35000, 'PENDING', 'Airtel Money'],
  ]);
  assert.notEqual(db.committed[0].submissionNumber, db.committed[1].submissionNumber, 'each line has its own number');
  assert.equal(calls.notify.length, 1);
  assert.match(calls.notify[0].message, /submitted 2 products \(3 box\(es\), TSh\s95,000\) on order STL-20261110-0001/);
  assert.equal(calls.waBatch.length, 1);
  assert.equal(calls.waSingle.length, 0, 'not one message per product');
});

test('one line that does not fit saves NONE of the others', async () => {
  reset();
  await assert.rejects(
    svc.submitMany('ord1', { items: [{ productId: 'p1', boxes: 1, accountId: 'mpesa' }, { productId: 'p2', boxes: 3, accountId: 'airtel' }] }, rep), // only 2 of p2 are outstanding
    /Only 2 box\(es\) of Civlily Pepa Kubwa/,
  );
  assert.equal(db.committed.length, 0, 'the first line was not kept');
  assert.equal(calls.notify.length + calls.waBatch.length, 0, 'and nobody was told');
});

test('boxes already waiting for approval cannot be submitted again in a batch', async () => {
  reset();
  db.pendingByProduct = { p1: 4 }; // 5 outstanding, 4 already pending -> 1 available
  await assert.rejects(svc.submitMany('ord1', { items: [{ productId: 'p1', boxes: 2, accountId: 'mpesa' }] }, rep), /Only 1 box\(es\)/);
  assert.equal(db.committed.length, 0);
});

test('boxes locked in a pending return cannot also be submitted for settlement (audit, 11 Nov 2026)', async () => {
  reset();
  db.pendingReturnByProduct = { p1: 3 }; // 5 outstanding, 3 in a return waiting for ZELab -> 2 available
  await assert.rejects(svc.submitMany('ord1', { items: [{ productId: 'p1', boxes: 3, accountId: 'mpesa' }] }, rep), /Only 2 box\(es\).*return waiting/);
  assert.equal(db.committed.length, 0);
  db.pendingReturnByProduct = {};
});

test('a product must be paid to its own brand\'s account', async () => {
  reset();
  await assert.rejects(
    svc.submitMany('ord1', { items: [{ productId: 'p1', boxes: 1, accountId: 'airtel' }] }, rep), // OHIS settles to M-Pesa
    /settles to M-Pesa/,
  );
  assert.equal(db.committed.length, 0);
});

test('the same product twice, nothing chosen, or too many lines are refused before anything is saved', async () => {
  reset();
  await assert.rejects(svc.submitMany('ord1', { items: [{ productId: 'p1', boxes: 1 }, { productId: 'p1', boxes: 1 }] }, rep), /once/);
  await assert.rejects(svc.submitMany('ord1', { items: [] }, rep), /at least one/);
  await assert.rejects(svc.submitMany('ord1', {}, rep), /at least one/);
  await assert.rejects(svc.submitMany('ord1', { items: Array.from({ length: 21 }, (_, i) => ({ productId: `p${i}`, boxes: 1 })) }, rep), /at most 20/);
  await assert.rejects(svc.submitMany('ord1', { items: [{ productId: 'p1', boxes: 0 }] }, rep), /positive whole number/);
  assert.equal(db.committed.length, 0);
});

test('a rep cannot submit on another rep\'s order', async () => {
  reset();
  await assert.rejects(svc.submitMany('ord1', { items: [{ productId: 'p1', boxes: 1, accountId: 'mpesa' }] }, { id: 'u9', salesRepId: 'someoneElse' }), /not yours/);
  assert.equal(db.committed.length, 0);
});

test('one product through submitMany behaves like the single submit: one row, the single-product message', async () => {
  reset();
  await svc.submitMany('ord1', { items: [{ productId: 'p1', boxes: 1, accountId: 'mpesa' }] }, rep);
  assert.equal(db.committed.length, 1);
  assert.equal(calls.waSingle.length, 1);
  assert.equal(calls.waBatch.length, 0);
});

test('the original single submit still works the same way', async () => {
  reset();
  const sub = await svc.submit('ord1', { productId: 'p2', boxes: 2, accountId: 'airtel' }, rep);
  assert.equal(sub.boxes, 2);
  assert.equal(sub.amount, 70000);
  assert.equal(calls.waSingle.length, 1);
  await assert.rejects(svc.submit('ord1', { productId: 'p2', boxes: 3, accountId: 'airtel' }, rep), /Only 2 box/);
});

test('no account sent: the brand\'s one account is used, and a typed method ("CASH") is never stored (audit, 11 Nov 2026)', async () => {
  reset();
  const sub = await svc.submit('ord1', { productId: 'p2', boxes: 1, method: 'CASH' }, rep);
  assert.equal(sub.method, 'Airtel Money', 'the owner reads where the money is booked');
  assert.equal(sub.accountId, 'airtel');
  const [line] = await svc.submitMany('ord1', { items: [{ productId: 'p1', boxes: 1, method: 'CASH' }] }, rep);
  assert.deepEqual([line.method, line.accountId], ['M-Pesa', 'mpesa']);
});

test('no account sent where there is a choice, or no account at all: refused, nothing saved', async () => {
  reset();
  PRODUCTS.p3 = { id: 'p3', name: 'Unbranded box', sellingPrice: 10000, brandId: 'two' };
  OUTSTANDING.p3 = 3;
  ACCOUNTS.two = [{ id: 'a1', name: 'M-Pesa' }, { id: 'a2', name: 'Airtel Money' }];
  await assert.rejects(svc.submit('ord1', { productId: 'p3', boxes: 1, method: 'CASH' }, rep), /Select a valid payment account/);
  const sub = await svc.submit('ord1', { productId: 'p3', boxes: 1, accountId: 'a2' }, rep);
  assert.equal(sub.method, 'Airtel Money', 'a chosen account still works');
  ACCOUNTS.two = [];
  await assert.rejects(svc.submit('ord1', { productId: 'p3', boxes: 1 }, rep), /Select a valid payment account/);
  assert.equal(db.committed.length, 1);
  delete PRODUCTS.p3; delete OUTSTANDING.p3; delete ACCOUNTS.two;
});
