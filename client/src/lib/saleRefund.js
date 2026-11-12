// ============================================================================
// A CUSTOMER BRINGS BOXES BACK — the figures the refund window shows.
//
// The same maths as the server (server/src/utils/saleRefund.js), which works it
// out again under its claim and is the one that counts. Per line, k of q boxes
// back are worth lineTotal × k / q; the sale discount is shared by line value
// (discount × value back / subtotal, rounded once to whole shillings, so the totals add up); what
// the customer still owes is cleared first and only the rest goes back as cash.
// Every box back = the sale is cancelled.
// ============================================================================

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const share = (n) => Math.round(Number(n)); // a part of a figure, in whole shillings (as the server)
const num = (v) => (v == null ? 0 : Number(v) || 0);

/**
 * @param sale  the sale as GET /sales/:id sends it (items with quantity, baseQuantity, lineTotal, lineDiscount, unitCost)
 * @param picks { [saleItemId]: boxes coming back }
 */
export function planRefund(sale, picks = {}) {
  const items = sale?.items || [];
  let valueBack = 0;
  let boxesBack = 0;
  const lines = [];
  for (const item of items) {
    const q = Number(item.quantity) || 0;
    const k = Math.max(0, Math.min(q, Math.floor(Number(picks[item.id]) || 0)));
    if (!k) continue;
    const all = k === q;
    const lineTotal = num(item.lineTotal);
    const v = all ? lineTotal : share((lineTotal * k) / q);
    valueBack = round2(valueBack + v);
    // Boxes in the warehouse's count (a carton back = its boxes), as the server records them.
    const base = all ? Number(item.baseQuantity) || 0 : k * ((Number(item.baseQuantity) || 0) / q);
    boxesBack += base;
    lines.push({ saleItemId: item.id, quantity: k, boxes: base, value: v });
  }
  const live = items.filter((i) => Number(i.quantity) > 0);
  const everything = live.length > 0 && live.every((i) => Math.floor(Number(picks[i.id]) || 0) >= Number(i.quantity));

  const subtotal = num(sale?.subtotal);
  const discount = num(sale?.discount);
  const total = num(sale?.total);
  const amountPaid = num(sale?.amountPaid);
  const discountBack = everything || valueBack >= subtotal
    ? discount
    : subtotal > 0 ? Math.min(discount, share((discount * valueBack) / subtotal)) : 0;
  const newTotal = everything ? 0 : Math.max(0, round2(round2(subtotal - valueBack) - round2(discount - discountBack)));
  const refundValue = round2(total - newTotal);
  const newPaid = round2(Math.min(amountPaid, newTotal));
  const cashBack = round2(amountPaid - newPaid);
  return {
    everything,
    lines,
    boxesBack,
    valueBack,
    discountBack: round2(discountBack),
    refundValue,
    cashBack,
    owedCleared: round2(refundValue - cashBack),
    newTotal,
    newPaid,
    newBalance: round2(newTotal - newPaid),
  };
}

/** Every box still on the sale — what the window starts with (the usual case: all of it came back). */
export function allBoxes(sale) {
  const out = {};
  (sale?.items || []).forEach((i) => { if (Number(i.quantity) > 0) out[i.id] = Number(i.quantity); });
  return out;
}

/** The request body's items: only lines with boxes coming back. */
export function refundItems(picks = {}) {
  return Object.entries(picks)
    .map(([saleItemId, q]) => ({ saleItemId, quantity: Math.floor(Number(q) || 0) }))
    .filter((l) => l.quantity > 0);
}

/** A counter sale a customer can return boxes from (a rep's sale goes back through his order). */
export const refundable = (sale) => !!sale && sale.status !== 'CANCELLED' && !sale.salesRepId && !sale.settlementId;

export const REFUND_REASONS = ['Damaged', 'Wrong product', 'Customer changed mind', 'Other'];
