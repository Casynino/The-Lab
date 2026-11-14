'use strict';

const prisma = require('../config/prisma');
const { toNumber } = require('../utils/money');

// Unified, real-time activity feed merged from across the business. The
// frontend polls this; each entry carries a kind, title, detail, actor and
// timestamp so it can be rendered consistently.
async function feed(limit = 30) {
  const take = 12;
  const [sales, payments, requests, withdrawals, settlements, movements] = await Promise.all([
    prisma.sale.findMany({ take, orderBy: { createdAt: 'desc' }, include: { salesRep: { include: { user: { select: { name: true } } } }, customer: { select: { name: true } } } }),
    prisma.creditPayment.findMany({ take, orderBy: { paidAt: 'desc' }, include: { creditSale: { include: { customer: { select: { name: true } } } }, receivedBy: { select: { name: true } } } }),
    prisma.stockRequest.findMany({ take, orderBy: { updatedAt: 'desc' }, include: { salesRep: { include: { user: { select: { name: true } } } } } }),
    prisma.commissionWithdrawal.findMany({ take, orderBy: { updatedAt: 'desc' }, include: { salesRep: { include: { user: { select: { name: true } } } } } }),
    prisma.settlement.findMany({ take, orderBy: { createdAt: 'desc' }, include: { salesRep: { include: { user: { select: { name: true } } } } } }),
    prisma.inventoryTransaction.findMany({ take, orderBy: { createdAt: 'desc' }, include: { product: { select: { name: true } }, user: { select: { name: true } } } }),
  ]);

  const items = [];

  sales.forEach((s) =>
    items.push({ kind: 'SALE', at: s.createdAt, title: `${s.type === 'CASH' ? 'Cash' : 'Credit'} sale ${s.saleNumber}`, detail: `${s.customer?.name || 'Walk-in'} · ${toNumber(s.total)} TZS`, by: s.salesRep?.user?.name, amount: toNumber(s.total) }),
  );
  payments.forEach((p) =>
    items.push({ kind: 'PAYMENT', at: p.paidAt, title: 'Debt payment collected', detail: `${p.creditSale?.customer?.name || 'Customer'} · ${toNumber(p.amount)} TZS`, by: p.receivedBy?.name, amount: toNumber(p.amount) }),
  );
  requests.forEach((r) =>
    items.push({ kind: 'STOCK_REQUEST', at: r.updatedAt, title: `Stock request ${r.requestNumber} — ${r.status}`, detail: r.salesRep?.user?.name, by: r.salesRep?.user?.name }),
  );
  withdrawals.forEach((w) =>
    items.push({ kind: 'WITHDRAWAL', at: w.updatedAt, title: `${w.source === 'BONUS' ? 'Bonus' : 'Commission'} withdrawal — ${w.status}`, detail: `${w.salesRep?.user?.name} · ${toNumber(w.amount)} TZS`, by: w.salesRep?.user?.name, amount: toNumber(w.amount) }),
  );
  settlements.forEach((s) =>
    items.push({ kind: 'SETTLEMENT', at: s.createdAt, title: `Settlement ${s.settlementNumber} opened`, detail: `${s.salesRep?.user?.name} · ${toNumber(s.assignedValue)} TZS`, by: s.salesRep?.user?.name }),
  );
  movements.forEach((m) =>
    items.push({ kind: 'MOVEMENT', at: m.createdAt, title: `${m.type}`, detail: `${m.product?.name} · ${m.baseQuantity > 0 ? '+' : ''}${m.baseQuantity}`, by: m.user?.name }),
  );

  items.sort((a, b) => new Date(b.at) - new Date(a.at));
  return items.slice(0, limit);
}

module.exports = { feed };
