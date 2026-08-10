'use strict';

const prisma = require('../config/prisma');
const asyncHandler = require('../utils/asyncHandler');
const { ok } = require('../utils/response');
const audit = require('../services/audit.service');
const ApiError = require('../utils/ApiError');

const list = asyncHandler(async (_req, res) => {
  const settings = await prisma.setting.findMany({ orderBy: [{ group: 'asc' }, { key: 'asc' }] });
  return ok(res, settings);
});

const get = asyncHandler(async (req, res) => {
  const setting = await prisma.setting.findUnique({ where: { key: req.params.key } });
  return ok(res, setting);
});

// Keys that must not move, each for its own reason — so each says its own.
const FROZEN_KEYS = new Map([
  ['commission.v1PerBox',
    'commission.v1PerBox is what one box earned before 1 Aug 2026. Orders were issued and settled on it, so changing it would rewrite commission reps have already been paid — and once balances move there is no way back. New orders are priced per brand and are unaffected by this value.'],
  ['commission.boxThreshold',
    'commission.boxThreshold is a dead legacy setting, kept only so older rows read cleanly. It is not a rate and not a target: commission is priced per box per brand, and the withdrawal minimum is commission.amountPerThreshold, which is money.'],
]);

// Create or update a setting by key.
const upsert = asyncHandler(async (req, res) => {
  const { value, type, group, description } = req.body;
  if (FROZEN_KEYS.has(req.params.key)) {
    throw ApiError.badRequest(FROZEN_KEYS.get(req.params.key));
  }
  const setting = await prisma.setting.upsert({
    where: { key: req.params.key },
    create: {
      key: req.params.key,
      value,
      type: type || 'STRING',
      group: group || 'general',
      description: description || null,
      updatedById: req.user.id,
    },
    update: {
      value,
      type: type || undefined,
      group: group || undefined,
      description: description ?? undefined,
      updatedById: req.user.id,
    },
  });
  await audit.record(req, { action: 'UPSERT', entityType: 'Setting', entityId: setting.key, newValues: { value } });
  return ok(res, setting);
});

// ── WhatsApp notification centre (admin) ─────────────────────────────────────
const whatsappTypes = asyncHandler(async (_req, res) => {
  const wa = require('../services/whatsappNotify.service');
  return ok(res, Object.entries(wa.TYPES)
    .filter(([key]) => key !== 'TEST')
    .map(([key, t]) => ({ key, label: t.label, priority: t.priority })));
});

const whatsappHistory = asyncHandler(async (req, res) => {
  const wa = require('../services/whatsappNotify.service');
  return ok(res, await wa.history(req.query.limit));
});

// Re-queue messages that failed, after the reason they failed has been fixed.
const whatsappRetryFailed = asyncHandler(async (req, res) => {
  const wa = require('../services/whatsappNotify.service');
  const result = await wa.retryFailed({ hours: Number(req.query.hours) || 168 });
  await audit.record(req, {
    action: 'UPDATE',
    entityType: 'WhatsAppNotification',
    entityId: 'retry-failed',
    newValues: { requeued: result.requeued },
  });
  return ok(res, result);
});

const whatsappTest = asyncHandler(async (req, res) => {
  const wa = require('../services/whatsappNotify.service');
  const result = await wa.test();
  await audit.record(req, { action: 'CREATE', entityType: 'WhatsAppNotification', entityId: 'test', newValues: { sent: result.sent ?? false } });
  return ok(res, result);
});

module.exports = { list, get, upsert, whatsappTypes, whatsappHistory, whatsappTest, whatsappRetryFailed };
