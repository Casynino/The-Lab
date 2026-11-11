'use strict';

// ── Change password: a limit on wrong current passwords, and every wrong one written down ─────────────
// auth-device-2 (audit 11 Nov 2026): whoever held a session could guess the account's password through
// Profile > Change password at the global rate (500 per 15 minutes per address), with nothing in the audit
// log; one right guess gave them the password and signed the real owner out everywhere.
// Now: 5 wrong current passwords per account in 15 minutes, then 429 (even for the right one), whatever
// address they come from; each wrong one is an audit row (never the password). A typo in the new password
// and a successful change do not use a try.
// Run with: npm test

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const realBcrypt = require('bcryptjs');

const stub = (rel, exports) => { const f = require.resolve(rel); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };

stub('../src/config/env', {
  isProd: false, logLevel: 'error', bcryptSaltRounds: 4,
  jwt: { secret: 'test-secret', refreshSecret: 'test-secret', expiresIn: '7d', refreshExpiresIn: '30d' },
});

const PASSWORD = 'right-password';
const hash = realBcrypt.hashSync(PASSWORD, 4);
const people = ['u1', 'u2'].map((id) => ({
  id, email: `${id}@zelab.test`, isActive: true, sessionVersion: 0, passwordHash: hash, warehouseId: null,
  role: { name: 'WAREHOUSE_STAFF', permissions: [] }, salesRep: null,
}));
stub('../src/config/prisma', {
  user: {
    findUnique: async ({ where }) => people.find((u) => u.id === where.id) || null,
    // The password is not really changed, so every test can use the same one.
    update: async ({ where }) => people.find((u) => u.id === where.id),
  },
});
stub('../src/services/notification.service', { notifyUser: async () => {}, notifyAdmins: async () => {} });
const audits = [];
stub('../src/services/audit.service', { record: async (_req, entry) => { audits.push(entry); }, log: async () => {} });

const tokens = require('../src/utils/tokens');

const COMPUTER = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36' };

// The real /api/auth router behind a real HTTP server, with a fresh limiter each time.
async function withApp(fn) {
  delete require.cache[require.resolve('../src/routes/auth.routes')];
  const app = express();
  app.use(express.json());
  app.use('/api/auth', require('../src/routes/auth.routes'));
  app.use(require('../src/middleware/errorHandler'));
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const url = `http://127.0.0.1:${server.address().port}/api/auth/change-password`;
  const change = async (userId, currentPassword, newPassword = 'a-new-password', extra = {}) => {
    const token = tokens.signAccessToken({ sub: userId, role: 'WAREHOUSE_STAFF', sv: 0 });
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...COMPUTER, ...extra },
      body: JSON.stringify({ currentPassword, newPassword, confirmPassword: newPassword }),
    });
    return { status: res.status, body: await res.json() };
  };
  try { await fn(change); } finally { await new Promise((r) => server.close(r)); }
}

test('5 wrong current passwords, then even the right one waits; each wrong one is in the audit log', async () => {
  audits.length = 0;
  await withApp(async (change) => {
    for (let i = 0; i < 5; i += 1) {
      const r = await change('u1', `guess-${i}`);
      assert.equal(r.status, 400, `try ${i + 1}`);
      assert.equal(r.body.error.message, 'Current password is incorrect');
    }
    const blocked = await change('u1', PASSWORD);
    assert.equal(blocked.status, 429);
    assert.match(blocked.body.error.message, /Too many wrong passwords/);
    // another account is not held up by it
    assert.equal((await change('u2', PASSWORD)).status, 200);
  });
  const failed = audits.filter((a) => a.action === 'CHANGE_PASSWORD_FAILED');
  assert.equal(failed.length, 5);
  assert.equal(failed[0].entityId, 'u1');
  assert.ok(!JSON.stringify(audits).includes('guess-'), 'a tried password is never written down');
  assert.ok(!JSON.stringify(audits).includes(PASSWORD), 'nor the real one');
  assert.deepEqual(audits.filter((a) => a.action === 'CHANGE_PASSWORD').map((a) => a.entityId), ['u2']);
});

test('the count is per account, not per address: a new address does not reset it', async () => {
  await withApp(async (change) => {
    for (let i = 0; i < 5; i += 1) {
      assert.equal((await change('u1', `guess-${i}`, undefined, { 'x-forwarded-for': `10.0.0.${i}` })).status, 400);
    }
    assert.equal((await change('u1', PASSWORD, undefined, { 'x-forwarded-for': '10.9.9.9' })).status, 429);
  });
});

test('a typo in the new password and a successful change do not use up a try', async () => {
  audits.length = 0;
  await withApp(async (change) => {
    for (let i = 0; i < 6; i += 1) {
      const r = await change('u1', PASSWORD, 'short');
      assert.ok(r.status >= 400 && r.status !== 429, `typo ${i + 1}: ${r.status}`);
    }
    for (let i = 0; i < 6; i += 1) assert.equal((await change('u1', PASSWORD)).status, 200, `change ${i + 1}`);
    for (let i = 0; i < 4; i += 1) assert.equal((await change('u1', `guess-${i}`)).status, 400);
    assert.equal((await change('u1', PASSWORD)).status, 200, 'four wrong tries still leave the right one through');
  });
  assert.equal(audits.filter((a) => a.action === 'CHANGE_PASSWORD_FAILED').length, 4);
});
