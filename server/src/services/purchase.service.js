'use strict';

const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const inventory = require('./inventory.service');
const { nextDocNumber } = require('../utils/numbering');
const { toNumber, round2, formatCurrency } = require('../utils/money');
const env = require('../config/env');

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
// Remove a supplier. One with history — purchase orders, goods sent back, or balance payments — is
// switched off instead, so the money stays explained, and the answer says which happened (audit
// money-flows-8: it answered 200 either way, and a supplier with returns but no PO was deleted along
// with its returns).
async function removeSupplier(id) {
  const s = await prisma.supplier.findUnique({ where: { id } });
  if (!s) throw ApiError.notFound('Supplier not found');
  const [orders, credits, payments] = await Promise.all([
    prisma.purchaseOrder.count({ where: { supplierId: id } }),
    prisma.supplierCredit.count({ where: { supplierId: id } }),
    prisma.financeTransaction.count({ where: { refType: 'Supplier', refId: id } }),
  ]);
  if (orders + credits + payments > 0) {
    const updated = await prisma.supplier.update({ where: { id }, data: { isActive: false } });
    const n = (k, one, many) => `${k} ${k === 1 ? one : many}`;
    const history = [
      orders && n(orders, 'purchase order', 'purchase orders'),
      credits && n(credits, 'return', 'returns'),
      payments && n(payments, 'balance payment', 'balance payments'),
    ].filter(Boolean).join(', ');
    return {
      ...updated,
      deleted: false,
      deactivated: true,
      message: `${s.name} has ${history}, so it was switched off, not deleted. Its history stays; switch it back on in Edit supplier.`,
    };
  }
  await prisma.supplier.delete({ where: { id } });
  return { id, name: s.name, deleted: true, deactivated: false, message: `${s.name} deleted.` };
}

// --- Purchase orders -------------------------------------------------------

const PO_INCLUDE = {
  supplier: true,
  warehouse: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  items: { include: { product: { select: { id: true, name: true, sku: true, baseUnitName: true } }, packagingUnit: true } },
};

// Goods cannot be expected before they were ordered (a PO dated "ordered 20 Nov, arriving 1 Nov" was
// accepted; audit, 11 Nov 2026). Compared by calendar day, so the same day is fine whatever the time.
function assertArrivalNotBeforeOrder(orderedAt, expectedArrival) {
  if (!orderedAt || !expectedArrival) return;
  const day = (d) => new Date(d).toISOString().slice(0, 10);
  if (Number.isNaN(new Date(orderedAt).getTime()) || Number.isNaN(new Date(expectedArrival).getTime())) return;
  if (day(expectedArrival) < day(orderedAt)) {
    throw ApiError.badRequest('Expected arrival cannot be before the order date.');
  }
}

