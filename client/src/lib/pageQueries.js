/*
  THE FIRST ANSWERS OF THE MAIN PAGES, IN ONE PLACE.

  Each page reads with these builders, and the app reads ahead with the same
  ones (on a link's touch or hover, and once after Home has drawn — see
  lib/routeQueries.js), so the key a page asks for and the key read ahead can
  never drift apart. Each builder returns { queryKey, queryFn } (plus retry
  for the side sheet's own reads); the page adds its own polling and options.
*/
import api, { unwrap } from '@/lib/api';
import { eatISODate } from '@/lib/tz';
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
  profitOverview: (period) => ({ queryKey: ['reports', 'profit-overview', period], queryFn: dataOf('/reports/profit-overview', { period }) }),
  brandStock: () => ({ queryKey: ['dashboard', 'brands'], queryFn: dataOf('/dashboard/brands') }),
  financeSuppliers: () => ({ queryKey: ['finance', 'suppliers'], queryFn: dataOf('/finance/suppliers') }),
  // Accounts' "Latest movements": the newest eight across every account (the rows only, no pager).
  financeLatest: () => ({
    queryKey: ['finance', 'transactions', 'latest'],
    queryFn: dataOf('/finance/transactions', { page: 1, limit: 8, sortBy: 'occurredAt', sortDir: 'desc' }),
  }),
  financeTransactions: ({ page, account, type, brand, category, search, expensesOnly }) => {
    const params = { page, limit: 25, accountId: account || undefined, brandId: brand || undefined, category: category || undefined, search: search || undefined };
    // Only genuine expenses. Filtering on direction alone swept in account
    // transfers, stock purchases and commission payouts, so "Spent in this
    // view" reported money that was not spent and contradicted the Overview.
    if (expensesOnly) { params.direction = 'OUT'; params.type = 'EXPENSE'; }
    else if (type) params.type = type;
    return {
      queryKey: ['finance', 'transactions', { page, account, type, brand, category, search, expensesOnly }],
      queryFn: listOf('/finance/transactions', params),
    };
  },
  commissionsInsights: () => ({ queryKey: ['commissions', 'me', 'insights'], queryFn: dataOf('/commissions/me/insights') }),
  commissionsMine: () => ({ queryKey: ['commissions', 'me'], queryFn: dataOf('/commissions/me') }),
  withdrawalsMine: () => ({ queryKey: ['commissions', 'withdrawals', 'mine'], queryFn: listOf('/commissions/withdrawals', { limit: 20 }) }),
  commissionsSummary: () => ({ queryKey: ['commissions', 'summary'], queryFn: dataOf('/commissions/summary') }),
  withdrawalsAll: () => ({ queryKey: ['commissions', 'withdrawals', 'all'], queryFn: listOf('/commissions/withdrawals', { limit: 30 }) }),
  // The "Paid out" bars and Paid by rep: six months of payouts, more than the 30 the table lists.
  withdrawalsTrend: () => ({ queryKey: ['commissions', 'withdrawals', 'all', 'trend'], queryFn: listOf('/commissions/withdrawals', { limit: 200 }) }),
  // How reliably orders are settled, overall and per rep (the on-time chips on the rep cards).
  settlementsAnalytics: () => ({ queryKey: ['settlements', 'analytics'], queryFn: dataOf('/settlements/analytics') }),
  // Only the whole-table counts are read (meta.counts), so one row is enough.
  penaltiesCount: () => ({ queryKey: ['penalties', 'all'], queryFn: listOf('/penalties', { limit: 1 }) }),
  bonusSummary: () => ({ queryKey: ['bonus-summary'], queryFn: dataOf('/commissions/bonus/summary') }),

  // People and records.
  salesReps: ({ page }) => ({ queryKey: ['sales-reps', { page }], queryFn: listOf('/sales-reps', { page, limit: 100 }) }),
  repProfile: ({ id, period }) => ({
    queryKey: ['sales-rep-profile', id, period],
    queryFn: async () => unwrap(await api.get(`/sales-reps/${id}/profile`, { params: period === 'all' ? {} : { period } })).data,
  }),
  repWithdrawals: (id) => ({ queryKey: ['commissions', 'withdrawals', 'rep', id], queryFn: listOf('/commissions/withdrawals', { salesRepId: id, limit: 6 }) }),
  // The rep's view on Commissions (a side sheet) lists every payout, so it keeps its own key, never
  // the profile page's latest 6 above; and the fines still charged. The sheet shows a failure at once
  // (no retry), so a read-ahead started by pressing a card does not retry either. The profile is the
  // profile page's own answer (same key), read the sheet's way.
  repSheetProfile: (id) => ({ ...pageQueries.repProfile({ id, period: 'all' }), retry: false }),
  repSheetWithdrawals: (id) => ({ queryKey: ['commissions', 'withdrawals', 'rep', id, 'sheet'], queryFn: listOf('/commissions/withdrawals', { salesRepId: id, limit: 200 }), retry: false }),
  repFines: (id) => ({ queryKey: ['penalties', 'rep', id, 'APPLIED'], queryFn: listOf('/penalties', { salesRepId: id, status: 'APPLIED', limit: 50 }), retry: false }),
  customers: ({ page, search }) => ({ queryKey: ['customers', { page, search }], queryFn: listOf('/customers', { page, limit: 15, search }) }),
  notifications: ({ page }) => ({ queryKey: ['notifications', { page }], queryFn: listOf('/notifications', { page, limit: 20 }) }),
  dailyReports: ({ page }) => ({ queryKey: ['daily-reports', { page }], queryFn: listOf('/daily-reports', { page, limit: 20 }) }),
  // The rep's own opening or closing report of today (Tanzanian day), or null: the form opens it to change
  // it instead of starting blank (lib/dailyReportForm.js). Under 'daily-reports', so a save refreshes it.
  dailyReportToday: (type, day = eatISODate()) => ({
    queryKey: ['daily-reports', 'today', type, day],
    queryFn: async () => (unwrap(await api.get('/daily-reports', { params: { type, from: day, to: day, limit: 1 } })).data || [])[0] || null,
  }),
  // The saved report PDFs (Finance's Statements tab, the owner's profile), by kind, year and search.
  reportArchive: ({ type = '', year = '', search = '' } = {}) => ({
    queryKey: ['report-archive', type, year, search],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (type) params.set('type', type);
      if (year) params.set('year', year);
      if (search) params.set('search', search);
      return unwrap(await api.get(`/finance/report-archive?${params}`)).data;
    },
  }),
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
