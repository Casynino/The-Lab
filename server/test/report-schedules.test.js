'use strict';

// ── Scheduled reports and the WhatsApp queue (audit "schedules", 11 Nov 2026) ─────────────────────────
// Pinned here:
//  - flush() sends the most urgent rows first, passes over INFO rows held by the provider budget, and
//    only waits between two real sends (it spent 16 s on two held rows and sent nothing);
//  - "Retry failed" only puts back what flush() can still send (the last 48 hours);
//  - a missed daily, weekly or monthly report is sent late by the morning sweep, once;
//  - a re-run of a report that already went out answers "Already sent" BEFORE building anything, so the
//    archived PDF the owner was sent is never rewritten; a forced test send never replaces it either;
//  - a week still under way, or a month that is not over or does not exist, is refused;
//  - the daily "Orders" and "Returns" count orders issued and returns accepted, not every request made;
//  - a user can mark read only a notification they can see.

const test = require('node:test');
const assert = require('node:assert/strict');
const { dayjs, eatNow } = require('../src/utils/dates');

const stub = (rel, exports) => {
  const file = require.resolve(rel);
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
};
const fresh = (rel) => {
  delete require.cache[require.resolve(rel)];
  return require(rel);
};
const eat = (iso) => dayjs.utc(iso); // an EAT wall-clock moment, as eatNow() builds one

// ── the WhatsApp queue ────────────────────────────────────────────────────────
function loadNotify({ rows = [], settings = {}, sentInWindow = {}, claimedElsewhere = [], existingKeys = [] } = {}) {
  const calls = { claims: [], fetches: 0, updateManyWhere: null, admins: [] };
  const prisma = {
    setting: { findUnique: async ({ where }) => (where.key in settings ? { key: where.key, value: settings[where.key] } : null) },
    whatsAppNotification: {
      findMany: async () => rows,
      findFirst: async ({ where }) => (existingKeys.includes(where.dedupeKey) ? { id: 'x' } : null),
      count: async ({ where }) => sentInWindow[where.toPhone || 'owner'] || 0,
      updateMany: async ({ where, data }) => {
        if (where.status === 'FAILED') { calls.updateManyWhere = where; return { count: 3 }; }
        calls.claims.push(where.id);
        return { count: claimedElsewhere.includes(where.id) ? 0 : 1 };
      },
      update: async ({ where, data }) => ({ id: where.id, ...data }),
    },
  };
  stub('../src/config/prisma', prisma);
  stub('../src/services/notification.service', { notifyAdmins: async (d) => { calls.admins.push(d); } });
  global.fetch = async () => { calls.fetches += 1; return { ok: true, status: 200, text: async () => 'Message queued' }; };
  return { wa: fresh('../src/services/whatsappNotify.service'), calls };
}
const OWNER = { 'whatsapp.phone': '+255700000000', 'whatsapp.apikey': 'k' };
const row = (id, priority, extra = {}) => ({ id, priority, type: 'X', attempts: 0, toPhone: null, toApiKey: null, text: 't', createdAt: new Date(), ...extra });

test('flush: INFO rows held by the budget no longer block the queue, and nothing waits 8 s for them', async () => {
  const { wa, calls } = loadNotify({
    settings: OWNER,
    rows: [row('info-owner', 'INFO'), row('info-rep', 'INFO', { toPhone: '+255700000001', toApiKey: 'r' }), row('action', 'ACTION')],
    sentInWindow: { owner: 75, '+255700000001': 15 }, // both over the default cap of 14
  });
  const t0 = Date.now();
  const r = await wa.flush({ throttleMs: 0 });
  assert.ok(Date.now() - t0 < 2000, 'no 8-second wait when only one row is really sent');
  assert.deepEqual(calls.claims, ['action']);
  assert.equal(calls.fetches, 1);
  assert.deepEqual(r, { retried: 1, sent: 1 });
});

test('flush: the most urgent row goes first, and a row taken by another run costs no wait', async () => {
  const { wa, calls } = loadNotify({
    settings: OWNER,
    rows: [row('old-info', 'INFO'), row('new-warning', 'WARNING')], // oldest first, as the database returns them
    claimedElsewhere: ['new-warning'],
  });
  const t0 = Date.now();
  await wa.flush({ throttleMs: 0 });
  assert.deepEqual(calls.claims, ['new-warning', 'old-info']);
  assert.ok(Date.now() - t0 < 2000);
});

