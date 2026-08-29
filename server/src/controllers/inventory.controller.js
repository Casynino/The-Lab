'use strict';

const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { ok, created, paginated } = require('../utils/response');
const { parsePagination } = require('../utils/pagination');
const inventory = require('../services/inventory.service');
const audit = require('../services/audit.service');
const { toNumber, round2 } = require('../utils/money');

// Receive stock into a warehouse (opening stock / purchase receipt).
const stockIn = asyncHandler(async (req, res) => {
  const { warehouseId, items, notes, occurredAt } = req.body;
  const type = req.body.type || 'STOCK_IN';

  const warehouse = await prisma.warehouse.findUnique({ where: { id: warehouseId } });
  if (!warehouse) throw ApiError.badRequest('Warehouse not found');

  const result = await prisma.$transaction(async (tx) => {
    const productIds = [...new Set(items.map((i) => i.productId))];
    const products = await tx.product.findMany({ where: { id: { in: productIds } } });
    const pMap = new Map(products.map((p) => [p.id, p]));
    if (pMap.size !== productIds.length) throw ApiError.badRequest('One or more products were not found');

    const movements = [];
    for (const item of items) {
      const { baseQuantity } = await inventory.convertToBase(tx, item.productId, item.packagingUnitId, item.quantity);
      const product = pMap.get(item.productId);
      const movement = await inventory.increaseStock(tx, {
        productId: item.productId,
        packagingUnitId: item.packagingUnitId,
        quantity: item.quantity,
        baseQuantity,
        type,
        location: { type: inventory.LOCATION.WAREHOUSE, warehouseId },
        unitCost: item.unitCost != null ? item.unitCost : toNumber(product.purchasePrice),
        referenceType: type === 'PURCHASE_RECEIPT' ? 'PURCHASE' : 'MANUAL',
        userId: req.user.id,
        notes: notes || null,
        occurredAt: occurredAt ? new Date(occurredAt) : undefined,
      });
      movements.push(movement);
    }
    return movements;
  });

  await audit.record(req, { action: 'STOCK_IN', entityType: 'Warehouse', entityId: warehouseId, newValues: { type, lines: items.length } });
  return created(res, { warehouseId, type, movements: result });
});

// Manual signed adjustment with a mandatory reason.
const adjust = asyncHandler(async (req, res) => {
  const { location, productId, packagingUnitId, quantity, direction, reason, occurredAt } = req.body;

  const movement = await prisma.$transaction(async (tx) => {
    const { baseQuantity } = await inventory.convertToBase(tx, productId, packagingUnitId, quantity);
    const product = await tx.product.findUnique({ where: { id: productId }, select: { purchasePrice: true } });
    const common = {
      productId,
      packagingUnitId,
      quantity,
      baseQuantity,
      type: 'ADJUSTMENT',
      location,
      unitCost: toNumber(product?.purchasePrice),
      referenceType: 'ADJUSTMENT',
      userId: req.user.id,
      notes: reason,
      occurredAt: occurredAt ? new Date(occurredAt) : undefined,
    };
    return direction === 'INCREASE' ? inventory.increaseStock(tx, common) : inventory.decreaseStock(tx, common);
  });

  await audit.record(req, { action: 'ADJUSTMENT', entityType: 'Product', entityId: productId, newValues: { direction, quantity, reason } });
  return created(res, movement);
});

// Write off damaged stock.
const damage = asyncHandler(async (req, res) => {
  const { location, productId, packagingUnitId, quantity, reason, occurredAt } = req.body;
  const movement = await prisma.$transaction(async (tx) => {
    const { baseQuantity } = await inventory.convertToBase(tx, productId, packagingUnitId, quantity);
    const product = await tx.product.findUnique({ where: { id: productId }, select: { purchasePrice: true } });
    return inventory.decreaseStock(tx, {
      productId,
      packagingUnitId,
      quantity,
      baseQuantity,
      type: 'DAMAGE',
      location,
      unitCost: toNumber(product?.purchasePrice),
      referenceType: 'ADJUSTMENT',
      userId: req.user.id,
      notes: reason,
      occurredAt: occurredAt ? new Date(occurredAt) : undefined,
    });
  });
  await audit.record(req, { action: 'DAMAGE', entityType: 'Product', entityId: productId, newValues: { quantity, reason } });
  return created(res, movement);
});

