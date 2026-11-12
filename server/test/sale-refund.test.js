'use strict';

// ── A customer brings boxes back from a counter sale (owner, 12 Nov 2026) ─────────────────────────────
// "Yes, refund: the sale and the money come out of Finance. Do this when the customer returns — the
// money returns too, so the sale is cancelled." Pinned here: the refund maths (line price, the sale
// discount shared by line value, part-paid sales clear what is owed first), and the claim (a double tap,
// a second refund or a Cancel at the same moment never move the stock or the money twice).

const test = require('node:test');
const assert = require('node:assert/strict');
const { planRefund } = require('../src/utils/saleRefund');

const line = (id, quantity, price, { factor = 1, unitCost = 0, lineDiscount = 0 } = {}) => ({
  id, productId: `p-${id}`, packagingUnitId: 'box', quantity, baseQuantity: quantity * factor,
  lineTotal: price * quantity - lineDiscount, lineDiscount, unitCost,
});
const saleOf = (items, { discount = 0, paid } = {}) => {
  const subtotal = items.reduce((s, i) => s + i.lineTotal, 0);
  const total = subtotal - discount;
  const costTotal = items.reduce((s, i) => s + i.baseQuantity * i.unitCost, 0);
  return { subtotal, discount, total, amountPaid: paid == null ? total : paid, costTotal, items };
};

// ── The maths ────────────────────────────────────────────────────────────────

test('every box back is the whole sale: everything, all the money, nothing left', () => {
  const sale = saleOf([line('a', 4, 25000, { unitCost: 18000 })]);
  const p = planRefund(sale, [{ saleItemId: 'a', quantity: 4 }]);
  assert.equal(p.everything, true);
  assert.equal(p.refundValue, 100000);
  assert.equal(p.cashBack, 100000);
  assert.deepEqual(p.next, { subtotal: 0, discount: 0, total: 0, amountPaid: 0, balanceDue: 0, costTotal: 0, status: 'PAID' });
});

test('part of a two-line sale with a sale discount: the discount is shared by line value and the totals add up', () => {
  // 3 × 10,000 + 2 × 7,500 = 45,000, less 4,500 = 40,500.
  const sale = saleOf([line('a', 3, 10000, { unitCost: 7000 }), line('b', 2, 7500, { unitCost: 5000 })], { discount: 4500 });
  const p = planRefund(sale, [{ saleItemId: 'a', quantity: 1 }]);
  assert.equal(p.everything, false);
  assert.equal(p.valueBack, 10000);
  assert.equal(p.discountBack, 1000); // 4,500 × 10,000 / 45,000
  assert.equal(p.refundValue, 9000);
  assert.equal(p.cashBack, 9000);
  assert.deepEqual(p.next, { subtotal: 35000, discount: 3500, total: 31500, amountPaid: 31500, balanceDue: 0, costTotal: 24000, status: 'PAID' }); // 31,000 − 7,000
  assert.deepEqual(p.lines[0].next, { quantity: 2, baseQuantity: 2, lineTotal: 20000, lineDiscount: 0 });
  assert.equal(p.lines[0].costBack, 7000);
});

test('an awkward discount: the share is whole shillings and the totals still add up exactly', () => {
  const sale = saleOf([line('a', 3, 10000)], { discount: 1000 }); // 29,000
  const p = planRefund(sale, [{ saleItemId: 'a', quantity: 1 }]);
  assert.equal(p.discountBack, 333); // 333.33 — no cents in a refund handed over the counter
  assert.equal(p.refundValue, 9667);
  assert.equal(p.next.subtotal, 20000);
  assert.equal(p.next.discount, 667);
  assert.equal(p.next.total, 19333);
  assert.equal(Math.round((p.next.subtotal - p.next.discount) * 100) / 100, p.next.total);
  assert.equal(Math.round((p.refundValue + p.next.total) * 100) / 100, sale.total);
});