test('Retry failed puts back only the last 48 hours, the window flush() still sends', async () => {
  const { wa, calls } = loadNotify({ settings: OWNER });
  const before = Date.now();
  const r = await wa.retryFailed({ hours: 168 });
  const since = calls.updateManyWhere.createdAt.gt.getTime();
  assert.ok(since >= before - 48 * 3600 * 1000 - 1000 && since <= Date.now() - 48 * 3600 * 1000 + 1000);
  assert.equal(r.requeued, 3);
});

test('Retry failed is offered even when newer messages pushed the failure off the recent list', async () => {
  const asked = [];
  stub('../src/config/prisma', { whatsAppNotification: { findMany: async (args) => { asked.push(args); return []; } } });
  stub('../src/services/audit.service', {});
  fresh('../src/services/whatsappNotify.service');
  const ctrl = fresh('../src/controllers/settings.controller');
  const call = (query) => new Promise((resolve, reject) => {
    ctrl.whatsappHistory({ query }, { status: () => ({ json: resolve }) }, reject);
  });
  await call({ limit: '25' });
  await call({ status: 'FAILED', limit: '1' });
  await call({ status: 'SENT', limit: '1' }); // only FAILED is a filter; anything else is the plain list
  assert.equal(asked[0].where, undefined);
  assert.equal(asked[0].take, 25);
  assert.deepEqual(asked[1].where, { status: 'FAILED' });
  assert.equal(asked[1].take, 1);
  assert.deepEqual(asked[1].orderBy, { createdAt: 'desc' }); // the newest failure
  assert.equal(asked[2].where, undefined);
});

// ── missed reports, sent late by the morning sweep ───────────────────────────
function loadWeeklyReal() {
  stub('../src/config/prisma', {});
  for (const s of ['finance', 'reports', 'inventory', 'reorder', 'settlement', 'reportData']) stub(`../src/services/${s}.service`, {});
  return fresh('../src/services/weeklyReport.service');
}
function loadCatchUp({ existingKeys = [], settings = OWNER, failWeekly = false } = {}) {
  const sent = { daily: [], weekly: [], monthly: [] };
  const weekly = loadWeeklyReal();
  stub('../src/services/weeklyReport.service', {
    ...weekly,
    sendWeeklyReport: async (o) => { if (failWeekly) throw new Error('db down'); sent.weekly.push(o); return { sent: true }; },
  });
  stub('../src/services/monthlyReport.service', { sendMonthlyReport: async (o) => { sent.monthly.push(o); return { sent: true }; } });
  stub('../src/services/dailyBusinessReport.service', { sendDailyReport: async (o) => { sent.daily.push(o); return { sent: true }; } });
  const { wa, calls } = loadNotify({ settings, existingKeys });
  return { wa, sent, calls };
}

test('catch-up: a missing daily is sent late for yesterday; reports that went out are left alone', async () => {
  const { wa, sent } = loadCatchUp({ existingKeys: ['weekly:2026-W45', 'monthly:2026-10'] });
  const r = await wa.catchUpReports(eat('2026-11-11T09:00:00')); // Wednesday
  assert.equal(sent.daily.length, 1);
  assert.equal(sent.daily[0].dateKey, '2026-11-10');
  assert.equal(sent.daily[0].late, true);
  assert.equal(typeof sent.daily[0].queue, 'function');
  assert.equal(sent.weekly.length, 0);
  assert.equal(sent.monthly.length, 0);
  assert.deepEqual(r.weekly, { key: '2026-W45', missing: false });
});

test('catch-up: the weekly looked at is the last one whose Tuesday 08:00 has passed', async () => {
  const keyAt = async (iso) => {
    const { wa } = loadCatchUp({ existingKeys: ['daily:x'] });
    return (await wa.catchUpReports(eat(iso))).weekly.key;
  };
  assert.equal(await keyAt('2026-11-16T09:00:00'), '2026-W45'); // Monday: W46's report is not due until tomorrow
  assert.equal(await keyAt('2026-11-17T07:00:00'), '2026-W45'); // Tuesday before 08:00
  assert.equal(await keyAt('2026-11-17T09:00:00'), '2026-W46'); // Tuesday after 08:00: the week 9–15 Nov
});

