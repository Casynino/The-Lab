/*
  THE FIRST ANSWERS OF THE MAIN PAGES, IN ONE PLACE.

  Each page reads with these builders, and the app reads ahead with the same
  ones (on a link's touch or hover, and once after Home has drawn — see
  lib/routeQueries.js), so the key a page asks for and the key read ahead can
  never drift apart. Each builder returns { queryKey, queryFn } only; the page
  adds its own polling and options.
*/
import api, { unwrap } from '@/lib/api';
import { routeQueries, shellQueries, warmPaths } from '@/lib/routeQueries';

// The answer's `data` (a record, a summary) …
const dataOf = (url, params) => async () => unwrap(await api.get(url, params ? { params } : undefined)).data;
// … or the whole envelope, when the page reads `meta` too (lists and their pager).
const listOf = (url, params) => async () => unwrap(await api.get(url, params ? { params } : undefined));

export const pageQueries = {
  // The shell: the bell and the waiting counts.
  unread: () => ({ queryKey: ['notifications', 'unread'], queryFn: async () => unwrap(await api.get('/notifications/unread-count')).data.unread }),
  pendingActions: () => ({ queryKey: ['dashboard', 'pending-actions'], queryFn: dataOf('/dashboard/pending-actions') }),

  // Home.
  dashboardCommand: () => ({ queryKey: ['dashboard', 'command'], queryFn: dataOf('/dashboard/command') }),
  dashboardAnalysis: () => ({ queryKey: ['dashboard', 'analysis'], queryFn: dataOf('/dashboard/analysis') }),
  dashboardMe: () => ({ queryKey: ['dashboard', 'me'], queryFn: dataOf('/dashboard/me') }),
  bonusMe: () => ({ queryKey: ['bonus', 'me'], queryFn: dataOf('/commissions/bonus/me') }),

  // Requests.
  stockRequestsMine: () => ({ queryKey: ['stock-requests', 'rep-all'], queryFn: listOf('/stock-requests', { limit: 100 }) }),
  stockRequestsWaiting: () => ({ queryKey: ['stock-requests', 'pending-approvals'], queryFn: listOf('/stock-requests', { status: 'PENDING', limit: 50 }) }),
  // Pending requests live in the approval strip above — the history table
  // shows decided ones unless the filter explicitly asks for pending. The
  // server leaves them out before paging (`decided`), so every page is full
  // and the pager counts the rows it shows.
  stockRequests: ({ page, status }) => ({
    queryKey: ['stock-requests', { page, status }],
    queryFn: listOf('/stock-requests', { page, limit: 15, status: status || undefined, decided: status ? undefined : 'true' }),
  }),

  // Settle.
  settlementsMine: () => ({ queryKey: ['settlements', 'rep-all'], queryFn: listOf('/settlements', { limit: 100 }) }),
  settlementsWaiting: () => ({ queryKey: ['settlements', 'pending-approvals'], queryFn: dataOf('/settlements/pending-approvals') }),
  settlementsSummary: () => ({ queryKey: ['settlements', 'summary'], queryFn: dataOf('/settlements/summary') }),
  settlements: ({ page, status }) => ({
    queryKey: ['settlements', { page, status }],
    queryFn: listOf('/settlements', { page, limit: 15, status: status || undefined }),
  }),

  // Sales and returns.
  sales: ({ page, type, status }) => ({
    queryKey: ['sales', { page, type, status }],
    queryFn: listOf('/sales', { page, limit: 15, type: type || undefined, status: status || undefined }),
  }),
  returnsSummary: () => ({ queryKey: ['returns', 'summary'], queryFn: dataOf('/returns/summary') }),
  returns: ({ type, page }) => ({
    queryKey: ['returns', { type, page }],
    queryFn: listOf('/returns', { page, limit: 100, type: type || undefined }),
  }),

  // Stock.
  brandsAll: () => ({ queryKey: ['brands', 'all'], queryFn: dataOf('/brands', { limit: 50 }) }),
  inventoryBalances: ({ page, search, brand }) => ({
    queryKey: ['inventory', 'balances', { page, search, brand }],
    queryFn: listOf('/inventory/balances', { page, limit: 24, search, brand: brand || undefined }),
  }),
  products: ({ page, search, brandId, categoryId }) => ({
    queryKey: ['products', { page, search, brandId, categoryId }],
    queryFn: listOf('/products', { page, limit: 15, search, brandId: brandId || undefined, categoryId: categoryId || undefined }),
  }),

  // Money.
  financeAccounts: () => ({ queryKey: ['finance', 'accounts'], queryFn: dataOf('/finance/accounts') }),
  financeCategories: () => ({ queryKey: ['finance', 'categories'], queryFn: dataOf('/finance/categories') }),
  financeOverview: (period) => ({ queryKey: ['finance', 'overview', period], queryFn: dataOf('/finance/overview', { period }) }),
  financeCashflow: (period) => ({ queryKey: ['finance', 'cashflow', period], queryFn: dataOf('/finance/cashflow', { period }) }),
  commissionsInsights: () => ({ queryKey: ['commissions', 'me', 'insights'], queryFn: dataOf('/commissions/me/insights') }),
  commissionsMine: () => ({ queryKey: ['commissions', 'me'], queryFn: dataOf('/commissions/me') }),
  withdrawalsMine: () => ({ queryKey: ['commissions', 'withdrawals', 'mine'], queryFn: listOf('/commissions/withdrawals', { limit: 20 }) }),
  commissionsSummary: () => ({ queryKey: ['commissions', 'summary'], queryFn: dataOf('/commissions/summary') }),
  withdrawalsAll: () => ({ queryKey: ['commissions', 'withdrawals', 'all'], queryFn: listOf('/commissions/withdrawals', { limit: 30 }) }),
  // Only the whole-table counts are read (meta.counts), so one row is enough.
  penaltiesCount: () => ({ queryKey: ['penalties', 'all'], queryFn: listOf('/penalties', { limit: 1 }) }),
  bonusSummary: () => ({ queryKey: ['bonus-summary'], queryFn: dataOf('/commissions/bonus/summary') }),

  // People and records.
  salesReps: ({ page }) => ({ queryKey: ['sales-reps', { page }], queryFn: listOf('/sales-reps', { page, limit: 100 }) }),
  customers: ({ page, search }) => ({ queryKey: ['customers', { page, search }], queryFn: listOf('/customers', { page, limit: 15, search }) }),
  notifications: ({ page }) => ({ queryKey: ['notifications', { page }], queryFn: listOf('/notifications', { page, limit: 20 }) }),
  dailyReports: ({ page }) => ({ queryKey: ['daily-reports', { page }], queryFn: listOf('/daily-reports', { page, limit: 20 }) }),
};

