import { useState, useMemo, useEffect, useRef, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import { lazyPart, warmPart, PageLoadBoundary } from '@/components/LazyPage';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import { Plus, ShoppingCart, Eye, Wallet, TrendingUp, Boxes, Timer } from 'lucide-react';
import api, { unwrap, apiError } from '@/lib/api';
import { pageQueries, keepOnPageTurn } from '@/lib/pageQueries';
import { refreshAfter } from '@/lib/afterWrite';
import { pickParam, pageParam, withParams } from '@/lib/urlParams';
import { useAuth } from '@/context/AuthContext';
import { useProducts, useCustomers, useWarehouses, useSalesReps } from '@/lib/hooks';
import { formatCurrency, formatDate, formatDateTime, formatNumber, formatPercent, unitWord } from '@/lib/format';
import { ROLES, SALE_STATUS_META } from '@/lib/constants';
import ItemLines from '@/components/ItemLines';
import QuickSale from '@/components/QuickSale';
import SaleRefund from '@/components/SaleRefund';
import { refundable } from '@/lib/saleRefund';
import {
  PageHeader, Card, PageSpinner, EmptyState, Badge, Button, Modal, Field, Select, Input, NumberInput,
  Pagination, LoadError, Table, THead, TBody, TR, TH, TD,
} from '@/components/ui';

function NewSaleModal({ open, onClose }) {
  const qc = useQueryClient();
  const { user, hasRole } = useAuth();
  const isRep = user?.role === ROLES.SALES_REP;

  const { data: products = [] } = useProducts();
  const { data: customers = [] } = useCustomers();
  const { data: warehouses = [] } = useWarehouses();
  const { data: reps = [] } = useSalesReps();

  const type = 'CASH'; // cash-only business — no credit sales
  const [customerId, setCustomerId] = useState('');
  const [source, setSource] = useState(''); // "w:<id>" or "r:<id>"
  const [items, setItems] = useState([]);
  const [discount, setDiscount] = useState(0);
  const [amountPaid, setAmountPaid] = useState('');
  const [accountId, setAccountId] = useState('');

  // A single-brand sale banks into that brand's account — OHIS to M-Pesa,
  // Civlily to Airtel Money — and a mixed one may go to either. The server
  // decides which, from the same rule that answers the reps: the brand goes
  // up with the request instead of the whole list coming down to be filtered.
  const productBrand = useMemo(() => {
    const map = new Map(products.map((p) => [p.id, p.brandId]));
    const set = new Set(items.filter((l) => l.productId).map((l) => map.get(l.productId)).filter(Boolean));
    return set.size === 1 ? [...set][0] : null;
  }, [items, products]);
  const { data: accountOptions = [] } = useQuery({
    queryKey: ['payment-accounts', productBrand || ''],
    queryFn: async () => unwrap(await api.get('/settlements/payment-accounts', {
      params: productBrand ? { brandId: productBrand } : undefined,
    })).data,
    enabled: !isRep,
  });

  const subtotal = useMemo(
    () => items.reduce((s, l) => s + (Number(l.unitPrice) || 0) * (Number(l.quantity) || 0), 0),
    [items],
  );
  const total = Math.max(0, subtotal - (Number(discount) || 0));
  // Only a typed-in amount can be short; empty means the full total.
  const shortfall = amountPaid === '' ? 0 : Math.max(0, total - (Number(amountPaid) || 0));
  // More than the total is change for the customer, not takings — the server refuses it too.
  const overpaid = amountPaid === '' ? 0 : Math.max(0, (Number(amountPaid) || 0) - total);

  const create = useMutation({
    mutationFn: () => {
      const payload = {
        type,
        customerId: customerId || null,
        items: items
          .filter((l) => l.productId && l.packagingUnitId && l.quantity > 0)
          .map((l) => ({ productId: l.productId, packagingUnitId: l.packagingUnitId, quantity: Number(l.quantity), unitPrice: Number(l.unitPrice) || undefined })),
        discount: Number(discount) || 0,
      };
      // Cash-only business — every sale is paid in full at the counter.
      payload.amountPaid = amountPaid === '' ? total : Number(amountPaid);
      if (!isRep) {
        if (source.startsWith('w:')) payload.warehouseId = source.slice(2);
        else if (source.startsWith('r:')) payload.salesRepId = source.slice(2);
        if (source.startsWith('w:') && accountId) payload.accountId = accountId;
      }
      return api.post('/sales', payload);
    },
    onSuccess: () => {
      toast.success('Sale recorded');
      // Stock out and money in: Inventory and Finance are asked again too (audit freshness-2/4).
      refreshAfter(qc, 'sale');
      onClose();
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const canSubmit =
    items.some((l) => l.productId && l.quantity > 0) &&
    (type !== 'CREDIT' || customerId) &&
    (isRep || source) &&
    overpaid === 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Record a sale"
      footer={
        <>
          <div className="mr-auto text-sm">
            <span className="text-muted">Total</span> <span className="text-lg font-bold text-foreground">{formatCurrency(total)}</span>
          </div>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={create.isPending} disabled={!canSubmit} onClick={() => create.mutate()}>Complete sale</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Customer" hint="Optional for walk-ins">
            <Select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">Walk-in customer</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}{c.region ? ` · ${c.region}` : ''}</option>)}
            </Select>
          </Field>
          {/* Warehouses only. Selling from a rep's stock here bypassed their
              order — boxes left the van, revenue landed, and the order still
              showed them as owed. Rep boxes move through Settlements, where
              the contract and commission move with them; the server refuses
              the old path too. */}
          {!isRep && (
            <Field label="Sell from" required hint="Rep stock is settled through Orders & Settlements, not sold here">
              <Select value={source} onChange={(e) => setSource(e.target.value)}>
                <option value="">Select warehouse…</option>
                {warehouses.map((w) => <option key={w.id} value={`w:${w.id}`}>{w.name}</option>)}
              </Select>
            </Field>
          )}
        </div>

        <ItemLines products={products} value={items} onChange={setItems} showPrice priceReadOnly />

        {shortfall > 0 && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-400">
            <span className="font-medium">This sale will be saved as PARTIAL.</span>{' '}
            Paid {formatCurrency(Number(amountPaid))} of {formatCurrency(total)}, leaving{' '}
            {formatCurrency(shortfall)} owed — and only {formatCurrency(Number(amountPaid))} goes into the account.
            Leave “Amount paid” empty if the customer paid in full.
          </div>
        )}

        {overpaid > 0 && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-400">
            <span className="font-medium">Amount paid is more than the total.</span>{' '}
            Enter {formatCurrency(total)} — the {formatCurrency(overpaid)} change goes back to the customer, not into the account.
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Discount"><NumberInput min="0" value={discount} onChange={(e) => setDiscount(e.target.value)} /></Field>
          <Field label="Amount paid" hint="Leave empty for the full amount">
            <NumberInput min="0" max={total} value={amountPaid} onChange={(e) => setAmountPaid(e.target.value)} placeholder={String(total)} />
          </Field>
          {!isRep && source.startsWith('w:') && (
            <Field label="Where was it paid?" hint="Which account received the money">
              <Select value={accountOptions.some((a) => a.id === accountId) ? accountId : ''} onChange={(e) => setAccountId(e.target.value)}>
                {/* No account chosen means the brand's own account (the first listed) — there is no cash
                    till; the business does not hold money in cash. */}
                <option value="">{accountOptions[0] ? `${accountOptions[0].name} (default)` : 'Brand account (default)'}</option>
                {accountOptions.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </Select>
            </Field>
          )}
        </div>

        <div className="rounded-lg bg-elevated p-3 text-sm">
          <div className="flex justify-between"><span className="text-muted">Subtotal</span><span>{formatCurrency(subtotal)}</span></div>
          <div className="flex justify-between"><span className="text-muted">Discount</span><span>-{formatCurrency(Number(discount) || 0)}</span></div>
          <div className="mt-1 flex justify-between border-t border-border pt-1 font-semibold"><span>Total</span><span>{formatCurrency(total)}</span></div>
        </div>
      </div>
    </Modal>
  );
}

function SaleDetail({ id, onClose }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.role === ROLES.ADMIN;
  const [confirming, setConfirming] = useState(false);
  const [refunding, setRefunding] = useState(false);
  const [reason, setReason] = useState('');
  // On a phone the body may be scrolled down (to the refunds): bring the cancel question into view.
  const confirmBox = useRef(null);
  useEffect(() => {
    if (confirming) confirmBox.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [confirming]);
  const { data, isLoading } = useQuery({
    queryKey: ['sale', id],
    queryFn: async () => unwrap(await api.get(`/sales/${id}`)).data,
    enabled: !!id,
  });

  // A sale cannot be edited, so a mistyped one is cancelled and recorded again.
  // Cancelling puts the boxes back and removes the money it banked, leaving
  // nothing behind to reconcile.
  const cancel = useMutation({
    mutationFn: () => api.post(`/sales/${id}/cancel`, { reason: reason.trim() || undefined }),
    onSuccess: () => {
      toast.success(`${data?.saleNumber} cancelled — stock returned and the money reversed`);
      ['sales', 'sale', 'inventory', 'finance', 'dashboard'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      onClose();
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const cancelled = data?.status === 'CANCELLED';
  // A counter sale has two ways back (owner, 12 Nov 2026): the customer returned boxes (the money goes
  // back to him), or the sale was recorded by mistake. A rep's sale keeps the one Cancel it had.
  const counterSale = refundable(data);
  const refunds = data?.refunds || [];
  // The refund window takes this one's place while it is open, and this one comes back with the new figures.
  if (refunding && data) {
    return <SaleRefund saleId={id} onClose={() => setRefunding(false)} onDone={() => setRefunding(false)} />;
  }
  return (
    // xl: at lg the six-column item table pushed "Profit / box" and "Line profit" out of sight.
    <Modal
      open={!!id}
      onClose={onClose}
      size="xl"
      title={data ? `Sale ${data.saleNumber}` : 'Sale'}
      footer={data && isAdmin && !cancelled ? (
        confirming ? (
          // Phone: the red answer first, full width, Keep sale under it (as the refund window's footer).
          <>
            <Button variant="secondary" className="max-sm:order-2 max-sm:h-12 max-sm:w-full" onClick={() => setConfirming(false)}>Keep sale</Button>
            <Button variant="danger" className="max-sm:h-12 max-sm:w-full" loading={cancel.isPending} onClick={() => cancel.mutate()}>
              Yes, cancel {data.saleNumber}
            </Button>
          </>
        ) : counterSale ? (
          <>
            <Button variant="ghost" className="max-sm:order-2 max-sm:h-12 max-sm:w-full" onClick={() => setConfirming(true)}>Cancel — recorded by mistake</Button>
            <Button className="max-sm:h-12 max-sm:w-full" onClick={() => setRefunding(true)}>Refund customer</Button>
          </>
        ) : (
          <Button variant="danger" onClick={() => setConfirming(true)}>Cancel this sale</Button>
        )
      ) : null}
    >
      {isLoading || !data ? <PageSpinner /> : (
        <div className="space-y-4 text-sm">
          {cancelled && (
            <div className="rounded-lg border border-border bg-elevated px-3 py-2 text-sm text-muted">
              This sale is cancelled. The stock went back and the money it banked was reversed.
            </div>
          )}
          {confirming && !cancelled && (
            <div ref={confirmBox} className="scroll-mt-2 space-y-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-3">
              <p className="text-sm font-medium text-rose-400">Cancel {data.saleNumber}?</p>
              <p className="text-xs text-muted">
                {data.items.reduce((n2_, it) => n2_ + it.quantity, 0)} box(es) go back into stock and the{' '}
                {formatCurrency(data.amountPaid)} it banked is removed from the account. Sales cannot be edited,
                so record the sale again afterwards with the correct amount.
                {counterSale && (
                  <>
                    {' '}If the customer brought boxes back, use{' '}
                    <button type="button" className="font-medium text-foreground underline underline-offset-2 hover:text-white"
                      onClick={() => { setConfirming(false); setRefunding(true); }}>
                      Refund customer
                    </button>{' '}instead.
                  </>
                )}
              </p>
              <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (kept in the record)" />
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div><span className="text-muted">Customer</span><div className="font-medium">{data.customer?.name || 'Walk-in'}</div></div>
            <div><span className="text-muted">Sales rep</span><div className="font-medium">{data.salesRep?.user?.name || '—'}</div></div>
            <div><span className="text-muted">Type</span><div className="font-medium">{data.type}</div></div>
            <div><span className="text-muted">Date</span><div className="font-medium">{formatDateTime(data.soldAt)}</div></div>
          </div>
          {/* Per-item profit trace: sell/box vs cost/box (captured at sale time) */}
          <Table stack>
            <THead><TR><TH>Item</TH><TH>Qty</TH><TH>Sell / box</TH><TH>Cost / box</TH><TH>Profit / box</TH><TH>Line profit</TH></TR></THead>
            <TBody>
              {data.items.map((it) => {
                const lineProfit = it.lineTotal - it.unitCost * it.baseQuantity;
                return (
                  <TR key={it.id}>
                    <TD className="font-medium text-foreground">{it.product.name}</TD>
                    <TD>{it.quantity > 0 ? `${formatNumber(it.quantity)} ${unitWord(it.quantity, it.packagingUnit.name)}` : <span className="text-faint">All returned</span>}</TD>
                    <TD>{formatCurrency(it.unitPrice)}</TD>
                    <TD className="text-muted">{formatCurrency(it.unitCost)}</TD>
                    <TD>{formatCurrency(it.unitPrice - it.unitCost)}</TD>
                    <TD className="font-semibold text-emerald-500">{formatCurrency(lineProfit)}</TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
          <div className="space-y-1.5 border-t border-white/[0.06] pt-3 text-sm">
            <div className="flex justify-between"><span className="text-muted">Revenue</span><span className="font-semibold tabular-nums text-foreground">{formatCurrency(data.total)}</span></div>
            <div className="flex justify-between"><span className="text-muted">Cost of goods</span><span className="tabular-nums text-muted">−{formatCurrency(data.costTotal)}</span></div>
            <div className="flex justify-between border-t border-white/[0.06] pt-1.5"><span className="font-semibold text-foreground">Profit on this sale</span><span className="font-bold tabular-nums text-emerald-400">{formatCurrency(data.total - data.costTotal)}</span></div>
            <div className="mt-1 flex justify-between"><span className="text-muted">Paid</span><span className="tabular-nums text-foreground">{formatCurrency(data.amountPaid)}</span></div>
            <div className="flex justify-between"><span className="text-muted">Balance</span><span className={`tabular-nums ${data.balanceDue > 0 ? 'font-semibold text-amber-300' : 'text-faint'}`}>{formatCurrency(data.balanceDue)}</span></div>
          </div>
          {refunds.length > 0 && (
            <div>
              <div className="mb-1 font-medium text-foreground">Returned by the customer</div>
              <ul className="space-y-1.5">
                {refunds.map((r, i) => (
                  <li key={i} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-muted">
                    <span className="min-w-0">
                      {formatDateTime(r.at)} · {formatNumber(r.boxes)} {r.boxes === 1 ? 'box' : 'boxes'}
                      {r.lines?.length > 0 && <span className="text-faint"> ({r.lines.map((l) => `${l.boxes ?? l.quantity} ${l.product}`).join(', ')})</span>}
                      {r.reason && <span className="text-faint"> — {r.reason}</span>}
                    </span>
                    <span className="tabular-nums">
                      <span className="font-medium text-foreground">{formatCurrency(r.cashBack)}</span> refunded
                      {r.owedCleared > 0 && <span className="text-amber-300"> · {formatCurrency(r.owedCleared)} off the debt</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {data.creditSale && (
            <div>
              <div className="mb-1 font-medium text-foreground">Payment history</div>
              {data.creditSale.payments.length === 0 ? <p className="text-faint">No payments yet.</p> : (
                <ul className="space-y-1">
                  {data.creditSale.payments.map((p) => (
                    <li key={p.id} className="flex justify-between text-muted">
                      <span>{formatDateTime(p.paidAt)} · {p.method}</span><span className="font-medium">{formatCurrency(p.amount)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

// ── Filters ───────────────────────────────────────────────────────────────────

const CHIP_TONE = {
  slate: 'bg-white/10 text-foreground ring-white/20',
  emerald: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',
  amber: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
  rose: 'bg-rose-500/15 text-rose-300 ring-rose-500/30',
  sky: 'bg-sky-500/15 text-sky-300 ring-sky-500/30',
};
const STATUS_TONE = { PAID: 'emerald', PARTIAL: 'amber', UNPAID: 'rose', CANCELLED: 'slate' };
// Only the statuses a sale can actually hold — the meta also carries EXPIRED,
// which belongs to stock requests and would be refused by the sales filter.
const STATUS_ORDER = ['PAID', 'PARTIAL', 'UNPAID', 'CANCELLED'];

function Chip({ active, tone, label, count, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`cursor-pointer rounded-full px-3.5 py-2 text-sm font-medium ring-1 transition duration-200 ${
        active ? CHIP_TONE[tone] : 'bg-transparent text-muted ring-white/10 hover:bg-white/[0.05] hover:text-foreground'}`}
    >
      {label}
      {count != null && <span className="ml-1.5 tabular-nums opacity-70">{formatNumber(count)}</span>}
    </button>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

// The invoice maker lives inside Sales for staff (Nino, 11 Nov 2026: "this should be in the Sales page,
// inside, not on the sidebar"). Reps keep their own Invoice page (they have no Sales page). The tab is in
// the address (?tab=invoice), so the old /invoice-generator link lands on it.
// Through the app's page loader (lib/pages.js), so a failed fetch-ahead never reloads the app (audit pwa-brand-load-3).
const InvoiceGenerator = lazyPart('InvoiceGenerator');
const SALES_TABS = [['list', 'Sales'], ['invoice', 'Invoice']];

export default function Sales() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'invoice' ? 'invoice' : 'list';
  // Fetch the invoice maker's code while the list is open, so the tab opens at once. Only ahead of the
  // click: one that fails on a weak line is dropped, and the tab asks again when opened.
  useEffect(() => { warmPart('InvoiceGenerator'); }, []);
  return (
    <div>
      <div className="mb-5 flex flex-wrap gap-2">
        {SALES_TABS.map(([k, label]) => (
          <button key={k} type="button" onClick={() => setParams(k === 'list' ? {} : { tab: k }, { replace: true })}
            aria-current={tab === k ? 'page' : undefined}
            className={`cursor-pointer rounded-full px-4 py-2 text-sm font-semibold ring-1 transition duration-200 ${tab === k ? 'bg-brand-500 text-white ring-brand-500' : 'bg-transparent text-muted ring-white/10 hover:bg-white/[0.05] hover:text-foreground'}`}>{label}</button>
        ))}
      </div>
      {tab === 'invoice' ? (
        <PageLoadBoundary what="this tab" resetKey={tab}>
          <Suspense fallback={<PageSpinner />}><InvoiceGenerator /></Suspense>
        </PageLoadBoundary>
      ) : <SalesList />}
    </div>
  );
}

function SalesList() {
  const { user } = useAuth();
  // Staff record a sale in the quick window (walk-in, Dar es Salaam, every product with  −  qty  +);
  // the older window below stays for the rep path, unchanged.
  const isRep = user?.role === ROLES.SALES_REP;
  // Type, status and page are in the address, written with replace: Back from another page comes back to
  // the same chips and page (navigation-6).
  const [params, setParams] = useSearchParams();
  const page = pageParam(params);
  const type = pickParam(params, 'type', ['CASH', 'CREDIT']);
  const status = pickParam(params, 'status', Object.keys(SALE_STATUS_META));
  const setPage = (n) => setParams((p) => withParams(p, { page: n }), { replace: true });
  const pickChip = (change) => setParams((p) => withParams(p, { ...change, page: null }), { replace: true });
  const [modalOpen, setModalOpen] = useState(false);
  const [detailId, setDetailId] = useState(null);

  const { data, isLoading, isError, refetch } = useQuery({
    ...pageQueries.sales({ page, type, status }),
    placeholderData: keepOnPageTurn({ type, status }),
  });

  // Every figure below covers all the sales the filter matches, not the fifteen
  // rows on screen — the server adds them up over the whole set. Cancelled
  // sales are listed but earn nothing, so the money leaves them out.
  const sum = data?.meta?.summary;
  const period = sum?.firstAt
    ? (formatDate(sum.firstAt) === formatDate(sum.lastAt)
        ? `on ${formatDate(sum.firstAt)}`
        : `between ${formatDate(sum.firstAt)} and ${formatDate(sum.lastAt)}`)
    : null;
  const saleWord = (n) => `sale${n === 1 ? '' : 's'}`;
  // An empty result under a filter is not an empty business — say which.
  const filtered = !!(type || status);
  // A failed load is not "nothing sold": its figures show a dash, never TSh 0.
  const failed = isError && !data;
  const nothing = failed ? "couldn't load the sales" : filtered ? 'nothing matches this filter' : 'nothing sold yet';
  const shown = (text) => (failed ? '—' : text);

  // Chip counts are taken over the OTHER filter, so they hold still as you
  // click through them instead of collapsing onto whatever is selected.
  // No count at all until the figures are here: a chip reading 0 over a load that failed (or has not
  // come back yet) says "none" when nobody knows (audit pwa-brand-load-2).
  const counted = sum?.byStatus != null;
  const statusChips = [
    { value: '', label: 'All statuses', tone: 'slate', count: counted ? Object.values(sum.byStatus).reduce((a, b) => a + b, 0) : null },
    ...STATUS_ORDER.map((k) => ({ value: k, label: SALE_STATUS_META[k].label, tone: STATUS_TONE[k], count: counted ? sum.byStatus[k] ?? 0 : null })),
  ];
  // The business sells for cash. A type row only appears once a second type
  // actually exists — offering a choice of one is how the old page looked.
  const typesPresent = ['CASH', 'CREDIT'].filter((k) => (sum?.byType?.[k] ?? 0) > 0 || type === k);
  const typeChips = typesPresent.length > 1
    ? [
      { value: '', label: 'All types', tone: 'slate' },
      ...typesPresent.map((k) => ({ value: k, label: k === 'CASH' ? 'Cash' : 'Credit', tone: k === 'CASH' ? 'emerald' : 'sky', count: sum?.byType?.[k] ?? 0 })),
    ]
    : [];

  return (
    <div>
      <PageHeader title="Sales" subtitle="Cash sales across the business.">
        <Button onClick={() => setModalOpen(true)}><Plus className="h-4 w-4" /> New sale</Button>
      </PageHeader>

      <div className="space-y-4">
        {/* What the business actually sold — a list of sales without a total is a
            receipt spike: readable line by line, silent about the whole. */}
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          {[
            {
              label: 'Revenue taken', value: shown(formatCurrency(sum?.revenue ?? 0)), icon: Wallet,
              sub: period ? `${formatNumber(sum.sales)} ${saleWord(sum.sales)} ${period}` : nothing,
              // Sky, not red: takings are good news, not an alert (Nino, 11 Nov 2026: "not every place needs red").
              ring: (sum?.revenue ?? 0) > 0 ? 'ring-sky-500/25' : 'ring-white/[0.08]',
              glow: (sum?.revenue ?? 0) > 0 ? 'from-sky-500/[0.12]' : 'from-white/[0.03]',
              chip: (sum?.revenue ?? 0) > 0 ? 'bg-sky-500/15 text-sky-300' : 'bg-white/10 text-muted',
              num: (sum?.revenue ?? 0) > 0 ? 'text-sky-300' : 'text-foreground',
            },
            {
              label: 'Profit kept', value: shown(formatCurrency(sum?.profit ?? 0)), icon: TrendingUp,
              sub: (sum?.sales ?? 0) > 0
                ? `${formatPercent(sum.margin)} margin on the same ${formatNumber(sum.sales)} ${saleWord(sum.sales)}`
                : nothing,
              ring: (sum?.profit ?? 0) > 0 ? 'ring-emerald-500/25' : (sum?.profit ?? 0) < 0 ? 'ring-rose-500/30' : 'ring-white/[0.08]',
              glow: (sum?.profit ?? 0) > 0 ? 'from-emerald-500/[0.12]' : (sum?.profit ?? 0) < 0 ? 'from-rose-500/[0.14]' : 'from-white/[0.03]',
              chip: (sum?.profit ?? 0) > 0 ? 'bg-emerald-500/15 text-emerald-300' : (sum?.profit ?? 0) < 0 ? 'bg-rose-500/15 text-rose-300' : 'bg-white/10 text-muted',
              num: (sum?.profit ?? 0) > 0 ? 'text-emerald-300' : (sum?.profit ?? 0) < 0 ? 'text-rose-300' : 'text-foreground',
            },
            {
              label: 'Boxes sold', value: shown(formatNumber(sum?.boxes ?? 0)), icon: Boxes,
              sub: period ? `left the shelves ${period}` : nothing,
              ring: (sum?.boxes ?? 0) > 0 ? 'ring-violet-500/25' : 'ring-white/[0.08]',
              glow: (sum?.boxes ?? 0) > 0 ? 'from-violet-500/[0.14]' : 'from-white/[0.03]',
              chip: (sum?.boxes ?? 0) > 0 ? 'bg-violet-500/15 text-violet-300' : 'bg-white/10 text-muted',
              num: (sum?.boxes ?? 0) > 0 ? 'text-violet-300' : 'text-foreground',
            },
            {
              label: 'Money still owed', value: shown(formatCurrency(sum?.owed ?? 0)), icon: Timer,
              sub: (sum?.owed ?? 0) > 0
                ? `unpaid on ${formatNumber(sum.unpaid)} of those ${saleWord(sum.unpaid)}`
                : period ? `every sale ${period} was paid in full` : nothing,
              ring: (sum?.owed ?? 0) > 0 ? 'ring-amber-500/30' : 'ring-white/[0.08]',
              glow: (sum?.owed ?? 0) > 0 ? 'from-amber-500/[0.14]' : 'from-white/[0.03]',
              chip: (sum?.owed ?? 0) > 0 ? 'bg-amber-500/15 text-amber-300' : 'bg-white/10 text-muted',
              num: (sum?.owed ?? 0) > 0 ? 'text-amber-300' : 'text-foreground',
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

        {/* The four numbers as one sum, written out — not a card (Nino, 11 Nov 2026: "make it nice and well
            explained, more clear"): what came in, minus what the stock cost, is what the business kept. */}
        {sum && (sum.sales > 0 || sum.cancelled > 0) && (
          <div className="border-l-2 border-white/[0.12] pl-4">
            {sum.sales > 0 ? (
              <>
                <p className="text-[12.5px] text-muted">
                  <b className="font-semibold text-foreground">{formatNumber(sum.sales)}</b> {saleWord(sum.sales)}
                  {' · '}<b className="font-semibold text-foreground">{formatNumber(sum.boxes)}</b> box{sum.boxes === 1 ? '' : 'es'}
                  {period ? ` · ${period}` : ''}
                </p>
                {/* Phone: the sum as three lined-up lines, so a sign never lands alone at the start of a line. */}
                <dl className="mt-2 space-y-1 text-[13px] sm:hidden">
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="text-muted">Brought in</dt>
                    <dd className="whitespace-nowrap font-bold tabular-nums text-sky-300">{formatCurrency(sum.revenue)}</dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="text-muted"><span className="mr-1 text-white/40">−</span>The stock cost</dt>
                    <dd className="whitespace-nowrap font-bold tabular-nums text-foreground">{formatCurrency(sum.cost)}</dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-3 border-t border-white/[0.08] pt-1">
                    <dt className="text-muted"><span className="mr-1 text-white/40">=</span>The business kept <span className="text-[11px]">· {formatPercent(sum.margin)}</span></dt>
                    <dd className={`whitespace-nowrap text-[15px] font-bold tabular-nums ${sum.profit > 0 ? 'text-emerald-300' : sum.profit < 0 ? 'text-rose-300' : 'text-foreground'}`}>{formatCurrency(sum.profit)}</dd>
                  </div>
                </dl>
                <div className="mt-2 hidden flex-wrap items-end gap-x-6 gap-y-2 sm:flex">
                  <div>
                    <p className="text-[11px] text-muted">Brought in</p>
                    <p className="whitespace-nowrap text-lg font-bold leading-tight tabular-nums text-sky-300">{formatCurrency(sum.revenue)}</p>
                  </div>
                  <span className="pb-0.5 text-lg font-light text-white/30" aria-label="minus">−</span>
                  <div>
                    <p className="text-[11px] text-muted">The stock cost</p>
                    <p className="whitespace-nowrap text-lg font-bold leading-tight tabular-nums text-foreground">{formatCurrency(sum.cost)}</p>
                  </div>
                  <span className="pb-0.5 text-lg font-light text-white/30" aria-label="equals">=</span>
                  <div>
                    <p className="text-[11px] text-muted">The business kept</p>
                    <p className={`whitespace-nowrap text-lg font-bold leading-tight tabular-nums ${sum.profit > 0 ? 'text-emerald-300' : sum.profit < 0 ? 'text-rose-300' : 'text-foreground'}`}>
                      {formatCurrency(sum.profit)}
                      <span className="ml-2 text-xs font-medium text-muted">{formatPercent(sum.margin)} of what it took</span>
                    </p>
                  </div>
                </div>
              </>
            ) : (
              <p className="text-[12.5px] text-muted">Nothing was earned {period || 'yet'}.</p>
            )}
            {(sum.owed > 0 || sum.cancelled > 0) && (
              <div className="mt-2 space-y-0.5 text-[12px] text-muted">
                {sum.owed > 0 && (
                  <p>
                    <span className="mr-1.5 inline-block h-1.5 w-1.5 -translate-y-px rounded-full bg-amber-400 align-middle" />
                    <b className="font-semibold text-amber-300">{formatCurrency(sum.owed)}</b> of it is still to be collected, on{' '}
                    <b className="font-semibold text-foreground">{formatNumber(sum.unpaid)}</b> {saleWord(sum.unpaid)}.
                  </p>
                )}
                {sum.cancelled > 0 && (
                  <p>
                    <span className="mr-1.5 inline-block h-1.5 w-1.5 -translate-y-px rounded-full bg-white/30 align-middle" />
                    <b className="font-semibold text-foreground">{formatNumber(sum.cancelled)}</b> cancelled {saleWord(sum.cancelled)}{' '}
                    {sum.cancelled === 1 ? 'is' : 'are'} greyed out in the list — the boxes went back, and none of this money is theirs.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        <Card>
          <div className="flex flex-wrap items-center gap-2 border-b border-border p-4">
            {typeChips.map((c) => (
              <Chip key={c.value || 'all-types'} {...c} active={type === c.value} onClick={() => pickChip({ type: c.value })} />
            ))}
            {typeChips.length > 0 && <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />}
            {statusChips.map((c) => (
              <Chip key={c.value || 'all-statuses'} {...c} active={status === c.value} onClick={() => pickChip({ status: c.value })} />
            ))}
          </div>

          {isLoading ? <PageSpinner /> : failed ? <LoadError what="the sales" onRetry={refetch} /> : !data?.data?.length ? (
            <EmptyState
              title={filtered ? 'No sales match these filters' : 'No sales yet'}
              message={filtered ? 'Widen the filters above to see the rest.' : 'Record your first sale.'}
              icon={ShoppingCart}
              action={filtered ? null : <Button onClick={() => setModalOpen(true)}><Plus className="h-4 w-4" /> New sale</Button>}
            />
          ) : (
            <>
              <Table stack="wide">
                <THead>
                  <TR>
                    <TH>Sale</TH><TH>Customer</TH><TH>Rep</TH><TH>Type</TH>
                    <TH className="text-right">Total</TH><TH className="text-right">Profit</TH><TH className="text-right">Balance</TH>
                    <TH>Status</TH><TH>Date</TH><TH />
                  </TR>
                </THead>
                <TBody>
                  {data.data.map((s) => {
                    const meta = SALE_STATUS_META[s.status] || {};
                    const profit = s.total - (s.costTotal || 0);
                    // A cancelled sale is struck through and dimmed: it is still
                    // part of the record, but none of the totals above count it.
                    const dead = s.status === 'CANCELLED';
                    const money = (extra) => clsx('text-right tabular-nums', dead ? 'text-faint line-through' : extra);
                    return (
                      <TR key={s.id} className={dead ? 'opacity-60' : undefined}>
                        <TD className={clsx('font-medium', dead ? 'text-muted line-through' : 'text-foreground')}>{s.saleNumber}</TD>
                        <TD>{s.customer?.name || 'Walk-in'}</TD>
                        <TD>{s.salesRep?.user?.name || '—'}</TD>
                        <TD>{s.type}</TD>
                        <TD className={money('text-foreground')}>{formatCurrency(s.total)}</TD>
                        <TD className={money('font-semibold text-emerald-400')}>{formatCurrency(profit)}</TD>
                        <TD className={money(s.balanceDue > 0 ? 'text-amber-300' : 'text-faint')}>{formatCurrency(s.balanceDue)}</TD>
                        <TD><Badge className={meta.cls}>{meta.label}</Badge></TD>
                        <TD className="text-faint">{formatDate(s.soldAt)}</TD>
                        <TD><button className="btn-ghost px-2 py-1" onClick={() => setDetailId(s.id)}><Eye className="h-4 w-4" /></button></TD>
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

      {modalOpen && (isRep
        ? <NewSaleModal open={modalOpen} onClose={() => setModalOpen(false)} />
        : <QuickSale onClose={() => setModalOpen(false)} />)}
      {detailId && <SaleDetail id={detailId} onClose={() => setDetailId(null)} />}
    </div>
  );
}
