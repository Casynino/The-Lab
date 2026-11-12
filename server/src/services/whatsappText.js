'use strict';

// ===========================================================================
// EVERY WHATSAPP TEXT ZELab SENDS — the wording lives here and nowhere else.
//
// Nino, 10 Nov 2026: clean, well arranged, no emoji. One shape for all of them:
//
//   *TITLE IN CAPITALS*      <- bold in WhatsApp (the asterisks make it bold)
//   (date or reference, when the message has one)
//
//   Label: value             <- a group of 2-3 lines
//   Label: value
//
//   Label: value             <- a blank line between groups, so it can breathe
//
//   (reps only) ZELab
//
// This file only turns data into text. It sends nothing and reads nothing, so
// every template can be checked by test against the exact samples Nino wrote.
// Who gets what, when, and how often is decided in whatsappNotify.service.js.
//
// CallMeBot keeps about 700 characters and cuts the rest, so the reports (which
// end with the PDF link) are fitted to MAX_REPORT_CHARS by dropping their
// optional lines, never the link.
// ===========================================================================

const { dayjs } = require('../utils/dates');
const { compareBrands, compareProducts } = require('../utils/productOrder');

const MAX_REPORT_CHARS = 690;

// ── small words ──────────────────────────────────────────────────────────────
const money = (n) => `TSh ${Math.round(Number(n) || 0).toLocaleString('en-US')}`;
const eat = (d) => dayjs.utc(d || new Date()).add(3, 'hour'); // the business's clock (UTC+3)
const dateTime = (d) => eat(d).format('D MMM YYYY | HH:mm [EAT]'); // 10 Nov 2026 | 14:32 EAT
const dateOnly = (d) => eat(d).format('D MMM YYYY'); // 10 Nov 2026

const plural = (word, n) => {
  if (Number(n) === 1) return word;
  return /(s|x|z|ch|sh)$/i.test(word) ? `${word}es` : `${word}s`;
};
const cap = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);
const count = (n, word) => `${Math.round(Number(n) || 0)} ${plural(word, Math.round(Number(n) || 0))}`; // 1 Box, 4 Boxes
const boxes = (n, unit) => count(n, cap(unit || 'Box'));

// The marker in front of each product in a list. Every list of products is numbered "(1)- Name", "(2)- Name" (Nino, 12 Nov 2026: numbers in brackets
// with a dash, in every WhatsApp that lists products — it replaced the (a), (b), (c) letters).
const mark = (k) => `(${k + 1})- `;

// WhatsApp shows *text* in bold. Only the heading of a message is bold.
const bold = (s) => `*${s}*`;

// lines() keeps the lines that have something in them; doc() joins the parts with a blank line
const lines = (...l) => l.filter((x) => x !== null && x !== undefined && x !== false && x !== '').join('\n');
const doc = (...parts) => parts.filter((p) => p !== null && p !== undefined && p !== false && p !== '').join('\n\n');

// ═══ To the owner ════════════════════════════════════════════════════════════

