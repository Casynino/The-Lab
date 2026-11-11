import test from 'node:test';
import assert from 'node:assert/strict';
import { routeQueries, shellQueries, warmPaths } from './routeQueries.js';

const names = (list) => list.map(([n]) => n);

test('each person is sent ahead to what their own page asks for', () => {
  assert.deepEqual(names(routeQueries('/', '', 'ADMIN')), ['dashboardCommand', 'dashboardAnalysis']);
  assert.deepEqual(names(routeQueries('/', '', 'SALES_REP')), ['dashboardMe', 'bonusMe']);
  assert.deepEqual(names(routeQueries('/stock-requests', '', 'SALES_REP')), ['stockRequestsMine']);
  assert.deepEqual(routeQueries('/stock-requests', '', 'WAREHOUSE_STAFF'), [['stockRequestsWaiting'], ['stockRequests', { page: 1, status: '' }]]);
  assert.deepEqual(names(routeQueries('/commissions', '', 'SALES_REP')), ['commissionsInsights', 'commissionsMine', 'withdrawalsMine', 'bonusMe']);
  assert.deepEqual(names(routeQueries('/commissions', '', 'ADMIN')), ['commissionsSummary', 'withdrawalsAll', 'withdrawalsTrend', 'settlementsAnalytics', 'penaltiesCount', 'bonusSummary']);
  // Finance's Commissions tab is the same staff page.
  assert.deepEqual(names(routeQueries('/finance', '?tab=commissions', 'ADMIN')).slice(2), names(routeQueries('/commissions', '', 'ADMIN')));
  assert.deepEqual(names(routeQueries('/reps', '', 'WAREHOUSE_STAFF')), ['salesReps', 'bonusSummary']);
  assert.deepEqual(names(routeQueries('/finance', '?tab=accounts', 'ADMIN')), ['financeAccounts', 'financeCategories', 'financeLatest']);
});

test('a rep card on Commissions reads ahead its own side sheet, for staff only', () => {
  assert.deepEqual(routeQueries('/commissions', '?rep=cm9', 'ADMIN'), [['repProfile', { id: 'cm9', period: 'all' }], ['repSheetWithdrawals', 'cm9'], ['repFines', 'cm9']]);
  assert.deepEqual(names(routeQueries('/commissions', '?rep=cm9', 'WAREHOUSE_STAFF')), ['repProfile', 'repSheetWithdrawals', 'repFines']);
  // A rep asking for someone else's sheet is sent to his own wallet's answers, never another rep's.
  assert.deepEqual(names(routeQueries('/commissions', '?rep=cm9', 'SALES_REP')), ['commissionsInsights', 'commissionsMine', 'withdrawalsMine', 'bonusMe']);
});

test('a rep is never sent ahead to a staff page', () => {
  for (const path of ['/sales', '/inventory', '/products', '/finance', '/reps', '/customers', '/profile']) {
    assert.deepEqual(routeQueries(path, '', 'SALES_REP'), [], path);
  }
  assert.deepEqual(names(shellQueries('SALES_REP')), ['unread']);
  assert.ok(!warmPaths('SALES_REP').some((p) => ['/sales', '/inventory', '/products', '/finance', '/reps'].includes(p)));
});

test('nobody, or an unknown role, is sent nowhere', () => {
  assert.deepEqual(routeQueries('/', '', undefined), []);
  assert.deepEqual(routeQueries('/settlements', '', 'SOMETHING'), []);
  assert.deepEqual(warmPaths(null), []);
});

test('the address decides the tab and the chip, as the page does', () => {
  assert.deepEqual(routeQueries('/settlements', '?status=OVERDUE', 'ADMIN')[2], ['settlements', { page: 1, status: 'OVERDUE' }]);
  assert.deepEqual(routeQueries('/settlements', '?status=nonsense', 'ADMIN')[2], ['settlements', { page: 1, status: '' }]);
  assert.deepEqual(names(routeQueries('/finance', '', 'ADMIN')), ['financeAccounts', 'financeCategories', 'financeOverview', 'financeCashflow']);
  assert.deepEqual(names(routeQueries('/finance', '?tab=ledger', 'ADMIN')), ['financeAccounts', 'financeCategories', 'brandsAll', 'financeTransactions']);
  // Expenses and the ledger are two different lists (the expenses one is genuine expenses only).
  assert.equal(routeQueries('/finance', '?tab=expenses', 'ADMIN')[3][1].expensesOnly, true);
  assert.equal(routeQueries('/finance', '?tab=ledger', 'ADMIN')[3][1].expensesOnly, undefined);
  assert.deepEqual(names(routeQueries('/finance', '?tab=archive', 'ADMIN')), ['financeAccounts', 'financeCategories']);
  assert.deepEqual(routeQueries('/sales', '?tab=invoice', 'ADMIN'), []);
  assert.deepEqual(routeQueries('/inventory', '?tab=purchases', 'ADMIN'), []);
  assert.deepEqual(routeQueries('/products', '?tab=label', 'ADMIN'), []);
  assert.deepEqual(routeQueries('/reps/cm123', '', 'ADMIN'), [['repProfile', { id: 'cm123', period: 'all' }], ['repWithdrawals', 'cm123']]);
  assert.deepEqual(routeQueries('/reps/cm123', '', 'SALES_REP'), []);
  assert.deepEqual(routeQueries('/reps/%E0%A4%A', '', 'ADMIN'), []);
  // the owner's daily reports live in his profile
  assert.deepEqual(routeQueries('/daily-reports', '', 'ADMIN'), []);
});

test('the warm-up starts with the tab bar', () => {
  assert.deepEqual(warmPaths('ADMIN').slice(0, 3), ['/stock-requests', '/settlements', '/finance']);
  assert.deepEqual(warmPaths('SALES_REP').slice(0, 3), ['/stock-requests', '/settlements', '/commissions']);
  assert.ok(!warmPaths('WAREHOUSE_STAFF').includes('/finance'));
  for (const role of ['ADMIN', 'WAREHOUSE_STAFF', 'SALES_REP']) {
    for (const p of warmPaths(role)) assert.ok(routeQueries(p, '', role).length > 0, `${role} ${p}`);
  }
});
