'use strict';

const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const inventory = require('./inventory.service');
const settlement = require('./settlement.service');
const notification = require('./notification.service');
const { nextDocNumber } = require('../utils/numbering');
const { toNumber } = require('../utils/money');

const RETURN_INCLUDE = {
  items: { include: { product: { include: { brand: { select: { name: true } } } }, packagingUnit: true } },
  customer: true,
  salesRep: { include: { user: { select: { id: true, name: true } } } },
  warehouse: true,
  processedBy: { select: { id: true, name: true } },
  decidedBy: { select: { id: true, name: true } },
};

// ── Shared validation helpers ────────────────────────────────────────────────

// Validate that the items being returned are legal for a settlement-linked
// return: the products must have been issued on that order and the quantities
// must not exceed what is still outstanding (issued − settled − returned).
// `client` is either prisma or a transaction client.
async function validateSettlementLines(client, settlementId, salesRepId, lines, productMap) {
  const stl = await client.settlement.findUnique({
    where: { id: settlementId },
    select: { status: true, transferId: true, salesRepId: true, settlementNumber: true },
  });
  if (!stl) throw ApiError.badRequest('The order for this return was not found');
  if (stl.status === 'SETTLED') throw ApiError.badRequest('This order is already closed');
  if (salesRepId && stl.salesRepId !== salesRepId) {
    throw ApiError.badRequest("This return does not belong to the order's sales rep");
  }

  const transfer = stl.transferId
    ? await client.stockTransfer.findUnique({ where: { id: stl.transferId }, include: { items: true } })
    : null;
  const issuedMap = new Map();
  (transfer?.items || []).forEach((it) => issuedMap.set(it.productId, (issuedMap.get(it.productId) || 0) + it.baseQuantity));

  const [settledRows, retRows, pendingRows] = await Promise.all([
    client.saleItem.groupBy({ by: ['productId'], where: { sale: { settlementId, status: { not: 'CANCELLED' } } }, _sum: { baseQuantity: true } }),
    client.returnItem.groupBy({ by: ['productId'], where: { return: { settlementId, status: { in: ['APPROVED', 'COMPLETED'] } } }, _sum: { baseQuantity: true } }),
    // Boxes already inside a PENDING return are LOCKED — the same box can
    // never sit in two return requests at once.
    client.returnItem.groupBy({ by: ['productId'], where: { return: { settlementId, status: 'PENDING' } }, _sum: { baseQuantity: true } }),
  ]);
  const settledMap = new Map(settledRows.map((r) => [r.productId, r._sum.baseQuantity || 0]));
  const retMap = new Map(retRows.map((r) => [r.productId, r._sum.baseQuantity || 0]));
  const pendingMap = new Map(pendingRows.map((r) => [r.productId, r._sum.baseQuantity || 0]));

  for (const l of lines) {
    const name = productMap.get(l.productId)?.name || 'This product';
    const issued = issuedMap.get(l.productId) || 0;
    if (issued === 0) {
      throw ApiError.badRequest(`${name} was not issued on order ${stl.settlementNumber} — it can't be returned here`);
    }
    const pending = pendingMap.get(l.productId) || 0;
    const remaining = issued - (settledMap.get(l.productId) || 0) - (retMap.get(l.productId) || 0) - pending;
    if (l.baseQuantity > remaining) {
      throw ApiError.badRequest(
        pending > 0
          ? `Only ${Math.max(0, remaining)} box(es) of ${name} can still be returned on order ${stl.settlementNumber} — ${pending} box(es) are locked in a pending return.`
          : `Only ${Math.max(0, remaining)} box(es) of ${name} remain to return on order ${stl.settlementNumber}`,
      );
    }
  }
}

