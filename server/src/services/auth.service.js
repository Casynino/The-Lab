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

// A rep suspended from his rep profile (Sales reps > Suspend) is refused like a deactivated login. Only rep
// accounts: the flag belongs to the rep profile, never to the owner or staff (audit #101, 11 Nov 2026).
function repSuspended(user) {
  return !!(user.role && user.role.name === 'SALES_REP' && user.salesRep && user.salesRep.isActive === false);
}

// An email with no account is still checked against a password hash of the same cost, made once, so it
// takes as long to refuse as a wrong password and the answer time does not tell which emails exist (#131).
let noAccountHash = null;
async function passwordMatches(user, password) {
  if (user) return bcrypt.compare(password, user.passwordHash);
  if (!noAccountHash) noAccountHash = await bcrypt.hash('no account has this password', env.bcryptSaltRounds);
  await bcrypt.compare(password, noAccountHash);
  return false;
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

  // The password first, for every email: a wrong one gets the same answer whether the account exists, is
  // deactivated or suspended — those are told only to someone who knows the password (#131).
  const valid = await passwordMatches(user, password);
  if (!valid) throw ApiError.unauthorized('Invalid email or password');
  if (!user.isActive) throw ApiError.forbidden('Your account has been deactivated');

  // Only after the password is right, so the device rule never tells a stranger which emails are reps.
  assertRepProfile(user);
  if (repSuspended(user)) throw ApiError.forbidden('Your sales-rep account is suspended. Ask ZELab to reactivate it.');
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
    include: { role: { include: { permissions: true } }, salesRep: { select: { id: true, isActive: true } } },
  });
  if (!user || !user.isActive) throw ApiError.unauthorized('Account not found or deactivated');
  if ((decoded.sv || 0) !== (user.sessionVersion || 0)) throw ApiError.unauthorized('Your session has ended. Please sign in again.');
  assertRepProfile(user);
  if (repSuspended(user)) throw ApiError.unauthorized('Your sales-rep account is suspended');
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

const WRONG_CURRENT_PASSWORD = 'Current password is incorrect';

async function changePassword(userId, currentPassword, newPassword) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw ApiError.notFound('User not found');

  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) throw ApiError.badRequest(WRONG_CURRENT_PASSWORD);

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

module.exports = { login, refresh, me, changePassword, publicUser, issueTokens, WRONG_CURRENT_PASSWORD };
