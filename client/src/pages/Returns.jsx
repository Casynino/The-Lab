import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Plus, Search, X, CheckCircle, XCircle, Eye, Clock, CheckCircle2, PackageOpen, PackageCheck } from 'lucide-react';
import api, { unwrap, apiError } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useProducts, useCustomers, useSalesReps, useWarehouses } from '@/lib/hooks';
import { ROLES } from '@/lib/constants';
import { formatDate, formatDateTime, formatNumber, formatCurrency } from '@/lib/format';
import {
  PageHeader, Card, PageSpinner, EmptyState, Badge, Button, Modal, Field, Select, Textarea,
  Table, THead, TBody, TR, TH, TD,
} from '@/components/ui';

function defaultPkg(product) {
  if (!product?.packagings?.length) return null;
  return product.packagings.find((p) => p.isBaseUnit) || product.packagings[0];
}

// The shared RETURN_STATUS_META still carries light-theme chips (bg-amber-100)
// from the old theme, and has no EXPIRED entry — an expired return therefore
// fell back to the PENDING label and read "Pending Approval" long after it had
// died. Both are fixed here, where the statuses are actually rendered.
const STATUS_META = {
  PENDING: { label: 'Waiting approval', cls: 'bg-amber-500/15 text-amber-300' },
  APPROVED: { label: 'Approved', cls: 'bg-emerald-500/15 text-emerald-300' },
  COMPLETED: { label: 'Approved', cls: 'bg-emerald-500/15 text-emerald-300' },
  REJECTED: { label: 'Rejected', cls: 'bg-rose-500/15 text-rose-300' },
  CANCELLED: { label: 'Cancelled', cls: 'bg-white/10 text-muted' },
  EXPIRED: { label: 'Expired', cls: 'bg-rose-500/15 text-rose-300' },
};
const statusMeta = (status) => STATUS_META[status] || STATUS_META.PENDING;

const boxesOf = (r) => (r.items || []).reduce((a, i) => a + i.quantity, 0);
const plural = (n) => (n === 1 ? '' : 'es');

// ── Reject modal ──────────────────────────────────────────────────────────────
function RejectModal({ returnId, onClose, onRejected }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const reject = useMutation({
    mutationFn: () => api.post(`/returns/${returnId}/reject`, { reason: reason || undefined }),
    onSuccess: () => {
      toast.success('Return rejected');
      qc.invalidateQueries({ queryKey: ['returns'] });
      onRejected?.();
      onClose();
    },
    onError: (e) => toast.error(apiError(e)),
  });
  return (
    <Modal open onClose={onClose} title="Reject return"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={reject.isPending} onClick={() => reject.mutate()} className="bg-rose-600 hover:bg-rose-500 text-white">Reject return</Button></>}>
      <Field label="Reason" hint="Optional — will be shown to the rep">
        <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. quantity mismatch, wrong product…" />
      </Field>
    </Modal>
  );
}

