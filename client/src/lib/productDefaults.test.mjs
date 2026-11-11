import test from 'node:test';
import assert from 'node:assert/strict';
import { sizeWord, brandInName, closestProduct, setupFrom, usualCategory, setupParts, sameNameAs, filterWord, otherKind } from './productDefaults.js';

const BOX = 'u-box';
const CARTON = 'u-carton';
const levels = (carton = 50, cartonPrice = null) => [
  { packagingUnitId: BOX, baseQuantity: 1, isBaseUnit: true, unitPrice: null },
  { packagingUnitId: CARTON, baseQuantity: carton, isBaseUnit: false, unitPrice: cartonPrice },
];
const p = (id, name, brandId, extra = {}) => ({
  id, name, brandId, categoryId: 'c1', isActive: true, baseUnitName: 'Box', minStockLevel: 50, reorderQuantity: 50,
  packagings: levels(), ...extra,
});
const CATALOGUE = [
  p('o1', 'OHIS Ndogo (Brown) – Bila Filter', 'ohis'),
  p('o2', 'OHIS Kubwa (Brown) – Na Filter', 'ohis', { packagings: levels(40) }),
  p('c1', 'Civlily Ndogo (Brown) – Bila Filter', 'civ', { packagings: levels(50, 1750000) }),
  p('c2', 'Civlily Kubwa (Brown) – Na Filter', 'civ'),
  p('c3', 'Civlily Kubwa (Mix) – Na Filter', 'civ', { minStockLevel: 0 }),
  p('s1', 'STG Test Product', 'civ', { baseUnitName: 'Pack', minStockLevel: 3, reorderQuantity: 10 }),
];

test('sizeWord and brandInName read the name', () => {
  assert.equal(sizeWord('OHIS Ndogo (White)'), 'ndogo');
  assert.equal(sizeWord('Civlily KUBWA mix'), 'kubwa');
  assert.equal(sizeWord('Something else'), null);
  const brands = [{ id: 'ohis', name: 'OHIS' }, { id: 'civ', name: 'Civlily' }];
  assert.equal(brandInName('ohis ndogo', brands), 'ohis');
  assert.equal(brandInName('Civlily Kubwa', brands), 'civ');
  assert.equal(brandInName('QA Test Ndogo', brands), null);
  assert.equal(brandInName('OHIS and Civlily', brands), null);
  assert.equal(brandInName('OHISX', brands), null);
});

test('closestProduct: same brand and size first', () => {
  assert.equal(closestProduct(CATALOGUE, { brandId: 'ohis', name: 'OHIS Kubwa (White) - Bila Filter' }).id, 'o2');
  assert.equal(closestProduct(CATALOGUE, { brandId: 'civ', name: 'QA Test Ndogo Brown - Bila Filter' }).id, 'c1');
});

test('closestProduct: the common setup beats a one-off sibling with the same words', () => {
  // c3 shares "Mix" but has min stock 0; c2 is set up like most products.
  assert.equal(closestProduct(CATALOGUE, { brandId: 'civ', name: 'QA Test Kubwa Mix - Na Filter' }).id, 'c2');
});

test('closestProduct: same brand when no size; most common setup with nothing typed', () => {
  assert.equal(closestProduct(CATALOGUE, { brandId: 'civ', name: 'Civlily Special' }).brandId, 'civ');
  assert.notEqual(closestProduct(CATALOGUE, { brandId: 'civ', name: 'Civlily Special' }).id, 's1');
  assert.equal(closestProduct(CATALOGUE, {}).id, 'o1');
  assert.equal(closestProduct([], {}), null);
  assert.equal(closestProduct([p('x', 'Off', 'civ', { isActive: false })], {}), null);
});

test('setupFrom copies levels, base unit and stock rules but not level prices', () => {
  const s = setupFrom(CATALOGUE[2]);
  assert.equal(s.baseUnitName, 'Box');
  assert.equal(s.minStockLevel, 50);
  assert.equal(s.reorderQuantity, 50);
  assert.deepEqual(s.rows, [
    { packagingUnitId: BOX, baseQuantity: 1, unitPrice: '', isBaseUnit: true },
    { packagingUnitId: CARTON, baseQuantity: 50, unitPrice: '', isBaseUnit: false },
  ]);
});

test('sameNameAs ignores case, dashes and brackets, and the product being edited', () => {
  assert.equal(sameNameAs(CATALOGUE, 'civlily ndogo brown - bila filter')?.id, 'c1');
  assert.equal(sameNameAs(CATALOGUE, 'Civlily Ndogo (Brown) – Bila Filter', 'c1'), null);
  assert.equal(sameNameAs(CATALOGUE, 'Civlily Ndogo (White) – Bila Filter'), null);
  assert.equal(sameNameAs(CATALOGUE, '  '), null);
});

test('usualCategory and setupParts', () => {
  assert.equal(usualCategory(CATALOGUE, [{ id: 'c0' }, { id: 'c1' }]), 'c1');
  assert.equal(usualCategory([], [{ id: 'c0' }]), 'c0');
  assert.equal(usualCategory([], []), '');
  const units = [{ id: BOX, name: 'Box' }, { id: CARTON, name: 'Carton' }];
  assert.deepEqual(setupParts({ rows: setupFrom(CATALOGUE[0]).rows, units, baseUnitName: 'Box', minStockLevel: 50, reorderQuantity: 20 }),
    ['Carton = 50 boxes', 'low-stock alert at 50', 'reorder 20 boxes']);
  assert.deepEqual(setupParts({ rows: [{ packagingUnitId: BOX, baseQuantity: 1, isBaseUnit: true }], units, baseUnitName: '', minStockLevel: 0, reorderQuantity: 0 }),
    ['Sold by the box', 'low-stock alert at 0', 'reorder 0 boxes']);
});

test('filterWord and otherKind: a different size or filter asks for the prices to be checked', () => {
  assert.equal(filterWord('Civlily Kubwa (Mix) – Na Filter'), 'na');
  assert.equal(filterWord('OHIS Ndogo (Brown) - Bila Filter'), 'bila');
  assert.equal(filterWord('OHIS Ndogo'), null);
  assert.equal(otherKind('Civlily Kubwa (Gold) - Na Filter', 'Civlily Kubwa (Red) - Na Filter'), false);
  assert.equal(otherKind('Civlily Kubwa (Gold) - Na Filter', 'Civlily Ndogo (Gold) - Na Filter'), true);
  assert.equal(otherKind('Civlily Kubwa (Gold) - Na Filter', 'Civlily Kubwa (Gold) - Bila Filter'), true);
  assert.equal(otherKind('Civlily Kubwa (Gold) - Na Filter', 'Civlily'), false);
});
