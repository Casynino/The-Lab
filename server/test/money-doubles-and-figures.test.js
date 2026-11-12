'use strict';

// ── Money figures and duplicate safety, final audit (12 Nov 2026) ──────────────────────────────────────
// Pinned:
//  - a commission deduction or correction sent twice is applied once; a huge one is a clean 400
//    (backend-integrity-2, -4);
//  - forgiving a fine twice at the same moment tells the rep once (backend-integrity-3);
//  - a date filter's bare day is a Dar es Salaam day (backend-integrity-8);
//  - a supplier's balance payments and returns are shared over his POs, and Pay PO can never take him
//    past what he is owed (admin-money-1);
//  - "Overdue" on the settlement record means past the real deadline (admin-money-5);
//  - the Products cards count every product, not the page (admin-ops-5).

const test = require('node:test');
const assert = require('node:assert/strict');

const stub = (rel, exports) => {
  const f = require.resolve(rel);
  require.cache[f] = { id: f, filename: f, loaded: true, exports };
};
const fresh = (rel) => {
  delete require.cache[require.resolve(rel)];
  return require(rel);
};

// A database stand-in: every table answers "nothing" unless a test fills it in. Transactions run one at a
// time, as the row lock they take makes them run on Postgres.
function db(tables = {}) {
  const empty = {
    findMany: async () => [], findFirst: async () => null, findUnique: async () => null,
    count: async () => 0, groupBy: async () => [], aggregate: async () => ({ _sum: {}, _count: 0 }),
  };
  let chain = Promise.resolve();
  const locks = [];
  const proxy = new Proxy({}, {
    get(_t, name) {
      if (name === 'then') return undefined;
      if (name === 'locks') return locks;
      if (name === '$transaction') {
        return (fn) => {
          const run = chain.then(() => fn(proxy));
          chain = run.catch(() => {});
          return run;
        };
      }
      if (name === '$queryRaw') return async (strings, ...values) => { locks.push({ sql: strings.join('?'), values }); return []; };
      return { ...empty, ...(tables[name] || {}) };
    },
  });
  return proxy;
}

const notified = [];
stub('../src/services/notification.service', {
  notifyUser: async (userId, data) => { notified.push({ userId, ...data }); },
  notifyAdmins: async () => {},
  createIfAbsent: async () => {},
});

// ── backend-integrity-2 / -4: deductions ─────────────────────────────────────────────────────────────
function loadPenalties(rows = []) {
  const prisma = db({
    salesRepresentative: { findUnique: async () => ({ id: 'r1', user: { id: 'u1', name: 'KP' } }) },
    settlementPenalty: {
      findFirst: async ({ where }) => rows.find((r) => r.salesRepId === where.salesRepId && r.kind === where.kind
        && r.amount === where.amount && r.notes === where.notes && r.appliedAt >= where.appliedAt.gte) || null,
      create: async ({ data }) => { const r = { id: `pen${rows.length + 1}`, appliedAt: new Date(), status: 'APPLIED', ...data }; rows.push(r); return r; },
      // A copy, as a database read is: what it says does not change under the reader.
      findUnique: async ({ where }) => { const r = rows.find((x) => x.id === where.id); return r ? { ...r } : null; },
      updateMany: async ({ where, data }) => {
        const hit = rows.filter((r) => r.id === where.id && r.status === where.status);
        hit.forEach((r) => Object.assign(r, data));
        return { count: hit.length };
      },
    },
  });
  stub('../src/config/prisma', prisma);
  return { svc: fresh('../src/services/penalty.service'), rows, prisma };
}

