import test from 'node:test';
import assert from 'node:assert/strict';
import {
  homeWarehouse, primaryWarehouse, boxPackaging, shortName, matches, shortPlace, pickerRows, rowsWithSaved,
  pickedItems, pickedBoxes, stockByProduct, clampQty, reasonChip, withReason,
} from './stockPick.js';

const BOX = 'u-box';
const CARTON = 'u-carton';
const pk = [
  { packagingUnitId: CARTON, baseQuantity: 50, isBaseUnit: false, packagingUnit: { name: 'Carton' } },
  { packagingUnitId: BOX, baseQuantity: 1, isBaseUnit: true, packagingUnit: { name: 'Box' } },
];
const ohis = { id: 'p1', name: 'OHIS Ndogo (Brown) – Bila Filter', brandId: 'b1', brand: { name: 'OHIS' }, purchasePrice: '14000.00', packagings: pk };
const civ = { id: 'p2', name: 'Civlily Ndogo (White) – Bila Filter', brandId: 'b2', brand: { name: 'Civlily' }, purchasePrice: '25000.00', packagings: pk };
const bare = { id: 'p3', name: 'No packaging', brandId: 'b2', brand: { name: 'Civlily' }, packagings: [] };

test('the starting warehouse: remembered, else Dar es Salaam, else primary, else first', () => {
  const main = { id: 'w1', name: 'Main Warehouse (Home)', region: 'Dar es Salaam', isPrimary: true };
  const aru = { id: 'w2', name: 'Arusha store', region: 'Arusha' };
  const off = { id: 'w3', name: 'Old', isActive: false };
  assert.equal(homeWarehouse([aru, main], '').id, 'w1');
  assert.equal(homeWarehouse([aru, main], 'w2').id, 'w2');
  assert.equal(homeWarehouse([aru, main, off], 'w3').id, 'w1', 'a switched-off warehouse is not remembered');
  assert.equal(homeWarehouse([aru, { id: 'w4', name: 'B', isPrimary: true }], '').id, 'w4');
  assert.equal(homeWarehouse([], 'w1'), null);
  assert.equal(primaryWarehouse([aru, main]).id, 'w1');
  assert.equal(primaryWarehouse([aru]).id, 'w2');
});

test('the box is the unit, as every window chose before', () => {
  assert.equal(boxPackaging(ohis).packagingUnitId, BOX);
  assert.equal(boxPackaging({ packagings: [pk[0]] }).packagingUnitId, CARTON, 'no base unit: the first listed');
  const rows = pickerRows([ohis, civ, bare]);
  assert.deepEqual(rows.map((r) => r.key), ['p1', 'p2'], 'a product with no packaging cannot be picked');
  assert.equal(rows[0].packagingUnitId, BOX);
  assert.equal(rows[0].short, 'Ndogo (Brown) – Bila Filter');
  assert.equal(rows[0].buyingPrice, 14000);
  assert.deepEqual(pickerRows([ohis, civ], { brandId: 'b2' }).map((r) => r.key), ['p2']);
});

test('names and search', () => {
  assert.equal(shortName('OHIS Kubwa (Brown)', 'OHIS'), 'Kubwa (Brown)');
  assert.equal(shortName('STG Test Product', 'Civlily'), 'STG Test Product');
  assert.equal(shortPlace('Main Warehouse (Home)'), 'Main Warehouse');
  assert.equal(shortPlace('REVA Test Warehouse'), 'REVA Test Warehouse');
  assert.ok(matches('OHIS Ndogo (Brown) – Bila Filter', 'ndogo brown'));
  assert.ok(!matches('OHIS Ndogo (Brown) – Bila Filter', 'kubwa'));
  assert.ok(matches('anything', '  '));
});

test('picked lines carry exactly productId, packagingUnitId and a whole quantity', () => {
  const rows = pickerRows([ohis, civ]);
  assert.deepEqual(pickedItems(rows, { p2: 3, p1: 0 }), [{ productId: 'p2', packagingUnitId: BOX, quantity: 3 }]);
  assert.deepEqual(pickedItems(rows, { p1: 2, p2: 1 }).map((i) => i.productId), ['p1', 'p2'], 'in the list order');
  assert.equal(pickedBoxes(rows, { p1: 2, p2: 1 }), 3);
  assert.equal(clampQty('7', 5), 5);
  assert.equal(clampQty(-2), 0);
  assert.equal(clampQty(2.9), 2);
});

