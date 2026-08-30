import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import { Plus, ShoppingCart, Eye, Wallet, TrendingUp, Boxes, Timer } from 'lucide-react';
import api, { unwrap, apiError } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useProducts, useCustomers, useWarehouses, useSalesReps } from '@/lib/hooks';
import { formatCurrency, formatDate, formatDateTime, formatNumber, formatPercent } from '@/lib/format';
import { ROLES, SALE_STATUS_META } from '@/lib/constants';
import ItemLines from '@/components/ItemLines';
import {
  PageHeader, Card, PageSpinner, EmptyState, Badge, Button, Modal, Field, Select, Input,
  Pagination, Table, THead, TBody, TR, TH, TD,
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

  // Payment accounts — a brand-reserved account (Civlily Airtel / OHIS M-Pesa)
  // is only offered when every item in the sale belongs to that brand.
  const { data: payAccounts = [] } = useQuery({
    queryKey: ['payment-accounts'],
    queryFn: async () => unwrap(await api.get('/settlements/payment-accounts')).data,
    enabled: !isRep,
  });
  const productBrand = useMemo(() => {
    const map = new Map(products.map((p) => [p.id, p.brandId]));
    const set = new Set(items.filter((l) => l.productId).map((l) => map.get(l.productId)).filter(Boolean));
    return set.size === 1 ? [...set][0] : null;
  }, [items, products]);
  const accountOptions = payAccounts.filter((a) => !a.brandId || a.brandId === productBrand);

  const subtotal = useMemo(
    () => items.reduce((s, l) => s + (Number(l.unitPrice) || 0) * (Number(l.quantity) || 0), 0),
    [items],
  );
  const total = Math.max(0, subtotal - (Number(discount) || 0));
  // Only a typed-in amount can be short; empty means the full total.
  const shortfall = amountPaid === '' ? 0 : Math.max(0, total - (Number(amountPaid) || 0));

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
      qc.invalidateQueries({ queryKey: ['sales'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      onClose();
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const canSubmit =
    items.some((l) => l.productId && l.quantity > 0) &&
    (type !== 'CREDIT' || customerId) &&
    (isRep || source);

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

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Discount"><Input type="number" min="0" value={discount} onChange={(e) => setDiscount(e.target.value)} /></Field>
          <Field label="Amount paid" hint="Leave empty for the full amount">
            <Input type="number" min="0" value={amountPaid} onChange={(e) => setAmountPaid(e.target.value)} placeholder={String(total)} />
          </Field>
          {!isRep && source.startsWith('w:') && (
            <Field label="Where was it paid?" hint="Which account received the money">
              <Select value={accountOptions.some((a) => a.id === accountId) ? accountId : ''} onChange={(e) => setAccountId(e.target.value)}>
                <option value="">Cash (default)</option>
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
  const [reason, setReason] = useState('');
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
  return (
    <Modal
      open={!!id}
      onClose={onClose}
      size="lg"
      title={data ? `Sale ${data.saleNumber}` : 'Sale'}
      footer={data && isAdmin && !cancelled ? (
        confirming ? (
          <>
            <Button variant="secondary" onClick={() => setConfirming(false)}>Keep sale</Button>
            <Button variant="danger" loading={cancel.isPending} onClick={() => cancel.mutate()}>
              Yes, cancel {data.saleNumber}
            </Button>
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
            <div className="space-y-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-3">
              <p className="text-sm font-medium text-rose-400">Cancel {data.saleNumber}?</p>
              <p className="text-xs text-muted">
                {data.items.reduce((n2_, it) => n2_ + it.quantity, 0)} box(es) go back into stock and the{' '}
                {formatCurrency(data.amountPaid)} it banked is removed from the account. Sales cannot be edited,
                so record the sale again afterwards with the correct amount.
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
          <Table>
            <THead><TR><TH>Item</TH><TH>Qty</TH><TH>Sell / box</TH><TH>Cost / box</TH><TH>Profit / box</TH><TH>Line profit</TH></TR></THead>
            <TBody>
              {data.items.map((it) => {
                const lineProfit = it.lineTotal - it.unitCost * it.baseQuantity;
                return (
                  <TR key={it.id}>
                    <TD className="font-medium text-foreground">{it.product.name}</TD>
                    <TD>{it.quantity} {it.packagingUnit.name}</TD>
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

export default function Sales() {
  const [page, setPage] = useState(1);
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [detailId, setDetailId] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ['sales', { page, type, status }],
    queryFn: async () => unwrap(await api.get('/sales', { params: { page, limit: 15, type: type || undefined, status: status || undefined } })),
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
  const nothing = filtered ? 'nothing matches this filter' : 'nothing sold yet';

  // Chip counts are taken over the OTHER filter, so they hold still as you
  // click through them instead of collapsing onto whatever is selected.
  const statusChips = [
    { value: '', label: 'All statuses', tone: 'slate', count: Object.values(sum?.byStatus || {}).reduce((a, b) => a + b, 0) },
    ...STATUS_ORDER.map((k) => ({ value: k, label: SALE_STATUS_META[k].label, tone: STATUS_TONE[k], count: sum?.byStatus?.[k] ?? 0 })),
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
              label: 'Revenue taken', value: formatCurrency(sum?.revenue ?? 0), icon: Wallet,
              sub: period ? `${formatNumber(sum.sales)} ${saleWord(sum.sales)} ${period}` : nothing,
              ring: (sum?.revenue ?? 0) > 0 ? 'ring-brand-500/25' : 'ring-white/[0.08]',
              glow: (sum?.revenue ?? 0) > 0 ? 'from-brand-500/[0.12]' : 'from-white/[0.03]',
              chip: (sum?.revenue ?? 0) > 0 ? 'bg-brand-500/15 text-brand-300' : 'bg-white/10 text-muted',
              num: (sum?.revenue ?? 0) > 0 ? 'text-brand-300' : 'text-foreground',
            },
            {
              label: 'Profit kept', value: formatCurrency(sum?.profit ?? 0), icon: TrendingUp,
              sub: (sum?.sales ?? 0) > 0
                ? `${formatPercent(sum.margin)} margin on the same ${formatNumber(sum.sales)} ${saleWord(sum.sales)}`
                : nothing,
              ring: (sum?.profit ?? 0) > 0 ? 'ring-emerald-500/25' : (sum?.profit ?? 0) < 0 ? 'ring-rose-500/30' : 'ring-white/[0.08]',
              glow: (sum?.profit ?? 0) > 0 ? 'from-emerald-500/[0.12]' : (sum?.profit ?? 0) < 0 ? 'from-rose-500/[0.14]' : 'from-white/[0.03]',
              chip: (sum?.profit ?? 0) > 0 ? 'bg-emerald-500/15 text-emerald-300' : (sum?.profit ?? 0) < 0 ? 'bg-rose-500/15 text-rose-300' : 'bg-white/10 text-muted',
              num: (sum?.profit ?? 0) > 0 ? 'text-emerald-300' : (sum?.profit ?? 0) < 0 ? 'text-rose-300' : 'text-foreground',
            },
            {
              label: 'Boxes sold', value: formatNumber(sum?.boxes ?? 0), icon: Boxes,
              sub: period ? `left the shelves ${period}` : nothing,
              ring: (sum?.boxes ?? 0) > 0 ? 'ring-violet-500/25' : 'ring-white/[0.08]',
              glow: (sum?.boxes ?? 0) > 0 ? 'from-violet-500/[0.14]' : 'from-white/[0.03]',
              chip: (sum?.boxes ?? 0) > 0 ? 'bg-violet-500/15 text-violet-300' : 'bg-white/10 text-muted',
              num: (sum?.boxes ?? 0) > 0 ? 'text-violet-300' : 'text-foreground',
            },
            {
              label: 'Money still owed', value: formatCurrency(sum?.owed ?? 0), icon: Timer,
              sub: (sum?.owed ?? 0) > 0
                ? `unpaid on ${formatNumber(sum.unpaid)} of those ${saleWord(sum.unpaid)}`
                : period ? `every sale ${period} was paid in full` : nothing,
              ring: (sum?.owed ?? 0) > 0 ? 'ring-amber-500/30' : 'ring-white/[0.08]',
              glow: (sum?.owed ?? 0) > 0 ? 'from-amber-500/[0.14]' : 'from-white/[0.03]',
              chip: (sum?.owed ?? 0) > 0 ? 'bg-amber-500/15 text-amber-300' : 'bg-white/10 text-muted',
              num: (sum?.owed ?? 0) > 0 ? 'text-amber-300' : 'text-foreground',
            },
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

        {/* Said in a sentence, because four numbers still need a story. */}
        {sum && (sum.sales > 0 || sum.cancelled > 0) && (
          <p className="text-xs leading-relaxed text-muted">
            {sum.sales > 0 ? (
              <>
                <b className="text-foreground">{formatNumber(sum.sales)}</b> {saleWord(sum.sales)} {period} brought in{' '}
                <b className="text-foreground">{formatCurrency(sum.revenue)}</b> for{' '}
                <b className="text-foreground">{formatNumber(sum.boxes)}</b> box{sum.boxes === 1 ? '' : 'es'}. The stock in them cost{' '}
                <b className="text-foreground">{formatCurrency(sum.cost)}</b>, so the business kept{' '}
                <b className={sum.profit > 0 ? 'text-emerald-400' : sum.profit < 0 ? 'text-rose-400' : 'text-foreground'}>{formatCurrency(sum.profit)}</b>
                {' '}— {formatPercent(sum.margin)} of what it took.
              </>
            ) : (
              <>Nothing was earned {period || 'yet'}.</>
            )}
            {sum.owed > 0 && (
              <> <b className="text-amber-400">{formatCurrency(sum.owed)}</b> of that is still to be collected, on{' '}
                <b className="text-foreground">{formatNumber(sum.unpaid)}</b> {saleWord(sum.unpaid)}.</>
            )}
            {sum.cancelled > 0 && (
              <> <b className="text-foreground">{formatNumber(sum.cancelled)}</b> cancelled {saleWord(sum.cancelled)}{' '}
                {sum.cancelled === 1 ? 'is' : 'are'} listed below, greyed out — the boxes went back and none of the money above is theirs.</>
            )}
          </p>
        )}

        <Card>
          <div className="flex flex-wrap items-center gap-2 border-b border-border p-4">
            {typeChips.map((c) => (
              <Chip key={c.value || 'all-types'} {...c} active={type === c.value} onClick={() => { setType(c.value); setPage(1); }} />
            ))}
            {typeChips.length > 0 && <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />}
            {statusChips.map((c) => (
              <Chip key={c.value || 'all-statuses'} {...c} active={status === c.value} onClick={() => { setStatus(c.value); setPage(1); }} />
            ))}
          </div>

          {isLoading ? <PageSpinner /> : !data?.data?.length ? (
            <EmptyState
              title={filtered ? 'No sales match these filters' : 'No sales yet'}
              message={filtered ? 'Widen the filters above to see the rest.' : 'Record your first sale.'}
              icon={ShoppingCart}
              action={filtered ? null : <Button onClick={() => setModalOpen(true)}><Plus className="h-4 w-4" /> New sale</Button>}
            />
          ) : (
            <>
              <Table>
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

      {modalOpen && <NewSaleModal open={modalOpen} onClose={() => setModalOpen(false)} />}
      {detailId && <SaleDetail id={detailId} onClose={() => setDetailId(null)} />}
    </div>
  );
}
