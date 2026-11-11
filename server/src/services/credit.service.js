'use strict';

const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const { round2, toNumber } = require('../utils/money');
const { daysOverdue } = require('../utils/dates');

const CREDIT_INCLUDE = {
  sale: { select: { id: true, saleNumber: true, soldAt: true, total: true } },
  customer: { select: { id: true, name: true, phone: true, region: true } },
  salesRep: { include: { user: { select: { name: true } } } },
  payments: { orderBy: { paidAt: 'desc' } },
};

// Single source of truth for a credit sale's status, given its numbers.
function computeStatus({ balance, amountPaid, dueDate }) {
  if (balance <= 0) return 'PAID';
  if (new Date(dueDate) < new Date()) return 'OVERDUE';
  return amountPaid > 0 ? 'PARTIAL' : 'OPEN';
}

async function listCredit(filters, pagination) {
  const where = {};
  if (filters.status) where.status = filters.status;
  if (filters.customerId) where.customerId = filters.customerId;
  if (filters.salesRepId) where.salesRepId = filters.salesRepId;
  if (filters.overdue === true) {
    where.balance = { gt: 0 };
    where.dueDate = { lt: new Date() };
  }
  if (filters.outstanding === true) where.balance = { gt: 0 };

  const [rows, total] = await Promise.all([
    prisma.creditSale.findMany({
      where,
      include: CREDIT_INCLUDE,
      skip: pagination.skip,
      take: pagination.take,
      orderBy: pagination.orderBy,
    }),
    prisma.creditSale.count({ where }),
  ]);

  const items = rows.map((c) => ({
    ...c,
    daysOverdue: c.balance > 0 ? daysOverdue(c.dueDate) : 0,
  }));

  return { items, total };
}

async function getCredit(id) {
  const credit = await prisma.creditSale.findUnique({ where: { id }, include: CREDIT_INCLUDE });
  if (!credit) throw ApiError.notFound('Credit sale not found');
  return { ...credit, daysOverdue: credit.balance > 0 ? daysOverdue(credit.dueDate) : 0 };
}

async function recordPayment(creditSaleId, payload, actor) {
  const amount = round2(payload.amount);
  if (amount <= 0) throw ApiError.badRequest('Payment amount must be greater than zero');

  return prisma.$transaction(async (tx) => {
    // One payment at a time per debt (audit #54, 11 Nov 2026): two payments at the same instant both
    // read the same balance and each wrote its own "balance - amount", so one payment vanished from the
    // balance (and the over-payment check could pass twice). The row lock makes the second wait and
    // read the balance the first one left.
    if (typeof tx.$queryRaw === 'function') {
      await tx.$queryRaw`SELECT id FROM "credit_sales" WHERE id = ${creditSaleId} FOR UPDATE`;
    }
    const credit = await tx.creditSale.findUnique({
      where: { id: creditSaleId },
      include: { sale: true },
    });
    if (!credit) throw ApiError.notFound('Credit sale not found');
    if (credit.status === 'PAID') throw ApiError.badRequest('This debt is already fully paid');
    if (credit.status === 'WRITTEN_OFF') throw ApiError.badRequest('This debt has been written off');

    const currentBalance = toNumber(credit.balance);
    if (amount > currentBalance + 0.001) {
      throw ApiError.badRequest(
        `Payment (${amount}) exceeds the outstanding balance (${currentBalance})`,
      );
    }

    await tx.creditPayment.create({
      data: {
        creditSaleId,
        amount,
        method: payload.method || 'CASH',
        reference: payload.reference || null,
        notes: payload.notes || null,
        paidAt: payload.paidAt ? new Date(payload.paidAt) : new Date(),
        receivedById: actor ? actor.id : null,
      },
    });

    const newAmountPaid = round2(toNumber(credit.amountPaid) + amount);
    const newBalance = round2(toNumber(credit.principal) - newAmountPaid);
    const status = computeStatus({
      balance: newBalance,
      amountPaid: newAmountPaid,
      dueDate: credit.dueDate,
    });

    const updated = await tx.creditSale.update({
      where: { id: creditSaleId },
      data: { amountPaid: newAmountPaid, balance: newBalance, status },
      include: CREDIT_INCLUDE,
    });

    // Keep the parent sale's payment fields in sync.
    await tx.sale.update({
      where: { id: credit.saleId },
      data: {
        amountPaid: newAmountPaid,
        balanceDue: newBalance,
        status: newBalance <= 0 ? 'PAID' : 'PARTIAL',
      },
    });

    return updated;
  });
}

