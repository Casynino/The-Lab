'use strict';

const { z } = require('zod');
const { id, paginationFields, boolQuery, money, positiveInt } = require('./common.validator');
const { canonicalRegion, cleanRegions } = require('../constants/regions');

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

// A rep can work several regions (owner, 10 Nov 2026: "even two"; 11 Nov: "a rep can have more than 5
// cities" — so any number of the 31). Each must be one of the official regions, repeats are dropped, the
// first is the main one.
const tzRegionList = z
  .array(z.string().trim().max(120))
  .max(31, 'There are only 31 regions')
  .optional()
  .superRefine((list, ctx) => {
    for (const v of list || []) {
      if (v && canonicalRegion(v) === null) {
        ctx.addIssue({ code: 'custom', message: 'Choose regions from the 31 regions of Tanzania' });
        return;
      }
    }
  })
  .transform((list) => (list ? cleanRegions(list) : list));

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
        regions: tzRegionList,
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
// A phone number written any usual way (0712 345 678, +255 712-345-678, a foreign number), or nothing.
// Any text at all used to be saved as the phone — "not-a-phone!!" was accepted (audit, 11 Nov 2026).
const digitsIn = (v) => v.replace(/\D/g, '').length;
const isCustomerPhone = (v) => v === '' || (/^[+\d\s().-]+$/.test(v) && digitsIn(v) >= 9 && digitsIn(v) <= 15);
const CUSTOMER_PHONE_HINT = 'Enter a phone number in digits, e.g. 0712 345 678 or +255 712 345 678';
const customerPhone = z.string().trim().max(40).refine(isCustomerPhone, { message: CUSTOMER_PHONE_HINT });
const customerCreate = {
  body: z.object({
    name: z.string().trim().min(1).max(160),
    phone: customerPhone.optional().nullable(),
    region: tzRegion,
    address: z.string().trim().max(300).optional().nullable(),
    notes: z.string().trim().max(1000).optional().nullable(),
    salesRepId: id.optional().nullable(),
    isActive: z.boolean().optional(),
  }),
};
// An edit checks the phone only when it CHANGES (customers.controller compares it with the saved one): a
// customer saved before the check, with two numbers ("0712.../0754...") or a "-", could not be saved at
// all, not even for a name change.
const customerUpdate = {
  body: customerCreate.body.partial().extend({ phone: z.string().trim().max(40).optional().nullable() }),
};
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
    regions: tzRegionList,
    phone: z.string().trim().max(40).optional().nullable(),
    monthlyTarget: money.optional().nullable(),
    isActive: z.boolean().optional(),
  }),
};
const salesRepUpdate = {
  body: z.object({
    code: z.string().trim().max(40).optional(),
    region: tzRegion,
    regions: tzRegionList,
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
  isCustomerPhone,
  CUSTOMER_PHONE_HINT,
  salesRepCreate,
  salesRepUpdate,
  salesRepAddStock,
  warehouseCreate,
  warehouseUpdate,
};