test('a part-paid sale clears what is owed first; only the rest goes back as cash', () => {
  // 10 × 10,000 = 100,000, paid 60,000, owes 40,000.
  const sale = saleOf([line('a', 10, 10000)], { paid: 60000 });
  const one = planRefund(sale, [{ saleItemId: 'a', quantity: 1 }]);
  assert.equal(one.refundValue, 10000);
  assert.equal(one.cashBack, 0);
  assert.equal(one.owedCleared, 10000);
  assert.deepEqual({ total: one.next.total, amountPaid: one.next.amountPaid, balanceDue: one.next.balanceDue, status: one.next.status },
    { total: 90000, amountPaid: 60000, balanceDue: 30000, status: 'PARTIAL' });
  const five = planRefund(sale, [{ saleItemId: 'a', quantity: 5 }]);
  assert.equal(five.cashBack, 10000);
  assert.equal(five.owedCleared, 40000);
  assert.deepEqual({ total: five.next.total, amountPaid: five.next.amountPaid, balanceDue: five.next.balanceDue, status: five.next.status },
    { total: 50000, amountPaid: 50000, balanceDue: 0, status: 'PAID' });
});

test('a line already brought back in full does not stop the rest being "everything"', () => {
  const a = line('a', 0, 10000); a.lineTotal = 0;
  const sale = saleOf([a, line('b', 2, 5000)]);
  const p = planRefund(sale, [{ saleItemId: 'b', quantity: 2 }]);
  assert.equal(p.everything, true);
  assert.equal(p.cashBack, 10000);
});

test('packs: boxes back follow the line size, and a line discount is shared per box', () => {
  const sale = saleOf([line('a', 4, 12000, { factor: 10, unitCost: 1000, lineDiscount: 2000 })]); // 46,000
  const p = planRefund(sale, [{ saleItemId: 'a', quantity: 1 }]);
  assert.equal(p.lines[0].baseBack, 10);
  assert.equal(p.lines[0].valueBack, 11500);
  assert.deepEqual(p.lines[0].next, { quantity: 3, baseQuantity: 30, lineTotal: 34500, lineDiscount: 1500 });
  assert.equal(p.next.costTotal, 30000);
});

test('a .5 tie: the line discount left still agrees with the line (price × boxes − discount = line total)', () => {
  // 2 × 32,500 with a 1,001 line discount = 63,999; one box back is worth round(31,999.5) = 32,000.
  const sale = saleOf([line('a', 2, 32500, { lineDiscount: 1001 })]);
  const p = planRefund(sale, [{ saleItemId: 'a', quantity: 1 }]);
  assert.equal(p.lines[0].valueBack, 32000);
  assert.deepEqual(p.lines[0].next, { quantity: 1, baseQuantity: 1, lineTotal: 31999, lineDiscount: 501 });
  assert.equal(32500 * p.lines[0].next.quantity - p.lines[0].next.lineDiscount, p.lines[0].next.lineTotal);
});

test('a carton back counts its boxes: boxesBack is in the warehouse\'s boxes, not cartons', () => {
  const sale = saleOf([line('a', 2, 1750000, { factor: 50 }), line('b', 3, 35000)]);
  const p = planRefund(sale, [{ saleItemId: 'a', quantity: 1 }, { saleItemId: 'b', quantity: 1 }]);
  assert.equal(p.boxesBack, 51);
  assert.equal(p.lines[0].quantityBack, 1);
  assert.equal(p.lines[0].baseBack, 50);
});

test('many part refunds in a row: every line keeps price × boxes − discount = line total, and the sale adds up', () => {
  let seed = 7;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  for (let run = 0; run < 2000; run++) {
    const items = Array.from({ length: 1 + rnd(4) }, (_, i) => {
      const q = 1 + rnd(9);
      const price = 1000 + rnd(60000);
      return line(`l${i}`, q, price, { lineDiscount: rnd(3) ? 0 : rnd(price), unitCost: rnd(price) });
    });
    const price = Object.fromEntries(items.map((i) => [i.id, (i.lineTotal + i.lineDiscount) / i.quantity]));
    let sale = saleOf(items, { discount: rnd(2) ? rnd(5000) : 0 });
    for (let step = 0; step < 6; step++) {
      const live = sale.items.filter((i) => i.quantity > 0);
      if (!live.length) break;
      const pick = live[rnd(live.length)];
      const k = 1 + rnd(pick.quantity);
      const p = planRefund(sale, [{ saleItemId: pick.id, quantity: k }]);
      if (p.everything) break;
      const items2 = sale.items.map((i) => { const l = p.lines.find((x) => x.saleItemId === i.id); return l ? { ...i, ...l.next } : i; });
      for (const i of items2) {
        assert.equal(Math.round((price[i.id] * i.quantity - i.lineDiscount) * 100) / 100, i.lineTotal, JSON.stringify(i));
        assert.ok(i.lineDiscount >= 0);
      }
      const sum = Math.round(items2.reduce((s, i) => s + i.lineTotal, 0) * 100) / 100;
      assert.equal(sum, p.next.subtotal);
      assert.equal(Math.round((p.next.subtotal - p.next.discount) * 100) / 100, p.next.total);
      sale = { ...sale, ...p.next, items: items2 };
    }
  }
});

