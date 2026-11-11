'use strict';

const bcrypt = require('bcryptjs');
const prisma = require('../config/prisma');
const env = require('../config/env');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { ok, created, paginated } = require('../utils/response');
const { parsePagination } = require('../utils/pagination');
const audit = require('../services/audit.service');
const { nextRepCode } = require('../utils/numbering');
const { regionWrite } = require('../constants/regions');

const PUBLIC_SELECT = {
  id: true,
  name: true,
  email: true,
  phone: true,
  isActive: true,
  lastLoginAt: true,
  createdAt: true,
  roleId: true,
  role: { select: { id: true, name: true } },
  warehouse: { select: { id: true, name: true } },
  salesRep: { select: { id: true, code: true, region: true, regions: true } },
};

// Refuses when this account is an active administrator and no other active administrator would be left.
// Called before an administrator is demoted, switched off, suspended or deleted.
async function assertNotLastAdmin(userId) {
  const target = await prisma.user.findUnique({ where: { id: userId }, select: { isActive: true, role: { select: { name: true } } } });
  if (!target || !target.isActive || target.role?.name !== 'ADMIN') return;
  const others = await prisma.user.count({ where: { id: { not: userId }, isActive: true, role: { name: 'ADMIN' } } });
  if (others < 1) throw ApiError.badRequest('Cannot remove the last active administrator');
}

const list = asyncHandler(async (req, res) => {
  const q = req.validatedQuery || req.query;
  const pagination = parsePagination(q, { defaultSortBy: 'createdAt', defaultSortDir: 'desc' });
  const where = {};
  if (q.roleId) where.roleId = q.roleId;
  if (q.isActive !== undefined) where.isActive = q.isActive;
  if (q.search) {
    where.OR = [
      { name: { contains: q.search, mode: 'insensitive' } },
      { email: { contains: q.search, mode: 'insensitive' } },
    ];
  }
  const [items, total] = await Promise.all([
    prisma.user.findMany({ where, select: PUBLIC_SELECT, skip: pagination.skip, take: pagination.take, orderBy: pagination.orderBy }),
    prisma.user.count({ where }),
  ]);
  return paginated(res, items, { page: pagination.page, limit: pagination.limit, total });
});

const get = asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.params.id }, select: PUBLIC_SELECT });
  if (!user) throw ApiError.notFound('User not found');
  return ok(res, user);
});

const create = asyncHandler(async (req, res) => {
  const { name, email, password, phone, roleId, warehouseId, isActive, salesRep } = req.body;

  const role = await prisma.role.findUnique({ where: { id: roleId } });
  if (!role) throw ApiError.badRequest('Role not found');

  const passwordHash = await bcrypt.hash(password, env.bcryptSaltRounds);
  const data = {
    name,
    email: email.toLowerCase().trim(),
    passwordHash,
    phone: phone || null,
    roleId,
    warehouseId: warehouseId || null,
    isActive: isActive ?? true,
  };

  // Auto-provision a sales-rep profile when creating a SALES_REP user.
  if (role.name === 'SALES_REP') {
    data.salesRep = {
      create: {
        code: salesRep?.code || (await nextRepCode(prisma)),
        region: null,
        regions: [],
        ...regionWrite(salesRep),
        phone: salesRep?.phone || phone || null,
        monthlyTarget: salesRep?.monthlyTarget ?? null,
      },
    };
  }

  const user = await prisma.user.create({ data, select: PUBLIC_SELECT });
  await audit.record(req, { action: 'CREATE', entityType: 'User', entityId: user.id, newValues: { email: user.email, role: role.name } });
  return created(res, user);
});

