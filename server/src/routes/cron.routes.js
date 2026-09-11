'use strict';

// Scheduled-task endpoints, hit by Vercel Cron (which can't send a JWT, so this
// router is NOT behind `authenticate`). When CRON_SECRET is configured, Vercel
// automatically sends `Authorization: Bearer <CRON_SECRET>` and we require it;
// if it's unset the endpoint still works (it only refreshes overdue flags and
// sends already-deduplicated reminders, so there's nothing to abuse).

const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const settlement = require('../services/settlement.service');
const penalty = require('../services/penalty.service');

const router = express.Router();

function guard(req, res, next) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ success: false, error: { message: 'Unauthorized' } });
  }
  return next();
}

// Flip past-deadline orders to OVERDUE (so penalties apply) and send any due
// 24h/6h/1h settlement reminders. Safe to call repeatedly — fully idempotent.
// Also retries undelivered WhatsApp notifications and re-scans stock alerts.
router.get(
  '/settlement-sweep',
  guard,
  asyncHandler(async (_req, res) => {
    const wa = require('../services/whatsappNotify.service');
    const returnExpiry = await require('../services/returns.service').expireStaleReturns().catch(() => null);
    const overdue = await settlement.refreshOverdue();
    const reminders = await settlement.sendDueReminders();
    const penalties = await penalty.applyDuePenalties();
    const stockAlerts = await wa.scanStockAlerts().catch(() => null);
    const whatsappRetries = await wa.flush({ throttleMs: 0 }).catch(() => null);
    return res.json({ success: true, data: { overdue, reminders, penalties, returnExpiry, stockAlerts, whatsappRetries, at: new Date().toISOString() } });
  }),
);

// Every few minutes: orders that are minutes away from their deadline, so the
// owner hears about a fine BEFORE it starts rather than after. The first fine
// lands the moment the deadline passes, so a daily sweep is far too coarse for
// this one — it is its own schedule for that reason.
// Deduplicated per order, so running it often costs nothing and repeats nothing.
router.get(
  '/deadline-watch',
  guard,
  asyncHandler(async (req, res) => {
    const wa = require('../services/whatsappNotify.service');
    const minutes = Number(req.query.minutes) || wa.DEADLINE_WARN_MINUTES;
    const result = await wa.deadlineWarnings(minutes);
    await wa.flush({ throttleMs: 0 }).catch(() => {});
    return res.json({ success: true, data: { ...result, minutes, at: new Date().toISOString() } });
  }),
);

// Evening WhatsApp pulse (21:00 EAT): today's sales, profit, cash position,
// activity and alerts. Deduped per day; ?force=1 resends (for testing).
router.get(
  '/daily-summary',
  guard,
  asyncHandler(async (req, res) => {
    const wa = require('../services/whatsappNotify.service');
    return reportGuard('Daily report', async () => {
      const result = await wa.dailySummary({ force: req.query.force === '1' });
      await wa.flush({ throttleMs: 0 }).catch(() => null);
      return result;
    }, res);
  }),
);

// A failed scheduled report must not die silently: log it and raise a
// CRITICAL in-app notification for the admin.
async function reportGuard(name, fn, res) {
  try {
    const result = await fn();
    return res.json({ success: true, data: result });
  } catch (err) {
    require('../services/notification.service').notifyAdmins({
      type: 'GENERAL',
      severity: 'CRITICAL',
      title: `${name} failed to generate`,
      message: `${name} could not be generated/sent: ${String(err.message).slice(0, 200)}. It will retry on the next run.`,
      entityType: 'Report',
      entityId: name,
    }).catch(() => {});
    return res.status(500).json({ success: false, error: { message: err.message } });
  }
}

// Weekly WhatsApp business report + archived PDF (Mondays 08:00 EAT).
// ?force=1 resends even if this week's report already went out (testing).
router.get(
  '/weekly-report',
  guard,
  asyncHandler(async (req, res) => {
    const weekly = require('../services/weeklyReport.service');
    return reportGuard(
      'Weekly report',
      () => weekly.sendWeeklyReport({ force: req.query.force === '1', silent: req.query.silent === '1' }),
      res,
    );
  }),
);

// Monthly WhatsApp business report + archived PDF (1st of month 08:00 EAT).
// Always covers the previous complete month. ?force=1 for testing;
// ?month=YYYY-MM pins an exact month.
router.get(
  '/monthly-report',
  guard,
  asyncHandler(async (req, res) => {
    const monthly = require('../services/monthlyReport.service');
    return reportGuard(
      'Monthly report',
      () => monthly.sendMonthlyReport({ force: req.query.force === '1', silent: req.query.silent === '1', monthKey: req.query.month || undefined }),
      res,
    );
  }),
);

module.exports = router;
