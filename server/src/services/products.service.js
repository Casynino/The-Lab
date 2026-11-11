'use strict';

const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const inventory = require('./inventory.service');
const { randomCode } = require('../utils/numbering');
const { toNumber } = require('../utils/money');

const PRODUCT_INCLUDE = {
  brand: true,
  category: true,
  packagings: { include: { packagingUnit: true }, orderBy: { baseQuantity: 'asc' } },
};

// Validate a packaging configuration: exactly one base unit with factor 1, and
// no duplicate units.
function validatePackagings(packagings) {
  if (!packagings || packagings.length === 0) {
    throw ApiError.badRequest('A product needs at least one packaging level (the base unit)');
  }
  const baseUnits = packagings.filter((p) => p.isBaseUnit);
  if (baseUnits.length !== 1) {
    throw ApiError.badRequest('Exactly one packaging level must be marked as the base unit');
  }
  if (baseUnits[0].baseQuantity !== 1) {
    throw ApiError.badRequest('The base unit must have a baseQuantity of 1');
  }
  const ids = packagings.map((p) => p.packagingUnitId);
  if (new Set(ids).size !== ids.length) {
    throw ApiError.badRequest('Duplicate packaging units are not allowed');
  }
  packagings.forEach((p) => {
    if (!Number.isInteger(p.baseQuantity) || p.baseQuantity < 1) {
      throw ApiError.badRequest('Each packaging baseQuantity must be a whole number >= 1');
    }
  });
}

async function generateSku(tx, name) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const prefix = (name || 'PRD').replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() || 'PRD';
    const sku = `${prefix}-${randomCode(6)}`;
    const exists = await tx.product.findUnique({ where: { sku } });
    if (!exists) return sku;
  }
  return `PRD-${Date.now()}`;
}

async function createProduct(payload, actor) {
  validatePackagings(payload.packagings);

  return prisma.$transaction(async (tx) => {
    const [brand, category] = await Promise.all([
      tx.brand.findUnique({ where: { id: payload.brandId } }),
      tx.category.findUnique({ where: { id: payload.categoryId } }),
    ]);
    if (!brand) throw ApiError.badRequest('Brand not found');
    if (!category) throw ApiError.badRequest('Category not found');

    // Validate referenced packaging units exist.
    const unitIds = payload.packagings.map((p) => p.packagingUnitId);
    const units = await tx.packagingUnit.findMany({ where: { id: { in: unitIds } } });
    if (units.length !== new Set(unitIds).size) {
      throw ApiError.badRequest('One or more packaging units were not found');
    }

    const sku = payload.sku || (await generateSku(tx, payload.name));

    const baseUnit = payload.packagings.find((p) => p.isBaseUnit);
    const baseUnitName =
      payload.baseUnitName || units.find((u) => u.id === baseUnit.packagingUnitId)?.name || 'Pack';

    return tx.product.create({
      data: {
        name: payload.name,
        sku,
        barcode: payload.barcode || null,
        description: payload.description || null,
        imageUrl: payload.imageUrl || null,
        brandId: payload.brandId,
        categoryId: payload.categoryId,
        baseUnitName,
        purchasePrice: payload.purchasePrice,
        sellingPrice: payload.sellingPrice,
        minStockLevel: payload.minStockLevel ?? 0,
        reorderQuantity: payload.reorderQuantity ?? 0,
        isActive: payload.isActive ?? true,
        packagings: {
          create: payload.packagings.map((p) => ({
            packagingUnitId: p.packagingUnitId,
            baseQuantity: p.baseQuantity,
            unitPrice: p.unitPrice ?? null,
            isBaseUnit: !!p.isBaseUnit,
            isActive: p.isActive ?? true,
          })),
        },
      },
      include: PRODUCT_INCLUDE,
    });
  });
}

async function updateProduct(id, payload) {
  const product = await prisma.product.findUnique({ where: { id } });
  if (!product) throw ApiError.notFound('Product not found');

  const data = {};
  const fields = [
    'name',
    'barcode',
    'description',
    'imageUrl',
    'brandId',
    'categoryId',
    'baseUnitName',
    'purchasePrice',
    'sellingPrice',
    'minStockLevel',
    'reorderQuantity',
    'isActive',
  ];
  fields.forEach((f) => {
    if (payload[f] !== undefined) data[f] = payload[f];
  });

  return prisma.product.update({ where: { id }, data, include: PRODUCT_INCLUDE });
}

