'use strict';

// Reports Archive — every generated daily/weekly/monthly PDF is stored here
// permanently and served from storage (never regenerated), so the numbers in
// a sent report can never drift. WhatsApp links point at the signed public
// endpoint; the admin UI lists and downloads through the authenticated API.

const crypto = require('crypto');
const prisma = require('../config/prisma');
const env = require('../config/env');
const ApiError = require('../utils/ApiError');

const APP_URL = env.appUrl;

function signReport(id) {
  return crypto.createHmac('sha256', env.jwt.secret).update(`report:${id}`).digest('hex').slice(0, 32);
}

function publicLink(id) {
  return `${APP_URL}/api/public/report/${id}.pdf?sig=${signReport(id)}`;
}

// Store (or replace — force resends regenerate) the PDF for a period.
async function save({ type, periodKey, label, from, to, pdf, meta }) {
  return prisma.reportArchive.upsert({
    where: { type_periodKey: { type, periodKey } },
    create: { type, periodKey, label, from, to, pdf, meta: meta || undefined },
    update: { label, from, to, pdf, meta: meta || undefined },
  });
}

async function list({ type, year, search, limit = 60 } = {}) {
  const where = {};
  // No type = the weekly and monthly statements. A daily report is archived every day and would
  // push them out of a 60-row list, so dailies are listed only when asked for.
  where.type = type || { not: 'DAILY' };
  if (year) where.periodKey = { startsWith: String(year) };
  if (search) {
    where.OR = [
      { periodKey: { contains: search, mode: 'insensitive' } },
      { label: { contains: search, mode: 'insensitive' } },
    ];
  }
  const rows = await prisma.reportArchive.findMany({
    where,
    orderBy: { from: 'desc' },
    take: Math.min(Number(limit) || 60, 200),
    select: { id: true, type: true, periodKey: true, label: true, from: true, to: true, createdAt: true, updatedAt: true, meta: true },
  });
  return rows.map((r) => ({ ...r, link: publicLink(r.id) }));
}

async function getPdf(id) {
  const row = await prisma.reportArchive.findUnique({ where: { id } });
  if (!row) throw ApiError.notFound('Report not found');
  return row;
}

module.exports = { save, list, getPdf, signReport, publicLink };
