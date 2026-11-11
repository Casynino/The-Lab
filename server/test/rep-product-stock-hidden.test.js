'use strict';

// ── A rep never reads warehouse stock levels or other reps' boxes from the products API ──────────────
// rep-app-2 (audit 11 Nov 2026): GET /products gave a rep onHandBase, warehouseBase, lowStock, minStockLevel
// and reorderQuantity for every product, and GET /products/:id each warehouse's and each rep's box count.
// Sorting by purchasePrice was allowed too, so the order alone ranked the products by what they cost ZELab.
// Staff and the owner still get all of it.
// Run with: npm test

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://stub@localhost:1/none';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only';

const product = () => ({
  id: 'p1', name: 'OHIS Ndogo', sku: 'OH-1', sellingPrice: '30000', purchasePrice: '12000', isActive: true,
  minStockLevel: 50, reorderQuantity: 50, onHandBase: 225, warehouseBase: 174, lowStock: false, stockValue: 2700000,
  packagings: [{ id: 'k1', baseQuantity: 1, packagingUnit: { name: 'Box' } }],
  warehouseBalances: [{ warehouseId: 'w1', baseQuantity: 172 }],
  repBalances: [{ salesRepId: 'sr1', baseQuantity: 37 }, { salesRepId: 'sr2', baseQuantity: 5 }],
});
let seenPagination;
const install = (path, exports) => {
  const filename = require.resolve(path);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
};
install('../src/services/products.service', {
  listProducts: async (_filters, pagination) => { seenPagination = pagination; return { items: [product()], total: 1 }; },
  getProduct: async () => product(),
});
install('../src/services/audit.service', { record: async () => {} });

const ctrl = require('../src/controllers/products.controller');

const call = (handler, role, { query = {}, id = 'p1' } = {}) => new Promise((resolve, reject) => {
  const res = { status: () => res, json: (payload) => resolve(payload) };
  handler({ params: { id }, query, user: { id: 'u', role } }, res, (err) => (err ? reject(err) : resolve(null)));
});
const HIDDEN = ['onHandBase', 'warehouseBase', 'lowStock', 'minStockLevel', 'reorderQuantity', 'warehouseBalances', 'repBalances'];

test('a rep\'s product list has no stock levels and no costs; the catalogue itself is all there', async () => {
  const out = await call(ctrl.list, 'SALES_REP');
  const p = out.data[0];
  for (const k of HIDDEN) assert.equal(k in p, false, k);
  for (const k of ['purchasePrice', 'stockValue']) assert.equal(k in p, false, k);
  assert.equal(p.name, 'OHIS Ndogo');
  assert.equal(p.sellingPrice, '30000');
  assert.equal(p.packagings[0].packagingUnit.name, 'Box');
});

test('a rep\'s single product has no warehouse or rep balances', async () => {
  const out = await call(ctrl.get, 'SALES_REP');
  for (const k of HIDDEN) assert.equal(k in out.data, false, k);
  assert.equal(out.data.sku, 'OH-1');
});

test('a rep cannot sort the products by cost', async () => {
  await call(ctrl.list, 'SALES_REP', { query: { sortBy: 'purchasePrice', sortDir: 'asc' } });
  assert.deepEqual(seenPagination.orderBy, { name: 'asc' });
  await call(ctrl.list, 'SALES_REP', { query: { sortBy: 'sellingPrice', sortDir: 'asc' } });
  assert.deepEqual(seenPagination.orderBy, { sellingPrice: 'asc' });
});

test('the owner and warehouse staff still get stock, balances, costs and the cost sort', async () => {
  for (const role of ['ADMIN', 'WAREHOUSE_STAFF']) {
    const list = await call(ctrl.list, role, { query: { sortBy: 'purchasePrice', sortDir: 'asc' } });
    assert.deepEqual(seenPagination.orderBy, { purchasePrice: 'asc' }, role);
    assert.equal(list.data[0].warehouseBase, 174);
    assert.equal(list.data[0].purchasePrice, '12000');
    const one = await call(ctrl.get, role);
    assert.equal(one.data.repBalances.length, 2);
    assert.equal(one.data.warehouseBalances[0].baseQuantity, 172);
  }
});