const owner = {
  // The products are numbered, one line each: "(1)- Name: 2 Boxes", "(2)- Name: 3 Boxes" — numbered, not
  // numbers, so nothing in front of a name can be read as a number of boxes (Nino chose this on 11 Nov 2026
  // after trying "1-Name", "Product 1:" and arrows). Then, for several products, the box count of the whole
  // request (a carton counts as the boxes it holds: `boxes`), and the value.
  // The totals are what the owner needs most, so a very long request drops products from the
  // END of the list ("+3 more, see ZELab") and never the totals.
  // The city the stock is for stands under the name; a request split between cities says each line's city
  // after its boxes instead.
  stockRequest: ({ by, city, items = [], total, when }) => {
    const itemCities = [...new Set(items.map((i) => i.city).filter(Boolean))];
    const split = itemCities.length > 1;
    const oneCity = split ? null : (city || itemCities[0] || null);
    const head = [lines(bold('STOCK REQUEST'), dateTime(when)), oneCity ? lines(`By: ${by}`, `City: ${oneCity}`) : `By: ${by}`];
    const totalBoxes = items.reduce((s, i) => s + (Number(i.boxes ?? i.qty) || 0), 0);
    const tail = items.length > 1
      ? lines(`Total Boxes: ${Math.round(totalBoxes)}`, `Total Value: ${money(total)}`)
      : `Total Value: ${money(total)}`;
    const build = ({ shown }) => doc(
      ...head,
      lines(...items.slice(0, shown).map((i, k) => `${mark(k)}${i.name}: ${boxes(i.qty, i.unit)}${split && i.city ? ` · ${i.city}` : ''}`), shown < items.length && `+${items.length - shown} more, see ZELab`),
      tail,
    );
    const steps = [];
    for (let k = items.length; k >= 1; k -= 1) steps.push({ shown: k });
    return fitted(build, steps.length ? steps : [{ shown: 0 }]);
  },

  // Who and which order / the products / the money: small groups, not one block.
  // Every product is numbered like the stock request — "(1)- Name" with its Boxes Sold under it (Nino,
  // 11 Nov 2026: "any text that comes with a list of products must come with a b c d"), one product too.
  // Several products then show the total boxes, then what was paid to each account and the commission.
  // Like a long stock request, a very long one drops lines from the LIST and never from the money.
  settlementSubmitted: ({ by, order, product, boxes: n, amount, method, commission, when, items, payments }) => {
    const head = [lines(bold('SETTLEMENT SUBMITTED'), dateOnly(when)), lines(`By: ${by}`, `Order: ${order}`)];
    if (!items || items.length <= 1) {
      return doc(
        ...head,
        lines(`${mark(0)}${product}`, `Boxes Sold: ${Math.round(Number(n) || 0)}`),
        lines(`Payment: ${money(amount)}${method ? ` (${method})` : ''}`, Number(commission) > 0 && `Commission: ${money(commission)}`),
      );
    }
    const totalBoxes = items.reduce((s, i) => s + (Number(i.boxes) || 0), 0);
    const paid = lines(
      ...(payments || []).map((p) => `Payment: ${money(p.amount)}${p.method ? ` (${p.method})` : ''}`),
      Number(commission) > 0 && `Commission: ${money(commission)}`,
    );
    const build = ({ gap, shown }) => doc(
      ...head,
      items.slice(0, shown).map((i, k) => lines(`${mark(k)}${i.product}`, `Boxes Sold: ${Math.round(Number(i.boxes) || 0)}`)).join(gap ? '\n\n' : '\n'),
      shown < items.length && `+${items.length - shown} more, see ZELab`,
      `Total Boxes: ${Math.round(totalBoxes)}`,
      paid,
    );
    const steps = [{ gap: true, shown: items.length }, { gap: false, shown: items.length }];
    for (let k = items.length - 1; k >= 1; k -= 1) steps.push({ gap: false, shown: k });
    return fitted(build, steps);
  },

  // Who and which order, then the products numbered like the stock request ("(1)- Name: 4 Boxes"), the
  // total when there are several, then the reason.
  returnRequest: ({ by, order, items = [], reason }) => {
    const total = items.reduce((t, i) => t + (Number(i.quantity) || 0), 0);
    return doc(
      bold('RETURN REQUEST'),
      lines(`By: ${by}`, order && `Order: ${order}`),
      items.length > 0 && lines(...items.map((i, k) => `${mark(k)}${i.name}: ${boxes(i.quantity)}`)),
      items.length > 1 && `Total Boxes: ${Math.round(total)}`,
      reason && `Reason: ${reason}`,
    );
  },

  commissionReady: ({ rep, available, earned, penalties, minimum }) => doc(
    bold('COMMISSION READY'),
    `Rep: ${rep}`,
    lines(
      // No "Earned" line (Nino, 11 Nov 2026): the all-time total read as money the rep has today.
      `Available: ${money(available)}`,
      Number(penalties) > 0 && `Penalties: ${money(penalties)}`,
      `Minimum Withdrawal: ${money(minimum)}`,
    ),
  ),

  // Every low and out-of-stock product in ONE message (Nino, 12 Nov 2026: one text per product used up the
  // WhatsApp budget and the daily report did not go). His own format, word for word, with the products
  // numbered (1)-, (2)-, (3)- (first "only use abc", then 12 Nov: "(1)- (2)-" in every list): the heading, then
  // per product its name as stored and "20 Boxes Remaining | Restock: 80 Boxes" — nothing else, no brand
  // headings, no totals. All brands in one list, OHIS first, then Civlily, then any other brand A-Z (the
  // brand is in each name), and within a brand the fixed product order. An empty product sits in its place
  // with "0 Boxes Remaining". A list too long for one message (CallMeBot keeps ~700 characters) becomes
  // consecutive messages "*LOW STOCK — RESTOCK (1/2)*", "(2/2)", split between products, the numbers running
  // on. Returns the parts in order, each with the products it carries: [{ text, items }].
  // items: [{ name, brand, remaining, restock }]
  stockAlerts: ({ items = [] } = {}) => {
    const title = 'LOW STOCK — RESTOCK';
    const list = [...items].sort((a, b) => compareBrands(a.brand, b.brand) || compareProducts(a.name, b.name));
    if (!list.length) return [];
    const blocks = list.map((i, k) => lines(
      `${mark(k)}${i.name}`,
      `${boxes(Math.max(0, Number(i.remaining) || 0))} Remaining | Restock: ${boxes(i.restock)}`,
    ));
    const whole = doc(bold(title), ...blocks);
    if (whole.length <= MAX_REPORT_CHARS) return [{ text: whole, items: list }];
    // Room for the longest heading the split can have ("(12/12)"), then whole products only.
    const room = MAX_REPORT_CHARS - bold(`${title} (${list.length}/${list.length})`).length;
    const groups = [];
    let used = 0;
    blocks.forEach((b, k) => {
      if (!groups.length || used + 2 + b.length > room) { groups.push([]); used = 0; }
      groups[groups.length - 1].push(k);
      used += 2 + b.length;
    });
    return groups.map((ks, p) => ({
      text: doc(bold(`${title} (${p + 1}/${groups.length})`), ...ks.map((k) => blocks[k])),
      items: ks.map((k) => list[k]),
    }));
  },

  settlementDeadline: ({ order, rep, minutes, outstanding, rate }) => doc(
    lines(bold('SETTLEMENT DEADLINE'), order),
    `Rep: ${rep}`,
    lines(`Time Remaining: ${count(minutes, 'Minute')}`, `Outstanding: ${money(outstanding)}`, `Daily Fine: ${money(rate)}`),
  ),

  extensionGranted: ({ rep, hours = 96, deadline, rate }) => doc(
    bold('EXTENSION GRANTED'),
    `Rep: ${rep}`,
    lines(`Extension: ${count(hours, 'Hour')}`, `New Deadline: ${dateTime(deadline)}`),
    `Daily Fine: ${money(rate)}`,
  ),

  test: () => doc(bold('ZELAB — TEST NOTIFICATION'), 'WhatsApp notifications are working.'),
};

