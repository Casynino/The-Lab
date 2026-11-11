'use strict';

// ── Stock requests (audit, 11 Nov 2026) ─────────────────────────────────────────────────────────────
// Pinned: a product switched off in Products cannot be requested, offered or issued; two requests (or two
// approvals) at the same moment no longer fail on a taken REQ/TRF number; the rep is told what an approval
// issued, with its order and deadline; a reject reason is added under the rep's own note; an admin's edit
// is said as the admin's and the rep is told; the over-stock message names the product (never the level);
// the admin history pages only decided requests while its summary still counts everything.

const test = require('node:test');
const assert = require('node:assert/strict');

const clash = (field) => Object.assign(new Error(`Unique constraint failed on the fields: (\`${field}\`)`), {
  code: 'P2002', meta: { target: [field] },
});

const PRODUCTS = [
  { id: 'p1', name: 'Civlily Pepa Ndogo (Brown)', isActive: true, sellingPrice: 1000 },
  { id: 'p2', name: 'OHIS Pepa Kubwa (Brown)', isActive: true, sellingPrice: 500 },
  { id: 'off', name: 'Old Pepa', isActive: false, sellingPrice: 700 },
];

function load({ stock = { p1: 10, p2: 10, off: 10 }, request = null, createFails = [], transferFails = [] } = {}) {
  const calls = { txRuns: 0, created: [], transfers: [], admins: [], users: [], updateMany: [], findMany: [], count: [] };
  const byId = new Map(PRODUCTS.map((p) => [p.id, p]));
  const itemUpdates = new Map();
  const rep = { userId: 'rep-user', user: { name: 'Minyaro' } };
  const withNames = (it) => ({ ...it, product: byId.get(it.productId), packagingUnit: { name: 'Box' } });

  const prisma = {
    // An interactive transaction: the callback gets the client; a throw is a rollback (nothing here is
    // written outside the fakes' call logs, so a re-run starts from the same state, as after a rollback).
    $transaction: async (fn) => { calls.txRuns += 1; return fn(prisma); },
    warehouse: { findFirst: async () => ({ id: 'wh1' }) },
    salesRepresentative: { findUnique: async () => ({ region: null, regions: [], userId: 'rep-user' }) },
    product: {
      findMany: async ({ where }) => PRODUCTS.filter((p) => where.id.in.includes(p.id)
        && (where.isActive === undefined || p.isActive === where.isActive)),
    },
    stockRequest: {
      findMany: async (args) => { calls.findMany.push(args); return []; },
      count: async (args) => { calls.count.push(args); return 0; },
      create: async ({ data }) => {
        const f = createFails.shift();
        if (f) throw clash(f);
        const row = { id: 'sr-new', ...data, items: data.items.create.map(withNames), salesRep: rep };
        calls.created.push(row);
        return row;
      },
      findUnique: async ({ where }) => (request && where.id === request.id ? { ...request, salesRep: rep } : null),
      updateMany: async (args) => {
        calls.updateMany.push(args);
        return { count: request && request.status === 'PENDING' ? 1 : 0 };
      },
      update: async ({ data }) => {
        const items = data.items?.create
          ? data.items.create.map((l, k) => withNames({ id: `n${k}`, ...l }))
          : request.items.map((it) => withNames({ ...it, ...(itemUpdates.get(it.id) || {}) }));
        return { ...request, ...data, items, salesRep: rep };
      },
    },
    stockRequestItem: {
      update: async ({ where, data }) => { itemUpdates.set(where.id, data); return {}; },
      deleteMany: async () => ({}),
    },
    settlement: {
      findFirst: async () => ({ id: 's1', settlementNumber: 'STL-20261111-0001', deadlineAt: new Date('2026-11-14T04:09:00Z') }),
      findMany: async () => [],
    },
  };

  const stub = (rel, exports) => { const f = require.resolve(rel); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };
  stub('../src/config/prisma', prisma);
  stub('../src/services/inventory.service', {
    convertToBase: async (_c, _p, _u, quantity) => ({ packaging: { unitPrice: null, baseQuantity: 1 }, baseQuantity: quantity }),
    warehouseBalances: async () => Object.entries(stock).map(([productId, baseQuantity]) => ({ productId, baseQuantity })),
  });
  stub('../src/services/transfers.service', {
    createTransferTx: async (_tx, payload) => {
      calls.transfers.push(payload);
      const f = transferFails.shift();
      if (f) throw clash(f);
      return { id: 't1' };
    },
  });
  stub('../src/services/notification.service', {
    notifyAdmins: async (d) => { calls.admins.push(d); },
    notifyUser: async (userId, d) => { calls.users.push({ userId, ...d }); },
    checkProductLowStock: async () => {},
  });
  stub('../src/services/whatsappNotify.service', { background: () => {}, stockRequestSubmitted: () => null });
  delete require.cache[require.resolve('../src/services/stockRequest.service')];
  return { svc: require('../src/services/stockRequest.service'), calls };
}