test('catch-up: a missing weekly and monthly are sent for their own period', async () => {
  const { wa, sent } = loadCatchUp({ existingKeys: ['daily:2026-11-30'] });
  await wa.catchUpReports(eat('2026-12-01T09:00:00'));
  assert.deepEqual(sent.weekly, [{ weekKey: '2026-W48' }]); // 23–29 Nov
  assert.deepEqual(sent.monthly, [{ monthKey: '2026-11' }]);
  const early = loadCatchUp({ existingKeys: [] });
  await early.wa.catchUpReports(eat('2026-12-01T07:00:00')); // before the 1st's 08:00: November is not due yet
  assert.deepEqual(early.sent.monthly, [{ monthKey: '2026-10' }]);
});

test('catch-up: one failure raises an alert and does not stop the others; switched off or no WhatsApp = nothing', async () => {
  const { wa, sent, calls } = loadCatchUp({ failWeekly: true });
  const r = await wa.catchUpReports(eat('2026-11-11T09:00:00'));
  assert.match(r.weekly.error, /db down/);
  assert.equal(sent.daily.length, 1);
  assert.equal(sent.monthly.length, 1);
  assert.equal(calls.admins.length, 1);
  assert.equal(calls.admins[0].title, 'Weekly report failed to generate');

  const off = loadCatchUp({ settings: { ...OWNER, 'whatsapp.notify.DAILY_SUMMARY': '0' }, existingKeys: ['weekly:2026-W45', 'monthly:2026-10'] });
  await off.wa.catchUpReports(eat('2026-11-11T09:00:00'));
  assert.equal(off.sent.daily.length, 0);

  const none = loadCatchUp({ settings: {} });
  assert.deepEqual(await none.wa.catchUpReports(eat('2026-11-11T09:00:00')), { skipped: 'not-configured' });
  assert.equal(none.sent.daily.length + none.sent.weekly.length + none.sent.monthly.length, 0);
});

// ── weekly and monthly: decided before anything is built ─────────────────────
function loadWeekly({ existingKeys = [], lastWeeklySent = null } = {}) {
  const calls = { saves: [], queued: [], built: 0 };
  const count = async () => 0;
  stub('../src/config/prisma', {
    setting: { findUnique: async ({ where }) => (where.key === 'whatsapp.lastWeeklySent' && lastWeeklySent ? { value: lastWeeklySent } : null) },
    whatsAppNotification: { findFirst: async ({ where }) => (existingKeys.includes(where.dedupeKey) ? { id: 'x' } : null) },
    $transaction: (list) => Promise.all(list),
    stockRequest: { count }, settlementSubmission: { count }, return: { count },
    inventoryTransaction: { groupBy: async () => [] },
    commissionWithdrawal: { aggregate: async () => ({ _sum: { amount: 0 } }) },
  });
  const report = { revenue: 100, cogs: 40, grossProfit: 60, expenses: 10, netProfit: 50, cashFlow: { moneyIn: 1, moneyOut: 1, net: 0 }, boxesSold: 2, topProducts: [] };
  stub('../src/services/finance.service', {
    report: async () => { calls.built += 1; return report; }, accountBalances: async () => [], supplierSummaries: async () => [],
  });
  stub('../src/services/reports.service', { profitOverview: async () => ({ byBrand: [] }) });
  stub('../src/services/inventory.service', { valuation: async () => ({}) });
  stub('../src/services/reorder.service', { lowStock: async () => [] });
  stub('../src/services/settlement.service', { summary: async () => ({ overdueCount: 0 }) });
  stub('../src/services/reportData.service', { periodExtras: async () => ({ reps: [], prev: null }), stockBlock: () => ({ costValue: 0, units: 0 }) });
  stub('../src/services/commission.service', { summaryAllReps: async () => ({ items: [] }), earnedBetween: async () => ({ total: 0 }) });
  stub('../src/services/reportPdf.service', { weeklyPdf: async () => Buffer.from('%PDF-'), monthlyPdf: async () => Buffer.from('%PDF-') });
  stub('../src/services/reportArchive.service', { save: async (o) => { calls.saves.push(o); return { id: 'a1' }; }, publicLink: (id) => `https://x/${id}.pdf` });
  stub('../src/services/whatsappNotify.service', { queue: async (type, o) => { calls.queued.push(o.dedupeKey); return { queued: true, sent: false, status: 'PENDING' }; } });
  return { weekly: fresh('../src/services/weeklyReport.service'), calls };
}
const keyOfWeek = (d) => `${d.isoWeekYear()}-W${String(d.isoWeek()).padStart(2, '0')}`;

