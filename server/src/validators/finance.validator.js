'use strict';

const { z } = require('zod');
const { id } = require('./common.validator');

// Finance writes (audit #79). Each body names the fields its form actually sends; anything else is
// dropped before the service sees it. That matters most for refType/refId: they tie a ledger row to a
// sale, a purchase order, a supplier or a payout, so a hand-typed row carrying them could pass as
// sale money, pay down a supplier's bill or drop out of the balances. Only the server sets them.
//
// These check the SHAPE only. The rules about money — an amount above zero, an account chosen, enough
// in it, no more than is owed — stay in the services, which say them in plain words, so a missing
// amount or account is still answered the way it always was.

const amount = z.coerce.number().finite().optional().nullable();
// For a value that REPLACES a stored figure: null is refused rather than read as 0.
const figure = z.union([z.number(), z.string()]).pipe(z.coerce.number().finite()).optional();
const text = (max) => z.string().trim().max(max).optional().nullable();
const ref = z.string().max(64).optional().nullable();
// The forms send a day ("2026-11-11"); a cleared date field sends ''; a full timestamp is taken as given.
const when = z.union([z.string().date(), z.string().datetime({ offset: true }), z.literal('')]).optional().nullable();
const direction = z.enum(['IN', 'OUT']).optional();

const moneyFields = {
  accountId: ref,
  amount,
  brandId: ref,
  category: text(120),
  description: text(500),
  reference: text(120),
  notes: text(2000),
  receiptUrl: text(1000),
  occurredAt: when,
};

// POST /finance/income and /finance/expenses
const financeMoney = { body: z.object(moneyFields) };
// POST /finance/owner-money
const financeOwnerMoney = { body: z.object({ ...moneyFields, direction }) };
// POST /finance/adjustments
const financeAdjustment = {
  body: z.object({
    accountId: ref,
    amount,
    direction,
    brandId: ref,
    description: text(500),
    notes: text(2000),
    occurredAt: when,
  }),
};
// POST /finance/transfers
const financeTransfer = {
  body: z.object({
    fromAccountId: ref,
    toAccountId: ref,
    amount,
    notes: text(2000),
    occurredAt: when,
    reason: text(500),
  }),
};
// PUT /finance/transactions/:id
const financeTxnUpdate = {
  params: z.object({ id }),
  body: z.object({
    // Left out to keep the row where it is; never null, which would wipe the amount or the account.
    accountId: z.string().min(1).max(64).optional(),
    brandId: ref,
    amount: figure,
    category: text(120),
    description: text(500),
    reference: text(120),
    notes: text(2000),
    occurredAt: when,
    reason: text(500),
  }),
};
// POST /finance/supplier-payments
const financeSupplierPayment = {
  body: z.object({
    purchaseOrderId: id,
    accountId: ref,
    amount,
    notes: text(2000),
    occurredAt: when,
  }),
};
// POST /finance/suppliers/:id/pay
const financeSupplierBalancePayment = {
  params: z.object({ id }),
  body: z.object({
    accountId: ref,
    amount,
    notes: text(2000),
    occurredAt: when,
  }),
};
// POST /finance/suppliers/:id/credits
const financeSupplierCredit = {
  params: z.object({ id }),
  body: z.object({
    amount,
    reason: text(300),
    occurredAt: when,
  }),
};
const accountType = z.enum(['CASH', 'BANK', 'MOBILE_MONEY', 'OTHER', 'COMMISSION']);
// POST /finance/accounts
const financeAccountCreate = {
  body: z.object({
    name: text(80),
    type: accountType.optional(),
    brandId: ref,
    openingBalance: amount,
    notes: text(1000),
  }),
};
// PUT /finance/accounts/:id
const financeAccountUpdate = {
  params: z.object({ id }),
  body: z.object({
    name: z.string().trim().min(1).max(80).optional(),
    type: accountType.optional(),
    brandId: ref,
    openingBalance: figure,
    notes: text(1000),
    isActive: z.boolean().optional(),
  }),
};
// POST /finance/categories
const financeCategoryCreate = { body: z.object({ name: text(80) }) };

module.exports = {
  financeMoney,
  financeOwnerMoney,
  financeAdjustment,
  financeTransfer,
  financeTxnUpdate,
  financeSupplierPayment,
  financeSupplierBalancePayment,
  financeSupplierCredit,
  financeAccountCreate,
  financeAccountUpdate,
  financeCategoryCreate,
};