// ═══ The reports (daily, weekly, monthly) ════════════════════════════════════
// The tail of each is optional and is dropped, a little at a time, until the
// whole message fits; the PDF link is last and is never the thing that goes.

const topList = (title, rows, n) => (n > 0 && rows.length ? lines(title, ...rows.slice(0, n).map((r) => `${r.name} ${money(r.revenue)}`)) : '');
const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || 'Rep';

function fitted(build, steps) {
  let text = '';
  for (const s of steps) {
    text = build(s);
    if (text.length <= MAX_REPORT_CHARS) return text;
  }
  return text; // nothing optional left to drop
}

owner.dailyReport = (d) => {
  const build = ({ reps }) => doc(
    // A missed report sent the next morning: its stock is the morning's, so say so. Its cash balance is the
    // day's closing balance (the caller passes the period's end), whenever it is sent.
    lines(bold('ZELAB — DAILY REPORT'), d.date, d.late && `Sent late: ${dateTime(d.late)} (stock as at then)`),
    lines(`Sales: ${money(d.sales)} (${boxes(d.boxesSold)})`, `Net Profit: ${money(d.netProfit)}`, `Expenses: ${money(d.expenses)}`),
    lines(`Cash In: ${money(d.cashIn)}`, `Cash Out: ${money(d.cashOut)}`, `Cash Balance: ${money(d.cashBalance)}`),
    `Orders: ${d.orders} | Settlements: ${d.settlements} | Returns: ${d.returns}`,
    topList('Top Reps:', (d.reps || []).map((r) => ({ name: firstName(r.name), revenue: r.revenue })), reps),
    lines(`Stock Value: ${money(d.stockValue)}`, `Stock Quantity: ${boxes(d.stockBoxes)}`),
    `Alerts: ${d.alerts}`,
    d.link && lines('Full Report (PDF):', d.link),
  );
  return fitted(build, [{ reps: 3 }, { reps: 2 }, { reps: 1 }, { reps: 0 }]);
};

