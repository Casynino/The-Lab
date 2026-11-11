'use strict';

const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const { dayjs, eatNow } = require('../utils/dates');

const INCLUDE = { salesRep: { include: { user: { select: { name: true } } } } };

const FIELDS = ['cashOnHand', 'customersToVisit', 'openingNote', 'salesAmount', 'cashCollected', 'debtsCreated', 'debtsCollected', 'closingNote', 'notes'];

// The calendar day a report belongs to, as midnight UTC of that date (the column is a plain DATE).
// It used to be the SERVER's local midnight: on a server running on Tanzania time that is 21:00 UTC
// of the day before, so every report was filed under yesterday; on Vercel (UTC) the first three hours
// of each Tanzanian morning did the same. No date given = today on Tanzania's clock.
function reportDay(value) {
  const d = value ? dayjs.utc(value) : eatNow();
  if (!d.isValid()) throw ApiError.badRequest('Invalid report date');
  return d.startOf('day').toDate();
}

// Upsert a rep's opening or closing report for a given day (one of each/day).
// Only the fields the rep filled in are written: the form starts blank every time, so a blank field
// means "not filled in", not "clear it" — sending a second time used to null every figure sent before.
async function submit(salesRepId, payload) {
  const reportDate = reportDay(payload.reportDate);
  const type = payload.type;
  const data = {};
  for (const k of FIELDS) {
    const v = payload[k];
    if (v === undefined || (typeof v === 'string' && !v.trim())) continue;
    data[k] = v;
  }
  return prisma.dailyReport.upsert({
    where: { salesRepId_reportDate_type: { salesRepId, reportDate, type } },
    create: { salesRepId, reportDate, type, ...data },
    update: data,
    include: INCLUDE,
  });
}

async function list(filters, pagination) {
  const where = {};
  if (filters.salesRepId) where.salesRepId = filters.salesRepId;
  if (filters.type) where.type = filters.type;
  if (filters.from || filters.to) {
    where.reportDate = {};
    if (filters.from) where.reportDate.gte = reportDay(filters.from);
    if (filters.to) where.reportDate.lte = reportDay(filters.to);
  }
  const [items, total] = await Promise.all([
    prisma.dailyReport.findMany({ where, include: INCLUDE, skip: pagination.skip, take: pagination.take, orderBy: { reportDate: 'desc' } }),
    prisma.dailyReport.count({ where }),
  ]);
  return { items, total };
}

async function get(id) {
  const r = await prisma.dailyReport.findUnique({ where: { id }, include: INCLUDE });
  if (!r) throw ApiError.notFound('Daily report not found');
  return r;
}

module.exports = { submit, list, get, reportDay };
