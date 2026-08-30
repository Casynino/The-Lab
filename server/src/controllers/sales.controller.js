'use strict';

const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { ok, created, paginated } = require('../utils/response');
const { parsePagination } = require('../utils/pagination');
const salesService = require('../services/sales.service');
const finance = require('../services/finance.service');
const audit = require('../services/audit.service');
const { ROLES } = require('../middleware/authorize');
const { toNumber } = require('../utils/money');

const create = asyncHandler(async (req, res) => {
  const payload = { ...req.body };

  // A sales rep can only sell from their own van stock.
  if (req.user.role === ROLES.SALES_REP) {
    if (!req.user.salesRepId) throw ApiError.forbidden('Your account has no sales-rep profile');
    payload.salesRepId = req.user.salesRepId;
    payload.warehouseId = null;
  }

  // Where did the money go? Validate the chosen payment account against the
  // sale's brand BEFORE creating anything: a brand-reserved account (e.g. the
  // Civlily Airtel line) only accepts payments for its own brand.
  let saleBrandId = null;
  if (!payload.salesRepId) {
    const productIds = [...new Set((payload.items || []).map((i) => i.productId))];
    const prods = await prisma.product.findMany({ where: { id: { in: productIds } }, select: { brandId: true } });
    const brandSet = new Set(prods.map((x) => x.brandId).filter(Boolean));
    saleBrandId = brandSet.size === 1 ? [...brandSet][0] : null;
    if (payload.accountId) {
      const account = await prisma.businessAccount.findFirst({ where: { id: payload.accountId, isActive: true } });
      if (!account) throw ApiError.badRequest('Select a valid payment account');
      if (account.brandId && account.brandId !== saleBrandId) {
        throw ApiError.badRequest(`${account.name} is not a payment account for this sale's brand`);
      }
    }
  }

  const sale = await salesService.createSale(payload, req.user);
  // A direct warehouse cash sale (no rep) is money into the business —
  // recorded against the chosen account (falls back to Cash) and kept alive
  // past the response by background().
  if (sale.type === 'CASH' && !sale.salesRepId) {
    const wa = require('../services/whatsappNotify.service');
    wa.background(finance.recordSaleIncome({
      saleId: sale.id,
      saleNumber: sale.saleNumber,
      // What actually reached the till, not what was invoiced. Banking the
      // total meant a part-paid sale credited the account with money nobody
      // handed over, and the books disagreed with the sale's own balance.
      amount: toNumber(sale.amountPaid),
      fromSettlement: false,
      occurredAt: sale.soldAt,
      accountId: payload.accountId || null,
      brandId: saleBrandId,
    }, req.user));
  }
  await audit.record(req, {
    action: 'CREATE',
    entityType: 'Sale',
    entityId: sale.id,
    newValues: { saleNumber: sale.saleNumber, type: sale.type, total: sale.total },
  });
  return created(res, sale);
});

const list = asyncHandler(async (req, res) => {
  const q = req.validatedQuery || req.query;
  const pagination = parsePagination(q, { defaultSortBy: 'soldAt', defaultSortDir: 'desc', allowedSortFields: ['soldAt', 'total', 'createdAt'] });
  const filters = { ...q };
  if (req.user.role === ROLES.SALES_REP) filters.salesRepId = req.user.salesRepId;
  const { items, total, summary } = await salesService.listSales(filters, pagination);
  // The summary rides along in meta: it is computed over every sale the filter
  // matches, so the page can show what the business sold without adding up the
  // fifteen rows it happens to be holding.
  return paginated(res, items, { page: pagination.page, limit: pagination.limit, total, summary });
});

const get = asyncHandler(async (req, res) => {
  const sale = await salesService.getSale(req.params.id);
  if (req.user.role === ROLES.SALES_REP && sale.salesRepId !== req.user.salesRepId) {
    throw ApiError.forbidden('This sale does not belong to you');
  }
  return ok(res, sale);
});

const cancel = asyncHandler(async (req, res) => {
  const sale = await salesService.cancelSale(req.params.id, req.user, req.body.reason);
  await audit.record(req, { action: 'CANCEL', entityType: 'Sale', entityId: req.params.id, newValues: { reason: req.body.reason } });
  return ok(res, sale);
});

module.exports = { create, list, get, cancel };
