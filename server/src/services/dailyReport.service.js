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

const alreadySent = (type, payload, reportDate) => ApiError.conflict(
  `You already sent ${payload.reportDate ? `the ${type.toLowerCase()} report for ${reportDate.toISOString().slice(0, 10)}` : `today's ${type.toLowerCase()} report`}. Open it again to see it and change it.`,
);

// A rep's opening or closing report for a day (one of each per day). Only the fields sent are written; a
// blank one means "not filled in", and null clears a figure.
//
// The second time a day, the rep is changing the first report, knowingly: the app opens it with what was
// saved and sends `replaces: <its id>` with every field. A second report that does not say which one it
// replaces is refused, never merged into the first in silence (audit 11 Nov 2026, rep-app-3: a second
// "Opening" replaced the morning cash figure with no word, and the saved row mixed two submissions).
// Returns the report and, when one was changed, what it held before (kept in the audit log).
async function submit(salesRepId, payload) {
  const reportDate = reportDay(payload.reportDate);
  const type = payload.type;
  const data = {};
  for (const k of FIELDS) {
    const v = payload[k];
    if (v === undefined || (typeof v === 'string' && !v.trim())) continue;
    data[k] = v;
  }
  const existing = await prisma.dailyReport.findUnique({ where: { salesRepId_reportDate_type: { salesRepId, reportDate, type } } });
  if (existing) {
    if (!payload.replaces || payload.replaces !== existing.id) throw alreadySent(type, payload, reportDate);
    const report = await prisma.dailyReport.update({ where: { id: existing.id }, data, include: INCLUDE });
    return { report, previous: existing };
  }
  try {
    const report = await prisma.dailyReport.create({ data: { salesRepId, reportDate, type, ...data }, include: INCLUDE });
    return { report, previous: null };
  } catch (e) {
    // Sent twice at the same moment: the first one is the report, the second is told so.
    if (e && e.code === 'P2002') throw alreadySent(type, payload, reportDate);
    throw e;
  }
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

module.exports = { submit, list, get, reportDay, FIELDS };
