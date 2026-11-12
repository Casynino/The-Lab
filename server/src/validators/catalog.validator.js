'use strict';

const { z } = require('zod');
const { id, paginationFields, boolQuery, money } = require('./common.validator');

// --- Brand & Category (identical shape) ------------------------------------
const namedCreate = {
  body: z.object({
    name: z.string().trim().min(1, 'Name is required').max(120),
    description: z.string().trim().max(500).optional(),
    isActive: z.boolean().optional(),
  }),
};
const namedUpdate = {
  body: z.object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(500).optional().nullable(),
    isActive: z.boolean().optional(),
  }),
};
const namedQuery = {
  query: z.object({ ...paginationFields, isActive: boolQuery }),
};

// --- Packaging units -------------------------------------------------------
const packagingUnitCreate = {
  body: z.object({
    name: z.string().trim().min(1).max(60),
    shortCode: z.string().trim().min(1).max(10),
    description: z.string().trim().max(200).optional(),
    level: z.number().int().min(0).optional(),
  }),
};
const packagingUnitUpdate = {
  body: z.object({
    name: z.string().trim().min(1).max(60).optional(),
    shortCode: z.string().trim().min(1).max(10).optional(),
    description: z.string().trim().max(200).optional().nullable(),
    level: z.number().int().min(0).optional(),
  }),
};

// --- Products --------------------------------------------------------------
const packagingInput = z.object({
  packagingUnitId: id,
  baseQuantity: z.number().int().min(1),
  unitPrice: money.optional().nullable(),
  isBaseUnit: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

// Product names carry no dash (owner, 12 Nov 2026): "OHIS Ndogo (Brown) Bila Filter". A dash typed with
// spaces around it ("(Brown) – Bila Filter") becomes one space; a hyphen inside a word stays.
const productName = z.string().trim().min(1).max(200)
  .transform((s) => s.replace(/\s+[-‒–—―]+\s+/g, ' ').replace(/\s{2,}/g, ' ').trim());

const productCreate = {
  body: z.object({
    name: productName,
    sku: z.string().trim().min(1).max(60).optional(),
    barcode: z.string().trim().max(60).optional().nullable(),
    description: z.string().trim().max(1000).optional().nullable(),
    imageUrl: z.string().url().max(500).optional().nullable(),
    brandId: id,
    categoryId: id,
    baseUnitName: z.string().trim().max(40).optional(),
    purchasePrice: money,
    sellingPrice: money,
    minStockLevel: z.number().int().min(0).optional(),
    reorderQuantity: z.number().int().min(0).optional(),
    isActive: z.boolean().optional(),
    packagings: z.array(packagingInput).min(1),
  }),
};

const productUpdate = {
  body: z.object({
    name: productName.optional(),
    barcode: z.string().trim().max(60).optional().nullable(),
    description: z.string().trim().max(1000).optional().nullable(),
    imageUrl: z.string().url().max(500).optional().nullable(),
    brandId: id.optional(),
    categoryId: id.optional(),
    baseUnitName: z.string().trim().max(40).optional(),
    purchasePrice: money.optional(),
    sellingPrice: money.optional(),
    minStockLevel: z.number().int().min(0).optional(),
    reorderQuantity: z.number().int().min(0).optional(),
    isActive: z.boolean().optional(),
  }),
};

const setPackagings = {
  body: z.object({ packagings: z.array(packagingInput).min(1) }),
};

const productQuery = {
  query: z.object({
    ...paginationFields,
    brandId: id.optional(),
    categoryId: id.optional(),
    isActive: boolQuery,
  }),
};

module.exports = {
  namedCreate,
  namedUpdate,
  namedQuery,
  packagingUnitCreate,
  packagingUnitUpdate,
  productCreate,
  productUpdate,
  setPackagings,
  productQuery,
};
