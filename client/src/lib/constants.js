export const ROLES = {
  ADMIN: 'ADMIN',
  WAREHOUSE_STAFF: 'WAREHOUSE_STAFF',
  SALES_REP: 'SALES_REP',
};

export const ROLE_LABELS = {
  ADMIN: 'Administrator',
  WAREHOUSE_STAFF: 'Warehouse Staff',
  SALES_REP: 'Sales Representative',
};

// The role a new account starts with in Users > New user: none, so one must be chosen ("Choose a role…").
// GET /roles comes back sorted by name, so taking the first one pre-selected Administrator and a hurried
// "Create" handed out full owner powers (audit 11 Nov 2026, admin-system-1). Starting on Sales rep was no
// better: this form is mostly used for staff, and a hurried Create made a phone-only rep with the next REP
// code that cannot be turned into staff afterwards (reps have their own Sales reps > + New rep).
export function defaultUserRoleId() {
  return '';
}

// Navigation. `roles` lists who can see the item; ADMIN sees everything.
const ALL = ['ADMIN', 'WAREHOUSE_STAFF', 'SALES_REP'];
const STAFF = ['ADMIN', 'WAREHOUSE_STAFF'];

// Sidebar sections follow the daily workflow (most used at the top), not the
// system's modules. A section header only renders when the role can see at
// least one of its items.
// Sections follow the shape of the business rather than the shape of the
// database: stock is bought, held, sent out with a rep, sold, and settled —
// so the menu is ordered the way a box actually travels. Each carries its own
// icon so a group reads as a department.
// MENU WORDS ARE ONE SIMPLE WORD (Nino, 10 Nov 2026, twice: "keep reading too
// long words, like Stock Requests… one name each, even for admin"). They match
// the phone's bottom bar (Requests, Settle, Money). A page keeps its own full
// title; this is only what the menu calls it.
export const NAV_GROUPS = [
  ['home', '', 'LayoutDashboard'],
  ['selling', 'Selling', 'ShoppingCart'],
  ['stock', 'Stock', 'Boxes'],
  ['money', 'Money', 'Wallet'],
  ['people', 'People', 'Users'],
  ['records', 'Records', 'ScrollText'],
  ['admin', 'Admin', 'ShieldCheck'],
];

