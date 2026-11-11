'use strict';

// ── The weekly report goes out on TUESDAY 08:00 EAT, for the Monday–Sunday week just ended ─────────
// Business rule (Nino, 11 Nov 2026). Pinned: the Vercel schedule is Tuesday 05:00 UTC (= 08:00 EAT), and
// on the cron day the report covers the completed week, in Tanzania days, not the two days of the new one.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

function load() {
  const stub = (rel, exports) => {
    const file = require.resolve(rel);
    require.cache[file] = { id: file, filename: file, loaded: true, exports };
  };
  stub('../src/config/prisma', {});
  for (const s of ['finance', 'reports', 'inventory', 'reorder', 'settlement', 'reportData']) stub(`../src/services/${s}.service`, {});
  delete require.cache[require.resolve('../src/services/weeklyReport.service')];
  return require('../src/services/weeklyReport.service');
}

// An EAT wall-clock moment, the way eatNow() builds one (UTC mode, shifted +3 h).
const { dayjs } = require('../src/utils/dates');
const eat = (iso) => dayjs.utc(iso);
const day = (d) => d.format('YYYY-MM-DD');

test('vercel.json sends the weekly report on Tuesday 05:00 UTC (08:00 EAT)', () => {
  const v = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'vercel.json'), 'utf8'));
  const cron = v.crons.find((c) => c.path === '/api/cron/weekly-report');
  assert.equal(cron.schedule, '0 5 * * 2');
});

test('on Tuesday 08:00 EAT it reports the Monday–Sunday week that just ended', () => {
  const { reportWeek, REPORT_WEEKDAY } = load();
  assert.equal(REPORT_WEEKDAY, 2);
  const w = reportWeek(undefined, eat('2026-11-10T08:00:00')); // Tuesday 10 Nov 2026
  assert.equal(day(w.start), '2026-11-02'); // Monday
  assert.equal(day(w.end), '2026-11-08');   // Sunday
});

test('a manual send on Monday also gives last week; from Wednesday the current week to date', () => {
  const { reportWeek } = load();
  const mon = reportWeek(undefined, eat('2026-11-09T10:00:00'));
  assert.equal(day(mon.start), '2026-11-02');
  assert.equal(day(mon.end), '2026-11-08');
  const wed = reportWeek(undefined, eat('2026-11-11T10:00:00'));
  assert.equal(day(wed.start), '2026-11-09');
  assert.equal(day(wed.end), '2026-11-11');
});

test('Tanzania days: 00:30 EAT on Tuesday is already Tuesday (UTC would still say Monday)', () => {
  const { reportWeek } = load();
  const w = reportWeek(undefined, eat('2026-11-10T00:30:00'));
  assert.equal(day(w.start), '2026-11-02');
  assert.equal(day(w.end), '2026-11-08');
});

test('a pinned week key still opens that exact week (old PDF links)', () => {
  const { reportWeek } = load();
  const w = reportWeek('2026-W45');
  assert.equal(day(w.start), '2026-11-02');
  assert.equal(day(w.end), '2026-11-08');
});
