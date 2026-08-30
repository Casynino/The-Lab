'use strict';

const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const inventory = require('./inventory.service');
const { nextDocNumber } = require('../utils/numbering');
const { toNumber, round2, formatCurrency } = require('../utils/money');

// --- Suppliers -------------------------------------------------------------

async function listSuppliers(filters, pagination) {
  const where = {};
  if (filters.isActive !== undefined) where.isActive = filters.isActive;
  if (filters.search) where.name = { contains: filters.search, mode: 'insensitive' };
  const [items, total] = await Promise.all([
    prisma.supplier.findMany({ where, include: { _count: { select: { purchaseOrders: true } } }, skip: pagination.skip, take: pagination.take, orderBy: pagination.orderBy }),
    prisma.supplier.count({ where }),
  ]);
  return { items, total };
}

async function createSupplier(data) {
  return prisma.supplier.create({ data });
}
async function updateSupplier(id, data) {
  const s = await prisma.supplier.findUnique({ where: { id } });
  if (!s) throw ApiError.notFound('Supplier not found');
  return prisma.supplier.update({ where: { id }, data });
}
async function removeSupplier(id) {
  const count = await prisma.purchaseOrder.count({ where: { supplierId: id } });
  if (count > 0) return prisma.supplier.update({ where: { id }, data: { isActive: false } });
  await prisma.supplier.delete({ where: { id } });
  return { id, deleted: true };
}

// --- Purchase orders -------------------------------------------------------

const PO_INCLUDE = {
  supplier: true,
  warehouse: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  items: { include: { product: { select: { id: true, name: true, sku: true, baseUnitName: true } }, packagingUnit: true } },
};

async function createPurchaseOrder(payload, actor) {
  if (!payload.items || payload.items.length === 0) {
    throw ApiError.badRequest('A purchase order needs at least one item');
  }
  return prisma.$transaction(async (tx) => {
    const lines = [];
    for (const i of payload.items) {
      const { baseQuantity } = await inventory.convertToBase(tx, i.productId, i.packagingUnitId, i.quantity);
      lines.push({
        productId: i.productId,
        packagingUnitId: i.packagingUnitId,
        quantity: i.quantity,
        baseQuantity,
        unitCost: round2(i.unitCost || 0), // goods cost per base unit
      });
    }
    const goodsCost = round2(lines.reduce((s, l) => s + l.unitCost * l.baseQuantity, 0));
    const shippingCost = round2(payload.shippingCost || 0);
    const clearingCost = round2(payload.clearingCost || 0);
    const otherCost = round2(payload.otherCost || 0);
    const totalCost = round2(goodsCost + shippingCost + clearingCost + otherCost);

    const poNumber = await nextDocNumber(tx.purchaseOrder, 'poNumber', 'PO');
    const po = await tx.purchaseOrder.create({
      data: {
        poNumber,
        supplierId: payload.supplierId,
        status: payload.orderedAt ? 'ORDERED' : 'DRAFT',
        currency: payload.currency || 'USD',
        goodsCost,
        shippingCost,
        clearingCost,
        otherCost,
        totalCost,
        warehouseId: payload.warehouseId || null,
        orderedAt: payload.orderedAt ? new Date(payload.orderedAt) : null,
        expectedArrival: payload.expectedArrival ? new Date(payload.expectedArrival) : null,
        notes: payload.notes || null,
        createdById: actor ? actor.id : null,
        items: { create: lines },
      },
    });
    return tx.purchaseOrder.findUnique({ where: { id: po.id }, include: PO_INCLUDE });
  });
}

async function listPurchaseOrders(filters, pagination) {
  const where = {};
  if (filters.status) where.status = filters.status;
  if (filters.supplierId) where.supplierId = filters.supplierId;
  const [items, total, incoming] = await Promise.all([
    prisma.purchaseOrder.findMany({ where, include: PO_INCLUDE, skip: pagination.skip, take: pagination.take, orderBy: pagination.orderBy }),
    prisma.purchaseOrder.count({ where }),
    // Stock that is bought but has not landed: ordered or in transit, never
    // received or cancelled. It is real — it is paid for or owed for — but it
    // is not inventory yet, so it belongs in its own count rather than
    // silently missing from the page until the day it arrives.
    prisma.purchaseOrder.findMany({
      where: { status: { in: ['DRAFT', 'ORDERED', 'IN_TRANSIT'] } },
      include: { items: true, supplier: { select: { name: true } } },
      orderBy: { expectedArrival: 'asc' },
    }),
  ]);

  const boxesOf = (po) => (po.items || []).reduce((n, it) => n + (it.baseQuantity || 0), 0);
  const withBoxes = items.map((po) => ({ ...po, boxes: boxesOf(po) }));
  const onTheWay = {
    orders: incoming.length,
    boxes: incoming.reduce((n, po) => n + boxesOf(po), 0),
    value: round2(incoming.reduce((n, po) => n + toNumber(po.totalCost), 0)),
    nextArrival: incoming.find((po) => po.expectedArrival)?.expectedArrival || null,
    orders_: incoming.map((po) => ({
      id: po.id,
      poNumber: po.poNumber,
      supplier: po.supplier?.name || null,
      status: po.status,
      boxes: boxesOf(po),
      totalCost: round2(toNumber(po.totalCost)),
      expectedArrival: po.expectedArrival,
    })),
  };
  return { items: withBoxes, total, onTheWay };
}

