'use strict';

const asyncHandler = require('../utils/asyncHandler');
const { ok } = require('../utils/response');
const authService = require('../services/auth.service');
const auditService = require('../services/audit.service');

const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const result = await authService.login(email, password);
  await auditService.record(req, {
    action: 'LOGIN',
    entityType: 'User',
    entityId: result.user.id,
  });
  return ok(res, result);
});

const refresh = asyncHandler(async (req, res) => {
  const result = await authService.refresh(req.body.refreshToken);
  return ok(res, result);
});

const me = asyncHandler(async (req, res) => {
  const user = await authService.me(req.user.id);
  return ok(res, user);
});

const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const result = await authService.changePassword(req.user.id, currentPassword, newPassword);
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