// ── Return detail modal: open a return, review every line, then decide ────────
function ReturnDetailModal({ returnId, canDecide, onClose }) {
  const qc = useQueryClient();
  const [rejecting, setRejecting] = useState(false);

  const { data: ret, isLoading } = useQuery({
    queryKey: ['return', returnId],
    queryFn: async () => unwrap(await api.get(`/returns/${returnId}`)).data,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['returns'] });
    qc.invalidateQueries({ queryKey: ['return', returnId] });
    qc.invalidateQueries({ queryKey: ['settlements'] });
    qc.invalidateQueries({ queryKey: ['settlement'] });
    qc.invalidateQueries({ queryKey: ['inventory'] });
  };

  const approve = useMutation({
    mutationFn: () => api.post(`/returns/${returnId}/approve`),
    onSuccess: () => { toast.success('Return approved — inventory updated'); invalidate(); onClose(); },
    onError: (e) => toast.error(apiError(e)),
  });

  const pending = ret?.status === 'PENDING';
  const meta = ret ? statusMeta(ret.status) : null;
  const totalBoxes = ret ? boxesOf(ret) : 0;
  const totalValue = ret?.items?.reduce((s, i) => s + i.quantity * Number(i.unitPrice || 0), 0) || 0;

  return (
    <>
      <Modal open onClose={onClose} size="lg" title={ret ? `Return ${ret.returnNumber}` : 'Return'}
        footer={ret && (
          <>
            <Button variant="secondary" onClick={onClose}>Close</Button>
            {canDecide && pending && <Button variant="ghost" className="text-rose-500" onClick={() => setRejecting(true)}><XCircle className="h-4 w-4" /> Reject</Button>}
            {canDecide && pending && <Button loading={approve.isPending} onClick={() => approve.mutate()}><CheckCircle className="h-4 w-4" /> Approve return</Button>}
          </>
        )}>
        {isLoading || !ret ? <PageSpinner /> : (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div><div className="text-xs text-faint">Type</div><div className="font-medium">{ret.type === 'CUSTOMER_RETURN' ? 'Customer return' : 'Rep → The Lab'}</div></div>
              <div><div className="text-xs text-faint">Status</div><Badge className={meta.cls}>{meta.label}</Badge></div>
              <div><div className="text-xs text-faint">Rep / Customer</div><div className="font-medium">{ret.salesRep?.user?.name || ret.customer?.name || '—'}</div></div>
              <div><div className="text-xs text-faint">Warehouse</div><div className="font-medium">{ret.warehouse?.name || '—'}</div></div>
              <div><div className="text-xs text-faint">Submitted</div><div className="font-medium">{formatDateTime(ret.processedAt)}</div></div>
              <div><div className="text-xs text-faint">Submitted by</div><div className="font-medium">{ret.processedBy?.name || '—'}</div></div>
              {ret.decidedAt && <div><div className="text-xs text-faint">Decided</div><div className="font-medium">{formatDateTime(ret.decidedAt)}</div></div>}
              {ret.decidedBy?.name && <div><div className="text-xs text-faint">Decided by</div><div className="font-medium">{ret.decidedBy.name}</div></div>}
            </div>

            {ret.reason && (
              <div className="rounded-lg border border-border bg-elevated px-3 py-2 text-sm"><span className="text-faint">Reason: </span>{ret.reason}</div>
            )}
            {ret.status === 'REJECTED' && ret.rejectionReason && (
              <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-sm text-rose-400"><span className="opacity-70">Rejection reason: </span>{ret.rejectionReason}</div>
            )}

            <div>
              <div className="mb-2 text-sm font-semibold text-foreground">Items returned</div>
              <Table>
                <THead><TR><TH>Product</TH><TH>Quantity</TH><TH>Condition</TH><TH>Unit price</TH><TH>Line value</TH></TR></THead>
                <TBody>
                  {ret.items.map((i) => (
                    <TR key={i.id}>
                      <TD className="font-medium text-foreground">{i.product?.name}</TD>
                      <TD>{formatNumber(i.quantity)} {i.packagingUnit?.name || 'box'}(s)</TD>
                      <TD className="text-muted">{i.condition}</TD>
                      <TD>{formatCurrency(i.unitPrice)}</TD>
                      <TD>{formatCurrency(i.quantity * Number(i.unitPrice || 0))}</TD>
                    </TR>
                  ))}
                  <TR className="font-semibold">
                    <TD>Total</TD>
                    <TD>{formatNumber(totalBoxes)} box(es)</TD>
                    <TD />
                    <TD />
                    <TD>{formatCurrency(totalValue)}</TD>
                  </TR>
                </TBody>
              </Table>
            </div>

            {canDecide && pending && (
              <div className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-400">
                Approving verifies these boxes back into {ret.type === 'SALES_RETURN' ? 'warehouse' : 'rep'} stock and updates inventory — and clears them off any linked order. This can’t be undone.
              </div>
            )}
          </div>
        )}
      </Modal>

      {rejecting && <RejectModal returnId={returnId} onClose={() => setRejecting(false)} onRejected={onClose} />}
    </>
  );
}