// For a rep's unlinked return: how many base units of each product are still
// unaccounted (issued − settled − approved returns − pending returns) on each
// of their open orders, oldest order first.
async function openOrderAvailability(client, salesRepId) {
  const open = await client.settlement.findMany({
    where: { salesRepId, status: { in: ['OPEN', 'PARTIAL', 'OVERDUE'] } },
    orderBy: { issuedAt: 'asc' },
    select: { id: true, settlementNumber: true, transferId: true },
  });
  const result = [];
  for (const stl of open) {
    const transfer = stl.transferId
      ? await client.stockTransfer.findUnique({ where: { id: stl.transferId }, include: { items: true } })
      : null;
    const avail = new Map();
    (transfer?.items || []).forEach((it) => avail.set(it.productId, (avail.get(it.productId) || 0) + it.baseQuantity));
    const [settledRows, retRows] = await Promise.all([
      client.saleItem.groupBy({ by: ['productId'], where: { sale: { settlementId: stl.id, status: { not: 'CANCELLED' } } }, _sum: { baseQuantity: true } }),
      client.returnItem.groupBy({ by: ['productId'], where: { return: { settlementId: stl.id, status: { in: ['APPROVED', 'COMPLETED', 'PENDING'] } } }, _sum: { baseQuantity: true } }),
    ]);
    settledRows.forEach((r) => avail.set(r.productId, (avail.get(r.productId) || 0) - (r._sum.baseQuantity || 0)));
    retRows.forEach((r) => avail.set(r.productId, (avail.get(r.productId) || 0) - (r._sum.baseQuantity || 0)));
    result.push({ settlementId: stl.id, settlementNumber: stl.settlementNumber, avail });
  }
  return result;
}

// ── Create (PENDING — no inventory moves yet) ─────────────────────────────────