test('the same deduction sent twice (double tap or retry) is deducted once and the rep told once', async () => {
  notified.length = 0;
  const { svc, rows, prisma } = loadPenalties();
  const body = { salesRepId: 'r1', amount: 100, reason: 'Lost box' };
  const results = await Promise.allSettled([svc.adjustCommission(body, { id: 'admin' }), svc.adjustCommission(body, { id: 'admin' })]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  const refused = results.find((r) => r.status === 'rejected').reason;
  assert.equal(refused.statusCode, 409);
  assert.match(refused.message, /already recorded a moment ago — it went through/);
  assert.equal(rows.length, 1);
  assert.equal(notified.length, 1);
  // The check ran under the rep's row lock.
  assert.ok(prisma.locks.every((l) => /FROM "sales_representatives" WHERE id = \? FOR UPDATE/.test(l.sql)));

  // A different amount or reason is a different deduction, and goes through.
  await svc.adjustCommission({ ...body, amount: 200 }, { id: 'admin' });
  await svc.adjustCommission({ ...body, reason: 'Second lost box' }, { id: 'admin' });
  assert.equal(rows.length, 3);
});

test('a huge deduction is a clean 400 and writes nothing', async () => {
  const { svc, rows } = loadPenalties();
  await assert.rejects(svc.adjustCommission({ salesRepId: 'r1', amount: 1e13 }, null), (e) => e.statusCode === 400 && /number of zeros/.test(e.message));
  await assert.rejects(svc.adjustCommission({ salesRepId: 'r1', amount: 100_000_001 }, null), (e) => e.statusCode === 400);
  assert.equal(rows.length, 0);
});

// ── backend-integrity-3: forgive ─────────────────────────────────────────────────────────────────────
test('two Forgive presses at the same moment: one wins, the rep is told once, the other is told it is done', async () => {
  notified.length = 0;
  const fine = { id: 'f1', salesRepId: 'r1', amount: 100, status: 'APPLIED', settlementId: 's1', salesRep: { user: { id: 'u1' } }, settlement: { settlementNumber: 'STL-1' } };
  const { svc, rows } = loadPenalties([fine]);
  const results = await Promise.allSettled([svc.waivePenalty('f1', { id: 'admin' }), svc.waivePenalty('f1', { id: 'admin' })]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(results.find((r) => r.status === 'rejected').reason.statusCode, 409);
  assert.equal(rows[0].status, 'WAIVED');
  assert.equal(notified.filter((n) => n.whatsapp?.kind === 'FINE_FORGIVEN').length, 1);
  // A later retry (after a lost answer) is the same 409, so the window closes on it instead of an error.
  await assert.rejects(svc.waivePenalty('f1', { id: 'admin' }), (e) => e.statusCode === 409 && /already been forgiven/.test(e.message));
  assert.equal(notified.filter((n) => n.whatsapp?.kind === 'FINE_FORGIVEN').length, 1);
});

// ── backend-integrity-2 / -4: commission corrections ─────────────────────────────────────────────────
test('the same commission correction sent twice is added once; a huge one is a clean 400', async () => {
  stub('../src/services/penalty.service', { penaltyBreakdownForRep: async () => ({ total: 0, breakdown: [] }) });
  const rep = { id: 'r1', commissionAdjustment: 0 };
  const audits = [];
  stub('../src/config/prisma', db({
    salesRepresentative: {
      findUnique: async () => ({ ...rep }),
      update: async ({ data }) => { rep.commissionAdjustment += data.commissionAdjustment.increment; return { ...rep }; },
    },
    auditLog: {
      findMany: async ({ where }) => audits.filter((a) => a.entityId === where.entityId && a.createdAt >= where.createdAt.gte),
    },
  }));
  const commission = fresh('../src/services/commission.service');
  // What the controller passes: the audit row, written inside the same transaction.
  const record = async (_tx, r, { amount, note }) => {
    audits.push({ entityId: r.id, createdAt: new Date(), newValues: { kind: 'COMMISSION_ADJUSTMENT', amount, note } });
  };
  const body = { salesRepId: 'r1', amount: 5000, note: 'missed box' };
  const results = await Promise.allSettled([
    commission.adjustEarned(body, { id: 'admin' }, { record }),
    commission.adjustEarned(body, { id: 'admin' }, { record }),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(results.find((r) => r.status === 'rejected').reason.statusCode, 409);
  assert.equal(rep.commissionAdjustment, 5000);
  // Another amount is another correction.
  await commission.adjustEarned({ ...body, amount: -5000 }, { id: 'admin' }, { record });
  assert.equal(rep.commissionAdjustment, 0);

  await assert.rejects(commission.adjustEarned({ salesRepId: 'r1', amount: 1e13 }), (e) => e.statusCode === 400 && /number of zeros/.test(e.message));
  await assert.rejects(commission.adjustEarned({ salesRepId: 'r1', amount: -1e13 }), (e) => e.statusCode === 400);
  assert.equal(rep.commissionAdjustment, 0);
});

// ── backend-integrity-8: date filters ────────────────────────────────────────────────────────────────
test('a bare day in a from/to filter is the whole Dar es Salaam day; a full timestamp is kept', () => {
  const { eatDayBounds } = require('../src/utils/dates');
  const one = eatDayBounds({ from: '2026-11-11', to: '2026-11-11' });
  assert.equal(one.gte.toISOString(), '2026-11-10T21:00:00.000Z'); // 00:00 EAT
  assert.equal(one.lte.toISOString(), '2026-11-11T20:59:59.999Z'); // 23:59:59.999 EAT
  assert.deepEqual(Object.keys(eatDayBounds({ from: '2026-11-11' })), ['gte']);
  assert.deepEqual(Object.keys(eatDayBounds({ to: '2026-11-11' })), ['lte']);
  assert.equal(eatDayBounds({ from: '2026-11-11T10:00:00.000Z' }).gte.toISOString(), '2026-11-11T10:00:00.000Z');
  assert.equal(eatDayBounds({ from: 'not a date' }), null);
});

test('the sales list reads from/to as Dar es Salaam days, and refuses an unreadable date', async () => {
  let seen = null;
  stub('../src/config/prisma', db({
    sale: { findMany: async ({ where }) => { seen = where; return []; } },
  }));
  const sales = fresh('../src/services/sales.service');
  await sales.listSales({ from: '2026-11-11', to: '2026-11-11' }, { skip: 0, take: 20, orderBy: { soldAt: 'desc' } }).catch(() => {});
  assert.equal(seen.soldAt.gte.toISOString(), '2026-11-10T21:00:00.000Z');
  assert.equal(seen.soldAt.lte.toISOString(), '2026-11-11T20:59:59.999Z');
  await assert.rejects(sales.listSales({ from: 'yesterday' }, { skip: 0, take: 20 }), (e) => e.statusCode === 400);
});

// ── admin-money-1: supplier POs ──────────────────────────────────────────────────────────────────────
test('balance payments and returns are shared over the POs oldest first, and the rows add up to what is owed', () => {
  stub('../src/config/prisma', db());
  const { spreadOverOrders } = fresh('../src/services/finance.service');
  // Bonge, as on the live copy: four POs, 9,166,000 paid as balance payments, 1,776,000 returned.
  const pos = [
    { id: 'po4', totalCost: 6875000, paidDirect: 0, at: '2026-10-20' },
    { id: 'po1', totalCost: 3700000, paidDirect: 0, at: '2026-07-01' },
    { id: 'po3', totalCost: 9617000, paidDirect: 0, at: '2026-09-15' },
    { id: 'po2', totalCost: 2750000, paidDirect: 0, at: '2026-08-10' },
  ];
  const out = spreadOverOrders(pos, { balancePaid: 9166000, returned: 1776000 });
  const total = [...out.values()].reduce((s, o) => s + o.outstanding, 0);
  assert.equal(total, 12000000);
  assert.deepEqual(out.get('po1'), { paid: 3700000, returned: 0, outstanding: 0 });
  assert.deepEqual(out.get('po2'), { paid: 2750000, returned: 0, outstanding: 0 });
  assert.deepEqual(out.get('po3'), { paid: 2716000, returned: 1776000, outstanding: 5125000 });
  assert.deepEqual(out.get('po4'), { paid: 0, returned: 0, outstanding: 6875000 });
  // A PO's own payment counts first; nothing is spread onto a PO that is already paid.
  const own = spreadOverOrders([{ id: 'a', totalCost: 1000, paidDirect: 1000, at: '2026-01-01' }, { id: 'b', totalCost: 500, paidDirect: 0, at: '2026-02-01' }], { balancePaid: 200 });
  assert.deepEqual(own.get('a'), { paid: 1000, returned: 0, outstanding: 0 });
  assert.deepEqual(own.get('b'), { paid: 200, returned: 0, outstanding: 300 });
});

function loadSupplier({ pos, txns = [], credits = [] }) {
  const created = [];
  const supplier = { id: 'sup1', name: 'Bonge', brandId: 'b1' };
  stub('../src/config/prisma', db({
    supplier: { findUnique: async () => supplier },
    brand: { findUnique: async () => ({ name: 'OHIS' }) },
    purchaseOrder: {
      findUnique: async ({ where }) => {
        const p = pos.find((x) => x.id === where.id);
        return p ? { ...p, supplierId: 'sup1', supplier } : null;
      },
      findMany: async () => pos.map((p) => ({ ...p, items: [] })),
    },
    supplierCredit: { findMany: async () => credits },
    financeTransaction: {
      findMany: async () => txns,
      findFirst: async () => null,
      create: async ({ data }) => { created.push(data); return { id: `t${created.length}`, ...data }; },
    },
    businessAccount: { findUnique: async () => ({ id: 'acc', name: 'Cash in hand', isActive: true, type: 'CASH' }) },
  }));
  stub('../src/services/reports.service', { financeEpoch: async () => null });
  return { finance: fresh('../src/services/finance.service'), created };
}

test('Pay PO is refused once balance payments cover the bill, and never takes the supplier past what he is owed', async () => {
  // The audit case: a 1,000 PO already paid as a balance payment, then paid again against the PO.
  const po = { id: 'po1', poNumber: 'PO-1', status: 'ORDERED', totalCost: 1000, receivedAt: null, createdAt: new Date('2026-11-11') };
  let s = loadSupplier({ pos: [po], txns: [{ refType: 'Supplier', refId: 'sup1', amount: 1000, occurredAt: new Date() }] });
  const detail = await s.finance.supplierDetail('sup1');
  assert.equal(detail.orders[0].paid, 1000);
  assert.equal(detail.orders[0].outstanding, 0);
  assert.equal(detail.totals.outstanding, 0);
  await assert.rejects(s.finance.paySupplier({ purchaseOrderId: 'po1', accountId: 'acc', amount: 1000 }, null),
    (e) => e.statusCode === 400 && /Nothing is left to pay on PO-1/.test(e.message));
  await assert.rejects(s.finance.paySupplier({ purchaseOrderId: 'po1', accountId: 'acc' }, null), (e) => e.statusCode === 400);
  assert.equal(s.created.length, 0);

  // Another PO overpaid on its own: this one may be paid at most what the supplier is owed in all.
  const a = { id: 'a', poNumber: 'PO-A', status: 'RECEIVED', totalCost: 1000, receivedAt: new Date('2026-10-01'), createdAt: new Date('2026-10-01') };
  const b = { id: 'b', poNumber: 'PO-B', status: 'RECEIVED', totalCost: 1000, receivedAt: new Date('2026-10-02'), createdAt: new Date('2026-10-02') };
  s = loadSupplier({ pos: [a, b], txns: [{ refType: 'PurchaseOrder', refId: 'a', amount: 1600, occurredAt: new Date() }] });
  await assert.rejects(s.finance.paySupplier({ purchaseOrderId: 'b', accountId: 'acc', amount: 1000 }, null),
    (e) => e.statusCode === 400 && /You only owe Bonge TZS 400 in all/.test(e.message));
  await s.finance.paySupplier({ purchaseOrderId: 'b', accountId: 'acc', amount: 400 }, null);
  assert.equal(s.created.length, 1);
  assert.equal(s.created[0].amount, 400);
});

test('an overpaid supplier: Pay PO says he is owed nothing in all, and the money beyond the bills is shown', async () => {
  // STG case: one 1,000 PO, 2,000 paid as balance payments. The row shows 0, the balance is −1,000, and
  // the 1,000 beyond the bill sits on no PO row, so rows − notOnAnyPo = balance.
  const po = { id: 'p1', poNumber: 'PO-1', status: 'RECEIVED', totalCost: 1000, receivedAt: new Date('2026-10-01'), createdAt: new Date('2026-10-01') };
  let s = loadSupplier({ pos: [po], txns: [{ refType: 'Supplier', refId: 'sup1', amount: 2000, occurredAt: new Date() }] });
  let d = await s.finance.supplierDetail('sup1');
  assert.equal(d.orders[0].outstanding, 0);
  assert.equal(d.totals.outstanding, -1000);
  assert.equal(d.totals.notOnAnyPo, 1000);
  assert.equal(d.orders.reduce((x, o) => x + o.outstanding, 0) - d.totals.notOnAnyPo, d.totals.outstanding);
  await assert.rejects(s.finance.paySupplier({ purchaseOrderId: 'p1', accountId: 'acc', amount: 1 }, null),
    (e) => e.statusCode === 400 && /You owe Bonge nothing in all — they have been paid TZS 1,000 more than the bills/.test(e.message));

  // RS2 case: one PO paid 30,000 beyond its cost directly, another still shows 4,000 on its row. The
  // supplier is owed nothing in all, so Pay PO on the second does not claim its bill is covered.
  const a = { id: 'a', poNumber: 'PO-A', status: 'RECEIVED', totalCost: 10000, receivedAt: new Date('2026-10-01'), createdAt: new Date('2026-10-01') };
  const b = { id: 'b', poNumber: 'PO-B', status: 'RECEIVED', totalCost: 4000, receivedAt: new Date('2026-10-02'), createdAt: new Date('2026-10-02') };
  s = loadSupplier({ pos: [a, b], txns: [{ refType: 'PurchaseOrder', refId: 'a', amount: 40000, occurredAt: new Date() }] });
  d = await s.finance.supplierDetail('sup1');
  assert.equal(d.orders.find((o) => o.id === 'b').outstanding, 4000);
  assert.equal(d.totals.outstanding, -26000);
  assert.equal(d.totals.notOnAnyPo, 0); // the rows already add up: −30,000 + 4,000
  await assert.rejects(s.finance.paySupplier({ purchaseOrderId: 'b', accountId: 'acc', amount: 1 }, null),
    (e) => e.statusCode === 400 && /nothing in all — they have been paid TZS 26,000 more/.test(e.message));

  // Owed exactly nothing in all, yet this PO's row shows an amount: the same "nothing in all" answer.
  s = loadSupplier({ pos: [a, b], txns: [{ refType: 'PurchaseOrder', refId: 'a', amount: 14000, occurredAt: new Date() }] });
  await assert.rejects(s.finance.paySupplier({ purchaseOrderId: 'b', accountId: 'acc' }, null),
    (e) => e.statusCode === 400 && /You owe Bonge nothing in all — the payments already made cover every bill/.test(e.message));
  assert.equal(s.created.length, 0);
});

// ── admin-money-5: Overdue on the settlement record ──────────────────────────────────────────────────
test('an order is late now only when its real deadline has passed (admin extensions count)', () => {
  stub('../src/config/prisma', db());
  const { isLateNow } = fresh('../src/services/settlement.service');
  const now = Date.parse('2026-11-12T09:00:00Z');
  // Issued 26 Sep, extended by the admin to 15 Nov: not late, though far past 72 hours from issue.
  assert.equal(isLateNow({ status: 'PARTIAL', deadlineAt: '2026-11-15T09:00:00Z' }, now), false);
  assert.equal(isLateNow({ status: 'OPEN', deadlineAt: '2026-11-12T08:59:00Z' }, now), true);
  assert.equal(isLateNow({ status: 'OVERDUE', deadlineAt: '2026-11-20T00:00:00Z' }, now), true); // as the Overdue list
  assert.equal(isLateNow({ status: 'SETTLED', deadlineAt: '2026-11-01T00:00:00Z' }, now), false);
});

// ── admin-ops-5: Products cards ──────────────────────────────────────────────────────────────────────
test('the catalogue summary counts every product it is given, with the low-stock rule of the rows', () => {
  stub('../src/config/prisma', db());
  const { productsSummary } = fresh('../src/services/products.service');
  const rows = Array.from({ length: 16 }, (_, i) => ({ id: `p${i}`, sellingPrice: 30000, minStockLevel: i === 15 ? 10 : 0 }));
  const onHand = new Map(rows.map((r) => [r.id, 2]));
  const shelf = new Map(rows.map((r) => [r.id, 1]));
  assert.deepEqual(productsSummary(rows, onHand, shelf), { onHandBase: 32, worthAtSelling: 960000, lowCount: 1 });
});
