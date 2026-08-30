import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import {
  Plus, Minus, X, Search, ShoppingCart, ClipboardList, Eye,
  Loader2, CheckCircle2, Pencil, ChevronRight, Clock, XCircle, Ban, Boxes, Wallet, Timer,
} from 'lucide-react';
import api, { unwrap, apiError } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useProducts } from '@/lib/hooks';
import { ROLES, REQUEST_STATUS_META } from '@/lib/constants';
import { formatDate, formatDateTime, formatCurrency, formatNumber } from '@/lib/format';
import {
  PageHeader, Card, PageSpinner, EmptyState, Badge, Button, Modal, Field, Input,
  Pagination, Table, THead, TBody, TR, TH, TD,
} from '@/components/ui';

// ── helpers ───────────────────────────────────────────────────────────────────

// For fulfilled orders, recompute from quantityApproved on each item so that
// partial-approval edits are reflected correctly even on older records.
function orderDisplayValue(r) {
  if (r.status === 'FULFILLED') {
    return r.items.reduce((s, i) => s + (i.quantityApproved ?? 0) * Number(i.unitPrice || 0), 0);
  }
  return Number(r.totalValue || 0);
}

// Per-request line/box counts (use approved figures once fulfilled).
function requestQty(r, i) {
  return r.status === 'FULFILLED' ? (i.quantityApproved ?? 0) : i.quantityRequested;
}
function productCount(r) {
  return r.items.filter((i) => requestQty(r, i) > 0).length;
}
function boxCount(r) {
  return r.items.reduce((s, i) => s + (requestQty(r, i) || 0), 0);
}

// Workflow-accurate status: a fulfilled request is "Approved" once the doctor
// issues it, then "Settled" when its linked order is fully settled/closed.
function requestDisplayStatus(r) {
  if (r.status === 'FULFILLED') {
    return r.settlement?.status === 'SETTLED'
      ? { label: 'Settled', cls: 'bg-emerald-100 text-emerald-700' }
      : { label: 'Approved', cls: 'bg-sky-100 text-sky-700' };
  }
  const m = REQUEST_STATUS_META[r.status] || {};
  return { label: m.label || r.status, cls: m.cls || 'bg-elevated text-muted' };
}

function defaultPkg(product) {
  if (!product?.packagings?.length) return null;
  return product.packagings.find((p) => p.isBaseUnit) || product.packagings[0];
}

function pkgPrice(product, pkg) {
  if (!product || !pkg) return 0;
  if (pkg.unitPrice != null) return Number(pkg.unitPrice);
  return Number(product.sellingPrice || 0) * (pkg.baseQuantity || 1);
}

// ── Order sheet (rep only) ────────────────────────────────────────────────────

