'use strict';

// ── When a return closes without moving boxes, the order is told the truth ───────────────────────────
// #98: a rejected, cancelled or expired return gives its waiting hours back to the order. When that moved
//      the deadline ahead again, an order STORED as Overdue stayed Overdue: it showed overdue and the rep
//      could not take his own extension. Pinned: it goes back to Open (or Partial), as an admin extension
//      does; still past its deadline, it stays Overdue.
// #128: an expiry that charged no fine told the rep a "TSh 0 fine" was applied. Pinned: no fine, no figure.

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
install('../src/services/settlement.service', { lockOrder: async () => {} });
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