async function createReturn(payload, actor) {
  const { type, customerId, salesRepId, settlementId, warehouseId, items, reason, notes, processedAt } = payload;

  if (!items || items.length === 0) {
    throw ApiError.badRequest('A return must contain at least one item');
  }
  if (type === 'CUSTOMER_RETURN' && !salesRepId && !warehouseId) {
    throw ApiError.badRequest('A customer return needs a destination: salesRepId or warehouseId');
  }
  let destWarehouseId = warehouseId;
  if (type === 'SALES_RETURN' && !destWarehouseId) {
    const wh = await prisma.warehouse.findFirst({ where: { isActive: true }, orderBy: { isPrimary: 'desc' } });
    destWarehouseId = wh?.id || null;
  }
  if (type === 'SALES_RETURN' && (!salesRepId || !destWarehouseId)) {
    throw ApiError.badRequest('A sales return needs both salesRepId (from) and warehouseId (to)');
  }

  const result = await prisma.$transaction(async (tx) => {
    const productIds = [...new Set(items.map((i) => i.productId))];
    const products = await tx.product.findMany({ where: { id: { in: productIds } } });
    const productMap = new Map(products.map((p) => [p.id, p]));
    if (productMap.size !== productIds.length) {
      throw ApiError.badRequest('One or more products were not found');
    }

    const lines = [];
    for (const input of items) {
      const { baseQuantity } = await inventory.convertToBase(tx, input.productId, input.packagingUnitId, input.quantity);
      const product = productMap.get(input.productId);
      lines.push({
        productId: input.productId,
        packagingUnitId: input.packagingUnitId,
        quantity: input.quantity,
        baseQuantity,
        condition: input.condition || 'GOOD',
        unitPrice: toNumber(product.sellingPrice),
        unitCost: toNumber(product.purchasePrice),
      });
    }

    // Validate settlement-linked returns (quantities + ownership).
    if (settlementId) {
      await validateSettlementLines(tx, settlementId, salesRepId, lines, productMap);
    }

    const makeReturn = async (stlId, stlLines, extraNote) => {
      const returnNumber = await nextDocNumber(tx.return, 'returnNumber', 'RET');
      return tx.return.create({
        data: {
          returnNumber,
          type,
          status: 'PENDING',
          customerId: customerId || null,
          salesRepId: salesRepId || null,
          settlementId: stlId || null,
          warehouseId: destWarehouseId || warehouseId || null,
          reason: reason || null,
          notes: [notes, extraNote].filter(Boolean).join(' ') || null,
          processedAt: processedAt ? new Date(processedAt) : new Date(),
          processedById: actor ? actor.id : null,
          items: {
            create: stlLines.map((l) => ({
              productId: l.productId,
              packagingUnitId: l.packagingUnitId,
              quantity: l.quantity,
              baseQuantity: l.baseQuantity,
              condition: l.condition,
              unitPrice: l.unitPrice,
            })),
          },
        },
        include: RETURN_INCLUDE,
      });
    };

    // A rep return that arrives WITHOUT an order link must still hit the
    // rep's open orders — otherwise the boxes keep showing (and getting
    // fined) on the order while the stock quietly moves. Allocate every
    // line to the open orders oldest-first, splitting across orders when
    // needed; boxes that aren't on any open order are refused.
    if (type === 'SALES_RETURN' && salesRepId && !settlementId) {
      const orders = await openOrderAvailability(tx, salesRepId);
      const buckets = new Map(); // settlementId -> lines
      for (const l of lines) {
        const perUnit = l.quantity > 0 ? l.baseQuantity / l.quantity : 1;
        let leftBase = l.baseQuantity;
        for (const o of orders) {
          if (leftBase <= 0) break;
          const can = Math.min(leftBase, Math.max(0, o.avail.get(l.productId) || 0));
          // allocate whole packaging units only
          const units = Math.floor(can / perUnit);
          if (units <= 0) continue;
          const takeBase = units * perUnit;
          o.avail.set(l.productId, (o.avail.get(l.productId) || 0) - takeBase);
          const list = buckets.get(o.settlementId) || [];
          list.push({ ...l, quantity: units, baseQuantity: takeBase });
          buckets.set(o.settlementId, list);
          leftBase -= takeBase;
        }
        if (leftBase > 0) {
          const name = productMap.get(l.productId)?.name || 'This product';
          const onOrders = l.baseQuantity - leftBase;
          throw ApiError.badRequest(
            `${name}: only ${Math.floor(onOrders / perUnit)} box(es) are still unaccounted on your open orders — you can't return more than that.`,
          );
        }
      }

      const createdReturns = [];
      const numberOf = new Map(orders.map((o) => [o.settlementId, o.settlementNumber]));
      for (const [stlId, stlLines] of buckets) {
        createdReturns.push(await makeReturn(stlId, stlLines, `Return on order ${numberOf.get(stlId)}`));
      }
      return createdReturns;
    }

    return [await makeReturn(settlementId, lines, null)];
  }, { timeout: 30000 });

  // Notify admins and warehouse staff for every created return record.
  const wa = require('./whatsappNotify.service');
  for (const ret of result) {
    const submitterName = ret.salesRep?.user?.name || actor?.name || 'A rep';
    const totalBoxes = (ret.items || []).reduce((s, i) => s + i.quantity, 0);
    const itemList = ret.items.map((i) => `${i.product?.name} × ${i.quantity}`).join(', ');
    notification.notifyAdmins({
      type: 'GENERAL',
      severity: 'INFO',
      title: 'Return approval required',
      message: `${submitterName} submitted a return of ${totalBoxes} box(es): ${itemList}. Please verify and approve.`,
      entityType: 'Return',
      entityId: ret.id,
    }).catch(() => {});
    wa.background(wa.returnSubmitted(ret));
  }

  // Callers get the first record; `related` lists every number created when
  // the return had to split across multiple orders.
  const first = result[0];
  return { ...first, related: result.map((r) => r.returnNumber) };
}

// ── Approve — execute inventory moves and close settlement if possible ────────

