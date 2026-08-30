'use strict';

// ===========================================================================
// COMMISSION PENALTIES — a real financial ledger, not a display.
//
// Every late-settlement fine is a PERSISTED SettlementPenalty row (a permanent
// transaction). The commission balance is earned − paid − Σ(persisted
// penalties), so applying a penalty genuinely reduces the rep's balance and may
// take it negative (the rep then owes The Lab; future earnings offset it).
//
// Timing: the first TZS 10,000 lands the moment the 72h deadline passes (no
// grace), then another TZS 10,000 for every further 24h, until the order is
// completed (settlement or return approved). While a return is pending approval
// the countdown pauses (no new fines); rejecting the return shifts the deadline
// forward by the pending duration so those hours are never charged — but prior
// penalties are never erased.
// ===========================================================================

const prisma = require('../config/prisma');
const notification = require('./notification.service');
const { round2, toNumber, formatCurrency } = require('../utils/money');

const PENALTY_PER_DAY = 10000; // TZS — standard 72h programme
// A rep who self-extends gets 96 extra hours but accepts a steeper price:
// the daily late fine doubles, and a failed return costs more.
const EXTENDED_PENALTY_PER_DAY = 20000; // TZS — after the full 168h expires
const RETURN_FAILURE_PENALTY = 15000; // TZS — return not decided within 24h
const EXTENDED_RETURN_FAILURE_PENALTY = 30000; // TZS — same, on an extended order

// The daily late-fine rate for a settlement. `s` needs only selfExtendedAt.
const dailyRateFor = (s) => (s && s.selfExtendedAt ? EXTENDED_PENALTY_PER_DAY : PENALTY_PER_DAY);
// The fine when a return isn't decided inside its 24h window.
const returnFailureRateFor = (s) => (s && s.selfExtendedAt ? EXTENDED_RETURN_FAILURE_PENALTY : RETURN_FAILURE_PENALTY);
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Penalty-days owed for an overdue settlement: 1 the instant the deadline passes,
// then +1 every 24h. (deadlineAt <= now is guaranteed by the caller.)
function penaltyDaysDue(deadlineAt, now) {
  const msOverdue = now - new Date(deadlineAt).getTime();
  return 1 + Math.floor(msOverdue / MS_PER_DAY);
}

// Apply every penalty-day that is owed but not yet charged, across all overdue
// orders. Idempotent: it only ever creates the missing rows, so it's safe to
// run on a schedule AND opportunistically. Orders with a pending return are
// paused. Returns how many fines were applied.
async function applyDuePenalties() {
  const now = Date.now();
  const overdue = await prisma.settlement.findMany({
    where: { status: { in: ['OPEN', 'PARTIAL', 'OVERDUE'] }, deadlineAt: { lte: new Date(now) } },
    include: { salesRep: { include: { user: { select: { id: true, name: true } } } } },
  });

  let applied = 0;
  for (const s of overdue) {
    // Pause while a return is awaiting The Doctor's decision.
    const pendingReturns = await prisma.return.count({ where: { settlementId: s.id, status: 'PENDING' } });
    if (pendingReturns > 0) continue;

    const due = penaltyDaysDue(s.deadlineAt, now);
    // Count EVERY daily row including WAIVED ones: a forgiven fine is still a
    // charged penalty-day, so forgiveness never causes a re-charge. Rows with
    // daysOverdue = 0 are return-expiry delay fines, not daily late-fines.
    const charged = await prisma.settlementPenalty.count({ where: { settlementId: s.id, daysOverdue: { gt: 0 } } });
    if (due <= charged) continue;

    const rate = dailyRateFor(s);
    for (let day = charged + 1; day <= due; day++) {
      await prisma.settlementPenalty.create({
        data: {
          salesRepId: s.salesRepId,
          settlementId: s.id,
          kind: 'LATE_FINE',
          amount: rate,
          daysOverdue: day,
          notes: s.selfExtendedAt
            ? `Extended settlement period expired — ${s.settlementNumber} not completed within 168 hours (day ${day}).`
            : `Late settlement fine — failed to complete ${s.settlementNumber} within 72 hours (day ${day}).`,
        },
      });
      applied++;
    }

    const newFines = due - charged;
    const fineValue = newFines * rate;
    const repUserId = s.salesRep?.user?.id;
    const repName = s.salesRep?.user?.name || 'A rep';
    if (repUserId) {
      notification.notifyUser(repUserId, {
        type: 'GENERAL',
        severity: 'CRITICAL',
        title: `${formatCurrency(fineValue)} late settlement fine applied`,
        message: s.selfExtendedAt
          ? `${formatCurrency(fineValue)} has been deducted from your commission: the EXTENDED settlement period (168 hours) on order ${s.settlementNumber} has expired (${due} day${due !== 1 ? 's' : ''} late). ${formatCurrency(rate)} applies every further day until you settle or return.`
          : `${formatCurrency(fineValue)} has been deducted from your commission because order ${s.settlementNumber} is overdue (${due} day${due !== 1 ? 's' : ''}). Settle or return to stop the daily fine.`,
        entityType: 'Settlement',
        entityId: s.id,
      }).catch(() => {});
    }
    notification.notifyAdmins({
      type: 'GENERAL',
      severity: 'INFO',
      title: 'Settlement penalty applied',
      message: `${formatCurrency(fineValue)} penalty applied to ${repName} for ${s.settlementNumber} (now ${due} day${due !== 1 ? 's' : ''} overdue).`,
      entityType: 'Settlement',
      entityId: s.id,
    }).catch(() => {});
  }

  return { applied };
}

