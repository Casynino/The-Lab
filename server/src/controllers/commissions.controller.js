'use strict';

const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { ok, created, paginated } = require('../utils/response');
const { parsePagination } = require('../utils/pagination');
const commission = require('../services/commission.service');
const bonus = require('../services/bonus.service');
const finance = require('../services/finance.service');
const audit = require('../services/audit.service');
const { ROLES } = require('../middleware/authorize');

// Commission exactly as before, plus `bonus` (the bonus wallet: what is ready to withdraw, waiting, paid)
// and `combined` (the card's figures, commission + bonus). Commission fields keep their meaning.
async function withBonus(c, salesRepId) {
  const b = await bonus.walletForRep(salesRepId);
  return { ...c, bonus: b, combined: bonus.combine(c, b) };
}

const me = asyncHandler(async (req, res) => {
  if (!req.user.salesRepId) throw ApiError.forbidden('Only sales representatives have commissions');
  const c = await commission.computeForRep(req.user.salesRepId);
  // The rep is told the window is open and until when. Why it was opened, and
  // by whom, is The Doctor's note about them and is stripped here rather than
  // in the service, so the admin paths keep it.
  return ok(res, await withBonus({ ...c, emergency: { open: c.emergency.open, until: c.emergency.until } }, req.user.salesRepId));
});

// The rep's own page as pictures: earnings by month, by brand and product, and their settlement record.
const insightsMe = asyncHandler(async (req, res) => {
  if (!req.user.salesRepId) throw ApiError.forbidden('Only sales representatives have commissions');
  return ok(res, await require('../services/repInsights.service').insightsForRep(req.user.salesRepId));
});

const getForRep = asyncHandler(async (req, res) => ok(res, await withBonus(await commission.computeForRep(req.params.salesRepId), req.params.salesRepId)));

const summary = asyncHandler(async (_req, res) => ok(res, await commission.summaryAllReps()));

const rule = asyncHandler(async (_req, res) => ok(res, await commission.getRule()));

const listWithdrawals = asyncHandler(async (req, res) => {
  const q = req.validatedQuery || req.query;
  const pagination = parsePagination(q, { defaultSortBy: 'requestedAt', defaultSortDir: 'desc', allowedSortFields: ['requestedAt', 'createdAt', 'amount'] });
  const filters = { ...q };
  if (req.user.role === ROLES.SALES_REP) filters.salesRepId = req.user.salesRepId;
  const { items, total } = await commission.listWithdrawals(filters, pagination);
  return paginated(res, items, { page: pagination.page, limit: pagination.limit, total });
});

const requestWithdrawal = asyncHandler(async (req, res) => {
  if (!req.user.salesRepId) throw ApiError.forbidden('Only sales representatives can request withdrawals');
  const source = req.body.source || 'COMMISSION';
  const w = await commission.requestWithdrawal(req.user.salesRepId, req.body.amount, req.body.notes, req.user, { source });
  await audit.record(req, { action: 'CREATE', entityType: 'CommissionWithdrawal', entityId: w.id, newValues: { amount: w.amount, source } });
  return created(res, w);
});

const decideWithdrawal = asyncHandler(async (req, res) => {
  const w = await commission.decideWithdrawal(req.params.id, req.body.action, req.user);
  // Paying a withdrawal moves real money. `fromOwnPocket` says the owner
  // funded it personally, which also records his contribution so the
  // business account is not drained for money it never held.
  if (w.status === 'PAID') {
    finance.recordCommissionPayment({
      amount: w.amount,
      who: w.salesRep?.user?.name,
      refId: w.id,
      occurredAt: w.paidAt || new Date(),
      fromOwnPocket: req.body.fromOwnPocket === true,
      source: w.source,
    }, req.user).catch(() => {});
  }
  await audit.record(req, { action: req.body.action, entityType: 'CommissionWithdrawal', entityId: req.params.id, newValues: { source: w.source } });
  return ok(res, w);
});

// ── Commission rates (admin) ─────────────────────────────────────────────────
const listRates = asyncHandler(async (_req, res) => ok(res, await commission.listRates()));

const createRate = asyncHandler(async (req, res) => {
  const row = await commission.createRate(req.body, req.user);
  await audit.record(req, { action: 'CREATE', entityType: 'CommissionRate', entityId: row.id, newValues: { brandId: row.brandId, perBox: row.perBox, effectiveFrom: row.effectiveFrom } });
  return created(res, row);
});

const deleteRate = asyncHandler(async (req, res) => {
  const out = await commission.deleteRate(req.params.id);
  await audit.record(req, { action: 'DELETE', entityType: 'CommissionRate', entityId: req.params.id });
  return ok(res, out);
});

