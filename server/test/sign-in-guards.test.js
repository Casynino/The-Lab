'use strict';

// ── Signing in: who is refused, what they are told, what is written down (audit 11 Nov 2026) ─────────
// #131 A wrong password gets one answer for every email — an unknown, deactivated or suspended account is
//      told apart only after the right password — and an unknown email still runs a password check.
// #101 A rep suspended from his rep profile can no longer sign in, renew his session or use an old one;
//      reactivating him gives it all back. Only rep accounts are affected.
// #102 Every refused sign-in is in the audit log (never the password), and a rep refused by the
//      phone-only rule does not use up the login tries of everyone behind the same address.
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
const counts = { compare: 0 };
stub('bcryptjs', { ...realBcrypt, compare: async (...a) => { counts.compare += 1; return realBcrypt.compare(...a); } });

const PASSWORD = 'right-password';
const hash = realBcrypt.hashSync(PASSWORD, 4);
const role = (name) => ({ name, permissions: [] });
const people = [
  { id: 'a1', email: 'owner@zelab.test', role: role('ADMIN'), salesRep: null },
  { id: 's1', email: 'left@zelab.test', role: role('WAREHOUSE_STAFF'), salesRep: null, isActive: false },
  { id: 'r1', email: 'rep@zelab.test', role: role('SALES_REP'), salesRep: { id: 'sr1', isActive: true } },
  { id: 'r2', email: 'suspended@zelab.test', role: role('SALES_REP'), salesRep: { id: 'sr2', isActive: false } },
  // an owner login that once had a rep profile, since suspended: the owner is never locked out by it
  { id: 'a2', email: 'owner2@zelab.test', role: role('ADMIN'), salesRep: { id: 'sr3', isActive: false } },
].map((u) => ({ isActive: true, sessionVersion: 0, passwordHash: hash, warehouseId: null, ...u }));

stub('../src/config/prisma', {
  user: {
    findUnique: async ({ where }) => people.find((u) => (where.id ? u.id === where.id : u.email === where.email)) || null,
    update: async () => ({}),
  },
});
stub('../src/services/notification.service', { notifyUser: async () => {}, notifyAdmins: async () => {} });
const audits = [];
stub('../src/services/audit.service', { record: async (req, entry) => { audits.push({ ...entry, by: req?.user?.id || null }); }, log: async () => {} });

const auth = require('../src/services/auth.service');
const tokens = require('../src/utils/tokens');
const { authenticate } = require('../src/middleware/auth');

const PHONE = { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1' };
const COMPUTER = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36' };
const refusedWith = (status, message) => (e) => e.statusCode === status && (!message || message.test(e.message));
const person = (id) => people.find((u) => u.id === id);

test('#131 a wrong password gets the same answer for an unknown, a deactivated and a suspended account', async () => {
  for (const email of ['nobody@zelab.test', 'left@zelab.test', 'suspended@zelab.test', 'owner@zelab.test']) {
    await assert.rejects(auth.login(email, 'wrong', PHONE), refusedWith(401, /^Invalid email or password$/), email);
  }
});

test('#131 an email with no account still runs a password check (answer time does not give it away)', async () => {
  const before = counts.compare;
  await assert.rejects(auth.login('nobody@zelab.test', 'wrong', PHONE), refusedWith(401));
  assert.equal(counts.compare - before, 1);
  // and the made-up hash never lets anything in, even its own text
  await assert.rejects(auth.login('nobody@zelab.test', 'no account has this password', PHONE), refusedWith(401));
});

test('#131/#101 with the right password: deactivated and suspended are told why; an active rep signs in', async () => {
  await assert.rejects(auth.login('left@zelab.test', PASSWORD, COMPUTER), refusedWith(403, /deactivated/));
  await assert.rejects(auth.login('suspended@zelab.test', PASSWORD, PHONE), refusedWith(403, /suspended/));
  const ok = await auth.login('rep@zelab.test', PASSWORD, PHONE);
  assert.equal(ok.user.salesRepId, 'sr1');
  assert.ok(ok.tokens.accessToken);
  // the owner always signs in, even with a suspended rep profile on the login
  assert.equal((await auth.login('owner2@zelab.test', PASSWORD, COMPUTER)).user.role, 'ADMIN');
});

test('#101 a suspended rep cannot renew his session; reactivated, he can again', async () => {
  const refresh = tokens.signRefreshToken({ sub: 'r2', sv: 0 });
  await assert.rejects(auth.refresh(refresh, PHONE), refusedWith(401, /suspended/));
  person('r2').salesRep.isActive = true;
  try {
    assert.ok((await auth.refresh(refresh, PHONE)).tokens.accessToken);
  } finally {
    person('r2').salesRep.isActive = false;
  }
  assert.ok((await auth.refresh(tokens.signRefreshToken({ sub: 'r1', sv: 0 }), PHONE)).tokens.accessToken);
});

test('#101 a session from before the suspension stops at once; other accounts are untouched', async () => {
  const run = (id, headers) => new Promise((resolve) => {
    const req = { headers: { ...headers, authorization: `Bearer ${tokens.signAccessToken({ sub: id, role: person(id).role.name, sv: 0 })}` } };
    authenticate(req, {}, (err) => resolve({ err, user: req.user }));
  });
  const suspended = await run('r2', PHONE);
  assert.equal(suspended.err.statusCode, 401);
  assert.match(suspended.err.message, /suspended/);
  assert.equal((await run('r1', PHONE)).user.salesRepId, 'sr1');
  assert.equal((await run('a2', COMPUTER)).user.role, 'ADMIN');
});

// The real /api/auth router behind a real HTTP server, one fresh login limiter per app.
async function withApp(fn) {
  delete require.cache[require.resolve('../src/routes/auth.routes')];
  const app = express();
  app.use(express.json());
  app.use('/api/auth', require('../src/routes/auth.routes'));
  app.use(require('../src/middleware/errorHandler'));
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const url = `http://127.0.0.1:${server.address().port}/api/auth/login`;
  const login = async (email, password, headers) => {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ email, password }) });
    return { status: res.status, body: await res.json() };
  };
  try { await fn(login); } finally { await new Promise((r) => server.close(r)); }
}

