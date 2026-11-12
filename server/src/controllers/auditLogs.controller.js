'use strict';

const prisma = require('../config/prisma');
const asyncHandler = require('../utils/asyncHandler');
const { paginated } = require('../utils/response');
const { parsePagination } = require('../utils/pagination');
const ApiError = require('../utils/ApiError');
const { eatDayBounds } = require('../utils/dates');

// A list of codes sent with a search ("LOGIN,LOGOUT", "User,SalesRepresentative"): letters and _ only.
const codes = (s) => String(s || '').split(',').map((c) => c.trim()).filter((c) => /^[A-Za-z_]{1,60}$/.test(c)).slice(0, 60);

// What a search matches (audit 11 Nov 2026, admin-system-6: "Nino", an email, "signed in" or "refused" found
// nothing, because only the raw codes and ids were searched). Now also: the person who did it (name or
// email), the email tried on a refused sign-in, and the action and object codes whose words on the screen
// match — the page knows those words and sends the codes (searchActions, searchEntities). `peopleIds`: the
// accounts whose name or email matches, for the rows about that account (its sign-ins were written with the
// account as the subject and no person, so a search for the name missed them).
function searchWhere(search, { searchActions, searchEntities } = {}, peopleIds = []) {
  const text = String(search || '').trim();
  if (!text) return null;
  const like = { contains: text, mode: 'insensitive' };
  const or = [
    { action: like },
    { entityType: like },
    { entityId: like },
    { user: { is: { name: like } } },
    { user: { is: { email: like } } },
    // A refused sign-in has no person; the email typed is kept (lower case) in its values.
    { newValues: { path: ['email'], string_contains: text.toLowerCase() } },
  ];
  const actions = codes(searchActions);
  if (actions.length) or.push({ action: { in: actions } });
  const entities = codes(searchEntities);
  if (entities.length) or.push({ entityType: { in: entities } });
  if (peopleIds.length) or.push({ entityType: 'User', entityId: { in: peopleIds } });
  return or;
}

// The accounts a search names (at most 50; the users table is small).
async function peopleMatching(search) {
  const text = String(search || '').trim();
  if (!text) return [];
  const like = { contains: text, mode: 'insensitive' };
  const rows = await prisma.user.findMany({ where: { OR: [{ name: like }, { email: like }] }, select: { id: true }, take: 50 });
  return rows.map((r) => r.id);
}

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
  const or = searchWhere(q.search, q, await peopleMatching(q.search));
  if (or) where.OR = or;

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

module.exports = { list, searchWhere };