// Recalculate OVERDUE flags. Intended to be run on a schedule or on demand.
async function refreshOverdue() {
  const result = await prisma.creditSale.updateMany({
    where: { balance: { gt: 0 }, dueDate: { lt: new Date() }, status: { in: ['OPEN', 'PARTIAL'] } },
    data: { status: 'OVERDUE' },
  });
  return { updated: result.count };
}

// Aggregate debt figures for dashboards and the debt report.
async function debtSummary() {
  const [agg, overdueAgg, byStatus, byRep, topDebtors] = await Promise.all([
    prisma.creditSale.aggregate({
      where: { balance: { gt: 0 } },
      _sum: { balance: true, principal: true, amountPaid: true },
      _count: true,
    }),
    prisma.creditSale.aggregate({
      where: { balance: { gt: 0 }, dueDate: { lt: new Date() } },
      _sum: { balance: true },
      _count: true,
    }),
    prisma.creditSale.groupBy({
      by: ['status'],
      _sum: { balance: true },
      _count: true,
    }),
    prisma.creditSale.groupBy({
      by: ['salesRepId'],
      where: { balance: { gt: 0 } },
      _sum: { balance: true },
      _count: true,
    }),
    prisma.creditSale.groupBy({
      by: ['customerId'],
      where: { balance: { gt: 0 } },
      _sum: { balance: true },
      orderBy: { _sum: { balance: 'desc' } },
      take: 10,
    }),
  ]);

  // Resolve rep + customer names for the breakdowns.
  const repIds = byRep.map((r) => r.salesRepId).filter(Boolean);
  const customerIds = topDebtors.map((d) => d.customerId).filter(Boolean);
  const [reps, customers] = await Promise.all([
    prisma.salesRepresentative.findMany({
      where: { id: { in: repIds } },
      include: { user: { select: { name: true } } },
    }),
    prisma.customer.findMany({
      where: { id: { in: customerIds } },
      select: { id: true, name: true, phone: true, region: true },
    }),
  ]);
  const repMap = new Map(reps.map((r) => [r.id, r]));
  const custMap = new Map(customers.map((c) => [c.id, c]));

  return {
    totalOutstanding: round2(toNumber(agg._sum.balance)),
    totalPrincipal: round2(toNumber(agg._sum.principal)),
    totalCollected: round2(toNumber(agg._sum.amountPaid)),
    openAccounts: agg._count,
    overdueAmount: round2(toNumber(overdueAgg._sum.balance)),
    overdueAccounts: overdueAgg._count,
    byStatus: byStatus.map((s) => ({
      status: s.status,
      count: s._count,
      balance: round2(toNumber(s._sum.balance)),
    })),
    bySalesRep: byRep
      .map((r) => ({
        salesRepId: r.salesRepId,
        name: r.salesRepId ? repMap.get(r.salesRepId)?.user?.name || 'Unknown' : 'Unassigned',
        outstanding: round2(toNumber(r._sum.balance)),
        accounts: r._count,
      }))
      .sort((a, b) => b.outstanding - a.outstanding),
    topDebtors: topDebtors.map((d) => ({
      customerId: d.customerId,
      name: d.customerId ? custMap.get(d.customerId)?.name || 'Unknown' : 'Walk-in',
      phone: d.customerId ? custMap.get(d.customerId)?.phone : null,
      region: d.customerId ? custMap.get(d.customerId)?.region : null,
      outstanding: round2(toNumber(d._sum.balance)),
    })),
  };
}

module.exports = { listCredit, getCredit, recordPayment, refreshOverdue, debtSummary, computeStatus };