async function approveReturn(id, actor) {
  const ret = await prisma.return.findUnique({ where: { id }, include: RETURN_INCLUDE });
  if (!ret) throw ApiError.notFound('Return not found');
  if (ret.status !== 'PENDING') throw ApiError.badRequest(`Cannot approve a return with status ${ret.status}`);

  await prisma.$transaction(async (tx) => {
    const commonRef = { referenceType: 'RETURN', referenceId: ret.id, userId: actor ? actor.id : null };

    for (const l of ret.items) {
      const line = {
        productId: l.productId,
        packagingUnitId: l.packagingUnitId,
        quantity: l.quantity,
        baseQuantity: l.baseQuantity,
        condition: l.condition,
        unitCost: toNumber(l.product?.purchasePrice ?? 0),
      };

      if (ret.type === 'CUSTOMER_RETURN') {
        const dest = ret.salesRepId
          ? { type: inventory.LOCATION.SALES_REP, salesRepId: ret.salesRepId }
          : { type: inventory.LOCATION.WAREHOUSE, warehouseId: ret.warehouseId };

        await inventory.increaseStock(tx, {
          ...commonRef,
          productId: line.productId,
          packagingUnitId: line.packagingUnitId,
          quantity: line.quantity,
          baseQuantity: line.baseQuantity,
          type: 'CUSTOMER_RETURN',
          location: dest,
          unitCost: line.unitCost,
          notes: `Customer return ${ret.returnNumber}`,
          occurredAt: ret.processedAt,
        });

        if (line.condition === 'DAMAGED') {
          await inventory.decreaseStock(tx, {
            ...commonRef,
            productId: line.productId,
            packagingUnitId: line.packagingUnitId,
            quantity: line.quantity,
            baseQuantity: line.baseQuantity,
            type: 'DAMAGE',
            location: dest,
            unitCost: line.unitCost,
            notes: `Damaged on return ${ret.returnNumber}`,
            occurredAt: ret.processedAt,
          });
        }
      } else {
        // SALES_RETURN: rep → warehouse
        await inventory.transferStock(tx, {
          productId: line.productId,
          packagingUnitId: line.packagingUnitId,
          quantity: line.quantity,
          baseQuantity: line.baseQuantity,
          from: { type: inventory.LOCATION.SALES_REP, salesRepId: ret.salesRepId },
          to: { type: inventory.LOCATION.WAREHOUSE, warehouseId: ret.warehouseId },
          outType: 'SALES_RETURN',
          inType: 'TRANSFER_IN',
          ...commonRef,
          unitCost: line.unitCost,
          notes: `Sales return ${ret.returnNumber}`,
          occurredAt: ret.processedAt,
        });

        if (line.condition === 'DAMAGED') {
          await inventory.decreaseStock(tx, {
            ...commonRef,
            productId: line.productId,
            packagingUnitId: line.packagingUnitId,
            quantity: line.quantity,
            baseQuantity: line.baseQuantity,
            type: 'DAMAGE',
            location: { type: inventory.LOCATION.WAREHOUSE, warehouseId: ret.warehouseId },
            unitCost: line.unitCost,
            notes: `Damaged on sales return ${ret.returnNumber}`,
            occurredAt: ret.processedAt,
          });
        }
      }
    }

    // Mark approved
    await tx.return.update({
      where: { id },
      data: { status: 'APPROVED', decidedById: actor ? actor.id : null, decidedAt: new Date() },
    });

    // Sync the linked settlement (if any)
    if (ret.settlementId) {
      await settlement.recomputeStatus(tx, ret.settlementId);
    }
  }, { timeout: 30000 });

  // Notify the rep
  const repUserId = ret.salesRep?.user?.id;
  if (repUserId) {
    const totalBoxes = (ret.items || []).reduce((s, i) => s + i.quantity, 0);
    notification.notifyUser(repUserId, {
      type: 'GENERAL',
      severity: 'INFO',
      title: 'Return approved',
      message: `Your return of ${totalBoxes} box(es) (${ret.returnNumber}) has been approved and added to inventory.`,
      entityType: 'Return',
      entityId: id,
    }).catch(() => {});
  }

  return prisma.return.findUnique({ where: { id }, include: RETURN_INCLUDE });
}

// ── Reject — no inventory changes ─────────────────────────────────────────────

