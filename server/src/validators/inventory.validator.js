'use strict';

const { z } = require('zod');
const { id, paginationFields, dateRangeFields, money } = require('./common.validator');

const TX_TYPES = [
  'STOCK_IN',
  'PURCHASE_RECEIPT',
  'TRANSFER_OUT',
  'TRANSFER_IN',
  'CASH_SALE',
  'CREDIT_SALE',
  'CUSTOMER_RETURN',
  'SALES_RETURN',
  'DAMAGE',
  'ADJUSTMENT',
  'CORRECTION',
  'STOCK_COUNT',
];

const movementItem = z.object({
  productId: id,
  packagingUnitId: id,
  quantity: z.number().int().positive(),
  unitCost: money.optional(),
});

const locationSchema = z
  .object({
    type: z.enum(['WAREHOUSE', 'SALES_REP']),
    warehouseId: id.optional(),
    salesRepId: id.optional(),
  })
  .refine((l) => (l.type === 'WAREHOUSE' ? !!l.warehouseId : !!l.salesRepId), {
    message: 'warehouseId or salesRepId is required to match the location type',
  });

const stockIn = {
  body: z.object({
    warehouseId: id,
    type: z.enum(['STOCK_IN', 'PURCHASE_RECEIPT']).optional(),
    items: z.array(movementItem).min(1),
    notes: z.string().max(500).optional(),
    occurredAt: z.string().datetime().optional(),
  }),
};

const adjustment = {
  body: z.object({
    location: locationSchema,
    productId: id,
    packagingUnitId: id,
    quantity: z.number().int().positive(),
    direction: z.enum(['INCREASE', 'DECREASE']),
    reason: z.string().min(1, 'A reason is required for adjustments').max(500),
    occurredAt: z.string().datetime().optional(),
  }),
};

const damage = {
  body: z.object({
    location: locationSchema,
    productId: id,
    packagingUnitId: id,
    quantity: z.number().int().positive(),
    reason: z.string().min(1, 'A reason is required').max(500),
    occurredAt: z.string().datetime().optional(),
  }),
};

const transferCreate = {
  body: z
    .object({
      direction: z.enum(['WAREHOUSE_TO_REP', 'REP_TO_WAREHOUSE', 'WAREHOUSE_TO_WAREHOUSE']),
      fromWarehouseId: id.optional(),
      fromRepId: id.optional(),
      toWarehouseId: id.optional(),
      toRepId: id.optional(),
      items: z.array(z.object({ productId: id, packagingUnitId: id, quantity: z.number().int().positive() })).min(1),
      notes: z.string().max(500).optional(),
      dispatchedAt: z.string().datetime().optional(),
    }),
};

const transferQuery = {
  query: z.object({
    ...paginationFields,
    ...dateRangeFields,
    direction: z.enum(['WAREHOUSE_TO_REP', 'REP_TO_WAREHOUSE', 'WAREHOUSE_TO_WAREHOUSE']).optional(),
    status: z.enum(['PENDING', 'COMPLETED', 'CANCELLED']).optional(),
    fromWarehouseId: id.optional(),
    toRepId: id.optional(),
  }),
};

const returnCreate = {
  body: z.object({
    type: z.enum(['CUSTOMER_RETURN', 'SALES_RETURN']),
    customerId: id.optional().nullable(),
    salesRepId: id.optional().nullable(),
    settlementId: id.optional().nullable(),
    warehouseId: id.optional().nullable(),
    saleId: id.optional().nullable(),
    items: z
      .array(
        z.object({
          productId: id,
          packagingUnitId: id,
          quantity: z.number().int().positive(),
          condition: z.enum(['GOOD', 'DAMAGED']).optional(),
        }),
      )
      .min(1),
    reason: z.string().max(500).optional(),
    notes: z.string().max(500).optional(),
    processedAt: z.string().datetime().optional(),
  }),
};

const returnQuery = {
  query: z.object({
    ...paginationFields,
    ...dateRangeFields,
    type: z.enum(['CUSTOMER_RETURN', 'SALES_RETURN']).optional(),
    status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'COMPLETED', 'CANCELLED', 'EXPIRED']).optional(),
    salesRepId: id.optional(),
    warehouseId: id.optional(),
  }),
};

const balanceQuery = {
  query: z.object({
    ...paginationFields,
    scope: z.enum(['WAREHOUSE', 'SALES_REP', 'ALL']).optional(),
    warehouseId: id.optional(),
    salesRepId: id.optional(),
    productId: id.optional(),
    brand: z.string().trim().max(80).optional(),
  }),
};

const movementQuery = {
  query: z.object({
    ...paginationFields,
    ...dateRangeFields,
    productId: id.optional(),
    warehouseId: id.optional(),
    salesRepId: id.optional(),
    type: z.enum(TX_TYPES).optional(),
  }),
};

module.exports = {
  TX_TYPES,
  stockIn,
  adjustment,
  damage,
  transferCreate,
  transferQuery,
  returnCreate,
  returnQuery,
  balanceQuery,
  movementQuery,
};
