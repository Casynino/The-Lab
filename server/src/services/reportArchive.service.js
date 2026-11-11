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

async function list({ type, year, search, limit = 300 } = {}) {
  const where = {};
  // No type = every report, the daily ones included (Nino, 11 Nov 2026: "why only weekly and monthly —
  // we should see the daily ones too"). The list is long enough for a year of them; the screen shows a
  // page at a time.
  if (type) where.type = type;
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
    take: Math.min(Number(limit) || 300, 500),
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
