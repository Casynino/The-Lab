'use strict';

// Monthly financial report PDF — the print/archive-grade document for a
// completed month: executive summary, brand comparison, inventory summary,
// finance, sales & rep performance, business analysis and closing summary.

const { createStatement, fmt } = require('./statementPdf.util');

function monthlyStatementPdf(d) {
  const s = createStatement({
    title: 'Monthly Business Report',
    periodLabel: d.period.label,
    generatedAt: d.generatedAt,
  });

  // ── 1. Executive summary ──
  s.sectionTitle('Executive Summary');
  s.kvRows([
    ['Total revenue', fmt(d.finance.revenue)],
    ['Cost of goods sold', `- ${fmt(d.finance.cogs)}`],
    ['Gross profit', fmt(d.finance.grossProfit)],
    ['Total expenses', `- ${fmt(d.finance.expenses)}`],
    ['Net profit', fmt(d.finance.netProfit)],
    ['Closing cash balance', fmt(d.cashPosition)],
    ['Boxes sold', String(d.finance.boxesSold)],
  ], { bold: ['Gross profit', 'Net profit', 'Closing cash balance'] });

  // ── 2. Brand performance ──
  s.sectionTitle('Brand Performance');
  if (d.brands.length === 0) {
    s.paragraph('No brand sales in this period.');
  } else {
    s.table(
      ['Brand', 'Revenue', 'Cost', 'Profit', 'Margin', 'Boxes'],
      d.brands.map((b) => [b.name, fmt(b.revenue), fmt(b.cost), fmt(b.profit), `${b.margin}%`, b.boxes]),
      [2, 2, 2, 2, 1, 1],
    );
    if (d.brands.length >= 2) {
      const [a, b] = [...d.brands].sort((x, y) => y.revenue - x.revenue);
      const share = d.finance.revenue > 0 ? Math.round((a.revenue / d.finance.revenue) * 100) : 0;
      s.paragraph(`${a.name} led the month with ${share}% of revenue (${fmt(a.revenue)} vs ${fmt(b.revenue)} for ${b.name}).`);
    }
  }

  // ── 3. Inventory summary ──
  s.sectionTitle('Inventory Summary');
  s.kvRows([
    ['Opening stock', `${d.inventory.openingBoxes} box(es)`],
    ['Stock added (openings / manual stock-in)', `+ ${d.inventory.stockInBoxes || 0} box(es)`],
    ['Stock purchased (received)', `+ ${d.inventory.purchasedBoxes} box(es)`],
    ['Stock sold', `- ${d.inventory.soldBoxes} box(es)`],
    ['Customer returns', `+ ${d.inventory.returnedBoxes} box(es)`],
    ['Adjustments / corrections (net)', `${d.inventory.adjustedBoxes >= 0 ? '+' : ''}${d.inventory.adjustedBoxes} box(es)`],
    ['Closing stock', `${d.inventory.closingBoxes} box(es)`],
  ], { bold: ['Opening stock', 'Closing stock'] });

  // ── 4. Finance ──
  s.sectionTitle('Finance');
  s.kvRows([
    ['Income (money in)', fmt(d.finance.moneyIn)],
    ['Expenses & payments (money out)', `- ${fmt(d.finance.moneyOut)}`],
    ['Net cash flow', fmt(d.finance.netCash)],
    ['Supplier payments', fmt(d.finance.supplierPayments)],
    ...d.accounts.map((a) => [`Account · ${a.name}`, fmt(a.balance)]),
    ['Total funds', fmt(d.cashPosition)],
  ], { bold: ['Net cash flow', 'Total funds'] });

  // ── 5. Sales performance ──
  s.sectionTitle('Sales Performance — Product Rankings');
  if ((d.topProducts || []).length === 0) {
    s.paragraph('No sales in this period.');
  } else {
    s.table(
      ['Product', 'Revenue', 'Boxes'],
      d.topProducts.map((p, i) => [`${i + 1}. ${p.name}`, fmt(p.revenue), p.boxes ?? '-']),
      [5, 2, 1],
    );
  }

  // ── 6. Sales rep performance ──
  s.sectionTitle('Sales Rep Performance');
  if ((d.repPerformance || []).length === 0) {
    s.paragraph('No rep sales in this period.');
  } else {
    s.table(
      ['Sales Rep', 'Revenue', 'Boxes', 'Comm. earned', 'Comm. paid', 'Outstanding'],
      d.repPerformance.map((r) => [
        r.name, fmt(r.revenue), r.boxes, fmt(r.commissionEarned), fmt(r.commissionPaid),
        r.outstanding == null ? '-' : fmt(r.outstanding),
      ]),
      [3, 2, 1, 2, 2, 2],
    );
    s.kvRows([
      ['Active settlement orders', `${d.settlements.active} · ${fmt(d.settlements.activeValue)}`],
      ['Overdue settlement orders', `${d.settlements.overdue} · ${fmt(d.settlements.overdueValue)}`],
    ], { bold: d.settlements.overdue > 0 ? ['Overdue settlement orders'] : [] });
  }

  // ── 7. Business analysis ──
  s.sectionTitle('Business Analysis');
  const g = d.growth;
  s.kvRows([
    [`Revenue vs ${g.prevLabel}`, g.revenuePct == null ? 'n/a (no prior data)' : `${g.revenuePct >= 0 ? '+' : ''}${g.revenuePct}% (was ${fmt(g.prevRevenue)})`],
    [`Net profit vs ${g.prevLabel}`, g.netProfitPct == null ? 'n/a (no prior data)' : `${g.netProfitPct >= 0 ? '+' : ''}${g.netProfitPct}% (was ${fmt(g.prevNetProfit)})`],
    ['Average daily revenue', fmt(d.metrics.avgDailyRevenue)],
    ['Gross margin', `${d.metrics.marginPct}%`],
    ['Active sales reps', String(d.metrics.activeReps)],
    ['Products low on stock (now)', String(d.metrics.lowStockCount)],
  ]);
  const highlights = [];
  if (d.topProducts[0]) highlights.push(`Best seller: ${d.topProducts[0].name} (${fmt(d.topProducts[0].revenue)}).`);
  if (d.repPerformance[0]) highlights.push(`Top sales rep: ${d.repPerformance[0].name} (${fmt(d.repPerformance[0].revenue)}).`);
  if (d.inventory.purchasedBoxes > 0) highlights.push(`Restocked ${d.inventory.purchasedBoxes} box(es) during the month.`);
  if (highlights.length) s.bullets(highlights);

  // ── 8. Pending & alerts ──
  s.sectionTitle('Pending Approvals & Alerts');
  s.kvRows([
    ['Stock requests awaiting approval', String(d.pending.requests)],
    ['Settlements awaiting approval', String(d.pending.settlements)],
    ['Returns awaiting approval', String(d.pending.returns)],
  ]);
  if (d.attention.length) s.bullets(d.attention);

  // ── 9. Closing summary ──
  s.sectionTitle('Closing Summary');
  s.paragraph(
    `${d.period.label}: revenue ${fmt(d.finance.revenue)}, net profit ${fmt(d.finance.netProfit)}, ` +
    `${d.finance.boxesSold} box(es) sold. The business closed the month with ${fmt(d.cashPosition)} across ` +
    `${d.accounts.length} account(s) and ${d.inventory.closingBoxes} box(es) in stock.`,
  );

  return s.done('Generated automatically by ZELab · Monthly financial report · Figures derive from recorded transactions.');
}

module.exports = { monthlyStatementPdf };
