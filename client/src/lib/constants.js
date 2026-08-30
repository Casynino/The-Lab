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
// Each section carries its own icon, so the sidebar reads as labelled
// departments rather than a flat list broken up by grey text.
export const NAV_GROUPS = [
  ['overview', 'Business Overview', 'LayoutDashboard'],
  ['operations', 'Operations', 'Boxes'],
  ['reports', 'Reports & Analytics', 'BarChart3'],
  ['people', 'People', 'Users'],
  ['tools', 'Tools', 'Wrench'],
  ['admin', 'Administration', 'ShieldCheck'],
];

export const NAV = [
  // ── Business Overview ──
  { to: '/', label: 'Dashboard', icon: 'LayoutDashboard', roles: ALL, group: 'overview' },
  { to: '/sales', label: 'Sales', icon: 'ShoppingCart', roles: STAFF, group: 'overview' },
  { to: '/settlements', label: 'Settlements', icon: 'Timer', roles: ALL, group: 'overview', badge: 'settlements' },
  { to: '/stock-requests', label: 'Stock Requests', icon: 'ClipboardList', roles: ALL, group: 'overview', badge: 'stockRequests' },

  // ── Operations ──
  { to: '/inventory', label: 'Inventory', icon: 'Boxes', roles: STAFF, group: 'operations', sub: 'Stock Management' },
  { to: '/products', label: 'Products', icon: 'Package', roles: STAFF, group: 'operations', sub: 'Stock Management' },
  { to: '/reorder', label: 'Reorder', icon: 'Repeat', roles: STAFF, group: 'operations', sub: 'Stock Management' },
  { to: '/purchases', label: 'Purchases & Imports', icon: 'Ship', roles: STAFF, group: 'operations' },
  { to: '/transfers', label: 'Stock Transfers', icon: 'Truck', roles: STAFF, group: 'operations' },
  { to: '/returns', label: 'Returns', icon: 'Undo2', roles: ALL, group: 'operations', badge: 'returns' },

  // ── Reports & Analytics ──
  { to: '/finance', label: 'Finance', icon: 'Wallet', roles: STAFF, group: 'reports' },
  { to: '/daily-reports', label: 'Daily Reports', icon: 'NotebookPen', roles: ALL, group: 'reports' },
  { to: '/activity', label: 'Activity', icon: 'Activity', roles: STAFF, group: 'reports' },
  { to: '/audit', label: 'Audit Log', icon: 'ScrollText', roles: ['ADMIN'], group: 'reports' },

  // ── People ──
  { to: '/reps', label: 'Sales Reps', icon: 'UserCog', roles: STAFF, group: 'people' },
  { to: '/customers', label: 'Customers', icon: 'Users', roles: STAFF, group: 'people' },
  // Staff/admin manage commissions inside Finance; reps keep their own page.
  // `exact` beats hasRole()'s admin-sees-everything rule.
  { to: '/commissions', label: 'Commissions', icon: 'Coins', roles: ['SALES_REP'], exact: true, group: 'people' },

  // ── Tools ──
  { to: '/invoice-generator', label: 'Generate Invoice', icon: 'Receipt', roles: ALL, group: 'tools' },

  // ── Administration ──
  { to: '/users', label: 'Users', icon: 'ShieldCheck', roles: ['ADMIN'], group: 'admin' },
  { to: '/settings', label: 'Settings', icon: 'Settings', roles: ['ADMIN'], group: 'admin' },
];

export const SALE_STATUS_META = {
  PAID: { label: 'Paid', cls: 'bg-emerald-100 text-emerald-700' },
  PARTIAL: { label: 'Partial', cls: 'bg-amber-100 text-amber-700' },
  UNPAID: { label: 'Unpaid', cls: 'bg-rose-100 text-rose-700' },
  CANCELLED: { label: 'Cancelled', cls: 'bg-elevated text-muted' },
  EXPIRED: { label: 'Expired (24h)', cls: 'bg-orange-100 text-orange-700' },
};

export const CREDIT_STATUS_META = {
  OPEN: { label: 'Open', cls: 'bg-sky-100 text-sky-700' },
  PARTIAL: { label: 'Partial', cls: 'bg-amber-100 text-amber-700' },
  PAID: { label: 'Paid', cls: 'bg-emerald-100 text-emerald-700' },
  OVERDUE: { label: 'Overdue', cls: 'bg-rose-100 text-rose-700' },
  WRITTEN_OFF: { label: 'Written off', cls: 'bg-elevated text-muted' },
};