const pendingRequest = (extra = {}) => ({
  id: 'sr1',
  status: 'PENDING',
  requestNumber: 'REQ-20261111-0001',
  salesRepId: 'r1',
  warehouseId: null,
  region: null,
  notes: 'rep own note',
  items: [
    { id: 'i1', productId: 'p1', packagingUnitId: 'box', quantityRequested: 4, unitPrice: 1000 },
    { id: 'i2', productId: 'p2', packagingUnitId: 'box', quantityRequested: 2, unitPrice: 500 },
  ],
  ...extra,
});
const line = (productId, quantity) => ({ productId, packagingUnitId: 'box', quantity });

// ── a switched-off product ───────────────────────────────────────────────────────────────────────────
test('a switched-off product cannot be requested, and is not offered to the rep', async () => {
  const { svc, calls } = load();
  await assert.rejects(svc.create('r1', { items: [line('p1', 1), line('off', 1)] }),
    (e) => e.statusCode === 400 && /Old Pepa is no longer available/.test(e.message));
  assert.equal(calls.created.length, 0);
  assert.deepEqual(await svc.availableProductIds(), ['p1', 'p2']);
});

test('a pending request cannot be edited to include a switched-off product', async () => {
  const { svc } = load({ request: pendingRequest() });
  await assert.rejects(svc.update('sr1', { items: [line('off', 1)] }, { id: 'u', role: 'SALES_REP' }),
    (e) => e.statusCode === 400 && /no longer available/.test(e.message));
});

test('approval refuses a product switched off since the request, and nothing is issued; set to 0 it goes through', async () => {
  const req = pendingRequest({ items: [
    { id: 'i1', productId: 'p1', packagingUnitId: 'box', quantityRequested: 4, unitPrice: 1000 },
    { id: 'i3', productId: 'off', packagingUnitId: 'box', quantityRequested: 1, unitPrice: 700 },
  ] });
  const { svc, calls } = load({ request: req });
  await assert.rejects(svc.approve('sr1', { id: 'admin' }),
    (e) => e.statusCode === 400 && /Old Pepa is no longer active — set its line to 0/.test(e.message));
  assert.equal(calls.transfers.length, 0);

  const ok = load({ request: req });
  await ok.svc.approve('sr1', { id: 'admin' }, [{ itemId: 'i3', quantityApproved: 0 }]);
  assert.equal(ok.calls.transfers.length, 1);
  assert.deepEqual(ok.calls.transfers[0].items.map((i) => i.productId), ['p1']);
});

// ── the same number at the same moment ───────────────────────────────────────────────────────────────
test('a request that loses the race for its REQ number is run again and saved, once', async () => {
  const { svc, calls } = load({ createFails: ['requestNumber'] });
  const r = await svc.create('r1', { items: [line('p1', 2)] });
  assert.equal(calls.txRuns, 2);
  assert.equal(calls.created.length, 1);
  assert.match(r.requestNumber, /^REQ-\d{8}-0001$/);
  assert.equal(calls.admins.length, 1); // one "new stock request" notice, not two
});

test('an approval that loses the race for its TRF number is run again: issued once, rep told once', async () => {
  const { svc, calls } = load({ request: pendingRequest(), transferFails: ['transferNumber'] });
  await svc.approve('sr1', { id: 'admin' });
  assert.equal(calls.txRuns, 2);
  assert.equal(calls.transfers.length, 2); // the first one was rolled back with its transaction
  assert.equal(calls.users.length, 1);
});

test('any other unique clash is not retried, and the retries stop after three tries', async () => {
  const other = load({ createFails: ['email'] });
  await assert.rejects(other.svc.create('r1', { items: [line('p1', 1)] }), (e) => e.code === 'P2002');
  assert.equal(other.calls.txRuns, 1);

  const stuck = load({ createFails: ['requestNumber', 'requestNumber', 'requestNumber', 'requestNumber'] });
  await assert.rejects(stuck.svc.create('r1', { items: [line('p1', 1)] }), (e) => e.code === 'P2002');
  assert.equal(stuck.calls.txRuns, 3);
});

