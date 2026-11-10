'use strict';

const bcrypt = require('bcryptjs');
const prisma = require('../config/prisma');
const env = require('../config/env');
const ApiError = require('../utils/ApiError');
const { signAccessToken, signRefreshToken, verifyRefreshToken } = require('../utils/tokens');
const notification = require('./notification.service');

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
    salesRep: user.salesRep || null,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
  };
}

function issueTokens(user) {
  const payload = { sub: user.id, role: user.role.name };
  return {
    accessToken: signAccessToken(payload),
    refreshToken: signRefreshToken({ sub: user.id }),
    expiresIn: env.jwt.expiresIn,
  };
}

async function login(email, password) {
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

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  return { user: publicUser(user), tokens: issueTokens(user) };
}

async function refresh(refreshToken) {
  let decoded;
  try {
    decoded = verifyRefreshToken(refreshToken);
  } catch {
    throw ApiError.unauthorized('Invalid or expired refresh token');
  }

  const user = await prisma.user.findUnique({
    where: { id: decoded.sub },
    include: { role: { include: { permissions: true } } },
  });
  if (!user || !user.isActive) throw ApiError.unauthorized('Account not found or deactivated');

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
  await prisma.user.update({ where: { id: userId }, data: { passwordHash } });

  notification.notifyUser(userId, {
    type: 'GENERAL',
    severity: 'WARNING',
    title: 'Password changed',
    message: 'Your account password was changed. If you did not do this, contact your administrator immediately.',
    whatsapp: { kind: 'PASSWORD_CHANGED' },
    entityType: 'User',
    entityId: userId,
  }).catch(() => {});

  return { success: true };
}

module.exports = { login, refresh, me, changePassword, publicUser, issueTokens };
