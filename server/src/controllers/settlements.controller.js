'use strict';

const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { ok, created, paginated } = require('../utils/response');
const { parsePagination } = require('../utils/pagination');
const settlement = require('../services/settlement.service');
const submission = require('../services/settlementSubmission.service');
const finance = require('../services/finance.service');
const penalty = require('../services/penalty.service');
const audit = require('../services/audit.service');
const { ROLES } = require('../middleware/authorize');

const list = asyncHandler(async (req, res) => {
  const q = req.validatedQuery || req.query;
  const pagination = parsePagination(q, { defaultSortBy: 'deadlineAt', defaultSortDir: 'asc', allowedSortFields: ['deadlineAt', 'createdAt', 'assignedValue'] });
  const filters = { ...q };
  if (req.user.role === ROLES.SALES_REP) filters.salesRepId = req.user.salesRepId;
  const { items, total } = await settlement.list(filters, pagination);
  return paginated(res, items, { page: pagination.page, limit: pagination.limit, total });
});

const summary = asyncHandler(async (_req, res) => {
  // Keep reminders + real penalty deductions current without blocking the
  // response — background() survives the post-response serverless freeze.
  const wa = require('../services/whatsappNotify.service');
  wa.background(settlement.sendDueReminders());
  wa.background(penalty.applyDuePenalties());
  return ok(res, await settlement.summary());
});

const analytics = asyncHandler(async (_req, res) => ok(res, await settlement.analytics()));

const get = asyncHandler(async (req, res) => {
  const s = await settlement.get(req.params.id);
  if (req.user.role === ROLES.SALES_REP && s.salesRepId !== req.user.salesRepId) {
    throw ApiError.forbidden('This order is not yours');
  }
  return ok(res, s);
});

const settle = asyncHandler(async (req, res) => {
  const result = await settlement.settle(req.params.id, req.user, req.body);
  await audit.record(req, { action: 'SETTLE', entityType: 'Settlement', entityId: req.params.id });
  return ok(res, result);
});

// Submit a settlement for approval — PENDING, no business impact until The
// Doctor approves. (Ownership is enforced in the service for reps.)
const submitSettlement = asyncHandler(async (req, res) => {
  const sub = await submission.submit(req.params.id, req.body, req.user);
  await audit.record(req, {
    action: 'SUBMIT_SETTLEMENT',
    entityType: 'SettlementSubmission',
    entityId: sub.id,
    newValues: { settlementId: req.params.id, productId: req.body.productId, boxes: sub.boxes, amount: sub.amount },
  });
  return created(res, sub);
});

// Where a rep's settlement money goes — names and payment details only, never
// balances (those are The Doctor's business).
//
// The rep passes the brand of the product they are settling and gets back the
// ONE account that brand settles to: OHIS → M-Pesa, Civlily → Airtel Money.
// The rule lives in finance.paymentAccountsForBrand and nowhere else — this
// endpoint used to return every active account and leave the client to filter,
// which is how a rep came to be offered Cash alongside their brand's wallet.
const paymentAccounts = asyncHandler(async (req, res) => {
  const q = req.validatedQuery || req.query;
  // One value, or none. A repeated ?brandId= arrives as an array and would
  // match no brand at all, leaving the rep with an empty picker.
  const brandId = Array.isArray(q.brandId) ? q.brandId[0] : q.brandId;
  return ok(res, await finance.paymentAccountsForBrand(typeof brandId === 'string' && brandId ? brandId : null));
});

// Admin approval center: all settlements awaiting verification.
const pendingApprovals = asyncHandler(async (_req, res) => ok(res, await submission.listPending()));

const approveSubmission = asyncHandler(async (req, res) => {
  const result = await submission.approve(req.params.id, req.user);
  await audit.record(req, { action: 'APPROVE_SETTLEMENT', entityType: 'SettlementSubmission', entityId: req.params.id });
  return ok(res, result);
});

const rejectSubmission = asyncHandler(async (req, res) => {
  const result = await submission.reject(req.params.id, req.user, req.body.reason);
  await audit.record(req, { action: 'REJECT_SETTLEMENT', entityType: 'SettlementSubmission', entityId: req.params.id });
  return ok(res, result);
});

// POST /settlements/:id/self-extend — the rep grants themselves +96h.
const selfExtend = asyncHandler(async (req, res) => {
  const dec = await settlement.selfExtend(req.params.id, req.user);
  await audit.record(req, {
    action: 'UPDATE',
    entityType: 'Settlement',
    entityId: dec.id,
    newValues: {
      kind: 'SELF_EXTENSION',
      settlementNumber: dec.settlementNumber,
      previousDeadline: dec.preExtensionDeadline,
      newDeadline: dec.deadlineAt,
      hoursAdded: settlement.SELF_EXTENSION_HOURS,
      penaltyPerDay: dec.penaltyPerDay,
    },
  });
  return ok(res, dec);
});

const refreshOverdue = asyncHandler(async (_req, res) => ok(res, await settlement.refreshOverdue()));

const extendDeadline = asyncHandler(async (req, res) => {
  const result = await settlement.extendDeadline(req.params.id, req.body);
  await audit.record(req, {
    action: 'EXTEND_DEADLINE',
    entityType: 'Settlement',
    entityId: req.params.id,
    newValues: { deadlineAt: result.deadlineAt },
  });
  return ok(res, result);
});

module.exports = {
  list, summary, analytics, get, settle, refreshOverdue, extendDeadline, selfExtend,
  submitSettlement, pendingApprovals, approveSubmission, rejectSubmission, paymentAccounts,
};
