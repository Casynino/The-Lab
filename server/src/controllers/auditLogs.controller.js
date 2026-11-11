'use strict';

const prisma = require('../config/prisma');
const asyncHandler = require('../utils/asyncHandler');
const { paginated } = require('../utils/response');
const { parsePagination } = require('../utils/pagination');
const ApiError = require('../utils/ApiError');
const { eatDayBounds } = require('../utils/dates');

const list = asyncHandler(async (req, res) => {
  const q = req.validatedQuery || req.query;
  const pagination = parsePagination(q, { defaultSortBy: 'createdAt', defaultSortDir: 'desc', allowedSortFields: ['createdAt'] });
  const where = {};
  if (q.userId) where.userId = q.userId;
  if (q.entityType) where.entityType = q.entityType;
  if (q.action) where.action = q.action;
  if (q.from || q.to) {
    // A bare day is a Dar es Salaam day, not UTC midnight (audit backend-integrity-8).
    const bounds = eatDayBounds({ from: q.from, to: q.to });
    if (!bounds) throw ApiError.badRequest('Use dates like 2026-11-11 for from and to');
    where.createdAt = bounds;
  }
  if (q.search) {
    where.OR = [
      { action: { contains: q.search, mode: 'insensitive' } },
      { entityType: { contains: q.search, mode: 'insensitive' } },
      { entityId: { contains: q.search, mode: 'insensitive' } },
    ];
  }

  const [items, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      include: { user: { select: { id: true, name: true, email: true } } },
      skip: pagination.skip,
      take: pagination.take,
      orderBy: pagination.orderBy,
    }),
    prisma.auditLog.count({ where }),
  ]);
  return paginated(res, items, { page: pagination.page, limit: pagination.limit, total });
});

module.exports = { list };
