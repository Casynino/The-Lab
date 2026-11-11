import { LIVE, STEADY } from '@/lib/polling';
import { useState, useMemo, useRef } from 'react';
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
  PageHeader, Card, PageSpinner, EmptyState, Badge, Button, Modal, Field, Input, NumberInput,
  Pagination, LoadError, Table, THead, TBody, TR, TH, TD,
} from '@/components/ui';
import NumberedLines from '@/components/NumberedLines';
import CollapsibleList from '@/components/CollapsibleList';
import { repRegions, shortRegion } from '@/lib/repRegions';

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
// Distinct products: one product split between two cities is still one product.
function productCount(r) {
  return new Set(r.items.filter((i) => requestQty(r, i) > 0).map((i) => i.productId)).size;
}
function boxCount(r) {
  return r.items.reduce((s, i) => s + (requestQty(r, i) || 0), 0);
}

// Workflow-accurate status: a fulfilled request is "Approved" once the doctor
// issues it, then "Settled" when its linked order is fully settled/closed.
function requestDisplayStatus(r) {
  if (r.status === 'FULFILLED') {
    return r.settlement?.status === 'SETTLED'
      ? { label: 'Settled', cls: 'bg-emerald-500/15 text-emerald-300' }
      : { label: 'Approved', cls: 'bg-sky-500/15 text-sky-300' };
  }
  const m = REQUEST_STATUS_META[r.status] || {};
  return { label: m.label || r.status, cls: m.cls || 'bg-elevated text-muted' };
}