async function getPurchaseOrder(id) {
  const po = await prisma.purchaseOrder.findUnique({ where: { id }, include: PO_INCLUDE });
  if (!po) throw ApiError.notFound('Purchase order not found');
  return po;
}

async function updatePurchaseOrder(id, payload) {
  const po = await prisma.purchaseOrder.findUnique({ where: { id } });
  if (!po) throw ApiError.notFound('Purchase order not found');
  if (po.status === 'RECEIVED') throw ApiError.badRequest('A received purchase order cannot be edited');

  // A PO with money already paid against it cannot simply be cancelled:
  // cancelling removes it from "purchased" AND its payments from "paid" at
  // once, so the supplier's outstanding balance quietly swallows real money.
  // The payments must be reversed (or moved to the supplier's balance) first.
  if (payload.status === 'CANCELLED') {
    const paid = await prisma.financeTransaction.aggregate({
      where: { refType: 'PurchaseOrder', refId: id, direction: 'OUT' },
      _sum: { amount: true },
    });
    if (toNumber(paid._sum.amount) > 0) {
      throw ApiError.badRequest(
        `${formatCurrency(toNumber(paid._sum.amount))} has been paid against this order. Delete or reassign those payments in Finance before cancelling, or the supplier balance would silently absorb them.`,
      );
    }
  }

  const data = {};
  ['status', 'currency', 'notes', 'warehouseId', 'supplierId'].forEach((f) => {
    if (payload[f] !== undefined) data[f] = payload[f];
  });
  ['orderedAt', 'expectedArrival'].forEach((f) => {
    if (payload[f] !== undefined) data[f] = payload[f] ? new Date(payload[f]) : null;
  });
  ['shippingCost', 'clearingCost', 'otherCost'].forEach((f) => {
    if (payload[f] !== undefined) data[f] = round2(payload[f]);
  });
  if (data.shippingCost != null || data.clearingCost != null || data.otherCost != null) {
    const shipping = data.shippingCost ?? toNumber(po.shippingCost);
    const clearing = data.clearingCost ?? toNumber(po.clearingCost);
    const other = data.otherCost ?? toNumber(po.otherCost);
    data.totalCost = round2(toNumber(po.goodsCost) + shipping + clearing + other);
  }
  // Correcting the lines while the order has not landed: replace them
  // wholesale and reprice, the same way the order was costed when created. A
  // received order never reaches here — it is refused above, because its
  // boxes are already on the shelf at a cost derived from these lines.
  if (payload.items) {
    return prisma.$transaction(async (tx) => {
      const lines = [];
      for (const i of payload.items) {
        const { baseQuantity } = await inventory.convertToBase(tx, i.productId, i.packagingUnitId, i.quantity);
        // Same shape createPurchaseOrder writes — there is no lineTotal column
        // on a purchase line; the goods total is derived from unitCost x
        // baseQuantity, exactly as it is on create.
        lines.push({
          productId: i.productId,
          packagingUnitId: i.packagingUnitId,
          quantity: i.quantity,
          baseQuantity,
          unitCost: round2(i.unitCost || 0),
        });
      }
      const goodsCost = round2(lines.reduce((sum, l) => sum + l.unitCost * l.baseQuantity, 0));
      const shipping = data.shippingCost ?? toNumber(po.shippingCost);
      const clearing = data.clearingCost ?? toNumber(po.clearingCost);
      const other = data.otherCost ?? toNumber(po.otherCost);
      await tx.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: id } });
      return tx.purchaseOrder.update({
        where: { id },
        data: {
          ...data,
          goodsCost,
          totalCost: round2(goodsCost + shipping + clearing + other),
          items: { create: lines },
        },
        include: PO_INCLUDE,
      });
    });
  }

  return prisma.purchaseOrder.update({ where: { id }, data, include: PO_INCLUDE });
}