test('refused: none picked, 0, a fraction, more than the line holds, a line not on the sale, a line twice', () => {
  const sale = saleOf([line('a', 2, 5000)]);
  for (const bad of [
    [],
    [{ saleItemId: 'a', quantity: 0 }],
    [{ saleItemId: 'a', quantity: 1.5 }],
    [{ saleItemId: 'a', quantity: 3 }],
    [{ saleItemId: 'zz', quantity: 1 }],
    [{ saleItemId: 'a', quantity: 1 }, { saleItemId: 'a', quantity: 1 }],
  ]) assert.throws(() => planRefund(sale, bad), /box|line|whole/i, JSON.stringify(bad));
});

// ── The service, on a stand-in database that locks the sale row like Postgres does ────────────────────

const stub = (rel, exports) => { const f = require.resolve(rel); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };
const tick = () => new Promise((r) => setImmediate(r));
const clone = (o) => JSON.parse(JSON.stringify(o));

function world({ salesRepId = null, settlementId = null, paid } = {}) {
  const db = {
    sale: {
      id: 's1', saleNumber: 'SALE-9', type: 'CASH', status: 'PAID', warehouseId: 'w1', salesRepId, settlementId,
      subtotal: 50000, discount: 0, total: 50000, amountPaid: paid ?? 50000, balanceDue: 50000 - (paid ?? 50000), costTotal: 35000,
      notes: null, updatedAt: new Date('2026-11-12T08:00:00.000Z'),
    },
    items: [{ id: 'i1', saleId: 's1', productId: 'p1', packagingUnitId: 'box', quantity: 5, baseQuantity: 5, lineTotal: 50000, lineDiscount: 0, unitCost: 7000, product: { name: 'OHIS Ndogo' } }],
    money: [{ id: 'f1', txnNumber: 'FTX-1', refType: 'Sale', refId: 's1', direction: 'IN', amount: paid ?? 50000, notes: null, occurredAt: new Date(), createdAt: new Date(), account: { id: 'mpesa', name: 'M-Pesa' } }],
    stockBack: [],
    writes: 0,
  };
  // One row lock on the sale, held from a transaction's first write on it until that transaction ends.
  let holder = null; const queue = [];
  const lock = async (me) => { if (holder === me) return; while (holder) await new Promise((r) => queue.push(r)); holder = me; };
  const unlock = (me) => { if (holder !== me) return; holder = null; const next = queue.shift(); if (next) next(); };

  const txFor = (me) => {
    const fullSale = () => ({ ...clone(db.sale), updatedAt: new Date(db.sale.updatedAt), items: clone(db.items), creditSale: null });
    return {
      sale: {
        findUnique: async () => { await tick(); return fullSale(); },
        updateMany: async ({ where, data }) => {
          await lock(me); await tick();
          if (db.sale.status === 'CANCELLED') return { count: 0 };
          if (where.updatedAt && new Date(where.updatedAt).getTime() !== new Date(db.sale.updatedAt).getTime()) return { count: 0 };
          Object.assign(db.sale, data, { updatedAt: data.updatedAt || new Date(db.sale.updatedAt.getTime() + 1) });
          return { count: 1 };
        },
        update: async ({ data }) => { db.writes++; Object.assign(db.sale, data); return fullSale(); },
      },
      saleItem: { update: async ({ where, data }) => { db.writes++; Object.assign(db.items.find((i) => i.id === where.id), data); } },
      financeTransaction: {
        findMany: async () => clone(db.money.filter((m) => m.direction === 'IN')),
        update: async ({ where, data }) => { db.writes++; Object.assign(db.money.find((m) => m.id === where.id), data); },
        deleteMany: async () => { db.writes++; const n = db.money.length; db.money = []; return { count: n }; },
      },
      creditSale: { update: async () => ({}) },
    };
  };
  let n = 0;
  stub('../src/config/prisma', {
    $transaction: async (fn) => { const me = ++n; try { return await fn(txFor(me)); } finally { unlock(me); } },
  });
  stub('../src/services/inventory.service', {
    increaseStock: async (_tx, o) => { db.stockBack.push({ base: o.baseQuantity, type: o.type, where: o.location }); },
    LOCATION: { WAREHOUSE: 'WAREHOUSE', SALES_REP: 'SALES_REP' },
  });
  delete require.cache[require.resolve('../src/services/sales.service')];
  return { svc: require('../src/services/sales.service'), db, version: db.sale.updatedAt.toISOString() };
}
const boxesBack = (db) => db.stockBack.reduce((s, m) => s + m.base, 0);

