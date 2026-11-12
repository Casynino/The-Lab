/*
  WHAT A WRITE CHANGES, AND SO WHAT IS ASKED AGAIN AFTER IT.

  An answer stays fresh for 30 s (lib/queryClient.js) and most pages do not
  poll (lib/polling.js). So a page read just before a write kept the figures
  from before it until the window was focused or 30 s had passed: approve a
  settlement, open Finance > Accounts, and Airtel still showed the old balance
  with no request sent — and "Correct balance" worked its difference out from
  that figure (audit freshness-1 and -2). Sales reps, Inventory and the
  Dashboard's stock alerts lagged the same way (freshness-3, -4).

  Each kind of write names here EVERY answer it changes, by the first part of
  its key (the builders in lib/pageQueries.js), and refreshes them in one go:
  an answer on screen is asked again now, and every other one is marked out of
  date, so the next page to open asks the server instead of showing memory.
  It costs one request per answer on screen at that moment, not a poll.
*/

// Moving stock anywhere: the counts (Inventory, the pickers' 'inventory' keys), the catalogue, the
// reorder list, the Dashboard's low / out of stock and stock value, and a rep's boxes when it is a rep's.
const STOCK = ['inventory', 'products', 'reorder', 'dashboard', 'sales-reps', 'sales-rep-profile'];

export const AFTER = Object.freeze({
  // A settlement approved or rejected, an order closed, a return decided inside the order window.
  // Approving makes a cash sale: money into an account (Finance: Accounts, Latest movements, Overview,
  // Profit), boxes off the rep (Sales reps, the rep's profile), commission earned (Commissions, the
  // rep's Wallet) and bonus progress.
  settlement: [
    'settlement', 'settlements', 'returns', 'return', 'sales', 'finance', 'reports',
    'commissions', 'bonus-summary', 'bonus', ...STOCK,
  ],
  // A payout paid or rejected: the rep's balance (Commissions, Sales reps, the rep's profile and Wallet)
  // and, when paid, the Commission account and "Commission paid" in Finance.
  payout: ['commissions', 'finance', 'reports', 'dashboard', 'sales-reps', 'sales-rep-profile'],
  // A sale recorded at the counter (or from a rep's stock): money in, stock out.
  sale: ['sales', 'sale', 'finance', 'reports', ...STOCK],
  // Stock received, adjusted or written off (Inventory, a purchase received).
  stock: STOCK,
  // A stock request approved, rejected or cancelled: boxes leave the warehouse and an order opens.
  stockRequest: ['stock-requests', 'settlements', 'settlement', ...STOCK],
  // A rep's return approved, rejected or cancelled: boxes come back and the order's remaining changes.
  repReturn: ['returns', 'return', 'settlements', 'settlement', ...STOCK],
  // A transfer made or cancelled: warehouse to warehouse, or to / from a rep, whose order then holds more
  // or fewer boxes (Inventory > Balances sits next to Transfers, and the Transfer window's own caps).
  transfer: ['transfers', 'settlements', 'settlement', ...STOCK],
});

/** The first key parts one or more kinds of write refresh, each once. */
export function keysAfter(...kinds) {
  const keys = new Set();
  for (const kind of kinds) {
    const list = AFTER[kind];
    if (!list) throw new Error(`afterWrite: no such write "${kind}"`);
    list.forEach((k) => keys.add(k));
  }
  return [...keys];
}

/** Refresh every answer these writes change. `qc` is the QueryClient. */
export function refreshAfter(qc, ...kinds) {
  for (const k of keysAfter(...kinds)) qc.invalidateQueries({ queryKey: [k] });
}