test('an order being edited keeps its cartons, its second lines and its switched-off products', () => {
  const rows = pickerRows([ohis, civ]);
  const saved = [
    { productId: 'p1', packagingUnitId: BOX, quantity: 4, baseQuantity: 4, unitCost: '13000' },
    { productId: 'p1', packagingUnitId: CARTON, quantity: 2, baseQuantity: 100, unitCost: '13000' },
    { productId: 'gone', packagingUnitId: BOX, quantity: 1, baseQuantity: 1, unitCost: '9000', product: { name: 'Old product' } },
  ];
  const r = rowsWithSaved(rows, saved, [ohis, civ]);
  assert.equal(r.rows.length, 4);
  const items = pickedItems(r.rows, r.qty);
  assert.deepEqual(items, [
    { productId: 'p1', packagingUnitId: BOX, quantity: 4 },
    { productId: 'p1', packagingUnitId: CARTON, quantity: 2 },
    { productId: 'gone', packagingUnitId: BOX, quantity: 1 },
  ]);
  const carton = r.rows.find((x) => x.packagingUnitId === CARTON);
  assert.equal(carton.unitName, 'Carton');
  assert.equal(carton.size, 50);
  assert.equal(r.rows[1].key, carton.key, 'next to its brand');
  assert.equal(r.cost[carton.key], '13000');
  assert.equal(pickedBoxes(r.rows, r.qty), 105);
});

test('stock at one place', () => {
  const bal = [
    { productId: 'p1', locations: [{ type: 'WAREHOUSE', id: 'w1', baseQuantity: 21 }, { type: 'SALES_REP', id: 'r1', baseQuantity: 6 }] },
    { productId: 'p2', locations: [{ type: 'WAREHOUSE', id: 'w2', baseQuantity: 2 }] },
  ];
  const w = stockByProduct(bal, { type: 'WAREHOUSE', id: 'w1' });
  assert.equal(w.get('p1'), 21);
  assert.equal(w.get('p2'), 0);
  assert.equal(stockByProduct(bal, { type: 'SALES_REP', id: 'r1' }).get('p1'), 6);
  assert.equal(stockByProduct(bal, null).size, 0);
});

test('reason chips write into the text, and the text keeps its detail', () => {
  assert.equal(withReason('', 'Wet'), 'Wet');
  assert.equal(withReason('Wet', 'Torn'), 'Torn');
  assert.equal(withReason('Wet — bottom row', 'Torn'), 'Torn — bottom row');
  assert.equal(withReason('two boxes crushed', 'Damaged in transit'), 'Damaged in transit — two boxes crushed');
  assert.equal(withReason('Wet', 'Other'), '');
  assert.equal(withReason('Wet — bottom row', null), 'bottom row');
  assert.equal(reasonChip('Wet — bottom row'), 'Wet');
  assert.equal(reasonChip('Counted wrong'), 'Counted wrong');
  assert.equal(reasonChip('rats'), 'Other');
  assert.equal(reasonChip('  '), null);
});

test('a purchase line costs what was typed, else the buying price', async () => {
  const { lineCost } = await import('./stockPick.js');
  const row = { key: 'p1', buyingPrice: 14000 };
  assert.equal(lineCost({}, row), '14000');
  assert.equal(lineCost({ p1: '12500' }, row), '12500');
  assert.equal(lineCost({ p1: '' }, row), '');
  assert.equal(lineCost(undefined, { key: 'p2', buyingPrice: 0 }), '');
});

test('a button names the place in one or two words', async () => {
  const { buttonPlace } = await import('./stockPick.js');
  assert.equal(buttonPlace('Main Warehouse (Home)'), 'Main');
  assert.equal(buttonPlace('REVA Test Warehouse'), 'REVA Test');
  assert.equal(buttonPlace('Arusha store'), 'Arusha store');
  assert.equal(buttonPlace('Warehouse'), 'Warehouse');
  assert.equal(buttonPlace(''), '');
});

test('each window offers its own reasons', async () => {
  const { DAMAGE_REASONS, ADJUST_REASONS } = await import('./stockPick.js');
  assert.ok(!DAMAGE_REASONS.includes('Counted wrong'));
  assert.ok(!ADJUST_REASONS.includes('Wet'));
  assert.equal(withReason('', 'Counted wrong', ADJUST_REASONS), 'Counted wrong');
  assert.equal(reasonChip('Wet', ADJUST_REASONS), 'Other', 'a reason from another window reads as Other');
  assert.equal(reasonChip('Torn — corner', DAMAGE_REASONS), 'Torn');
});