async function rejectReturn(id, actor, reason) {
  const ret = await prisma.return.findUnique({ where: { id }, include: RETURN_INCLUDE });
  if (!ret) throw ApiError.notFound('Return not found');
  if (ret.status !== 'PENDING') throw ApiError.badRequest(`Cannot reject a return with status ${ret.status}`);

  const updated = await prisma.return.update({
    where: { id },
    data: {
      status: 'REJECTED',
      decidedById: actor ? actor.id : null,
      decidedAt: new Date(),
      rejectionReason: reason || null,
    },
    include: RETURN_INCLUDE,
  });

  // Resume the penalty countdown: give back the hours the return sat pending, so
  // the rep is never fined for the approval window. Prior penalties stay (the
  // order simply becomes active again and the daily fine resumes).
  if (updated.settlementId) {
    const stl = await prisma.settlement.findUnique({ where: { id: updated.settlementId }, select: { status: true, deadlineAt: true } });
    if (stl && stl.status !== 'SETTLED') {
      const pauseMs = Math.max(0, new Date(updated.decidedAt).getTime() - new Date(updated.processedAt).getTime());
      if (pauseMs > 0) {
        await prisma.settlement.update({
          where: { id: updated.settlementId },
          data: { deadlineAt: new Date(new Date(stl.deadlineAt).getTime() + pauseMs) },
        });
      }
    }
  }

  const repUserId = updated.salesRep?.user?.id;
  if (repUserId) {
    const totalBoxes = (updated.items || []).reduce((s, i) => s + i.quantity, 0);
    notification.notifyUser(repUserId, {
      type: 'GENERAL',
      severity: 'WARNING',
      title: 'Return rejected',
      message: `Your return of ${totalBoxes} box(es) (${updated.returnNumber}) was not accepted.${reason ? ` Reason: ${reason}` : ' Please contact the administrator.'}`,
      entityType: 'Return',
      entityId: id,
    }).catch(() => {});
  }

  return updated;
}

// ── List / get ────────────────────────────────────────────────────────────────

// ── Cancel — the rep withdraws their own pending request (or staff does) ─────
// Nothing ever moved for a PENDING return, so cancelling simply unlocks the
// boxes (the lock is computed from PENDING status) and resumes the penalty
// countdown by giving back the paused hours.
async function cancelReturn(id, actor, { asRep = false } = {}) {
  const ret = await prisma.return.findUnique({ where: { id }, include: RETURN_INCLUDE });
  if (!ret) throw ApiError.notFound('Return not found');
  if (ret.status !== 'PENDING') throw ApiError.badRequest(`Only pending returns can be cancelled (this one is ${ret.status})`);
  if (asRep && ret.salesRepId !== actor?.salesRepId) {
    throw ApiError.forbidden('You can only cancel your own return request');
  }

  const updated = await prisma.return.update({
    where: { id },
    data: {
      status: 'CANCELLED',
      decidedById: actor ? actor.id : null,
      decidedAt: new Date(),
      rejectionReason: asRep ? 'Cancelled by the sales rep before approval.' : 'Cancelled by The Lab before approval.',
    },
    include: RETURN_INCLUDE,
  });

  // Give back the hours the return sat pending (same rule as rejection).
  if (updated.settlementId) {
    const stl = await prisma.settlement.findUnique({ where: { id: updated.settlementId }, select: { status: true, deadlineAt: true } });
    if (stl && stl.status !== 'SETTLED') {
      const pauseMs = Math.max(0, new Date(updated.decidedAt).getTime() - new Date(updated.processedAt).getTime());
      if (pauseMs > 0) {
        await prisma.settlement.update({
          where: { id: updated.settlementId },
          data: { deadlineAt: new Date(new Date(stl.deadlineAt).getTime() + pauseMs) },
        });
      }
    }
  }

  if (asRep) {
    notification.notifyAdmins({
      type: 'GENERAL',
      severity: 'INFO',
      title: 'Return request cancelled',
      message: `${updated.salesRep?.user?.name || 'A rep'} cancelled return ${updated.returnNumber} — the boxes stay on their order.`,
      entityType: 'Return',
      entityId: id,
    }).catch(() => {});
  } else if (updated.salesRep?.user?.id) {
    notification.notifyUser(updated.salesRep.user.id, {
      type: 'GENERAL',
      severity: 'INFO',
      title: 'Return request cancelled',
      message: `The Lab cancelled return ${updated.returnNumber}. The boxes remain on your order — settle or resubmit the return.`,
      entityType: 'Return',
      entityId: id,
    }).catch(() => {});
  }

  return updated;
}

