'use strict';

// ===========================================================================
// WHAT A REP SEES ON THEIR COMMISSION PAGE, AS PICTURES
//
// Nino, 10 Nov 2026: "this is where they like it the most — don't just show
// numbers; show how nicely they are doing, with pie charts, tables and graphs."
//
// Read-only. Nothing is priced here: every figure comes from the same place the
// balance does — commission.earnedLinesForRep applies the SAME rate rule as
// earnedBetween and computeForRep — and is only grouped (by month, by brand, by
// product) for the charts. Settlement record is read from the orders and fines.
// Months are the business's (Tanzanian) months.
// ===========================================================================

const prisma = require('../config/prisma');
const commission = require('./commission.service');
const { eatNow, eatRange } = require('../utils/dates');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

async function insightsForRep(salesRepId, { months = 6 } = {}) {
  const now = eatNow();
  const windows = [];
  for (let i = months - 1; i >= 0; i -= 1) {
    const r = eatRange('month', now.subtract(i, 'month'));
    windows.push({ key: r.eatStart.format('YYYY-MM'), label: r.eatStart.format('MMM'), start: r.start, end: r.end });
  }
  const from = windows[0].start;
  const to = windows[windows.length - 1].end;

  const [lines, orders, fines] = await Promise.all([
    commission.earnedLinesForRep(salesRepId, from, to),
    prisma.settlement.findMany({
      where: { salesRepId, issuedAt: { gte: from } },
      select: { id: true, status: true },
    }),
    prisma.settlementPenalty.findMany({
      where: { salesRepId, appliedAt: { gte: from } },
      select: { settlementId: true, kind: true, amount: true, status: true },
    }),
  ]);

  // ── by month: what each month's settled boxes earned ──
  const monthRows = windows.map((w) => ({ key: w.key, label: w.label, earned: 0, boxes: 0 }));
  for (const l of lines) {
    const t = new Date(l.soldAt).getTime();
    const idx = windows.findIndex((w) => t >= w.start.getTime() && t <= w.end.getTime());
    if (idx >= 0) {
      monthRows[idx].earned = round2(monthRows[idx].earned + l.amount);
      monthRows[idx].boxes += l.boxes;
    }
  }
  const totalEarned = round2(monthRows.reduce((s, m) => s + m.earned, 0));
  const totalBoxes = monthRows.reduce((s, m) => s + m.boxes, 0);
  const bestMonth = monthRows.reduce((b, m) => (m.earned > (b?.earned || 0) ? m : b), null);

  // ── by brand and by product ──
  const group = (keyOf) => {
    const m = new Map();
    for (const l of lines) {
      const k = keyOf(l);
      const row = m.get(k) || { name: k, boxes: 0, earned: 0 };
      row.boxes += l.boxes;
      row.earned = round2(row.earned + l.amount);
      m.set(k, row);
    }
    return [...m.values()].sort((a, b) => b.earned - a.earned || b.boxes - a.boxes);
  };
  const byBrand = group((l) => l.brand).map((b) => ({ brand: b.name, boxes: b.boxes, earned: b.earned, share: totalEarned > 0 ? Math.round((b.earned / totalEarned) * 1000) / 10 : 0 }));
  const topProducts = group((l) => l.product).slice(0, 5).map((p) => ({ name: p.name, boxes: p.boxes, earned: p.earned, share: totalEarned > 0 ? Math.round((p.earned / totalEarned) * 1000) / 10 : 0 }));

  // ── settlement record: of the orders closed in this window, how many were settled without a late fine ──
  const late = new Set(fines.filter((f) => f.kind === 'LATE_FINE' && f.settlementId).map((f) => f.settlementId));
  const settled = orders.filter((o) => o.status === 'SETTLED');
  const lateSettled = settled.filter((o) => late.has(o.id)).length;
  const onTime = settled.length - lateSettled;
  const active = fines.filter((f) => f.status !== 'WAIVED');
  const settlement = {
    orders: orders.length,
    settled: settled.length,
    onTime,
    late: lateSettled,
    open: orders.filter((o) => o.status === 'OPEN' || o.status === 'PARTIAL').length,
    overdue: orders.filter((o) => o.status === 'OVERDUE').length,
    onTimeRate: settled.length ? Math.round((onTime / settled.length) * 100) : null,
    fines: { count: active.length, amount: round2(active.reduce((s, f) => s + (Number(f.amount) || 0), 0)) },
  };

  return {
    windowMonths: months,
    months: monthRows,
    totals: { earned: totalEarned, boxes: totalBoxes },
    best: bestMonth && bestMonth.earned > 0 ? { label: bestMonth.label, earned: bestMonth.earned } : null,
    byBrand,
    topProducts,
    settlement,
  };
}

module.exports = { insightsForRep };
