'use strict';

// The WhatsApp texts. Run with: npm test
//
// The expected strings below are the samples Nino wrote on 10 Nov 2026 — the same
// words, with the heading in bold and, since he found the first layout crowded, a
// blank line between groups of two or three lines. If one of these fails, the
// wording or the spacing drifted from what he approved.
// (Trailing spaces in his paste are dropped: WhatsApp ignores them.)

const test = require('node:test');
const assert = require('node:assert/strict');
const t = require('../src/services/whatsappText');

const at = new Date('2026-11-10T11:32:00Z'); // 14:32 in Tanzania

// ── to the owner ─────────────────────────────────────────────────────────────
test('STOCK REQUEST (one product): an arrow line, then the value', () => {
  assert.equal(t.owner.stockRequest({ by: 'Asha Mwinyi', items: [{ name: 'OHIS Ndogo (Brown) Bila Filter', qty: 20 }], total: 760000, when: at }),
`*STOCK REQUEST*

By: Asha Mwinyi

OHIS
(1) Ndogo (Brown) Bila Filter: 20 Boxes

Total Value: TSh 760,000`);
});

test('STOCK REQUEST with several products: one arrow line each, no numbers, then the totals (Nino\'s own example)', () => {
  const n = (name, qty) => ({ name, qty });
  assert.equal(t.owner.stockRequest({
    by: 'Nyoya',
    items: [n('OHIS Ndogo (Brown) Bila Filter', 2), n('Civlily Ndogo (Brown) Bila Filter', 5), n('OHIS Ndogo (White) Bila Filter', 3), n('OHIS Ndogo (Brown) Na Filter', 2), n('OHIS Kubwa (Brown) Na Filter', 2)],
    total: 318000,
    when: new Date('2026-11-10T16:32:00Z'),
  }),
`*STOCK REQUEST*

By: Nyoya

OHIS
(1) Ndogo (Brown) Bila Filter: 2 Boxes
(2) Ndogo (White) Bila Filter: 3 Boxes
(3) Ndogo (Brown) Na Filter: 2 Boxes
(4) Kubwa (Brown) Na Filter: 2 Boxes

Civlily
(5) Ndogo (Brown) Bila Filter: 5 Boxes

Total Boxes: 14
Total Value: TSh 318,000`);
});

test('STOCK REQUEST: a very long request keeps its totals; products drop from the end of the list, never the Total lines', () => {
  const many = Array.from({ length: 16 }, (_, n) => ({ name: `OHIS Pepa Ndogo (Colour ${n + 1}) – Bila Filter`, qty: 2 }));
  const text = t.owner.stockRequest({ by: 'Nyoya', items: many, total: 420000, when: at });
  assert.ok(text.length <= t.MAX_REPORT_CHARS, `${text.length} characters`);
  assert.match(text, /\+\d+ more, see ZELab\n\nTotal Boxes: 32\nTotal Value: TSh 420,000$/);
  assert.ok(text.startsWith('*STOCK REQUEST*\n\nBy: Nyoya\n\nOHIS\n(1) Pepa Ndogo (Colour 1) – Bila Filter: 2 Boxes\n'));
  // a request that fits is untouched: every product shown
  const four = t.owner.stockRequest({ by: 'A', items: many.slice(0, 4), total: 1, when: at });
  assert.ok(!four.includes('more, see ZELab') && four.includes('(4) Pepa Ndogo (Colour 4) – Bila Filter: 2 Boxes'));
});

test('STOCK REQUEST: every product line starts (1)-, (2) — never a bare number; a carton counts as the boxes it holds', () => {
  const mixed = t.owner.stockRequest({ by: 'A', items: [{ name: 'A', qty: 1 }, { name: 'B', qty: 3, unit: 'Carton', boxes: 30 }], total: 5, when: at });
  assert.match(mixed, /\n\(1\) A: 1 Box\n\(2\) B: 3 Cartons\n\nTotal Boxes: 31\nTotal Value: TSh 5$/);
  assert.ok(!/^\d/m.test(mixed.split('\n\n').slice(2, 3)[0]), 'the list lines do not start with a bare number');
  const one = t.owner.stockRequest({ by: 'Nyoya', items: [{ name: 'OHIS Pepa Ndogo (Brown) – Bila Filter', qty: 1 }], total: 7500, when: at });
  assert.ok(!one.includes('Total Boxes'), 'one product: the line already says it');
});

test('SETTLEMENT SUBMITTED', () => {
  assert.equal(t.owner.settlementSubmitted({ by: 'Asha Mwinyi', order: 'STL-20261110-0001', product: 'Pepa King Size', boxes: 10, amount: 380000, method: 'CRDB', commission: 20000, when: at }),
`*SETTLEMENT SUBMITTED*

By: Asha Mwinyi
Order: STL-20261110-0001

(1) Pepa King Size
Boxes Sold: 10

Payment: TSh 380,000 (CRDB)
Commission: TSh 20,000`);
});

test('SETTLEMENT SUBMITTED without a payment method or a commission rule leaves those out cleanly', () => {
  const text = t.owner.settlementSubmitted({ by: 'A', order: 'O', product: 'P', boxes: 1, amount: 1000, method: null, commission: 0, when: at });
  assert.match(text, /Payment: TSh 1,000$/);
  assert.ok(!text.includes('Commission'));
  assert.ok(!text.includes('()'));
});

test('RETURN REQUEST', () => {
  assert.equal(t.owner.returnRequest({ by: 'Asha Mwinyi', order: 'STL-20261110-0001', items: [{ name: 'Civlily Kubwa (Brown) Na Filter', quantity: 4 }], reason: 'Damaged' }),
`*RETURN REQUEST*

By: Asha Mwinyi
Order: STL-20261110-0001

Civlily
(1) Kubwa (Brown) Na Filter: 4 Boxes

Reason: Damaged`);
});

test('RETURN REQUEST with several products numbers them like the stock request, with the total', () => {
  const text = t.owner.returnRequest({ by: 'W', order: null, items: [{ name: 'A', quantity: 1 }, { name: 'B', quantity: 2 }], reason: null });
  assert.equal(text, '*RETURN REQUEST*\n\nBy: W\n\n(1) A: 1 Box\n(2) B: 2 Boxes\n\nTotal Boxes: 3');
});