// The cities a request is for, in short form: its lines' cities (a rep with several cities can split one
// request between them), else the request's own city. Empty for old requests and one-city-less reps.
function requestCities(r) {
  const fromLines = [...new Set((r?.items || []).map((i) => i.region).filter(Boolean))];
  return (fromLines.length ? fromLines : r?.region ? [r.region] : []).map(shortRegion);
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
  // Only products currently in stock at ZELab can be ordered (ids only — no
  // counts, so stock levels stay hidden from reps). Refreshes in real time.
  const { data: availableIds = [], isLoading: availLoading } = useQuery({
    queryKey: ['stock-requests', 'available-products'],
    queryFn: async () => unwrap(await api.get('/stock-requests/available-products')).data,
    refetchInterval: STEADY,
  });
  const [search, setSearch] = useState('');
  const [notes, setNotes] = useState(existing?.notes || '');
  const qc = useQueryClient();
  // The city each box is for (Nino, 11 Nov 2026). One city: it is shown, already chosen, nothing to tap.
  // Two or more: the city words are tabs — the boxes set while a city is chosen are that city's, so one
  // request can carry boxes for several cities ("tell which box belongs to which city, but keep it simple").
  // Products first is fine: boxes set before any city is chosen go to the first city he taps; a Request
  // with boxes that still have no city is stopped with "Choose the city".
  const { user } = useAuth();
  const cities = repRegions(user?.salesRep);
  const hasCity = cities.length > 0;
  const multiCity = cities.length > 1;
  const cityOf = (r) => (cities.length === 1 ? cities[0] : r && cities.includes(r) ? r : '');
  const [city, setCity] = useState(() => (cities.length === 1
    ? cities[0]
    : cityOf(existing?.region) || cityOf(existing?.items?.find((i) => cityOf(i.region))?.region)));
  const [askCity, setAskCity] = useState(false);
  const cityRef = useRef(null);
  // cart: { [city or '']: { [productId]: boxes } } — '' holds boxes set before a city was chosen
  const [cart, setCart] = useState(() => {
    const init = {};
    for (const i of existing?.items || []) {
      const c = cityOf(i.region);
      init[c] = { ...(init[c] || {}), [i.productId]: ((init[c] || {})[i.productId] || 0) + i.quantityRequested };
    }
    return init;
  });
  const bucket = cart[city] || {};
  const chooseCity = (c) => {
    setCart((prev) => {
      const loose = prev[''];
      if (!loose || !Object.keys(loose).length || !c) return prev;
      const merged = { ...(prev[c] || {}) };
      for (const [pid, q] of Object.entries(loose)) merged[pid] = (merged[pid] || 0) + q;
      const next = { ...prev, [c]: merged };
      delete next[''];
      return next;
    });
    setCity(c);
    setAskCity(false);
  };

  // In-stock set; when editing, keep this order's existing products visible too
  // so they can still be reduced/removed even if now out of stock.
  const sellable = useMemo(() => {
    const ok = new Set(availableIds);
    if (existing) existing.items.forEach((i) => ok.add(i.productId));
    return products.filter((p) => ok.has(p.id));
  }, [products, availableIds, existing]);

  function setQty(productId, qty) {
    setCart((prev) => {
      const b = { ...(prev[city] || {}) };
      if (qty <= 0) delete b[productId]; else b[productId] = qty;
      return { ...prev, [city]: b };
    });
  }
  const inc = (id) => setQty(id, (bucket[id] || 0) + 1);
  const dec = (id) => setQty(id, (bucket[id] || 0) - 1);

  // One line per city and product, in the order the cities are listed.
  const cartEntries = useMemo(() => {
    const order = ['', ...cities];
    return Object.entries(cart)
      .sort(([a], [b]) => order.indexOf(a) - order.indexOf(b))
      .flatMap(([c, items]) => Object.entries(items).filter(([, qty]) => qty > 0).map(([productId, qty]) => {
        const product = products.find((p) => p.id === productId);
        if (!product) return null;
        const pkg = defaultPkg(product);
        const price = pkgPrice(product, pkg);
        return { city: c, productId, product, pkg, qty, price, lineTotal: price * qty };
      }))
      .filter(Boolean);
  }, [cart, products, cities]);

  const cartCount = new Set(cartEntries.map((e) => e.productId)).size;
  const boxesIn = (c) => cartEntries.filter((e) => e.city === c).reduce((n, e) => n + e.qty, 0);
  const usedCities = cities.filter((c) => boxesIn(c) > 0);
  const loose = boxesIn('');
  const totalBoxes = cartEntries.reduce((s, e) => s + e.qty, 0);
  const totalAmount = cartEntries.reduce((s, e) => s + e.lineTotal, 0);

  // Every word typed must be somewhere in the name, in any order: "ohis kubwa" finds
  // "OHIS Pepa Kubwa (Brown) – Bila Filter" (it used to need one unbroken piece of the name).
  const filtered = useMemo(() => {
    const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return sellable;
    return sellable.filter((p) => {
      const name = p.name.toLowerCase();
      return words.every((w) => name.includes(w));
    });
  }, [sellable, search]);

  const create = useMutation({
    mutationFn: () => {
      const body = {
        items: cartEntries.map(({ city: c, productId, pkg, qty }) => ({
          productId,
          packagingUnitId: pkg.packagingUnitId,
          quantity: qty,
          ...(c ? { region: c } : {}),
        })),
        // An emptied notes box on an edit clears the note (null); left out, the server kept the old one.
        notes: notes.trim() || (editing ? null : undefined),
        ...(usedCities.length === 1 ? { region: usedCities[0] } : {}),
      };
      return editing
        ? api.put(`/stock-requests/${existing.id}`, body)
        : api.post('/stock-requests', body);
    },
    onSuccess: () => {
      toast.success(editing ? 'Order updated' : 'Request sent');
      qc.invalidateQueries({ queryKey: ['stock-requests'] });
      qc.invalidateQueries({ queryKey: ['dashboard', 'me'] });
      onClose();
    },
    onError: (e) => toast.error(apiError(e)),
  });

  // The same pill bar as the Settle and Return windows (Nino, 11 Nov 2026: "say Request, not Submit for
  // approval — a nice button and a simple word like Settle"): Cancel, then one word. What the order adds up
  // to sits on a line above it.
  const footerContent = (
    <div className="flex w-full flex-col gap-3">
      {cartCount > 0 && (
        <div className="flex items-baseline justify-between gap-3 px-1">
          <span className="text-[13px] text-muted">
            {formatNumber(totalBoxes)} box{totalBoxes !== 1 ? 'es' : ''} · {cartCount} product{cartCount !== 1 ? 's' : ''}
            {usedCities.length === 1 && !loose ? ` · ${shortRegion(usedCities[0])}` : ''}
            {usedCities.length > 1 && (
              <span className="mt-0.5 block text-[12px] text-faint">
                {usedCities.map((c) => `${shortRegion(c)} ${formatNumber(boxesIn(c))}`).join(' · ')}
              </span>
            )}
          </span>
          <span className="text-base font-bold tabular-nums text-foreground">{formatCurrency(totalAmount)}</span>
        </div>
      )}
      <div className="flex w-full items-center gap-1 rounded-full bg-elevated/70 p-1 ring-1 ring-white/[0.08]">
        <button type="button" onClick={onClose}
          className="h-9 shrink-0 rounded-full px-4 text-[13px] font-medium text-muted transition hover:text-foreground active:scale-[0.97]">
          Cancel
        </button>
        <Button
          className="h-9 flex-1 justify-center rounded-full px-4 text-[13px] font-semibold"
          disabled={cartCount === 0 || create.isPending}
          onClick={() => {
            if (multiCity && loose > 0) {
              setAskCity(true);
              toast.error('Choose the city');
              cityRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
              return;
            }
            create.mutate();
          }}
        >
          {create.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          {editing ? 'Save' : 'Request'}
        </Button>
      </div>
    </div>
  );

  return (
    <Modal open onClose={onClose} title={editing ? `Edit order ${existing.requestNumber}` : 'New stock request'} size="lg" footer={footerContent}>
      {/* The city: plain words, no box round them (Nino, 11 Nov 2026: "no funny shapes around the city") —
          the chosen one white with a red line under it, like the wallet's tabs; they wrap for a rep with many
          cities. A one-city rep just sees his city, already chosen. The word above turns red and says
          "Choose the city" only after a Request was tapped without one. */}
      {hasCity && (
        <div ref={cityRef} className="mb-4 px-1">
          <p className={clsx('text-xs', askCity && loose > 0 ? 'font-medium text-brand-600' : 'text-muted')}>
            {askCity && loose > 0 ? 'Choose the city' : 'City'}
          </p>
          <div role="radiogroup" aria-label="City" className="flex flex-wrap gap-x-5">
            {cities.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={city === c}
                disabled={!multiCity}
                onClick={() => chooseCity(c)}
                className={clsx(
                  'relative py-2.5 text-[15px] transition disabled:cursor-default',
                  city === c ? 'font-semibold text-foreground' : 'font-medium text-muted hover:text-foreground',
                )}
              >
                {shortRegion(c)}
                {multiCity && boxesIn(c) > 0 && <span className="ml-1.5 text-[12px] font-medium tabular-nums text-muted">{formatNumber(boxesIn(c))}</span>}
                <span aria-hidden="true" className={clsx('absolute inset-x-0 bottom-1 h-[2px] rounded-full bg-brand-500 transition-opacity', city === c ? 'opacity-100' : 'opacity-0')} />
              </button>
            ))}
          </div>
        </div>
      )}

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
            const qty = bucket[product.id] || 0;
            const inCart = qty > 0;
            // The same product's boxes for the rep's other cities, said quietly under the price.
            const elsewhere = multiCity
              ? cities.filter((c) => c !== city && (cart[c] || {})[product.id] > 0).map((c) => `+${cart[c][product.id]} ${shortRegion(c)}`)
              : [];

            return (
              <li
                key={product.id}
                className={`px-5 py-3 transition-colors ${inCart ? 'bg-brand-500/5' : 'hover:bg-elevated'}`}
              >
                {/* The name has the line to itself and stays on it; the price and the stepper sit under it. */}
                <div className="flex items-center gap-3">
                  <div className="flex w-4 shrink-0 items-center justify-center">
                    {inCart
                      ? <CheckCircle2 className="h-4 w-4 text-brand-500" />
                      : <span className="h-1.5 w-1.5 rounded-full bg-border" />
                    }
                  </div>
                  <div title={product.name} className={`min-w-0 flex-1 truncate text-sm font-medium ${inCart ? 'text-foreground' : 'text-muted'}`}>
                    {product.name}
                  </div>
                </div>

                <div className="mt-1.5 flex items-center gap-3 pl-7">
                  <div className="min-w-0 flex-1 text-xs text-faint">
                    {formatCurrency(price)} / {pkg?.packagingUnit?.name || 'box'}
                    {elsewhere.length > 0 && <span className="block truncate text-muted">{elsewhere.join(' · ')}</span>}
                  </div>

                  {/* qty controls — type directly or tap +/- */}
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      onClick={() => dec(product.id)}
                      disabled={qty === 0}
                      className="flex h-8 w-8 items-center justify-center rounded-full border border-white/[0.12] bg-white/[0.05] text-muted transition hover:border-brand-500/40 hover:text-foreground active:scale-90 disabled:opacity-25"
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
                          ? 'border-brand-500/40 bg-brand-500/10 text-brand-600 focus:ring-1 focus:ring-brand-500/30'
                          : 'border-border bg-elevated text-muted focus:border-brand-500/40 focus:text-foreground'
                        }`}
                    />
                    <button
                      onClick={() => inc(product.id)}
                      className="flex h-8 w-8 items-center justify-center rounded-full border border-brand-500/40 bg-brand-500/15 text-brand-500 transition hover:bg-brand-500/25 active:scale-90"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
          {filtered.length === 0 && (
            <li className="py-10 text-center text-sm text-muted">{search ? 'No products match your search' : 'No products are in stock right now'}</li>
          )}
        </ul>
      )}

      {/* What is about to be sent, as a numbered list — the catalogue above is long, so this is
          the place to check the order before pressing Submit. */}
      {cartEntries.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 text-sm font-semibold text-foreground">
            Your order · {cartCount} product{cartCount !== 1 ? 's' : ''}
          </div>
          <NumberedLines
            items={cartEntries.map((e) => ({
              key: `${e.city}|${e.productId}`,
              name: e.product.name,
              detail: `${e.qty} ${e.pkg?.packagingUnit?.name || 'box'} × ${formatCurrency(e.price)}${multiCity && e.city ? ` · ${shortRegion(e.city)}` : ''}`,
              value: formatCurrency(e.lineTotal),
            }))}
          />
        </div>
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

// ── Decisions: one at a time, and a second step before the final ones ────────

// isPending only disables a button after React re-renders, so two taps in the same frame both sent a
// decision (the server refused the second, but it should never have gone). run() lets one through until
// done() — called when that decision has finished, either way.
function useOnce() {
  const busy = useRef(false);
  return {
    run: (fn) => { if (busy.current) return; busy.current = true; fn(); },
    done: () => { busy.current = false; },
  };
}

// The step before Reject and Cancel order, which cannot be undone. Reject can carry a reason: it is kept
// under the rep's own note and sent to him in the app and on WhatsApp.
function ConfirmStep({ title, message, confirmLabel, backLabel = 'Back', withReason, busy, onConfirm, onClose }) {
  const [reason, setReason] = useState('');
  return (
    <Modal
      open
      onClose={busy ? () => {} : onClose}
      size="sm"
      title={title}
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={onClose}>{backLabel}</Button>
          <Button variant="danger" loading={busy} onClick={() => onConfirm(reason.trim())}>{confirmLabel}</Button>
        </>
      }
    >
      <p className="text-sm text-muted">{message}</p>
      {withReason && (
        <div className="mt-4">
          <Field label="Reason (optional)">
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              rows={2}
              placeholder="e.g. not enough stock this week…"
              className="input resize-none"
            />
          </Field>
        </div>
      )}
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
  const [confirm, setConfirm] = useState(null); // 'reject' | 'cancel' while the second step is open
  const once = useOnce();

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
    onSuccess: () => { toast.success('Approved — stock issued'); invalidate(); onClose(); },
    onError: (e) => toast.error(apiError(e)),
    onSettled: once.done,
  });
  const reject = useMutation({
    mutationFn: (notes) => api.post(`/stock-requests/${request.id}/reject`, notes ? { notes } : {}),
    onSuccess: () => { toast.success('Order rejected'); invalidate(); onClose(); },
    onError: (e) => toast.error(apiError(e)),
    onSettled: once.done,
  });
  const cancel = useMutation({
    mutationFn: () => api.post(`/stock-requests/${request.id}/cancel`, {}),
    onSuccess: () => { toast.success('Order cancelled'); invalidate(); onClose(); },
    onError: (e) => toast.error(apiError(e)),
    onSettled: once.done,
  });
  const deciding = approve.isPending || reject.isPending || cancel.isPending;

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
    <>
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={request.requestNumber}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Close</Button>
          {editable && <Button variant="ghost" className="text-rose-500" disabled={deciding} onClick={() => setConfirm('reject')}>Reject</Button>}
          {editable && <Button loading={approve.isPending} disabled={deciding} onClick={() => once.run(() => approve.mutate())}>Approve &amp; issue</Button>}
          {isRep && pending && <Button variant="ghost" disabled={deciding} onClick={() => onEdit?.(request)}><Pencil className="h-4 w-4" /> Edit order</Button>}
          {isRep && pending && <Button variant="danger" disabled={deciding} onClick={() => setConfirm('cancel')}>Cancel order</Button>}
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div><div className="text-xs text-faint">Rep</div><div className="font-medium">{request.salesRep?.user?.name}</div></div>
          {requestCities(request).length > 0 && <div><div className="text-xs text-faint">{requestCities(request).length > 1 ? 'Cities' : 'City'}</div><div className="font-medium">{requestCities(request).join(' · ')}</div></div>}
          <div><div className="text-xs text-faint">Status</div><div className={clsx('font-medium', requestDisplayStatus(request).cls?.split(' ').find((c) => c.startsWith('text-')) || 'text-foreground')}>{requestDisplayStatus(request).label}</div></div>
          <div><div className="text-xs text-faint">Requested</div><div className="font-medium">{formatDateTime(request.requestedAt)}</div></div>
          <div><div className="text-xs text-faint">Lines</div><div className="font-medium">{displayItems.length}</div></div>
        </div>

        {/* A numbered list, one row per product. The table this replaced had five columns and
            scrolled "Unit price" and "Line total" off the edge of a phone. */}
        <NumberedLines
          items={displayItems.map((i) => {
            const lineTotal = fulfilled
              ? (i.quantityApproved ?? 0) * Number(i.unitPrice || 0)
              : editable
                ? (Number(qtys[i.id]) || 0) * Number(i.unitPrice || 0)
                : Number(i.lineTotal || 0);
            const qty = fulfilled ? i.quantityApproved : i.quantityRequested;
            return {
              key: i.id,
              name: i.product.name,
              detail: `${fulfilled ? 'Approved' : 'Requested'} ${qty} ${i.packagingUnit.name} × ${formatCurrency(i.unitPrice)}${requestCities(request).length > 1 && i.region ? ` · ${shortRegion(i.region)}` : ''}`,
              value: formatCurrency(lineTotal),
              extra: editable && (
                <div className="mt-2 flex items-center gap-2 text-xs text-faint">
                  Approve qty
                  <NumberInput min="0" value={qtys[i.id]} onChange={(e) => setQtys({ ...qtys, [i.id]: e.target.value })} className="w-20" />
                </div>
              ),
            };
          })}
        />

        <div className="flex items-center justify-between border-t border-white/[0.07] pt-4">
          <span className="text-sm font-medium text-muted">
            {fulfilled ? 'Approved order value' : editable ? 'Approved order value' : 'Order value'}
          </span>
          <span className="text-xl font-bold text-foreground">{formatCurrency(displayTotal)}</span>
        </div>

        {request.notes && <div className="whitespace-pre-line text-sm"><span className="text-faint">Notes: </span>{request.notes}</div>}
        {editable && <p className="text-xs text-faint">Approving issues the stock to the rep and opens a 72-hour payment order. Set a line to 0 to drop it.</p>}
      </div>
    </Modal>

    {confirm === 'reject' && (
      <ConfirmStep
        title={`Reject ${request.requestNumber}?`}
        message={`${request.salesRep?.user?.name || 'The rep'} is told it was not approved. Nothing is issued.`}
        confirmLabel="Reject"
        withReason
        busy={reject.isPending}
        onClose={() => setConfirm(null)}
        onConfirm={(notes) => once.run(() => reject.mutate(notes))}
      />
    )}
    {confirm === 'cancel' && (
      <ConfirmStep
        title="Cancel this order?"
        message={`${request.requestNumber} will be cancelled and nothing will be issued. You can send a new request any time.`}
        confirmLabel="Cancel order"
        backLabel="Keep it"
        busy={cancel.isPending}
        onClose={() => setConfirm(null)}
        onConfirm={() => once.run(() => cancel.mutate())}
      />
    )}
    </>
  );
}

// ── Rep card views (match the Orders & Settlements layout) ────────────────────

// Prominent card for a request still awaiting approval (the rep can edit/cancel).
function RepRequestCard({ r, onClick }) {
  const products = productCount(r);
  const boxes = boxCount(r);
  const ds = requestDisplayStatus(r);
  return (
    <button
      onClick={onClick}
      className="active-card block"
      data-tone="near"
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
        {requestCities(r).length > 0 && <span className="font-medium text-muted">{requestCities(r).join(' · ')} · </span>}
        {products} product{products !== 1 ? 's' : ''} · {formatNumber(boxes)} box{boxes !== 1 ? 'es' : ''} · {formatDateTime(r.requestedAt)}
      </div>

      <div className="mt-3 border-t border-white/8 pt-3">
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-400">
          <Clock className="h-3.5 w-3.5" /> Waiting for approval · tap to edit
        </span>
      </div>
    </button>
  );
}

// A finished request (approved/issued, rejected, or cancelled) as a plain row on the page: the number and
// what it was on the left, how it ended and when on the right (Nino, 11 Nov 2026: "too much info" — the
// icon, the badge, the product count and the arrow are gone). The status is a coloured word.
function RepRequestRow({ r, onClick }) {
  const ds = requestDisplayStatus(r);
  const tone = ds.cls?.split(' ').find((c) => c.startsWith('text-')) || 'text-muted';
  const boxes = boxCount(r);
  return (
    <button
      onClick={onClick}
      className="flex w-full items-start justify-between gap-3 px-4 py-3.5 text-left transition hover:bg-white/[0.04] active:bg-white/[0.06]"
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-foreground">{r.requestNumber}</p>
        <p className="mt-0.5 text-xs tabular-nums text-muted">{formatNumber(boxes)} box{boxes !== 1 ? 'es' : ''} · {formatCurrency(orderDisplayValue(r))}{requestCities(r).length ? ` · ${requestCities(r).join(' · ')}` : ''}</p>
      </div>
      <div className="shrink-0 text-right">
        <p className={clsx('text-[13px] font-medium', tone)}>{ds.label}</p>
        <p className="mt-0.5 text-xs text-muted">{formatDate(r.requestedAt)}</p>
      </div>
    </button>
  );
}

function RepRequestsView({ onView }) {
  const { data, isLoading } = useQuery({
    queryKey: ['stock-requests', 'rep-all'],
    queryFn: async () => unwrap(await api.get('/stock-requests', { params: { limit: 100 } })),
    refetchInterval: STEADY,
  });

  if (isLoading) return <PageSpinner />;

  const all = data?.data || [];
  const active = all.filter((r) => r.status === 'PENDING');
  const completed = all.filter((r) => r.status !== 'PENDING');

  // One short heading per list, no icons and no badge. The active list is not drawn when nothing is
  // waiting — the page then goes straight from the New request button to the history.
  const Heading = ({ children, count }) => (
    <h2 className="mb-3 px-1 text-lg font-bold text-foreground">
      {children}
      {count > 0 && <span className="ml-2 text-sm font-medium text-muted">{count}</span>}
    </h2>
  );

  if (!active.length && !completed.length) {
    return (
      <div className="mt-14 px-1 text-center">
        <ClipboardList className="mx-auto h-6 w-6 text-muted" aria-hidden="true" />
        <p className="mt-3 text-sm font-medium text-foreground">No requests yet</p>
        <p className="mt-1 text-xs text-muted">Tap New request to order stock from ZELab.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {active.length > 0 && (
        <div>
          <Heading count={active.length}>Active requests</Heading>
          <div className="space-y-3">
            {active.map((r) => <RepRequestCard key={r.id} r={r} onClick={() => onView(r)} />)}
          </div>
        </div>
      )}

      {completed.length > 0 && (
        <CollapsibleList title="History" count={completed.length} defaultOpen={active.length === 0}>
          {completed.map((r) => <RepRequestRow key={r.id} r={r} onClick={() => onView(r)} />)}
        </CollapsibleList>
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
    refetchInterval: LIVE,
  });
  const pending = data?.data || [];

  const refresh = () => {
    ['stock-requests', 'settlements', 'inventory', 'dashboard'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  };
  const once = useOnce();
  const [rejecting, setRejecting] = useState(null); // the request whose Reject step is open
  const approve = useMutation({
    mutationFn: (id) => api.post(`/stock-requests/${id}/approve`, {}),
    onSuccess: () => { toast.success('Approved — stock issued'); refresh(); },
    onError: (e) => toast.error(apiError(e)),
    onSettled: once.done,
  });
  const reject = useMutation({
    mutationFn: ({ id, notes }) => api.post(`/stock-requests/${id}/reject`, notes ? { notes } : {}),
    onSuccess: () => { toast.success('Request rejected'); setRejecting(null); refresh(); },
    onError: (e) => toast.error(apiError(e)),
    onSettled: once.done,
  });
  // One decision at a time across the strip; the spinner stays on the button that was pressed.
  const deciding = approve.isPending || reject.isPending;

  if (!pending.length) return null;

  return (
    <>
    {/* The one card that needs action wears the rep's amber "waiting" glass. A plain card's tinted border
        is cleared by the admin glass, so this strip looked like every other card. */}
    <div className="stat-glass mb-6" data-tone="near">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <ClipboardList className="h-4 w-4 text-amber-400" />
        <h2 className="text-sm font-bold text-foreground">Pending stock requests</h2>
        <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-bold text-amber-300">{pending.length}</span>
        <span className="ml-auto hidden text-xs text-faint sm:block">Approve issues the stock and opens the 72h order</span>
      </div>
      <div className="divide-y divide-border">
        {pending.map((r) => {
          const boxes = boxCount(r);
          return (
            <div key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <button onClick={() => onReview(r)} className="min-w-0 flex-1 text-left" title="Open to review or adjust quantities">
                <div className="text-sm font-semibold text-foreground">
                  {r.salesRep?.user?.name} ({r.salesRep?.code}){requestCities(r).length ? ` · ${requestCities(r).join(' · ')}` : ''} · {formatNumber(boxes)} box{boxes !== 1 ? 'es' : ''} · {formatCurrency(orderDisplayValue(r))}
                </div>
                {r.items.map((i) => (
                  <div key={i.id} className="mt-0.5 text-xs text-faint">
                    <span className="font-semibold text-muted">{i.quantityRequested}×</span> {i.product?.name}
                    {requestCities(r).length > 1 && i.region ? <span className="text-muted"> · {shortRegion(i.region)}</span> : null}
                  </div>
                ))}
                <div className="mt-0.5 text-xs text-faint">
                  {r.requestNumber} · {formatDateTime(r.requestedAt)}{r.notes ? ` · ${r.notes}` : ''}
                </div>
              </button>
              <div className="flex shrink-0 gap-2">
                <Button variant="ghost" className="text-rose-500" disabled={deciding} onClick={() => setRejecting(r)}>Reject</Button>
                <Button loading={approve.isPending && approve.variables === r.id} disabled={deciding} onClick={() => once.run(() => approve.mutate(r.id))}>
                  <CheckCircle2 className="h-4 w-4" /> Approve
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>

    {rejecting && (
      <ConfirmStep
        title={`Reject ${rejecting.requestNumber}?`}
        message={`${rejecting.salesRep?.user?.name || 'The rep'} is told it was not approved. Nothing is issued.`}
        confirmLabel="Reject"
        withReason
        busy={reject.isPending}
        onClose={() => setRejecting(null)}
        onConfirm={(notes) => once.run(() => reject.mutate({ id: rejecting.id, notes }))}
      />
    )}
    </>
  );
}

// ── Staff table (admin / warehouse review) ────────────────────────────────────

function StaffRequestTable({ onView }) {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['stock-requests', { page, status }],
    // Pending requests live in the approval strip above — the history table
    // shows decided ones unless the filter explicitly asks for pending. The
    // server leaves them out before paging (`decided`), so every page is full
    // and the pager counts the rows it shows.
    queryFn: async () => unwrap(await api.get('/stock-requests', {
      params: { page, limit: 15, status: status || undefined, decided: status ? undefined : 'true' },
    })),
  });

  const rows = data?.data || [];

  // What this page is really a record of: boxes leaving the warehouse. The
  // table said "2 line(s)", which counts products on a form and tells you
  // nothing about stock. These add up what is on screen.
  // Every figure below covers the WHOLE history (or whatever the filter
  // selects), not the page on screen. Page-scoped totals changed when you
  // turned the page, and their counts did not add up to the orders shown
  // because a rejected order is neither open nor settled.
  const sum = data?.meta?.summary;
  const span = sum?.firstAt
    ? (formatDate(sum.firstAt) === formatDate(sum.lastAt)
        ? formatDate(sum.firstAt)
        : `${formatDate(sum.firstAt)} to ${formatDate(sum.lastAt)}`)
    : null;

  // No "Approved" chip: an approval issues the stock at once, so no request ever rests as APPROVED and
  // that chip was always empty. The rows badged Approved or Settled are FULFILLED ones — "Issued" here.
  const chips = [
    { key: '', label: 'All decided', tone: 'slate' },
    ...Object.entries(REQUEST_STATUS_META)
      .filter(([k]) => k !== 'APPROVED')
      .map(([k, v]) => ({ key: k, label: k === 'FULFILLED' ? 'Issued' : v.label, tone: k === 'REJECTED' ? 'rose' : k === 'PENDING' ? 'amber' : 'emerald' })),
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
          {
            label: 'Boxes issued', value: formatNumber(sum?.boxes ?? 0), icon: Boxes,
            sub: span ? `everything ${span}` : 'nothing issued yet',
            ring: 'ring-violet-500/25', glow: 'from-violet-500/[0.14]', chip: 'bg-violet-500/15 text-violet-300', num: 'text-violet-300',
          },
          {
            label: 'Worth', value: formatCurrency(sum?.value ?? 0), icon: Wallet,
            sub: `${formatNumber(sum?.issued ?? 0)} order${(sum?.issued ?? 0) === 1 ? '' : 's'} actually issued`,
            // Sky, not red: a value, not an alert (Nino, 11 Nov 2026: "not every place needs red").
            ring: 'ring-sky-500/25', glow: 'from-sky-500/[0.12]', chip: 'bg-sky-500/15 text-sky-300', num: 'text-sky-300',
          },
          {
            label: 'Still owed by reps', value: formatNumber(sum?.stillOpen ?? 0), icon: Timer,
            sub: 'issued, not yet settled',
            ring: (sum?.stillOpen ?? 0) > 0 ? 'ring-amber-500/30' : 'ring-white/[0.07]',
            glow: (sum?.stillOpen ?? 0) > 0 ? 'from-amber-500/[0.14]' : 'from-white/[0.02]',
            chip: 'bg-amber-500/15 text-amber-300', num: (sum?.stillOpen ?? 0) > 0 ? 'text-amber-300' : 'text-foreground',
          },
          {
            label: 'Settled', value: formatNumber(sum?.settled ?? 0), icon: CheckCircle2,
            sub: 'paid for and closed',
            ring: 'ring-emerald-500/25', glow: 'from-emerald-500/[0.12]', chip: 'bg-emerald-500/15 text-emerald-300', num: 'text-emerald-300',
          },
        ].map((c) => (
          <div key={c.label} className="stat-glass p-4">
            <div className="relative flex items-start justify-between gap-2">
              <p className="text-xs font-medium text-muted">{c.label}</p>
              <span className={`rounded-full p-1.5 ring-1 ring-inset ring-white/10 ${c.chip}`}><c.icon className="h-3.5 w-3.5" /></span>
            </div>
            <p className={`relative mt-2 text-2xl font-bold tabular-nums ${c.num}`}>{c.value}</p>
            <p className="relative mt-0.5 text-[11px] text-faint">{c.sub}</p>
          </div>
        ))}
      </div>

      {/* Said in a sentence, because four numbers still need a story. */}
      {sum && sum.totalRequests > 0 && (
        <p className="text-xs leading-relaxed text-muted">
          Reps have asked for stock <b className="text-foreground">{formatNumber(sum.totalRequests)}</b> time{sum.totalRequests === 1 ? '' : 's'}
          {span && <> {span}</>}. You issued <b className="text-foreground">{formatNumber(sum.issued)}</b> of them
          {' '}— <b className="text-foreground">{formatNumber(sum.boxes)}</b> boxes worth <b className="text-foreground">{formatCurrency(sum.value)}</b>.
          {' '}<b className="text-emerald-400">{formatNumber(sum.settled)}</b> have been settled and
          {' '}<b className={sum.stillOpen > 0 ? 'text-amber-400' : 'text-foreground'}>{formatNumber(sum.stillOpen)}</b> are still owed.
          {sum.pending > 0 && <> <b className="text-foreground">{formatNumber(sum.pending)}</b> are waiting for your decision.</>}
          {sum.refused > 0 && <> {formatNumber(sum.refused)} were rejected or cancelled, so no stock left the warehouse.</>}
        </p>
      )}

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

        {isLoading ? <PageSpinner /> : isError && !data ? <LoadError what="the stock requests" onRetry={refetch} /> : !rows.length ? (
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
                    <TR key={r.id} className="group cursor-pointer" onClick={() => onView(r)}>
                      <TD className="font-medium">{r.requestNumber}</TD>
                      <TD>{r.salesRep?.user?.name}{requestCities(r).length > 0 && <div className="text-xs text-muted">{requestCities(r).join(' · ')}</div>}</TD>
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
                        {/* A quiet link on every row, not a red one: red is kept for what needs action. A request
                            still waiting is amber, like the rep's own waiting card. */}
                        <span className={clsx('inline-flex items-center gap-1 text-xs font-medium transition-colors',
                          r.status === 'PENDING' ? 'text-amber-300' : 'text-muted group-hover:text-foreground')}>
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
      {isRep ? (
        // A rep's page opens on the one thing they come here to do — the menu already says Requests.
        // The action is a premium card of its own: the label on the left, a bare "+" on the right, no round
        // shape round it (Nino, 11 Nov 2026: "more good, not too plain — and no round thing").
        <button
          type="button"
          onClick={() => setCartOpen(true)}
          className="premium-card premium-card--sm mb-7 flex h-14 w-full items-center justify-between px-5 text-left transition hover:brightness-110 active:scale-[0.99]"
        >
          <span className="text-[17px] font-bold tracking-tight text-white">New request</span>
          <Plus className="h-6 w-6 text-brand-500" strokeWidth={2.4} aria-hidden="true" />
        </button>
      ) : (
        <PageHeader title="Stock Requests" subtitle="Approve or reject reps' stock requests." />
      )}

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
