'use strict';

// ── Warehouse staff get the approvals they can do in their own bell (audit staff-settings-2) ────────
// Staff approve stock requests, returns and settlements, yet every such alert was written once with
// userId null, which only an admin can see, so the staff bell was always empty. An alert flagged
// `forStaff` now also gets one row per active staff member (his own read state); unflagged ones —
// every money alert (withdrawals, fines, bonuses) — stay the owner's only.

const test = require('node:test');
const assert = require('node:assert/strict');

function load({ staff = [{ id: 's1' }, { id: 's2' }], failStaff = false } = {}) {
  const calls = { create: [], createMany: [], userWhere: [] };
  const prisma = {
    notification: {
      create: async ({ data }) => { calls.create.push(data); return { id: 'n1', ...data }; },
      createMany: async ({ data }) => { calls.createMany.push(...data); return { count: data.length }; },
    },
    user: {
      findMany: async ({ where }) => { calls.userWhere.push(where); if (failStaff) throw new Error('db down'); return staff; },
    },
  };
  const f = require.resolve('../src/config/prisma');
  require.cache[f] = { id: f, filename: f, loaded: true, exports: prisma };
  delete require.cache[require.resolve('../src/services/notification.service')];
  return { svc: require('../src/services/notification.service'), calls };
}

const alert = { type: 'GENERAL', severity: 'INFO', title: 'New stock request: REQ-1', message: 'Juma requested stock.', entityType: 'StockRequest', entityId: 'sr1' };

test('a forStaff alert: the owner\'s notice, plus one row for each active staff member', async () => {
  const { svc, calls } = load();
  const created = await svc.notifyAdmins({ ...alert, forStaff: true });
  assert.equal(created.userId, null);
  assert.deepEqual(calls.create, [{ ...alert, userId: null }]); // the flag never reaches the table
  assert.deepEqual(calls.createMany, [{ ...alert, userId: 's1' }, { ...alert, userId: 's2' }]);
  assert.deepEqual(calls.userWhere[0], { isActive: true, role: { name: 'WAREHOUSE_STAFF' } });
});

test('an alert without the flag (every money alert) stays the owner\'s only', async () => {
  const { svc, calls } = load();
  await svc.notifyAdmins({ ...alert, title: 'Commission withdrawal requested' });
  assert.equal(calls.create.length, 1);
  assert.equal(calls.createMany.length, 0);
  assert.equal(calls.userWhere.length, 0);
});

test('a failed staff copy never undoes the owner\'s notice', async () => {
  const { svc, calls } = load({ failStaff: true });
  const created = await svc.notifyAdmins({ ...alert, forStaff: true });
  assert.equal(created.id, 'n1');
  assert.equal(calls.create.length, 1);
});

test('the approvals staff can do are flagged; money alerts are not', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = (f) => fs.readFileSync(path.join(__dirname, '../src/services', f), 'utf8');
  // Each notifyAdmins({ ... }) block with its title, and whether it carries the flag.
  const blocks = (f) => [...src(f).matchAll(/notifyAdmins\(\{([\s\S]*?)\}\)/g)].map((m) => ({
    title: (m[1].match(/title: ([^\n]+)/) || [])[1] || '',
    forStaff: /forStaff: true/.test(m[1]),
  }));
  const flagged = (f) => blocks(f).filter((b) => b.forStaff).length;
  assert.equal(flagged('stockRequest.service.js'), 3); // new, updated, cancelled
  assert.equal(flagged('returns.service.js'), 3); // approval required, cancelled, expired
  assert.equal(flagged('settlementSubmission.service.js'), 2); // one product, several products
  for (const f of ['commission.service.js', 'penalty.service.js', 'bonus.service.js', 'settlement.service.js', 'whatsappNotify.service.js']) {
    assert.equal(flagged(f), 0, `${f} must not copy alerts to staff`);
  }
});

// ── Low and out-of-stock alerts reach the staff bell too (review, 12 Nov 2026) ──────────────────────
// Staff look after the stock. A LOW_STOCK alert is one owner row plus one row per active staff member,
// and the unread check is per recipient, so one person's unread copy never blocks another's.
function loadTable({ staff = [{ id: 's1' }, { id: 's2' }] } = {}) {
  const rows = [];
  const mirrored = [];
  const match = (r, where) => Object.entries(where).every(([k, v]) => r[k] === v);
  const prisma = {
    notification: {
      findFirst: async ({ where }) => rows.find((r) => match(r, where)) || null,
      create: async ({ data }) => { const r = { id: `n${rows.length + 1}`, isRead: false, userId: null, ...data }; rows.push(r); return r; },
    },
    user: { findMany: async () => staff },
  };
  const f = require.resolve('../src/config/prisma');
  require.cache[f] = { id: f, filename: f, loaded: true, exports: prisma };
  const w = require.resolve('../src/services/whatsappNotify.service');
  require.cache[w] = { id: w, filename: w, loaded: true, exports: { background: () => {}, mirrorToRep: async (userId) => { mirrored.push(userId); } } };
  delete require.cache[require.resolve('../src/services/notification.service')];
  return { svc: require('../src/services/notification.service'), rows, mirrored };
}

const low = { type: 'LOW_STOCK', severity: 'WARNING', title: 'Low stock: Pepa', message: 'Pepa has 2 box(es) remaining.', entityType: 'Product', entityId: 'p1' };

test('a low-stock alert: one owner row and one row for each active staff member', async () => {
  const { svc, rows } = loadTable();
  await svc.stockAlert(low);
  assert.deepEqual(rows.map((r) => r.userId), [null, 's1', 's2']);
  assert.ok(rows.every((r) => r.title === low.title && r.entityId === 'p1'));
});

test('the unread check is per recipient: a staff copy never blocks the owner\'s alert, nor the other way round', async () => {
  const { svc, rows } = loadTable();
  await svc.stockAlert(low);
  await svc.stockAlert(low); // all three still unread: nothing new
  assert.equal(rows.length, 3);

  rows[0].isRead = true; // the owner read his; the staff did not
  await svc.stockAlert(low);
  assert.deepEqual(rows.map((r) => r.userId), [null, 's1', 's2', null]);

  rows[1].isRead = true; // s1 read his; the owner's new copy and s2's are unread
  await svc.stockAlert(low);
  assert.deepEqual(rows.map((r) => r.userId), [null, 's1', 's2', null, 's1']);
});

test('a scan passes the staff it loaded once, and no staff means the owner\'s row only', async () => {
  const { svc, rows } = loadTable({ staff: [] });
  await svc.stockAlert(low);
  assert.deepEqual(rows.map((r) => r.userId), [null]);
  await svc.stockAlert({ ...low, entityId: 'p2' }, ['s9']);
  assert.deepEqual(rows.map((r) => r.userId), [null, null, 's9']);
});
