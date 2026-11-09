'use strict';

// Weekly bank-statement PDF for ZELab. Consumes weeklyReport.buildWeeklyData()
// and renders: financial summary, accounts, brand performance, top products,
// rep performance, commission summary, inventory movement, stock, settlements
// and alerts. Pagination is handled by the statement kit.

const { createStatement, fmt } = require('./statementPdf.util');

function weeklyStatementPdf(data) {
  const s = createStatement({
    title: 'Weekly Business Statement',
    periodLabel: data.period.label,
    generatedAt: data.generatedAt,
  });

  // ── 1. Financial summary ──
  s.sectionTitle('Financial Summary');
  s.kvRows([
    ['Revenue (sales)', fmt(data.finance.revenue)],
    ['Cost of goods sold', `- ${fmt(data.finance.cogs)}`],
    ['Gross profit', fmt(data.finance.grossProfit)],
    ['Business expenses', `- ${fmt(data.finance.expenses)}`],
    ['Net profit', fmt(data.finance.netProfit)],
    ['Money in', fmt(data.finance.moneyIn)],
    ['Money out', `- ${fmt(data.finance.moneyOut)}`],
    ['Net cash flow', fmt(data.finance.netCash)],
    ['Boxes sold', String(data.finance.boxesSold)],
  ], { bold: ['Gross profit', 'Net profit', 'Net cash flow'] });

  // ── 2. Business accounts ──
  s.sectionTitle('Business Accounts (current balances)');
  s.kvRows([
    ...data.accounts.map((a) => [a.name, fmt(a.balance)]),
    ['Total available funds', fmt(data.cashPosition)],
  ], { bold: ['Total available funds'] });

  // ── 3. Brand performance ──
  s.sectionTitle('Brand Performance');
  if (data.brands.length === 0) {
    s.paragraph('No brand sales in this period.');
  } else {
    s.table(
      ['Brand', 'Revenue', 'Cost', 'Profit', 'Margin', 'Boxes'],
      data.brands.map((b) => [b.name, fmt(b.revenue), fmt(b.cost), fmt(b.profit), `${b.margin}%`, b.boxes]),
      [2, 2, 2, 2, 1, 1],
    );
  }

  // ── 4. Top selling products ──
  if ((data.topProducts || []).length) {
    s.sectionTitle('Top Selling Products');
    s.table(
      ['Product', 'Revenue', 'Boxes'],
      data.topProducts.map((p, i) => [`${i + 1}. ${p.name}`, fmt(p.revenue), p.boxes ?? '-']),
      [5, 2, 1],
    );
  }

  // ── 5. Sales rep performance ──
  if ((data.repPerformance || []).length) {
    s.sectionTitle('Sales Rep Performance');
    s.table(
      ['Sales Rep', 'Sales', 'Boxes'],
      data.repPerformance.map((r) => [r.name, fmt(r.revenue), r.boxes]),
      [4, 2, 1],
    );
  }

  // ── 6. Commission summary ──
  if (data.commission) {
    s.sectionTitle('Commission Summary');
    s.kvRows([
      ['Commission earned this period', fmt(data.commission.earned)],
      ['Commission paid this period', fmt(data.commission.paid)],
      ['Outstanding commission (payable now)', fmt(data.commission.outstanding)],
    ], { bold: ['Outstanding commission (payable now)'] });
  }

  // ── 7. Inventory movement ──
  if (data.movement) {
    s.sectionTitle('Inventory Movement');
    s.kvRows([
      ['Stock added (openings / manual stock-in)', `${data.movement.stockInBoxes || 0} box(es)`],
      ['Stock purchased (received)', `${data.movement.purchasedBoxes} box(es)`],
      ['Stock sold', `${data.movement.soldBoxes} box(es)`],
      ['Customer returns', `${data.movement.returnedBoxes} box(es)`],
      ['Adjustments / corrections (net)', `${data.movement.adjustedBoxes >= 0 ? '+' : ''}${data.movement.adjustedBoxes} box(es)`],
    ]);
  }

  // ── 8. Stock summary ──
  s.sectionTitle('Stock Summary');
  s.kvRows([
    ['Inventory value (cost)', fmt(data.stock.costValue)],
    ['Inventory value (selling)', fmt(data.stock.retailValue)],
    ['Potential profit in stock', fmt(data.stock.potential)],
    ['Total boxes', String(data.stock.units)],
    ['In ZELab (warehouse)', `${data.stock.warehouseBoxes} boxes`],
    ['With sales reps', `${data.stock.repBoxes} boxes`],
  ], { bold: ['Potential profit in stock'] });

  // ── 9. Settlements & pending approvals ──
  s.sectionTitle('Settlements & Pending Approvals');
  s.kvRows([
    ['Active orders (money owed by reps)', `${data.settlements.active} · ${fmt(data.settlements.activeValue)}`],
    ['Overdue orders', `${data.settlements.overdue} · ${fmt(data.settlements.overdueValue)}`],
    ['Settlements awaiting approval', String(data.pending?.settlements ?? data.settlements.pendingApprovals)],
    ['Stock requests awaiting approval', String(data.pending?.requests ?? 0)],
    ['Returns awaiting approval', String(data.pending?.returns ?? 0)],
  ], { bold: data.settlements.overdue > 0 ? ['Overdue orders'] : [] });

  // ── 10. Alerts ──
  s.sectionTitle('Alerts');
  if (data.attention.length === 0) {
    s.bullets(['All clear — nothing needs attention.'], { color: '#65a30d' });
  } else {
    s.bullets(data.attention);
  }

  return s.done('Generated automatically by ZELab · Figures derive from recorded transactions from the Finance go-live onward.');
}

module.exports = { weeklyStatementPdf };
