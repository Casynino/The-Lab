'use strict';

const asyncHandler = require('../utils/asyncHandler');
const { ok, created, paginated } = require('../utils/response');
const { parsePagination } = require('../utils/pagination');
const finance = require('../services/finance.service');
const audit = require('../services/audit.service');

const overview = asyncHandler(async (req, res) => ok(res, await finance.overview(req.query.period || 'month')));

// Rebuild the ledger from existing business records (idempotent, real data only).
const sync = asyncHandler(async (req, res) => {
  const result = await finance.backfillFromHistory();
  await audit.record(req, { action: 'SYNC', entityType: 'FinanceTransaction', newValues: result });
  return ok(res, result);
});

const accounts = asyncHandler(async (_req, res) => ok(res, await finance.accountBalances()));

const createAccount = asyncHandler(async (req, res) => {
  const acc = await finance.createAccount(req.body);
  await audit.record(req, { action: 'CREATE', entityType: 'BusinessAccount', entityId: acc.id, newValues: { name: acc.name, type: acc.type, openingBalance: acc.openingBalance } });
  return created(res, acc);
});

const updateAccount = asyncHandler(async (req, res) => {
  const { updated, previous } = await finance.updateAccount(req.params.id, req.body);
  await audit.record(req, {
    action: 'UPDATE',
    entityType: 'BusinessAccount',
    entityId: updated.id,
    oldValues: { name: previous.name, openingBalance: previous.openingBalance, isActive: previous.isActive },
    newValues: req.body,
  });
  return ok(res, updated);
});

const categories = asyncHandler(async (_req, res) => ok(res, await finance.listCategories()));

const createCategory = asyncHandler(async (req, res) => {
  const cat = await finance.createCategory(req.body.name);
  await audit.record(req, { action: 'CREATE', entityType: 'ExpenseCategory', entityId: cat.id, newValues: { name: cat.name } });
  return created(res, cat);
});

const transactions = asyncHandler(async (req, res) => {
  const q = req.query;
  const pagination = parsePagination(q, { defaultSortBy: 'occurredAt', defaultSortDir: 'desc', allowedSortFields: ['occurredAt', 'amount', 'createdAt'] });
  const filters = {
    accountId: q.accountId,
    search: q.search,
    direction: q.direction,
    type: q.type,
    category: q.category,
    from: q.from,
    to: q.to,
    minAmount: q.minAmount != null && q.minAmount !== '' ? Number(q.minAmount) : null,
    maxAmount: q.maxAmount != null && q.maxAmount !== '' ? Number(q.maxAmount) : null,
  };
  const { items, total, sums, byCategory } = await finance.listTransactions(filters, pagination);
  return paginated(res, items, { page: pagination.page, limit: pagination.limit, total, sums, byCategory });
});

const recordExpense = asyncHandler(async (req, res) => {
  const txn = await finance.recordExpense(req.body, req.user);
  await audit.record(req, { action: 'CREATE', entityType: 'FinanceTransaction', entityId: txn.id, newValues: { kind: 'EXPENSE', amount: txn.amount, category: txn.category, accountId: txn.accountId } });
  return created(res, txn);
});

const recordIncome = asyncHandler(async (req, res) => {
  const txn = await finance.recordIncome(req.body, req.user);
  await audit.record(req, { action: 'CREATE', entityType: 'FinanceTransaction', entityId: txn.id, newValues: { kind: 'INCOME', amount: txn.amount, accountId: txn.accountId } });
  return created(res, txn);
});

// The owner's own money moving in or out of the business. Kept apart from
// trade so profit stays honest: putting personal cash in is not income, and
// taking profit out is not an expense.
const recordOwnerMoney = asyncHandler(async (req, res) => {
  const direction = req.body.direction === 'OUT' ? 'OUT' : 'IN';
  const txn = await finance.recordOwnerMoney({ ...req.body, direction }, req.user);
  await audit.record(req, {
    action: 'CREATE',
    entityType: 'FinanceTransaction',
    entityId: txn.id,
    newValues: { kind: direction === 'IN' ? 'OWNER_CONTRIBUTION' : 'OWNER_DRAWING', amount: txn.amount, accountId: txn.accountId },
  });
  return created(res, txn);
});

// Manual balance correction (admin): a signed ADJUSTMENT transaction. Not an
// expense — it moves the account balance without touching net profit. Used for
// go-live initialization and intentional corrections only.
const recordAdjustment = asyncHandler(async (req, res) => {
  const direction = req.body.direction === 'IN' ? 'IN' : 'OUT';
  const txn = await finance.recordTransaction(
    {
      accountId: req.body.accountId,
      direction,
      type: 'ADJUSTMENT',
      amount: req.body.amount,
      brandId: req.body.brandId || null,
      category: 'Manual adjustment',
      description: req.body.description || 'Manual balance adjustment',
      notes: req.body.notes || null,
      occurredAt: req.body.occurredAt,
    },
    req.user,
  );
  await audit.record(req, {
    action: 'CREATE',
    entityType: 'FinanceTransaction',
    entityId: txn.id,
    newValues: { kind: 'ADJUSTMENT', direction, amount: txn.amount, accountId: txn.accountId, description: txn.description },
  });
  return created(res, txn);
});