export const NAV = [
  // ── Home ──
  { to: '/', label: 'Home', icon: 'LayoutDashboard', roles: ALL, group: 'home' },

  // ── Selling — money coming in, in the order it arrives ──
  { to: '/stock-requests', label: 'Requests', icon: 'ClipboardList', roles: ALL, group: 'selling', badge: 'stockRequests' },
  { to: '/settlements', label: 'Settle', icon: 'Timer', roles: ALL, group: 'selling', badge: 'settlements' },
  { to: '/sales', label: 'Sales', icon: 'ShoppingCart', roles: STAFF, group: 'selling' },
  { to: '/returns', label: 'Returns', icon: 'Undo2', roles: ALL, group: 'selling', badge: 'returns' },
  // Inside Sales for staff (`insideFor`); reps have no Sales page and keep Invoice in their menu.
  { to: '/invoice-generator', label: 'Invoice', icon: 'Receipt', roles: ALL, group: 'selling', inside: '/sales?tab=invoice', insideFor: STAFF },

  // ── Stock — where the goods come from and where they are ──
  { to: '/purchases', label: 'Purchases', icon: 'Ship', roles: STAFF, group: 'stock', inside: '/inventory?tab=purchases', keywords: ['po', 'purchase order', 'imports', 'suppliers'] },
  { to: '/inventory', label: 'Inventory', icon: 'Boxes', roles: STAFF, group: 'stock' },
  { to: '/products', label: 'Products', icon: 'Package', roles: STAFF, group: 'stock' },
  // `inside`: a tab of another page for everyone (Nino, 11 Nov 2026: "keep the sidebar clean") — out of the
  // sidebar, still found by the page search, at that address.
  { to: '/transfers', label: 'Transfers', icon: 'Truck', roles: STAFF, group: 'stock', inside: '/inventory?tab=transfers', keywords: ['movement'] },
  { to: '/reorder', label: 'Reorder', icon: 'Repeat', roles: STAFF, group: 'stock', inside: '/inventory?tab=reorder' },

  // ── Money ──
  // `keywords`: other words the page search finds a page by (its tabs, what people call it).
  // Called "Wallet" in the staff sidebar (Nino, 11 Nov 2026); search still finds it as Finance.
  { to: '/finance', label: 'Wallet', icon: 'Wallet', roles: STAFF, group: 'money', keywords: ['finance', 'money', 'profit', 'reports', 'accounts', 'ledger', 'expenses', 'cash flow', 'suppliers', 'statements'] },
  // Everyone who deals with commission gets it in the sidebar. The same page
  // serves a rep their own earnings and an admin the approvals; it is also a
  // tab inside Finance, which is where staff used to be sent instead.
  { to: '/commissions', label: 'Commissions', icon: 'Coins', repLabel: 'Wallet', repIcon: 'Wallet', roles: STAFF.concat(['SALES_REP']), group: 'money', keywords: ['payout', 'withdraw', 'fines'] },

  // ── People ──
  { to: '/reps', label: 'Reps', icon: 'UserCog', roles: STAFF, group: 'people' },
  { to: '/customers', label: 'Customers', icon: 'Users', roles: STAFF, group: 'people' },

  // ── Records — what happened, after the fact ──
  // `adminAt`: for the OWNER these pages live inside his profile (Nino, 11 Nov 2026: "all these pages
  // should be inside Nino's profile") and the Label inside Products. His sidebar leaves them out; the
  // page search still finds them, at that address. Reps and staff keep the pages where they were.
  { to: '/daily-reports', label: 'Reports', icon: 'NotebookPen', roles: ALL, group: 'records', adminAt: '/profile?tab=reports', keywords: ['daily'] },
  { to: '/activity', label: 'Activity', icon: 'Activity', roles: STAFF, group: 'records', adminAt: '/profile?tab=activity' },
  { to: '/audit', label: 'Audit', icon: 'ScrollText', roles: ['ADMIN'], group: 'records', adminAt: '/profile?tab=audit' },

  // ── Administration ──
  { to: '/users', label: 'Users', icon: 'ShieldCheck', roles: ['ADMIN'], group: 'admin', adminAt: '/profile?tab=users' },
  { to: '/label', label: 'Label', icon: 'QrCode', roles: ['ADMIN'], group: 'admin', adminAt: '/products?tab=label' },
  { to: '/settings', label: 'Settings', icon: 'Settings', roles: ['ADMIN'], group: 'admin', adminAt: '/profile?tab=settings' },

  // ── Found by the page search only (group 'search' is not a sidebar group) ──
  { to: '/notifications', label: 'Notifications', icon: 'Bell', roles: ALL, group: 'search', keywords: ['alerts'] },
];

// Dark ground: tinted fills with a light text, never the light-theme chips —
// a bg-*-100 badge burns a hole in the page.
export const SALE_STATUS_META = {
  PAID: { label: 'Paid', cls: 'bg-emerald-500/15 text-emerald-300' },
  PARTIAL: { label: 'Partial', cls: 'bg-amber-500/15 text-amber-300' },
  UNPAID: { label: 'Unpaid', cls: 'bg-rose-500/15 text-rose-300' },
  CANCELLED: { label: 'Cancelled', cls: 'bg-white/10 text-muted' },
  EXPIRED: { label: 'Expired (24h)', cls: 'bg-orange-500/15 text-orange-300' },
};

export const CREDIT_STATUS_META = {
  OPEN: { label: 'Open', cls: 'bg-sky-500/15 text-sky-300' },
  PARTIAL: { label: 'Partial', cls: 'bg-amber-500/15 text-amber-300' },
  PAID: { label: 'Paid', cls: 'bg-emerald-500/15 text-emerald-300' },
  OVERDUE: { label: 'Overdue', cls: 'bg-rose-500/15 text-rose-300' },
  WRITTEN_OFF: { label: 'Written off', cls: 'bg-elevated text-muted' },
};