test('part refund: the line, the sale, the stock and the money all come down together', async () => {
  const { svc, db, version } = world();
  const { refund } = await svc.refundSale('s1', { items: [{ saleItemId: 'i1', quantity: 2 }], reason: 'Damaged', version }, { id: 'admin' });
  assert.equal(refund.cashBack, 20000);
  assert.equal(db.items[0].quantity, 3);
  assert.equal(db.sale.total, 30000);
  assert.equal(db.sale.costTotal, 21000);
  assert.equal(db.money[0].amount, 30000); // the sale's own IN row, on M-Pesa
  assert.match(db.money[0].notes, /Refund to customer .*20,000.*2 boxes back/);
  assert.deepEqual(db.stockBack, [{ base: 2, type: 'CUSTOMER_RETURN', where: { type: 'WAREHOUSE', warehouseId: 'w1' } }]);
  assert.equal(refund.ledger[0].account, 'M-Pesa');
});

test('every box back runs the Cancel path: sale cancelled, its income row gone, boxes in as a customer return', async () => {
  const { svc, db, version } = world();
  const { refund, sale } = await svc.refundSale('s1', { items: [{ saleItemId: 'i1', quantity: 5 }], version }, { id: 'admin' });
  assert.equal(refund.everything, true);
  assert.equal(sale.status, 'CANCELLED');
  assert.equal(db.money.length, 0);
  assert.equal(boxesBack(db), 5);
  assert.equal(db.stockBack[0].type, 'CUSTOMER_RETURN');
});

test('a double tap sends one refund: the second finds the sale changed and writes nothing', async () => {
  const { svc, db, version } = world();
  const body = { items: [{ saleItemId: 'i1', quantity: 2 }], version };
  const r = await Promise.allSettled([svc.refundSale('s1', body, { id: 'a' }), svc.refundSale('s1', body, { id: 'a' })]);
  assert.equal(r.filter((x) => x.status === 'fulfilled').length, 1);
  assert.equal(r.find((x) => x.status === 'rejected').reason.statusCode, 409);
  assert.equal(boxesBack(db), 2);
  assert.equal(db.items[0].quantity, 3);
  assert.equal(db.money[0].amount, 30000);
});

test('a refund and a Cancel at the same moment: the stock and the money go back once, in total', async () => {
  const { svc, db, version } = world();
  const r = await Promise.allSettled([
    svc.refundSale('s1', { items: [{ saleItemId: 'i1', quantity: 2 }], version }, { id: 'a' }),
    svc.cancelSale('s1', { id: 'a' }, 'typed wrong'),
  ]);
  assert.ok(r.some((x) => x.status === 'fulfilled'));
  assert.equal(db.sale.status, 'CANCELLED');
  assert.equal(boxesBack(db), 5); // 2 refunded + the 3 left on the sale — never 2 + 5
  assert.equal(db.money.length, 0);
});

test('a rep sale is refused before anything is written', async () => {
  const { svc, db, version } = world({ salesRepId: 'rep1', settlementId: 'st1' });
  await assert.rejects(
    svc.refundSale('s1', { items: [{ saleItemId: 'i1', quantity: 1 }], version }, { id: 'a' }),
    (e) => e.statusCode === 400 && /Rep sales are returned through the rep's order/.test(e.message),
  );
  assert.equal(db.writes, 0);
  assert.equal(boxesBack(db), 0);
});

test('a part-paid sale: one box back clears debt, no cash leaves the account', async () => {
  const { svc, db, version } = world({ paid: 30000 });
  const { refund } = await svc.refundSale('s1', { items: [{ saleItemId: 'i1', quantity: 1 }], version }, { id: 'a' });
  assert.equal(refund.cashBack, 0);
  assert.equal(refund.owedCleared, 10000);
  assert.equal(db.money[0].amount, 30000);
  assert.equal(db.sale.balanceDue, 10000);
  assert.equal(db.sale.status, 'PARTIAL');
});
