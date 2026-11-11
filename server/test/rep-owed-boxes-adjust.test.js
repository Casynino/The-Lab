'use strict';

// ── An Inventory decrease or damage at a rep's place cannot take boxes an open order still owes ──────
// (audit #23 part b, 11 Nov 2026). Either entry took the boxes off the rep while his order went on owing
// them and drawing fines. Pinned: it is refused, naming the order and pointing to a Return; boxes he holds
// beyond what his orders owe can still be taken off; a warehouse entry and an increase are untouched.

const test = require('node:test');
const assert = require('node:assert/strict');

const install = (path, exports) => {
  const filename = require.resolve(path);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
};

const state = { held: 10, owedOn: { o1: 6 }, moved: [] };
const tx = {
  settlement: {
    findMany: async ({ where }) => (where.salesRepId === 'rep1'
      ? [{ id: 'o1', settlementNumber: 'STL-1', salesRepId: 'rep1', status: 'OPEN' }]
      : []),
  },
  product: { findUnique: async () => ({ name: 'Pepa', purchasePrice: 1000 }) },
};
install('../src/config/prisma', { $transaction: async (fn) => fn(tx) });
install('../src/services/audit.service', { record: async () => {} });
install('../src/services/settlement.service', { productOutstanding: async (_c, stl) => state.owedOn[stl.id] || 0 });
install('../src/services/inventory.service', {
  LOCATION: { WAREHOUSE: 'WAREHOUSE', SALES_REP: 'SALES_REP' },
  convertToBase: async (_c, _p, _u, quantity) => ({ baseQuantity: quantity }),
  getBalance: async () => state.held,
  increaseStock: async (_c, o) => { state.moved.push({ dir: 'in', ...o }); return { id: 'm1' }; },
  decreaseStock: async (_c, o) => { state.moved.push({ dir: 'out', ...o }); return { id: 'm2' }; },
});

const ctrl = require('../src/controllers/inventory.controller');

// Run an Express handler and hand back what it answered, or the error it raised.
function call(handler, body) {
  return new Promise((resolve) => {
    const res = { status() { return this; }, json: (payload) => resolve({ ok: payload }) };
    handler({ body, user: { id: 'admin' } }, res, (err) => resolve({ err }));
  });
}
const repPlace = { type: 'SALES_REP', salesRepId: 'rep1' };
const base = { productId: 'p1', packagingUnitId: 'u1', reason: 'count' };

test('a decrease at a rep\'s place that would take owed boxes is refused, naming the order', async () => {
  state.moved.length = 0;
  const { err } = await call(ctrl.adjust, { ...base, location: repPlace, quantity: 5, direction: 'DECREASE' });
  assert.equal(err?.statusCode, 400);
  assert.match(err.message, /6 box\(es\) of Pepa are still owed on order STL-1/);
  assert.match(err.message, /Return on that order/);
  assert.match(err.message, /Only 4 box\(es\) can be taken off this way/);
  assert.equal(state.moved.length, 0, 'nothing left the rep');
});

test('a damage entry at a rep\'s place is held to the same rule', async () => {
  state.moved.length = 0;
  const { err } = await call(ctrl.damage, { ...base, location: repPlace, quantity: 7 });
  assert.equal(err?.statusCode, 400);
  assert.match(err.message, /still owed on order STL-1/);
  assert.equal(state.moved.length, 0);
});

test('boxes beyond what the orders owe can still be taken off', async () => {
  state.moved.length = 0;
  const { ok, err } = await call(ctrl.damage, { ...base, location: repPlace, quantity: 4 });
  assert.equal(err, undefined);
  assert.ok(ok);
  assert.equal(state.moved.length, 1);
  assert.equal(state.moved[0].type, 'DAMAGE');
});

test('when every box he holds is owed, the message does not offer any', async () => {
  state.moved.length = 0;
  state.held = 6;
  const { err } = await call(ctrl.adjust, { ...base, location: repPlace, quantity: 1, direction: 'DECREASE' });
  state.held = 10;
  assert.equal(err?.statusCode, 400);
  assert.doesNotMatch(err.message, /Only/);
});

test('an increase at a rep\'s place, and any warehouse entry, are not affected', async () => {
  state.moved.length = 0;
  const up = await call(ctrl.adjust, { ...base, location: repPlace, quantity: 50, direction: 'INCREASE' });
  assert.ok(up.ok);
  const wh = await call(ctrl.damage, { ...base, location: { type: 'WAREHOUSE', warehouseId: 'w1' }, quantity: 50 });
  assert.ok(wh.ok);
  assert.equal(state.moved.length, 2);
});

test('a rep with no open order owing the product can be adjusted freely', async () => {
  state.moved.length = 0;
  const { ok } = await call(ctrl.adjust, { ...base, location: { type: 'SALES_REP', salesRepId: 'rep2' }, quantity: 9, direction: 'DECREASE' });
  assert.ok(ok);
  assert.equal(state.moved.length, 1);
});
