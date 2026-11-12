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
  // Switching off is refused while a settlement of it waits for approval (audit reversals-stock-1).
  if (payload.isActive === false && product.isActive) await assertNoPendingSettlements(product);

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

  const [items, total, onHand, inWarehouse, everyRow] = await Promise.all([
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
    // The summary cards count EVERY product the filter matches, not the page on screen (audit admin-ops-5).
    filters.withSummary
      ? prisma.product.findMany({ where, select: { id: true, sellingPrice: true, minStockLevel: true } })
      : null,
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

  const summary = everyRow ? productsSummary(everyRow, onHand, inWarehouse) : undefined;
  return { items: enriched, total, summary };
}

// Boxes on hand, their worth at selling price and how many products run low, over a list of products.
// Same rules as the rows above (low = the warehouse shelf at or under the minimum). Pure (tested).
function productsSummary(rows, onHand, inWarehouse) {
  let boxes = 0;
  let worth = 0;
  let low = 0;
  for (const p of rows) {
    const n = onHand.get(p.id) || 0;
    boxes += n;
    worth += n * toNumber(p.sellingPrice);
    if (p.minStockLevel > 0 && (inWarehouse.get(p.id) || 0) <= p.minStockLevel) low += 1;
  }
  return { onHandBase: boxes, worthAtSelling: Number(worth.toFixed(2)), lowCount: low };
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

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

async function repNames(ids) {
  if (!ids.length) return new Map();
  const reps = await prisma.salesRepresentative.findMany({
    where: { id: { in: ids } },
    select: { id: true, code: true, user: { select: { name: true } } },
  });
  return new Map(reps.map((r) => [r.id, r.user?.name || r.code]));
}

// A switched-off product cannot be settled or approved, so switching it off while a rep's settlement of
// it waits for approval strands money he has already sent (audit reversals-stock-1). Refused until
// every one of them is approved or rejected.
async function assertNoPendingSettlements(product) {
  const rows = await prisma.settlementSubmission.findMany({
    where: { productId: product.id, status: 'PENDING' },
    select: { salesRepId: true },
  });
  if (!rows.length) return;
  const who = [...(await repNames([...new Set(rows.map((r) => r.salesRepId))])).values()].join(', ');
  const one = rows.length === 1;
  throw ApiError.badRequest(
    `${plural(rows.length, 'settlement', 'settlements')} of ${product.name} ${one ? 'is' : 'are'} waiting for approval${who ? ` (${who})` : ''}. `
    + `A switched-off product cannot be approved, so approve or reject ${one ? 'it' : 'them'} first.`,
  );
}

// Where a product's boxes are now: the warehouses together, and each rep who still holds some.
async function holdings(productId) {
  const [wh, reps] = await Promise.all([
    prisma.inventoryTransaction.aggregate({ where: { productId, warehouseId: { not: null } }, _sum: { baseQuantity: true } }),
    prisma.inventoryTransaction.groupBy({ by: ['salesRepId'], where: { productId, salesRepId: { not: null } }, _sum: { baseQuantity: true } }),
  ]);
  const held = reps.map((r) => ({ salesRepId: r.salesRepId, boxes: r._sum.baseQuantity || 0 })).filter((r) => r.boxes > 0);
  const names = await repNames(held.map((h) => h.salesRepId));
  return {
    warehouse: Math.max(0, wh._sum.baseQuantity || 0),
    reps: held.map((h) => ({ ...h, name: names.get(h.salesRepId) || 'a rep' })),
  };
}

// Remove a product. Only one that nothing refers to is deleted. One with stock history is switched off
// instead, and the answer says so and why, with the boxes still in stock (audit reversals-stock-1: it
// said "Product removed" while 34 boxes, 5 of them with a rep, stayed in the books). One that was never
// stocked but sits on a purchase order or a stock request is refused by name (audit reversals-stock-7:
// it answered "Related record constraint failed (foreign key)").
async function deleteProduct(id) {
  const product = await prisma.product.findUnique({ where: { id } });
  if (!product) throw ApiError.notFound('Product not found');
  const where = { productId: id };
  const [movements, sales, transfers, returns, counts, submissions, poLines, requestLines] = await Promise.all([
    prisma.inventoryTransaction.count({ where }),
    prisma.saleItem.count({ where }),
    prisma.stockTransferItem.count({ where }),
    prisma.returnItem.count({ where }),
    prisma.stockCountItem.count({ where }),
    prisma.settlementSubmission.count({ where }),
    prisma.purchaseOrderItem.findMany({ where, select: { purchaseOrder: { select: { poNumber: true } } }, take: 20 }),
    prisma.stockRequestItem.findMany({ where, select: { stockRequest: { select: { requestNumber: true } } }, take: 20 }),
  ]);

  if (movements + sales + transfers + returns + counts + submissions > 0) {
    await assertNoPendingSettlements(product);
    const updated = await prisma.product.update({ where: { id }, data: { isActive: false } });
    const h = await holdings(id);
    const repBoxes = h.reps.reduce((s, r) => s + r.boxes, 0);
    const where_ = [
      h.warehouse > 0 && `${h.warehouse} in the warehouse`,
      repBoxes > 0 && `${repBoxes} with reps (${h.reps.map((r) => `${r.name} ${r.boxes}`).join(', ')})`,
    ].filter(Boolean);
    const unit = (product.baseUnitName || 'box').toLowerCase();
    const message = `${product.name} was switched off, not removed: it has stock history, which stays in the records.`
      + (where_.length
        ? ` Still in stock: ${where_.join('; ')}. Switch it back on to settle, move or write off these ${unit === 'box' ? 'boxes' : `${unit}s`}.`
        : ' It no longer shows for new orders.');
    return { ...updated, deleted: false, deactivated: true, holdings: h, message };
  }

  const orders = [...new Set(poLines.map((l) => l.purchaseOrder?.poNumber).filter(Boolean))];
  const requests = [...new Set(requestLines.map((l) => l.stockRequest?.requestNumber).filter(Boolean))];
  if (orders.length || requests.length) {
    const on = [
      orders.length && `purchase ${orders.length === 1 ? 'order' : 'orders'} ${orders.slice(0, 5).join(', ')}`,
      requests.length && `stock ${requests.length === 1 ? 'request' : 'requests'} ${requests.slice(0, 5).join(', ')}`,
    ].filter(Boolean).join(' and ');
    throw ApiError.badRequest(
      `${product.name} is on ${on}, so it cannot be removed. Take it off ${orders.length + requests.length === 1 ? 'that' : 'those'} first, or switch the product off in Edit.`,
    );
  }

  try {
    await prisma.product.delete({ where: { id } });
  } catch (e) {
    // Put on an order or a request between the check above and now.
    if (e.code === 'P2003') throw ApiError.badRequest(`${product.name} is now used on another record, so it cannot be removed. Switch it off in Edit instead.`);
    throw e;
  }
  return { id, name: product.name, deleted: true, deactivated: false, message: `${product.name} removed.` };
}

module.exports = {
  createProduct,
  updateProduct,
  setPackagings,
  listProducts,
  getProduct,
  deleteProduct,
  PRODUCT_INCLUDE,
  productsSummary,
};