// Persisted penalties for a rep, grouped per order — for the commission UI.
async function penaltyBreakdownForRep(salesRepId) {
  const grouped = await prisma.settlementPenalty.groupBy({
    by: ['settlementId'],
    where: { salesRepId, status: 'APPLIED' },
    _sum: { amount: true },
    _count: true,
    _max: { daysOverdue: true },
  });
  if (grouped.length === 0) return { total: 0, breakdown: [] };

  // Manual deductions have no settlement — keep them out of the id lookups.
  const ids = grouped.map((g) => g.settlementId).filter(Boolean);
  const [settlements, pendingRets] = await Promise.all([
    prisma.settlement.findMany({ where: { id: { in: ids } }, select: { id: true, settlementNumber: true, status: true, selfExtendedAt: true } }),
    ids.length
      ? prisma.return.groupBy({ by: ['settlementId'], where: { settlementId: { in: ids }, status: 'PENDING' }, _count: true })
      : [],
  ]);
  const sMap = new Map(settlements.map((s) => [s.id, s]));
  const pendingMap = new Map(pendingRets.map((r) => [r.settlementId, r._count]));

  let total = 0;
  const breakdown = grouped
    .map((g) => {
      const amt = round2(toNumber(g._sum.amount));
      total += amt;
      const s = g.settlementId ? sMap.get(g.settlementId) : null;
      return {
        settlementId: g.settlementId,
        settlementNumber: s?.settlementNumber || (g.settlementId ? '—' : 'Manual deduction'),
        // 0 for manual deductions and return-expiry fines — they are not late,
        // so callers must not render them as overdue days.
        daysOverdue: g._max.daysOverdue || 0,
        fines: g._count,
        penaltyPerDay: dailyRateFor(s),
        totalPenalty: amt,
        closed: s?.status === 'SETTLED',
        exemptPendingReturn: (pendingMap.get(g.settlementId) || 0) > 0,
      };
    })
    .sort((a, b) => b.totalPenalty - a.totalPenalty);

  return { total: round2(total), breakdown };
}

// Total penalties charged to a rep (drives the commission balance).
async function totalPenaltiesForRep(salesRepId) {
  const agg = await prisma.settlementPenalty.aggregate({ where: { salesRepId, status: 'APPLIED' }, _sum: { amount: true } });
  return round2(toNumber(agg._sum.amount));
}