// Current on-hand balances, grouped by product with per-location breakdown.
const balances = asyncHandler(async (req, res) => {
  const q = req.validatedQuery || req.query;
  const scope = q.scope || 'ALL';

  const [whBalances, repBalances, warehouses, reps, products] = await Promise.all([
    scope === 'SALES_REP' ? [] : inventory.warehouseBalances(prisma, q.warehouseId),
    scope === 'WAREHOUSE' ? [] : inventory.repBalances(prisma, q.salesRepId),
    prisma.warehouse.findMany({ select: { id: true, name: true } }),
    prisma.salesRepresentative.findMany({ include: { user: { select: { name: true } } } }),
    prisma.product.findMany({
      where: q.productId ? { id: q.productId } : undefined,
      select: { id: true, name: true, sku: true, baseUnitName: true, purchasePrice: true, sellingPrice: true, minStockLevel: true, brand: { select: { id: true, name: true } } },
    }),
  ]);

  const whName = new Map(warehouses.map((w) => [w.id, w.name]));
  const repName = new Map(reps.map((r) => [r.id, r.user?.name || r.code]));
  const pMap = new Map(products.map((p) => [p.id, p]));

  const grouped = new Map();
  const ensure = (productId) => {
    if (!grouped.has(productId)) {
      grouped.set(productId, { productId, locations: [], totalBase: 0 });
    }
    return grouped.get(productId);
  };

  whBalances.forEach((b) => {
    if (q.productId && b.productId !== q.productId) return;
    if (!pMap.has(b.productId) || b.baseQuantity === 0) return;
    const g = ensure(b.productId);
    g.locations.push({ type: 'WAREHOUSE', id: b.warehouseId, name: whName.get(b.warehouseId), baseQuantity: b.baseQuantity });
    g.totalBase += b.baseQuantity;
  });
  repBalances.forEach((b) => {
    if (q.productId && b.productId !== q.productId) return;
    if (!pMap.has(b.productId) || b.baseQuantity === 0) return;
    const g = ensure(b.productId);
    g.locations.push({ type: 'SALES_REP', id: b.salesRepId, name: repName.get(b.salesRepId), baseQuantity: b.baseQuantity });
    g.totalBase += b.baseQuantity;
  });

  let rows = [...grouped.values()].map((g) => {
    const p = pMap.get(g.productId);
    return {
      productId: g.productId,
      name: p.name,
      sku: p.sku,
      baseUnitName: p.baseUnitName,
      brandId: p.brand?.id || null,
      brandName: p.brand?.name || null,
      minStockLevel: p.minStockLevel,
      sellingPrice: toNumber(p.sellingPrice),
      lowStock: p.minStockLevel > 0 && g.totalBase <= p.minStockLevel,
      totalBase: g.totalBase,
      value: round2(g.totalBase * toNumber(p.purchasePrice)),
      locations: g.locations.sort((a, b) => b.baseQuantity - a.baseQuantity),
    };
  });

  if (q.brand) {
    const b = q.brand.toLowerCase();
    rows = rows.filter((r) => (r.brandName || '').toLowerCase() === b);
  }
  if (q.search) {
    const s = q.search.toLowerCase();
    rows = rows.filter((r) => r.name.toLowerCase().includes(s) || r.sku.toLowerCase().includes(s));
  }
  rows.sort((a, b) => b.value - a.value);

  const pagination = parsePagination(q, { defaultLimit: 50 });
  const total = rows.length;
  const paged = rows.slice(pagination.skip, pagination.skip + pagination.take);

  // Totals and holdings are computed across EVERY row, not the page being sent.
  // A summary drawn from one page would change as you paged through it, which
  // is worse than not showing one.
  const holders = new Map();
  let totalBoxes = 0;
  let totalValue = 0;
  let lowCount = 0;
  let outCount = 0;
  for (const r of rows) {
    totalBoxes += r.totalBase;
    totalValue += r.value;
    if (r.totalBase <= 0) outCount += 1;
    else if (r.lowStock) lowCount += 1;
    const perBox = r.totalBase > 0 ? r.value / r.totalBase : 0;
    for (const loc of r.locations) {
      const key = `${loc.type}:${loc.id}`;
      const h = holders.get(key) || { type: loc.type, id: loc.id, name: loc.name, boxes: 0, value: 0 };
      h.boxes += loc.baseQuantity;
      h.value = round2(h.value + loc.baseQuantity * perBox);
      holders.set(key, h);
    }
  }

  const summary = {
    totalBoxes,
    totalValue: round2(totalValue),
    productCount: rows.length,
    lowCount,
    outCount,
    warehouseBoxes: [...holders.values()].filter((h) => h.type === 'WAREHOUSE').reduce((a, h) => a + h.boxes, 0),
    repBoxes: [...holders.values()].filter((h) => h.type === 'SALES_REP').reduce((a, h) => a + h.boxes, 0),
    holders: [...holders.values()].sort((a, b) => {
      if ((a.type === 'WAREHOUSE') !== (b.type === 'WAREHOUSE')) return a.type === 'WAREHOUSE' ? -1 : 1;
      return b.boxes - a.boxes;
    }),
  };

  return paginated(res, paged, { page: pagination.page, limit: pagination.limit, total, summary });
});