// weekly and monthly share one shape; only the title, period and link label differ
const periodReport = (title, linkLabel) => (d) => {
  const growth = d.growthPct == null ? null : Math.round(d.growthPct);
  const build = ({ brands, product }) => doc(
    lines(bold(title), d.period),
    lines(`Revenue: ${money(d.revenue)}`, `Net Profit: ${money(d.netProfit)}`, `Expenses: ${money(d.expenses)}`, `Cash Balance: ${money(d.cashBalance)}`),
    growth !== null && `Revenue Growth: ${growth > 0 ? '+' : ''}${growth}%`,
    lines(
      product && d.topProduct && `Top Product: ${d.topProduct.name} — ${money(d.topProduct.revenue)}`,
      d.topRep && `Top Rep: ${d.topRep.name} — ${money(d.topRep.revenue)}`,
    ),
    topList('Brand Sales:', d.brands || [], brands),
    lines(`Stock Value: ${money(d.stockValue)}`, `Stock Quantity: ${boxes(d.stockBoxes)}`),
    `Alerts: ${d.alerts}`,
    d.link && lines(linkLabel, d.link),
  );
  return fitted(build, [
    { brands: 3, product: true }, { brands: 2, product: true }, { brands: 1, product: true },
    { brands: 0, product: true }, { brands: 0, product: false },
  ]);
};
owner.weeklyReport = periodReport('ZELAB — WEEKLY REPORT', 'Full Statement (PDF):');
owner.monthlyReport = periodReport('ZELAB — MONTHLY REPORT', 'Full Report (PDF):');

// The year in one message (Nino, 11 Nov 2026: "which month made more, or a loss"): the totals, the best and
// the weakest month, the months that lost money, the leaders, the link. Leaders, then the weakest month, are
// the first lines dropped when the message would run past CallMeBot's limit — the link always stays.
owner.yearlyReport = (d) => {
  const growth = d.growthPct == null ? null : Math.round(d.growthPct);
  const loss = Array.isArray(d.lossMonths) ? d.lossMonths : [];
  const build = ({ leaders, weakest }) => doc(
    lines(bold('ZELAB — YEARLY REPORT'), d.year),
    lines(`Revenue: ${money(d.revenue)}`, `Gross Profit: ${money(d.grossProfit)}`, `Expenses: ${money(d.expenses)}`, `Net Profit: ${money(d.netProfit)}`, `Boxes Sold: ${boxes(d.boxes)}`),
    growth !== null && `Revenue Growth: ${growth > 0 ? '+' : ''}${growth}% on ${d.prevLabel}`,
    lines(
      d.bestMonth && `Best Month: ${d.bestMonth.name} — ${money(d.bestMonth.netProfit)} profit`,
      weakest && d.weakestMonth && `Weakest Month: ${d.weakestMonth.name} — ${money(d.weakestMonth.netProfit)}`,
      `Loss Months: ${loss.length ? loss.join(', ') : 'None'}`,
    ),
    leaders && lines(
      d.topBrand && `Top Brand: ${d.topBrand.name} — ${money(d.topBrand.revenue)}`,
      d.topRep && `Top Rep: ${d.topRep.name} — ${money(d.topRep.revenue)}`,
      d.topProduct && `Top Product: ${d.topProduct.name}`,
    ),
    `Cash Balance: ${money(d.cashBalance)}`,
    d.link && lines('Full Year Report (PDF):', d.link),
  );
  return fitted(build, [
    { leaders: true, weakest: true }, { leaders: true, weakest: false },
    { leaders: false, weakest: true }, { leaders: false, weakest: false },
  ]);
};

// ═══ To a rep ════════════════════════════════════════════════════════════════
// Same shape, and a plain "ZELab" at the foot so they know whom it is from.

const FOOT = 'ZELab';
const rep = (title, ...parts) => doc(bold(title), ...parts, FOOT);

