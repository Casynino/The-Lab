'use strict';

const { z } = require('zod');
const { id, paginationFields, dateRangeFields, boolQuery, money } = require('./common.validator');

// Lenient date string (accepts "2026-06-16" or full ISO); services wrap in Date.
const dateStr = z.string().min(4).optional().nullable();

// --- Suppliers -------------------------------------------------------------
const supplierCreate = {
  body: z.object({
    name: z.string().trim().min(1).max(160),
    country: z.string().trim().max(80).optional(),
    brandId: id.optional().nullable(), // brand this supplier belongs to
    contactName: z.string().trim().max(120).optional().nullable(),
    phone: z.string().trim().max(40).optional().nullable(),
    email: z.string().email().max(160).optional().nullable().or(z.literal('')),
    address: z.string().trim().max(300).optional().nullable(),
    notes: z.string().trim().max(1000).optional().nullable(),
    isActive: z.boolean().optional(),
  }),
};
const supplierUpdate = { body: supplierCreate.body.partial() };
const supplierQuery = { query: z.object({ ...paginationFields, isActive: boolQuery }) };

// --- Purchase orders -------------------------------------------------------
const poItem = z.object({
  productId: id,
  packagingUnitId: id,
  quantity: z.number().int().positive(),
  unitCost: money.optional(),
});
const poCreate = {
  body: z.object({
    supplierId: id,
    currency: z.string().trim().max(8).optional(),
    items: z.array(poItem).min(1),
    shippingCost: money.optional(),
    clearingCost: money.optional(),
    otherCost: money.optional(),
    warehouseId: id.optional().nullable(),
    orderedAt: dateStr,
    expectedArrival: dateStr,
    notes: z.string().max(1000).optional().nullable(),
    // Stock paid for as it was bought. Without this a cash purchase could only
    // be recorded as a debt and paid off afterwards, in whatever month that
    // happened to be.
    payment: z.object({
      accountId: id,
      amount: money.optional(),
      occurredAt: dateStr,
      notes: z.string().max(1000).optional().nullable(),
    }).optional(),
  }),
};
const poUpdate = {
  body: z.object({
    status: z.enum(['DRAFT', 'ORDERED', 'IN_TRANSIT', 'RECEIVED', 'CANCELLED']).optional(),
    currency: z.string().trim().max(8).optional(),
    notes: z.string().max(1000).optional().nullable(),
    warehouseId: id.optional().nullable(),
    orderedAt: dateStr,
    expectedArrival: dateStr,
    shippingCost: money.optional(),
    clearingCost: money.optional(),
    otherCost: money.optional(),
    // Lines can be corrected while the order has not landed — a quantity
    // mistyped when placing the order should not require deleting it.
    items: z.array(poItem).min(1).optional(),
    supplierId: id.optional(),
  }),
};
const poReceive = { body: z.object({ actualArrival: dateStr, stockAlreadyCounted: z.boolean().optional() }) };
const poQuery = {
  query: z.object({
    ...paginationFields,
    status: z.enum(['DRAFT', 'ORDERED', 'IN_TRANSIT', 'RECEIVED', 'CANCELLED']).optional(),
    supplierId: id.optional(),
  }),
};

// --- Stock requests --------------------------------------------------------
const stockRequestCreate = {
  body: z.object({
    warehouseId: id.optional().nullable(),
    notes: z.string().max(500).optional().nullable(),
    region: z.string().max(80).optional().nullable(),
    items: z.array(z.object({ productId: id, packagingUnitId: id, quantity: z.number().int().positive(), region: z.string().max(80).optional().nullable() })).min(1),
  }),
};
const stockRequestUpdate = {
  body: z.object({
    warehouseId: id.optional().nullable(),
    notes: z.string().max(500).optional().nullable(),
    region: z.string().max(80).optional().nullable(),
    items: z.array(z.object({ productId: id, packagingUnitId: id, quantity: z.number().int().positive(), region: z.string().max(80).optional().nullable() })).min(1),
  }),
};
const stockRequestApprove = {
  body: z.object({
    approvals: z.array(z.object({ itemId: id, quantityApproved: z.number().int().min(0) })).optional(),
  }),
};
const stockRequestReject = { body: z.object({ notes: z.string().max(500).optional() }) };
const stockRequestQuery = {
  query: z.object({
    ...paginationFields,
    status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'FULFILLED', 'CANCELLED']).optional(),
    salesRepId: id.optional(),
    decided: boolQuery, // the admin history table: leave the pending ones out (they have their own strip)
  }),
};

