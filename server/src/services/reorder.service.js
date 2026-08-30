'use strict';

const prisma = require('../config/prisma');
const env = require('../config/env');
const inventory = require('./inventory.service');
const { toNumber, round2 } = require('../utils/money');
const { dayjs } = require('../utils/dates');

// Urgency bands, in days of cover. These are the numbers to argue about, and
// they are deliberately about time, not about the minimum-stock levels: a
// restock takes the better part of a week to land, two weeks is one ordering
// cycle, and past the target cover we already hold there is nothing to rush.
const CRITICAL_DAYS = 7;
const HIGH_DAYS = 14;

const groupDigits = (n) => Number(n || 0).toLocaleString('en-US');

// Compute sales velocity and project days-of-cover for every active product,
// then recommend reorder quantities. "Days remaining" = on-hand / avg daily
// sales over the lookback window.
async function reorderAnalysis(options = {}) {
  const lookbackDays = options.lookbackDays || env.business.reorderLookbackDays;
  const coverDays = options.coverDays || 30; // target days of stock to hold
  const since = dayjs().subtract(lookbackDays, 'day').toDate();

  const [products, soldRows, onHandMap] = await Promise.all([
    prisma.product.findMany({
      where: { isActive: true },
      include: { brand: { select: { name: true } }, category: { select: { name: true } } },
    }),
    prisma.inventoryTransaction.groupBy({
      by: ['productId'],
      where: { type: { in: ['CASH_SALE', 'CREDIT_SALE'] }, occurredAt: { gte: since } },
      _sum: { baseQuantity: true }, // negative numbers (outflows)
    }),
    inventory.productOnHand(prisma),
  ]);

  const soldMap = new Map(soldRows.map((r) => [r.productId, Math.abs(r._sum.baseQuantity || 0)]));

  const items = products.map((p) => {
    const onHand = onHandMap.get(p.id) || 0;
    const soldBase = soldMap.get(p.id) || 0;
    const avgDaily = round2(soldBase / lookbackDays);
    const daysRemaining = avgDaily > 0 ? Math.floor(onHand / avgDaily) : null;

    const target = Math.ceil(avgDaily * coverDays);
    const belowMin = onHand <= p.minStockLevel;
    const lowCover = daysRemaining !== null && daysRemaining <= coverDays / 2; // < half target cover
    const needsReorder = belowMin || lowCover;

    let recommendedQty = 0;
    if (needsReorder) {
      const gap = Math.max(target - onHand, p.minStockLevel - onHand, 0);
      recommendedQty = Math.max(gap, p.reorderQuantity || 0);
    }

    let urgency = 'OK';
    if (needsReorder) {
      if (daysRemaining !== null && daysRemaining <= 3) urgency = 'CRITICAL';
      else if (belowMin || (daysRemaining !== null && daysRemaining <= 7)) urgency = 'HIGH';
      else urgency = 'MEDIUM';
    }

    let message = `${p.name} has ${onHand} ${p.baseUnitName}(s) on hand`;
    if (avgDaily > 0 && daysRemaining !== null) {
      message += `, selling ~${avgDaily}/day — projected to run out in approximately ${daysRemaining} day(s).`;
    } else {
      message += ' with no recent sales activity.';
    }

    return {
      productId: p.id,
      name: p.name,
      sku: p.sku,
      brand: p.brand?.name,
      category: p.category?.name,
      baseUnitName: p.baseUnitName,
      onHand,
      minStockLevel: p.minStockLevel,
      avgDailySales: avgDaily,
      daysRemaining,
      needsReorder,
      urgency,
      recommendedQty,
      recommendedValue: round2(recommendedQty * toNumber(p.purchasePrice)),
      message,
    };
  });

  const urgencyRank = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, OK: 3 };
  items.sort((a, b) => {
    if (urgencyRank[a.urgency] !== urgencyRank[b.urgency]) {
      return urgencyRank[a.urgency] - urgencyRank[b.urgency];
    }
    const da = a.daysRemaining ?? Infinity;
    const db = b.daysRemaining ?? Infinity;
    return da - db;
  });

  const recommendations = items.filter((i) => i.needsReorder);

  return {
    summary: {
      lookbackDays,
      coverDays,
      productsAnalyzed: items.length,
      reorderCount: recommendations.length,
      criticalCount: recommendations.filter((i) => i.urgency === 'CRITICAL').length,
      estimatedReorderValue: round2(recommendations.reduce((s, i) => s + i.recommendedValue, 0)),
    },
    recommendations,
    items,
  };
}

// Products at or below their configured minimum stock level.
async function lowStock() {
  const products = await prisma.product.findMany({
    where: { isActive: true },
    select: { id: true, name: true, sku: true, minStockLevel: true, baseUnitName: true },
  });
  const onHand = await inventory.productOnHand(prisma);
  return products
    .map((p) => ({ ...p, onHand: onHand.get(p.id) || 0 }))
    .filter((p) => p.minStockLevel > 0 && p.onHand <= p.minStockLevel)
    .sort((a, b) => a.onHand - b.onHand);
}

module.exports = { reorderAnalysis, lowStock };
