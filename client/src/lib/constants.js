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
export const NAV_GROUPS = [
  ['home', '', 'LayoutDashboard'],
  ['selling', 'Selling', 'ShoppingCart'],
  ['stock', 'Stock', 'Boxes'],
  ['money', 'Money', 'Wallet'],
  ['people', 'People', 'Users'],
  ['records', 'Records', 'ScrollText'],
  ['admin', 'Administration', 'ShieldCheck'],
];

export const NAV = [
  // ── Home ──
  { to: '/', label: 'Home', icon: 'LayoutDashboard', roles: ALL, group: 'home' },

  // ── Selling — money coming in, in the order it arrives ──
  { to: '/stock-requests', label: 'Stock Requests', icon: 'ClipboardList', roles: ALL, group: 'selling', badge: 'stockRequests' },
  { to: '/settlements', label: 'Settlements', icon: 'Timer', roles: ALL, group: 'selling', badge: 'settlements' },
  { to: '/sales', label: 'Sales', icon: 'ShoppingCart', roles: STAFF, group: 'selling' },
  { to: '/returns', label: 'Returns', icon: 'Undo2', roles: ALL, group: 'selling', badge: 'returns' },
  { to: '/invoice-generator', label: 'Generate Invoice', icon: 'Receipt', roles: ALL, group: 'selling' },

  // ── Stock — where the goods come from and where they are ──
  { to: '/purchases', label: 'Purchases & Imports', icon: 'Ship', roles: STAFF, group: 'stock' },
  { to: '/inventory', label: 'Inventory', icon: 'Boxes', roles: STAFF, group: 'stock' },
  { to: '/products', label: 'Products', icon: 'Package', roles: STAFF, group: 'stock' },
  { to: '/transfers', label: 'Stock Transfers', icon: 'Truck', roles: STAFF, group: 'stock' },
  { to: '/reorder', label: 'Reorder', icon: 'Repeat', roles: STAFF, group: 'stock' },

  // ── Money ──
  { to: '/finance', label: 'Finance', icon: 'Wallet', roles: STAFF, group: 'money' },
  // Staff/admin manage commissions inside Finance; reps keep their own page.
  // `exact` beats hasRole()'s admin-sees-everything rule.
  { to: '/commissions', label: 'Commissions', icon: 'Coins', roles: ['SALES_REP'], exact: true, group: 'money' },

  // ── People ──
  { to: '/reps', label: 'Sales Reps', icon: 'UserCog', roles: STAFF, group: 'people' },
  { to: '/customers', label: 'Customers', icon: 'Users', roles: STAFF, group: 'people' },

  // ── Records — what happened, after the fact ──
  { to: '/daily-reports', label: 'Daily Reports', icon: 'NotebookPen', roles: ALL, group: 'records' },
  { to: '/activity', label: 'Activity', icon: 'Activity', roles: STAFF, group: 'records' },
  { to: '/audit', label: 'Audit Log', icon: 'ScrollText', roles: ['ADMIN'], group: 'records' },

  // ── Administration ──
  { to: '/users', label: 'Users', icon: 'ShieldCheck', roles: ['ADMIN'], group: 'admin' },
  { to: '/settings', label: 'Settings', icon: 'Settings', roles: ['ADMIN'], group: 'admin' },
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

