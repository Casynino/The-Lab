'use strict';

const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { verifyAccessToken } = require('../utils/tokens');
const { assertDeviceAllowed } = require('../utils/device');

// Authenticate a request from its `Authorization: Bearer <token>` header.
// Loads the live user (with role + permissions + sales-rep profile) so that
// deactivated users or revoked roles are rejected immediately.
const authenticate = asyncHandler(async (req, _res, next) => {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    throw ApiError.unauthorized('Authentication token missing');
  }

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch {
    throw ApiError.unauthorized('Invalid or expired token');
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    include: {
      role: { include: { permissions: true } },
      salesRep: true,
    },
  });

  if (!user || !user.isActive) {
    throw ApiError.unauthorized('Account not found or deactivated');
  }
  // A token from before a password change, reset, role change or deactivation no longer works.
  if ((payload.sv || 0) !== (user.sessionVersion || 0)) {
    throw ApiError.unauthorized('Your session has ended. Please sign in again.');
  }
  // A rep account without its rep profile would fall through every "only mine" filter; refuse it.
  if (user.role.name === 'SALES_REP' && !user.salesRep) {
    throw ApiError.forbidden('This account has no sales-rep profile yet. Ask ZELab to finish setting it up.');
  }
  // Reps on phones only — on every request, so a session cannot be carried to a computer or tablet.
  assertDeviceAllowed(user.role.name, req.headers, ApiError);

  req.user = {
    id: user.id,
    name: user.name,
    email: user.email,
    roleId: user.roleId,
    role: user.role.name,
    permissions: user.role.permissions.map((p) => p.key),
    warehouseId: user.warehouseId,
    salesRepId: user.salesRep ? user.salesRep.id : null,
  };

  return next();
});

module.exports = { authenticate };