// The approved request (audit, 11 Nov 2026: the rep was not told about a part-approval): Nino's sample,
// plus the order it opened and its deadline, then one numbered line per product as on the owner's
// STOCK REQUEST — a line cut by the admin reads "3 of 4 Boxes". A request split between cities says each
// line's city after its boxes (" · Arusha"), as the owner's STOCK REQUEST does, so the same product asked
// for two cities is never two identical lines (audit, 12 Nov 2026). A very long list drops products from
// the end ("+2 more, see ZELab"), never the order or the deadline.
const stockRequestApproved = ({ request, order, deadline, items }) => {
  const list = Array.isArray(items) ? items : [];
  const short = (i) => Number(i.approved) < Number(i.requested);
  const cut = list.some(short);
  const split = new Set(list.map((i) => i.city).filter(Boolean)).size > 1;
  const line = (i, k) => `${mark(k)}${i.name}: ${short(i)
    ? `${Math.round(Number(i.approved) || 0)} of ${boxes(i.requested, i.unit)}`
    : boxes(i.approved, i.unit)}${split && i.city ? ` · ${i.city}` : ''}`;
  const build = ({ shown }) => rep(
    'STOCK REQUEST APPROVED',
    lines(`Request: ${request}`, order && `Order: ${order}`, deadline && `Deadline: ${dateTime(deadline)}`),
    list.length > 0 && lines(...list.slice(0, shown).map(line), shown < list.length && `+${list.length - shown} more, see ZELab`),
    lines('Your stock request has been approved and issued.', cut && 'Some products were approved in a smaller quantity than you asked for.'),
  );
  const steps = [];
  for (let k = list.length; k >= 1; k -= 1) steps.push({ shown: k });
  return fitted(build, steps.length ? steps : [{ shown: 0 }]);
};

// Stock the admin issued straight from Transfers, with no request behind it (audit, 11 Nov 2026: the
// rep was never told): the order it opened and its deadline, then one numbered line per product, the
// same shape as the approved request. A very long list drops products from the end, never the deadline.
const stockIssued = ({ transfer, order, deadline, items }) => {
  const list = Array.isArray(items) ? items : [];
  const line = (i, k) => `${mark(k)}${i.name}: ${boxes(i.quantity, i.unit)}`;
  const build = ({ shown }) => rep(
    'STOCK ISSUED',
    lines(transfer && `Transfer: ${transfer}`, order && `Order: ${order}`, deadline && `Deadline: ${dateTime(deadline)}`),
    list.length > 0 && lines(...list.slice(0, shown).map(line), shown < list.length && `+${list.length - shown} more, see ZELab`),
    'Stock has been issued to you. Settle or return it before the deadline.',
  );
  const steps = [];
  for (let k = list.length; k >= 1; k -= 1) steps.push({ shown: k });
  return fitted(build, steps.length ? steps : [{ shown: 0 }]);
};

// A rep's pending request changed by the admin (audit, 11 Nov 2026: it went out in the general wording,
// every product run together on one line, and a long one passed CallMeBot's ~700 characters and lost its
// end). Same family as STOCK REQUEST APPROVED: one numbered line per product as it is now; a very long
// list drops products from the end ("+2 more, see ZELab"), never the total.
const stockRequestChanged = ({ request, by, items, total }) => {
  const list = Array.isArray(items) ? items : [];
  const line = (i, k) => `${mark(k)}${i.name}: ${boxes(i.quantity, i.unit)}`;
  const build = ({ shown }) => rep(
    'STOCK REQUEST CHANGED',
    lines(`Request: ${request}`, by && `Changed by: ${by}`),
    list.length > 0 && lines(...list.slice(0, shown).map(line), shown < list.length && `+${list.length - shown} more, see ZELab`),
    total != null && `Total Value: ${money(total)}`,
    'Your pending request has been changed. This is what it is now.',
  );
  const steps = [];
  for (let k = list.length; k >= 1; k -= 1) steps.push({ shown: k });
  return fitted(build, steps.length ? steps : [{ shown: 0 }]);
};