const update = asyncHandler(async (req, res) => {
  const existing = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!existing) throw ApiError.notFound('User not found');

  const data = {};
  ['name', 'phone', 'roleId', 'warehouseId', 'isActive'].forEach((f) => {
    if (req.body[f] !== undefined) data[f] = req.body[f];
  });
  if (req.body.email) data.email = req.body.email.toLowerCase().trim();
  if (req.body.password) data.passwordHash = await bcrypt.hash(req.body.password, env.bcryptSaltRounds);

  const roleChanges = Boolean(data.roleId && data.roleId !== existing.roleId);

  // Don't let an admin lock themselves out: not by switching their own account off, and not by giving it
  // another role (audit 11 Nov 2026, admin-system-3: the owner could demote himself and nobody could
  // reach Users, Settings or the audit log again without a database fix).
  if (req.params.id === req.user.id && data.isActive === false) {
    throw ApiError.badRequest('You cannot deactivate your own account');
  }
  if (req.params.id === req.user.id && roleChanges) {
    throw ApiError.badRequest('You cannot change your own role. Ask another administrator to do it.');
  }

  // A sales rep's account cannot be given another role while it has a rep profile (that would hand rep
  // data and admin powers to one login); and moving any account into the SALES_REP role is done by
  // creating the rep, not here.
  let newRole = null;
  if (roleChanges) {
    let rep;
    [rep, newRole] = await Promise.all([
      prisma.salesRepresentative.findUnique({ where: { userId: existing.id }, select: { id: true } }),
      prisma.role.findUnique({ where: { id: data.roleId }, select: { name: true } }),
    ]);
    if (!newRole) throw ApiError.badRequest('Unknown role');
    if (rep && newRole.name !== 'SALES_REP') {
      throw ApiError.badRequest('This account is a sales rep. Remove or switch off the rep first, then change the role.');
    }
  }

  // The last active administrator keeps the role and stays switched on.
  const losesAdmin = (roleChanges && newRole.name !== 'ADMIN') || data.isActive === false;
  if (losesAdmin) await assertNotLastAdmin(existing.id);

  // A new password, a new role or switching the account off signs it out everywhere.
  if (data.passwordHash || roleChanges || data.isActive === false) {
    data.sessionVersion = { increment: 1 };
  }

  const user = await prisma.user.update({ where: { id: req.params.id }, data, select: PUBLIC_SELECT });
  await audit.record(req, { action: 'UPDATE', entityType: 'User', entityId: user.id, newValues: { ...data, passwordHash: undefined } });
  return ok(res, user);
});

const remove = asyncHandler(async (req, res) => {
  if (req.params.id === req.user.id) throw ApiError.badRequest('You cannot delete your own account');

  const user = await prisma.user.findUnique({ where: { id: req.params.id }, include: { role: true } });
  if (!user) throw ApiError.notFound('User not found');

  await assertNotLastAdmin(user.id);

  // Removing an account for good, rather than parking it as Inactive. An
  // account created by mistake should leave no trace — a suspended row still
  // shows in the list, still owns its rep, and still has to be explained.
  //
  // Guarded above: never your own account, never the last administrator. And a
  // user who is a sales rep goes through the rep's own rule — boxes back
  // first — because deleting the person must never bury stock they are
  // holding. The audit entry outlives the row and is the record that they
  // existed at all.
  const purge = req.body?.purge === true || req.body?.purge === 'true';
  if (purge) {
    if (req.body?.confirm !== user.email) {
      throw ApiError.badRequest(`To delete ${user.name} for good, send { "confirm": "${user.email}" }`);
    }
    const rep = await prisma.salesRepresentative.findFirst({ where: { userId: user.id }, select: { id: true, code: true } });
    let repSummary = null;
    if (rep) {
      const held = await prisma.inventoryTransaction.aggregate({ where: { salesRepId: rep.id }, _sum: { baseQuantity: true } });
      const boxes = held._sum.baseQuantity || 0;
      if (boxes > 0) {
        throw ApiError.badRequest(
          `${user.name} is a sales rep (${rep.code}) still holding ${boxes} box${boxes === 1 ? '' : 'es'}. Settle or return those boxes first, then the account can be deleted.`,
        );
      }
      const reps = require('./salesReps.controller');
      repSummary = await reps.wipeRepActivity(rep.id, user.id);
      await prisma.salesRepresentative.delete({ where: { id: rep.id } });
      await require('../services/inventory.service').recomputeAllCaches();
    }
    await prisma.notification.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
    await audit.record(req, {
      action: 'DELETE',
      entityType: 'User',
      entityId: req.params.id,
      oldValues: { name: user.name, email: user.email, role: user.role.name, salesRepCode: rep?.code || null },
      newValues: { purged: true, ...(repSummary || {}) },
    });
    return ok(res, { id: req.params.id, deleted: true, purged: true, salesRepCode: rep?.code || null, ...(repSummary || {}) });
  }

  // Default stays as it was: deactivate, preserving audit trails and ledger
  // actor references. Suspending ends every session for good, as switching the account off in the edit
  // form does: the session version moves on, so the old keys stay refused after the account is activated
  // again (audit 11 Nov 2026, admin-system-2 / auth-device-1).
  const updated = await prisma.user.update({
    where: { id: req.params.id },
    data: { isActive: false, sessionVersion: { increment: 1 } },
    select: PUBLIC_SELECT,
  });
  await audit.record(req, { action: 'DEACTIVATE', entityType: 'User', entityId: req.params.id });
  return ok(res, { ...updated, deactivated: true });
});

module.exports = { list, get, create, update, remove };
