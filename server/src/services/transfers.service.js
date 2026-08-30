'use strict';

const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const inventory = require('./inventory.service');
const settlement = require('./settlement.service');
const { nextDocNumber } = require('../utils/numbering');
const { toNumber } = require('../utils/money');

const TRANSFER_INCLUDE = {
  items: { include: { product: true, packagingUnit: true } },
  fromWarehouse: true,
  toWarehouse: true,
  fromRep: { include: { user: { select: { name: true } } } },
  toRep: { include: { user: { select: { name: true } } } },
  dispatchedBy: { select: { id: true, name: true } },
};

// Validate the from/to endpoints implied by a transfer direction and return
// inventory-service location descriptors for each side.
function resolveEndpoints(payload) {
  const { direction, fromWarehouseId, fromRepId, toWarehouseId, toRepId } = payload;
  const W = inventory.LOCATION.WAREHOUSE;
  const R = inventory.LOCATION.SALES_REP;

  switch (direction) {
    case 'WAREHOUSE_TO_REP':
      if (!fromWarehouseId || !toRepId) {
        throw ApiError.badRequest('WAREHOUSE_TO_REP requires fromWarehouseId and toRepId');
      }
      return { from: { type: W, warehouseId: fromWarehouseId }, to: { type: R, salesRepId: toRepId } };
    case 'REP_TO_WAREHOUSE':
      if (!fromRepId || !toWarehouseId) {
        throw ApiError.badRequest('REP_TO_WAREHOUSE requires fromRepId and toWarehouseId');
      }
      return { from: { type: R, salesRepId: fromRepId }, to: { type: W, warehouseId: toWarehouseId } };
    case 'WAREHOUSE_TO_WAREHOUSE':
      if (!fromWarehouseId || !toWarehouseId) {
        throw ApiError.badRequest('WAREHOUSE_TO_WAREHOUSE requires fromWarehouseId and toWarehouseId');
      }
      if (fromWarehouseId === toWarehouseId) {
        throw ApiError.badRequest('Source and destination warehouses must differ');
      }
      return {
        from: { type: W, warehouseId: fromWarehouseId },
        to: { type: W, warehouseId: toWarehouseId },
      };
    default:
      throw ApiError.badRequest(`Unknown transfer direction: ${direction}`);
  }
}

async function createTransfer(payload, actor) {
  const { items } = payload;
  if (!items || items.length === 0) {
    throw ApiError.badRequest('A transfer must contain at least one item');
  }
  const { from, to } = resolveEndpoints(payload);

  return prisma.$transaction(
    async (tx) => {
      const productIds = [...new Set(items.map((i) => i.productId))];
      const products = await tx.product.findMany({ where: { id: { in: productIds } } });
      const productMap = new Map(products.map((p) => [p.id, p]));
      if (productMap.size !== productIds.length) {
        throw ApiError.badRequest('One or more products were not found');
      }

      // Resolve base quantities per line.
      const lines = [];
      for (const input of items) {
        const { baseQuantity } = await inventory.convertToBase(
          tx,
          input.productId,
          input.packagingUnitId,
          input.quantity,
        );
        lines.push({
          productId: input.productId,
          packagingUnitId: input.packagingUnitId,
          quantity: input.quantity,
          baseQuantity,
          unitCost: toNumber(productMap.get(input.productId).purchasePrice),
        });
      }

      const transferNumber = await nextDocNumber(tx.stockTransfer, 'transferNumber', 'TRF');

      const transfer = await tx.stockTransfer.create({
        data: {
          transferNumber,
          direction: payload.direction,
          status: 'COMPLETED',
          fromWarehouseId: payload.fromWarehouseId || null,
          fromRepId: payload.fromRepId || null,
          toWarehouseId: payload.toWarehouseId || null,
          toRepId: payload.toRepId || null,
          notes: payload.notes || null,
          dispatchedAt: payload.dispatchedAt ? new Date(payload.dispatchedAt) : new Date(),
          dispatchedById: actor ? actor.id : null,
          items: {
            create: lines.map((l) => ({
              productId: l.productId,
              packagingUnitId: l.packagingUnitId,
              quantity: l.quantity,
              baseQuantity: l.baseQuantity,
            })),
          },
        },
      });

      for (const l of lines) {
        await inventory.transferStock(tx, {
          productId: l.productId,
          packagingUnitId: l.packagingUnitId,
          quantity: l.quantity,
          baseQuantity: l.baseQuantity,
          from,
          to,
          referenceType: 'STOCK_TRANSFER',
          referenceId: transfer.id,
          userId: actor ? actor.id : null,
          unitCost: l.unitCost,
          notes: `Transfer ${transferNumber}`,
          occurredAt: transfer.dispatchedAt,
        });
      }

      // Assigning stock to a rep opens a 72-hour settlement cycle.
      if (payload.direction === 'WAREHOUSE_TO_REP' && payload.toRepId) {
        const assignedValue = lines.reduce(
          (acc, l) => acc + l.baseQuantity * toNumber(productMap.get(l.productId).sellingPrice),
          0,
        );
        await settlement.createForIssuance(tx, {
          salesRepId: payload.toRepId,
          assignedValue,
          transferId: transfer.id,
          issuedAt: transfer.dispatchedAt,
        });
      }

      return tx.stockTransfer.findUnique({ where: { id: transfer.id }, include: TRANSFER_INCLUDE });
    },
    { timeout: 30000 },
  );
}

