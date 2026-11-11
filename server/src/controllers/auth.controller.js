'use strict';

const asyncHandler = require('../utils/asyncHandler');
const { ok } = require('../utils/response');
const authService = require('../services/auth.service');
const auditService = require('../services/audit.service');

// Every refused sign-in leaves a line in the audit log (audit #102): the email tried and why it was refused
// (the address and browser come with every audit row), never the password. A refusal by the phone-only
// rule is also marked for the login limiter, which gives that try back (see auth.routes.js).
async function recordRefusedLogin(req, res, email, err) {
  if (!err || (err.statusCode !== 401 && err.statusCode !== 403)) return;
  if (err.details && err.details.reason === 'DEVICE_RESTRICTED') res.locals.deviceRestricted = true;
  await auditService.record(req, {
    action: 'LOGIN_FAILED',
    entityType: 'User',
    // A real email is at most 254 characters; the sign-in form accepts a far longer one (the body may be 2 MB),
    // so only that much is kept and a stranger cannot fill the log with each refused try.
    newValues: { email: String(email).toLowerCase().trim().slice(0, 254), reason: err.message },
  });
}

const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  let result;
  try {
    result = await authService.login(email, password, req.headers);
  } catch (err) {
    await recordRefusedLogin(req, res, email, err);
    throw err;
  }
  await auditService.record(req, {
    action: 'LOGIN',
    entityType: 'User',
    entityId: result.user.id,
  });
  return ok(res, result);
});

const refresh = asyncHandler(async (req, res) => {
  const result = await authService.refresh(req.body.refreshToken, req.headers);
  return ok(res, result);
});

const me = asyncHandler(async (req, res) => {
  const user = await authService.me(req.user.id);
  return ok(res, user);
});

const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  let result;
  try {
    result = await authService.changePassword(req.user.id, currentPassword, newPassword);
  } catch (err) {
    // A wrong current password is a guess at the password by whoever holds this session: it is written
    // down (never the password itself) and counted by the per-account limiter in auth.routes.js, which
    // counts only these (audit 11 Nov 2026, auth-device-2).
    if (err && err.statusCode === 400 && err.message === authService.WRONG_CURRENT_PASSWORD) {
      res.locals.wrongPassword = true;
      await auditService.record(req, {
        action: 'CHANGE_PASSWORD_FAILED',
        entityType: 'User',
        entityId: req.user.id,
        newValues: { reason: err.message },
      });
    }
    throw err;
  }
  await auditService.record(req, {
    action: 'CHANGE_PASSWORD',
    entityType: 'User',
    entityId: req.user.id,
  });
  return ok(res, result);
});

const logout = asyncHandler(async (req, res) => {
  // Stateless JWT: the client discards the token. We still audit the event —
  // and why: 'idle' when the app signed the person out for not using it
  // (10 Nov 2026), 'manual' for everything else, including old clients that
  // send no body.
  const reason = req.body && req.body.reason === 'idle' ? 'idle' : 'manual';
  await auditService.record(req, {
    action: 'LOGOUT',
    entityType: 'User',
    entityId: req.user.id,
    newValues: { reason },
  });
  return ok(res, { success: true });
});

module.exports = { login, refresh, me, changePassword, logout };
