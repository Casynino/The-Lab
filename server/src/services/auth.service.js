'use strict';

const bcrypt = require('bcryptjs');
const prisma = require('../config/prisma');
const env = require('../config/env');
const ApiError = require('../utils/ApiError');
const { signAccessToken, signRefreshToken, verifyRefreshToken } = require('../utils/tokens');
const notification = require('./notification.service');
const { assertDeviceAllowed } = require('../utils/device');

// Shape the user object returned to clients (never leak the password hash).
function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    isActive: user.isActive,
    role: user.role ? user.role.name : null,
    roleId: user.roleId,
    permissions: user.role ? user.role.permissions.map((p) => p.key) : [],
    warehouseId: user.warehouseId,
    warehouse: user.warehouse || null,
    salesRepId: user.salesRep ? user.salesRep.id : null,
    // never the rep's own WhatsApp API key: the app has no use for it
    salesRep: user.salesRep ? { ...user.salesRep, whatsappApiKey: undefined } : null,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
  };
}

// `sv` is the account's session version: a token issued before a password change (or reset, role change,
// deactivation) carries an older number and is refused.
function issueTokens(user) {
  const sv = user.sessionVersion || 0;
  const payload = { sub: user.id, role: user.role.name, sv };
  return {
    accessToken: signAccessToken(payload),
    refreshToken: signRefreshToken({ sub: user.id, sv }),
    expiresIn: env.jwt.expiresIn,
  };
}

// A SALES_REP account with no rep profile would see nothing of its own and, through every "my" list, could
// be shown everyone's; it is refused until the profile exists.
function assertRepProfile(user) {
  if (user.role && user.role.name === 'SALES_REP' && !user.salesRep) {
    throw ApiError.forbidden('This account has no sales-rep profile yet. Ask ZELab to finish setting it up.');
  }
}

async function login(email, password, headers = {}) {
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase().trim() },
    include: {
      role: { include: { permissions: true } },
      salesRep: true,
      warehouse: true,
    },
  });

  // Constant-ish failure path: do not reveal whether the email exists.
  if (!user) throw ApiError.unauthorized('Invalid email or password');
  if (!user.isActive) throw ApiError.forbidden('Your account has been deactivated');

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) throw ApiError.unauthorized('Invalid email or password');

  // Only after the password is right, so the device rule never tells a stranger which emails are reps.
  assertRepProfile(user);
  assertDeviceAllowed(user.role.name, headers, ApiError);

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  return { user: publicUser(user), tokens: issueTokens(user) };
}

async function refresh(refreshToken, headers = {}) {
  let decoded;
  try {
    decoded = verifyRefreshToken(refreshToken);
  } catch {
    throw ApiError.unauthorized('Invalid or expired refresh token');
  }

  const user = await prisma.user.findUnique({
    where: { id: decoded.sub },
    include: { role: { include: { permissions: true } }, salesRep: { select: { id: true } } },
  });
  if (!user || !user.isActive) throw ApiError.unauthorized('Account not found or deactivated');
  if ((decoded.sv || 0) !== (user.sessionVersion || 0)) throw ApiError.unauthorized('Your session has ended. Please sign in again.');
  assertRepProfile(user);
  assertDeviceAllowed(user.role.name, headers, ApiError);

  return { tokens: issueTokens(user) };
}

async function me(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      role: { include: { permissions: true } },
      salesRep: true,
      warehouse: true,
    },
  });
  if (!user) throw ApiError.notFound('User not found');
  return publicUser(user);
}

async function changePassword(userId, currentPassword, newPassword) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw ApiError.notFound('User not found');

  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) throw ApiError.badRequest('Current password is incorrect');

  const passwordHash = await bcrypt.hash(newPassword, env.bcryptSaltRounds);
  // Every other session ends; this device gets fresh tokens so it stays signed in.
  const updated = await prisma.user.update({
    where: { id: userId },
    data: { passwordHash, sessionVersion: { increment: 1 } },
    include: { role: true },
  });

  notification.notifyUser(userId, {
    type: 'GENERAL',
    severity: 'WARNING',
    title: 'Password changed',
    message: 'Your account password was changed. If you did not do this, contact your administrator immediately.',
    whatsapp: { kind: 'PASSWORD_CHANGED' },
    entityType: 'User',
    entityId: userId,
  }).catch(() => {});

  return { success: true, tokens: issueTokens(updated) };
}

module.exports = { login, refresh, me, changePassword, publicUser, issueTokens };
