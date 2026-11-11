'use strict';

const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const inventory = require('./inventory.service');
const { nextDocNumber } = require('../utils/numbering');
const { toNumber, round2 } = require('../utils/money');
const { eatDayBounds } = require('../utils/dates');

const COUNT_INCLUDE = {
  items: { include: { product: true, packagingUnit: true } },
  warehouse: true,
  conductedBy: { select: { id: true, name: true } },
};

// Perform a physical stock count at a location. For each line we snapshot the
// ledger balance (expected), record the physical count, and — if they differ —
// post a STOCK_COUNT reconciliation entry so the ledger matches reality. A
// negative variance is missing stock / shrinkage.
async function createStockCount(payload, actor) {
  const { locationType, warehouseId, salesRepId, items, notes, countedAt } = payload;

  if (!items || items.length === 0) throw ApiError.badRequest('A stock count needs at least one line');
  if (locationType === 'WAREHOUSE' && !warehouseId) throw ApiError.badRequest('warehouseId is required');
  if (locationType === 'SALES_REP' && !salesRepId) throw ApiError.badRequest('salesRepId is required');

  const location =
    locationType === 'WAREHOUSE'
      ? { type: inventory.LOCATION.WAREHOUSE, warehouseId }
      : { type: inventory.LOCATION.SALES_REP, salesRepId };

  return prisma.$transaction(
    async (tx) => {
      const computed = [];
      for (const input of items) {
        // Resolve countedBase: if a packaging unit is supplied, convert.
        let countedBase = Number(input.countedQuantity);
        if (!Number.isInteger(countedBase) || countedBase < 0) {
          throw ApiError.badRequest('countedQuantity must be a non-negative whole number');
        }
        if (input.packagingUnitId) {
          const pkg = await tx.productPackaging.findUnique({
            where: {
              productId_packagingUnitId: {
                productId: input.productId,
                packagingUnitId: input.packagingUnitId,
              },
            },
          });
          if (!pkg) throw ApiError.badRequest('Invalid packaging unit for product');
          countedBase *= pkg.baseQuantity;
        }

        const expectedBase = await inventory.getBalance(tx, {
          productId: input.productId,
          type: location.type,
          warehouseId: location.warehouseId,
          salesRepId: location.salesRepId,
        });
        const varianceBase = countedBase - expectedBase;

        computed.push({
          productId: input.productId,
          packagingUnitId: input.packagingUnitId || null,
          expectedBase,
          countedBase,
          varianceBase,
        });
      }

      const countNumber = await nextDocNumber(tx.stockCount, 'countNumber', 'CNT');

      const count = await tx.stockCount.create({
        data: {
          countNumber,
          status: 'COMPLETED',
          locationType,
          warehouseId: warehouseId || null,
          salesRepId: salesRepId || null,
          notes: notes || null,
          countedAt: countedAt ? new Date(countedAt) : new Date(),
          conductedById: actor ? actor.id : null,
          items: { create: computed },
        },
      });

      // Reconcile the ledger to the physical count for any non-zero variance.
      for (const c of computed) {
        if (c.varianceBase === 0) continue;
        const product = await tx.product.findUnique({
          where: { id: c.productId },
          select: { purchasePrice: true },
        });
        await inventory.postMovement(tx, {
          type: 'STOCK_COUNT',
          productId: c.productId,
          packagingUnitId: c.packagingUnitId,
          quantity: Math.abs(c.varianceBase),
          baseQuantity: c.varianceBase, // signed reconciliation
          unitCost: toNumber(product?.purchasePrice),
          location,
          referenceType: 'STOCK_COUNT',
          referenceId: count.id,
          userId: actor ? actor.id : null,
          notes:
            c.varianceBase < 0
              ? `Shrinkage found on count ${countNumber}`
              : `Surplus found on count ${countNumber}`,
          occurredAt: count.countedAt,
        });
      }

      return tx.stockCount.findUnique({ where: { id: count.id }, include: COUNT_INCLUDE });
    },
    { timeout: 30000 },
  );
}

async function listStockCounts(filters, pagination) {
  const where = {};
  if (filters.locationType) where.locationType = filters.locationType;
  if (filters.warehouseId) where.warehouseId = filters.warehouseId;
  if (filters.salesRepId) where.salesRepId = filters.salesRepId;
  if (filters.status) where.status = filters.status;

  const [items, total] = await Promise.all([
    prisma.stockCount.findMany({
      where,
      include: COUNT_INCLUDE,
      skip: pagination.skip,
      take: pagination.take,
      orderBy: pagination.orderBy,
    }),
    prisma.stockCount.count({ where }),
  ]);
  return { items, total };
}

