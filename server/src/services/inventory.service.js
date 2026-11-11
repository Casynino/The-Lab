'use strict';

const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const { toNumber, round2 } = require('../utils/money');

// ===========================================================================
// THE LEDGER ENGINE
//
// Every public function that *reads* a balance derives it from the
// InventoryTransaction ledger (the single source of truth). Every function
// that *writes* a movement appends an immutable ledger row and updates the
// materialized cache (WarehouseStock / RepStock) inside the SAME db
// transaction, so the cache can never silently diverge.
//
// Sign convention: `baseQuantity` on a ledger row is SIGNED in base units.
//   +N  => N base units entered the location
//   -N  => N base units left the location
// Callers should use the higher-level helpers (increaseStock / decreaseStock /
// transferStock) which set the correct sign and run availability checks.
// ===========================================================================

const LOCATION = { WAREHOUSE: 'WAREHOUSE', SALES_REP: 'SALES_REP' };

// Movement types that ADD to a location vs REMOVE from it. ADJUSTMENT /
// CORRECTION / STOCK_COUNT are signed explicitly by the caller.
const INBOUND_TYPES = new Set([
  'STOCK_IN',
  'PURCHASE_RECEIPT',
  'TRANSFER_IN',
  'CUSTOMER_RETURN',
]);
const OUTBOUND_TYPES = new Set([
  'TRANSFER_OUT',
  'CASH_SALE',
  'CREDIT_SALE',
  'SALES_RETURN',
  'DAMAGE',
]);

// --- Packaging conversion --------------------------------------------------

// Resolve how many BASE units `quantity` of a packaging unit represents.
async function convertToBase(client, productId, packagingUnitId, quantity) {
  const qty = Number(quantity);
  if (!Number.isInteger(qty) || qty <= 0) {
    throw ApiError.badRequest('Quantity must be a positive whole number');
  }
  const packaging = await client.productPackaging.findUnique({
    where: { productId_packagingUnitId: { productId, packagingUnitId } },
    include: { packagingUnit: true },
  });
  if (!packaging || !packaging.isActive) {
    throw ApiError.badRequest('This product is not configured for the selected packaging unit');
  }
  return { baseQuantity: qty * packaging.baseQuantity, packaging };
}

// Normalize a location descriptor into the ledger's location columns.
function resolveLocation(location) {
  if (!location || !location.type) {
    throw ApiError.badRequest('A stock location is required');
  }
  if (location.type === LOCATION.WAREHOUSE) {
    if (!location.warehouseId) throw ApiError.badRequest('warehouseId is required');
    return { locationType: LOCATION.WAREHOUSE, warehouseId: location.warehouseId, salesRepId: null };
  }
  if (location.type === LOCATION.SALES_REP) {
    if (!location.salesRepId) throw ApiError.badRequest('salesRepId is required');
    return { locationType: LOCATION.SALES_REP, warehouseId: null, salesRepId: location.salesRepId };
  }
  throw ApiError.badRequest(`Unknown location type: ${location.type}`);
}

// --- Balance reads (derived from the ledger) -------------------------------

// Authoritative on-hand balance for one product at one location.
async function getBalance(client, { productId, type, warehouseId, salesRepId }) {
  const where = { productId };
  if (type === LOCATION.WAREHOUSE) where.warehouseId = warehouseId;
  else where.salesRepId = salesRepId;

  const agg = await client.inventoryTransaction.aggregate({
    where,
    _sum: { baseQuantity: true },
  });
  return agg._sum.baseQuantity || 0;
}

// All (product, warehouse) balances derived from the ledger.
async function warehouseBalances(client, warehouseId) {
  const where = { warehouseId: warehouseId ? warehouseId : { not: null } };
  const rows = await client.inventoryTransaction.groupBy({
    by: ['productId', 'warehouseId'],
    where,
    _sum: { baseQuantity: true },
  });
  return rows.map((r) => ({
    productId: r.productId,
    warehouseId: r.warehouseId,
    baseQuantity: r._sum.baseQuantity || 0,
  }));
}

