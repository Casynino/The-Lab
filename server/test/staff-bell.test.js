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
