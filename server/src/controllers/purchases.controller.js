'use strict';

const asyncHandler = require('../utils/asyncHandler');
const { ok, created, paginated } = require('../utils/response');
const { parsePagination } = require('../utils/pagination');
const purchase = require('../services/purchase.service');
const audit = require('../services/audit.service');

// --- Suppliers -------------------------------------------------------------
const listSuppliers = asyncHandler(async (req, res) => {
  const q = req.validatedQuery || req.query;
  const pagination = parsePagination(q, { defaultSortBy: 'name', defaultSortDir: 'asc', allowedSortFields: ['name', 'createdAt'] });
  const { items, total } = await purchase.listSuppliers(q, pagination);
  return paginated(res, items, { page: pagination.page, limit: pagination.limit, total });
});

const createSupplier = asyncHandler(async (req, res) => {
  const body = { ...req.body };
  if (body.email === '') body.email = null;
  const supplier = await purchase.createSupplier(body);
  await audit.record(req, { action: 'CREATE', entityType: 'Supplier', entityId: supplier.id, newValues: { name: supplier.name } });
  return created(res, supplier);
});

const updateSupplier = asyncHandler(async (req, res) => {
  const supplier = await purchase.updateSupplier(req.params.id, req.body);
  await audit.record(req, { action: 'UPDATE', entityType: 'Supplier', entityId: supplier.id });
  return ok(res, supplier);
});

const removeSupplier = asyncHandler(async (req, res) => {
  const result = await purchase.removeSupplier(req.params.id);
  await audit.record(req, { action: 'DELETE', entityType: 'Supplier', entityId: req.params.id });
  return ok(res, result);
});

// --- Purchase orders -------------------------------------------------------
const listPOs = asyncHandler(async (req, res) => {
  const q = req.validatedQuery || req.query;
  const pagination = parsePagination(q, { defaultSortBy: 'createdAt', defaultSortDir: 'desc' });
  const { items, total, onTheWay } = await purchase.listPurchaseOrders(q, pagination);
  return paginated(res, items, { page: pagination.page, limit: pagination.limit, total, onTheWay });
});

const getPO = asyncHandler(async (req, res) => ok(res, await purchase.getPurchaseOrder(req.params.id)));

const deletePO = asyncHandler(async (req, res) => {
  const po = await purchase.deletePurchaseOrder(req.params.id);
  await audit.record(req, {
    action: 'DELETE',
    entityType: 'PurchaseOrder',
    entityId: req.params.id,
    oldValues: { poNumber: po.poNumber, supplierId: po.supplierId, totalCost: po.totalCost, status: po.status },
  });
  return ok(res, { deleted: true, poNumber: po.poNumber });
});

const createPO = asyncHandler(async (req, res) => {
  const po = await purchase.createPurchaseOrder(req.body, req.user);
  await audit.record(req, { action: 'CREATE', entityType: 'PurchaseOrder', entityId: po.id, newValues: { poNumber: po.poNumber, totalCost: po.totalCost } });
  return created(res, po);
});

const updatePO = asyncHandler(async (req, res) => {
  const po = await purchase.updatePurchaseOrder(req.params.id, req.body);
  await audit.record(req, { action: 'UPDATE', entityType: 'PurchaseOrder', entityId: po.id });
  return ok(res, po);
});

const receivePO = asyncHandler(async (req, res) => {
  const po = await purchase.receivePurchaseOrder(req.params.id, req.user, req.body);
  await audit.record(req, { action: 'RECEIVE', entityType: 'PurchaseOrder', entityId: po.id, newValues: { poNumber: po.poNumber } });
  return ok(res, po);
});

module.exports = { listSuppliers, createSupplier, updateSupplier, removeSupplier, listPOs, getPO, deletePO, createPO, updatePO, receivePO };