// All (product, rep) balances derived from the ledger.
async function repBalances(client, salesRepId) {
  const where = { salesRepId: salesRepId ? salesRepId : { not: null } };
  const rows = await client.inventoryTransaction.groupBy({
    by: ['productId', 'salesRepId'],
    where,
    _sum: { baseQuantity: true },
  });
  return rows.map((r) => ({
    productId: r.productId,
    salesRepId: r.salesRepId,
    baseQuantity: r._sum.baseQuantity || 0,
  }));
}

// Total base units on hand per product across ALL locations.
async function productOnHand(client) {
  const rows = await client.inventoryTransaction.groupBy({
    by: ['productId'],
    _sum: { baseQuantity: true },
  });
  const map = new Map();
  rows.forEach((r) => map.set(r.productId, r._sum.baseQuantity || 0));
  return map;
}

// Base units per product on the warehouse shelves only. The minimum-stock level is measured against
// this — the same figure the low/out-of-stock alerts read — because boxes issued to reps are not there
// to sell or issue from the store. (Reorder and Products counted the reps' boxes as on hand, so a
// product the alerts called LOW showed "OK" there; audit, 11 Nov 2026.)
async function warehouseOnHand(client) {
  const rows = await client.inventoryTransaction.groupBy({
    by: ['productId'],
    where: { warehouseId: { not: null } },
    _sum: { baseQuantity: true },
  });
  const map = new Map();
  rows.forEach((r) => map.set(r.productId, r._sum.baseQuantity || 0));
  return map;
}

// --- Availability guard ----------------------------------------------------

// Serialise stock leaving one place (audit #48, 11 Nov 2026): the availability check below reads the
// ledger and the movement is written after it, so two issues at the same instant could both see
// "5 left", both take 5 and leave -5. A transaction-scoped advisory lock on (product, place) makes the
// second one wait until the first has committed, then read the true balance. It is keyed on the
// place, not on a row, because the balance is summed from the ledger and a cache row may not exist.
// (No-op on a client without raw SQL, e.g. a unit-test stub.)
async function lockStock(client, productId, loc) {
  if (typeof client.$executeRaw !== 'function') return;
  const key = `stock:${productId}:${loc.locationType}:${loc.warehouseId || loc.salesRepId}`;
  // $executeRaw, not $queryRaw: pg_advisory_xact_lock returns `void`, which $queryRaw cannot read back
  // ("Failed to deserialize column of type 'void'") — that failed every stock movement for a few minutes
  // on 11 Nov 2026. executeRaw only needs the statement to run.
  await client.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
}

async function assertAvailable(client, { productId, location, requiredBase }) {
  const loc = resolveLocation(location);
  await lockStock(client, productId, loc);
  // getBalance reads `type`; resolveLocation says `locationType`. Passing it on keeps a warehouse
  // check to THAT warehouse (it summed every warehouse's rows — the same while there is only one).
  const balance = await getBalance(client, { productId, type: loc.locationType, warehouseId: loc.warehouseId, salesRepId: loc.salesRepId });
  if (balance < requiredBase) {
    const product = await client.product.findUnique({
      where: { id: productId },
      select: { name: true, baseUnitName: true },
    });
    const unit = product ? product.baseUnitName : 'units';
    throw ApiError.conflict(
      `Insufficient stock for ${product ? product.name : 'product'}: ` +
        `have ${balance} ${unit}, need ${requiredBase}`,
    );
  }
  return balance;
}

// --- Movement writes -------------------------------------------------------