// Manual commission deduction by The Doctor: removes an amount from a rep's
// available balance without touching money or future accrual. Lives in the
// same ledger as fines, so it's permanent, visible on the Commissions page,
// and reversible with the Forgive button if ever needed.
async function adjustCommission({ salesRepId, amount, reason }, actor) {
  const ApiError = require('../utils/ApiError');
  const amt = round2(toNumber(amount));
  if (!(amt > 0)) throw ApiError.badRequest('Enter an amount greater than zero');
  if (!salesRepId) throw ApiError.badRequest('Choose a sales rep');
  const rep = await prisma.salesRepresentative.findUnique({
    where: { id: salesRepId },
    include: { user: { select: { id: true, name: true } } },
  });
  if (!rep) throw ApiError.notFound('Sales rep not found');

  const row = await prisma.settlementPenalty.create({
    data: {
      salesRepId,
      settlementId: null,
      kind: 'ADJUSTMENT',
      amount: amt,
      daysOverdue: 0,
      notes: reason || `Commission deduction by The Lab.`,
    },
  });

  if (rep.user?.id) {
    notification.notifyUser(rep.user.id, {
      type: 'GENERAL',
      severity: 'WARNING',
      title: `${formatCurrency(amt)} deducted from your commission`,
      message: `The Lab deducted ${formatCurrency(amt)} from your commission balance.${reason ? ` Reason: ${reason}` : ''} Future commission is not affected.`,
      entityType: 'Commission',
      entityId: row.id,
    }).catch(() => {});
  }

  return row;
}

// Forgive a fine: the row stays as a permanent record (and still counts for
// idempotence so it is never re-charged), but it stops reducing the rep's
// balance — the money returns to their commission instantly.
async function waivePenalty(id, actor, reason) {
  const p = await prisma.settlementPenalty.findUnique({
    where: { id },
    include: {
      salesRep: { include: { user: { select: { id: true, name: true } } } },
      settlement: { select: { settlementNumber: true } },
    },
  });
  if (!p) {
    const ApiError = require('../utils/ApiError');
    throw ApiError.notFound('Penalty not found');
  }
  if (p.status === 'WAIVED') {
    const ApiError = require('../utils/ApiError');
    throw ApiError.badRequest('This fine has already been forgiven');
  }

  const updated = await prisma.settlementPenalty.update({
    where: { id },
    data: { status: 'WAIVED', waivedAt: new Date(), waivedById: actor?.id || null, waiveReason: reason || null },
  });

  const repUserId = p.salesRep?.user?.id;
  if (repUserId) {
    notification.notifyUser(repUserId, {
      type: 'GENERAL',
      severity: 'INFO',
      title: `${formatCurrency(p.amount)} fine forgiven`,
      message: `The Lab forgave your late-settlement fine on order ${p.settlement?.settlementNumber || ''}. ${formatCurrency(p.amount)} has been returned to your commission balance.`,
      entityType: 'Settlement',
      entityId: p.settlementId,
    }).catch(() => {});
  }

  return updated;
}

// Stored penalty transactions (history), most recent first.
// `includeWaived` is false for a rep looking at their own fines: a forgiven
// fine has been written off, and listing it only leaves the rep staring at a
// debt that is no longer theirs. The row itself must survive — the sweep counts
// rows to know which penalty-days it already charged — so it is hidden, never
// deleted. Admins still see everything, forgiven rows included.
async function listPenalties({ salesRepId, settlementId, page = 1, limit = 20, includeWaived = true }) {
  const where = {};
  if (salesRepId) where.salesRepId = salesRepId;
  if (settlementId) where.settlementId = settlementId;
  if (!includeWaived) where.status = 'APPLIED';
  const skip = (page - 1) * limit;
  const [items, total] = await Promise.all([
    prisma.settlementPenalty.findMany({
      where,
      include: {
        salesRep: { include: { user: { select: { name: true } } } },
        settlement: { select: { settlementNumber: true } },
      },
      orderBy: { appliedAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.settlementPenalty.count({ where }),
  ]);
  // Whole-table counts by status, so the client never derives a badge from
  // one page of a paginated list — with 142 live fines and a page of 50, the
  // badge understated by 92 and nobody could tell.
  const [applied, waived] = await Promise.all([
    prisma.settlementPenalty.count({ where: { ...where, status: 'APPLIED' } }),
    prisma.settlementPenalty.count({ where: { ...where, status: 'WAIVED' } }),
  ]);
  return { items, total, counts: { applied, waived } };
}

module.exports = {
  applyDuePenalties,
  penaltyBreakdownForRep,
  totalPenaltiesForRep,
  adjustCommission,
  waivePenalty,
  listPenalties,
  penaltyDaysDue,
  dailyRateFor,
  returnFailureRateFor,
  PENALTY_PER_DAY,
  EXTENDED_PENALTY_PER_DAY,
  RETURN_FAILURE_PENALTY,
  EXTENDED_RETURN_FAILURE_PENALTY,
};