// Delete a purchase order outright. Only ever safe before it lands: once
// received its boxes are on the shelf and its cost is inside every profit
// figure, so removing the order would strand the stock with no origin. Money
// paid against it blocks deletion too — the payment would survive its reason.
async function deletePurchaseOrder(id) {
  const po = await prisma.purchaseOrder.findUnique({ where: { id } });
  if (!po) throw ApiError.notFound('Purchase order not found');
  if (po.status === 'RECEIVED') {
    throw ApiError.badRequest('This order has already been received — its boxes are in the warehouse. Adjust the stock instead of deleting the order it came from.');
  }
  const paid = await prisma.financeTransaction.aggregate({
    where: { refType: 'PurchaseOrder', refId: id, direction: 'OUT' },
    _sum: { amount: true },
  });
  if (toNumber(paid._sum.amount) > 0) {
    throw ApiError.badRequest(
      `${formatCurrency(toNumber(paid._sum.amount))} has been paid against this order. Remove those payments in Finance first, or the money would outlive its reason.`,
    );
  }
  await prisma.purchaseOrder.delete({ where: { id } });
  return po;
}

// Receive a PO into the warehouse: allocate shipping/clearing/other across
// lines (by goods value) to get a landed unit cost, post PURCHASE_RECEIPT
// ledger entries, and update each product's cost to the latest landed cost.
// `stockAlreadyCounted` receives the PO as documentation of stock that is
// ALREADY in the system (e.g. attributing existing inventory to its supplier):
// the purchase + supplier debt are recorded, but no stock moves and the
// product cost basis is left untouched.
async function receivePurchaseOrder(id, actor, { actualArrival, stockAlreadyCounted } = {}) {
  return prisma.$transaction(async (tx) => {
    const po = await tx.purchaseOrder.findUnique({ where: { id }, include: { items: true } });
    if (!po) throw ApiError.notFound('Purchase order not found');
    if (po.status === 'RECEIVED') throw ApiError.badRequest('Purchase order already received');
    if (po.status === 'CANCELLED') throw ApiError.badRequest('Cancelled purchase order cannot be received');
    if (po.items.length === 0) throw ApiError.badRequest('Purchase order has no items');

    let warehouseId = po.warehouseId;
    if (!warehouseId) {
      const wh = await tx.warehouse.findFirst({ where: { isActive: true }, orderBy: { isPrimary: 'desc' } });
      if (!wh) throw ApiError.badRequest('No warehouse to receive into');
      warehouseId = wh.id;
    }

    const extraCost = toNumber(po.shippingCost) + toNumber(po.clearingCost) + toNumber(po.otherCost);
    const goodsTotal = po.items.reduce((s, it) => s + toNumber(it.unitCost) * it.baseQuantity, 0);
    const baseTotal = po.items.reduce((s, it) => s + it.baseQuantity, 0);

    for (const it of po.items) {
      const lineGoods = toNumber(it.unitCost) * it.baseQuantity;
      // Allocate extra by goods value, or by quantity if goods value is zero.
      const share = goodsTotal > 0 ? lineGoods / goodsTotal : baseTotal > 0 ? it.baseQuantity / baseTotal : 0;
      const allocated = extraCost * share;
      const landedUnitCost = round2(toNumber(it.unitCost) + (it.baseQuantity > 0 ? allocated / it.baseQuantity : 0));

      if (!stockAlreadyCounted) {
        await inventory.increaseStock(tx, {
          productId: it.productId,
          packagingUnitId: it.packagingUnitId,
          quantity: it.quantity,
          baseQuantity: it.baseQuantity,
          type: 'PURCHASE_RECEIPT',
          location: { type: inventory.LOCATION.WAREHOUSE, warehouseId },
          unitCost: landedUnitCost,
          referenceType: 'PURCHASE',
          referenceId: po.id,
          userId: actor ? actor.id : null,
          notes: `Received PO ${po.poNumber}`,
        });
      }

      await tx.purchaseOrderItem.update({ where: { id: it.id }, data: { landedUnitCost } });
      if (!stockAlreadyCounted) {
        // Latest landed cost becomes the product's current cost basis.
        await tx.product.update({ where: { id: it.productId }, data: { purchasePrice: landedUnitCost } });
      }
    }

    return tx.purchaseOrder.update({
      where: { id },
      data: {
        status: 'RECEIVED',
        warehouseId,
        receivedAt: new Date(),
        actualArrival: actualArrival ? new Date(actualArrival) : new Date(),
      },
      include: PO_INCLUDE,
    });
  });
}

module.exports = {
  listSuppliers,
  createSupplier,
  updateSupplier,
  removeSupplier,
  createPurchaseOrder,
  listPurchaseOrders,
  getPurchaseOrder,
  updatePurchaseOrder,
  deletePurchaseOrder,
  receivePurchaseOrder,
  PO_INCLUDE,
};
