import { createChunkLoader } from './chunkLoader.js';

// Every page is its own file, so nobody downloads the whole app to see one
// screen: the sign-in page no longer carries the charts, a rep's phone no
// longer carries the owner's Finance. Each page has its own import() — never
// one import() picked by an if/else, which the minifier folds into a single
// call that fetches every branch's files.
export const CHUNKS = {
  Login: () => import('@/pages/Login'),
  Nino: () => import('@/pages/Nino'),
  Dashboard: () => import('@/pages/Dashboard'),
  RepDashboard: () => import('@/pages/RepDashboard'),
  Products: () => import('@/pages/Products'),
  Inventory: () => import('@/pages/Inventory'),
  Sales: () => import('@/pages/Sales'),
  Customers: () => import('@/pages/Customers'),
  Returns: () => import('@/pages/Returns'),
  SalesReps: () => import('@/pages/SalesReps'),
  SalesRepProfile: () => import('@/pages/SalesRepProfile'),
  Finance: () => import('@/pages/Finance'),
  AuditLogs: () => import('@/pages/AuditLogs'),
  Users: () => import('@/pages/Users'),
  Settings: () => import('@/pages/Settings'),
  Notifications: () => import('@/pages/Notifications'),
  StockRequests: () => import('@/pages/StockRequests'),
  Settlements: () => import('@/pages/Settlements'),
  Commissions: () => import('@/pages/Commissions'),
  DailyReports: () => import('@/pages/DailyReports'),
  Activity: () => import('@/pages/Activity'),
  Profile: () => import('@/pages/Profile'),
  NotFound: () => import('@/pages/NotFound'),
  InvoiceGenerator: () => import('@/pages/InvoiceGenerator'),
  ProductLabel: () => import('@/pages/ProductLabel'),
  // The chart library (recharts, the largest file in the app). The home
  // dashboard draws its figures first and its charts as this arrives.
  charts: () => import('@/components/charts'),
};

export const pages = createChunkLoader(CHUNKS);

const ADMIN = 'ADMIN';
const SALES_REP = 'SALES_REP';

// The page an address opens, as App.jsx routes it — including where the old
// addresses now land (Purchases inside Inventory, the owner's tools inside his
// profile). Only a download hint: App.jsx and the server still decide.
const ROUTES = {
  '/products': 'Products',
  '/label': 'Products',
  '/inventory': 'Inventory',
  '/purchases': 'Inventory',
  '/transfers': 'Inventory',
  '/reorder': 'Inventory',
  '/stock-requests': 'StockRequests',
  '/settlements': 'Settlements',
  '/commissions': 'Commissions',
  '/daily-reports': ({ owner }) => (owner ? 'Profile' : 'DailyReports'),
  '/invoice-generator': ({ rep }) => (rep ? 'InvoiceGenerator' : 'Sales'),
  '/activity': ({ owner }) => (owner ? 'Profile' : 'Activity'),
  '/sales': 'Sales',
  '/customers': 'Customers',
  '/returns': 'Returns',
  '/reps': 'SalesReps',
  '/reports': 'Finance',
  '/profit': 'Finance',
  '/finance': 'Finance',
  '/notifications': 'Notifications',
  '/profile': 'Profile',
  '/audit': 'Profile',
  '/users': 'Profile',
  '/settings': 'Profile',
};

/** The page `pathname` opens for someone with `role` (no role = signed out). */
export function pageFor(pathname, role) {
  const path = String(pathname || '/').replace(/\/+$/, '') || '/';
  if (path === '/login') return 'Login';
  if (path === '/nino') return 'Nino';
  if (!role) return 'Login'; // every other address sends a signed-out person to sign in
  const rep = role === SALES_REP;
  if (path === '/') return rep ? 'RepDashboard' : 'Dashboard';
  if (/^\/reps\/[^/]+$/.test(path)) return 'SalesRepProfile';
  const page = ROUTES[path];
  if (!page) return 'NotFound';
  return typeof page === 'function' ? page({ rep, owner: role === ADMIN }) : page;
}

/** The pages to fetch in the quiet after the first screen, most used first.
 *  The Invoice (its PDF library) and the Label stay on demand. Signed out: the
 *  two home pages, so the screen after sign-in is ready. */
export function warmList(role) {
  if (!role) return ['RepDashboard', 'Dashboard'];
  if (role === SALES_REP) {
    return ['RepDashboard', 'StockRequests', 'Settlements', 'Commissions', 'Returns', 'Profile', 'DailyReports', 'Notifications'];
  }
  const list = ['Dashboard', 'charts', 'StockRequests', 'Settlements', 'Finance', 'Sales', 'Returns', 'Products', 'Inventory',
    'SalesReps', 'SalesRepProfile', 'Customers', 'Commissions', 'Profile', 'Notifications'];
  // The owner reaches these inside his profile; staff open them as pages.
  if (role !== ADMIN) list.push('DailyReports', 'Activity');
  return list;
}

/** The role in the stored sign-in token — only to choose which page file to
 *  start downloading before /auth/me answers. Never trusted for anything else. */
export function roleFromToken(token) {
  try {
    const part = String(token || '').split('.')[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const json = JSON.parse(atob(b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), '=')));
    return typeof json.role === 'string' ? json.role : null;
  } catch {
    return null;
  }
}
