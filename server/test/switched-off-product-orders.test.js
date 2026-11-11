'use strict';

// ── A switched-off product is not issued to a rep, and its settlement is refused up front (audit #110) ──
// A switched-off product cannot be sold, so a settlement of it can never be approved. It was accepted and
// sat waiting for good; and an admin's direct Warehouse -> Rep transfer (or "Add stock" on a rep) could
// still issue one (9ab382c covered stock requests only). Pinned: all three refuse it with a clear reason;
// boxes going back from a rep to the warehouse are not affected.

const test = require('node:test');
const assert = require('node:assert/strict');

const PRODUCT_OFF = { id: 'p1', name: 'Pepa', isActive: false, sellingPrice: 2500, purchasePrice: 1000, brandId: 'b1' };
const tx = {
  $queryRaw: async () => [],
  settlement: {
    findUnique: async () => ({ id: 'o1', settlementNumber: 'STL-1', status: 'OPEN', salesRepId: 'rep1', salesRep: { user: { id: 'u1', name: 'Paul' } } }),
    findMany: async () => { throw new Error('reached the next step'); },
  },
  product: {
    findUnique: async () => ({ ...PRODUCT_OFF }),
    findMany: async () => [{ ...PRODUCT_OFF }],
  },
  productPackaging: { findUnique: async () => ({ isActive: true, baseQuantity: 1, packagingUnit: { name: 'Box' } }) },
  salesRepresentative: { findUnique: async () => ({ id: 'rep1', isActive: true, user: { id: 'u1', name: 'Paul' } }) },
};
const install = (path, exports) => {
  const filename = require.resolve(path);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
};
install('../src/config/prisma', { $transaction: async (fn) => fn(tx) });
install('../src/services/notification.service', { notifyUser: async () => {}, notifyAdmins: async () => {} });

const submissions = require('../src/services/settlementSubmission.service');
const transfers = require('../src/services/transfers.service');
const settlement = require('../src/services/settlement.service');

test('a settlement of a switched-off product is refused when sent, with the two ways out', async () => {
  await assert.rejects(
    submissions.submit('o1', { productId: 'p1', boxes: 2 }, { id: 'u1', salesRepId: 'rep1' }),
    (e) => e.statusCode === 400 && /Pepa is switched off, so it can't be settled/.test(e.message) && /return these boxes/.test(e.message),
  );
});

test('a direct Warehouse -> Rep transfer of a switched-off product is refused', async () => {
  await assert.rejects(
    transfers.createTransferTx(tx, { direction: 'WAREHOUSE_TO_REP', fromWarehouseId: 'w1', toRepId: 'rep1', items: [{ productId: 'p1', packagingUnitId: 'u1', quantity: 3 }] }, { id: 'admin' }),
    (e) => e.statusCode === 400 && /Pepa is switched off, so it can't be issued to a rep/.test(e.message),
  );
});

test('"Add stock" on a rep refuses a switched-off product too', async () => {
  await assert.rejects(
    settlement.addStockToRep('rep1', { productId: 'p1', boxes: 3, warehouseId: 'w1' }, { id: 'admin' }),
    (e) => e.statusCode === 400 && /switched off, so it can't be issued to a rep/.test(e.message),
  );
});

test('boxes of a switched-off product can still go back from a rep to the warehouse', async () => {
  await assert.rejects(
    transfers.createTransferTx(tx, { direction: 'REP_TO_WAREHOUSE', fromRepId: 'rep1', toWarehouseId: 'w1', items: [{ productId: 'p1', packagingUnitId: 'u1', quantity: 3 }] }, { id: 'admin' }),
    (e) => e.message === 'reached the next step', // past the switched-off check, on to the owed-boxes check
  );
});