test('COMMISSION READY', () => {
  assert.equal(t.owner.commissionReady({ rep: 'Asha Mwinyi', available: 210000, earned: 460000, penalties: 10000, minimum: 100000 }),
`*COMMISSION READY*

Rep: Asha Mwinyi

Available: TSh 210,000
Penalties: TSh 10,000
Minimum Withdrawal: TSh 100,000`);
  assert.ok(!t.owner.commissionReady({ rep: 'A', available: 1, earned: 1, penalties: 0, minimum: 1 }).includes('Penalties'));
  // The all-time total is not in the message: it read as money the rep has today.
  assert.ok(!t.owner.commissionReady({ rep: 'A', available: 1, earned: 999, penalties: 0, minimum: 1 }).includes('Earned'));
});

// ── LOW STOCK — RESTOCK: one list for every low product (Nino, 12 Nov 2026) ─────
// His own sample, numbered (1)-, (2)-, (3) (12 Nov 2026).
const P = {
  ohisNdBrBila: { id: 'o1', brand: 'OHIS', name: 'OHIS Ndogo (Brown) – Bila Filter' },
  ohisNdWhBila: { id: 'o2', brand: 'OHIS', name: 'OHIS Ndogo (White) – Bila Filter' },
  ohisNdBrNa: { id: 'o3', brand: 'OHIS', name: 'OHIS Ndogo (Brown) – Na Filter' },
  ohisKbBrNa: { id: 'o4', brand: 'OHIS', name: 'OHIS Kubwa (Brown) – Na Filter' },
  ohisKbBrBila: { id: 'o5', brand: 'OHIS', name: 'OHIS Kubwa (Brown) – Bila Filter' },
  civNdBrBila: { id: 'c1', brand: 'Civlily', name: 'Civlily Ndogo (Brown) – Bila Filter' },
  civNdWhBila: { id: 'c2', brand: 'Civlily', name: 'Civlily Ndogo (White) – Bila Filter' },
  civNdBrNa: { id: 'c3', brand: 'Civlily', name: 'Civlily Ndogo (Brown) – Na Filter' },
  civKbBrBila: { id: 'c4', brand: 'Civlily', name: 'Civlily Kubwa (Brown) – Bila Filter' },
  civKbWhBila: { id: 'c5', brand: 'Civlily', name: 'Civlily Kubwa (White) – Bila Filter' },
  civKbBrNa: { id: 'c6', brand: 'Civlily', name: 'Civlily Kubwa (Brown) – Na Filter' },
  civKbMixNa: { id: 'c7', brand: 'Civlily', name: 'Civlily Kubwa (Mix) – Na Filter' },
  civNdMixBila: { id: 'c8', brand: 'Civlily', name: 'Civlily Ndogo (Mix) – Bila Filter' },
};
const low = (p, remaining, restock) => ({ ...p, remaining, restock });

test('LOW STOCK — RESTOCK: Nino\'s sample word for word, lettered (a), (b), (c), in one message', () => {
  const parts = t.owner.stockAlerts({ items: [low(P.civKbWhBila, 42, 58), low(P.civNdBrNa, 34, 66), low(P.ohisNdBrBila, 20, 80)] });
  assert.equal(parts.length, 1);
  assert.equal(parts[0].text,
`*LOW STOCK — RESTOCK*

(1) OHIS Ndogo (Brown) – Bila Filter
20 Boxes Remaining | Restock: 80 Boxes

(2) Civlily Ndogo (Brown) – Na Filter
34 Boxes Remaining | Restock: 66 Boxes

(3) Civlily Kubwa (White) – Bila Filter
42 Boxes Remaining | Restock: 58 Boxes`);
  assert.deepEqual(parts[0].items.map((i) => i.id), ['o1', 'c3', 'c5']);
});

test('LOW STOCK — RESTOCK: all brands in one list, OHIS first, then Civlily, then other brands A-Z, each in the fixed order', () => {
  const parts = t.owner.stockAlerts({
    items: [
      { id: 'z', brand: 'Zig', name: 'Zig Roll', remaining: 2, restock: 18 },
      low(P.civKbBrNa, 47, 53),
      low(P.ohisKbBrBila, 30, 70),
      { id: 'a', brand: 'Afro', name: 'Afro Cones', remaining: 1, restock: 9 },
      low(P.civNdBrBila, 10, 90),
      low(P.ohisNdWhBila, 49, 51),
    ],
  });
  assert.equal(parts.length, 1);
  assert.equal(parts[0].text,
`*LOW STOCK — RESTOCK*

(1) OHIS Ndogo (White) – Bila Filter
49 Boxes Remaining | Restock: 51 Boxes

(2) OHIS Kubwa (Brown) – Bila Filter
30 Boxes Remaining | Restock: 70 Boxes

(3) Civlily Ndogo (Brown) – Bila Filter
10 Boxes Remaining | Restock: 90 Boxes

(4) Civlily Kubwa (Brown) – Na Filter
47 Boxes Remaining | Restock: 53 Boxes

(5) Afro Cones
1 Box Remaining | Restock: 9 Boxes

(6) Zig Roll
2 Boxes Remaining | Restock: 18 Boxes`);
});

test('LOW STOCK — RESTOCK: an empty product sits in its place with 0 Boxes Remaining, nothing else added', () => {
  const [part] = t.owner.stockAlerts({ items: [low(P.civNdBrNa, 34, 66), low(P.ohisNdBrNa, 0, 100), low(P.ohisNdBrBila, -3, 103)] });
  assert.equal(part.text,
`*LOW STOCK — RESTOCK*

(1) OHIS Ndogo (Brown) – Bila Filter
0 Boxes Remaining | Restock: 103 Boxes

(2) OHIS Ndogo (Brown) – Na Filter
0 Boxes Remaining | Restock: 100 Boxes

(3) Civlily Ndogo (Brown) – Na Filter
34 Boxes Remaining | Restock: 66 Boxes`);
  assert.deepEqual(t.owner.stockAlerts({ items: [] }), []);
});