// --- Settlements -----------------------------------------------------------
const settlementQuery = {
  query: z.object({
    ...paginationFields,
    status: z.enum(['OPEN', 'PARTIAL', 'SETTLED', 'OVERDUE']).optional(),
    salesRepId: id.optional(),
    open: boolQuery,
  }),
};
const settlementSettle = { body: z.object({ notes: z.string().max(500).optional() }) };
const settlementSettleBoxes = {
  body: z.object({
    productId: id,
    boxes: z.number().int().positive(),
    // No `method`: the label is always the payment account's name, resolved on the server.
    accountId: id.optional().nullable(), // payment account the money went to
    reference: z.string().max(120).optional().nullable(),
    notes: z.string().max(500).optional().nullable(),
    paidAt: dateStr,
  }),
};

// Several products at once: the same per-line fields as one settle-boxes call.
const settlementSettleMany = {
  body: z.object({
    items: z.array(z.object({
      productId: id,
      boxes: z.number().int().positive(),
      accountId: id.optional().nullable(),
    })).min(1).max(20),
  }),
};

// More time on an order: a new deadline, or hours to add. Checked here so a bad value is a clear answer
// instead of an Invalid Date reaching the database (audit #126). Up to a year of hours at a time.
const settlementExtendDeadline = {
  body: z.object({
    deadlineAt: z.string().datetime({ offset: true }).optional(),
    additionalHours: z.number().positive().max(24 * 365).optional(),
  }).refine((b) => b.deadlineAt || b.additionalHours, { message: 'Provide deadlineAt or additionalHours' }),
};

// --- Commissions -----------------------------------------------------------
const withdrawRequest = { body: z.object({ amount: money, notes: z.string().max(500).optional() }) };
const withdrawDecide = { body: z.object({ action: z.enum(['APPROVE', 'REJECT', 'PAY']) }) };
const withdrawalQuery = {
  query: z.object({
    ...paginationFields,
    status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'PAID']).optional(),
    salesRepId: id.optional(),
  }),
};

// --- Daily reports ---------------------------------------------------------
const DAILY_REPORT_FIELDS = {
  OPENING: ['cashOnHand', 'customersToVisit', 'openingNote', 'notes'],
  CLOSING: ['salesAmount', 'cashCollected', 'debtsCreated', 'debtsCollected', 'closingNote', 'notes'],
};
const dailyReportSubmit = {
  body: z.object({
    type: z.enum(['OPENING', 'CLOSING']),
    reportDate: dateStr,
    // The report sent earlier the same day that this one changes (dailyReport.service submit).
    replaces: id.optional(),
    cashOnHand: money.optional().nullable(),
    customersToVisit: z.number().int().min(0).optional().nullable(),
    openingNote: z.string().max(1000).optional().nullable(),
    salesAmount: money.optional().nullable(),
    cashCollected: money.optional().nullable(),
    debtsCreated: money.optional().nullable(),
    debtsCollected: money.optional().nullable(),
    closingNote: z.string().max(1000).optional().nullable(),
    notes: z.string().max(1000).optional().nullable(),
  }).refine(
    // An empty report says nothing — at least one figure or a note for the kind of report sent.
    (b) => DAILY_REPORT_FIELDS[b.type].some((k) => (typeof b[k] === 'string' ? b[k].trim() !== '' : b[k] != null)),
    { message: 'Fill in at least one figure or a note', path: ['type'] },
  ),
};
const dailyReportQuery = {
  query: z.object({ ...paginationFields, ...dateRangeFields, salesRepId: id.optional(), type: z.enum(['OPENING', 'CLOSING']).optional() }),
};

module.exports = {
  supplierCreate, supplierUpdate, supplierQuery,
  poCreate, poUpdate, poReceive, poQuery,
  stockRequestCreate, stockRequestUpdate, stockRequestApprove, stockRequestReject, stockRequestQuery,
  settlementQuery, settlementSettle, settlementSettleBoxes, settlementSettleMany, settlementExtendDeadline,
  withdrawRequest, withdrawDecide, withdrawalQuery,
  dailyReportSubmit, dailyReportQuery,
};