export const MOVEMENT_META = {
  STOCK_IN: { label: 'Stock In', cls: 'bg-emerald-500/15 text-emerald-300' },
  PURCHASE_RECEIPT: { label: 'Purchase', cls: 'bg-emerald-500/15 text-emerald-300' },
  TRANSFER_IN: { label: 'Transfer In', cls: 'bg-sky-500/15 text-sky-300' },
  TRANSFER_OUT: { label: 'Transfer Out', cls: 'bg-indigo-500/15 text-indigo-300' },
  CASH_SALE: { label: 'Cash Sale', cls: 'bg-blue-500/15 text-blue-300' },
  CREDIT_SALE: { label: 'Credit Sale', cls: 'bg-violet-500/15 text-violet-300' },
  CUSTOMER_RETURN: { label: 'Customer Return', cls: 'bg-teal-500/15 text-teal-300' },
  SALES_RETURN: { label: 'Sales Return', cls: 'bg-cyan-500/15 text-cyan-300' },
  DAMAGE: { label: 'Damage', cls: 'bg-rose-500/15 text-rose-300' },
  ADJUSTMENT: { label: 'Adjustment', cls: 'bg-amber-500/15 text-amber-300' },
  CORRECTION: { label: 'Correction', cls: 'bg-orange-500/15 text-orange-300' },
  STOCK_COUNT: { label: 'Stock Count', cls: 'bg-fuchsia-500/15 text-fuchsia-300' },
};

export const SEVERITY_META = {
  INFO: { cls: 'bg-sky-500/15 text-sky-300' },
  WARNING: { cls: 'bg-amber-500/15 text-amber-300' },
  CRITICAL: { cls: 'bg-rose-500/15 text-rose-300' },
};

export const PO_STATUS_META = {
  DRAFT: { label: 'Draft', cls: 'bg-elevated text-muted' },
  ORDERED: { label: 'Ordered', cls: 'bg-sky-500/15 text-sky-300' },
  IN_TRANSIT: { label: 'In transit', cls: 'bg-amber-500/15 text-amber-300' },
  RECEIVED: { label: 'Received', cls: 'bg-emerald-500/15 text-emerald-300' },
  CANCELLED: { label: 'Cancelled', cls: 'bg-elevated text-muted' },
};

export const REQUEST_STATUS_META = {
  PENDING: { label: 'Pending', cls: 'bg-amber-500/15 text-amber-300' },
  APPROVED: { label: 'Approved', cls: 'bg-sky-500/15 text-sky-300' },
  REJECTED: { label: 'Rejected', cls: 'bg-rose-500/15 text-rose-300' },
  FULFILLED: { label: 'Fulfilled', cls: 'bg-emerald-500/15 text-emerald-300' },
  CANCELLED: { label: 'Cancelled', cls: 'bg-elevated text-muted' },
};

export const SETTLEMENT_STATUS_META = {
  OPEN: { label: 'Open', cls: 'bg-sky-500/15 text-sky-300' },
  PARTIAL: { label: 'Partial', cls: 'bg-amber-500/15 text-amber-300' },
  SETTLED: { label: 'Settled', cls: 'bg-emerald-500/15 text-emerald-300' },
  OVERDUE: { label: 'Overdue', cls: 'bg-rose-500/15 text-rose-300' },
};

export const ORDER_STATUS_META = {
  PENDING: { label: 'Pending', cls: 'bg-elevated text-muted' },
  CONFIRMED: { label: 'Confirmed', cls: 'bg-sky-500/15 text-sky-300' },
  PACKED: { label: 'Packed', cls: 'bg-indigo-500/15 text-indigo-300' },
  SHIPPED: { label: 'Shipped', cls: 'bg-violet-500/15 text-violet-300' },
  DELIVERED: { label: 'Delivered', cls: 'bg-emerald-500/15 text-emerald-300' },
  CANCELLED: { label: 'Cancelled', cls: 'bg-elevated text-muted' },
};

export const ORDER_PAYMENT_META = {
  UNPAID: { label: 'Unpaid', cls: 'bg-rose-500/15 text-rose-300' },
  PARTIAL: { label: 'Partial', cls: 'bg-amber-500/15 text-amber-300' },
  PAID: { label: 'Paid', cls: 'bg-emerald-500/15 text-emerald-300' },
};

export const WITHDRAWAL_STATUS_META = {
  PENDING: { label: 'Pending', cls: 'bg-amber-500/15 text-amber-300' },
  APPROVED: { label: 'Approved', cls: 'bg-sky-500/15 text-sky-300' },
  REJECTED: { label: 'Rejected', cls: 'bg-rose-500/15 text-rose-300' },
  PAID: { label: 'Paid', cls: 'bg-emerald-500/15 text-emerald-300' },
};