async function createPurchaseOrder(payload, actor) {
  if (!payload.items || payload.items.length === 0) {
    throw ApiError.badRequest('A purchase order needs at least one item');
  }
  assertArrivalNotBeforeOrder(payload.orderedAt, payload.expectedArrival);
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
        // Every figure on the form is in shillings (audit reversals-stock-8: a PO saved from Purchases was
        // labelled USD while Finance's were TZS).
        currency: payload.currency || env.business.currency || 'TZS',
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

    // Paid at the counter, not owed.
    //
    // A purchase used to be a debt and nothing else: the only way to say it
    // was paid was a separate payment afterwards, dated the day somebody
    // remembered. Stock bought with the cash in the drawer then sat under
    // "owed to suppliers" for weeks, and the money left the books in a month
    // it was never spent in. So the payment is part of the purchase, recorded
    // in the same transaction — both land, or neither does.
    const pay = payload.payment;
    if (pay && pay.accountId) {
      const amount = pay.amount != null ? round2(toNumber(pay.amount)) : totalCost;
      if (amount > 0) {
        if (amount > totalCost + 0.001) {
          throw ApiError.badRequest(
            `This purchase is ${formatCurrency(totalCost)} — a payment of ${formatCurrency(amount)} is more than it cost.`,
          );
        }
        const supplier = await tx.supplier.findUnique({ where: { id: payload.supplierId }, select: { name: true, brandId: true } });
        const finance = require('./finance.service'); // lazy: avoids an import cycle
        await finance.recordTransaction(
          {
            accountId: pay.accountId,
            direction: 'OUT',
            type: 'STOCK_PURCHASE',
            amount,
            brandId: supplier?.brandId || null,
            category: 'Stock Purchase',
            description: `${poNumber} — ${supplier?.name || 'supplier'}`,
            reference: poNumber,
            refType: 'PurchaseOrder',
            refId: po.id,
            notes: pay.notes || null,
            // The day the money actually moved: the payment's own date, or the
            // day the order was placed. Not the day it was typed in.
            occurredAt: pay.occurredAt || payload.orderedAt || undefined,
          },
          actor,
          tx,
        );
      }
    }

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

// Money paid against one order (PO-level payments only).
async function paidOnOrder(id) {
  const paid = await prisma.financeTransaction.aggregate({
    where: { refType: 'PurchaseOrder', refId: id, direction: 'OUT' },
    _sum: { amount: true },
  });
  return round2(toNumber(paid._sum.amount));
}

// An order cannot shrink below what was paid against it (audit reversals-stock-2): an edit from
// 50,000 down to 10,000 with 40,000 paid left the order, and the supplier, quietly overpaid.
function assertNotBelowPaid(paidOnThis, newTotal) {
  if (newTotal < paidOnThis - 0.001) {
    throw ApiError.badRequest(
      `${formatCurrency(paidOnThis)} has been paid against this order; the new total ${formatCurrency(newTotal)} is less. Correct the payment in Finance first.`,
    );
  }
}

// What the supplier would be owed once this order counts for `newTotal` instead of its total today
// (0 when it is deleted, cancelled or moved to another supplier), by the supplier window's own formula:
// orders − goods returned − every payment, on an order or on the balance. Refused when that goes below
// zero (audit reversals-stock-3): deleting an order after a balance payment left the supplier overpaid
// with nothing said, and the next payment was refused with "You only owe … TZS -10,000".
// `leaving` is true when the order and its own payments leave this supplier's books together.
async function assertSupplierNotOverpaid(po, newTotal, { leaving = false, action }) {
  if (po.status === 'CANCELLED' || !po.supplierId) return; // a cancelled order already counts nowhere
  const drop = round2(toNumber(po.totalCost) - newTotal);
  if (!(drop > 0)) return;
  const paidOnThis = leaving ? await paidOnOrder(po.id) : 0;
  const finance = require('./finance.service'); // lazy: avoids an import cycle
  const [{ supplier, totals }, balance] = await Promise.all([
    finance.supplierDetail(po.supplierId),
    prisma.financeTransaction.aggregate({
      where: { refType: 'Supplier', refId: po.supplierId, direction: 'OUT' },
      _sum: { amount: true },
    }),
  ]);
  const after = round2(totals.outstanding - drop + paidOnThis);
  if (after < -0.001) {
    const onBalance = round2(toNumber(balance._sum.amount));
    throw ApiError.badRequest(
      `${action} would leave ${supplier.name} overpaid by ${formatCurrency(-after)}: ${formatCurrency(totals.paid)} has been paid to them`
      + `${onBalance > 0 ? ` (${formatCurrency(onBalance)} of it on the balance)` : ''}. Correct that payment in Finance first.`,
    );
  }
}

async function updatePurchaseOrder(id, payload) {
  const po = await prisma.purchaseOrder.findUnique({ where: { id } });
  if (!po) throw ApiError.notFound('Purchase order not found');
  if (po.status === 'RECEIVED') throw ApiError.badRequest('A received purchase order cannot be edited');
  // Received is reached only by receiving (audit #40): marking it here left the order "received" with
  // no stock ever brought in, and Receive then refused it as already received.
  if (payload.status === 'RECEIVED') {
    throw ApiError.badRequest('Use Receive to mark it received — that is what brings the stock into the warehouse.');
  }

  // A PO with money already paid against it cannot simply be cancelled:
  // cancelling removes it from "purchased" AND its payments from "paid" at
  // once, so the supplier's outstanding balance quietly swallows real money.
  // The payments must be reversed (or moved to the supplier's balance) first.
  const cancelling = payload.status === 'CANCELLED' && po.status !== 'CANCELLED';
  if (cancelling) {
    const paid = await paidOnOrder(id);
    if (paid > 0) {
      throw ApiError.badRequest(
        `${formatCurrency(paid)} has been paid against this order. Delete or reassign those payments in Finance before cancelling, or the supplier balance would silently absorb them.`,
      );
    }
    // Balance payments are the supplier's, not this order's: cancelling must not leave him overpaid.
    await assertSupplierNotOverpaid(po, 0, { leaving: true, action: `Cancelling ${po.poNumber}` });
  }
  // Moving the order to another supplier takes it, and its own payments, off this supplier's books.
  if (!cancelling && payload.supplierId && payload.supplierId !== po.supplierId) {
    await assertSupplierNotOverpaid(po, 0, { leaving: true, action: `Moving ${po.poNumber} to another supplier` });
  }

  const data = {};
  ['status', 'currency', 'notes', 'warehouseId', 'supplierId'].forEach((f) => {
    if (payload[f] !== undefined) data[f] = payload[f];
  });
  ['orderedAt', 'expectedArrival'].forEach((f) => {
    if (payload[f] !== undefined) data[f] = payload[f] ? new Date(payload[f]) : null;
  });
  // Only when a date is being changed, checked against the stored one when just one is sent — an
  // edit of anything else on an older order is never refused for its dates.
  if (data.orderedAt !== undefined || data.expectedArrival !== undefined) {
    assertArrivalNotBeforeOrder(
      data.orderedAt !== undefined ? data.orderedAt : po.orderedAt,
      data.expectedArrival !== undefined ? data.expectedArrival : po.expectedArrival,
    );
  }
  ['shippingCost', 'clearingCost', 'otherCost'].forEach((f) => {
    if (payload[f] !== undefined) data[f] = round2(payload[f]);
  });
  if (data.shippingCost != null || data.clearingCost != null || data.otherCost != null) {
    const shipping = data.shippingCost ?? toNumber(po.shippingCost);
    const clearing = data.clearingCost ?? toNumber(po.clearingCost);
    const other = data.otherCost ?? toNumber(po.otherCost);
    data.totalCost = round2(toNumber(po.goodsCost) + shipping + clearing + other);
  }
  // A new total, from the costs above or from new lines below, is checked before anything is written.
  const checkNewTotal = async (newTotal) => {
    if (cancelling) return; // a cancel was checked above
    assertNotBelowPaid(await paidOnOrder(id), newTotal);
    // Only while the order stays with this supplier; a move was checked above.
    if (!payload.supplierId || payload.supplierId === po.supplierId) {
      await assertSupplierNotOverpaid(po, newTotal, { action: `Lowering ${po.poNumber} to ${formatCurrency(newTotal)}` });
    }
  };
  if (data.totalCost !== undefined && !payload.items) await checkNewTotal(data.totalCost);
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
      const totalCost = round2(goodsCost + shipping + clearing + other);
      await checkNewTotal(totalCost);
      await tx.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: id } });
      return tx.purchaseOrder.update({
        where: { id },
        data: {
          ...data,
          goodsCost,
          totalCost,
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
  const paid = await paidOnOrder(id);
  if (paid > 0) {
    throw ApiError.badRequest(
      `${formatCurrency(paid)} has been paid against this order. Remove those payments in Finance first, or the money would outlive its reason.`,
    );
  }
  // Balance payments are the supplier's, not this order's: deleting it must not leave him overpaid.
  await assertSupplierNotOverpaid(po, 0, { leaving: true, action: `Deleting ${po.poNumber}` });
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
    // 409, like the claim below: a retry after a lost answer finds it received, and the screens treat
    // that as done instead of saying it is not received yet (audit reversals-stock-5).
    if (po.status === 'RECEIVED') throw ApiError.conflict('This purchase order was already received.');
    if (po.status === 'CANCELLED') throw ApiError.badRequest('Cancelled purchase order cannot be received');
    if (po.items.length === 0) throw ApiError.badRequest('Purchase order has no items');
    // Claim it before any stock moves (audit #41): two clicks on Receive used to both pass the check
    // above and both bring the stock in. The second one now waits for the first, finds it received,
    // and stops here with nothing written.
    const claimed = await tx.purchaseOrder.updateMany({
      where: { id, status: { notIn: ['RECEIVED', 'CANCELLED'] } },
      data: { status: 'RECEIVED' },
    });
    if (claimed.count !== 1) throw ApiError.conflict('This purchase order was already received.');

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