const repTexts = {
  STOCK_REQUEST_APPROVED: stockRequestApproved,
  STOCK_ISSUED: stockIssued,
  STOCK_REQUEST_CHANGED: stockRequestChanged,
  STOCK_REQUEST_REJECTED: ({ request, reason }) => rep('STOCK REQUEST REJECTED', `Request: ${request}`, lines('Your stock request was not approved.', reason && `Reason: ${reason}`)),
  STOCK_ADDED: ({ product, boxes: n, order, attached }) => rep(
    'NEW STOCK ADDED',
    lines(`Product: ${product}`, `Quantity: ${boxes(n)}`),
    `Order: ${order}`,
    attached ? 'Added to your active order. Your settlement has been updated.' : 'Issued to you as a new order.',
  ),
  SETTLEMENT_APPROVED: ({ boxes: n, product, amount, earned, available, closed, order }) => rep(
    'SETTLEMENT APPROVED',
    lines(`${boxes(n)} of ${product}`, `Payment: ${money(amount)}`),
    lines(earned != null && `Commission Earned: ${money(earned)}`, available != null && `Available Balance: ${money(available)}`),
    closed && `Order ${order} is now fully closed.`,
  ),
  SETTLEMENT_REJECTED: ({ boxes: n, product, reason }) => rep(
    'SETTLEMENT REJECTED',
    `${boxes(n)} of ${product}`,
    lines(reason && `Reason: ${reason}`, 'Please review and resubmit.'),
  ),
  ORDER_CLOSED: ({ order }) => rep('ORDER CLOSED', `Order: ${order}`, 'Fully settled. All boxes accounted for.'),
  // The deadline and the daily fine that starts at it ride under the order (audit, 12 Nov 2026: no
  // reminder said when, or what happens then). Without them the text is Nino's sample as it was.
  DEADLINE_NEAR: ({ order, stage = 1, deadline, rate }) => {
    const head = lines(`Order: ${order}`, deadline && `Deadline: ${dateTime(deadline)}`, rate != null && `Daily Fine After Deadline: ${money(rate)}`);
    if (stage >= 3) return rep('SETTLEMENT DEADLINE URGENT', head, 'Your settlement deadline is almost reached. Settle or return your order immediately.');
    if (stage === 2) return rep('SETTLEMENT FINAL REMINDER', head, 'Your settlement deadline is very close. Settle or return your order now.');
    return rep('SETTLEMENT DEADLINE NEAR', head, 'Your settlement deadline is approaching. Please settle your order.');
  },
  LATE_FINE: ({ fine, order, days }) => rep('LATE SETTLEMENT FINE', `Fine Applied: ${money(fine)}`, lines(`Order: ${order}`, `Overdue: ${count(days, 'Day')}`)),
  FINE_FORGIVEN: ({ amount, order }) => rep('FINE FORGIVEN', lines(`Amount: ${money(amount)}`, order && `Order: ${order}`), 'Returned to your commission balance.'),
  COMMISSION_DEDUCTED: ({ amount, reason }) => rep('COMMISSION DEDUCTED', lines(`Amount: ${money(amount)}`, reason && `Reason: ${reason}`), 'Future commission is not affected.'),
  EXTENSION_ACTIVATED: ({ order, deadline, hours = 96, rate, returnFine }) => rep(
    'EXTENSION ACTIVATED',
    `Order: ${order}`,
    lines(`Extension: ${count(hours, 'Hour')}`, `New Deadline: ${dateTime(deadline)}`),
    lines(`Daily Fine After Deadline: ${money(rate)}`, `Return Delay Fine: ${money(returnFine)}`),
    'No fine until the new deadline. A return not completed within 24 Hours is fined.',
  ),
  DEADLINE_EXTENDED: ({ order, deadline }) => rep(
    'DEADLINE EXTENDED',
    lines(`Order: ${order}`, `New Deadline: ${dateTime(deadline)}`),
    'Settle your boxes or return unsold stock before then. After the deadline the daily fine applies.',
  ),
  DEADLINE_MOVED_BACK: ({ order, deadline, extensionCancelled, dailyFine, overdueNow }) => rep(
    'DEADLINE MOVED BACK',
    `Order: ${order}`,
    lines(
      `New Deadline: ${dateTime(deadline)}`,
      extensionCancelled && 'Extension: Cancelled',
      extensionCancelled && `Daily Fine: ${money(dailyFine)}`,
      overdueNow && 'Status: Overdue',
    ),
    extensionCancelled && 'The extension is yours again. You can take it whenever this order is not overdue.',
    overdueNow && 'That time has already passed, so the order is overdue now. The daily fine runs from today. A return waiting for approval pauses it. Settle or return to stop it.',
  ),
  RETURN_APPROVED: ({ number, boxes: n }) => rep('RETURN APPROVED', lines(`Return: ${number}`, `Quantity: ${boxes(n)}`), 'Added back to inventory.'),
  RETURN_REJECTED: ({ number, boxes: n, reason }) => rep('RETURN REJECTED', lines(`Return: ${number}`, `Quantity: ${boxes(n)}`), reason ? `Reason: ${reason}` : 'Please contact the administrator.'),
  RETURN_CANCELLED: ({ number }) => rep('RETURN CANCELLED', `Return: ${number}`, 'The boxes remain on your order. Settle or resubmit the return.'),
  RETURN_EXPIRED: ({ number, fine, hours }) => rep(
    'RETURN EXPIRED',
    lines(`Return: ${number}`, Number(fine) > 0 && `Fine Applied: ${money(fine)}`),
    `Your return was not completed within ${count(hours, 'Hour')} and was cancelled automatically. The boxes are back on your order. Settle them or submit a new return.`,
  ),
  WITHDRAWAL_REQUESTED: ({ amount }) => rep('WITHDRAWAL REQUESTED', lines(`Amount: ${money(amount)}`, 'Status: Pending approval')),
  WITHDRAWAL_APPROVED: ({ amount }) => rep('WITHDRAWAL APPROVED', lines(`Amount: ${money(amount)}`, 'Status: Approved')),
  WITHDRAWAL_REJECTED: ({ amount }) => rep('WITHDRAWAL REJECTED', lines(`Amount: ${money(amount)}`, 'Status: Not approved')),
  WITHDRAWAL_PAID: ({ amount }) => rep('COMMISSION PAID', lines(`Amount: ${money(amount)}`, 'Status: Paid out')),
  WINDOW_OPEN: () => rep('WITHDRAWAL WINDOW OPEN', 'A one-off withdrawal has been opened for you. Your usual minimum does not apply. Request it from your Commission page within the next 2 Days.'),
  WINDOW_CLOSED: () => rep('WITHDRAWAL WINDOW CLOSED', 'The one-off withdrawal opened for you has been closed. Your usual minimum applies again.'),
  COMMISSION_READY: ({ available, minimum }) => rep('COMMISSION READY', lines(`Available: ${money(available)}`, `Minimum Withdrawal: ${money(minimum)}`), 'You can request a withdrawal.'),
  BONUS_UNLOCKED: ({ bonus, target, nextTarget, nextBonus }) => rep(
    'BONUS UNLOCKED',
    lines(`Bonus: ${money(bonus)}`, `Sales Reached: ${money(target)}`),
    nextTarget != null && `Keep going: ${money(nextTarget)} earns ${money(nextBonus)} instead. Taking a bonus starts your count again from zero.`,
  ),
  BONUS_PAID: ({ bonus }) => rep('BONUS PAID', `Bonus: ${money(bonus)}`, 'Your sales count starts again from zero for the next one.'),
  PASSWORD_CHANGED: () => rep('PASSWORD CHANGED', 'Your account password was changed. If you did not do this, contact your administrator immediately.'),
  TEST: () => rep('ZELAB', 'WhatsApp alerts are now active for you. You will get a message here whenever something important happens with your stock, settlements and commission.'),
};

// An emoji or symbol in a title (the in-app bell still has one) must never reach WhatsApp.
const noEmoji = (s) => String(s || '').replace(/[\u{1F000}-\u{1FFFF}\u{2190}-\u{2BFF}️‍]/gu, '').replace(/\s+/g, ' ').trim();

/**
 * The text for a rep from a structured `whatsapp: { kind, ...data }`. A kind
 * nobody has written a template for falls back to the in-app title and message
 * in the same shape, so a new alert is never silently lost.
 */
function repText(whatsapp, fallback = {}) {
  const make = whatsapp && repTexts[whatsapp.kind];
  if (make) return make(whatsapp);
  return rep(noEmoji(fallback.title).toUpperCase() || 'ZELAB', noEmoji(fallback.message));
}

module.exports = { owner, repText, repTexts, money, boxes, count, dateTime, dateOnly, MAX_REPORT_CHARS };
