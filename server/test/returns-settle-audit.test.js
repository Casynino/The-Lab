'use strict';

// Returns and settle checks found in the 11 Nov 2026 audit. Run with: npm test
//
// What these guard:
// - an order-linked return that lists the same product twice is checked on the TOTAL, so it can never lock
//   boxes the rep does not have;
// - a rep notice that carries a WhatsApp `dedupeSalt` (taking "More time", ZELab undoing a deadline change)
//   is saved in the bell AND sent on WhatsApp — the salt never reaches the database row;
// - GET /returns can be filtered by every return status.

const test = require('node:test');
const assert = require('node:assert/strict');

// ── a tiny database: one order of 2 boxes of p1, nothing settled, returned or pending ──
const created = { returns: [], notifications: [] };
const ORDER = { id: 'ord1', status: 'OPEN', transferId: 'tr1', salesRepId: 'repA', settlementNumber: 'STL-20261107-0001' };
const tx = {
  product: { findMany: async ({ where }) => where.id.in.filter((id) => id === 'p1').map((id) => ({ id, name: 'Civlily Pepa Kubwa (Brown) – Na Filter', sellingPrice: 35000, purchasePrice: 20000 })) },
  settlement: { findUnique: async () => ORDER },
  stockTransfer: { findUnique: async () => ({ id: 'tr1', items: [{ productId: 'p1', baseQuantity: 2 }] }) },
  saleItem: { groupBy: async () => [] },
  returnItem: { groupBy: async () => [] },
  return: {
    findMany: async () => [],
    create: async ({ data }) => { const row = { id: `ret${created.returns.length + 1}`, ...data, items: data.items.create }; created.returns.push(row); return row; },
  },
};
const prismaStub = {
  $transaction: async (cb) => cb(tx),
  notification: { create: async ({ data }) => { created.notifications.push(data); return { id: 'n1', ...data }; } },
};
const mirrored = [];
const stub = (rel, exports) => { require.cache[require.resolve(rel)] = { id: rel, filename: rel, loaded: true, exports }; };
stub('../src/config/prisma', prismaStub);
stub('../src/services/inventory.service', { convertToBase: async (_tx, _pid, _unit, qty) => ({ baseQuantity: qty }) });
stub('../src/services/settlement.service', { lockOrder: async () => {}, pendingSubmissionBoxes: async () => new Map() });
stub('../src/services/whatsappNotify.service', {
  background: (p) => p,
  returnSubmitted: async () => {},
  mirrorToRep: async (userId, data) => { mirrored.push({ userId, data }); },
});

const returns = require('../src/services/returns.service');
const notification = require('../src/services/notification.service');
const { returnQuery } = require('../src/validators/inventory.validator');

const rep = { id: 'u1', name: 'KP', salesRepId: 'repA' };
const ret = (items) => ({ type: 'SALES_RETURN', salesRepId: 'repA', settlementId: 'ord1', warehouseId: 'wh1', items });

test('the same product listed twice on an order return is checked on the total', async () => {
  created.returns.length = 0;
  await assert.rejects(
    returns.createReturn(ret([{ productId: 'p1', packagingUnitId: 'box', quantity: 2 }, { productId: 'p1', packagingUnitId: 'box', quantity: 2 }]), rep),
    /Only 2 box\(es\) of Civlily Pepa Kubwa .* remain to return on order STL-20261107-0001/,
  );
  await assert.rejects(returns.createReturn(ret([{ productId: 'p1', packagingUnitId: 'box', quantity: 4 }]), rep), /Only 2 box\(es\)/);
  assert.equal(created.returns.length, 0, 'no return was saved, so no boxes are locked');
});

test('lines that together fit what is left still go through', async () => {
  created.returns.length = 0;
  await returns.createReturn(ret([{ productId: 'p1', packagingUnitId: 'box', quantity: 1 }, { productId: 'p1', packagingUnitId: 'box', quantity: 1 }]), rep);
  assert.equal(created.returns.length, 1);
  assert.equal(created.returns[0].items.reduce((n, i) => n + i.baseQuantity, 0), 2);
});

// The over-the-open-orders refusal speaks to whoever sent it (audit, 12 Nov 2026): the rep is "you",
// ZELab staff returning for him are not, and one box is never "box(es)".
test('the over-return refusal addresses the rep as you and staff as staff', () => {
  const name = 'OHIS Ndogo (Brown) – Bila Filter';
  const mine = returns.overReturnMessage(name, 1, rep, 'repA');
  assert.match(mine, /only 1 box is still unaccounted on your open orders — you can't return more than that\./);
  const staff = { id: 'admin1', name: 'Nino', salesRepId: null };
  const theirs = returns.overReturnMessage(name, 0, staff, 'repA');
  assert.match(theirs, /only 0 boxes are still unaccounted on the rep's open orders — no more than that can be returned\./);
  assert.doesNotMatch(theirs, /\byour?\b/i);
  // another rep's login is not "you" for this rep's orders either
  assert.match(returns.overReturnMessage(name, 3, { id: 'u9', salesRepId: 'repB' }, 'repA'), /3 boxes are still unaccounted on the rep's/);
});

test('a rep notice with a WhatsApp dedupeSalt is saved without it and still mirrored with it', async () => {
  created.notifications.length = 0;
  mirrored.length = 0;
  await notification.notifyUser('u1', { type: 'GENERAL', severity: 'INFO', title: 'Deadline extended', message: 'You activated the 96-hour extension', dedupeSalt: '1762754037000', whatsapp: { kind: 'x' } });
  assert.equal(created.notifications.length, 1, 'the bell notice is saved');
  assert.equal('dedupeSalt' in created.notifications[0], false, 'not a column — Prisma refused the whole row');
  assert.equal('whatsapp' in created.notifications[0], false);
  assert.equal(created.notifications[0].userId, 'u1');
  assert.equal(mirrored.length, 1, 'and the WhatsApp is sent');
  assert.equal(mirrored[0].data.dedupeSalt, '1762754037000', 'the duplicate guard keeps its salt');
});

test('GET /returns accepts every return status as a filter', () => {
  for (const status of ['PENDING', 'APPROVED', 'REJECTED', 'COMPLETED', 'CANCELLED', 'EXPIRED']) {
    assert.equal(returnQuery.query.safeParse({ status }).success, true, status);
  }
  assert.equal(returnQuery.query.safeParse({ status: 'NOPE' }).success, false);
});