test('LOW STOCK — RESTOCK too long for one message: split between products, (1/2) (2/2), the numbers running on', () => {
  const all = Object.values(P).map((p, k) => low(p, k + 1, 100 - k));
  const parts = t.owner.stockAlerts({ items: [...all].reverse() });
  assert.equal(parts.length, 2);
  parts.forEach((p, i) => {
    assert.ok(p.text.length <= t.MAX_REPORT_CHARS, `part ${i + 1} is ${p.text.length} characters`);
    assert.ok(p.text.startsWith(`*LOW STOCK — RESTOCK (${i + 1}/2)*\n\n(`), p.text.split('\n')[0]);
    // never a product cut in half: every block is a name line and its numbers line
    for (const block of p.text.split('\n\n').slice(1)) assert.match(block, /^\(\d+\) .+\n\d+ Box(es)? Remaining \| Restock: \d+ Box(es)?$/);
  });
  const numbers = parts.flatMap((p) => [...p.text.matchAll(/^\((\d+)\) /gm)].map((m) => Number(m[1])));
  assert.deepEqual(numbers, Array.from({ length: 13 }, (_, i) => i + 1));
  // every product exactly once, OHIS first, in the fixed order across the parts
  assert.deepEqual(parts.flatMap((p) => p.items.map((i) => i.id)), Object.values(P).map((p) => p.id));
  assert.match(parts[1].text, /^\*LOW STOCK — RESTOCK \(2\/2\)\*\n\n\(\d+\) /);
});

test('SETTLEMENT DEADLINE', () => {
  assert.equal(t.owner.settlementDeadline({ order: 'STL-20261110-0001', rep: 'Paul', minutes: 8, outstanding: 30000, rate: 10000 }),
`*SETTLEMENT DEADLINE*
STL-20261110-0001

Rep: Paul

Time Remaining: 8 Minutes
Outstanding: TSh 30,000
Daily Fine: TSh 10,000`);
  assert.match(t.owner.settlementDeadline({ order: 'O', rep: 'P', minutes: 1, outstanding: 0, rate: 1 }), /Time Remaining: 1 Minute\n/);
});

test('EXTENSION GRANTED', () => {
  assert.equal(t.owner.extensionGranted({ rep: 'Paul', deadline: new Date('2026-11-14T11:32:00Z'), rate: 20000 }),
`*EXTENSION GRANTED*

Rep: Paul

Extension: 96 Hours
New Deadline: 14 Nov 2026 | 14:32 EAT

Daily Fine: TSh 20,000`);
});

test('TEST NOTIFICATION', () => {
  assert.equal(t.owner.test(), '*ZELAB — TEST NOTIFICATION*\n\nWhatsApp notifications are working.');
});

// ── the reports ──────────────────────────────────────────────────────────────
const LINK = 'https://www.zelab.site/api/public/report/ckabcdefghijklmnopqrstuvw.pdf?sig=0123456789abcdef0123456789abcdef';
const daily = (over = {}) => ({
  date: '10 November 2026', sales: 1342800, boxesSold: 35, netProfit: 311400, expenses: 109800,
  cashIn: 1242000, cashOut: 957600, cashBalance: 10160000, orders: 12, settlements: 3, returns: 1,
  reps: [{ name: 'Asha Mwinyi', revenue: 558000 }, { name: 'John Kileo', revenue: 300000 }],
  stockValue: 12400000, stockBoxes: 612, alerts: 4, link: LINK, ...over,
});

test('DAILY REPORT', () => {
  assert.equal(t.owner.dailyReport(daily()),
`*ZELAB — DAILY REPORT*
10 November 2026

Sales: TSh 1,342,800 (35 Boxes)
Net Profit: TSh 311,400
Expenses: TSh 109,800

Cash In: TSh 1,242,000
Cash Out: TSh 957,600
Cash Balance: TSh 10,160,000

Orders: 12 | Settlements: 3 | Returns: 1

Top Reps:
Asha TSh 558,000
John TSh 300,000

Stock Value: TSh 12,400,000
Stock Quantity: 612 Boxes

Alerts: 4

Full Report (PDF):
${LINK}`);
});

test('DAILY REPORT: no reps sold, no PDF — those parts disappear, nothing empty is printed', () => {
  const text = t.owner.dailyReport(daily({ reps: [], link: null, alerts: 0 }));
  assert.ok(!text.includes('Top Reps'));
  assert.ok(!text.includes('PDF'));
  assert.match(text, /Alerts: 0$/);
});

const weekly = (over = {}) => ({
  period: '3 Nov – 9 Nov 2026', revenue: 7460000, netProfit: 1730000, expenses: 610000, cashBalance: 10160000,
  growthPct: 15.3, topProduct: { name: 'Pepa King Size', revenue: 2400000 }, topRep: { name: 'Asha Mwinyi', revenue: 3100000 },
  brands: [{ name: 'Pepa', revenue: 4800000 }, { name: 'Hao Gold', revenue: 2100000 }],
  stockValue: 12400000, stockBoxes: 612, alerts: 4, link: LINK, ...over,
});

test('WEEKLY REPORT', () => {
  assert.equal(t.owner.weeklyReport(weekly()),
`*ZELAB — WEEKLY REPORT*
3 Nov – 9 Nov 2026

Revenue: TSh 7,460,000
Net Profit: TSh 1,730,000
Expenses: TSh 610,000
Cash Balance: TSh 10,160,000

Revenue Growth: +15%

Top Product: Pepa King Size — TSh 2,400,000
Top Rep: Asha Mwinyi — TSh 3,100,000

Brand Sales:
Pepa TSh 4,800,000
Hao Gold TSh 2,100,000

Stock Value: TSh 12,400,000
Stock Quantity: 612 Boxes

Alerts: 4

Full Statement (PDF):
${LINK}`);
});

test('WEEKLY REPORT: a fall shows as -8%, no earlier week to compare shows no growth line', () => {
  assert.match(t.owner.weeklyReport(weekly({ growthPct: -8.4 })), /Revenue Growth: -8%/);
  assert.ok(!t.owner.weeklyReport(weekly({ growthPct: null })).includes('Revenue Growth'));
});