// Raw ledger movements (audit trail), paginated and filterable.
const movements = asyncHandler(async (req, res) => {
  const q = req.validatedQuery || req.query;
  const pagination = parsePagination(q, { defaultSortBy: 'occurredAt', defaultSortDir: 'desc', allowedSortFields: ['occurredAt', 'createdAt'] });
  const where = {};
  if (q.productId) where.productId = q.productId;
  if (q.type) where.type = q.type;
  if (q.warehouseId) where.warehouseId = q.warehouseId;
  if (q.salesRepId) where.salesRepId = q.salesRepId;
  if (q.from || q.to) {
    where.occurredAt = {};
    if (q.from) where.occurredAt.gte = new Date(q.from);
    if (q.to) where.occurredAt.lte = new Date(q.to);
  }

  const [items, total] = await Promise.all([
    prisma.inventoryTransaction.findMany({
      where,
      include: {
        product: { select: { name: true, sku: true, baseUnitName: true } },
        packagingUnit: { select: { name: true } },
        warehouse: { select: { name: true } },
        salesRep: { include: { user: { select: { name: true } } } },
        user: { select: { name: true } },
      },
      skip: pagination.skip,
      take: pagination.take,
      orderBy: pagination.orderBy,
    }),
    prisma.inventoryTransaction.count({ where }),
  ]);

  return paginated(res, items, { page: pagination.page, limit: pagination.limit, total });
});

const recomputeCaches = asyncHandler(async (req, res) => {
  const result = await inventory.recomputeAllCaches(prisma);
  await audit.record(req, { action: 'RECOMPUTE_CACHE', entityType: 'Inventory' });
  return ok(res, result);
});

// Admin maintenance: delete a single mistaken ledger entry (e.g. a damage or
// stock-count loss recorded by mistake) and rebuild caches so stock and the
// shrinkage/profit math reflect the removal. Irreversible — use carefully.
const deleteMovement = asyncHandler(async (req, res) => {
  const tx = await prisma.inventoryTransaction.findUnique({
    where: { id: req.params.id },
    include: { product: { select: { name: true } } },
  });
  if (!tx) throw ApiError.notFound('Ledger entry not found');
  await prisma.inventoryTransaction.delete({ where: { id: req.params.id } });
  await inventory.recomputeAllCaches(prisma);
  await audit.record(req, {
    action: 'DELETE',
    entityType: 'InventoryTransaction',
    entityId: req.params.id,
    oldValues: { type: tx.type, product: tx.product?.name, baseQuantity: tx.baseQuantity, notes: tx.notes },
  });
  return ok(res, { deleted: true, id: req.params.id, type: tx.type, product: tx.product?.name, baseQuantity: tx.baseQuantity });
});

module.exports = { stockIn, adjust, damage, balances, movements, recomputeCaches, deleteMovement };
