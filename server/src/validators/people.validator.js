'use strict';

const { z } = require('zod');
const { id, paginationFields, boolQuery, money, positiveInt } = require('./common.validator');
const { canonicalRegion } = require('../constants/regions');

// A region is typed once and then grouped forever in the regional report, so a
// stray spelling would split one market in two. Anything recognisable is
// normalised to the official spelling; anything else is refused rather than
// filed under a name that will never match.
const tzRegion = z
  .string()
  .trim()
  .max(120)
  .optional()
  .nullable()
  .transform((v) => (v ? canonicalRegion(v) ?? v : v))
  .refine((v) => !v || canonicalRegion(v) !== null, {
    message: 'Choose one of the 31 regions of Tanzania',
  });

// --- Users -----------------------------------------------------------------
const userCreate = {
  body: z.object({
    name: z.string().trim().min(1).max(120),
    email: z.string().email().max(160),
    password: z.string().min(8, 'Password must be at least 8 characters').max(100),
    phone: z.string().trim().max(40).optional().nullable(),
    roleId: id,
    warehouseId: id.optional().nullable(),
    isActive: z.boolean().optional(),
    // When the role is SALES_REP, an optional rep profile can be created.
    salesRep: z
      .object({
        code: z.string().trim().max(40).optional(),
        region: tzRegion,
        phone: z.string().trim().max(40).optional().nullable(),
        monthlyTarget: money.optional().nullable(),
      })
      .optional(),
  }),
};

const userUpdate = {
  body: z.object({
    name: z.string().trim().min(1).max(120).optional(),
    email: z.string().email().max(160).optional(),
    password: z.string().min(8).max(100).optional(),
    phone: z.string().trim().max(40).optional().nullable(),
    roleId: id.optional(),
    warehouseId: id.optional().nullable(),
    isActive: z.boolean().optional(),
  }),
};

const userQuery = {
  query: z.object({ ...paginationFields, roleId: id.optional(), isActive: boolQuery }),
};

// --- Customers -------------------------------------------------------------
const customerCreate = {
  body: z.object({
    name: z.string().trim().min(1).max(160),
    phone: z.string().trim().max(40).optional().nullable(),
    region: tzRegion,
    address: z.string().trim().max(300).optional().nullable(),
    notes: z.string().trim().max(1000).optional().nullable(),
    salesRepId: id.optional().nullable(),
    isActive: z.boolean().optional(),
  }),
};
const customerUpdate = { body: customerCreate.body.partial() };
const customerQuery = {
  query: z.object({
    ...paginationFields,
    salesRepId: id.optional(),
    region: z.string().optional(),
    isActive: boolQuery,
  }),
};

// --- Sales representatives --------------------------------------------------
const salesRepCreate = {
  body: z.object({
    userId: id,
    code: z.string().trim().max(40).optional(),
    region: tzRegion,
    phone: z.string().trim().max(40).optional().nullable(),
    monthlyTarget: money.optional().nullable(),
    isActive: z.boolean().optional(),
  }),
};
const salesRepUpdate = {
  body: z.object({
    code: z.string().trim().max(40).optional(),
    region: tzRegion,
    phone: z.string().trim().max(40).optional().nullable(),
    monthlyTarget: money.optional().nullable(),
    isActive: z.boolean().optional(),
    // Whether this rep is on commission at all. Off means their settlements
    // still count as sales but earn them nothing.
    earnsCommission: z.boolean().optional(),
    whatsappPhone: z.string().trim().max(40).optional().nullable(),
    whatsappApiKey: z.string().trim().max(60).optional().nullable(),
  }),
};

// Admin adds boxes to a rep's order (issued from the warehouse).
const salesRepAddStock = {
  body: z.object({
    productId: id,
    boxes: positiveInt,
    reason: z.string().trim().max(300).optional().nullable(),
  }),
};

// --- Warehouses ------------------------------------------------------------
const warehouseCreate = {
  body: z.object({
    name: z.string().trim().min(1).max(160),
    code: z.string().trim().min(1).max(40),
    region: tzRegion,
    address: z.string().trim().max(300).optional().nullable(),
    isPrimary: z.boolean().optional(),
    isActive: z.boolean().optional(),
  }),
};
const warehouseUpdate = { body: warehouseCreate.body.partial() };

module.exports = {
  userCreate,
  userUpdate,
  userQuery,
  customerCreate,
  customerUpdate,
  customerQuery,
  salesRepCreate,
  salesRepUpdate,
  salesRepAddStock,
  warehouseCreate,
  warehouseUpdate,
};
