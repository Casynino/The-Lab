'use strict';

// ── Which region a sale is filed under ───────────────────────────────────────
// The regional report is only as honest as the region written on each sale.
// Owner, 10 Nov 2026: what the admin sells straight out of the warehouse is
// Dar es Salaam's ("it used to show as Unassigned"). The order is: what the
// caller said, then the customer's, then the rep's; with none of those and no
// rep it is a warehouse sale and takes the warehouse's region, Dar es Salaam by
// default. A REP's sale whose rep has no region stays blank — genuinely
// unknown, and not the warehouse's to claim.

const test = require('node:test');
const assert = require('node:assert');

const install = (path, exports) => {
  const filename = require.resolve(path);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
};
install('../src/config/prisma', {});
install('../src/config/env', {});
install('../src/services/inventory.service', {});

const { resolveSaleRegion } = require('../src/services/sales.service');

// A stand-in for the database: customers, reps and warehouses by id.
const tx = ({ customers = {}, reps = {}, warehouses = {} } = {}) => ({
  customer: { findUnique: async ({ where }) => (customers[where.id] ? { region: customers[where.id] } : null) },
  salesRepresentative: { findUnique: async ({ where }) => (reps[where.id] !== undefined ? { region: reps[where.id] } : null) },
  warehouse: { findUnique: async ({ where }) => (warehouses[where.id] !== undefined ? { region: warehouses[where.id] } : null) },
});

test('what the caller said wins over everything', async () => {
  const r = await resolveSaleRegion(tx({ customers: { c1: 'Mbeya' }, reps: { r1: 'Arusha' } }), { region: 'Tanga', customerId: 'c1', salesRepId: 'r1' });
  assert.strictEqual(r, 'Tanga');
});

test('then the customer\'s, then the rep\'s', async () => {
  const db = tx({ customers: { c1: 'Mbeya' }, reps: { r1: 'Arusha' } });
  assert.strictEqual(await resolveSaleRegion(db, { customerId: 'c1', salesRepId: 'r1' }), 'Mbeya');
  assert.strictEqual(await resolveSaleRegion(db, { salesRepId: 'r1' }), 'Arusha');
});

test('a direct sale (no rep) from a warehouse with no region is Dar es Salaam', async () => {
  const db = tx({ warehouses: { w1: null } });
  assert.strictEqual(await resolveSaleRegion(db, { warehouseId: 'w1' }), 'Dar es Salaam');
  assert.strictEqual(await resolveSaleRegion(db, {}), 'Dar es Salaam', 'even with no warehouse named');
});

test('a direct sale takes the warehouse\'s region when it has one', async () => {
  assert.strictEqual(await resolveSaleRegion(tx({ warehouses: { w2: 'Mwanza' } }), { warehouseId: 'w2' }), 'Mwanza');
});

test('a direct sale to a customer with no region is still Dar es Salaam\'s', async () => {
  assert.strictEqual(await resolveSaleRegion(tx({ customers: { c9: null }, warehouses: { w1: 'Dar es Salaam' } }), { customerId: 'c9', warehouseId: 'w1' }), 'Dar es Salaam');
});

test('a rep\'s sale whose rep has no region stays blank — it is not the warehouse\'s', async () => {
  assert.strictEqual(await resolveSaleRegion(tx({ reps: { r2: null }, warehouses: { w1: 'Dar es Salaam' } }), { salesRepId: 'r2', warehouseId: 'w1' }), null);
});
