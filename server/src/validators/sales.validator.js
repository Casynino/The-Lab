'use strict';

const { z } = require('zod');
const { id, paginationFields, dateRangeFields, money } = require('./common.validator');

const saleItem = z.object({
  productId: id,
  packagingUnitId: id,
  quantity: z.number().int().positive(),
  unitPrice: money.optional(), // price per chosen packaging unit; defaults to product/packaging price
  lineDiscount: money.optional(),
});

const saleCreate = {
  body: z
    .object({
      type: z.enum(['CASH', 'CREDIT']),
      customerId: id.optional().nullable(),
      salesRepId: id.optional().nullable(),
      settlementId: id.optional().nullable(),
      warehouseId: id.optional().nullable(),
      items: z.array(saleItem).min(1, 'Add at least one item'),
      discount: money.optional(),
      amountPaid: money.optional(),
      dueDate: z.string().datetime().optional(),
      region: z.string().max(120).optional(),
      notes: z.string().max(500).optional(),
      soldAt: z.string().datetime().optional(),
      accountId: id.optional().nullable(), // payment account the money went to
    })
    .refine((d) => d.salesRepId || d.warehouseId, {
      message: 'Provide salesRepId (rep sale) or warehouseId (warehouse sale)',
      path: ['salesRepId'],
    })
    .refine((d) => d.type !== 'CREDIT' || d.customerId, {
      message: 'Credit sales require a customer',
      path: ['customerId'],
    }),
};

const saleQuery = {
  query: z.object({
    ...paginationFields,
    ...dateRangeFields,
    type: z.enum(['CASH', 'CREDIT']).optional(),
    status: z.enum(['PAID', 'PARTIAL', 'UNPAID', 'CANCELLED']).optional(),
    salesRepId: id.optional(),
    customerId: id.optional(),
    warehouseId: id.optional(),
    region: z.string().optional(),
    // Counter sales a customer can still return boxes from (Returns > Customer return).
    refundable: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  }),
};

const cancelSale = {
  body: z.object({ reason: z.string().max(500).optional() }),
};

// A customer brings boxes back: which lines, how many of each (in the line's own unit), why, and the
// sale's updatedAt as the window saw it — one refund per look, so a double tap cannot send two.
const refundSale = {
  body: z.object({
    items: z.array(z.object({ saleItemId: id, quantity: z.number().int().positive() })).min(1, 'Pick at least one box').max(100),
    reason: z.string().trim().max(500).optional(),
    version: z.string().datetime(),
  }),
};

const creditQuery = {
  query: z.object({
    ...paginationFields,
    status: z.enum(['OPEN', 'PARTIAL', 'PAID', 'OVERDUE', 'WRITTEN_OFF']).optional(),
    customerId: id.optional(),
    salesRepId: id.optional(),
    overdue: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
    outstanding: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  }),
};

const creditPayment = {
  body: z.object({
    amount: money.refine((v) => v > 0, 'Amount must be greater than zero'),
    method: z.enum(['CASH', 'MOBILE_MONEY', 'BANK', 'OTHER']).optional(),
    reference: z.string().max(120).optional().nullable(),
    notes: z.string().max(500).optional().nullable(),
    paidAt: z.string().datetime().optional(),
  }),
};

module.exports = { saleCreate, saleQuery, cancelSale, refundSale, creditQuery, creditPayment };