test('weekly: a week still under way is refused unless forced (it used up the real report\'s key)', async () => {
  const { weekly, calls } = loadWeekly();
  const current = keyOfWeek(eatNow());
  await assert.rejects(weekly.sendWeeklyReport({ weekKey: current }), (e) => e.statusCode === 400);
  await assert.rejects(weekly.sendWeeklyReport({ weekKey: current, silent: true }), (e) => e.statusCode === 400);
  assert.equal(calls.built, 0);
  assert.equal(calls.saves.length, 0);
});

test('weekly: a re-run after it went out answers "Already sent" without building or archiving', async () => {
  const { weekly, calls } = loadWeekly({ existingKeys: ['weekly:2026-W02'] });
  const r = await weekly.sendWeeklyReport({ weekKey: '2026-W02' });
  assert.equal(r.reason, 'Already sent for 2026-W02');
  assert.equal(calls.built, 0);
  assert.equal(calls.saves.length, 0);
  const legacy = loadWeekly({ lastWeeklySent: '2026-W02' });
  assert.equal((await legacy.weekly.sendWeeklyReport({ weekKey: '2026-W02' })).sent, false);
  assert.equal(legacy.calls.saves.length, 0);
});

test('weekly: the real send archives and queues under the week\'s key; a forced test keeps the PDF on file', async () => {
  const { weekly, calls } = loadWeekly();
  await weekly.sendWeeklyReport({ weekKey: '2026-W02' });
  assert.equal(calls.saves[0].periodKey, '2026-W02');
  assert.equal(calls.saves[0].keep, false);
  assert.deepEqual(calls.queued, ['weekly:2026-W02']);

  const forced = loadWeekly({ existingKeys: ['weekly:2026-W02'] });
  await forced.weekly.sendWeeklyReport({ weekKey: '2026-W02', force: true });
  assert.equal(forced.calls.saves[0].keep, true);
  assert.match(forced.calls.queued[0], /^weekly:2026-W02:\d+$/);

  const repair = loadWeekly({ existingKeys: ['weekly:2026-W02'] });
  await repair.weekly.sendWeeklyReport({ weekKey: '2026-W02', force: true, silent: true });
  assert.equal(repair.calls.saves[0].keep, false); // the explicit silent repair does rewrite it
  assert.equal(repair.calls.queued.length, 0);
});

test('monthly: no month 13, no month that is not over, and "Already sent" before anything is built', async () => {
  const { calls } = loadWeekly({ existingKeys: ['monthly:2026-01'] });
  const monthly = fresh('../src/services/monthlyReport.service');
  await assert.rejects(monthly.sendMonthlyReport({ monthKey: '2026-13' }), (e) => e.statusCode === 400);
  await assert.rejects(monthly.sendMonthlyReport({ monthKey: '2026-00' }), (e) => e.statusCode === 400);
  await assert.rejects(monthly.sendMonthlyReport({ monthKey: eatNow().format('YYYY-MM') }), (e) => e.statusCode === 400);
  await assert.rejects(monthly.sendMonthlyReport({ monthKey: eatNow().add(1, 'month').format('YYYY-MM'), force: true }), (e) => e.statusCode === 400);
  const r = await monthly.sendMonthlyReport({ monthKey: '2026-01' });
  assert.equal(r.reason, 'Already sent for 2026-01');
  assert.equal(calls.built, 0);
  assert.equal(calls.saves.length, 0);
});