function CartOrderSheet({ onClose, existing }) {
  const editing = !!existing;
  const { data: products = [], isLoading: productsLoading } = useProducts();
  // Only products currently in stock at The Lab can be ordered (ids only — no
  // counts, so stock levels stay hidden from reps). Refreshes in real time.
  const { data: availableIds = [], isLoading: availLoading } = useQuery({
    queryKey: ['stock-requests', 'available-products'],
    queryFn: async () => unwrap(await api.get('/stock-requests/available-products')).data,
    refetchInterval: 60_000,
  });
  const [cart, setCart] = useState(() =>
    existing ? Object.fromEntries(existing.items.map((i) => [i.productId, i.quantityRequested])) : {},
  );
  const [search, setSearch] = useState('');
  const [notes, setNotes] = useState(existing?.notes || '');
  const qc = useQueryClient();

  // In-stock set; when editing, keep this order's existing products visible too
  // so they can still be reduced/removed even if now out of stock.
  const sellable = useMemo(() => {
    const ok = new Set(availableIds);
    if (existing) existing.items.forEach((i) => ok.add(i.productId));
    return products.filter((p) => ok.has(p.id));
  }, [products, availableIds, existing]);

  function setQty(productId, qty) {
    setCart((prev) => {
      if (qty <= 0) { const n = { ...prev }; delete n[productId]; return n; }
      return { ...prev, [productId]: qty };
    });
  }
  const inc = (id) => setQty(id, (cart[id] || 0) + 1);
  const dec = (id) => setQty(id, (cart[id] || 0) - 1);

  const cartEntries = useMemo(() =>
    Object.entries(cart).map(([productId, qty]) => {
      const product = products.find((p) => p.id === productId);
      if (!product) return null;
      const pkg = defaultPkg(product);
      const price = pkgPrice(product, pkg);
      return { productId, product, pkg, qty, price, lineTotal: price * qty };
    }).filter(Boolean),
  [cart, products]);

  const cartCount = Object.keys(cart).length;
  const totalBoxes = cartEntries.reduce((s, e) => s + e.qty, 0);
  const totalAmount = cartEntries.reduce((s, e) => s + e.lineTotal, 0);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? sellable.filter((p) => p.name.toLowerCase().includes(q)) : sellable;
  }, [sellable, search]);

  const create = useMutation({
    mutationFn: () => {
      const body = {
        items: cartEntries.map(({ productId, pkg, qty }) => ({
          productId,
          packagingUnitId: pkg.packagingUnitId,
          quantity: qty,
        })),
        notes: notes || undefined,
      };
      return editing
        ? api.put(`/stock-requests/${existing.id}`, body)
        : api.post('/stock-requests', body);
    },
    onSuccess: () => {
      toast.success(editing ? 'Order updated' : 'Order submitted for approval!');
      qc.invalidateQueries({ queryKey: ['stock-requests'] });
      qc.invalidateQueries({ queryKey: ['dashboard', 'me'] });
      onClose();
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const footerContent = (
    <>
      {cartCount > 0 && (
        <div className="flex flex-1 flex-col">
          <span className="text-sm font-semibold text-foreground">{formatCurrency(totalAmount)}</span>
          <span className="text-xs text-muted">
            {formatNumber(totalBoxes)} box{totalBoxes !== 1 ? 'es' : ''} · {cartCount} product{cartCount !== 1 ? 's' : ''}
          </span>
        </div>
      )}
      <Button variant="secondary" onClick={onClose}>Cancel</Button>
      <Button
        disabled={cartCount === 0 || create.isPending}
        onClick={() => create.mutate()}
      >
        {create.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
        <ShoppingCart className="h-4 w-4" />
        {editing ? 'Save changes' : 'Submit for approval'}
      </Button>
    </>
  );

  return (
    <Modal open onClose={onClose} title={editing ? `Edit order ${existing.requestNumber}` : 'New stock request'} size="lg" footer={footerContent}>
      {/* Search */}
      <div className="relative mb-4">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search products…"
          className="input pl-9 pr-8"
        />
        {search && (
          <button
            onClick={() => setSearch('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-faint hover:text-muted"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Product list */}
      {productsLoading || availLoading ? (
        <div className="flex items-center justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted" /></div>
      ) : (
        <ul className="-mx-5 divide-y divide-border">
          {filtered.map((product) => {
            const pkg = defaultPkg(product);
            const price = pkgPrice(product, pkg);
            const qty = cart[product.id] || 0;
            const inCart = qty > 0;

            return (
              <li
                key={product.id}
                className={`flex items-center gap-3 px-5 py-3 transition-colors ${inCart ? 'bg-brand-500/5' : 'hover:bg-elevated'}`}
              >
                {/* selected indicator */}
                <div className="flex w-4 shrink-0 items-center justify-center">
                  {inCart
                    ? <CheckCircle2 className="h-4 w-4 text-brand-500" />
                    : <span className="h-1.5 w-1.5 rounded-full bg-border" />
                  }
                </div>

                {/* name + price */}
                <div className="min-w-0 flex-1">
                  <div className={`text-sm font-medium leading-tight ${inCart ? 'text-foreground' : 'text-muted'}`}>
                    {product.name}
                  </div>
                  <div className="mt-0.5 text-xs text-faint">
                    {formatCurrency(price)} / {pkg?.packagingUnit?.name || 'box'}
                  </div>
                </div>

                {/* qty controls — type directly or tap +/- */}
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    onClick={() => dec(product.id)}
                    disabled={qty === 0}
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted transition hover:border-brand-500/40 hover:text-foreground active:scale-90 disabled:opacity-25"
                  >
                    <Minus className="h-3.5 w-3.5" />
                  </button>
                  <input
                    type="number"
                    min="0"
                    value={qty === 0 ? '' : qty}
                    onChange={(e) => {
                      const v = parseInt(e.target.value, 10);
                      setQty(product.id, isNaN(v) || v < 0 ? 0 : v);
                    }}
                    placeholder="0"
                    className={`h-8 w-14 rounded-lg border text-center text-sm font-semibold tabular-nums outline-none transition
                      [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none
                      ${inCart
                        ? 'border-brand-500/40 bg-brand-500/10 text-brand-400 focus:ring-1 focus:ring-brand-500/30'
                        : 'border-border bg-elevated text-muted focus:border-brand-500/40 focus:text-foreground'
                      }`}
                  />
                  <button
                    onClick={() => inc(product.id)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500 text-slate-950 transition hover:bg-brand-400 active:scale-90"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            );
          })}
          {filtered.length === 0 && (
            <li className="py-10 text-center text-sm text-muted">{search ? 'No products match your search' : 'No products are in stock right now'}</li>
          )}
        </ul>
      )}

      {/* Notes */}
      <div className="mt-4">
        <Field label="Notes (optional)">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. restock for next week…"
            rows={2}
            className="input resize-none"
          />
        </Field>
      </div>
    </Modal>
  );
}

// ── Order detail (admin / staff review + rep view) ────────────────────────────

function OrderDetailModal({ request, isRep, staff, onClose, onEdit }) {
  const qc = useQueryClient();
  const pending = request.status === 'PENDING';
  const fulfilled = request.status === 'FULFILLED';
  const editable = staff && pending;
  const [qtys, setQtys] = useState(() =>
    Object.fromEntries(request.items.map((i) => [i.id, i.quantityApproved ?? i.quantityRequested])),
  );

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['stock-requests'] });
    qc.invalidateQueries({ queryKey: ['settlements'] });
    qc.invalidateQueries({ queryKey: ['inventory'] });
    qc.invalidateQueries({ queryKey: ['dashboard', 'me'] });
  };

  const approve = useMutation({
    mutationFn: () => api.post(`/stock-requests/${request.id}/approve`, {
      approvals: request.items.map((i) => ({ itemId: i.id, quantityApproved: Number(qtys[i.id]) || 0 })),
    }),
    onSuccess: () => { toast.success('Approved — stock issued & order opened'); invalidate(); onClose(); },
    onError: (e) => toast.error(apiError(e)),
  });
  const reject = useMutation({
    mutationFn: () => api.post(`/stock-requests/${request.id}/reject`, {}),
    onSuccess: () => { toast.success('Order rejected'); invalidate(); onClose(); },
    onError: (e) => toast.error(apiError(e)),
  });
  const cancel = useMutation({
    mutationFn: () => api.post(`/stock-requests/${request.id}/cancel`, {}),
    onSuccess: () => { toast.success('Order cancelled'); invalidate(); onClose(); },
    onError: (e) => toast.error(apiError(e)),
  });

  // While editing: live total from the qty inputs.
  const editingTotal = request.items.reduce(
    (s, i) => s + (Number(qtys[i.id]) || 0) * Number(i.unitPrice || 0), 0,
  );

  // For fulfilled orders: always recompute from quantityApproved so stale
  // totalValue / lineTotal on old records never appears.
  const displayItems = fulfilled
    ? request.items.filter((i) => (i.quantityApproved ?? 0) > 0)
    : request.items;
  const displayTotal = fulfilled
    ? request.items.reduce((s, i) => s + (i.quantityApproved ?? 0) * Number(i.unitPrice || 0), 0)
    : editable ? editingTotal : Number(request.totalValue || 0);

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={`Order ${request.requestNumber}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Close</Button>
          {editable && <Button variant="ghost" className="text-rose-500" loading={reject.isPending} onClick={() => reject.mutate()}>Reject</Button>}
          {editable && <Button loading={approve.isPending} onClick={() => approve.mutate()}>Approve &amp; issue</Button>}
          {isRep && pending && <Button variant="ghost" onClick={() => onEdit?.(request)}><Pencil className="h-4 w-4" /> Edit order</Button>}
          {isRep && pending && <Button variant="danger" loading={cancel.isPending} onClick={() => cancel.mutate()}>Cancel order</Button>}
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div><div className="text-xs text-faint">Rep</div><div className="font-medium">{request.salesRep?.user?.name}</div></div>
          <div><div className="text-xs text-faint">Status</div><Badge className={requestDisplayStatus(request).cls}>{requestDisplayStatus(request).label}</Badge></div>
          <div><div className="text-xs text-faint">Requested</div><div className="font-medium">{formatDateTime(request.requestedAt)}</div></div>
          <div><div className="text-xs text-faint">Lines</div><div className="font-medium">{displayItems.length}</div></div>
        </div>

        <Table>
          <THead>
            <TR>
              <TH>Product</TH>
              <TH>{fulfilled ? 'Approved' : 'Requested'}</TH>
              {editable && <TH>Approve qty</TH>}
              <TH>Unit price</TH>
              <TH>Line total</TH>
            </TR>
          </THead>
          <TBody>
            {displayItems.map((i) => {
              const lineTotal = fulfilled
                ? (i.quantityApproved ?? 0) * Number(i.unitPrice || 0)
                : editable
                  ? (Number(qtys[i.id]) || 0) * Number(i.unitPrice || 0)
                  : Number(i.lineTotal || 0);
              return (
                <TR key={i.id}>
                  <TD className="font-medium text-foreground">{i.product.name}</TD>
                  <TD>
                    {fulfilled
                      ? `${i.quantityApproved} ${i.packagingUnit.name}`
                      : `${i.quantityRequested} ${i.packagingUnit.name}`}
                  </TD>
                  {editable && (
                    <TD>
                      <Input type="number" min="0" value={qtys[i.id]} onChange={(e) => setQtys({ ...qtys, [i.id]: e.target.value })} className="w-20" />
                    </TD>
                  )}
                  <TD>{formatCurrency(i.unitPrice)}</TD>
                  <TD>{formatCurrency(lineTotal)}</TD>
                </TR>
              );
            })}
          </TBody>
        </Table>

        <div className="flex items-center justify-between rounded-xl bg-elevated px-4 py-3">
          <span className="text-sm font-medium text-muted">
            {fulfilled ? 'Approved order value' : editable ? 'Approved order value' : 'Order value'}
          </span>
          <span className="text-xl font-bold text-foreground">{formatCurrency(displayTotal)}</span>
        </div>

        {request.notes && <div className="text-sm"><span className="text-faint">Notes: </span>{request.notes}</div>}
        {editable && <p className="text-xs text-faint">Approving issues the stock to the rep and opens a 72-hour payment order. Set a line to 0 to drop it.</p>}
      </div>
    </Modal>
  );
}

// ── Rep card views (match the Orders & Settlements layout) ────────────────────

// Prominent card for a request still awaiting approval (the rep can edit/cancel).
function RepRequestCard({ r, onClick }) {
  const products = productCount(r);
  const boxes = boxCount(r);
  const ds = requestDisplayStatus(r);
  return (
    <motion.button
      whileTap={{ scale: 0.985 }}
      onClick={onClick}
      className="w-full rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 text-left transition hover:bg-elevated"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-bold text-foreground">{r.requestNumber}</span>
        <Badge className={ds.cls}>{ds.label}</Badge>
      </div>

      <div className="mt-3">
        <div className="text-[11px] uppercase tracking-widest text-faint">Order value</div>
        <div className="mt-0.5 text-2xl font-black tabular-nums text-amber-400">{formatCurrency(orderDisplayValue(r))}</div>
      </div>

      <div className="mt-1.5 text-xs text-faint">
        {products} product{products !== 1 ? 's' : ''} · {formatNumber(boxes)} box{boxes !== 1 ? 'es' : ''} · {formatDateTime(r.requestedAt)}
      </div>

      <div className="mt-3 flex items-center justify-between border-t border-white/8 pt-3">
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-400">
          <Clock className="h-3.5 w-3.5" /> Waiting for approval · tap to edit
        </span>
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-brand-400">
          View details <ChevronRight className="h-3.5 w-3.5" />
        </span>
      </div>
    </motion.button>
  );
}

// Compact row for a finished request (approved/issued, rejected, or cancelled).
function RepRequestRow({ r, onClick }) {
  const ds = requestDisplayStatus(r);
  const settled = r.settlement?.status === 'SETTLED';
  const Icon = r.status === 'FULFILLED' ? CheckCircle2 : r.status === 'REJECTED' ? XCircle : Ban;
  const iconCls = r.status === 'FULFILLED'
    ? (settled ? 'text-emerald-500' : 'text-sky-500')
    : r.status === 'REJECTED' ? 'text-rose-500' : 'text-faint';
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition hover:bg-elevated active:bg-elevated"
    >
      <Icon className={clsx('h-5 w-5 shrink-0', iconCls)} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-semibold text-foreground">{r.requestNumber}</span>
          <Badge className={ds.cls}>{ds.label}</Badge>
        </div>
        <div className="mt-0.5 text-xs text-faint">
          {productCount(r)} product{productCount(r) !== 1 ? 's' : ''} · {formatNumber(boxCount(r))} box{boxCount(r) !== 1 ? 'es' : ''} · {formatCurrency(orderDisplayValue(r))}
        </div>
      </div>
      <span className="hidden shrink-0 text-xs text-faint sm:block">{formatDate(r.requestedAt)}</span>
      <ChevronRight className="h-4 w-4 shrink-0 text-faint" />
    </button>
  );
}

function RepRequestsView({ onView }) {
  const { data, isLoading } = useQuery({
    queryKey: ['stock-requests', 'rep-all'],
    queryFn: async () => unwrap(await api.get('/stock-requests', { params: { limit: 100 } })),
    refetchInterval: 60_000,
  });

  if (isLoading) return <PageSpinner />;

  const all = data?.data || [];
  const active = all.filter((r) => r.status === 'PENDING');
  const completed = all.filter((r) => r.status !== 'PENDING');

  return (
    <div className="space-y-8">
      {/* ── Active (needs your attention) ── */}
      <div>
        <div className="mb-3 flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-brand-500" />
          <h2 className="text-base font-bold text-foreground">
            Active requests
            {active.length > 0 && (
              <span className="ml-2 rounded-full bg-brand-500 px-2 py-0.5 text-[11px] font-black text-slate-950">{active.length}</span>
            )}
          </h2>
        </div>
        {active.length === 0 ? (
          <div className="rounded-2xl border border-border bg-surface">
            <EmptyState
              title="No requests waiting"
              message="When you submit a stock request, it shows here until The Lab approves it."
              icon={ClipboardList}
            />
          </div>
        ) : (
          <div className="space-y-3">
            {active.map((r) => <RepRequestCard key={r.id} r={r} onClick={() => onView(r)} />)}
          </div>
        )}
      </div>

      {/* ── Completed ── */}
      {completed.length > 0 && (
        <div>
          <div className="mb-2 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            <h2 className="text-sm font-semibold text-muted">Completed requests ({completed.length})</h2>
          </div>
          <Card>
            <div className="divide-y divide-border p-1">
              {completed.map((r) => <RepRequestRow key={r.id} r={r} onClick={() => onView(r)} />)}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

// ── Pending approval center (mirrors the settlements strip) ───────────────────
// Every waiting request pinned on top with its lines visible; quick Approve
// issues the full requested quantities, Review opens the modal to adjust.
function PendingRequestApprovals({ onReview }) {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['stock-requests', 'pending-approvals'],
    queryFn: async () => unwrap(await api.get('/stock-requests', { params: { status: 'PENDING', limit: 50 } })),
    refetchInterval: 30_000,
  });
  const pending = data?.data || [];

  const refresh = () => {
    ['stock-requests', 'settlements', 'inventory', 'dashboard'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  };
  const approve = useMutation({
    mutationFn: (id) => api.post(`/stock-requests/${id}/approve`, {}),
    onSuccess: () => { toast.success('Approved — stock issued & 72h order opened'); refresh(); },
    onError: (e) => toast.error(apiError(e)),
  });
  const reject = useMutation({
    mutationFn: (id) => api.post(`/stock-requests/${id}/reject`, {}),
    onSuccess: () => { toast.success('Request rejected'); refresh(); },
    onError: (e) => toast.error(apiError(e)),
  });

  if (!pending.length) return null;

  return (
    <Card className="mb-6 border-sky-500/30">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <ClipboardList className="h-4 w-4 text-sky-400" />
        <h2 className="text-sm font-bold text-foreground">Pending stock requests</h2>
        <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[11px] font-bold text-sky-400">{pending.length}</span>
        <span className="ml-auto hidden text-xs text-faint sm:block">Approve issues the stock and opens the 72h order</span>
      </div>
      <div className="divide-y divide-border">
        {pending.map((r) => {
          const busy = (approve.isPending && approve.variables === r.id) || (reject.isPending && reject.variables === r.id);
          const boxes = boxCount(r);
          return (
            <div key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <button onClick={() => onReview(r)} className="min-w-0 flex-1 text-left" title="Open to review or adjust quantities">
                <div className="text-sm font-semibold text-foreground">
                  {r.salesRep?.user?.name} ({r.salesRep?.code}) · {formatNumber(boxes)} box{boxes !== 1 ? 'es' : ''} · {formatCurrency(orderDisplayValue(r))}
                </div>
                {r.items.map((i) => (
                  <div key={i.id} className="mt-0.5 text-xs text-faint">
                    <span className="font-semibold text-muted">{i.quantityRequested}×</span> {i.product?.name}
                  </div>
                ))}
                <div className="mt-0.5 text-xs text-faint">
                  {r.requestNumber} · {formatDateTime(r.requestedAt)}{r.notes ? ` · ${r.notes}` : ''}
                </div>
              </button>
              <div className="flex shrink-0 gap-2">
                <Button variant="ghost" className="text-rose-500" disabled={busy} onClick={() => reject.mutate(r.id)}>Reject</Button>
                <Button loading={busy} onClick={() => approve.mutate(r.id)}><CheckCircle2 className="h-4 w-4" /> Approve</Button>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ── Staff table (admin / warehouse review) ────────────────────────────────────

function StaffRequestTable({ onView }) {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const { data, isLoading } = useQuery({
    queryKey: ['stock-requests', { page, status }],
    queryFn: async () => unwrap(await api.get('/stock-requests', { params: { page, limit: 15, status: status || undefined } })),
  });

  // Pending requests live in the approval strip above — the history table
  // shows decided ones unless the filter explicitly asks for pending.
  const rows = (data?.data || []).filter((r) => status === 'PENDING' || r.status !== 'PENDING');

  // What this page is really a record of: boxes leaving the warehouse. The
  // table said "2 line(s)", which counts products on a form and tells you
  // nothing about stock. These add up what is on screen.
  const pageBoxes = rows.reduce((a, r) => a + (r.boxesApproved || boxCount(r)), 0);
  const pageValue = rows.reduce((a, r) => a + orderDisplayValue(r), 0);
  const settledCount = rows.filter((r) => r.settlement?.status === 'SETTLED').length;
  const openCount = rows.filter((r) => r.status === 'FULFILLED' && r.settlement?.status !== 'SETTLED').length;

  const chips = [
    { key: '', label: 'All decided', tone: 'slate' },
    ...Object.entries(REQUEST_STATUS_META).map(([k, v]) => ({ key: k, label: v.label, tone: k === 'REJECTED' ? 'rose' : k === 'PENDING' ? 'amber' : 'emerald' })),
  ];
  const TONE = {
    slate: 'bg-white/10 text-foreground ring-white/20',
    emerald: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',
    amber: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
    rose: 'bg-rose-500/15 text-rose-300 ring-rose-500/30',
  };

  return (
    <div className="space-y-4">
      {/* What left the warehouse, in the view you are looking at. */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[
          { label: 'Boxes issued', value: formatNumber(pageBoxes), icon: Boxes, sub: 'in this view',
            ring: 'ring-violet-500/25', glow: 'from-violet-500/[0.14]', chip: 'bg-violet-500/15 text-violet-300', num: 'text-violet-300' },
          { label: 'Value issued', value: formatCurrency(pageValue), icon: Wallet, sub: `${formatNumber(rows.length)} order${rows.length === 1 ? '' : 's'}`,
            ring: 'ring-brand-500/25', glow: 'from-brand-500/[0.12]', chip: 'bg-brand-500/15 text-brand-300', num: 'text-brand-300' },
          { label: 'Still open', value: formatNumber(openCount), icon: Timer, sub: 'issued, not yet settled',
            ring: openCount > 0 ? 'ring-amber-500/30' : 'ring-white/[0.07]', glow: openCount > 0 ? 'from-amber-500/[0.14]' : 'from-white/[0.02]',
            chip: 'bg-amber-500/15 text-amber-300', num: openCount > 0 ? 'text-amber-300' : 'text-foreground' },
          { label: 'Settled', value: formatNumber(settledCount), icon: CheckCircle2, sub: 'closed and paid for',
            ring: 'ring-emerald-500/25', glow: 'from-emerald-500/[0.12]', chip: 'bg-emerald-500/15 text-emerald-300', num: 'text-emerald-300' },
        ].map((c) => (
          <div key={c.label} className={`relative overflow-hidden rounded-2xl bg-surface p-4 ring-1 ${c.ring}`}>
            <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${c.glow} to-transparent`} aria-hidden="true" />
            <div className="relative flex items-start justify-between gap-2">
              <p className="text-xs font-medium text-muted">{c.label}</p>
              <span className={`rounded-lg p-1.5 ${c.chip}`}><c.icon className="h-3.5 w-3.5" /></span>
            </div>
            <p className={`relative mt-2 text-2xl font-bold tabular-nums ${c.num}`}>{c.value}</p>
            <p className="relative mt-0.5 text-[11px] text-faint">{c.sub}</p>
          </div>
        ))}
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-4">
          {chips.map((c) => (
            <button key={c.key || 'all'} type="button" onClick={() => { setStatus(c.key); setPage(1); }}
              className={`cursor-pointer rounded-full px-3.5 py-2 text-sm font-medium ring-1 transition duration-200 ${
                status === c.key ? TONE[c.tone] : 'bg-transparent text-muted ring-white/10 hover:bg-white/[0.05] hover:text-foreground'}`}>
              {c.label}
            </button>
          ))}
        </div>

        {isLoading ? <PageSpinner /> : !rows.length ? (
          <EmptyState title="No stock requests" icon={ClipboardList} />
        ) : (
          <>
            <Table>
              <THead>
                <TR>
                  <TH>Order</TH><TH>Rep</TH><TH>Boxes out</TH><TH>Products</TH><TH>Value</TH><TH>Status</TH><TH>Requested</TH><TH />
                </TR>
              </THead>
              <TBody>
                {rows.map((r) => {
                  const asked = r.boxesRequested ?? boxCount(r);
                  const given = r.boxesApproved ?? boxCount(r);
                  const shortfall = r.status === 'FULFILLED' && asked > given;
                  return (
                    <TR key={r.id} className="cursor-pointer" onClick={() => onView(r)}>
                      <TD className="font-medium">{r.requestNumber}</TD>
                      <TD>{r.salesRep?.user?.name}</TD>
                      {/* The number this page exists to record. */}
                      <TD>
                        <span className="font-semibold tabular-nums text-foreground">{formatNumber(given)}</span>
                        {shortfall && (
                          <span className="ml-1.5 text-[11px] text-amber-400">of {formatNumber(asked)} asked</span>
                        )}
                      </TD>
                      <TD className="text-muted">{productCount(r)}</TD>
                      <TD className="font-medium">{formatCurrency(orderDisplayValue(r))}</TD>
                      <TD>{(() => { const ds = requestDisplayStatus(r); return <Badge className={ds.cls}>{ds.label}</Badge>; })()}</TD>
                      <TD className="text-faint">{formatDateTime(r.requestedAt)}</TD>
                      <TD>
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-brand-600">
                          {r.status === 'PENDING' ? 'Review' : 'View'} <Eye className="h-3.5 w-3.5" />
                        </span>
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
            <Pagination page={page} totalPages={data.meta?.totalPages} total={data.meta?.total} onChange={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function StockRequests() {
  const { hasRole, user } = useAuth();
  const isRep = user?.role === ROLES.SALES_REP;
  const staff = hasRole(ROLES.WAREHOUSE_STAFF);
  const [cartOpen, setCartOpen] = useState(false);
  const [viewing, setViewing] = useState(null);
  const [editing, setEditing] = useState(null);

  return (
    <div>
      <PageHeader
        title="Stock Requests"
        subtitle={isRep ? 'Request stock from The Lab — tap a request to view details.' : "Approve or reject reps' stock requests."}
      >
        {isRep && (
          <Button onClick={() => setCartOpen(true)}>
            <Plus className="h-4 w-4" /> New request
          </Button>
        )}
      </PageHeader>

      {isRep ? <RepRequestsView onView={setViewing} /> : (
        <>
          <PendingRequestApprovals onReview={setViewing} />
          <StaffRequestTable onView={setViewing} />
        </>
      )}

      {/* Cart sheet — slides up from bottom (new order or editing a pending one) */}
      <AnimatePresence>
        {cartOpen && <CartOrderSheet onClose={() => setCartOpen(false)} />}
        {editing && <CartOrderSheet existing={editing} onClose={() => setEditing(null)} />}
      </AnimatePresence>

      {viewing && (
        <OrderDetailModal
          request={viewing}
          isRep={isRep}
          staff={staff}
          onClose={() => setViewing(null)}
          onEdit={(req) => { setViewing(null); setEditing(req); }}
        />
      )}
    </div>
  );
}