// ── what the rep is told ─────────────────────────────────────────────────────────────────────────────
test('a part-approval tells the rep the order, the deadline and each line as approved of requested', async () => {
  const { svc, calls } = load({ request: pendingRequest() });
  await svc.approve('sr1', { id: 'admin' }, [{ itemId: 'i1', quantityApproved: 3 }]);
  assert.equal(calls.users.length, 1);
  const n = calls.users[0];
  assert.equal(n.userId, 'rep-user');
  assert.match(n.message, /REQ-20261111-0001\) has been approved and issued, with less than you asked for on some products\. Order STL-20261111-0001, settle by 14 Nov 2026 \| 07:09 EAT\./);
  assert.equal(n.whatsapp.kind, 'STOCK_REQUEST_APPROVED');
  assert.equal(n.whatsapp.order, 'STL-20261111-0001');
  assert.deepEqual(n.whatsapp.items, [
    { name: 'Civlily Pepa Ndogo (Brown)', approved: 3, requested: 4, unit: 'Box' },
    { name: 'OHIS Pepa Kubwa (Brown)', approved: 2, requested: 2, unit: 'Box' },
  ]);
});

test('a reject reason is added under the rep\'s own note, not written over it', async () => {
  const { svc, calls } = load({ request: pendingRequest() });
  await svc.reject('sr1', { id: 'admin' }, 'not now');
  assert.equal(calls.updateMany[0].data.notes, 'rep own note\nRejected: not now');
  assert.equal(calls.updateMany[0].data.status, 'REJECTED');

  const bare = load({ request: pendingRequest() });
  await bare.svc.reject('sr1', { id: 'admin' });
  assert.equal(bare.calls.updateMany[0].data.notes, 'rep own note');

  const noNote = load({ request: pendingRequest({ notes: null }) });
  await noNote.svc.reject('sr1', { id: 'admin' }, 'not now');
  assert.equal(noNote.calls.updateMany[0].data.notes, 'Rejected: not now');
});

test('an admin\'s edit is said as the admin\'s, and the rep is told what his order is now', async () => {
  const { svc, calls } = load({ request: pendingRequest() });
  await svc.update('sr1', { items: [line('p1', 3)] }, { id: 'a1', name: 'Doctor', role: 'ADMIN' });
  assert.match(calls.admins[0].message, /^Doctor changed Minyaro's pending order — now worth TSh/);
  assert.equal(calls.users.length, 1);
  assert.equal(calls.users[0].userId, 'rep-user');
  assert.match(calls.users[0].message, /Doctor changed your pending request \(REQ-20261111-0001\)\. It is now Civlily Pepa Ndogo \(Brown\): 3 Boxes, worth TSh/);
});

test('the rep\'s own edit keeps its wording and does not message him', async () => {
  const { svc, calls } = load({ request: pendingRequest() });
  await svc.update('sr1', { items: [line('p1', 3)] }, { id: 'u', name: 'Minyaro', role: 'SALES_REP' });
  assert.match(calls.admins[0].message, /^Minyaro edited their pending order — now worth TSh/);
  assert.equal(calls.users.length, 0);
});

// ── messages and lists ──────────────────────────────────────────────────────────────────────────────
test('too many boxes: the message names the product, never the level, and has no ".." typo', async () => {
  const { svc } = load({ stock: { p1: 7, p2: 10 } });
  await assert.rejects(svc.create('r1', { items: [line('p2', 1), line('p1', 999)] }), (e) => {
    assert.equal(e.statusCode, 400);
    assert.equal(e.message, 'Not enough Civlily Pepa Ndogo (Brown) in stock — lower that line or contact the lab.');
    return true;
  });
});

test('decided=true pages only decided requests; the summary still counts the pending ones', async () => {
  const { svc, calls } = load();
  await svc.list({ decided: true }, { skip: 0, take: 15, orderBy: { requestedAt: 'desc' } });
  assert.deepEqual(calls.findMany[0].where, { status: { not: 'PENDING' } });
  assert.deepEqual(calls.count[0].where, { status: { not: 'PENDING' } });
  assert.deepEqual(calls.findMany[1].where, {}); // the summary query

  const chip = load();
  await chip.svc.list({ decided: true, status: 'PENDING' }, { skip: 0, take: 15 });
  assert.deepEqual(chip.calls.findMany[0].where, { status: 'PENDING' }); // a chosen status wins

  const rep = load();
  await rep.svc.list({ salesRepId: 'r1' }, { skip: 0, take: 100 });
  assert.deepEqual(rep.calls.findMany[0].where, { salesRepId: 'r1' }); // unchanged without the flag
});
