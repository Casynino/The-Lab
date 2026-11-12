// Owner, 12 Nov 2026: product names carry no dash. The fixed order must hold for the new names and the old.
import test from 'node:test';
import assert from 'node:assert/strict';
import { productRank, sortByCanonical } from './productOrder.js';

test('names without the dash keep their place in the fixed order, the same as the old dashed names', () => {
  assert.equal(productRank('OHIS Ndogo (Brown) Bila Filter'), 0);
  assert.equal(productRank('OHIS Ndogo (Brown) – Bila Filter'), 0);
  assert.equal(productRank('Civlily Ndogo (Mix) Bila Filter'), productRank('Civlily Ndogo (Mix) - Bila Filter'));
  const list = ['Civlily Kubwa (Mix) Na Filter', 'OHIS Kubwa (Brown) Bila Filter', 'Zeta New Product', 'OHIS Ndogo (Brown) Bila Filter']
    .map((name) => ({ name }));
  assert.deepEqual(sortByCanonical(list).map((p) => p.name),
    ['OHIS Ndogo (Brown) Bila Filter', 'OHIS Kubwa (Brown) Bila Filter', 'Civlily Kubwa (Mix) Na Filter', 'Zeta New Product']);
});