test('MONTHLY REPORT uses the same shape under its own title', () => {
  const text = t.owner.monthlyReport(weekly({ period: 'October 2026' }));
  assert.ok(text.startsWith('*ZELAB — MONTHLY REPORT*\nOctober 2026\n\nRevenue: '));
  assert.match(text, /Full Report \(PDF\):\nhttps:\/\//);
});

test('reports always keep the PDF link, even with huge numbers and long names, within what CallMeBot keeps', () => {
  const big = 99999999999;
  const w = t.owner.weeklyReport(weekly({
    revenue: big, netProfit: big, expenses: big, cashBalance: big, stockValue: big, stockBoxes: 999999,
    topProduct: { name: 'Pepa King Size Extra Long Name 33 Leaves', revenue: big },
    topRep: { name: 'Mama Neema wa Kariakoo ya Mashariki', revenue: big },
    brands: [1, 2, 3, 4, 5].map((i) => ({ name: `A Very Long Brand Name ${i}`, revenue: big })),
  }));
  assert.ok(w.endsWith(LINK), 'the link is the last thing and is never cut');
  assert.ok(w.length <= t.MAX_REPORT_CHARS, `weekly is ${w.length} characters`);
  const d = t.owner.dailyReport(daily({
    sales: big, netProfit: big, expenses: big, cashIn: big, cashOut: big, cashBalance: big, stockValue: big, stockBoxes: 999999,
    reps: [1, 2, 3].map((i) => ({ name: `Averyveryverylongfirstname${i}`, revenue: big })),
  }));
  assert.ok(d.endsWith(LINK));
  assert.ok(d.length <= t.MAX_REPORT_CHARS, `daily is ${d.length} characters`);
  // and the normal ones are comfortably inside
  assert.ok(t.owner.weeklyReport(weekly()).length < 600);
  assert.ok(t.owner.dailyReport(daily()).length < 600);
});

// ── to a rep ─────────────────────────────────────────────────────────────────
test('SETTLEMENT APPROVED (rep)', () => {
  assert.equal(t.repText({ kind: 'SETTLEMENT_APPROVED', boxes: 10, product: 'Pepa King Size', amount: 380000, earned: 20000, available: 210000, closed: false, order: 'STL-20261110-0001' }),
`*SETTLEMENT APPROVED*

10 Boxes of Pepa King Size
Payment: TSh 380,000

Commission Earned: TSh 20,000
Available Balance: TSh 210,000

ZELab`);
});

test('SETTLEMENT APPROVED says when the order is now closed, and copes with no commission figures', () => {
  const text = t.repText({ kind: 'SETTLEMENT_APPROVED', boxes: 1, product: 'P', amount: 1000, earned: null, available: null, closed: true, order: 'STL-1' });
  assert.equal(text, '*SETTLEMENT APPROVED*\n\n1 Box of P\nPayment: TSh 1,000\n\nOrder STL-1 is now fully closed.\n\nZELab');
});

test('SETTLEMENT DEADLINE NEAR (rep) — first reminder is Nino\'s text; the later two are firmer', () => {
  assert.equal(t.repText({ kind: 'DEADLINE_NEAR', order: 'STL-20261110-0001', stage: 1 }),
`*SETTLEMENT DEADLINE NEAR*

Order: STL-20261110-0001

Your settlement deadline is approaching. Please settle your order.

ZELab`);
  assert.match(t.repText({ kind: 'DEADLINE_NEAR', order: 'O', stage: 2 }), /^\*SETTLEMENT FINAL REMINDER\*\n\nOrder: O\n\n/);
  assert.match(t.repText({ kind: 'DEADLINE_NEAR', order: 'O', stage: 3 }), /^\*SETTLEMENT DEADLINE URGENT\*\n\nOrder: O\n\n/);
});

// Audit, 12 Nov 2026: no reminder said when the order is due or the fine that starts then.
test('SETTLEMENT DEADLINE reminders give the deadline and the daily fine', () => {
  assert.equal(t.repText({ kind: 'DEADLINE_NEAR', order: 'STL-20261112-0018', stage: 2, deadline: at, rate: 10000 }),
`*SETTLEMENT FINAL REMINDER*

Order: STL-20261112-0018
Deadline: 10 Nov 2026 | 14:32 EAT
Daily Fine After Deadline: TSh 10,000

Your settlement deadline is very close. Settle or return your order now.

ZELab`);
  for (const stage of [1, 3]) {
    const text = t.repText({ kind: 'DEADLINE_NEAR', order: 'O', stage, deadline: at, rate: 20000 });
    assert.match(text, /\n\nOrder: O\nDeadline: 10 Nov 2026 \| 14:32 EAT\nDaily Fine After Deadline: TSh 20,000\n\n/);
    assert.doesNotMatch(text, /auto-processed/);
  }
});

test('LATE SETTLEMENT FINE (rep)', () => {
  assert.equal(t.repText({ kind: 'LATE_FINE', fine: 10000, order: 'STL-20261110-0001', days: 1 }),
`*LATE SETTLEMENT FINE*

Fine Applied: TSh 10,000

Order: STL-20261110-0001
Overdue: 1 Day

ZELab`);
  assert.match(t.repText({ kind: 'LATE_FINE', fine: 20000, order: 'O', days: 2 }), /Overdue: 2 Days/);
});

test('STOCK REQUEST APPROVED (rep)', () => {
  assert.equal(t.repText({ kind: 'STOCK_REQUEST_APPROVED', request: 'SR-0001' }),
`*STOCK REQUEST APPROVED*

Request: SR-0001

Your stock request has been approved and issued.

ZELab`);
});

// Audit, 11 Nov 2026: a part-approval was never told. The order, its deadline and every product are
// added to Nino's sample; a cut line reads "N of M", a dropped one "0 of M".
test('STOCK REQUEST APPROVED (rep) with its order, deadline and a part-approval', () => {
  assert.equal(t.repText({
    kind: 'STOCK_REQUEST_APPROVED',
    request: 'REQ-20261111-0001',
    order: 'STL-20261111-0001',
    deadline: at,
    items: [
      { name: 'Civlily Ndogo (Brown) Bila Filter', approved: 3, requested: 4, unit: 'Box' },
      { name: 'OHIS Kubwa (Brown) Na Filter', approved: 2, requested: 2, unit: 'Box' },
      { name: 'OHIS Ndogo (White) Bila Filter', approved: 0, requested: 1, unit: 'Carton' },
    ],
  }),
`*STOCK REQUEST APPROVED*

Request: REQ-20261111-0001
Order: STL-20261111-0001
Deadline: 10 Nov 2026 | 14:32 EAT

OHIS
(1) Ndogo (White) Bila Filter: 0 of 1 Carton
(2) Kubwa (Brown) Na Filter: 2 Boxes

Civlily
(3) Ndogo (Brown) Bila Filter: 3 of 4 Boxes

Your stock request has been approved and issued.
Some products were approved in a smaller quantity than you asked for.

ZELab`);
  // Everything approved as asked: no "of", no extra sentence.
  const full = t.repText({ kind: 'STOCK_REQUEST_APPROVED', request: 'R', order: 'O', deadline: at, items: [{ name: 'P', approved: 2, requested: 2, unit: 'Box' }] });
  assert.match(full, /\(1\) P: 2 Boxes\n\nYour stock request has been approved and issued\.\n\nZELab$/);
  // A very long request keeps the order and deadline and drops products from the end.
  const many = Array.from({ length: 40 }, (_, k) => ({ name: `OHIS Pepa Kubwa (Brown) – Bila Filter ${k}`, approved: 1, requested: 2, unit: 'Box' }));
  const long = t.repText({ kind: 'STOCK_REQUEST_APPROVED', request: 'R', order: 'STL-1', deadline: at, items: many });
  assert.ok(long.length <= 700, `${long.length} characters`);
  assert.match(long, /Order: STL-1\nDeadline: /);
  assert.match(long, /\+\d+ more, see ZELab/);
});

// Audit, 12 Nov 2026: a request split between two cities listed the same product twice with nothing to
// tell the lines apart. Each line now says its city, as on the owner's STOCK REQUEST; one city says none.
test('STOCK REQUEST APPROVED (rep): a request split between cities says each line\'s city', () => {
  const items = [
    { name: 'Civlily Kubwa (Brown) Na Filter', approved: 2, requested: 2, unit: 'Box', city: 'Arusha' },
    { name: 'Civlily Ndogo (Brown) Na Filter', approved: 1, requested: 1, unit: 'Box', city: 'Arusha' },
    { name: 'Civlily Kubwa (Brown) Na Filter', approved: 1, requested: 1, unit: 'Box', city: 'Dodoma' },
    { name: 'OHIS Ndogo (Brown) Na Filter', approved: 1, requested: 2, unit: 'Box', city: 'Dodoma' },
  ];
  const text = t.repText({ kind: 'STOCK_REQUEST_APPROVED', request: 'REQ-20261112-0007', order: 'STL-20261112-0018', deadline: at, items });
  assert.match(text, /\n\nOHIS\n\(1\) Ndogo \(Brown\) Na Filter: 1 of 2 Boxes · Dodoma\n\nCivlily\n\(2\) Ndogo \(Brown\) Na Filter: 1 Box · Arusha\n\(3\) Kubwa \(Brown\) Na Filter: 2 Boxes · Arusha\n\(4\) Kubwa \(Brown\) Na Filter: 1 Box · Dodoma\n/);
  // One city only (or old requests with no city): no city on the lines.
  const one = t.repText({ kind: 'STOCK_REQUEST_APPROVED', request: 'R', items: items.map((i) => ({ ...i, city: 'Arusha' })) });
  assert.doesNotMatch(one, /·/);
  const none = t.repText({ kind: 'STOCK_REQUEST_APPROVED', request: 'R', items: items.map(({ city, ...i }) => i) });
  assert.doesNotMatch(none, /·/);
});

// Audit, 11 Nov 2026: the admin changing a rep's pending request went out in the general wording, every
// product on one line, and about 12 products passed CallMeBot's ~700 characters and lost the total.
test('STOCK REQUEST CHANGED (rep): one line per product, and a long list never loses the total', () => {
  assert.equal(t.repText({
    kind: 'STOCK_REQUEST_CHANGED',
    request: 'REQ-20261111-0001',
    by: 'Doctor',
    items: [
      { name: 'Civlily Ndogo (Brown) Bila Filter', quantity: 3, unit: 'Box' },
      { name: 'OHIS Ndogo (White) Bila Filter', quantity: 1, unit: 'Carton' },
    ],
    total: 8500,
  }),
`*STOCK REQUEST CHANGED*

Request: REQ-20261111-0001
Changed by: Doctor

OHIS
(1) Ndogo (White) Bila Filter: 1 Carton

Civlily
(2) Ndogo (Brown) Bila Filter: 3 Boxes

Total Value: TSh 8,500

Your pending request has been changed. This is what it is now.

ZELab`);
  const many = Array.from({ length: 40 }, (_, k) => ({ name: `OHIS Pepa Kubwa (Brown) – Bila Filter ${k}`, quantity: 2, unit: 'Box' }));
  const long = t.repText({ kind: 'STOCK_REQUEST_CHANGED', request: 'REQ-20261111-0001', by: 'Doctor', items: many, total: 1234500 });
  assert.ok(long.length <= 700, `${long.length} characters`);
  assert.match(long, /\+\d+ more, see ZELab\n\nTotal Value: TSh 1,234,500\n\nYour pending request has been changed\. This is what it is now\.\n\nZELab$/);
  // 12 products, the size that used to lose its end, all fit or end the same way.
  const twelve = t.repText({ kind: 'STOCK_REQUEST_CHANGED', request: 'REQ-20261111-0001', by: 'Doctor', items: many.slice(0, 12), total: 1234500 });
  assert.ok(twelve.length <= 700, `${twelve.length} characters`);
  assert.match(twelve, /Total Value: TSh 1,234,500\n\n.*\n\nZELab$/);
});

test('every rep template is plain text in the same frame: capitals title, blank line, ZELab at the foot, no emoji', () => {
  const sample = {
    request: 'SR-1', reason: 'r', product: 'P', boxes: 2, order: 'STL-1', attached: true, amount: 1000, earned: 1, available: 1, closed: false,
    stage: 2, fine: 1, days: 1, deadline: at, rate: 1, returnFine: 1, extensionCancelled: true, dailyFine: 1, overdueNow: true,
    number: 'RET-1', hours: 24, minimum: 1, bonus: 1, target: 1, nextTarget: 2, nextBonus: 3,
  };
  for (const kind of Object.keys(t.repTexts)) {
    const text = t.repText({ kind, ...sample });
    const [title, blank] = text.split('\n');
    assert.equal(title, title.toUpperCase(), `${kind}: title in capitals`);
    assert.ok(title.length > 0 && !/[a-z]/.test(title.replace(/ZELab/, '')) || kind === 'TEST', `${kind}: title`);
    assert.equal(blank, '', `${kind}: blank line after the title`);
    assert.ok(text.endsWith('\n\nZELab'), `${kind}: ends with ZELab`);
    assert.ok(!/[\u{1F000}-\u{1FFFF}\u{2190}-\u{2BFF}️]/u.test(text), `${kind}: no emoji`);
    assert.ok(!/undefined|null|NaN|\[object/.test(text), `${kind}: no stray undefined/null/NaN`);
    assert.ok(text.length <= 700, `${kind}: ${text.length} characters`);
  }
});

test('an alert nobody wrote a template for still goes out in the same shape, without the bell emoji', () => {
  assert.equal(t.repText(undefined, { title: '📦 New thing', message: 'Something happened.' }), '*NEW THING*\n\nSomething happened.\n\nZELab');
});

test('no owner template contains an emoji either', () => {
  const all = [
    t.owner.stockRequest({ by: 'A', items: [{ name: 'P', qty: 1 }], total: 1, when: at }),
    t.owner.settlementSubmitted({ by: 'A', order: 'O', product: 'P', boxes: 1, amount: 1, method: 'x', commission: 1, when: at }),
    t.owner.returnRequest({ by: 'A', order: 'O', items: [{ name: 'P', quantity: 1 }], reason: 'r' }),
    t.owner.commissionReady({ rep: 'A', available: 1, earned: 1, penalties: 1, minimum: 1 }),
    ...t.owner.stockAlerts({ items: [{ name: 'P', brand: 'B', remaining: 1, restock: 1 }, { name: 'Q', remaining: 0, restock: 2 }] }).map((p) => p.text),
    t.owner.settlementDeadline({ order: 'O', rep: 'R', minutes: 1, outstanding: 1, rate: 1 }),
    t.owner.extensionGranted({ rep: 'R', deadline: at, rate: 1 }),
    t.owner.dailyReport(daily()), t.owner.weeklyReport(weekly()), t.owner.monthlyReport(weekly()), t.owner.test(),
  ];
  for (const text of all) assert.ok(!/[\u{1F000}-\u{1FFFF}\u{2190}-\u{2BFF}️]/u.test(text), text.split('\n')[0]);
});

// ── the heading is bold (Nino, 10 Nov 2026) ──────────────────────────────────
test('the heading of every message is bold in WhatsApp (*TITLE*) and nothing else is', () => {
  const sample = {
    request: 'SR-1', reason: 'r', product: 'P', boxes: 2, order: 'STL-1', attached: true, amount: 1000, earned: 1, available: 1, closed: true,
    stage: 1, fine: 1, days: 1, deadline: at, rate: 1, returnFine: 1, extensionCancelled: true, dailyFine: 1, overdueNow: true,
    number: 'RET-1', hours: 24, minimum: 1, bonus: 1, target: 1, nextTarget: 2, nextBonus: 3,
  };
  const texts = Object.keys(t.repTexts).map((kind) => [`rep ${kind}`, t.repText({ kind, ...sample })]);
  texts.push(['rep fallback', t.repText(undefined, { title: 'Anything', message: 'Words.' })]);
  texts.push(
    ['stockRequest', t.owner.stockRequest({ by: 'A', items: [{ name: 'P', qty: 1 }], total: 1, when: at })],
    ['settlementSubmitted', t.owner.settlementSubmitted({ by: 'A', order: 'O', product: 'P', boxes: 1, amount: 1, method: 'x', commission: 1, when: at })],
    ['returnRequest', t.owner.returnRequest({ by: 'A', order: 'O', items: [{ name: 'P', quantity: 1 }], reason: 'r' })],
    ['returnRequest (several)', t.owner.returnRequest({ by: 'A', items: [{ name: 'P', quantity: 1 }, { name: 'Q', quantity: 2 }] })],
    ['commissionReady', t.owner.commissionReady({ rep: 'A', available: 1, earned: 1, penalties: 1, minimum: 1 })],
    ['stockAlerts', t.owner.stockAlerts({ items: [{ name: 'P', brand: 'B', remaining: 1, restock: 1 }, { name: 'Q', remaining: 0, restock: 2 }] })[0].text],
    ['settlementDeadline', t.owner.settlementDeadline({ order: 'O', rep: 'R', minutes: 1, outstanding: 1, rate: 1 })],
    ['extensionGranted', t.owner.extensionGranted({ rep: 'R', deadline: at, rate: 1 })],
    ['dailyReport', t.owner.dailyReport(daily())],
    ['weeklyReport', t.owner.weeklyReport(weekly())],
    ['monthlyReport', t.owner.monthlyReport(weekly())],
    ['test', t.owner.test()],
  );
  for (const [name, text] of texts) {
    const [first, ...rest] = text.split('\n');
    assert.match(first, /^\*[^*\n]+\*$/, `${name}: the first line is the bold heading`);
    assert.ok(!rest.join('\n').includes('*'), `${name}: nothing below the heading is bold`);
  }
});

test('the bold heading changes nothing else: the rest of Nino\'s sample is untouched', () => {
  const text = t.repText({ kind: 'STOCK_REQUEST_APPROVED', request: 'SR-0001' });
  assert.equal(text.replace(/\*/g, ''), 'STOCK REQUEST APPROVED\n\nRequest: SR-0001\n\nYour stock request has been approved and issued.\n\nZELab');
});

// ── room to breathe (Nino, 10 Nov 2026: the settlement text "looked crowded") ──
test('no alert is a wall of text: every block is at most 4 lines, with a blank line between blocks', () => {
  const sample = {
    request: 'SR-1', reason: 'r', product: 'P', boxes: 2, order: 'STL-1', attached: true, amount: 1000, earned: 1, available: 1, closed: true,
    stage: 1, fine: 1, days: 1, deadline: at, rate: 1, returnFine: 1, extensionCancelled: true, dailyFine: 1, overdueNow: true,
    number: 'RET-1', hours: 24, minimum: 1, bonus: 1, target: 1, nextTarget: 2, nextBonus: 3,
  };
  const texts = Object.keys(t.repTexts).map((kind) => [`rep ${kind}`, t.repText({ kind, ...sample })]);
  texts.push(
    ['stockRequest', t.owner.stockRequest({ by: 'A', items: [{ name: 'P', qty: 1 }], total: 1, when: at })],
    ['stockRequest (several)', t.owner.stockRequest({ by: 'A', items: [{ name: 'P', qty: 1 }, { name: 'Q', qty: 2 }], total: 1, when: at })],
    ['settlementSubmitted', t.owner.settlementSubmitted({ by: 'Mrema', order: 'STL-20261101-0001', product: 'OHIS Pepa Ndogo (White) – Bila Filter', boxes: 2, amount: 60000, method: 'M-Pesa', commission: 10000, when: at })],
    ['returnRequest', t.owner.returnRequest({ by: 'A', order: 'O', items: [{ name: 'P', quantity: 1 }], reason: 'r' })],
    ['commissionReady', t.owner.commissionReady({ rep: 'A', available: 1, earned: 1, penalties: 1, minimum: 1 })],
    ['stockAlerts', t.owner.stockAlerts({ items: [{ name: 'P', brand: 'B', remaining: 1, restock: 1 }, { name: 'Q', remaining: 0, restock: 2 }] })[0].text],
    ['settlementDeadline', t.owner.settlementDeadline({ order: 'O', rep: 'R', minutes: 1, outstanding: 1, rate: 1 })],
    ['extensionGranted', t.owner.extensionGranted({ rep: 'R', deadline: at, rate: 1 })],
  );
  for (const [name, text] of texts) {
    assert.ok(!/\n\n\n/.test(text), `${name}: never two blank lines in a row`);
    for (const block of text.split('\n\n')) {
      assert.ok(block.split('\n').length <= 4, `${name}: a block of ${block.split('\n').length} lines —\n${block}`);
    }
  }
});

// ── several products in one settlement message ───────────────────────────────
test('SETTLEMENT SUBMITTED with several products: (1) / (2) with Boxes Sold, the total, then the money', () => {
  assert.equal(t.owner.settlementSubmitted({
    by: 'Mrema', order: 'STL-20261101-0001', when: at, commission: 15000,
    items: [{ product: 'OHIS Pepa Ndogo (White) – Bila Filter', boxes: 2 }, { product: 'Civlily Pepa Kubwa (Brown) – Bila Filter', boxes: 1 }],
    payments: [{ method: 'M-Pesa', amount: 60000 }, { method: 'Airtel Money', amount: 35000 }],
  }),
`*SETTLEMENT SUBMITTED*

By: Mrema
Order: STL-20261101-0001

(1) OHIS Pepa Ndogo (White) – Bila Filter
Boxes Sold: 2

(2) Civlily Pepa Kubwa (Brown) – Bila Filter
Boxes Sold: 1

Total Boxes: 3

Payment: TSh 60,000 (M-Pesa)
Payment: TSh 35,000 (Airtel Money)
Commission: TSh 15,000`);
});

test('SETTLEMENT SUBMITTED, a very long batch keeps the total and the money; only the list gives way', () => {
  const items = Array.from({ length: 16 }, (_, n) => ({ product: `OHIS Pepa Ndogo (Colour ${n + 1}) – Bila Filter`, boxes: 2 }));
  const text = t.owner.settlementSubmitted({ by: 'Mrema', order: 'STL-1', when: at, commission: 160000, items, payments: [{ method: 'M-Pesa', amount: 960000 }] });
  assert.ok(text.length <= t.MAX_REPORT_CHARS, `${text.length} characters`);
  assert.match(text, /\+\d+ more, see ZELab\n\nTotal Boxes: 32\n\nPayment: TSh 960,000 \(M-Pesa\)\nCommission: TSh 160,000$/);
});

// Nino's own sample (11 Nov 2026): one product is lettered too.
test('SETTLEMENT SUBMITTED for one product reads exactly like the owner\'s sample', () => {
  assert.equal(t.owner.settlementSubmitted({ by: 'Nyoya', order: 'STL-20261110-0001', product: 'OHIS Pepa Ndogo (Brown) – Bila Filter', boxes: 1, amount: 30000, method: 'M-Pesa', commission: 5000, when: at }),
`*SETTLEMENT SUBMITTED*

By: Nyoya
Order: STL-20261110-0001

(1) OHIS Pepa Ndogo (Brown) – Bila Filter
Boxes Sold: 1

Payment: TSh 30,000 (M-Pesa)
Commission: TSh 5,000`);
});

// Nino, 12 Nov 2026: "no date or time on any text" — the date and time a message was made never shows
// (deadlines and a report's own day stay: he chose to keep them), and list numbers carry no dash.
test('no WhatsApp text shows when it was sent, and list numbers are "(1) Name" without a dash', () => {
  const at = new Date('2026-11-12T12:23:00Z');
  const texts = [
    t.owner.stockRequest({ by: 'Mrema', city: 'Arusha', items: [{ name: 'OHIS Ndogo (Brown) Bila Filter', qty: 1 }, { name: 'OHIS Ndogo (White) Bila Filter', qty: 1 }], total: 72000, when: at }),
    t.owner.settlementSubmitted({ by: 'Mrema', order: 'STL-1', product: 'OHIS Ndogo (Brown) – Bila Filter', boxes: 2, amount: 70000, method: 'M-Pesa', when: at }),
    t.owner.settlementSubmitted({ by: 'Mrema', order: 'STL-1', when: at, items: [{ product: 'A', boxes: 1 }, { product: 'B', boxes: 2 }], payments: [{ amount: 5, method: 'M-Pesa' }] }),
  ];
  for (const text of texts) {
    assert.ok(!/\b(Nov|2026|EAT)\b|\d{1,2}:\d{2}/.test(text), `no date or time:\n${text}`);
    assert.ok(!/\(\d+\)-/.test(text), `no dash after the number:\n${text}`);
  }
  assert.equal(texts[0], '*STOCK REQUEST*\n\nBy: Mrema\nCity: Arusha\n\nOHIS\n(1) Ndogo (Brown) Bila Filter: 1 Box\n(2) Ndogo (White) Bila Filter: 1 Box\n\nTotal Boxes: 2\nTotal Value: TSh 72,000');
});

// Nino, 12 Nov 2026: "(3) OHIS Ndogo (Brown) Na Filter: 11 Boxes" ran onto two lines on his phone (about 43
// characters fit). Lists now stand under their brand, written once, so every product is one short line.
test('lists stand under their brand (OHIS, then Civlily) and every product line fits one phone line', () => {
  const n = (name, qty) => ({ name, qty });
  assert.equal(t.owner.stockRequest({
    by: 'Mrema',
    city: 'Arusha',
    items: [n('OHIS Ndogo (Brown) Bila Filter', 1), n('OHIS Ndogo (White) Bila Filter', 1), n('OHIS Ndogo (Brown) Na Filter', 11),
      n('OHIS Kubwa (Brown) Na Filter', 11), n('OHIS Kubwa (Brown) Bila Filter', 4), n('Civlily Ndogo (Brown) Bila Filter', 5)],
    total: 1289000,
  }),
`*STOCK REQUEST*

By: Mrema
City: Arusha

OHIS
(1) Ndogo (Brown) Bila Filter: 1 Box
(2) Ndogo (White) Bila Filter: 1 Box
(3) Ndogo (Brown) Na Filter: 11 Boxes
(4) Kubwa (Brown) Na Filter: 11 Boxes
(5) Kubwa (Brown) Bila Filter: 4 Boxes

Civlily
(6) Ndogo (Brown) Bila Filter: 5 Boxes

Total Boxes: 33
Total Value: TSh 1,289,000`);
  // Every product we sell, 99 boxes each, in one request: all shown, no line longer than 41 characters.
  const all = ['OHIS Ndogo (Brown) Bila Filter', 'OHIS Ndogo (White) Bila Filter', 'OHIS Ndogo (Brown) Na Filter', 'OHIS Kubwa (Brown) Na Filter',
    'OHIS Kubwa (Brown) Bila Filter', 'Civlily Ndogo (Brown) Bila Filter', 'Civlily Ndogo (White) Bila Filter', 'Civlily Ndogo (Brown) Na Filter',
    'Civlily Kubwa (Brown) Bila Filter', 'Civlily Kubwa (White) Bila Filter', 'Civlily Kubwa (Brown) Na Filter', 'Civlily Kubwa (Mix) Na Filter',
    'Civlily Ndogo (Mix) Bila Filter'];
  const texts = [
    t.owner.stockRequest({ by: 'Mrema', items: all.reverse().map((name) => n(name, 99)), total: 1 }),
    t.owner.returnRequest({ by: 'Mrema', items: all.map((name) => ({ name, quantity: 99 })) }),
    t.repText({ kind: 'STOCK_ISSUED', transfer: 'TRF-1', items: all.map((name) => ({ name, quantity: 99, unit: 'Box' })) }),
  ];
  for (const text of texts) {
    assert.ok(!text.includes('more, see ZELab'), 'all 13 products shown');
    assert.match(text, /\n\nOHIS\n\(1\) Ndogo \(Brown\) Bila Filter: 99 Boxes\n/);
    assert.match(text, /\n\nCivlily\n\(6\) Ndogo \(Brown\) Bila Filter: 99 Boxes\n/);
    const productLines = text.split('\n').filter((l) => /^\(\d+\) /.test(l));
    assert.equal(productLines.length, 13);
    for (const l of productLines) assert.ok(l.length <= 41, `too long for one phone line: "${l}"`);
  }
});

// ── a rep asked to be paid (Nino, 14 Nov 2026: the full details, so the money can be sent from the text) ──
test('COMMISSION WITHDRAWAL REQUEST: rep, amount, and the mobile money number and name in full', () => {
  assert.equal(t.owner.withdrawalRequested({ rep: 'Juma Hassan', amount: 268500, source: 'COMMISSION', payTo: 'Mobile money · 0754123456 · Juma Hassan' }),
`*COMMISSION WITHDRAWAL REQUEST*

Rep: Juma Hassan
Amount: TSh 268,500

Pay By: Mobile Money
Number: 0754123456
Name: Juma Hassan

Status: Waiting for your approval`);
});

test('BONUS WITHDRAWAL REQUEST to a bank: the bank, the account number and the name', () => {
  assert.equal(t.owner.withdrawalRequested({ rep: 'Asha Mwinyi', amount: 150000, source: 'BONUS', payTo: 'Bank · CRDB · 0150123456789 · Asha Mwinyi' }),
`*BONUS WITHDRAWAL REQUEST*

Rep: Asha Mwinyi
Amount: TSh 150,000

Pay By: Bank (CRDB)
Account: 0150123456789
Name: Asha Mwinyi

Status: Waiting for your approval`);
});

test('WITHDRAWAL REQUEST with a note in another shape: shown as written; below the minimum is said', () => {
  assert.equal(t.owner.withdrawalRequested({ rep: 'Juma Hassan', amount: 30000, payTo: 'Cash at the Lab', belowMinimum: true }),
`*COMMISSION WITHDRAWAL REQUEST*

Rep: Juma Hassan
Amount: TSh 30,000
Below Minimum: one-off window

Pay To: Cash at the Lab

Status: Waiting for your approval`);
});