const updateTransaction = asyncHandler(async (req, res) => {
  const { updated, previous } = await finance.updateTransaction(req.params.id, req.body);
  await audit.record(req, {
    action: 'UPDATE',
    entityType: 'FinanceTransaction',
    entityId: updated.id,
    oldValues: { amount: previous.amount, category: previous.category, description: previous.description, occurredAt: previous.occurredAt },
    newValues: { amount: req.body.amount, category: req.body.category, description: req.body.description, reason: req.body.reason || null },
  });
  return ok(res, updated);
});

const deleteTransaction = asyncHandler(async (req, res) => {
  const removed = await finance.deleteTransaction(req.params.id);
  await audit.record(req, {
    action: 'DELETE',
    entityType: 'FinanceTransaction',
    entityId: req.params.id,
    oldValues: { amount: removed.amount, direction: removed.direction, type: removed.type, category: removed.category, description: removed.description },
    newValues: { reason: req.body.reason || null },
  });
  return ok(res, { deleted: true, id: req.params.id });
});

// Cash-flow statement for a period or custom { from, to } range.
const cashflow = asyncHandler(async (req, res) =>
  ok(res, await finance.cashflow({ period: req.query.period, from: req.query.from, to: req.query.to })));

// Consolidated financial report (P&L + cash flow + payments + top sellers).
const report = asyncHandler(async (req, res) =>
  ok(res, await finance.report({ period: req.query.period, from: req.query.from, to: req.query.to })));

// Suppliers with purchased / paid / outstanding (accounts payable view).
const suppliers = asyncHandler(async (_req, res) => ok(res, await finance.supplierSummaries()));
const supplierDetail = asyncHandler(async (req, res) => ok(res, await finance.supplierDetail(req.params.id)));

// Pay a supplier against a purchase order from a business account.
const paySupplier = asyncHandler(async (req, res) => {
  const txn = await finance.paySupplier(req.body, req.user);
  await audit.record(req, {
    action: 'CREATE',
    entityType: 'FinanceTransaction',
    entityId: txn.id,
    newValues: { kind: 'SUPPLIER_PAYMENT', amount: txn.amount, reference: txn.reference, accountId: txn.accountId },
  });
  return created(res, txn);
});

// Pay down a supplier's overall balance (installments) from a business account.
const paySupplierBalance = asyncHandler(async (req, res) => {
  const txn = await finance.paySupplierBalance(req.params.id, req.body, req.user);
  await audit.record(req, {
    action: 'CREATE',
    entityType: 'FinanceTransaction',
    entityId: txn.id,
    newValues: { kind: 'SUPPLIER_BALANCE_PAYMENT', supplierId: req.params.id, amount: txn.amount, accountId: txn.accountId },
  });
  return created(res, txn);
});

// Move money between two business accounts (admin) — audited.
const transferBetween = asyncHandler(async (req, res) => {
  const result = await finance.transferBetweenAccounts(req.body, req.user);
  await audit.record(req, {
    action: 'CREATE',
    entityType: 'FinanceTransaction',
    entityId: result.out.id,
    newValues: { kind: 'ACCOUNT_TRANSFER', from: result.from, to: result.to, amount: result.amount, reason: req.body.reason || null },
  });
  return created(res, result);
});

// ── Reports Archive (generated weekly/monthly PDFs) ──────────────────────────
const reportArchive = asyncHandler(async (req, res) => {
  const archiveSvc = require('../services/reportArchive.service');
  const rows = await archiveSvc.list({
    type: req.query.type || undefined,
    year: req.query.year || undefined,
    search: req.query.search || undefined,
    limit: req.query.limit,
  });
  return ok(res, rows);
});

const reportArchivePdf = asyncHandler(async (req, res) => {
  const archiveSvc = require('../services/reportArchive.service');
  const row = await archiveSvc.getPdf(req.params.id);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="TheLab-${row.type.toLowerCase()}-${row.periodKey}.pdf"`);
  return res.send(Buffer.from(row.pdf));
});

module.exports = {
  overview, sync, accounts, createAccount, updateAccount, categories, createCategory,
  transactions, recordExpense, recordIncome, recordOwnerMoney, recordAdjustment, updateTransaction, deleteTransaction,
  cashflow, report, suppliers, supplierDetail, paySupplier, paySupplierBalance,
  reportArchive, reportArchivePdf, transferBetween,
};
