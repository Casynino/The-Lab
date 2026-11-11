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
  // In production the jobs never run unprotected: no secret set means no one may call them.
  if (!secret && process.env.NODE_ENV === 'production') {
    return res.status(503).json({ success: false, error: { message: 'Cron is not configured (CRON_SECRET missing)' } });
  }
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ success: false, error: { message: 'Unauthorized' } });
  }
  return next();
}

// A best-effort sub-job may fail without stopping the run, but never silently (audit #125): every
// `.catch(() => null)` here used to drop the error, so a job that failed every morning left no trace.
// The answer still carries null for that job.
function logFailure(job) {
  return (err) => {
    console.error(`[cron] ${job} failed:`, err && err.message ? err.message : err);
    return null;
  };
}

// When the jobs that keep orders and fines honest fail, a log line is not enough: overdue orders stay
// unflagged and fines stay unapplied until someone notices, so the admins are told.
function alertAdmins(title, message) {
  return require('../services/notification.service').notifyAdmins({
    type: 'GENERAL',
    severity: 'CRITICAL',
    title,
    message,
    entityType: 'Cron',
    entityId: title,
  }).catch(logFailure('admin alert'));
}

// Flip past-deadline orders to OVERDUE (so penalties apply) and send any due
// 24h/6h/1h settlement reminders. Safe to call repeatedly — fully idempotent.
// Also retries undelivered WhatsApp notifications and re-scans stock alerts.
router.get(
  '/settlement-sweep',
  guard,
  asyncHandler(async (_req, res) => {
    const wa = require('../services/whatsappNotify.service');
    const returnExpiry = await require('../services/returns.service').expireStaleReturns().catch(logFailure('settlement-sweep: return expiry'));
    let overdue;
    let reminders;
    let penalties;
    try {
      overdue = await settlement.refreshOverdue();
      reminders = await settlement.sendDueReminders();
      penalties = await penalty.applyDuePenalties();
    } catch (err) {
      logFailure('settlement-sweep')(err);
      await alertAdmins(
        'Morning check failed',
        `The 09:00 check could not finish: ${String(err.message).slice(0, 200)}. Overdue orders, settlement reminders and fines may not have been applied. It runs again tomorrow at 09:00.`,
      );
      return res.status(500).json({ success: false, error: { message: err.message } });
    }
    const stockAlerts = await wa.scanStockAlerts().catch(logFailure('settlement-sweep: stock alerts'));
    const whatsappRetries = await wa.flush({ throttleMs: 0 }).catch(logFailure('settlement-sweep: WhatsApp retries'));
    // A daily, weekly or monthly report whose own run failed or never ran is sent late from here.
    const missedReports = await wa.catchUpReports().catch(logFailure('settlement-sweep: missed reports'));
    return res.json({ success: true, data: { overdue, reminders, penalties, returnExpiry, stockAlerts, whatsappRetries, missedReports, at: new Date().toISOString() } });
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
    await wa.flush({ throttleMs: 0 }).catch(logFailure('deadline-watch: WhatsApp flush'));
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
      await wa.flush({ throttleMs: 0 }).catch(logFailure('daily-summary: WhatsApp flush'));
      return result;
    }, res);
  }),
);

// A failed scheduled report must not die silently: log it and raise a
// CRITICAL in-app notification for the admin. A refused request (a month that
// is not over, a week still under way) is an answer, not a failure: no alert.
async function reportGuard(name, fn, res) {
  try {
    const result = await fn();
    return res.json({ success: true, data: result });
  } catch (err) {
    if (err.statusCode && err.statusCode < 500) {
      return res.status(err.statusCode).json({ success: false, error: { message: err.message } });
    }
    logFailure(name)(err);
    require('../services/notification.service').notifyAdmins({
      type: 'GENERAL',
      severity: 'CRITICAL',
      title: `${name} failed to generate`,
      message: `${name} could not be generated/sent: ${String(err.message).slice(0, 200)}. The morning check (09:00) tries it again and sends it late.`,
      entityType: 'Report',
      entityId: name,
    }).catch(() => {});
    return res.status(500).json({ success: false, error: { message: err.message } });
  }
}

// Weekly WhatsApp business report + archived PDF (Tuesdays 08:00 EAT, for the Mon–Sun week just ended).
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
      async () => {
        const result = await monthly.sendMonthlyReport({ force: req.query.force === '1', silent: req.query.silent === '1', monthKey: req.query.month || undefined });
        // On 1 January the month just reported is December, so the year is over too: send its yearly report
        // right after. Its own failure never spoils the monthly answer — the morning sweep sends it late.
        if (!req.query.month && require('../utils/dates').eatNow().month() === 0) {
          result.yearly = await require('../services/yearlyReport.service').sendYearlyReport({})
            .catch((err) => ({ error: String(err.message).slice(0, 200) }));
        }
        return result;
      },
      res,
    );
  }),
);

// Yearly WhatsApp business report + archived PDF (1 January 08:00 EAT, for the year just ended — normally sent
// by the monthly run above). ?year=YYYY pins a finished year; ?force=1 resends for a test; ?silent=1 only
// rebuilds the archived PDF.
router.get(
  '/yearly-report',
  guard,
  asyncHandler(async (req, res) => {
    const yearly = require('../services/yearlyReport.service');
    return reportGuard(
      'Yearly report',
      () => yearly.sendYearlyReport({ force: req.query.force === '1', silent: req.query.silent === '1', yearKey: req.query.year || undefined }),
      res,
    );
  }),
);

module.exports = router;
