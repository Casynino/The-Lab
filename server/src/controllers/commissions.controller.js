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

const me = asyncHandler(async (req, res) => {
  if (!req.user.salesRepId) throw ApiError.forbidden('Only sales representatives have commissions');
  return ok(res, await commission.computeForRep(req.user.salesRepId));
});

const getForRep = asyncHandler(async (req, res) => ok(res, await commission.computeForRep(req.params.salesRepId)));

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
  const w = await commission.requestWithdrawal(req.user.salesRepId, req.body.amount, req.body.notes, req.user);
  await audit.record(req, { action: 'CREATE', entityType: 'CommissionWithdrawal', entityId: w.id, newValues: { amount: w.amount } });
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
    }, req.user).catch(() => {});
  }
  await audit.record(req, { action: req.body.action, entityType: 'CommissionWithdrawal', entityId: req.params.id });
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
const bonusMe = asyncHandler(async (req, res) => ok(res, await bonus.progressForRep(req.user.salesRepId)));
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

// Paying a tier ends that rep's run and starts their count again from zero.
const payBonusAward = asyncHandler(async (req, res) => {
  const row = await bonus.payTier(
    { salesRepId: req.body?.salesRepId, bonusRuleId: req.body?.bonusRuleId },
    req.user,
    req.body?.notes,
  );
  await audit.record(req, { action: 'CREATE', entityType: 'BonusAward', entityId: row.id, newValues: { status: 'PAID', bonusAmount: row.bonusAmount } });
  return created(res, row);
});

module.exports = {
  listRates, createRate, deleteRate,
  bonusMe, bonusSummary, bonusRules, createBonusRule, updateBonusRule, setBonusRuleActive, bonusAwards, payBonusAward,
  me, getForRep, summary, rule, listWithdrawals, requestWithdrawal, decideWithdrawal };
