'use strict';

const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { ok, created, paginated } = require('../utils/response');
const { parsePagination } = require('../utils/pagination');
const stockRequest = require('../services/stockRequest.service');
const audit = require('../services/audit.service');
const { ROLES } = require('../middleware/authorize');

const create = asyncHandler(async (req, res) => {
  if (!req.user.salesRepId) throw ApiError.forbidden('Only sales representatives can request stock');
  const request = await stockRequest.create(req.user.salesRepId, req.body);
  await audit.record(req, { action: 'CREATE', entityType: 'StockRequest', entityId: request.id, newValues: { requestNumber: request.requestNumber } });
  return created(res, request);
});

const list = asyncHandler(async (req, res) => {
  const q = req.validatedQuery || req.query;
  const pagination = parsePagination(q, { defaultSortBy: 'requestedAt', defaultSortDir: 'desc', allowedSortFields: ['requestedAt', 'createdAt'] });
  const filters = { ...q };
  if (req.user.role === ROLES.SALES_REP) filters.salesRepId = req.user.salesRepId;
  const { items, total, summary } = await stockRequest.list(filters, pagination);
  return paginated(res, items, { page: pagination.page, limit: pagination.limit, total, summary });
});

// In-stock product ids at the fulfilling warehouse — drives the rep's product
// selector. Returns ids only (no quantities) so stock levels stay hidden.
const availableProducts = asyncHandler(async (_req, res) => {
  return ok(res, await stockRequest.availableProductIds());
});

const get = asyncHandler(async (req, res) => {
  const request = await stockRequest.get(req.params.id);
  if (req.user.role === ROLES.SALES_REP && request.salesRepId !== req.user.salesRepId) {
    throw ApiError.forbidden('This request does not belong to you');
  }
  return ok(res, request);
});

const update = asyncHandler(async (req, res) => {
  const existing = await stockRequest.get(req.params.id);
  if (req.user.role === ROLES.SALES_REP && existing.salesRepId !== req.user.salesRepId) {
    throw ApiError.forbidden('This order does not belong to you');
  }
  const request = await stockRequest.update(req.params.id, req.body);
  await audit.record(req, {
    action: 'UPDATE',
    entityType: 'StockRequest',
    entityId: req.params.id,
    newValues: { totalValue: request.totalValue, lines: request.items.length },
  });
  return ok(res, request);
});

const approve = asyncHandler(async (req, res) => {
  const request = await stockRequest.approve(req.params.id, req.user, req.body.approvals || []);
  await audit.record(req, { action: 'APPROVE', entityType: 'StockRequest', entityId: req.params.id, newValues: { transferId: request.transferId } });
  return ok(res, request);
});

const reject = asyncHandler(async (req, res) => {
  const request = await stockRequest.reject(req.params.id, req.user, req.body.notes);
  await audit.record(req, { action: 'REJECT', entityType: 'StockRequest', entityId: req.params.id });
  return ok(res, request);
});

const cancel = asyncHandler(async (req, res) => {
  const existing = await stockRequest.get(req.params.id);
  if (req.user.role === ROLES.SALES_REP && existing.salesRepId !== req.user.salesRepId) {
    throw ApiError.forbidden('This request does not belong to you');
  }
  const request = await stockRequest.cancel(req.params.id, req.user);
  await audit.record(req, { action: 'CANCEL', entityType: 'StockRequest', entityId: req.params.id });
  return ok(res, request);
});

module.exports = { create, list, get, update, approve, reject, cancel, availableProducts };