async function listTransfers(filters, pagination) {
  const where = {};
  if (filters.direction) where.direction = filters.direction;
  if (filters.status) where.status = filters.status;
  if (filters.fromWarehouseId) where.fromWarehouseId = filters.fromWarehouseId;
  if (filters.toRepId) where.toRepId = filters.toRepId;
  if (filters.from || filters.to) {
    where.dispatchedAt = {};
    if (filters.from) where.dispatchedAt.gte = new Date(filters.from);
    if (filters.to) where.dispatchedAt.lte = new Date(filters.to);
  }

  const [items, total] = await Promise.all([
    prisma.stockTransfer.findMany({
      where,
      include: TRANSFER_INCLUDE,
      skip: pagination.skip,
      take: pagination.take,
      orderBy: pagination.orderBy,
    }),
    prisma.stockTransfer.count({ where }),
  ]);

  // Boxes, not "2 items". A transfer is a movement of stock; the number of
  // product lines on it says nothing about how much moved. Each row carries
  // its box count, and the summary totals every matching transfer — not the
  // page — with who received the most, since that is the question a list of
  // movements provokes.
  const withBoxes = items.map((t) => ({
    ...t,
    boxes: (t.items || []).reduce((n, i) => n + (i.baseQuantity || 0), 0),
  }));

  const all = await prisma.stockTransfer.findMany({
    where,
    select: {
      status: true,
      dispatchedAt: true,
      toRep: { select: { user: { select: { name: true } } } },
      toWarehouse: { select: { name: true } },
      items: { select: { baseQuantity: true } },
    },
    orderBy: { dispatchedAt: 'asc' },
  });
  const byDestination = new Map();
  let boxes = 0;
  let completed = 0;
  let cancelled = 0;
  for (const t of all) {
    const n = t.items.reduce((a, i) => a + (i.baseQuantity || 0), 0);
    if (t.status === 'CANCELLED') { cancelled += 1; continue; }
    completed += 1;
    boxes += n;
    const name = t.toRep?.user?.name || t.toWarehouse?.name || 'Unknown';
    byDestination.set(name, (byDestination.get(name) || 0) + n);
  }
  const destinations = [...byDestination.entries()]
    .map(([name, n]) => ({ name, boxes: n }))
    .sort((a, b) => b.boxes - a.boxes);

  const summary = {
    boxes,
    movements: completed,
    cancelled,
    destinations,
    firstAt: all[0]?.dispatchedAt || null,
    lastAt: all[all.length - 1]?.dispatchedAt || null,
  };

  return { items: withBoxes, total, summary };
}

async function getTransfer(id) {
  const transfer = await prisma.stockTransfer.findUnique({ where: { id }, include: TRANSFER_INCLUDE });
  if (!transfer) throw ApiError.notFound('Transfer not found');
  return transfer;
}

// Reverse a completed transfer, returning stock to the source.
async function cancelTransfer(id, actor, reason) {
  return prisma.$transaction(async (tx) => {
    const transfer = await tx.stockTransfer.findUnique({ where: { id }, include: { items: true } });
    if (!transfer) throw ApiError.notFound('Transfer not found');
    if (transfer.status === 'CANCELLED') throw ApiError.badRequest('Transfer already cancelled');

    const { from, to } = resolveEndpoints(transfer);
    // Reverse: move from -> back is to -> from.
    for (const item of transfer.items) {
      await inventory.transferStock(tx, {
        productId: item.productId,
        packagingUnitId: item.packagingUnitId,
        quantity: item.quantity,
        baseQuantity: item.baseQuantity,
        from: to,
        to: from,
        outType: 'CORRECTION',
        inType: 'CORRECTION',
        referenceType: 'STOCK_TRANSFER',
        referenceId: transfer.id,
        userId: actor ? actor.id : null,
        notes: `Reversal of transfer ${transfer.transferNumber}${reason ? ` — ${reason}` : ''}`,
      });
    }

    return tx.stockTransfer.update({
      where: { id },
      data: { status: 'CANCELLED', notes: reason ? `${transfer.notes || ''}\nCancelled: ${reason}`.trim() : transfer.notes },
      include: TRANSFER_INCLUDE,
    });
  });
}

module.exports = { createTransfer, listTransfers, getTransfer, cancelTransfer, TRANSFER_INCLUDE };
