'use strict';

const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { ok, created, paginated } = require('../utils/response');
const { parsePagination } = require('../utils/pagination');
const { toNumber, round2 } = require('../utils/money');
const audit = require('../services/audit.service');
const { ROLES } = require('../middleware/authorize');
const { isCustomerPhone, CUSTOMER_PHONE_HINT } = require('../validators/people.validator');

// Sales reps only see/manage their own customers.
function repScope(req, where) {
  if (req.user.role === ROLES.SALES_REP && req.user.salesRepId) {
    where.salesRepId = req.user.salesRepId;
  }
  return where;
}

const list = asyncHandler(async (req, res) => {
  const q = req.validatedQuery || req.query;
  const pagination = parsePagination(q, {
    allowedSortFields: ['name', 'createdAt', 'region'],
    defaultSortBy: 'name',
    defaultSortDir: 'asc',
  });
  const where = repScope(req, {});
  if (q.salesRepId && req.user.role === ROLES.ADMIN) where.salesRepId = q.salesRepId;
  if (q.region) where.region = q.region;
  if (q.isActive !== undefined) where.isActive = q.isActive;
  if (q.search) {
    where.OR = [
      { name: { contains: q.search, mode: 'insensitive' } },
      { phone: { contains: q.search, mode: 'insensitive' } },
    ];
  }

  const [items, total] = await Promise.all([
    prisma.customer.findMany({
      where,
      include: {
        salesRep: { include: { user: { select: { name: true } } } },
        _count: { select: { sales: true, creditSales: true } },
      },
      skip: pagination.skip,
      take: pagination.take,
      orderBy: pagination.orderBy,
    }),
    prisma.customer.count({ where }),
  ]);
  return paginated(res, items, { page: pagination.page, limit: pagination.limit, total });
});

const get = asyncHandler(async (req, res) => {
  const customer = await prisma.customer.findUnique({
    where: { id: req.params.id },
    include: {
      salesRep: { include: { user: { select: { name: true } } } },
      sales: { orderBy: { soldAt: 'desc' }, take: 20, select: { id: true, saleNumber: true, type: true, total: true, balanceDue: true, status: true, soldAt: true } },
      creditSales: { orderBy: { dueDate: 'asc' }, include: { payments: { orderBy: { paidAt: 'desc' } } } },
    },
  });
  if (!customer) throw ApiError.notFound('Customer not found');
  if (req.user.role === ROLES.SALES_REP && customer.salesRepId !== req.user.salesRepId) {
    throw ApiError.forbidden('This customer is not assigned to you');
  }

  const [purchaseAgg, outstandingAgg] = await Promise.all([
    prisma.sale.aggregate({ where: { customerId: customer.id, status: { not: 'CANCELLED' } }, _sum: { total: true }, _count: true }),
    prisma.creditSale.aggregate({ where: { customerId: customer.id, balance: { gt: 0 } }, _sum: { balance: true } }),
  ]);

  return ok(res, {
    ...customer,
    stats: {
      totalPurchases: round2(toNumber(purchaseAgg._sum.total)),
      orderCount: purchaseAgg._count,
      outstandingDebt: round2(toNumber(outstandingAgg._sum.balance)),
    },
  });
});

const create = asyncHandler(async (req, res) => {
  const data = { ...req.body, createdById: req.user.id };
  if (req.user.role === ROLES.SALES_REP) data.salesRepId = req.user.salesRepId;
  const customer = await prisma.customer.create({ data });
  await audit.record(req, { action: 'CREATE', entityType: 'Customer', entityId: customer.id, newValues: { name: customer.name } });
  return created(res, customer);
});

const update = asyncHandler(async (req, res) => {
  const existing = await prisma.customer.findUnique({ where: { id: req.params.id } });
  if (!existing) throw ApiError.notFound('Customer not found');
  if (req.user.role === ROLES.SALES_REP && existing.salesRepId !== req.user.salesRepId) {
    throw ApiError.forbidden('This customer is not assigned to you');
  }
  const data = { ...req.body };
  if (req.user.role === ROLES.SALES_REP) delete data.salesRepId; // reps can't reassign
  // The phone is checked when it changes. The one already saved, even one written before the check
  // (two numbers, a "-"), must not block an edit of the name or the notes.
  if (typeof data.phone === 'string' && data.phone !== String(existing.phone ?? '').trim() && !isCustomerPhone(data.phone)) {
    throw ApiError.unprocessable('Validation failed', [{ path: 'phone', message: CUSTOMER_PHONE_HINT }]);
  }
  const customer = await prisma.customer.update({ where: { id: req.params.id }, data });
  await audit.record(req, { action: 'UPDATE', entityType: 'Customer', entityId: customer.id, oldValues: existing, newValues: data });
  return ok(res, customer);
});

const remove = asyncHandler(async (req, res) => {
  const sales = await prisma.sale.count({ where: { customerId: req.params.id } });
  if (sales > 0) {
    const customer = await prisma.customer.update({ where: { id: req.params.id }, data: { isActive: false } });
    await audit.record(req, { action: 'DEACTIVATE', entityType: 'Customer', entityId: customer.id });
    return ok(res, { ...customer, deactivated: true, reason: 'has sales history' });
  }
  await prisma.customer.delete({ where: { id: req.params.id } });
  await audit.record(req, { action: 'DELETE', entityType: 'Customer', entityId: req.params.id });
  return ok(res, { id: req.params.id, deleted: true });
});

module.exports = { list, get, create, update, remove };