async function getStockCount(id) {
  const count = await prisma.stockCount.findUnique({ where: { id }, include: COUNT_INCLUDE });
  if (!count) throw ApiError.notFound('Stock count not found');
  return count;
}

// Missing-stock report: every negative STOCK_COUNT / DAMAGE entry, valued.
async function missingStockReport(filters = {}) {
  const where = {
    type: { in: ['STOCK_COUNT', 'DAMAGE'] },
    baseQuantity: { lt: 0 },
  };
  if (filters.from || filters.to) {
    // A bare day is a Dar es Salaam day, not UTC midnight (audit backend-integrity-8).
    const bounds = eatDayBounds({ from: filters.from, to: filters.to });
    if (!bounds) throw ApiError.badRequest('Use dates like 2026-11-11 for from and to');
    where.occurredAt = bounds;
  }
  if (filters.salesRepId) where.salesRepId = filters.salesRepId;
  if (filters.warehouseId) where.warehouseId = filters.warehouseId;

  const rows = await prisma.inventoryTransaction.findMany({
    where,
    include: {
      product: { select: { name: true, sku: true, baseUnitName: true, purchasePrice: true } },
      warehouse: { select: { name: true } },
      salesRep: { include: { user: { select: { name: true } } } },
    },
    orderBy: { occurredAt: 'desc' },
  });

  let totalUnits = 0;
  let totalValue = 0;
  const items = rows.map((r) => {
    const units = Math.abs(r.baseQuantity);
    const value = round2(units * toNumber(r.product.purchasePrice));
    totalUnits += units;
    totalValue += value;
    return {
      id: r.id,
      occurredAt: r.occurredAt,
      type: r.type,
      product: r.product.name,
      sku: r.product.sku,
      units,
      baseUnitName: r.product.baseUnitName,
      value,
      location:
        r.locationType === 'WAREHOUSE'
          ? r.warehouse?.name || 'Warehouse'
          : r.salesRep?.user?.name || 'Sales rep',
      notes: r.notes,
    };
  });

  return { totals: { totalUnits, totalValue: round2(totalValue), count: items.length }, items };
}

// Full reconciliation for a single rep: assigned vs sold vs returned vs held
// vs missing — the "assigned 20 / sold 15 / returned 3 / missing 2" view.
async function repReconciliation(salesRepId) {
  const grouped = await prisma.inventoryTransaction.groupBy({
    by: ['productId', 'type'],
    where: { salesRepId },
    _sum: { baseQuantity: true },
  });

  const byProduct = new Map();
  for (const g of grouped) {
    const cur =
      byProduct.get(g.productId) ||
      { assigned: 0, sold: 0, returned: 0, damaged: 0, missing: 0, surplus: 0, onHand: 0 };
    const base = g._sum.baseQuantity || 0;
    switch (g.type) {
      case 'TRANSFER_IN':
      case 'CUSTOMER_RETURN':
        cur.assigned += base;
        break;
      case 'CASH_SALE':
      case 'CREDIT_SALE':
        cur.sold += Math.abs(base);
        break;
      case 'SALES_RETURN':
      case 'TRANSFER_OUT':
        cur.returned += Math.abs(base);
        break;
      case 'DAMAGE':
        cur.damaged += Math.abs(base);
        break;
      case 'STOCK_COUNT':
      case 'CORRECTION':
      case 'ADJUSTMENT':
        if (base < 0) cur.missing += Math.abs(base);
        else cur.surplus += base;
        break;
      default:
        break;
    }
    cur.onHand += base;
    byProduct.set(g.productId, cur);
  }

  const productIds = [...byProduct.keys()];
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, name: true, sku: true, baseUnitName: true, purchasePrice: true },
  });
  const pMap = new Map(products.map((p) => [p.id, p]));

  const items = productIds.map((id) => {
    const r = byProduct.get(id);
    const p = pMap.get(id);
    return {
      productId: id,
      product: p?.name,
      sku: p?.sku,
      baseUnitName: p?.baseUnitName,
      assigned: r.assigned,
      sold: r.sold,
      returned: r.returned,
      damaged: r.damaged,
      missing: r.missing,
      onHand: r.onHand,
      missingValue: round2(r.missing * toNumber(p?.purchasePrice)),
    };
  });

  return items.filter((i) => i.assigned || i.sold || i.returned || i.onHand || i.missing);
}

module.exports = {
  createStockCount,
  listStockCounts,
  getStockCount,
  missingStockReport,
  repReconciliation,
  COUNT_INCLUDE,
};