// ── Sales bonus ──────────────────────────────────────────────────────────────
// The cycle in progress, the bonus wallet and bonus withdrawals (`wallet`, `history`), plus the bonuses paid
// by hand before the wallet existed (`paidAwards`, audit money-flows-10) — only his own. A caller who is not
// a rep is refused: with no rep the old code summed every rep's sales.
const bonusMe = asyncHandler(async (req, res) => {
  if (!req.user.salesRepId) throw ApiError.forbidden('Only sales representatives have a sales bonus');
  const [progress, paidAwards] = await Promise.all([
    bonus.progressForRep(req.user.salesRepId),
    bonus.paidAwardsForRep(req.user.salesRepId),
  ]);
  return ok(res, { ...progress, paidAwards });
});
const bonusSummary = asyncHandler(async (_req, res) => ok(res, await bonus.summaryAllReps()));
const bonusRules = asyncHandler(async (_req, res) => ok(res, await bonus.listRules()));

const createBonusRule = asyncHandler(async (req, res) => {
  const row = await bonus.createRule(req.body, req.user);
  await audit.record(req, { action: 'CREATE', entityType: 'BonusRule', entityId: row.id, newValues: { salesTarget: row.salesTarget, bonusAmount: row.bonusAmount, effectiveFrom: row.effectiveFrom } });
  return created(res, row);
});

const updateBonusRule = asyncHandler(async (req, res) => {
  const row = await bonus.updateRule(req.params.id, req.body, req.user);
  await audit.record(req, { action: 'UPDATE', entityType: 'BonusRule', entityId: row.id, newValues: { salesTarget: row.salesTarget, bonusAmount: row.bonusAmount, effectiveFrom: row.effectiveFrom } });
  return ok(res, row);
});

const setBonusRuleActive = asyncHandler(async (req, res) => {
  const row = await bonus.setRuleActive(req.params.id, req.body.isActive);
  await audit.record(req, { action: 'UPDATE', entityType: 'BonusRule', entityId: row.id, newValues: { isActive: row.isActive } });
  return ok(res, row);
});

const bonusAwards = asyncHandler(async (req, res) => ok(res, await bonus.listAwards({ status: req.query.status })));

// Retired 14 Nov 2026. A bonus is now credited into the rep's wallet when it is reached and taken out as a
// BONUS withdrawal; a payment made here, outside the wallet, would pay the same bonus twice.
const payBonusAward = asyncHandler(async () => {
  throw new ApiError(410, 'Paying a bonus here has been retired. Bonuses now go into the rep\'s wallet when they are reached; the rep withdraws it and you pay it from Withdrawal requests.');
});

// Credit or claw back a rep's commission by hand. Deducting has always been
// possible through a penalty; this is the other direction, which nothing could
// do — and it is the same lever, so a correction can be undone by its opposite.
// Open or close a rep's one-off withdrawal window. Admin only: it sets aside a
// money rule for one person.
//
// The action string is deliberately its own word rather than a generic UPDATE.
// The audit screen in this app renders only when / who / action / entity and
// never the values recorded with them, and it searches on the action — so
// "EMERGENCY_WINDOW_OPEN" is visible in the table and findable by typing
// "emergency", where a note buried in newValues would be neither.
const setEmergencyWindow = asyncHandler(async (req, res) => {
  const { salesRepId, open, reason } = req.body || {};
  const row = await commission.setEmergencyWindow({ salesRepId, open: Boolean(open), reason }, req.user);
  await audit.record(req, {
    action: open ? 'EMERGENCY_WINDOW_OPEN' : 'EMERGENCY_WINDOW_CLOSE',
    entityType: 'SalesRepresentative',
    entityId: salesRepId,
    newValues: { reason: reason || null, openedAt: row.emergencyWindowAt },
  });
  return ok(res, row);
});

const adjustEarned = asyncHandler(async (req, res) => {
  // The audit row is written inside the service's transaction: it is also how a repeat of the same
  // correction is recognised (audit backend-integrity-2).
  const row = await commission.adjustEarned(req.body || {}, req.user, {
    record: (tx, r, { amount, note }) => audit.record(req, {
      action: 'UPDATE',
      entityType: 'SalesRepresentative',
      entityId: r.id,
      newValues: {
        kind: 'COMMISSION_ADJUSTMENT',
        amount,
        adjustmentNow: r.commissionAdjustment,
        note: note || null,
      },
    }, tx),
  });
  return ok(res, row);
});

module.exports = {
  adjustEarned,
  setEmergencyWindow,
  listRates, createRate, deleteRate,
  bonusMe, bonusSummary, bonusRules, createBonusRule, updateBonusRule, setBonusRuleActive, bonusAwards, payBonusAward,
  me, insightsMe, getForRep, summary, rule, listWithdrawals, requestWithdrawal, decideWithdrawal };
