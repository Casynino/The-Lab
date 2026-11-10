'use strict';

// ===========================================================================
// The daily, weekly and monthly report PDFs.
//
// One composition, three lengths: the same parts in the same order, so a reader
// who knows the weekly report can read the daily one at a glance. Every number
// arrives already worked out in `d` (see reportData.service.js and the three
// builders); this file decides only what to show and how.
//
//   d = { period{label,key}, generatedAt, finance{…}, extras{…}, brands, topProducts,
//         repPerformance?, accounts, cashPosition, stock, movement, settlements, pending,
//         attention, supplierDue, commission?, growth?, metrics? }
// ===========================================================================

const { createReport, pct, tsh, n0 } = require('./reportKit');

const logo = () => require('../assets/zelabLogo').dark;
const oneDp = (v) => `${(Math.round((Number(v) || 0) * 10) / 10).toFixed(1)}%`;
const share = (part, whole) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);
const signed = (v) => (v > 0 ? `+${n0(v)}` : v < 0 ? `-${n0(-v)}` : '0');
const plural = (n, one, many) => `${n0(n)} ${n === 1 ? one : many}`;

// What differs between the three: wording and the little chart.
const KINDS = {
  daily: {
    kind: 'Daily report',
    title: 'Daily business report',
    blurb: (d) => `Everything sold, spent and moved through the business accounts on ${d.period.label}. The arrows compare with the day before.`,
    compare: 'the day before',
    chart: { title: 'Last 7 days', sub: 'sales per day, today in red' },
  },
  weekly: {
    kind: 'Weekly report',
    title: 'Weekly business report',
    blurb: (d) => `Everything sold, spent and moved through the business accounts from ${d.period.label}. The arrows compare with the week before.`,
    compare: 'the week before',
    chart: { title: 'Sales by day', sub: 'best day in red' },
  },
  monthly: {
    kind: 'Monthly report',
    title: 'Monthly business report',
    blurb: (d) => `Everything sold, spent and moved through the business accounts in ${d.period.label}. The arrows compare with ${d.prevLabel || 'the month before'}.`,
    compare: null, // taken from d.prevLabel
    chart: { title: 'Sales by day', sub: 'best day in red' },
  },
};

function headlineFigures(d) {
  const f = d.finance;
  const ex = d.extras;
  const p = ex.prev;
  const dl = (cur, prev) => (p ? pct(cur, prev) : null);
  const gm = share(f.grossProfit, f.revenue);
  return [
    { label: 'Revenue', value: tsh(f.revenue), delta: dl(f.revenue, p?.revenue), sub: plural(ex.orders, 'sale', 'sales') },
    { label: 'Gross profit', value: tsh(f.grossProfit), delta: dl(f.grossProfit, p?.grossProfit), sub: `${oneDp(gm)} margin` },
    { label: 'Expenses', value: tsh(f.expenses), delta: dl(f.expenses, p?.expenses), invert: true },
    { label: 'Net profit', value: tsh(f.netProfit), delta: dl(f.netProfit, p?.netProfit), tone: f.netProfit < 0 ? 'bad' : f.netProfit > 0 ? 'good' : undefined },
    { label: 'Money in', value: tsh(f.moneyIn), delta: dl(f.moneyIn, p?.moneyIn) },
    { label: 'Money out', value: tsh(f.moneyOut), delta: dl(f.moneyOut, p?.moneyOut), invert: true },
    { label: 'Net cash flow', value: tsh(f.netCash), tone: f.netCash < 0 ? 'bad' : f.netCash > 0 ? 'good' : undefined },
    { label: 'Boxes sold', value: n0(f.boxesSold), delta: dl(f.boxesSold, p?.boxesSold), sub: 'boxes' },
  ];
}

