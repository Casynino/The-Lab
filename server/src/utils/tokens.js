'use strict';

const jwt = require('jsonwebtoken');
const env = require('../config/env');

// Which kind of key is this? A sign-in (access) key opens the API for 7 days; a renewal (refresh) key only
// buys new keys, for 30 days. The two used to be told apart by nothing but their secret — and on live the
// renewal secret (JWT_REFRESH_SECRET) is not set, so both are signed with JWT_SECRET and a renewal key worked
// as a sign-in key (audit #55, 11 Nov 2026). Now every key says what it is (`typ`), and a key from before
// this change is told apart by the role: every sign-in key ever issued carries the account's role and no
// renewal key ever has. Nobody is signed out by this change.
const isRefreshShaped = (p) => !!p && (p.typ === 'refresh' || (p.typ == null && p.role == null));

function signAccessToken(payload) {
  return jwt.sign({ ...payload, typ: 'access' }, env.jwt.secret, { expiresIn: env.jwt.expiresIn });
}

function signRefreshToken(payload) {
  return jwt.sign({ ...payload, typ: 'refresh' }, env.jwt.refreshSecret, {
    expiresIn: env.jwt.refreshExpiresIn,
  });
}

function verifyAccessToken(token) {
  const payload = jwt.verify(token, env.jwt.secret);
  if (isRefreshShaped(payload)) throw new jwt.JsonWebTokenError('a renewal key is not a sign-in key');
  return payload;
}

function verifyRefreshToken(token) {
  const payload = jwt.verify(token, env.jwt.refreshSecret);
  if (!isRefreshShaped(payload)) throw new jwt.JsonWebTokenError('a sign-in key is not a renewal key');
  return payload;
}

module.exports = {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
};
