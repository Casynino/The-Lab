'use strict';

const asyncHandler = require('../utils/asyncHandler');
const { ok, paginated } = require('../utils/response');
const { parsePagination } = require('../utils/pagination');
const penaltyService = require('../services/penalty.service');
const audit = require('../services/audit.service');
const { ROLES } = require('../middleware/authorize');

// POST /penalties/apply  — admin manually triggers the due-penalty pass (also
// runs automatically via the settlement sweep / cron).
const apply = asyncHandler(async (req, res) => {
  const penalties = await penaltyService.applyDuePenalties();
  await audit.record(req, {
    action: 'CREATE',
    entityType: 'SettlementPenalty',
    newValues: { applied: penalties.applied },
  });
  return ok(res, { penalties });
});

// GET /penalties  — list stored penalty audit records (admin) or own (rep).
const list = asyncHandler(async (req, res) => {
  const q = req.query;
  const pagination = parsePagination(q, { defaultSortBy: 'appliedAt', defaultSortDir: 'desc' });
  const filters = {};
  if (req.user.role === ROLES.SALES_REP) {
    filters.salesRepId = req.user.salesRepId;
    filters.includeWaived = false; // a written-off fine is not the rep's to carry
  } else if (q.salesRepId) {
    filters.salesRepId = q.salesRepId;
  }
  if (q.settlementId) filters.settlementId = q.settlementId;

  const { items, total, counts } = await penaltyService.listPenalties({
    ...filters,
    page: pagination.page,
    limit: pagination.limit,
  });
  return paginated(res, items, { page: pagination.page, limit: pagination.limit, total, counts });
});

// POST /penalties/:id/waive — forgive one fine (admin): stays on record,
// stops reducing the rep's commission balance.
const waive = asyncHandler(async (req, res) => {
  const updated = await penaltyService.waivePenalty(req.params.id, req.user, req.body?.reason);
  await audit.record(req, {
    action: 'UPDATE',
    entityType: 'SettlementPenalty',
    entityId: updated.id,
    newValues: { status: 'WAIVED', amount: updated.amount, reason: req.body?.reason || null },
  });
  return ok(res, updated);
});

// POST /penalties/adjust — manual commission deduction (admin).
const adjust = asyncHandler(async (req, res) => {
  const row = await penaltyService.adjustCommission(req.body || {}, req.user);
  await audit.record(req, {
    action: 'CREATE',
    entityType: 'SettlementPenalty',
    entityId: row.id,
    newValues: { kind: 'ADJUSTMENT', salesRepId: row.salesRepId, amount: row.amount, reason: req.body?.reason || null },
  });
  return ok(res, row);
});

module.exports = { apply, list, waive, adjust };
