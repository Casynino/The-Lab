'use strict';

const asyncHandler = require('../utils/asyncHandler');
const { ok, paginated } = require('../utils/response');
const { parsePagination } = require('../utils/pagination');
const notifications = require('../services/notification.service');
const audit = require('../services/audit.service');

const list = asyncHandler(async (req, res) => {
  const q = req.validatedQuery || req.query;
  const pagination = parsePagination(q, { defaultLimit: 25 });
  const { items, total, unread } = await notifications.list(req.user, q, pagination);
  return paginated(res, items, { page: pagination.page, limit: pagination.limit, total, unread });
});

const unreadCount = asyncHandler(async (req, res) => {
  const count = await notifications.unreadCount(req.user);
  // Anything held back — quiet hours, the provider burst cap, a failed attempt —
  // sits PENDING until something calls flush(). That was the dashboard and the
  // twice-daily crons, so a held message could wait half a day. The bell polls
  // every 30s from every page, so draining here means it waits about a minute
  // instead. flush() throttles itself and runs after the response, so this costs
  // the request nothing.
  const wa = require('../services/whatsappNotify.service');
  wa.background(wa.flush());
  return ok(res, { unread: count });
});

const markRead = asyncHandler(async (req, res) => {
  const n = await notifications.markRead(req.params.id, req.user);
  return ok(res, n);
});

const markAllRead = asyncHandler(async (req, res) => {
  const result = await notifications.markAllRead(req.user);
  return ok(res, result);
});

const generate = asyncHandler(async (req, res) => {
  const result = await notifications.generateSystemAlerts();
  await audit.record(req, { action: 'GENERATE_ALERTS', entityType: 'Notification' });
  return ok(res, result);
});

// POST /notifications/broadcast — admin announcement to reps/staff/all.
const broadcast = asyncHandler(async (req, res) => {
  const { title, message, severity, audience } = req.body || {};
  if (!title || !message) {
    return res.status(400).json({ success: false, error: { message: 'title and message are required' } });
  }
  const result = await notifications.broadcast({ title, message, severity, audience });
  await audit.record(req, { action: 'CREATE', entityType: 'Notification', entityId: 'broadcast', newValues: { title, audience: audience || 'reps', notified: result.notified } });
  return ok(res, result);
});

module.exports = {
  broadcast, list, unreadCount, markRead, markAllRead, generate };
