'use strict';

// ===========================================================================
// A CUSTOMER RETURNS BOXES FROM A COUNTER SALE — THE MONEY MATHS (pure).
//
// Owner, 12 Nov 2026: "Yes, refund: the sale and the money come out of Finance.
// Do this when the customer returns — the money returns too, so the sale is
// cancelled." Every box back = a smaller sale + money back; every box back =
// the sale cancelled.
//
// Per line, k of its q boxes come back:
//   value back   = lineTotal × k / q   (the line's own price, its line discount
//                                       shared per box); all q = the whole lineTotal
//   boxes back   = k × (baseQuantity / q)
//   cost back    = boxes back × the line's unitCost (frozen at the sale)
// The sale-level discount is shared in proportion to line value — the same rule
// the reports use to give each line its revenue (reports.lineFinancials):
//   discount back = discount × (value back / subtotal), rounded once for the
//                   whole sale, so subtotal − discount = total holds exactly
//                   (everything back = the whole discount).
// Shares are rounded to whole shillings — the business counts no cents, and a
// refund of TSh 45,933.01 cannot be handed over.
//   refund value  = value back − discount back  = old total − new total.
// Money: what the customer still OWES is cleared first, and only the rest goes
// back as cash — new amountPaid = min(old amountPaid, new total). A fully paid
// sale gives the whole refund value back; a part-paid one may give less (or none).
// ===========================================================================

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const share = (n) => Math.round(Number(n)); // a part of a figure, in whole shillings
const num = (v) => (v == null ? 0 : Number(v));

class RefundInputError extends Error {}

/**
 * @param sale     { subtotal, discount, total, amountPaid, costTotal, items: [{ id, quantity, baseQuantity, lineTotal, lineDiscount, unitCost }] }
 * @param requests [{ saleItemId, quantity }] — boxes (in the line's own unit) coming back
 * @returns the new figures for the sale and each touched line, the cash going back, and whether it is everything.
 */
function planRefund(sale, requests) {
  const items = sale.items || [];
  if (!Array.isArray(requests) || requests.length === 0) throw new RefundInputError('Pick at least one box the customer brought back.');

  const back = new Map();
  for (const r of requests) {
    const item = items.find((i) => i.id === r.saleItemId);
    if (!item) throw new RefundInputError('One of the lines is not on this sale.');
    if (back.has(item.id)) throw new RefundInputError('Each line can be listed only once.');
    const k = Number(r.quantity);
    if (!Number.isInteger(k) || k < 1) throw new RefundInputError('Boxes coming back must be a whole number, 1 or more.');
    if (k > item.quantity) {
      throw new RefundInputError(`Only ${item.quantity} ${item.quantity === 1 ? 'box was' : 'boxes were'} left on that line — ${k} cannot come back.`);
    }
    back.set(item.id, k);
  }

  const lines = [];
  let valueBack = 0;
  let costBack = 0;
  for (const item of items) {
    const k = back.get(item.id) || 0;
    if (!k) continue;
    const q = item.quantity;
    const all = k === q;
    const factor = q > 0 ? item.baseQuantity / q : 0;
    const baseBack = all ? item.baseQuantity : k * factor;
    const lineTotal = num(item.lineTotal);
    const lineDiscount = num(item.lineDiscount);
    const lineValueBack = all ? lineTotal : share((lineTotal * k) / q);
    const nextLineTotal = round2(lineTotal - lineValueBack);
    // The line discount left is worked out from the line's own price, never rounded on its own, so
    // price × boxes − lineDiscount = lineTotal stays true for what is left on the line (a .5 tie used to
    // round both shares up and leave them 1 shilling apart).
    const packPrice = q > 0 ? (lineTotal + lineDiscount) / q : 0;
    const nextLineDiscount = all ? 0 : Math.max(0, round2(packPrice * (q - k) - nextLineTotal));
    const lineCostBack = round2(baseBack * num(item.unitCost));
    valueBack = round2(valueBack + lineValueBack);
    costBack = round2(costBack + lineCostBack);
    lines.push({
      saleItemId: item.id,
      productId: item.productId,
      packagingUnitId: item.packagingUnitId,
      unitCost: num(item.unitCost),
      quantityBack: k,
      baseBack,
      valueBack: lineValueBack,
      costBack: lineCostBack,
      next: {
        quantity: q - k,
        baseQuantity: item.baseQuantity - baseBack,
        lineTotal: nextLineTotal,
        lineDiscount: nextLineDiscount,
      },
    });
  }

  const everything = items.some((i) => i.quantity > 0) && items.every((i) => i.quantity === 0 || back.get(i.id) === i.quantity);

  const subtotal = num(sale.subtotal);
  const discount = num(sale.discount);
  const total = num(sale.total);
  const amountPaid = num(sale.amountPaid);
  let discountBack;
  if (everything || valueBack >= subtotal) discountBack = discount;
  else discountBack = subtotal > 0 ? Math.min(discount, share((discount * valueBack) / subtotal)) : 0;

  const newSubtotal = everything ? 0 : round2(subtotal - valueBack);
  const newDiscount = everything ? 0 : round2(discount - discountBack);
  const newTotal = everything ? 0 : Math.max(0, round2(newSubtotal - newDiscount));
  const refundValue = round2(total - newTotal);
  const newPaid = round2(Math.min(amountPaid, newTotal));
  const cashBack = round2(amountPaid - newPaid);
  const owedCleared = round2(refundValue - cashBack);
  const newBalance = round2(newTotal - newPaid);
  const newCost = everything ? 0 : Math.max(0, round2(num(sale.costTotal) - costBack));
  const status = newBalance <= 0 ? 'PAID' : newPaid > 0 ? 'PARTIAL' : 'UNPAID';

  return {
    everything,
    lines,
    // Boxes in the warehouse's own count (a carton line back = its boxes), for the words and the audit.
    boxesBack: lines.reduce((s, l) => s + l.baseBack, 0),
    valueBack,
    discountBack: round2(discountBack),
    refundValue,
    cashBack,
    owedCleared,
    next: {
      subtotal: newSubtotal,
      discount: newDiscount,
      total: newTotal,
      amountPaid: newPaid,
      balanceDue: newBalance,
      costTotal: newCost,
      status,
    },
  };
}

module.exports = { planRefund, RefundInputError, round2 };
