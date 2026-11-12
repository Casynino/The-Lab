/*
  WHAT EACH PAGE SHOWS FIRST, BY WHO IS LOOKING.

  The app reads a page's first answers ahead — when a finger or the mouse
  lands on its link, and the main pages once, quietly, after Home has drawn —
  so that opening it shows them at once instead of a spinner for a round trip
  to Frankfurt. The names are the query builders in lib/pageQueries.js, and
  the pages themselves read with the very same builders, so what is read ahead
  is exactly what the page asks for.

  Only what that person's page asks for: a rep is never sent ahead to a staff
  list (the server would refuse it anyway). Pure, so it is tested on its own.
*/

import { pickParam, pageParam } from './urlParams.js';
import { SALE_STATUS_META, REQUEST_STATUS_META } from './constants.js';

// The chips each list page reads from its address (the same lists the pages pass to pickParam).
const SETTLEMENT_CHIPS = ['OPEN', 'PARTIAL', 'OVERDUE', 'SETTLED'];
const SALE_TYPES = ['CASH', 'CREDIT'];
const SALE_CHIPS = Object.keys(SALE_STATUS_META);
const REQUEST_CHIPS = Object.keys(REQUEST_STATUS_META).filter((k) => k !== 'APPROVED');
const FINANCE_TABS = ['overview', 'profit', 'cashflow', 'suppliers', 'accounts', 'expenses', 'ledger', 'commissions', 'reports', 'archive'];
const INVENTORY_TABS = ['balances', 'movements', 'purchases', 'transfers', 'reorder'];
// The staff Commissions page (also Finance's Commissions tab): the rep cards, the payouts and the paid-out chart.
const COMMISSIONS_STAFF = [
  ['commissionsSummary'], ['withdrawalsAll'], ['withdrawalsTrend'], ['settlementsAnalytics'], ['penaltiesCount'], ['bonusSummary'],
];
// ...and with a rep card open (?rep=id, the open sheet's own address, reloadable): the board under it too.
function commissionsStaff(params) {
  const card = params.get('rep');
  return card
    ? [...COMMISSIONS_STAFF, ['repSheetProfile', card], ['repSheetWithdrawals', card], ['repFines', card]]
    : [...COMMISSIONS_STAFF];
}

/** The shell's own answers (the bell, the waiting counts), asked on every page. */
export function shellQueries(role) {
  if (role === 'SALES_REP') return [['unread']];
  if (role === 'ADMIN' || role === 'WAREHOUSE_STAFF') return [['unread'], ['pendingActions']];
  return [];
}

/** [[builder name, argument], ...] for the first screen of `pathname` (+ `search`) as `role` sees it. */
export function routeQueries(pathname, search, role) {
  const rep = role === 'SALES_REP';
  const admin = role === 'ADMIN';
  const staff = admin || role === 'WAREHOUSE_STAFF';
  if (!rep && !staff) return [];
  let params;
  try { params = new URLSearchParams(search || ''); } catch { params = new URLSearchParams(); }
  const tab = params.get('tab');

  switch (pathname) {
    case '/':
      return rep ? [['dashboardMe'], ['bonusMe']] : [['dashboardCommand'], ['dashboardAnalysis']];
    case '/stock-requests':
      if (rep) return [['stockRequestsMine']];
      return [['stockRequestsWaiting'], ['stockRequests', { page: pageParam(params), status: pickParam(params, 'status', REQUEST_CHIPS) }]];
    case '/settlements': {
      if (rep) return [['settlementsMine']];
      const status = pickParam(params, 'status', SETTLEMENT_CHIPS);
      return [['settlementsWaiting'], ['settlementsSummary'], ['settlements', { page: pageParam(params), status }]];
    }
    case '/returns':
      return [['returnsSummary'], ['returns', { type: '', page: 1 }]];
    case '/commissions': {
      if (rep) return [['commissionsInsights'], ['commissionsMine'], ['withdrawalsMine'], ['bonusMe']];
      return commissionsStaff(params);
    }
    case '/daily-reports':
      // The owner's reports open inside his profile instead.
      return admin ? [] : [['dailyReports', { page: 1 }]];
    case '/notifications':
      return [['notifications', { page: 1 }]];
    default:
      break;
  }

  if (!staff) return [];
  const repPage = /^\/reps\/([^/]+)$/.exec(pathname);
  if (repPage) {
    let id;
    try { id = decodeURIComponent(repPage[1]); } catch { return []; }
    return [['repProfile', { id, period: 'all' }], ['repWithdrawals', id]];
  }
  switch (pathname) {
    case '/sales':
      if (tab === 'invoice') return [];
      return [['sales', { page: pageParam(params), type: pickParam(params, 'type', SALE_TYPES), status: pickParam(params, 'status', SALE_CHIPS) }]];
    case '/inventory':
      return !tab || tab === 'balances' || !INVENTORY_TABS.includes(tab)
        ? [['brandsAll'], ['inventoryBalances', { page: 1, search: '', brand: '' }]]
        : [];
    case '/products':
      return admin && tab === 'label' ? [] : [['products', { page: 1, search: '', brandId: '', categoryId: '' }]];
    case '/finance': {
      const root = [['financeAccounts'], ['financeCategories']];
      const overview = !tab || tab === 'overview' || !FINANCE_TABS.includes(tab);
      if (overview) return root.concat([['financeOverview', 'all'], ['financeCashflow', 'all']]);
      const ledger = { page: 1, account: '', type: '', brand: '', category: '', search: '' };
      const inside = {
        profit: [['profitOverview', 'all'], ['brandStock']],
        cashflow: [['financeCashflow', 'month']],
        suppliers: [['financeSuppliers']],
        accounts: [['financeLatest']],
        expenses: [['brandsAll'], ['financeTransactions', { ...ledger, expensesOnly: true }]],
        ledger: [['brandsAll'], ['financeTransactions', ledger]],
        commissions: commissionsStaff(params),
        archive: [['reportArchive']],
      };
      return root.concat(inside[tab] || []);
    }
    case '/reps':
      return [['salesReps', { page: 1 }], ['bonusSummary']];
    case '/customers':
      return [['customers', { page: 1, search: '' }]];
    case '/profile':
      // The owner's profile opens on the same figures as his Home.
      return admin ? [['dashboardCommand'], ['dashboardAnalysis']] : [];
    default:
      return [];
  }
}

/**
 * The pages read ahead once per session, quietly, after Home has drawn —
 * the tab bar first, then the rest of that person's menu. Finance (the
 * heaviest answer) only for the owner, who opens it every day.
 */
export function warmPaths(role) {
  if (role === 'SALES_REP') return ['/stock-requests', '/settlements', '/commissions', '/returns', '/daily-reports'];
  if (role === 'ADMIN') return ['/stock-requests', '/settlements', '/finance', '/sales', '/returns', '/inventory', '/products', '/commissions', '/reps'];
  if (role === 'WAREHOUSE_STAFF') return ['/stock-requests', '/settlements', '/sales', '/returns', '/inventory', '/products'];
  return [];
}
