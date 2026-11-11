'use strict';

// ── The morning check never fails in silence (audit #125, 11 Nov 2026) ────────────────────────────────
// Pinned: if flagging overdue orders, the reminders or the fines fail, the admins get a CRITICAL alert
// and the run answers 500; a best-effort sub-job that fails is logged by name and the run carries on.

const test = require('node:test');
const assert = require('node:assert/strict');

const stub = (rel, exports) => {
  const f = require.resolve(rel);
  require.cache[f] = { id: f, filename: f, loaded: true, exports };
};

const alerts = [];
const state = {};
stub('../src/services/settlement.service', {
  refreshOverdue: async () => { if (state.overdueFails) throw new Error('db timeout'); return { flagged: 1 }; },
  sendDueReminders: async () => ({ sent: 0 }),
});
stub('../src/services/penalty.service', { applyDuePenalties: async () => ({ applied: 0 }) });
stub('../src/services/returns.service', { expireStaleReturns: async () => ({ expired: 0 }) });
stub('../src/services/notification.service', { notifyAdmins: async (n) => { alerts.push(n); } });
stub('../src/services/whatsappNotify.service', {
  scanStockAlerts: async () => { if (state.stockFails) throw new Error('alert scan broke'); return { scanned: 3 }; },
  flush: async () => ({ sent: 0 }),
  catchUpReports: async () => ({ sent: [] }),
});

delete process.env.CRON_SECRET;
const router = require('../src/routes/cron.routes');

function sweep() {
  const layer = router.stack.find((l) => l.route && l.route.path === '/settlement-sweep');
  const handler = layer.route.stack[layer.route.stack.length - 1].handle;
  return new Promise((resolve, reject) => {
    const res = { code: 200, status(c) { this.code = c; return this; }, json(body) { resolve({ code: this.code, body }); return this; } };
    handler({ query: {}, headers: {} }, res, reject);
  });
}

function captureErrors(t) {
  const logged = [];
  t.mock.method(console, 'error', (...args) => { logged.push(args.join(' ')); });
  return logged;
}

test('the sweep failing raises a CRITICAL alert for the admins and answers 500', async (t) => {
  const logged = captureErrors(t);
  Object.assign(state, { overdueFails: true, stockFails: false });
  alerts.length = 0;
  const { code, body } = await sweep();
  assert.equal(code, 500);
  assert.equal(body.success, false);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].severity, 'CRITICAL');
  assert.match(alerts[0].message, /db timeout/);
  assert.ok(logged.some((l) => /settlement-sweep/.test(l) && /db timeout/.test(l)));
});

test('a best-effort sub-job that fails is logged by name; the sweep still answers', async (t) => {
  const logged = captureErrors(t);
  Object.assign(state, { overdueFails: false, stockFails: true });
  alerts.length = 0;
  const { code, body } = await sweep();
  assert.equal(code, 200);
  assert.equal(body.success, true);
  assert.equal(body.data.stockAlerts, null);
  assert.deepEqual(body.data.overdue, { flagged: 1 });
  assert.equal(alerts.length, 0);
  assert.ok(logged.some((l) => /stock alerts/.test(l) && /alert scan broke/.test(l)), 'the failure left no trace');
});