test('#102 a rep refused by the phone-only rule does not use up the login tries; each refusal is audited', async () => {
  audits.length = 0;
  await withApp(async (login) => {
    for (let i = 0; i < 25; i += 1) {
      const r = await login('Rep@zelab.test', PASSWORD, COMPUTER);
      assert.equal(r.status, 403, `try ${i + 1}`);
      assert.equal(r.body.error.details.reason, 'DEVICE_RESTRICTED');
    }
    // the address still has every one of its tries: a typo after all that is a plain 401, not "too many"
    assert.equal((await login('owner@zelab.test', 'typo', COMPUTER)).status, 401);
  });
  const refused = audits.filter((a) => a.action === 'LOGIN_FAILED');
  assert.equal(refused.length, 26);
  assert.deepEqual(refused[0].newValues.email, 'rep@zelab.test');
  assert.match(refused[0].newValues.reason, /mobile phone/);
  assert.equal(refused[25].newValues.reason, 'Invalid email or password');
  assert.ok(!JSON.stringify(audits).includes(PASSWORD), 'a password is never written down');
  assert.ok(!JSON.stringify(audits).includes('typo'), 'not even a wrong one');
});

test('#102 a refused sign-in keeps at most 254 characters of the email typed', async () => {
  audits.length = 0;
  const long = `${'a'.repeat(5000)}@zelab.test`;
  await withApp(async (login) => assert.equal((await login(long, 'wrong', COMPUTER)).status, 401));
  const refused = audits.filter((a) => a.action === 'LOGIN_FAILED');
  assert.equal(refused.length, 1);
  assert.equal(refused[0].newValues.email, long.slice(0, 254));
});

test('#102 wrong passwords still count: the 21st try in 15 minutes is refused as before', async () => {
  audits.length = 0;
  await withApp(async (login) => {
    for (let i = 0; i < 20; i += 1) assert.equal((await login('owner@zelab.test', `guess-${i}`, COMPUTER)).status, 401);
    assert.equal((await login('owner@zelab.test', PASSWORD, COMPUTER)).status, 429);
  });
  assert.equal(audits.filter((a) => a.action === 'LOGIN_FAILED').length, 20);
  // a successful sign-in is still recorded as LOGIN (fresh limiter)
  audits.length = 0;
  await withApp(async (login) => assert.equal((await login('owner@zelab.test', PASSWORD, COMPUTER)).status, 200));
  assert.deepEqual(audits.map((a) => a.action), ['LOGIN']);
  // the person who signed in is the one who did it (admin-system-6: the log read "The system signed in")
  assert.equal(audits[0].by, 'a1');
});
