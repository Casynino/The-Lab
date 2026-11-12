import { LIVE } from '@/lib/polling';
import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { Plus, Search, X, CheckCircle, XCircle, Eye, Clock, CheckCircle2, PackageOpen, PackageCheck } from 'lucide-react';
import api, { unwrap, apiError } from '@/lib/api';
import { pageQueries, keepOnPageTurn } from '@/lib/pageQueries';
import { useOnce } from '@/lib/useOnce';
import { useAuth } from '@/context/AuthContext';
import { useProducts, useCustomers, useSalesReps, useWarehouses } from '@/lib/hooks';
import { ROLES } from '@/lib/constants';
import { formatDate, formatDateTime, formatNumber, formatCurrency, unitWord } from '@/lib/format';
import { approvalLeftLabel } from '@/lib/labels';
import {
  PageHeader, Card, PageSpinner, EmptyState, LoadError, Badge, Button, Modal, Field, Select, Textarea,
  Pagination, Table, THead, TBody, TR, TH, TD,
} from '@/components/ui';
import NumberedLines from '@/components/NumberedLines';
import CollapsibleList from '@/components/CollapsibleList';

function defaultPkg(product) {
  if (!product?.packagings?.length) return null;
  return product.packagings.find((p) => p.isBaseUnit) || product.packagings[0];
}