// ── 24-hour window: pending returns expire automatically ─────────────────────
// A return that sits undecided for 24h is auto-cancelled: the boxes unlock and
// go back to the active order, the paused hours are given back, and the rep is
// charged a TSh 15,000 delay fine (the return "pause" is not a parking lot).
// Idempotent and safe to run from cron + polling piggybacks.
const RETURN_WINDOW_HOURS = 24;
// The failed-return fine depends on the order's programme: an extended order
// carries a steeper price (penalty.service owns both rates).
const returnFineFor = (stl) => require('./penalty.service').returnFailureRateFor(stl);

async function expireStaleReturns() {
  const cutoff = new Date(Date.now() - RETURN_WINDOW_HOURS * 3600 * 1000);
  const stale = await prisma.return.findMany({
    where: { status: 'PENDING', processedAt: { lt: cutoff } },
    include: { salesRep: { include: { user: { select: { id: true, name: true } } } } },
  });

  let expired = 0;
  for (const ret of stale) {
    let fineApplied = 0;
    await prisma.$transaction(async (tx) => {
      await tx.return.update({
        where: { id: ret.id },
        data: {
          status: 'EXPIRED',
          decidedAt: new Date(),
          rejectionReason: `Expired automatically — not approved within ${RETURN_WINDOW_HOURS} hours of submission.`,
        },
      });

      if (ret.settlementId) {
        const stl = await tx.settlement.findUnique({ where: { id: ret.settlementId }, select: { status: true, deadlineAt: true, settlementNumber: true, selfExtendedAt: true } });
        if (stl && stl.status !== 'SETTLED') {
          // The paused window is given back so daily late-fines never
          // double-charge those hours — the expiry fine below covers them.
          const pauseMs = Math.max(0, Date.now() - new Date(ret.processedAt).getTime());
          await tx.settlement.update({
            where: { id: ret.settlementId },
            data: { deadlineAt: new Date(new Date(stl.deadlineAt).getTime() + pauseMs) },
          });

          if (ret.type === 'SALES_RETURN' && ret.salesRepId) {
            fineApplied = returnFineFor(stl);
            await tx.settlementPenalty.create({
              data: {
                salesRepId: ret.salesRepId,
                settlementId: ret.settlementId,
                kind: 'EXPIRY_FINE',
                amount: fineApplied,
                daysOverdue: 0, // expiry fine, not a daily late-fine
                notes: stl.selfExtendedAt
                  ? `Extended period return failure — return ${ret.returnNumber} not completed within ${RETURN_WINDOW_HOURS} hours.`
                  : `Return ${ret.returnNumber} not completed within ${RETURN_WINDOW_HOURS} hours — delay fine.`,
              },
            });
          }
        }
      }
    }, { timeout: 30000 });
    expired++;

    const repUserId = ret.salesRep?.user?.id;
    if (repUserId) {
      notification.notifyUser(repUserId, {
        type: 'GENERAL',
        severity: 'CRITICAL',
        title: `Return ${ret.returnNumber} expired — TSh ${fineApplied.toLocaleString('en-US')} fine`,
        message: `Your return was not completed within ${RETURN_WINDOW_HOURS} hours, so it was cancelled automatically and a TSh ${fineApplied.toLocaleString('en-US')} delay fine was applied. The boxes are back on your order — settle them or submit a new return.`,
        entityType: 'Return',
        entityId: ret.id,
      }).catch(() => {});
    }
    notification.notifyAdmins({
      type: 'GENERAL',
      severity: 'WARNING',
      title: 'Return expired without a decision',
      message: `Return ${ret.returnNumber} from ${ret.salesRep?.user?.name || 'a rep'} sat ${RETURN_WINDOW_HOURS}h without approval and was auto-cancelled. The boxes are back on the order.`,
      entityType: 'Return',
      entityId: ret.id,
    }).catch(() => {});
  }

  return { expired };
}

