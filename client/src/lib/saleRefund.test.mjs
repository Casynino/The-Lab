import test from 'node:test';
import assert from 'node:assert/strict';
import { planRefund, allBoxes, refundItems, refundable } from './saleRefund.js';

// The figures as GET /sales/:id sends them (money as strings, the way Prisma decimals arrive).
const sale = {
  status: 'PAID', salesRepId: null, settlementId: null,
  subtotal: '45000.00', discount: '4500.00', total: '40500.00', amountPaid: '40500.00',
  items: [
    { id: 'a', quantity: 3, baseQuantity: 3, lineTotal: '30000.00', lineDiscount: '0', unitCost: '7000' },
    { id: 'b', quantity: 2, baseQuantity: 2, lineTotal: '15000.00', lineDiscount: '0', unitCost: '5000' },
  ],
};

test('the window starts with every box, which is the whole sale back', () => {
  const p = planRefund(sale, allBoxes(sale));
  assert.equal(p.everything, true);
  assert.equal(p.boxesBack, 5);
  assert.equal(p.cashBack, 40500);
  assert.equal(p.newTotal, 0);
});

test('one box of the first line: same figures as the server (discount shared by line value)', () => {
  const p = planRefund(sale, { a: 1 });
  assert.equal(p.everything, false);
  assert.equal(p.discountBack, 1000);
  assert.equal(p.refundValue, 9000);
  assert.equal(p.cashBack, 9000);
  assert.equal(p.newTotal, 31500);
});

test('a part-paid sale clears what is owed before any cash goes back', () => {
  const s = { ...sale, discount: '0', total: '45000.00', amountPaid: '20000.00' };
  const p = planRefund(s, { a: 1 });
  assert.equal(p.cashBack, 0);
  assert.equal(p.owedCleared, 10000);
  assert.equal(p.newBalance, 15000);
});

test('the request sends only lines with boxes, whole numbers; rep and cancelled sales are not refundable', () => {
  assert.deepEqual(refundItems({ a: 2, b: 0, c: '1' }), [{ saleItemId: 'a', quantity: 2 }, { saleItemId: 'c', quantity: 1 }]);
  assert.equal(refundable(sale), true);
  assert.equal(refundable({ ...sale, salesRepId: 'r1' }), false);
  assert.equal(refundable({ ...sale, status: 'CANCELLED' }), false);
});

test('a carton coming back counts as its boxes (as the server records it)', () => {
  const s = { ...sale, discount: '0', total: '1785000.00', amountPaid: '1785000.00', subtotal: '1785000.00',
    items: [{ id: 'c', quantity: 1, baseQuantity: 50, lineTotal: '1750000', lineDiscount: '0' }, { id: 'b', quantity: 1, baseQuantity: 1, lineTotal: '35000', lineDiscount: '0' }] };
  assert.equal(planRefund(s, { c: 1 }).boxesBack, 50);
  assert.equal(planRefund(s, allBoxes(s)).boxesBack, 51);
});
