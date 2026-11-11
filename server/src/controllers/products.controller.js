'use strict';

const asyncHandler = require('../utils/asyncHandler');
const { ok, created, paginated } = require('../utils/response');
const { parsePagination } = require('../utils/pagination');
const productsService = require('../services/products.service');
const audit = require('../services/audit.service');
const { forRole } = require('../utils/repView');

const list = asyncHandler(async (req, res) => {
  const q = req.validatedQuery || req.query;
  const pagination = parsePagination(q, {
    allowedSortFields: ['name', 'sku', 'sellingPrice', 'purchasePrice', 'createdAt', 'updatedAt'],
    defaultSortBy: 'name',
    defaultSortDir: 'asc',
  });
  const { items, total } = await productsService.listProducts(
    { brandId: q.brandId, categoryId: q.categoryId, isActive: q.isActive, search: q.search },
    pagination,
  );
  return paginated(res, forRole(req, items), { page: pagination.page, limit: pagination.limit, total });
});

const get = asyncHandler(async (req, res) => {
  const product = await productsService.getProduct(req.params.id);
  return ok(res, forRole(req, product));
});

const create = asyncHandler(async (req, res) => {
  const product = await productsService.createProduct(req.body, req.user);
  await audit.record(req, { action: 'CREATE', entityType: 'Product', entityId: product.id, newValues: { name: product.name, sku: product.sku } });
  return created(res, product);
});

const update = asyncHandler(async (req, res) => {
  const product = await productsService.updateProduct(req.params.id, req.body);
  await audit.record(req, { action: 'UPDATE', entityType: 'Product', entityId: product.id, newValues: req.body });
  return ok(res, product);
});

const setPackagings = asyncHandler(async (req, res) => {
  const product = await productsService.setPackagings(req.params.id, req.body.packagings);
  await audit.record(req, { action: 'UPDATE_PACKAGING', entityType: 'Product', entityId: req.params.id });
  return ok(res, product);
});

const remove = asyncHandler(async (req, res) => {
  const result = await productsService.deleteProduct(req.params.id);
  await audit.record(req, { action: 'DELETE', entityType: 'Product', entityId: req.params.id });
  return ok(res, result);
});

module.exports = { list, get, create, update, setPackagings, remove };