// ── New return modal ──────────────────────────────────────────────────────────
function ReturnModal({ onClose }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const isRep = user?.role === ROLES.SALES_REP;
  const { data: products = [] } = useProducts();
  const { data: customers = [] } = useCustomers();
  const { data: reps = [] } = useSalesReps();
  const { data: warehouses = [] } = useWarehouses();

  // Reps only ever return stock TO The Lab; the server auto-matches the boxes
  // to their open orders. Customer returns are a staff flow.
  const [type, setType] = useState(isRep ? 'SALES_RETURN' : 'CUSTOMER_RETURN');
  const [customerId, setCustomerId] = useState('');
  const [salesRepId, setSalesRepId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [reason, setReason] = useState('');
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState({});

  function setQty(productId, qty) {
    setCart((prev) => {
      if (qty <= 0) { const n = { ...prev }; delete n[productId]; return n; }
      return { ...prev, [productId]: qty };
    });
  }
  const inc = (id) => setQty(id, (cart[id] || 0) + 1);
  const dec = (id) => setQty(id, (cart[id] || 0) - 1);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? products.filter((p) => p.name.toLowerCase().includes(q)) : products;
  }, [products, search]);

  const totalBoxes = Object.values(cart).reduce((s, q) => s + q, 0);
  const hasCart = totalBoxes > 0;

  const create = useMutation({
    mutationFn: () => {
      const items = Object.entries(cart).map(([productId, quantity]) => {
        const product = products.find((p) => p.id === productId);
        const pkg = defaultPkg(product);
        return { productId, packagingUnitId: pkg?.packagingUnitId, quantity };
      });
      const payload = { type, items, reason: reason || undefined, customerId: customerId || null };
      if (!isRep && salesRepId) payload.salesRepId = salesRepId;
      if (warehouseId) payload.warehouseId = warehouseId;
      return api.post('/returns', payload);
    },
    onSuccess: (res) => {
      const d = unwrap(res).data;
      const related = d?.related || [];
      toast.success(related.length > 1
        ? `Return submitted as ${related.join(' + ')} (matched to your open orders)`
        : 'Return submitted — awaiting The Lab approval');
      qc.invalidateQueries({ queryKey: ['returns'] });
      onClose();
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const valid = hasCart && (
    isRep ? true : type === 'SALES_RETURN' ? (salesRepId && warehouseId) : (salesRepId || warehouseId)
  );

  const footer = (
    <>
      {hasCart && (
        <div className="flex flex-1 flex-col">
          <span className="text-sm font-semibold text-foreground">{formatNumber(totalBoxes)} box{totalBoxes !== 1 ? 'es' : ''} selected</span>
        </div>
      )}
      <Button variant="secondary" onClick={onClose}>Cancel</Button>
      <Button loading={create.isPending} disabled={!valid} onClick={() => create.mutate()}>Submit return</Button>
    </>
  );

  return (
    <Modal open onClose={onClose} size="lg" title="Submit a return" footer={footer}>
      <div className="space-y-4">
        {/* Type toggle — staff only; reps always return to The Lab */}
        {!isRep && (
          <div className="flex gap-2">
            {[['CUSTOMER_RETURN', 'Customer return'], ['SALES_RETURN', 'Rep → The Lab']].map(([k, label]) => (
              <button key={k} onClick={() => { setType(k); setCart({}); }}
                className={`flex-1 rounded-lg border px-4 py-2 text-sm font-semibold transition ${type === k ? 'border-brand-500 bg-brand-500/10 text-brand-400' : 'border-border text-muted hover:bg-elevated'}`}>
                {label}
              </button>
            ))}
          </div>
        )}

        {/* Pending-approval notice */}
        <div className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-400">
          {isRep
            ? 'Your boxes go back to The Lab and are cleared off your open orders once approved. Submitted boxes are locked, and the request must be decided within 24 hours or it expires with a TSh 15,000 delay fine.'
            : 'Returns are pending until verified by the warehouse. Inventory updates only after approval. Pending returns expire after 24 hours.'}
        </div>

        {/* Routing selectors */}
        {type === 'CUSTOMER_RETURN' && (
          <Field label="Customer" hint="Optional">
            <Select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">— None —</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {!isRep && (
            <Field label={type === 'SALES_RETURN' ? 'From rep' : 'Into rep stock'} required={type === 'SALES_RETURN'}
              hint={type === 'CUSTOMER_RETURN' ? 'Or pick a warehouse →' : undefined}>
              <Select value={salesRepId} onChange={(e) => setSalesRepId(e.target.value)}>
                <option value="">{type === 'SALES_RETURN' ? 'Select rep…' : '— None —'}</option>
                {reps.map((r) => <option key={r.id} value={r.id}>{r.user?.name} ({r.code})</option>)}
              </Select>
            </Field>
          )}
          {!isRep && (
            <Field label="Into The Lab" required={type === 'SALES_RETURN'}
              hint={type === 'CUSTOMER_RETURN' ? 'Or pick a rep ←' : undefined}>
              <Select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
                <option value="">{type === 'SALES_RETURN' ? 'Select warehouse…' : '— None —'}</option>
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </Select>
            </Field>
          )}
        </div>

        {/* Product search */}
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search products…" className="input pl-9 pr-8" />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Product list */}
        <div className="-mx-1 max-h-56 divide-y divide-border overflow-y-auto">
          {filtered.map((product) => {
            const qty = cart[product.id] || 0;
            const inCart = qty > 0;
            return (
              <div key={product.id} className={`flex items-center gap-3 px-1 py-3 transition ${inCart ? 'bg-brand-500/5' : ''}`}>
                <div className="min-w-0 flex-1">
                  <div className={`text-sm font-medium leading-snug ${inCart ? 'text-foreground' : 'text-muted'}`}>{product.name}</div>
                </div>
                <div className="flex items-center gap-1.5">
                  <button onClick={() => dec(product.id)} disabled={qty === 0}
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-elevated text-lg font-bold text-muted transition hover:bg-surface disabled:opacity-30">−</button>
                  <input type="number" min="0" value={qty === 0 ? '' : qty}
                    onChange={(e) => { const v = parseInt(e.target.value, 10); setQty(product.id, isNaN(v) || v < 0 ? 0 : v); }}
                    placeholder="0"
                    className="h-8 w-14 rounded-lg border border-border bg-elevated text-center text-sm font-semibold text-foreground [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" />
                  <button onClick={() => inc(product.id)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500 text-lg font-bold text-slate-950 transition hover:bg-brand-400">+</button>
                </div>
              </div>
            );
          })}
        </div>

        <Field label="Reason">
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. damaged in transit, customer over-ordered" />
        </Field>
      </div>
    </Modal>
  );
}

// ── Pending row — same compact shape as "Pending settlement approvals" ───────
function PendingReturnRow({ r, canDecide, onView, onReject, onCancel, approve }) {
  const totalBoxes = boxesOf(r);
  const totalValue = r.items.reduce((a, i) => a + i.quantity * Number(i.unitPrice || 0), 0);
  const busy = approve && approve.isPending && approve.variables === r.id;
  // 24-hour decision window: after that the return expires automatically and
  // the boxes go back on the order (with a delay fine for the rep).
  const hoursLeft = Math.max(0, 24 - (Date.now() - new Date(r.processedAt).getTime()) / 3600000);
  const expiring = hoursLeft <= 6;
  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3">
      <button onClick={() => onView(r.id)} className="min-w-0 flex-1 text-left">
        {/* Who and which request first, then the number being decided. */}
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-sm font-semibold text-foreground">{r.returnNumber}</span>
          <span className="truncate text-sm text-muted">
            {r.salesRep ? `${r.salesRep.user?.name} (${r.salesRep.code})` : r.customer?.name || 'Customer'}
          </span>
        </div>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="text-xl font-bold tabular-nums text-amber-300">{formatNumber(totalBoxes)}</span>
          <span className="text-xs text-muted">box{plural(totalBoxes)} to verify · {formatCurrency(totalValue)}</span>
        </div>
        {/* Every line stays visible here — you are about to accept these goods. */}
        {r.items.map((i) => (
          <div key={i.id} className="mt-0.5 text-xs text-faint">
            <span className="font-semibold text-muted">{formatNumber(i.quantity)}×</span> {i.product?.name}
          </div>
        ))}
        <div className="mt-1 text-xs text-faint">
          {r.settlementNumber ? `on ${r.settlementNumber} · ` : ''}{formatDateTime(r.processedAt)}
          <span className={expiring ? ' font-semibold text-rose-400' : ' text-amber-400'}> · expires in {Math.ceil(hoursLeft)}h</span>
        </div>
      </button>
      <div className="flex shrink-0 gap-2">
        {onCancel && <Button variant="ghost" className="text-rose-500" onClick={() => onCancel(r.id)}>Cancel request</Button>}
        {canDecide && (
          <>
            <Button variant="ghost" className="text-rose-500" onClick={() => onReject(r.id)}>Reject</Button>
            <Button loading={busy} onClick={() => approve.mutate(r.id)}><CheckCircle className="h-4 w-4" /> Approve</Button>
          </>
        )}
      </div>
    </div>
  );
}

// Compact row for decided returns — products still visible, no digging.
function HistoryRow({ r, onView }) {
  const meta = statusMeta(r.status);
  const totalBoxes = boxesOf(r);
  const accepted = r.status === 'APPROVED' || r.status === 'COMPLETED';
  // A processed return is history. Listing every line as its own chip meant one
  // return could fill a phone screen — product names run to ~35 characters, so
  // each chip took a full row and fourteen returns became an endless scroll.
  // The first two lines are enough to recognise it; the rest is a tap away.
  const lines = r.items.map((i) => `${formatNumber(i.quantity)}x ${i.product?.name}`);
  const summary = lines.slice(0, 2).join(' · ') + (lines.length > 2 ? ` · +${lines.length - 2} more` : '');
  return (
    <button onClick={() => onView(r.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-elevated">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {/* The identifier never shrinks — a truncated "RET-2026…" is useless. */}
          <span className="shrink-0 text-sm font-semibold text-foreground">{r.returnNumber}</span>
          <span className="truncate text-sm text-muted">
            {r.salesRep ? `${r.salesRep.user?.name} (${r.salesRep.code})` : r.customer?.name || '—'}
          </span>
        </div>
        {/* What came back is one truncated line, so a return with five products
            is the same height as one with one. */}
        <p className="mt-0.5 truncate text-xs text-faint">
          {summary}
          {r.settlementNumber ? ` · on ${r.settlementNumber}` : ''} · {formatDate(r.processedAt)}
        </p>
      </div>
      {/* The figure the row exists for, and whether it counted. */}
      <div className="shrink-0 text-right">
        <div className={`text-lg font-bold leading-none tabular-nums ${accepted ? 'text-emerald-300' : 'text-muted'}`}>
          {formatNumber(totalBoxes)}
        </div>
        <div className="mt-0.5 text-[10px] uppercase tracking-wide text-faint">box{plural(totalBoxes)}</div>
      </div>
      <Badge className={`shrink-0 ${meta.cls}`}>{meta.label}</Badge>
      <Eye className="hidden h-3.5 w-3.5 shrink-0 text-faint sm:block" />
    </button>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function Returns() {
  const { user } = useAuth();
  const isRep = user?.role === ROLES.SALES_REP;
  const canDecide = user?.role === ROLES.ADMIN || user?.role === ROLES.WAREHOUSE_STAFF;

  const qc = useQueryClient();
  const [typeFilter, setTypeFilter] = useState('');
  const [open, setOpen] = useState(false);
  const [rejectingId, setRejectingId] = useState(null);
  const [viewingId, setViewingId] = useState(null);

  const { data: summary } = useQuery({
    queryKey: ['returns', 'summary'],
    queryFn: async () => unwrap(await api.get('/returns/summary')).data,
    refetchInterval: 30_000,
  });
  const { data, isLoading } = useQuery({
    queryKey: ['returns', { type: typeFilter }],
    queryFn: async () => unwrap(await api.get('/returns', { params: { limit: 100, type: typeFilter || undefined } })),
    refetchInterval: 30_000,
  });

  const approve = useMutation({
    mutationFn: (id) => api.post(`/returns/${id}/approve`),
    onSuccess: () => {
      toast.success('Return approved — inventory updated');
      ['returns', 'settlements', 'inventory', 'dashboard'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    },
    onError: (e) => toast.error(apiError(e)),
  });
  const cancel = useMutation({
    mutationFn: (id) => api.post(`/returns/${id}/cancel`),
    onSuccess: () => {
      toast.success('Return request cancelled — the boxes are back on the order');
      ['returns', 'settlements', 'dashboard'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const all = data?.data || [];
  const pending = all.filter((r) => r.status === 'PENDING');
  const approved = all.filter((r) => r.status === 'APPROVED' || r.status === 'COMPLETED');
  const rejected = all.filter((r) => ['REJECTED', 'CANCELLED', 'EXPIRED'].includes(r.status));
  const total = data?.meta?.total ?? all.length;
  const pendingBoxesShown = pending.reduce((a, r) => a + boxesOf(r), 0);

  // Every card figure is the server's count over the WHOLE history, not the
  // hundred rows listed below — so each one says the dates it covers.
  const span = summary?.firstAt
    ? (formatDate(summary.firstAt) === formatDate(summary.lastAt)
        ? formatDate(summary.firstAt)
        : `${formatDate(summary.firstAt)} to ${formatDate(summary.lastAt)}`)
    : null;
  const period = span ? `everything ${span}` : 'nothing returned yet';
  const quiet = { ring: 'ring-white/[0.08]', glow: 'from-white/[0.03]', chip: 'bg-white/10 text-muted', num: 'text-foreground' };
  const cards = summary ? [
    {
      // The number this page is a record of. A count of returns says how many
      // times it happened; it never says how much stock moved.
      label: isRep ? 'Boxes The Lab took back' : 'Boxes back on the shelf',
      value: formatNumber(summary.boxesBack), icon: PackageCheck, sub: period,
      ring: 'ring-violet-500/25', glow: 'from-violet-500/[0.14]', chip: 'bg-violet-500/15 text-violet-300', num: 'text-violet-300',
    },
    {
      label: isRep ? 'Waiting on The Lab' : 'Waiting your approval',
      value: formatNumber(summary.pending), icon: Clock,
      sub: summary.pending > 0
        ? `${formatNumber(summary.pendingBoxes)} box${plural(summary.pendingBoxes)} held right now, not on a shelf yet`
        : 'nothing waiting right now',
      ...(summary.pending > 0
        ? { ring: 'ring-amber-500/30', glow: 'from-amber-500/[0.14]', chip: 'bg-amber-500/15 text-amber-300', num: 'text-amber-300' }
        : quiet),
    },
    {
      label: 'Returns accepted', value: formatNumber(summary.approved), icon: CheckCircle2,
      sub: summary.totalReturns > 0 ? `of ${formatNumber(summary.totalReturns)} ever submitted` : 'none submitted yet',
      ...(summary.approved > 0
        ? { ring: 'ring-emerald-500/25', glow: 'from-emerald-500/[0.12]', chip: 'bg-emerald-500/15 text-emerald-300', num: 'text-emerald-300' }
        : quiet),
    },
    {
      label: 'Rejected or cancelled', value: formatNumber(summary.refused), icon: XCircle,
      sub: summary.refused > 0 ? 'all time — no stock came back on these' : 'nothing turned away',
      ...(summary.refused > 0
        ? { ring: 'ring-rose-500/30', glow: 'from-rose-500/[0.14]', chip: 'bg-rose-500/15 text-rose-300', num: 'text-rose-300' }
        : quiet),
    },
  ] : [];
  // "Returned today" is dead weight on the many days nothing comes back.
  if (summary && summary.todayBoxes > 0) {
    cards.push({
      label: 'Boxes logged today', value: formatNumber(summary.todayBoxes), icon: PackageOpen,
      sub: `on ${formatNumber(summary.todayCount)} return${summary.todayCount === 1 ? '' : 's'} submitted today`,
      ring: 'ring-sky-500/25', glow: 'from-sky-500/[0.12]', chip: 'bg-sky-500/15 text-sky-300', num: 'text-sky-300',
    });
  }

  // Type chips carry the server's whole-history count. A rep only ever files
  // one kind of return, so the choice is not offered to them.
  const chips = [
    { key: '', label: 'All returns', count: summary?.totalReturns, tone: 'bg-white/10 text-foreground ring-white/20' },
    { key: 'SALES_RETURN', label: 'Rep → The Lab', count: summary?.salesReturns, tone: 'bg-sky-500/15 text-sky-300 ring-sky-500/30' },
    { key: 'CUSTOMER_RETURN', label: 'Customer returns', count: summary?.customerReturns, tone: 'bg-sky-500/15 text-sky-300 ring-sky-500/30' },
  ];

  return (
    <div>
      <PageHeader
        title="Returns"
        subtitle={isRep ? 'Your returns — what you sent back, and whether The Lab accepted it.' : 'Who returned stock, what, how many boxes — and what needs your action.'}
      >
        <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> New return</Button>
      </PageHeader>

      {summary && (
        <div className={`grid grid-cols-2 gap-3 ${cards.length > 4 ? 'xl:grid-cols-5' : 'xl:grid-cols-4'}`}>
          {cards.map((c) => (
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
      )}

      {/* Five numbers still need a story — the owner reads this line first. */}
      {summary && (
        <p className="mt-4 text-xs leading-relaxed text-muted">
          {summary.totalReturns === 0 ? (
            <>Nothing has been returned yet. When {isRep ? 'you send boxes back' : 'a rep or a customer sends boxes back'}, every one of them is listed here.</>
          ) : (
            <>
              Stock has come back <b className="text-foreground">{formatNumber(summary.totalReturns)}</b> time{summary.totalReturns === 1 ? '' : 's'}
              {span && <> ({span})</>}. <b className="text-emerald-400">{formatNumber(summary.approved)}</b> of those were accepted, putting
              {' '}<b className="text-foreground">{formatNumber(summary.boxesBack)}</b> box{plural(summary.boxesBack)} back {isRep ? 'with The Lab' : 'on the shelf'}.
              {summary.pending > 0 && (
                <> <b className="text-amber-400">{formatNumber(summary.pending)}</b> return{summary.pending === 1 ? '' : 's'} holding
                  {' '}<b className="text-amber-400">{formatNumber(summary.pendingBoxes)}</b> box{plural(summary.pendingBoxes)}
                  {' '}{isRep ? 'are still waiting on The Lab' : 'still need your decision'}.</>
              )}
              {summary.refused > 0 && (
                <> <b className="text-foreground">{formatNumber(summary.refused)}</b> {summary.refused === 1 ? 'was' : 'were'} rejected, cancelled or expired, so those boxes never moved.</>
              )}
            </>
          )}
        </p>
      )}

      {!isRep && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {chips.map((c) => (
            <button key={c.key || 'all'} type="button" onClick={() => setTypeFilter(c.key)}
              className={`inline-flex cursor-pointer items-center gap-2 rounded-full px-3.5 py-2 text-sm font-medium ring-1 transition duration-200 ${
                typeFilter === c.key ? c.tone : 'bg-transparent text-muted ring-white/10 hover:bg-white/[0.05] hover:text-foreground'}`}>
              {c.label}
              {c.count != null && (
                <span className={`rounded-full px-1.5 py-0.5 text-[11px] font-bold tabular-nums ${
                  typeFilter === c.key ? 'bg-black/25' : 'bg-white/[0.07] text-faint'}`}>
                  {formatNumber(c.count)}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* The list is one page of records; the cards above are the full history. */}
      {total > all.length && (
        <p className="mt-2 text-[11px] text-faint">Listing the {formatNumber(all.length)} most recent of {formatNumber(total)} returns.</p>
      )}
      {isLoading ? (
        <Card className="mt-4"><PageSpinner /></Card>
      ) : all.length === 0 ? (
        <Card className="mt-4">
          <EmptyState icon={PackageOpen} title="No returns to show"
            message={typeFilter ? 'No returns of this kind — try another chip above.' : isRep ? 'Nothing you sent back is on record yet.' : 'Nobody has sent stock back yet.'} />
        </Card>
      ) : (
        <div className="mt-4 space-y-8">
          {/* ── Pending — compact approval strip, same as settlements ── */}
          {pending.length > 0 && (
            <Card className="border-amber-500/30">
              <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
                <Clock className="h-4 w-4 text-amber-500" />
                <h2 className="text-sm font-bold text-foreground">
                  {formatNumber(pendingBoxesShown)} box{plural(pendingBoxesShown)} waiting to be verified
                </h2>
                <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-bold text-amber-300">
                  {pending.length} return{pending.length === 1 ? '' : 's'}
                </span>
                <span className="ml-auto hidden text-xs text-faint sm:block">Inspect the goods before approving</span>
              </div>
              <div className="divide-y divide-border">
                {pending.map((r) => (
                  <PendingReturnRow key={r.id} r={r} canDecide={canDecide} onView={setViewingId} onReject={setRejectingId}
                    onCancel={isRep ? (id) => cancel.mutate(id) : undefined} approve={approve} />
                ))}
              </div>
            </Card>
          )}

          {/* ── Approved ── */}
          {approved.length > 0 && (
            <div>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                {/* The whole-history box total lives on the card above; repeating
                    a page-scoped one here would just contradict it. */}
                <h2 className="text-sm font-semibold text-muted">Accepted — {approved.length} return{approved.length === 1 ? '' : 's'} listed</h2>
              </div>
              <Card><div className="divide-y divide-border">{approved.map((r) => <HistoryRow key={r.id} r={r} onView={setViewingId} />)}</div></Card>
            </div>
          )}

          {/* ── Rejected ── */}
          {rejected.length > 0 && (
            <div>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <XCircle className="h-4 w-4 text-rose-500" />
                <h2 className="text-sm font-semibold text-muted">Rejected, cancelled or expired — {rejected.length} listed</h2>
                <span className="text-xs text-faint">no stock moved on these</span>
              </div>
              <Card><div className="divide-y divide-border">{rejected.map((r) => <HistoryRow key={r.id} r={r} onView={setViewingId} />)}</div></Card>
            </div>
          )}
        </div>
      )}

      {open && <ReturnModal onClose={() => setOpen(false)} />}
      {rejectingId && <RejectModal returnId={rejectingId} onClose={() => setRejectingId(null)} />}
      {viewingId && <ReturnDetailModal returnId={viewingId} canDecide={canDecide} onClose={() => setViewingId(null)} />}
    </div>
  );
}