// The period in a few plain sentences, built only from figures that are printed below.
function inShort(d, cfg) {
  const f = d.finance;
  const ex = d.extras;
  const lines = [];
  if (!(f.revenue > 0) && !ex.orders) {
    lines.push('No sales were recorded in this period.');
  } else {
    const ch = ex.prev ? pct(f.revenue, ex.prev.revenue) : null;
    let s = `Sales came to ${tsh(f.revenue)} from ${plural(ex.orders, 'sale', 'sales')} and ${plural(f.boxesSold, 'box', 'boxes')}`;
    if (ch != null) s += `, ${ch >= 0 ? 'up' : 'down'} ${Math.abs(Math.round(ch))}% on ${cfg.compare || d.prevLabel}`;
    lines.push(`${s}.`);
  }
  lines.push(`Net profit was ${tsh(f.netProfit)}${f.netProfit < 0 ? ' (a loss)' : ''} after ${tsh(f.expenses)} of expenses; ${tsh(f.moneyIn)} came in and ${tsh(f.moneyOut)} went out.`);
  const best = [...ex.byDay].sort((a, b) => b.revenue - a.revenue)[0];
  if (cfg !== KINDS.daily && best && best.revenue > 0 && ex.byDay.length > 1) lines.push(`Best day: ${best.long}, with ${tsh(best.revenue)} in sales.`);
  const brand = [...d.brands].sort((a, b) => b.revenue - a.revenue)[0];
  if (brand && brand.revenue > 0) lines.push(`${brand.name} led the brands with ${tsh(brand.revenue)}, ${oneDp(share(brand.revenue, f.revenue))} of sales.`);
  const top = d.topProducts[0];
  if (top && top.revenue > 0) lines.push(`Most sold product: ${top.name}${top.boxes != null ? `, ${plural(top.boxes, 'box', 'boxes')}` : ''}.`);
  const rep = ex.reps[0];
  if (rep) lines.push(`Best sales rep: ${rep.name}, ${tsh(rep.revenue)} from ${plural(rep.boxes, 'box', 'boxes')}.`);
  lines.push(`${tsh(d.cashPosition)} is held across the business accounts.`);
  return lines;
}