// Append one ledger row and update the location's cached balance. MUST be
// called with a transaction client for the two writes to be atomic.
async function postMovement(client, entry) {
  const loc = resolveLocation(entry.location);
  const signedBase = entry.baseQuantity; // already signed by the caller

  const txn = await client.inventoryTransaction.create({
    data: {
      type: entry.type,
      productId: entry.productId,
      packagingUnitId: entry.packagingUnitId || null,
      quantity: entry.quantity ?? Math.abs(signedBase),
      baseQuantity: signedBase,
      unitCost: entry.unitCost != null ? entry.unitCost : 0,
      locationType: loc.locationType,
      warehouseId: loc.warehouseId,
      salesRepId: loc.salesRepId,
      counterpartyWarehouseId: entry.counterpartyWarehouseId || null,
      counterpartyRepId: entry.counterpartyRepId || null,
      referenceType: entry.referenceType || 'MANUAL',
      referenceId: entry.referenceId || null,
      userId: entry.userId || null,
      notes: entry.notes || null,
      occurredAt: entry.occurredAt || new Date(),
    },
  });

  // Keep the materialized cache in lock-step.
  if (loc.locationType === LOCATION.WAREHOUSE) {
    await client.warehouseStock.upsert({
      where: { productId_warehouseId: { productId: entry.productId, warehouseId: loc.warehouseId } },
      create: { productId: entry.productId, warehouseId: loc.warehouseId, baseQuantity: signedBase },
      update: { baseQuantity: { increment: signedBase } },
    });
  } else {
    await client.repStock.upsert({
      where: { productId_salesRepId: { productId: entry.productId, salesRepId: loc.salesRepId } },
      create: { productId: entry.productId, salesRepId: loc.salesRepId, baseQuantity: signedBase },
      update: { baseQuantity: { increment: signedBase } },
    });
  }

  return txn;
}

// Add stock to a location (positive movement).
async function increaseStock(client, opts) {
  if (!INBOUND_TYPES.has(opts.type) && opts.type !== 'ADJUSTMENT' && opts.type !== 'CORRECTION' && opts.type !== 'STOCK_COUNT') {
    throw ApiError.badRequest(`Type ${opts.type} is not an inbound movement`);
  }
  return postMovement(client, { ...opts, baseQuantity: Math.abs(opts.baseQuantity) });
}

// Remove stock from a location (negative movement) after an availability check.
async function decreaseStock(client, opts) {
  if (!OUTBOUND_TYPES.has(opts.type) && opts.type !== 'ADJUSTMENT' && opts.type !== 'CORRECTION' && opts.type !== 'STOCK_COUNT') {
    throw ApiError.badRequest(`Type ${opts.type} is not an outbound movement`);
  }
  const requiredBase = Math.abs(opts.baseQuantity);
  await assertAvailable(client, {
    productId: opts.productId,
    location: opts.location,
    requiredBase,
  });
  return postMovement(client, { ...opts, baseQuantity: -requiredBase });
}

// Move stock from one location to another as a balanced pair of ledger rows.
async function transferStock(client, opts) {
  const {
    productId,
    packagingUnitId,
    quantity,
    baseQuantity,
    from,
    to,
    outType = 'TRANSFER_OUT',
    inType = 'TRANSFER_IN',
    referenceType = 'STOCK_TRANSFER',
    referenceId,
    userId,
    unitCost,
    notes,
    occurredAt,
  } = opts;

  const fromLoc = resolveLocation(from);
  const toLoc = resolveLocation(to);

  const out = await decreaseStock(client, {
    productId,
    packagingUnitId,
    quantity,
    baseQuantity,
    type: outType,
    location: from,
    counterpartyWarehouseId: toLoc.warehouseId,
    counterpartyRepId: toLoc.salesRepId,
    referenceType,
    referenceId,
    userId,
    unitCost,
    notes,
    occurredAt,
  });

  const incoming = await increaseStock(client, {
    productId,
    packagingUnitId,
    quantity,
    baseQuantity,
    type: inType,
    location: to,
    counterpartyWarehouseId: fromLoc.warehouseId,
    counterpartyRepId: fromLoc.salesRepId,
    referenceType,
    referenceId,
    userId,
    unitCost,
    notes,
    occurredAt,
  });

  return { out, in: incoming };
}

// --- Valuation & reconciliation --------------------------------------------