// ── the archive: a forced test send never replaces the report on file ────────
test('archive.save with keep returns the report on file untouched; without keep it replaces it', async () => {
  const calls = { upserts: 0 };
  let onFile = { id: 'old', type: 'MONTHLY', periodKey: '2026-10', label: 'October 2026' };
  stub('../src/config/prisma', {
    reportArchive: {
      findUnique: async () => onFile,
      upsert: async ({ create }) => { calls.upserts += 1; return { id: 'new', ...create }; },
    },
  });
  const archive = fresh('../src/services/reportArchive.service');
  const args = { type: 'MONTHLY', periodKey: '2026-10', label: 'October 2026', from: new Date(), to: new Date(), pdf: Buffer.from('x') };
  assert.equal((await archive.save({ ...args, keep: true })).id, 'old');
  assert.equal(calls.upserts, 0);
  onFile = null;
  assert.equal((await archive.save({ ...args, keep: true })).id, 'new'); // nothing on file yet: stored
  assert.equal((await archive.save(args)).id, 'new');
  assert.equal(calls.upserts, 2);
});

// ── the daily report's activity line ─────────────────────────────────────────
test('daily: "Orders" are orders issued that day and "Returns" are returns accepted that day', async () => {
  const seen = {};
  const counter = (name, n) => async (args) => { (seen[name] = seen[name] || []).push(args.where); return n; };
  stub('../src/config/prisma', {
    $transaction: (list) => Promise.all(list),
    stockRequest: { count: counter('stockRequest', 4) },
    settlementSubmission: { count: counter('settlementSubmission', 3) },
    return: { count: counter('return', 2) },
    settlement: { count: counter('settlement', 1) },
    inventoryTransaction: { groupBy: async () => [] },
  });
  const report = { revenue: 0, cogs: 0, grossProfit: 0, expenses: 0, netProfit: 0, cashFlow: { moneyIn: 0, moneyOut: 0, net: 0 }, boxesSold: 0, topProducts: [] };
  stub('../src/services/finance.service', { report: async () => report, accountBalances: async () => [], supplierSummaries: async () => [] });
  stub('../src/services/reorder.service', { lowStock: async () => [] });
  stub('../src/services/settlement.service', { summary: async () => ({ overdueCount: 0 }) });
  stub('../src/services/inventory.service', { valuation: async () => ({}) });
  stub('../src/services/reportData.service', { periodExtras: async () => ({ reps: [] }), stockBlock: () => ({ costValue: 0, units: 0 }) });
  const daily = fresh('../src/services/dailyBusinessReport.service');
  const d = await daily.buildDailyData('2026-11-10');
  assert.deepEqual(d.activity, { newOrders: 1, settlements: 3, returns: 2 });
  assert.ok(seen.settlement[0].issuedAt, 'orders counted on the day they were issued');
  const ret = seen.return.find((w) => w.decidedAt);
  assert.deepEqual(ret.status, { in: ['APPROVED', 'COMPLETED'] });
  assert.ok(!(seen.stockRequest || []).some((w) => w.createdAt), 'requests created are no longer counted as orders');

  // a late send says so under the date
  const text = daily.buildWhatsAppText(d, null, { late: new Date('2026-11-11T06:00:00Z') });
  assert.match(text, /^\*ZELAB — DAILY REPORT\*\n10 November 2026\nSent late: 11 Nov 2026 \| 09:00 EAT \(cash and stock as at then\)\n/);
  assert.ok(!daily.buildWhatsAppText(d, null).includes('Sent late'));
});

// ── notifications: mark read only what you can see ──────────────────────────
test('a rep cannot mark someone else\'s notification (or an admin broadcast) read by its id', async () => {
  const rows = { mine: { id: 'mine', userId: 'u1' }, other: { id: 'other', userId: 'u2' }, broadcast: { id: 'broadcast', userId: null } };
  const updated = [];
  stub('../src/config/prisma', {
    notification: {
      findUnique: async ({ where }) => rows[where.id] || null,
      update: async ({ where }) => { updated.push(where.id); return rows[where.id]; },
    },
  });
  const svc = fresh('../src/services/notification.service');
  const rep = { id: 'u1', role: 'SALES_REP' };
  await assert.rejects(svc.markRead('other', rep), (e) => e.statusCode === 404);
  await assert.rejects(svc.markRead('broadcast', rep), (e) => e.statusCode === 404);
  await assert.rejects(svc.markRead('missing', rep), (e) => e.statusCode === 404);
  await svc.markRead('mine', rep);
  await svc.markRead('broadcast', { id: 'a1', role: 'ADMIN' }); // admins see every notification (unchanged)
  assert.deepEqual(updated, ['mine', 'broadcast']);
});