// Statuses render from here rather than a shared map. The shared one carried
// light-theme chips and had no EXPIRED entry, so an expired return fell back to
// the PENDING label and read "Pending Approval" long after it had died.
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
      // The order's locked boxes and its deadline change too (audit #113).
      ['returns', 'settlements', 'settlement'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
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

  // One press goes through until it has an answer: a same-frame double tap sent two approvals and the
  // second showed "already decided" after a good approval (audit admin-ops-3).
  const once = useOnce();
  const approve = useMutation({
    mutationFn: () => api.post(`/returns/${returnId}/approve`),
    onSuccess: () => { toast.success('Return approved'); invalidate(); onClose(); },
    onError: (e) => toast.error(apiError(e)),
    onSettled: once.done,
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
            {canDecide && pending && <Button loading={approve.isPending} onClick={() => once.run(() => approve.mutate())}><CheckCircle className="h-4 w-4" /> Approve return</Button>}
          </>
        )}>
        {isLoading || !ret ? <PageSpinner /> : (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div><div className="text-xs text-faint">Type</div><div className="font-medium">{ret.type === 'CUSTOMER_RETURN' ? 'Customer return' : 'Rep → ZELab'}</div></div>
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
              {/* Numbered, one row per product: the five-column table this replaced pushed the
                  value and condition off the edge of a phone. */}
              <NumberedLines
                items={ret.items.map((i) => ({
                  key: i.id,
                  name: i.product?.name,
                  detail: [
                    `${formatNumber(i.quantity)} ${unitWord(i.quantity, i.packagingUnit?.name || 'box')} × ${formatCurrency(i.unitPrice)}`,
                    i.condition,
                  ].filter(Boolean).join(' · '),
                  value: formatCurrency(i.quantity * Number(i.unitPrice || 0)),
                }))}
              />
              <div className="mt-2 flex items-center justify-between rounded-xl bg-elevated px-3 py-2.5 text-sm font-semibold text-foreground">
                <span>Total · {formatNumber(totalBoxes)} {unitWord(totalBoxes)}</span>
                <span className="tabular-nums">{formatCurrency(totalValue)}</span>
              </div>
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
  // Customers and the rep list are only for staff (the server refuses the rep list to reps).
  const { data: customers = [] } = useCustomers({}, { enabled: !isRep });
  const { data: reps = [] } = useSalesReps({}, { enabled: !isRep });
  const { data: warehouses = [] } = useWarehouses();

  // Reps only ever return stock TO ZELab; the server auto-matches the boxes
  // to their open orders. Customer returns are a staff flow.
  const [type, setType] = useState(isRep ? 'SALES_RETURN' : 'CUSTOMER_RETURN');
  const [customerId, setCustomerId] = useState('');
  const [salesRepId, setSalesRepId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [reason, setReason] = useState('');
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState({});

  // Rep → ZELab picked by staff works like the rep's own screen (Nino, 11 Nov 2026: "when I pick a rep it should
  // show what he has, and I just return it from the active orders"): the list is what THAT rep still holds on his
  // open orders, each capped at what he holds. The warehouse is the primary one unless changed.
  const scoped = isRep || (type === 'SALES_RETURN' && !!salesRepId);
  useEffect(() => { setCart({}); }, [type, salesRepId]); // another rep's boxes are not this rep's
  useEffect(() => {
    if (type === 'SALES_RETURN' && !warehouseId) {
      const home = warehouses.find((w) => w.isPrimary && w.isActive !== false) || (warehouses.length === 1 ? warehouses[0] : null);
      if (home) setWarehouseId(home.id);
    }
  }, [type, warehouses, warehouseId]);

  // A rep can only give back boxes still on his open orders. Read them as the order's own Return screen
  // does — what is left, less boxes locked in a pending return or waiting in a settlement — added up over
  // every open order. The server matches the boxes to the orders oldest-first and checks again.
  const { data: openOrders = [], isLoading: loadingOrders, isError: ordersFailed } = useQuery({
    queryKey: ['settlements', 'return-availability', isRep ? 'me' : salesRepId],
    enabled: scoped,
    staleTime: 0, // read fresh each time the box opens
    queryFn: async () => {
      // The server scopes a rep to his own orders; staff ask for the chosen rep's.
      const params = isRep ? { open: true, limit: 100 } : { open: true, limit: 100, salesRepId };
      const rows = unwrap(await api.get('/settlements', { params })).data || [];
      return Promise.all(rows.map(async (s) => unwrap(await api.get(`/settlements/${s.id}`)).data));
    },
  });
  // available: productId -> boxes. fines: the delay fine of each order the boxes could land on (TSh 30,000
  // on an extended order, 15,000 otherwise — the server sends each order's own figure).
  const { available, fines } = useMemo(() => {
    const avail = new Map();
    const rates = new Set();
    for (const o of openOrders) {
      const inSettlement = new Map();
      (o.pendingSubmissionsList || []).forEach((p) => inSettlement.set(p.productId, (inSettlement.get(p.productId) || 0) + (p.boxes || 0)));
      for (const l of o.order?.lines || []) {
        const n = l.remaining - (l.pendingReturn || 0) - (inSettlement.get(l.productId) || 0);
        if (n <= 0) continue;
        avail.set(l.productId, (avail.get(l.productId) || 0) + n);
        if (o.returnFailurePenalty) rates.add(o.returnFailurePenalty);
      }
    }
    return { available: avail, fines: [...rates].sort((a, b) => a - b) };
  }, [openOrders]);
  const maxFor = (id) => (scoped ? available.get(id) || 0 : Infinity);

  function setQty(productId, qty) {
    const capped = Math.min(qty, maxFor(productId));
    setCart((prev) => {
      if (capped <= 0) { const n = { ...prev }; delete n[productId]; return n; }
      return { ...prev, [productId]: capped };
    });
  }
  const inc = (id) => setQty(id, (cart[id] || 0) + 1);
  const dec = (id) => setQty(id, (cart[id] || 0) - 1);

  const filtered = useMemo(() => {
    // Reps see only what they hold on an open order; staff pick from the whole catalogue.
    const pool = scoped ? products.filter((p) => (available.get(p.id) || 0) > 0) : products;
    const q = search.trim().toLowerCase();
    return q ? pool.filter((p) => p.name.toLowerCase().includes(q)) : pool;
  }, [products, search, scoped, available]);

  const fineText = fines.length === 0
    ? 'a delay fine'
    : fines.length === 1
      ? `a ${formatCurrency(fines[0])} delay fine`
      : `a ${formatCurrency(fines[0])} delay fine (${formatCurrency(fines[fines.length - 1])} on an extended order)`;

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
        : 'Return sent');
      qc.invalidateQueries({ queryKey: ['returns'] });
      qc.invalidateQueries({ queryKey: ['settlements'] });
      qc.invalidateQueries({ queryKey: ['settlement'] }); // the order screen's box locks (audit #113)
      onClose();
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const valid = hasCart && (
    isRep ? true : type === 'SALES_RETURN' ? (salesRepId && warehouseId) : (salesRepId || warehouseId)
  );

  const footer = (
    <div className="flex w-full items-center gap-1 rounded-full bg-elevated/70 p-1 ring-1 ring-white/[0.08]">
      <button type="button" onClick={onClose}
        className="h-9 shrink-0 rounded-full px-4 text-[13px] font-medium text-muted transition hover:text-foreground active:scale-[0.97]">
        Cancel
      </button>
      <Button className="h-9 flex-1 justify-center rounded-full px-4 text-[13px] font-semibold" loading={create.isPending} disabled={!valid} onClick={() => create.mutate()}>
        {hasCart ? `Return ${formatNumber(totalBoxes)} box${totalBoxes !== 1 ? 'es' : ''}` : 'Return'}
      </Button>
    </div>
  );

  return (
    <Modal open onClose={onClose} size="lg" title="Return" footer={footer}>
      <div className="space-y-4">
        {/* Type toggle — staff only; reps always return to ZELab */}
        {!isRep && (
          <div className="flex gap-2">
            {[['CUSTOMER_RETURN', 'Customer return'], ['SALES_RETURN', 'Rep → ZELab']].map(([k, label]) => (
              <button key={k} onClick={() => { setType(k); setCart({}); }}
                className={`flex-1 rounded-lg border px-4 py-2 text-sm font-semibold transition ${type === k ? 'border-brand-500 bg-brand-500/10 text-brand-600' : 'border-border text-muted hover:bg-elevated'}`}>
                {label}
              </button>
            ))}
          </div>
        )}

        {/* Pending-approval notice — a slim amber line down the side, no box */}
        <div className="border-l-2 border-amber-400/60 pl-3 text-xs leading-relaxed text-amber-300">
          {isRep
            ? `Your boxes go back to ZELab and are cleared off your open orders once approved. Submitted boxes are locked, and the request must be decided within 24 hours or it expires with ${fineText}.`
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
            <Field label="Into ZELab" required={type === 'SALES_RETURN'}
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
          {!isRep && type === 'SALES_RETURN' && !salesRepId && (
            <p className="py-4 text-center text-sm text-muted">Pick the rep — his boxes on open orders show here.</p>
          )}
          {scoped && loadingOrders && <p className="py-4 text-center text-sm text-muted">Loading {isRep ? 'your' : 'his'} open orders…</p>}
          {scoped && !loadingOrders && ordersFailed && (
            <p className="py-4 text-center text-sm text-rose-400">Could not load {isRep ? 'your' : 'his'} open orders. Close and try again.</p>
          )}
          {scoped && !loadingOrders && !ordersFailed && available.size === 0 && (
            <p className="py-4 text-center text-sm text-muted">No boxes left to return on {isRep ? 'your' : 'his'} open orders.</p>
          )}
          {(isRep || type !== 'SALES_RETURN' || salesRepId) && filtered.map((product) => {
            const qty = cart[product.id] || 0;
            const inCart = qty > 0;
            const max = maxFor(product.id);
            return (
              <div key={product.id} className={`px-1 py-2.5 transition ${inCart ? 'bg-brand-500/5' : ''}`}>
                {/* The name has the line to itself and stays on it; the stepper sits under it. */}
                <div title={product.name} className={`truncate text-sm font-medium ${inCart ? 'text-foreground' : 'text-muted'}`}>{product.name}</div>
                <div className="mt-1.5 flex items-center justify-end gap-1.5">
                  {scoped && <span className="mr-auto text-xs text-faint">{formatNumber(max)} {isRep ? 'available' : 'on his open orders'}</span>}
                  <button onClick={() => dec(product.id)} disabled={qty === 0}
                    className="flex h-11 w-11 items-center justify-center rounded-full border sm:h-8 sm:w-8 border-white/[0.12] bg-white/[0.05] text-lg font-bold text-muted transition hover:text-foreground disabled:opacity-30">−</button>
                  <input type="number" min="0" max={scoped ? max : undefined} value={qty === 0 ? '' : qty}
                    onChange={(e) => { const v = parseInt(e.target.value, 10); setQty(product.id, isNaN(v) || v < 0 ? 0 : v); }}
                    placeholder="0"
                    className="h-11 w-14 rounded-lg border sm:h-8 border-border bg-elevated text-center text-sm font-semibold text-foreground [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" />
                  <button onClick={() => inc(product.id)} disabled={qty >= max}
                    className="flex h-11 w-11 items-center justify-center rounded-full border sm:h-8 sm:w-8 border-brand-500/40 bg-brand-500/15 text-lg font-bold text-brand-500 transition hover:bg-brand-500/25 disabled:opacity-30">+</button>
                </div>
              </div>
            );
          })}
        </div>

        {/* What is about to be returned, numbered — check it here before pressing Submit. */}
        {hasCart && (
          <div>
            <div className="mb-2 text-sm font-semibold text-foreground">
              Boxes to return · {Object.keys(cart).length} product{Object.keys(cart).length !== 1 ? 's' : ''}
            </div>
            <NumberedLines
              items={Object.entries(cart).map(([productId, quantity]) => ({
                key: productId,
                name: products.find((p) => p.id === productId)?.name || 'Product',
                detail: `${formatNumber(quantity)} box${quantity !== 1 ? 'es' : ''}`,
              }))}
            />
          </div>
        )}

        <Field label="Reason">
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. damaged in transit, customer over-ordered" />
        </Field>
      </div>
    </Modal>
  );
}

// ── Pending row — same compact shape as "Pending settlement approvals" ───────
function PendingReturnRow({ r, canDecide, onView, onReject, onCancel, approve, onApprove }) {
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
        {/* Several products: numbered, with the quantity AFTER the name ("1. Name · 4 boxes"), so the
            number in front is never read as a number of boxes. */}
        {r.items.map((i, n) => (
          <div key={i.id} className="mt-0.5 flex gap-1 text-xs text-faint">
            {r.items.length > 1 && <span className="shrink-0 font-semibold text-muted">{n + 1}.</span>}
            <span title={i.product?.name} className="min-w-0 truncate">{i.product?.name}</span>
            <span className="shrink-0 font-semibold text-muted">· {formatNumber(i.quantity)} box{plural(i.quantity)}</span>
          </div>
        ))}
        <div className="mt-1 text-xs text-faint">
          {r.settlementNumber ? `on ${r.settlementNumber} · ` : ''}{formatDateTime(r.processedAt)}
          <span className={expiring ? ' font-semibold text-rose-400' : ' text-amber-400'}> · {hoursLeft < 1 ? 'expires within the hour' : `expires in ${Math.floor(hoursLeft)}h`}</span>
        </div>
      </button>
      <div className="flex w-full shrink-0 gap-3 sm:w-auto sm:gap-2">
        {onCancel && <Button variant="ghost" className="min-h-11 flex-1 text-rose-500 sm:min-h-0 sm:flex-none" onClick={() => onCancel(r.id)}>Cancel request</Button>}
        {canDecide && (
          <>
            <Button variant="ghost" className="min-h-11 flex-1 text-rose-500 sm:min-h-0 sm:flex-none" onClick={() => onReject(r.id)}>Reject</Button>
            <Button className="min-h-11 flex-1 sm:min-h-0 sm:flex-none" loading={busy} onClick={() => (onApprove ? onApprove(r.id) : approve.mutate(r.id))}><CheckCircle className="h-4 w-4" /> Approve</Button>
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

// ── The rep's Returns page, in the same style as their Requests page (Nino, 11 Nov 2026: "like the one you
// showed me for requests — nice, not this"): a premium New return card, the returns still waiting as soft
// cards, the rest in a History list that opens and closes. The tiles and the paragraph under them are gone;
// the owner's and the warehouse's page is untouched.
function RepReturnsView({ all, isLoading, failed = false, onRetry, onNew, onView, onCancel, cancellingId = null }) {
  const pending = all.filter((r) => r.status === 'PENDING');
  const done = all.filter((r) => r.status !== 'PENDING');
  return (
    <div>
      <button
        type="button"
        onClick={onNew}
        className="premium-card premium-card--sm mb-7 flex h-14 w-full items-center justify-between px-5 text-left transition hover:brightness-110 active:scale-[0.99]"
      >
        <span className="text-[17px] font-bold tracking-tight text-white">New return</span>
        <Plus className="h-6 w-6 text-brand-500" strokeWidth={2.4} aria-hidden="true" />
      </button>

      {isLoading ? (
        <PageSpinner />
      ) : failed ? (
        <LoadError what="your returns" onRetry={onRetry} />
      ) : all.length === 0 ? (
        <div className="mt-14 px-1 text-center">
          <PackageOpen className="mx-auto h-6 w-6 text-muted" aria-hidden="true" />
          <p className="mt-3 text-sm font-medium text-foreground">No returns yet</p>
          <p className="mt-1 text-xs text-muted">Tap New return to send boxes back to ZELab.</p>
        </div>
      ) : (
        <div className="space-y-8">
          {pending.length > 0 && (
            <div>
              <h2 className="mb-3 px-1 text-lg font-bold text-foreground">
                Waiting
                <span className="ml-2 text-sm font-medium text-muted">{pending.length}</span>
              </h2>
              <div className="space-y-3">
                {pending.map((r) => {
                  const boxes = boxesOf(r);
                  // 24 hours to be decided, then it expires and the boxes go back on the order.
                  const hoursLeft = Math.max(0, 24 - (Date.now() - new Date(r.processedAt).getTime()) / 3600000);
                  const expiring = hoursLeft <= 6;
                  const names = r.items.map((i) => i.product?.name).filter(Boolean);
                  return (
                    <div
                      key={r.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => onView(r.id)}
                      onKeyDown={(e) => { if (e.key === 'Enter') onView(r.id); }}
                      className="active-card block cursor-pointer"
                      data-tone="near"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm font-semibold text-foreground">{r.returnNumber}</span>
                        <span className={clsx('text-[13px] font-semibold', expiring ? 'text-rose-300' : 'text-amber-300')}>{approvalLeftLabel(hoursLeft)}</span>
                      </div>
                      <p className="mt-2 text-[22px] font-bold leading-none tabular-nums text-amber-300">{formatNumber(boxes)} box{plural(boxes)}</p>
                      {names.length > 0 && (
                        <p className="mt-1.5 truncate text-xs text-muted">{names[0]}{names.length > 1 ? ` · +${names.length - 1} more` : ''}</p>
                      )}
                      <div className="mt-3 flex items-center justify-between gap-3 border-t border-white/[0.08] pt-3">
                        <span className="text-xs text-muted">Waiting for ZELab</span>
                        {/* Busy while the cancel is on its way (audit #28): no second tap. */}
                        <button
                          type="button"
                          disabled={cancellingId != null}
                          onClick={(e) => { e.stopPropagation(); onCancel(r.id); }}
                          className="text-xs font-semibold text-rose-300 transition hover:text-rose-200 disabled:opacity-50"
                        >
                          {cancellingId === r.id ? 'Cancelling…' : 'Cancel'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {done.length > 0 && (
            <CollapsibleList title="History" count={done.length} defaultOpen={pending.length === 0}>
              {done.map((r) => {
                const meta = statusMeta(r.status);
                const tone = meta.cls?.split(' ').find((c) => c.startsWith('text-')) || 'text-muted';
                const boxes = boxesOf(r);
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => onView(r.id)}
                    className="flex w-full items-start justify-between gap-3 px-4 py-3.5 text-left transition hover:bg-white/[0.04] active:bg-white/[0.06]"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground">{r.returnNumber}</p>
                      <p className="mt-0.5 text-xs tabular-nums text-muted">{formatNumber(boxes)} box{plural(boxes)}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className={clsx('text-[13px] font-medium', tone)}>{meta.label}</p>
                      <p className="mt-0.5 text-xs text-muted">{formatDate(r.processedAt)}</p>
                    </div>
                  </button>
                );
              })}
            </CollapsibleList>
          )}
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function Returns() {
  const { user } = useAuth();
  const isRep = user?.role === ROLES.SALES_REP;
  const canDecide = user?.role === ROLES.ADMIN || user?.role === ROLES.WAREHOUSE_STAFF;

  const qc = useQueryClient();
  const [typeFilter, setTypeFilter] = useState('');
  // The admin list pages through every return (it stopped at the latest 100); a rep's stays one page.
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [rejectingId, setRejectingId] = useState(null);
  const [viewingId, setViewingId] = useState(null);
  const [confirmCancelId, setConfirmCancelId] = useState(null); // the rep's "are you sure?" before a cancel

  const { data: summary } = useQuery({
    ...pageQueries.returnsSummary(),
    refetchInterval: LIVE,
  });
  const { data, isLoading, isError, refetch } = useQuery({
    ...pageQueries.returns({ type: typeFilter, page }),
    placeholderData: keepOnPageTurn({ type: typeFilter }),
    refetchInterval: LIVE,
  });

  // Per row: one press goes through until it has an answer (audit admin-ops-3).
  const once = useOnce();
  const approve = useMutation({
    mutationFn: (id) => api.post(`/returns/${id}/approve`),
    onSuccess: () => {
      toast.success('Return approved');
      ['returns', 'settlements', 'settlement', 'inventory', 'dashboard'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    },
    onError: (e) => toast.error(apiError(e)),
    onSettled: (_d, _e, id) => once.release(id),
  });
  const approveOnce = (id) => once.run(() => approve.mutate(id), id);
  const cancel = useMutation({
    mutationFn: (id) => api.post(`/returns/${id}/cancel`),
    onSuccess: () => {
      toast.success('Return cancelled');
      ['returns', 'settlements', 'settlement', 'dashboard'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    },
    onError: (e) => toast.error(apiError(e)),
    onSettled: () => setConfirmCancelId(null),
  });

  const all = data?.data || [];

  if (isRep) {
    const toCancel = all.find((r) => r.id === confirmCancelId);
    return (
      <div>
        <RepReturnsView all={all} isLoading={isLoading} failed={isError && !data} onRetry={refetch} onNew={() => setOpen(true)} onView={setViewingId} onCancel={setConfirmCancelId} cancellingId={cancel.isPending ? cancel.variables : null} />
        {open && <ReturnModal onClose={() => setOpen(false)} />}
        {viewingId && <ReturnDetailModal returnId={viewingId} canDecide={false} onClose={() => setViewingId(null)} />}
        {/* One tap used to cancel at once (audit C34): the same second step as cancelling a stock request. */}
        {confirmCancelId && (
          <Modal
            open
            size="sm"
            title="Cancel this return?"
            onClose={cancel.isPending ? () => {} : () => setConfirmCancelId(null)}
            footer={
              <>
                <Button variant="secondary" disabled={cancel.isPending} onClick={() => setConfirmCancelId(null)}>Keep it</Button>
                <Button variant="danger" loading={cancel.isPending} onClick={() => { if (!cancel.isPending) cancel.mutate(confirmCancelId); }}>Cancel return</Button>
              </>
            }
          >
            <p className="text-sm text-muted">
              {toCancel?.returnNumber || 'This return'} will be cancelled and its boxes stay on your order. Settle them or send a new return.
            </p>
          </Modal>
        )}
      </div>
    );
  }

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
      label: isRep ? 'Boxes ZELab took back' : 'Boxes back on the shelf',
      value: formatNumber(summary.boxesBack), icon: PackageCheck, sub: period,
      ring: 'ring-violet-500/25', glow: 'from-violet-500/[0.14]', chip: 'bg-violet-500/15 text-violet-300', num: 'text-violet-300',
    },
    {
      label: isRep ? 'Waiting on ZELab' : 'Waiting your approval',
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
    { key: 'SALES_RETURN', label: 'Rep → ZELab', count: summary?.salesReturns, tone: 'bg-sky-500/15 text-sky-300 ring-sky-500/30' },
    { key: 'CUSTOMER_RETURN', label: 'Customer returns', count: summary?.customerReturns, tone: 'bg-sky-500/15 text-sky-300 ring-sky-500/30' },
  ];

  return (
    <div>
      <PageHeader
        title="Returns"
        subtitle={isRep ? 'Your returns — what you sent back, and whether ZELab accepted it.' : 'Who returned stock, what, how many boxes — and what needs your action.'}
      >
        <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> New return</Button>
      </PageHeader>

      {summary && (
        <div className={`grid grid-cols-2 gap-3 ${cards.length > 4 ? 'xl:grid-cols-5' : 'xl:grid-cols-4'}`}>
          {/* An odd last card takes the whole row below xl instead of leaving a hole beside it. */}
          {cards.map((c, i) => (
            <div key={c.label} className={`stat-glass p-4 ${i === cards.length - 1 && cards.length % 2 === 1 ? 'col-span-2 xl:col-span-1' : ''}`}>
              <div className="relative flex items-start justify-between gap-2">
                <p className="text-xs font-medium text-muted">{c.label}</p>
                <span className={`rounded-full p-1.5 ring-1 ring-inset ring-white/10 ${c.chip}`}><c.icon className="h-3.5 w-3.5" /></span>
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
              {' '}<b className="text-foreground">{formatNumber(summary.boxesBack)}</b> box{plural(summary.boxesBack)} back {isRep ? 'with ZELab' : 'on the shelf'}.
              {summary.pending > 0 && (
                <> <b className="text-amber-400">{formatNumber(summary.pending)}</b> return{summary.pending === 1 ? '' : 's'} holding
                  {' '}<b className="text-amber-400">{formatNumber(summary.pendingBoxes)}</b> box{plural(summary.pendingBoxes)}
                  {' '}{isRep ? 'are still waiting on ZELab' : 'still need your decision'}.</>
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
            <button key={c.key || 'all'} type="button" onClick={() => { setTypeFilter(c.key); setPage(1); }}
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

      {/* The list is one page of records (the pager below walks the rest); the cards above are the full history. */}
      {isLoading ? (
        <Card className="mt-4"><PageSpinner /></Card>
      ) : isError && !data ? (
        <Card className="mt-4"><LoadError what="the returns" onRetry={refetch} /></Card>
      ) : all.length === 0 ? (
        <Card className="mt-4">
          <EmptyState icon={PackageOpen} title="No returns to show"
            message={typeFilter ? 'No returns of this kind — try another chip above.' : isRep ? 'Nothing you sent back is on record yet.' : 'Nobody has sent stock back yet.'} />
        </Card>
      ) : (
        <div className="mt-4 space-y-8">
          {/* ── Pending — compact approval strip, same as settlements ── */}
          {pending.length > 0 && (
            // The one card that needs action wears the rep's amber "waiting" glass. A plain card's tinted
            // border is cleared by the admin glass, so this strip looked like the history cards below it.
            <div className="stat-glass" data-tone="near">
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
                    onCancel={isRep ? (id) => cancel.mutate(id) : undefined} approve={approve} onApprove={approveOnce} />
                ))}
              </div>
            </div>
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

          {(page > 1 || total > all.length) && (
            <Pagination page={page} totalPages={data?.meta?.totalPages} total={data?.meta?.total} onChange={setPage} />
          )}
        </div>
      )}

      {open && <ReturnModal onClose={() => setOpen(false)} />}
      {rejectingId && <RejectModal returnId={rejectingId} onClose={() => setRejectingId(null)} />}
      {viewingId && <ReturnDetailModal returnId={viewingId} canDecide={canDecide} onClose={() => setViewingId(null)} />}
    </div>
  );
}