function render(kindKey, d) {
  const cfg = KINDS[kindKey];
  const f = d.finance;
  const ex = d.extras;
  const r = createReport({
    kind: cfg.kind,
    title: cfg.title,
    period: d.period.label,
    number: d.number,
    generatedAt: d.generatedAt,
    blurb: cfg.blurb(d),
    logo: logo(),
  });

  r.figures(headlineFigures(d));
  r.add(r.callout({ title: 'The period in short', items: inShort(d, cfg), tone: 'insight' }));

  // ── 01 Profit and loss ────────────────────────────────────────────────────
  r.section('Profit and loss', 'what was sold, what the boxes cost and what was left');
  const days = ex.byDay.length || 1;
  const best = [...ex.byDay].sort((a, b) => b.revenue - a.revenue)[0];
  const ratioTiles = [
    { label: 'Gross margin', value: oneDp(share(f.grossProfit, f.revenue)), sub: 'of sales' },
    { label: 'Net margin', value: oneDp(share(f.netProfit, f.revenue)), sub: 'after expenses' },
  ];
  if (kindKey === 'daily') {
    ratioTiles.push(
      { label: 'Sales made', value: n0(ex.orders), sub: 'orders today' },
      { label: 'Average sale', value: tsh(ex.orders ? f.revenue / ex.orders : 0), sub: 'per order' },
    );
  } else {
    ratioTiles.push(
      { label: 'Average per day', value: tsh(f.revenue / days), sub: `over ${plural(days, 'day', 'days')}` },
      { label: 'Best day', value: tsh(best ? best.revenue : 0), sub: best && best.revenue > 0 ? best.long : 'no sales' },
    );
  }
  r.pair(
    r.statement({
      title: 'Profit and loss statement',
      w: r.half,
      rows: [
        { label: 'Sales (revenue)', value: f.revenue },
        { label: 'Cost of the boxes sold', value: -f.cogs, style: 'less' },
        { label: 'Gross profit', value: f.grossProfit, style: 'total' },
        { label: 'Business expenses', value: -f.expenses, style: 'less' },
        { label: 'Net profit', value: f.netProfit, style: 'grand' },
      ],
    }),
    r.highlights({ items: ratioTiles, perRow: 2, w: r.half }),
  );
  r.add(r.columns({
    title: `${cfg.chart.title}  ·  ${cfg.chart.sub}`,
    points: ex.byDay.map((p, i) => ({
      label: kindKey === 'monthly' ? p.day : p.short,
      value: p.revenue,
      highlight: kindKey === 'daily' ? i === ex.byDay.length - 1 : undefined,
    })),
    empty: 'No sales in this period.',
  }));

  // ── 02 Money in and out ───────────────────────────────────────────────────
  r.section('Money in and out', 'cash that really moved through the business accounts');
  const cs = ex.cashStatement;
  const stmtRows = [
    { label: 'Balance at the start', value: cs.opening },
    { label: 'Money in', value: cs.moneyIn },
    { label: 'Money out', value: -cs.moneyOut, style: 'less' },
  ];
  if (Math.round(cs.ownerNet)) stmtRows.push({ label: 'Owner money (put in less taken out)', value: cs.ownerNet });
  stmtRows.push({ label: 'Balance at the end', value: cs.closing, style: 'grand' });
  r.pair(
    r.bars({ title: 'Where the money came from', items: ex.moneyInKinds.map((k) => ({ label: k.label, value: k.amount })), empty: 'No money came in.', w: r.half }),
    r.bars({ title: 'Where the money went', items: ex.moneyOutKinds.map((k) => ({ label: k.label, value: k.amount })), empty: 'No money went out.', w: r.half }),
  );
  r.add(r.statement({ title: 'Cash statement', rows: stmtRows }));

  // ── 03 Sales ──────────────────────────────────────────────────────────────
  r.section('Sales', 'by brand and by product');
  const brands = [...d.brands].sort((a, b) => b.revenue - a.revenue);
  const brandRev = brands.reduce((s, b) => s + b.revenue, 0);
  r.pair(
    r.bars({ title: 'Revenue by brand', items: brands.map((b) => ({ label: b.name, value: b.revenue })), empty: 'No brand sales.', w: r.half }),
    r.bars({ title: 'Boxes sold by brand', items: brands.map((b) => ({ label: b.name, value: b.boxes })), money: false, empty: 'No brand sales.', w: r.half }),
  );
  r.table({
    title: 'Brand performance',
    columns: [
      { label: 'Brand', w: 3, bold: true },
      { label: 'Boxes', w: 1.1, align: 'right' },
      { label: 'Revenue', w: 2, align: 'right', money: true },
      { label: 'Cost', w: 2, align: 'right', money: true, muted: true },
      { label: 'Profit', w: 2, align: 'right', money: true },
      { label: 'Margin', w: 1.2, align: 'right' },
      { label: 'Share', w: 1.2, align: 'right' },
    ],
    rows: brands.map((b) => [b.name, b.boxes, b.revenue, b.cost, b.profit, oneDp(b.margin), oneDp(share(b.revenue, brandRev))]),
    foot: brands.length > 1
      ? ['Total', brands.reduce((s, b) => s + b.boxes, 0), brandRev, brands.reduce((s, b) => s + b.cost, 0), brands.reduce((s, b) => s + b.profit, 0), oneDp(share(brands.reduce((s, b) => s + b.profit, 0), brandRev)), '']
      : null,
    empty: 'No brand sales in this period.',
  });
  r.table({
    title: `Top products (${d.topProducts.length})`,
    columns: [
      { label: '#', w: 0.6, muted: true },
      { label: 'Product', w: 5, bold: true },
      { label: 'Boxes', w: 1.2, align: 'right' },
      { label: 'Revenue', w: 2, align: 'right', money: true },
      { label: 'Share of sales', w: 1.6, align: 'right' },
    ],
    rows: d.topProducts.map((p, i) => [String(i + 1), p.name, p.boxes == null ? '' : p.boxes, p.revenue, oneDp(share(p.revenue, f.revenue))]),
    empty: 'No products sold in this period.',
  });

  // ── 04 Expenses ───────────────────────────────────────────────────────────
  if (ex.expensesByCategory.length) {
    r.section('Expenses', 'what the business spent its money on');
    const biggest = ex.expensesByCategory[0];
    r.pair(
      r.bars({ title: 'By category', items: ex.expensesByCategory.map((c) => ({ label: c.category, value: c.amount })), w: r.half }),
      r.highlights({
        w: r.half,
        perRow: 1,
        items: [
          { label: 'Total expenses', value: tsh(f.expenses), sub: `${oneDp(share(f.expenses, f.revenue))} of sales` },
          { label: 'Biggest category', value: biggest.category, sub: `${tsh(biggest.amount)} · ${oneDp(share(biggest.amount, f.expenses))} of expenses` },
        ],
      }),
    );
  }

  // ── Sales team ────────────────────────────────────────────────────────────
  r.section('Sales team', 'who sold what');
  const reps = d.repPerformance || ex.reps; // monthly rows also carry each rep's commission
  const repTotal = reps.reduce((s, x) => s + x.revenue, 0);
  const lead = reps[0];
  r.add(r.highlights({
    perRow: 3,
    items: [
      { label: 'Best sales rep', value: lead ? lead.name : 'None yet', sub: lead ? `${tsh(lead.revenue)} · ${plural(lead.boxes, 'box', 'boxes')}` : 'no rep sold in this period', tone: 'red' },
      { label: 'Reps who sold', value: n0(reps.length), sub: reps.length ? `${plural(reps.reduce((s, x) => s + x.orders, 0), 'order', 'orders')}` : '' },
      { label: 'Sold through reps', value: oneDp(share(repTotal, f.revenue)), sub: 'of all sales' },
    ],
  }));
  const withCommission = reps.some((x) => x.commissionEarned != null);
  const repCols = [
    { label: '#', w: 0.6, muted: true },
    { label: 'Sales rep', w: 2.9, bold: true },
    { label: 'Orders', w: 1.3, align: 'right' },
    { label: 'Boxes', w: 1.2, align: 'right' },
    { label: 'Revenue', w: 2, align: 'right', money: true },
    { label: 'Share', w: 1.2, align: 'right' },
  ];
  if (withCommission) repCols.push({ label: 'Earned', w: 1.7, align: 'right', money: true }, { label: 'Paid', w: 1.7, align: 'right', money: true }, { label: 'Owing', w: 1.7, align: 'right', money: true });
  r.table({
    title: 'Sales rep leaderboard',
    columns: repCols,
    rows: reps.map((x, i) => {
      const row = [String(i + 1), x.name, x.orders, x.boxes, x.revenue, oneDp(share(x.revenue, repTotal))];
      if (withCommission) row.push(x.commissionEarned ?? 0, x.commissionPaid ?? 0, x.outstanding == null ? '' : x.outstanding);
      return row;
    }),
    foot: reps.length > 1
      ? (() => {
        const foot = ['', 'Total', reps.reduce((s, x) => s + x.orders, 0), reps.reduce((s, x) => s + x.boxes, 0), repTotal, ''];
        if (withCommission) foot.push(reps.reduce((s, x) => s + (x.commissionEarned || 0), 0), reps.reduce((s, x) => s + (x.commissionPaid || 0), 0), reps.reduce((s, x) => s + (x.outstanding || 0), 0));
        return foot;
      })()
      : null,
    empty: 'No sales were made through reps in this period.',
  });
  if (d.commission) {
    r.add(r.highlights({
      perRow: 3,
      items: [
        { label: 'Commission earned', value: tsh(d.commission.earned), sub: 'by reps this period' },
        { label: 'Commission paid', value: tsh(d.commission.paid), sub: 'paid out this period' },
        { label: 'Owing to reps now', value: tsh(d.commission.outstanding), sub: 'available to withdraw' },
      ],
    }));
    r.add(r.note('Commission is a record of what reps earned and were paid. It is paid from the owner\'s own money and is not deducted from the profit above.'));
  }

  // ── Stock ─────────────────────────────────────────────────────────────────
  r.section('Stock', 'what is on the shelves and what moved');
  r.add(r.highlights({
    perRow: 3,
    items: [
      { label: 'Stock at cost', value: tsh(d.stock.costValue), sub: `${plural(d.stock.units, 'box', 'boxes')} in all` },
      { label: 'Stock at retail', value: tsh(d.stock.retailValue), sub: 'if sold at list price' },
      { label: 'Potential profit', value: tsh(d.stock.potential), sub: 'retail less cost' },
      { label: 'In the warehouse', value: plural(d.stock.warehouseBoxes, 'box', 'boxes') },
      { label: 'With sales reps', value: plural(d.stock.repBoxes, 'box', 'boxes') },
      { label: 'Needs restocking', value: `${n0(d.stock.lowCount)} low · ${n0(d.stock.outOfStock)} out`, sub: 'products' },
    ],
  }));
  const mv = d.movement;
  const mvRows = [];
  if (mv.openingBoxes != null) mvRows.push({ label: 'Boxes at the start', text: n0(mv.openingBoxes) });
  mvRows.push(
    { label: 'Stock added', style: 'indent', text: signed(mv.stockInBoxes) },
    { label: 'Bought from suppliers', style: 'indent', text: signed(mv.purchasedBoxes) },
    { label: 'Sold', style: 'indent', text: signed(-mv.soldBoxes) },
    { label: 'Returned by customers', style: 'indent', text: signed(mv.returnedBoxes) },
    { label: 'Adjustments and damage', style: 'indent', text: signed(mv.adjustedBoxes) },
  );
  if (mv.closingBoxes != null) mvRows.push({ label: 'Boxes at the end', text: n0(mv.closingBoxes), style: 'total' });
  const owed = [
    { label: 'Orders out with reps', text: `${n0(d.settlements.active)}  ·  ${tsh(d.settlements.activeValue)}` },
    { label: 'Overdue orders', text: `${n0(d.settlements.overdue)}  ·  ${tsh(d.settlements.overdueValue)}` },
    { label: 'Owed to suppliers', text: tsh(d.supplierDue) },
    { label: 'Requests waiting', text: n0(d.pending.requests) },
    { label: 'Settlements waiting', text: n0(d.pending.settlements) },
    { label: 'Returns waiting', text: n0(d.pending.returns) },
  ];
  r.pair(
    r.statement({ title: 'Boxes moved', rows: mvRows, w: r.half }),
    r.statement({ title: 'Open orders and approvals', rows: owed, w: r.half }),
  );

  // ── Accounts ──────────────────────────────────────────────────────────────
  r.section('Business accounts', 'what each account holds right now');
  r.table({
    columns: [
      { label: 'Account', w: 5, bold: true },
      { label: 'Balance (TSh)', w: 2.4, align: 'right', money: true },
    ],
    rows: d.accounts.map((a) => [a.name, a.balance]),
    foot: ['Total available funds', d.cashPosition],
    empty: 'No accounts set up.',
  });

  // ── Attention ─────────────────────────────────────────────────────────────
  r.section('Needs attention', 'what to look at next');
  if (d.attention.length) r.add(r.callout({ title: `${plural(d.attention.length, 'item', 'items')}`, items: d.attention, tone: 'attention' }));
  else r.add(r.callout({ title: 'All clear', items: ['Nothing is waiting for approval, overdue or running low.'], tone: 'insight' }));

  return r.done('Generated automatically by ZELab from recorded transactions. Profit is sales less the cost of the boxes sold, less expenses.');
}

const dailyPdf = (d) => render('daily', d);
const weeklyPdf = (d) => render('weekly', d);
const monthlyPdf = (d) => render('monthly', d);

module.exports = { dailyPdf, weeklyPdf, monthlyPdf, inShort, headlineFigures };
