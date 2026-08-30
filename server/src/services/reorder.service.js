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
    const belowMin = p.minStockLevel > 0 && onHand <= p.minStockLevel;
    const shortCover = daysRemaining !== null && daysRemaining <= coverDays;

    // Days of cover decides the rank, and nothing else does. The minimum-stock
    // levels were set once and never checked against real selling pace, so
    // letting belowMin force HIGH put four years of cover in the same band as
    // stock that runs dry on Friday — and a list where everything shouts ranks
    // nothing. Below the minimum is still worth topping up, so it earns LOW and
    // says so in its reason; it no longer overrides the clock.
    let urgency = 'OK';
    if (shortCover && daysRemaining <= CRITICAL_DAYS) urgency = 'CRITICAL';
    else if (shortCover && daysRemaining <= HIGH_DAYS) urgency = 'HIGH';
    else if (shortCover) urgency = 'MEDIUM';
    else if (onHand <= 0 && belowMin) urgency = 'MEDIUM'; // nothing on the shelf to sell at all
    else if (belowMin) urgency = 'LOW';

    const needsReorder = urgency !== 'OK';

    // One line saying why this row is on the list, so long cover reads as long
    // cover instead of hiding behind a colour.
    let reason;
    if (shortCover && daysRemaining <= 0) {
      reason = `out of stock — was selling ${avgDaily}/day`;
    } else if (shortCover) {
      reason = `runs out in ${groupDigits(daysRemaining)} day${daysRemaining === 1 ? '' : 's'} at ${avgDaily}/day`;
      if (belowMin) reason += `, and below your minimum of ${groupDigits(p.minStockLevel)}`;
    } else if (onHand <= 0) {
      reason = `out of stock, and nothing sold in the last ${lookbackDays} days`;
    } else if (belowMin) {
      reason = daysRemaining !== null
        ? `below your minimum of ${groupDigits(p.minStockLevel)}, but ${groupDigits(daysRemaining)} days of cover`
        : `below your minimum of ${groupDigits(p.minStockLevel)}, but nothing sold in the last ${lookbackDays} days`;
    } else {
      reason = daysRemaining !== null
        ? `${groupDigits(daysRemaining)} days of cover left`
        : `nothing sold in the last ${lookbackDays} days`;
    }

    let recommendedQty = 0;
    if (needsReorder) {
      const gap = Math.max(target - onHand, p.minStockLevel - onHand, 0);
      // The supplier's pack size is a floor only where cover is genuinely
      // short. Rounding a one-box top-up up to a 50-box pack is how a product
      // with years of cover came to ask for millions of shillings of stock.
      recommendedQty = urgency === 'LOW' ? gap : Math.max(gap, p.reorderQuantity || 0);
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
      belowMin,
      needsReorder,
      urgency,
      reason,
      recommendedQty,
      recommendedValue: round2(recommendedQty * toNumber(p.purchasePrice)),
      message,
    };
  });

  const urgencyRank = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, OK: 4 };
  items.sort((a, b) => {
    if (urgencyRank[a.urgency] !== urgencyRank[b.urgency]) {
      return urgencyRank[a.urgency] - urgencyRank[b.urgency];
    }
    const da = a.daysRemaining ?? Infinity;
    const db = b.daysRemaining ?? Infinity;
    return da - db;
  });

  const recommendations = items.filter((i) => i.needsReorder);
  const countOf = (u) => recommendations.filter((i) => i.urgency === u).length;
  // What it costs to fix only the rows that are actually running out — the
  // whole-list total is inflated by top-ups nobody needs to buy this month.
  const urgentValue = recommendations
    .filter((i) => i.urgency === 'CRITICAL' || i.urgency === 'HIGH')
    .reduce((s, i) => s + i.recommendedValue, 0);

  return {
    summary: {
      lookbackDays,
      coverDays,
      criticalDays: CRITICAL_DAYS,
      highDays: HIGH_DAYS,
      productsAnalyzed: items.length,
      reorderCount: recommendations.length,
      criticalCount: countOf('CRITICAL'),
      highCount: countOf('HIGH'),
      mediumCount: countOf('MEDIUM'),
      lowCount: countOf('LOW'),
      belowMinCount: items.filter((i) => i.belowMin).length,
      noVelocityCount: items.filter((i) => i.avgDailySales === 0).length,
      estimatedReorderValue: round2(recommendations.reduce((s, i) => s + i.recommendedValue, 0)),
      urgentValue: round2(urgentValue),
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
