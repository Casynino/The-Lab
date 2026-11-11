'use strict';

const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const isoWeek = require('dayjs/plugin/isoWeek');

dayjs.extend(utc);
dayjs.extend(isoWeek);

// ── Tanzania time (Africa/Dar_es_Salaam = UTC+3, no DST) ─────────────────────
// Everything date-shaped is anchored to the business's clock, not the server's.
const EAT_OFFSET_H = 3;
const eatNow = () => dayjs().utc().add(EAT_OFFSET_H, 'hour');
// Convert an EAT-clock dayjs back to the real UTC instant it represents.
const eatToUtc = (d) => d.subtract(EAT_OFFSET_H, 'hour');

// Resolve a named period ("today" | "week" | "month" | "year") or an explicit
// from/to pair into a concrete [start, end) range for ledger/sales queries.
function resolveRange({ period, from, to, start, end } = {}) {
  // Exact datetime window (Date objects / ISO datetimes) — used for
  // timezone-correct report ranges; from/to would clamp to UTC day bounds.
  if (start && end) {
    return { start: new Date(start), end: new Date(end), label: 'custom' };
  }
  // Day boundaries are the BUSINESS's day, not the server's. On Vercel the
  // server clock is UTC, so dayjs().startOf('day') would put the first three
  // hours of every Tanzanian morning into yesterday's figures — a sale at
  // 01:30 EAT on Sep 1 must not land in August's revenue.
  if (from || to) {
    const s = from ? dayjs.utc(from).startOf('day') : eatNow().subtract(30, 'day').startOf('day');
    const e = to ? dayjs.utc(to).endOf('day') : eatNow().endOf('day');
    return { start: eatToUtc(s).toDate(), end: eatToUtc(e).toDate(), label: 'custom' };
  }

  const now = eatNow();
  const win = (unit, label) => {
    const s = now.startOf(unit === 'week' ? 'isoWeek' : unit);
    const e = now.endOf(unit === 'week' ? 'isoWeek' : unit);
    return { start: eatToUtc(s).toDate(), end: eatToUtc(e).toDate(), label };
  };
  switch (period) {
    case 'today': return win('day', 'today');
    case 'week': return win('week', 'week');
    case 'year': return win('year', 'year');
    // "All time" was falling through to the month default, so every report
    // that asked for all time silently answered with the current month —
    // labelled 'month', which is why nobody noticed. It now spans everything;
    // callers that clamp to the finance epoch narrow it to go-live.
    case 'all':
      return { start: new Date(0), end: eatToUtc(now.endOf('day')).toDate(), label: 'all' };
    case 'month':
    default: return win('month', 'month');
  }
}

function daysBetween(a, b) {
  return dayjs(b).startOf('day').diff(dayjs(a).startOf('day'), 'day');
}

function daysOverdue(dueDate, reference = new Date()) {
  const d = daysBetween(dueDate, reference);
  return d > 0 ? d : 0;
}

// Exact UTC datetime window for an EAT-local day / isoWeek / month containing
// `anchor` (an EAT-clock dayjs). Returns { start, end, label } with Dates.
function eatRange(unit, anchor = eatNow()) {
  const s = anchor.startOf(unit === 'week' ? 'isoWeek' : unit);
  const e = anchor.endOf(unit === 'week' ? 'isoWeek' : unit);
  return { start: eatToUtc(s).toDate(), end: eatToUtc(e).toDate(), eatStart: s, eatEnd: e };
}

// A from/to list filter. A bare day ("2026-11-11") means that whole day in Dar es Salaam: from = 00:00
// EAT, to = the last moment of that day in EAT. `new Date('2026-11-11')` is UTC midnight = 03:00 EAT, so
// from=to=one day matched nothing and `to` dropped the whole of its day. A full timestamp is kept exactly
// as given. Only the sides that were sent are set (no 30-day default). Returns null for an unreadable date.
const DAY_ONLY = /^\d{4}-\d{2}-\d{2}$/;
function eatDayBounds({ from, to } = {}) {
  const out = {};
  const read = (v, edge) => {
    const raw = String(v).trim();
    const d = DAY_ONLY.test(raw)
      ? eatToUtc(edge === 'start' ? dayjs.utc(raw).startOf('day') : dayjs.utc(raw).endOf('day')).toDate()
      : new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  };
  if (from) { out.gte = read(from, 'start'); if (!out.gte) return null; }
  if (to) { out.lte = read(to, 'end'); if (!out.lte) return null; }
  return out;
}

module.exports = { dayjs, resolveRange, daysBetween, daysOverdue, eatNow, eatToUtc, eatRange, eatDayBounds, EAT_OFFSET_H };