// Replace the full packaging configuration of a product.
async function setPackagings(id, packagings) {
  validatePackagings(packagings);
  return prisma.$transaction(async (tx) => {
    const product = await tx.product.findUnique({ where: { id } });
    if (!product) throw ApiError.notFound('Product not found');

    const unitIds = packagings.map((p) => p.packagingUnitId);
    const units = await tx.packagingUnit.findMany({ where: { id: { in: unitIds } } });
    if (units.length !== new Set(unitIds).size) {
      throw ApiError.badRequest('One or more packaging units were not found');
    }

    await tx.productPackaging.deleteMany({ where: { productId: id } });
    await tx.productPackaging.createMany({
      data: packagings.map((p) => ({
        productId: id,
        packagingUnitId: p.packagingUnitId,
        baseQuantity: p.baseQuantity,
        unitPrice: p.unitPrice ?? null,
        isBaseUnit: !!p.isBaseUnit,
        isActive: p.isActive ?? true,
      })),
    });

    return tx.product.findUnique({ where: { id }, include: PRODUCT_INCLUDE });
  });
}

async function listProducts(filters, pagination) {
  const where = {};
  if (filters.brandId) where.brandId = filters.brandId;
  if (filters.categoryId) where.categoryId = filters.categoryId;
  if (filters.isActive !== undefined) where.isActive = filters.isActive;
  if (filters.search) {
    where.OR = [
      { name: { contains: filters.search, mode: 'insensitive' } },
      { sku: { contains: filters.search, mode: 'insensitive' } },
      { barcode: { contains: filters.search, mode: 'insensitive' } },
    ];
  }

  const [items, total, onHand, inWarehouse] = await Promise.all([
    prisma.product.findMany({
      where,
      include: PRODUCT_INCLUDE,
      skip: pagination.skip,
      take: pagination.take,
      orderBy: pagination.orderBy,
    }),
    prisma.product.count({ where }),
    inventory.productOnHand(prisma),
    inventory.warehouseOnHand(prisma),
  ]);

  const enriched = items.map((p) => {
    const onHandBase = onHand.get(p.id) || 0;
    const warehouseBase = inWarehouse.get(p.id) || 0;
    return {
      ...p,
      onHandBase,
      warehouseBase,
      stockValue: Number((onHandBase * toNumber(p.purchasePrice)).toFixed(2)),
      // The minimum is a warehouse level, as the stock alerts measure it — boxes with reps are not on the shelf.
      lowStock: p.minStockLevel > 0 && warehouseBase <= p.minStockLevel,
    };
  });

  return { items: enriched, total };
}

async function getProduct(id) {
  const product = await prisma.product.findUnique({ where: { id }, include: PRODUCT_INCLUDE });
  if (!product) throw ApiError.notFound('Product not found');

  const [whBalances, repBalances] = await Promise.all([
    inventory.warehouseBalances(prisma).then((rows) => rows.filter((r) => r.productId === id)),
    inventory.repBalances(prisma).then((rows) => rows.filter((r) => r.productId === id)),
  ]);

  const onHandBase =
    whBalances.reduce((s, r) => s + r.baseQuantity, 0) +
    repBalances.reduce((s, r) => s + r.baseQuantity, 0);

  return {
    ...product,
    onHandBase,
    warehouseBalances: whBalances,
    repBalances,
    stockValue: Number((onHandBase * toNumber(product.purchasePrice)).toFixed(2)),
  };
}

async function deleteProduct(id) {
  const movements = await prisma.inventoryTransaction.count({ where: { productId: id } });
  if (movements > 0) {
    // Never destroy a product with ledger history; deactivate instead.
    return prisma.product.update({ where: { id }, data: { isActive: false } });
  }
  return prisma.product.delete({ where: { id } });
}

module.exports = {
  createProduct,
  updateProduct,
  setPackagings,
  listProducts,
  getProduct,
  deleteProduct,
  PRODUCT_INCLUDE,
};
