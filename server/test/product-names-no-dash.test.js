'use strict';

// Owner, 12 Nov 2026: product names carry no dash — "OHIS Ndogo (Brown) Bila Filter".
const test = require('node:test');
const assert = require('node:assert/strict');
const { productRank, compareProducts } = require('../src/utils/productOrder');
const { productCreate, productUpdate } = require('../src/validators/catalog.validator');

test('the fixed product order knows the names without the dash, and the old dashed names in the same place', () => {
  assert.equal(productRank('OHIS Ndogo (Brown) Bila Filter'), 0);
  assert.equal(productRank('OHIS Ndogo (Brown) – Bila Filter'), 0);
  assert.equal(productRank('Civlily Ndogo (Mix) Bila Filter'), productRank('Civlily Ndogo (Mix) - Bila Filter'));
  assert.notEqual(productRank('Civlily Ndogo (Mix) Bila Filter'), Number.MAX_SAFE_INTEGER);
  const names = ['Civlily Kubwa (Mix) Na Filter', 'OHIS Kubwa (Brown) Bila Filter', 'OHIS Ndogo (Brown) Bila Filter', 'Civlily Ndogo (Brown) Bila Filter'];
  assert.deepEqual([...names].sort(compareProducts), ['OHIS Ndogo (Brown) Bila Filter', 'OHIS Kubwa (Brown) Bila Filter', 'Civlily Ndogo (Brown) Bila Filter', 'Civlily Kubwa (Mix) Na Filter']);
});

test('a product saved with a spaced dash in its name is saved without it; a hyphen inside a word stays', () => {
  assert.equal(productCreate.body.shape.name.parse('  OHIS Ndogo (Brown) – Bila Filter '), 'OHIS Ndogo (Brown) Bila Filter');
  assert.equal(productUpdate.body.parse({ name: 'Civlily Kubwa (Mix) - Na Filter' }).name, 'Civlily Kubwa (Mix) Na Filter');
  assert.equal(productUpdate.body.parse({ name: 'OHIS Ndogo (Brown) — Na Filter' }).name, 'OHIS Ndogo (Brown) Na Filter');
  assert.equal(productUpdate.body.parse({ name: 'Pre-rolled Cones' }).name, 'Pre-rolled Cones');
  assert.equal(productUpdate.body.parse({}).name, undefined);
});