export const MOVEMENT_META = {
  STOCK_IN: { label: 'Stock In', cls: 'bg-emerald-100 text-emerald-700' },
  PURCHASE_RECEIPT: { label: 'Purchase', cls: 'bg-emerald-100 text-emerald-700' },
  TRANSFER_IN: { label: 'Transfer In', cls: 'bg-sky-100 text-sky-700' },
  TRANSFER_OUT: { label: 'Transfer Out', cls: 'bg-indigo-100 text-indigo-700' },
  CASH_SALE: { label: 'Cash Sale', cls: 'bg-blue-100 text-blue-700' },
  CREDIT_SALE: { label: 'Credit Sale', cls: 'bg-violet-100 text-violet-700' },
  CUSTOMER_RETURN: { label: 'Customer Return', cls: 'bg-teal-100 text-teal-700' },
  SALES_RETURN: { label: 'Sales Return', cls: 'bg-cyan-100 text-cyan-700' },
  DAMAGE: { label: 'Damage', cls: 'bg-rose-100 text-rose-700' },
  ADJUSTMENT: { label: 'Adjustment', cls: 'bg-amber-100 text-amber-700' },
  CORRECTION: { label: 'Correction', cls: 'bg-orange-100 text-orange-700' },
  STOCK_COUNT: { label: 'Stock Count', cls: 'bg-fuchsia-100 text-fuchsia-700' },
};

export const SEVERITY_META = {
  INFO: { cls: 'bg-sky-100 text-sky-700' },
  WARNING: { cls: 'bg-amber-100 text-amber-700' },
  CRITICAL: { cls: 'bg-rose-100 text-rose-700' },
};

export const URGENCY_META = {
  CRITICAL: { label: 'Critical', cls: 'bg-rose-100 text-rose-700' },
  HIGH: { label: 'High', cls: 'bg-amber-100 text-amber-700' },
  MEDIUM: { label: 'Medium', cls: 'bg-yellow-100 text-yellow-700' },
  OK: { label: 'OK', cls: 'bg-emerald-100 text-emerald-700' },
};

export const PO_STATUS_META = {
  DRAFT: { label: 'Draft', cls: 'bg-elevated text-muted' },
  ORDERED: { label: 'Ordered', cls: 'bg-sky-100 text-sky-700' },
  IN_TRANSIT: { label: 'In transit', cls: 'bg-amber-100 text-amber-700' },
  RECEIVED: { label: 'Received', cls: 'bg-emerald-100 text-emerald-700' },
  CANCELLED: { label: 'Cancelled', cls: 'bg-elevated text-muted' },
};

export const REQUEST_STATUS_META = {
  PENDING: { label: 'Pending', cls: 'bg-amber-100 text-amber-700' },
  APPROVED: { label: 'Approved', cls: 'bg-sky-100 text-sky-700' },
  REJECTED: { label: 'Rejected', cls: 'bg-rose-100 text-rose-700' },
  FULFILLED: { label: 'Fulfilled', cls: 'bg-emerald-100 text-emerald-700' },
  CANCELLED: { label: 'Cancelled', cls: 'bg-elevated text-muted' },
};

export const SETTLEMENT_STATUS_META = {
  OPEN: { label: 'Open', cls: 'bg-sky-100 text-sky-700' },
  PARTIAL: { label: 'Partial', cls: 'bg-amber-100 text-amber-700' },
  SETTLED: { label: 'Settled', cls: 'bg-emerald-100 text-emerald-700' },
  OVERDUE: { label: 'Overdue', cls: 'bg-rose-100 text-rose-700' },
};

export const ORDER_STATUS_META = {
  PENDING: { label: 'Pending', cls: 'bg-elevated text-muted' },
  CONFIRMED: { label: 'Confirmed', cls: 'bg-sky-100 text-sky-700' },
  PACKED: { label: 'Packed', cls: 'bg-indigo-100 text-indigo-700' },
  SHIPPED: { label: 'Shipped', cls: 'bg-violet-100 text-violet-700' },
  DELIVERED: { label: 'Delivered', cls: 'bg-emerald-100 text-emerald-700' },
  CANCELLED: { label: 'Cancelled', cls: 'bg-elevated text-muted' },
};

export const ORDER_PAYMENT_META = {
  UNPAID: { label: 'Unpaid', cls: 'bg-rose-100 text-rose-700' },
  PARTIAL: { label: 'Partial', cls: 'bg-amber-100 text-amber-700' },
  PAID: { label: 'Paid', cls: 'bg-emerald-100 text-emerald-700' },
};

export const WITHDRAWAL_STATUS_META = {
  PENDING: { label: 'Pending', cls: 'bg-amber-100 text-amber-700' },
  APPROVED: { label: 'Approved', cls: 'bg-sky-100 text-sky-700' },
  REJECTED: { label: 'Rejected', cls: 'bg-rose-100 text-rose-700' },
  PAID: { label: 'Paid', cls: 'bg-emerald-100 text-emerald-700' },
};

export const RETURN_STATUS_META = {
  PENDING: { label: 'Pending Approval', cls: 'bg-amber-100 text-amber-700' },
  APPROVED: { label: 'Approved', cls: 'bg-emerald-100 text-emerald-700' },
  REJECTED: { label: 'Rejected', cls: 'bg-rose-100 text-rose-700' },
  COMPLETED: { label: 'Approved', cls: 'bg-emerald-100 text-emerald-700' }, // legacy
  CANCELLED: { label: 'Cancelled', cls: 'bg-elevated text-muted' },
};