async function listReturns(filters, pagination) {
  const where = {};
  if (filters.type) where.type = filters.type;
  if (filters.status) where.status = filters.status;
  if (filters.salesRepId) where.salesRepId = filters.salesRepId;
  if (filters.warehouseId) where.warehouseId = filters.warehouseId;
  if (filters.from || filters.to) {
    where.processedAt = {};
    if (filters.from) where.processedAt.gte = new Date(filters.from);
    if (filters.to) where.processedAt.lte = new Date(filters.to);
  }

  const [items, total] = await Promise.all([
    prisma.return.findMany({ where, include: RETURN_INCLUDE, skip: pagination.skip, take: pagination.take, orderBy: pagination.orderBy }),
    prisma.return.count({ where }),
  ]);

  // Attach the related order number (settlementId is a plain reference), so
  // the list shows "Return on STL-..." without opening the order.
  const stlIds = [...new Set(items.map((r) => r.settlementId).filter(Boolean))];
  if (stlIds.length) {
    const stls = await prisma.settlement.findMany({ where: { id: { in: stlIds } }, select: { id: true, settlementNumber: true } });
    const numOf = new Map(stls.map((x) => [x.id, x.settlementNumber]));
    for (const r of items) r.settlementNumber = r.settlementId ? numOf.get(r.settlementId) || null : null;
  }
  return { items, total };
}

async function getReturn(id) {
  const ret = await prisma.return.findUnique({ where: { id }, include: RETURN_INCLUDE });
  if (!ret) throw ApiError.notFound('Return not found');
  return ret;
}

// Counts for the Returns stat cards and the dashboard tile. "Today" follows
// the Tanzania business day.
async function returnsSummary(filters = {}) {
  const { eatRange } = require('../utils/dates');
  const day = eatRange('day');
  const repWhere = filters.salesRepId ? { salesRepId: filters.salesRepId } : {};
  const [pending, pendingBoxes, todayCount, todayBoxes, approved, rejected] = await Promise.all([
    prisma.return.count({ where: { ...repWhere, status: 'PENDING' } }),
    prisma.returnItem.aggregate({ where: { return: { is: { ...repWhere, status: 'PENDING' } } }, _sum: { quantity: true } }),
    prisma.return.count({ where: { ...repWhere, createdAt: { gte: day.start, lte: day.end } } }),
    prisma.returnItem.aggregate({ where: { return: { is: { ...repWhere, createdAt: { gte: day.start, lte: day.end } } } }, _sum: { quantity: true } }),
    prisma.return.count({ where: { ...repWhere, status: { in: ['APPROVED', 'COMPLETED'] } } }),
    prisma.return.count({ where: { ...repWhere, status: 'REJECTED' } }),
  ]);
  // The number this page is actually a record of: boxes that came back and
  // went onto the shelf. A count of returns says how many times it happened;
  // it never says how much stock moved.
  const [acceptedBoxes, firstRow, lastRow, allCount] = await Promise.all([
    prisma.returnItem.aggregate({
      where: { return: { is: { ...repWhere, status: { in: ['APPROVED', 'COMPLETED'] } } } },
      _sum: { quantity: true },
    }),
    prisma.return.findFirst({ where: repWhere, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
    prisma.return.findFirst({ where: repWhere, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
    prisma.return.count({ where: repWhere }),
  ]);
  // `rejected` counts only the REJECTED status, but the page files rejected,
  // cancelled and expired together — they share one outcome: no stock came
  // back. `refused` is the number that matches that section. The two type
  // counts feed the filter chips, so a chip states the whole history rather
  // than the page of results underneath it.
  const [refused, customerReturns, salesReturns] = await Promise.all([
    prisma.return.count({ where: { ...repWhere, status: { in: ['REJECTED', 'CANCELLED', 'EXPIRED'] } } }),
    prisma.return.count({ where: { ...repWhere, type: 'CUSTOMER_RETURN' } }),
    prisma.return.count({ where: { ...repWhere, type: 'SALES_RETURN' } }),
  ]);
  return {
    pending,
    pendingBoxes: pendingBoxes._sum.quantity || 0,
    todayCount,
    todayBoxes: todayBoxes._sum.quantity || 0,
    approved,
    rejected,
    boxesBack: acceptedBoxes._sum.quantity || 0,
    refused,
    customerReturns,
    salesReturns,
    totalReturns: allCount,
    firstAt: firstRow?.createdAt || null,
    lastAt: lastRow?.createdAt || null,
  };
}

module.exports = {
  cancelReturn,
  expireStaleReturns,
  returnsSummary, createReturn, approveReturn, rejectReturn, listReturns, getReturn, RETURN_INCLUDE };
