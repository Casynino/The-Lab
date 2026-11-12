// Small money figures the Finance screens work out from what the server sends. Pure, so they are tested
// without a browser (financeFigures.test.mjs).

const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;

// An account statement, newest first: the balance after each row, walked back from today's balance.
// Page 2 onwards starts below the rows on the pages before it (newerNet = their in minus out, counted
// by the server from go-live only). Rows from before the books started (epochAt) are listed as history
// but are in no balance: they get balanceAfter null and beforeBooks true, and never move `running`.
export function statementRows(rows, balanceNow, newerNet, epochAt) {
  const epochMs = epochAt ? Date.parse(epochAt) : NaN;
  let running = r2(Number(balanceNow || 0) - Number(newerNet || 0));
  return (rows || []).map((t) => {
    if (Number.isFinite(epochMs) && Date.parse(t.occurredAt) < epochMs) {
      return { ...t, balanceAfter: null, beforeBooks: true };
    }
    const after = running;
    running = r2(after - (t.direction === 'IN' ? Number(t.amount) : -Number(t.amount)));
    return { ...t, balanceAfter: after, beforeBooks: false };
  });
}

// The most a purchase order can be paid: what is left on that order AND what the supplier is still owed
// overall (balance payments and goods returned already count). Never below zero.
export function poPayCap(orderOutstanding, supplierOutstanding) {
  const cap = Math.min(Number(orderOutstanding || 0), Number(supplierOutstanding ?? orderOutstanding ?? 0));
  return cap > 0 ? r2(cap) : 0;
}
