'use strict';

const asyncHandler = require('../utils/asyncHandler');
const { ok, created, paginated } = require('../utils/response');
const { parsePagination } = require('../utils/pagination');
const transfers = require('../services/transfers.service');
const audit = require('../services/audit.service');

const create = asyncHandler(async (req, res) => {
  const transfer = await transfers.createTransfer(req.body, req.user);
  await audit.record(req, {
    action: 'CREATE',
    entityType: 'StockTransfer',
    entityId: transfer.id,
    newValues: { transferNumber: transfer.transferNumber, direction: transfer.direction, items: transfer.items.length },
  });
  return created(res, transfer);
});

const list = asyncHandler(async (req, res) => {
  const q = req.validatedQuery || req.query;
  const pagination = parsePagination(q, { defaultSortBy: 'dispatchedAt', defaultSortDir: 'desc', allowedSortFields: ['dispatchedAt', 'createdAt'] });
  const { items, total, summary } = await transfers.listTransfers(q, pagination);
  return paginated(res, items, { page: pagination.page, limit: pagination.limit, total, summary });
});

const get = asyncHandler(async (req, res) => {
  const transfer = await transfers.getTransfer(req.params.id);
  return ok(res, transfer);
});

const cancel = asyncHandler(async (req, res) => {
  const transfer = await transfers.cancelTransfer(req.params.id, req.user, req.body.reason);
  await audit.record(req, { action: 'CANCEL', entityType: 'StockTransfer', entityId: req.params.id, newValues: { reason: req.body.reason } });
  return ok(res, transfer);
});

module.exports = { create, list, get, cancel };