/**
 * Turning a page (or typing a search) keeps the rows on screen until the next
 * ones arrive, instead of blanking the list into a spinner. Changing one of
 * `filters` (a status chip, a brand) does not: the old rows and their totals
 * would sit under the new chip.
 */
export function keepOnPageTurn(filters = {}) {
  return (previous, previousQuery) => {
    const was = previousQuery?.queryKey?.find((k) => k && typeof k === 'object' && !Array.isArray(k));
    if (!was) return undefined;
    return Object.keys(filters).every((k) => (was[k] ?? '') === (filters[k] ?? '')) ? previous : undefined;
  };
}

function optionsFor(list) {
  return list.map(([name, arg]) => pageQueries[name]?.(arg)).filter(Boolean);
}

/**
 * Start a page's first answers now. Only what is missing or out of date is
 * asked for (prefetchQuery keeps fresh answers), and a page that opens while
 * one is on its way shares it rather than asking twice.
 */
export function prefetchRoute(qc, pathname, search, role, { shell = false } = {}) {
  const list = routeQueries(pathname, search, role).concat(shell ? shellQueries(role) : []);
  optionsFor(list).forEach((o) => { qc.prefetchQuery(o); });
}

const pause = (ms) => new Promise((r) => { window.setTimeout(r, ms); });

/**
 * Once per session, after Home has drawn: read the person's main pages ahead,
 * one page at a time so they never crowd what is on screen. Only answers the
 * app does not hold at all are asked for — an answer kept from last time is
 * shown at once anyway and refreshed when its page opens.
 */
export async function warmUp(qc, role, { here, alive }) {
  for (const path of warmPaths(role)) {
    if (!alive()) return;
    if (path === here) continue;
    const missing = optionsFor(routeQueries(path, '', role)).filter((o) => qc.getQueryData(o.queryKey) === undefined);
    if (!missing.length) continue;
    await Promise.all(missing.map((o) => qc.prefetchQuery(o)));
    await pause(150);
  }
}
