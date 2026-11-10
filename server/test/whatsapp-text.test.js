'use strict';

// The WhatsApp texts. Run with: npm test
//
// The expected strings below are the samples Nino wrote on 10 Nov 2026, word for
// word. If one of these fails, the wording drifted from what he approved.
// (Trailing spaces in his paste are dropped: WhatsApp ignores them.)

const test = require('node:test');
const assert = require('node:assert/strict');
const t = require('../src/services/whatsappText');

const at = new Date('2026-11-10T11:32:00Z'); // 14:32 in Tanzania

// ── to the owner ─────────────────────────────────────────────────────────────
test('STOCK REQUEST', () => {
  assert.equal(t.owner.stockRequest({ by: 'Asha Mwinyi', items: [{ name: 'Pepa King Size', qty: 20 }], total: 760000, when: at }),
`*STOCK REQUEST*
10 Nov 2026 | 14:32 EAT

By: Asha Mwinyi

Pepa King Size: 20 Boxes
Total Value: TSh 760,000`);
});

test('STOCK REQUEST with a single box and several products', () => {
  const text = t.owner.stockRequest({ by: 'Asha', items: [{ name: 'A', qty: 1 }, { name: 'B', qty: 3, unit: 'Carton' }], total: 5, when: at });
  assert.match(text, /\nA: 1 Box\nB: 3 Cartons\nTotal Value: TSh 5$/);
});

test('SETTLEMENT SUBMITTED', () => {
  assert.equal(t.owner.settlementSubmitted({ by: 'Asha Mwinyi', order: 'STL-20261110-0001', product: 'Pepa King Size', boxes: 10, amount: 380000, method: 'CRDB', commission: 20000, when: at }),
`*SETTLEMENT SUBMITTED*
10 Nov 2026

By: Asha Mwinyi
Order: STL-20261110-0001
Product: Pepa King Size
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
  assert.equal(t.owner.returnRequest({ by: 'Asha Mwinyi', order: 'STL-20261110-0001', items: [{ name: 'Pepa Roll', quantity: 4 }], reason: 'Damaged' }),
`*RETURN REQUEST*

By: Asha Mwinyi
Order: STL-20261110-0001
Product: Pepa Roll
Quantity: 4 Boxes
Reason: Damaged`);
});

test('RETURN REQUEST with several products gives each its own Product / Quantity', () => {
  const text = t.owner.returnRequest({ by: 'W', order: null, items: [{ name: 'A', quantity: 1 }, { name: 'B', quantity: 2 }], reason: null });
  assert.equal(text, '*RETURN REQUEST*\n\nBy: W\n\nProduct: A\nQuantity: 1 Box\n\nProduct: B\nQuantity: 2 Boxes');
});

test('COMMISSION READY', () => {
  assert.equal(t.owner.commissionReady({ rep: 'Asha Mwinyi', available: 210000, earned: 460000, penalties: 10000, minimum: 100000 }),
`*COMMISSION READY*

Rep: Asha Mwinyi
Available: TSh 210,000
Earned: TSh 460,000
Penalties: TSh 10,000
Minimum Withdrawal: TSh 100,000`);
  assert.ok(!t.owner.commissionReady({ rep: 'A', available: 1, earned: 1, penalties: 0, minimum: 1 }).includes('Penalties'));
});

test('LOW STOCK', () => {
  assert.equal(t.owner.lowStock({ product: 'Pepa Roll', remaining: 6, level: 10, suggested: 14, high: true }),
`*LOW STOCK*

Product: Pepa Roll
Remaining: 6 Boxes
Reorder Level: 10 Boxes
Suggested Restock: 14 Boxes
Priority: High`);
  assert.match(t.owner.lowStock({ product: 'P', remaining: 1, level: 10, suggested: 19, high: false }), /Remaining: 1 Box\n.*\nSuggested Restock: 19 Boxes\nPriority: Medium$/s);
});

test('OUT OF STOCK', () => {
  assert.equal(t.owner.outOfStock({ product: 'Pepa Roll', brand: 'Pepa', lastSale: new Date('2026-11-09T13:10:00Z'), suggested: 20 }),
`*OUT OF STOCK*

Product: Pepa Roll
Brand: Pepa
Warehouse Stock: 0 Boxes
Last Sale: 9 Nov 2026 | 16:10 EAT
Suggested Restock: 20 Boxes`);
  const bare = t.owner.outOfStock({ product: 'P', brand: null, lastSale: null, suggested: 4 });
  assert.ok(!bare.includes('Brand') && !bare.includes('Last Sale'));
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
    t.owner.lowStock({ product: 'P', remaining: 1, level: 1, suggested: 1, high: true }),
    t.owner.outOfStock({ product: 'P', brand: 'B', lastSale: at, suggested: 1 }),
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
    ['lowStock', t.owner.lowStock({ product: 'P', remaining: 1, level: 1, suggested: 1, high: true })],
    ['outOfStock', t.owner.outOfStock({ product: 'P', brand: 'B', lastSale: at, suggested: 1 })],
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
  assert.equal(text.replace(/\*/g, ''), 'STOCK REQUEST APPROVED\n\nRequest: SR-0001\nYour stock request has been approved and issued.\n\nZELab');
});