// Inventory valuation derived from the ledger, priced at purchase cost.
async function valuation(client = prisma) {
  const [warehouseRows, repRows, products] = await Promise.all([
    warehouseBalances(client),
    repBalances(client),
    client.product.findMany({
      select: { id: true, name: true, sku: true, baseUnitName: true, purchasePrice: true, sellingPrice: true },
    }),
  ]);

  const productMap = new Map(products.map((p) => [p.id, p]));

  const perProduct = new Map();
  const add = (productId, base, scope) => {
    if (!productMap.has(productId)) return;
    const cur =
      perProduct.get(productId) || { warehouseBase: 0, repBase: 0, totalBase: 0 };
    cur[scope] += base;
    cur.totalBase += base;
    perProduct.set(productId, cur);
  };
  warehouseRows.forEach((r) => add(r.productId, r.baseQuantity, 'warehouseBase'));
  repRows.forEach((r) => add(r.productId, r.baseQuantity, 'repBase'));

  let warehouseValue = 0;
  let repValue = 0;
  const items = [];
  for (const [productId, b] of perProduct.entries()) {
    const p = productMap.get(productId);
    const cost = toNumber(p.purchasePrice);
    const whVal = round2(b.warehouseBase * cost);
    const repVal = round2(b.repBase * cost);
    warehouseValue += whVal;
    repValue += repVal;
    items.push({
      productId,
      name: p.name,
      sku: p.sku,
      baseUnitName: p.baseUnitName,
      warehouseBase: b.warehouseBase,
      repBase: b.repBase,
      totalBase: b.totalBase,
      unitCost: cost,
      sellingPrice: toNumber(p.sellingPrice),
      costValue: round2(b.totalBase * cost),
      retailValue: round2(b.totalBase * toNumber(p.sellingPrice)),
    });
  }

  items.sort((a, b) => b.costValue - a.costValue);

  return {
    totals: {
      warehouseValue: round2(warehouseValue),
      repValue: round2(repValue),
      totalValue: round2(warehouseValue + repValue),
      retailValue: round2(items.reduce((s, i) => s + i.retailValue, 0)),
      productCount: items.length,
      totalBaseUnits: items.reduce((s, i) => s + i.totalBase, 0),
    },
    items,
  };
}

// Recompute one cache row from the ledger (drift repair / maintenance).
async function recomputeCacheFor(client, { productId, type, warehouseId, salesRepId }) {
  const balance = await getBalance(client, { productId, type, warehouseId, salesRepId });
  if (type === LOCATION.WAREHOUSE) {
    await client.warehouseStock.upsert({
      where: { productId_warehouseId: { productId, warehouseId } },
      create: { productId, warehouseId, baseQuantity: balance },
      update: { baseQuantity: balance },
    });
  } else {
    await client.repStock.upsert({
      where: { productId_salesRepId: { productId, salesRepId } },
      create: { productId, salesRepId, baseQuantity: balance },
      update: { baseQuantity: balance },
    });
  }
  return balance;
}

// Rebuild every cache row from the ledger. Used by an admin maintenance route.
async function recomputeAllCaches(client = prisma) {
  const [whRows, repRows] = await Promise.all([warehouseBalances(client), repBalances(client)]);
  await client.$transaction([
    client.warehouseStock.updateMany({ data: { baseQuantity: 0 } }),
    client.repStock.updateMany({ data: { baseQuantity: 0 } }),
  ]);
  for (const r of whRows) {
    await client.warehouseStock.upsert({
      where: { productId_warehouseId: { productId: r.productId, warehouseId: r.warehouseId } },
      create: { productId: r.productId, warehouseId: r.warehouseId, baseQuantity: r.baseQuantity },
      update: { baseQuantity: r.baseQuantity },
    });
  }
  for (const r of repRows) {
    await client.repStock.upsert({
      where: { productId_salesRepId: { productId: r.productId, salesRepId: r.salesRepId } },
      create: { productId: r.productId, salesRepId: r.salesRepId, baseQuantity: r.baseQuantity },
      update: { baseQuantity: r.baseQuantity },
    });
  }
  return { warehouseRows: whRows.length, repRows: repRows.length };
}

module.exports = {
  LOCATION,
  INBOUND_TYPES,
  OUTBOUND_TYPES,
  convertToBase,
  resolveLocation,
  getBalance,
  warehouseBalances,
  repBalances,
  productOnHand,
  warehouseOnHand,
  assertAvailable,
  postMovement,
  increaseStock,
  decreaseStock,
  transferStock,
  valuation,
  recomputeCacheFor,
  recomputeAllCaches,
};
