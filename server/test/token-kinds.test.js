'use strict';

// A renewal (refresh) key must never open the API, and a sign-in (access) key must never buy new keys —
// even when both are signed with the same secret, which is how live runs (JWT_REFRESH_SECRET is not set;
// audit #55, 11 Nov 2026). Keys issued before the change (no `typ`) keep working for what they are.
// Run with: npm test

const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

const SAME = 'one-secret-for-both';
const envStub = { jwt: { secret: SAME, refreshSecret: SAME, expiresIn: '7d', refreshExpiresIn: '30d' } };
require.cache[require.resolve('../src/config/env')] = { id: 'env', filename: 'env', loaded: true, exports: envStub };
const tokens = require('../src/utils/tokens');

const user = { sub: 'u1', sv: 0 };

test('a renewal key is refused as a sign-in key, even signed with the same secret', () => {
  const refresh = tokens.signRefreshToken(user);
  assert.throws(() => tokens.verifyAccessToken(refresh), /not a sign-in key/);
});

test('a sign-in key is refused as a renewal key', () => {
  const access = tokens.signAccessToken({ ...user, role: 'SALES_REP' });
  assert.throws(() => tokens.verifyRefreshToken(access), /not a renewal key/);
});

test('each key still works for what it is, and says what it is', () => {
  const access = tokens.signAccessToken({ ...user, role: 'ADMIN' });
  const refresh = tokens.signRefreshToken(user);
  assert.equal(tokens.verifyAccessToken(access).role, 'ADMIN');
  assert.equal(tokens.verifyAccessToken(access).typ, 'access');
  assert.equal(tokens.verifyRefreshToken(refresh).sub, 'u1');
  assert.equal(tokens.verifyRefreshToken(refresh).typ, 'refresh');
});

test('keys issued before the change (no typ) keep working for their own kind only — nobody is signed out', () => {
  // exactly the shapes issueTokens produced before 11 Nov 2026
  const oldAccess = jwt.sign({ sub: 'u1', role: 'SALES_REP', sv: 0 }, SAME, { expiresIn: '7d' });
  const oldRefresh = jwt.sign({ sub: 'u1', sv: 0 }, SAME, { expiresIn: '30d' });
  const olderRefresh = jwt.sign({ sub: 'u1' }, SAME, { expiresIn: '30d' });
  assert.equal(tokens.verifyAccessToken(oldAccess).sub, 'u1');
  assert.equal(tokens.verifyRefreshToken(oldRefresh).sub, 'u1');
  assert.equal(tokens.verifyRefreshToken(olderRefresh).sub, 'u1');
  assert.throws(() => tokens.verifyAccessToken(oldRefresh), /not a sign-in key/);
  assert.throws(() => tokens.verifyAccessToken(olderRefresh), /not a sign-in key/);
  assert.throws(() => tokens.verifyRefreshToken(oldAccess), /not a renewal key/);
});

test('an expired or tampered key is still refused as before', () => {
  const expired = jwt.sign({ sub: 'u1', role: 'ADMIN', typ: 'access' }, SAME, { expiresIn: -10 });
  assert.throws(() => tokens.verifyAccessToken(expired), /expired/);
  const forged = jwt.sign({ sub: 'u1', role: 'ADMIN', typ: 'access' }, 'someone-elses-secret');
  assert.throws(() => tokens.verifyAccessToken(forged), /invalid signature/);
});
