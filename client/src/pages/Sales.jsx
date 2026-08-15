import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Plus, ShoppingCart, Eye } from 'lucide-react';
import api, { unwrap, apiError } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useProducts, useCustomers, useWarehouses, useSalesReps } from '@/lib/hooks';
import { formatCurrency, formatDate, formatDateTime } from '@/lib/format';
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
          {!isRep && (
            <Field label="Sell from" required hint="Warehouse or a rep's van stock">
              <Select value={source} onChange={(e) => setSource(e.target.value)}>
                <option value="">Select source…</option>
                <optgroup label="Warehouses">
                  {warehouses.map((w) => <option key={w.id} value={`w:${w.id}`}>{w.name}</option>)}
                </optgroup>
                <optgroup label="Sales reps">
                  {reps.map((r) => <option key={r.id} value={`r:${r.id}`}>{r.user?.name} ({r.code})</option>)}
                </optgroup>
              </Select>
            </Field>
          )}
        </div>

        <ItemLines products={products} value={items} onChange={setItems} showPrice />

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
          <div className="rounded-lg bg-elevated p-3">
            <div className="flex justify-between"><span className="text-muted">Revenue</span><span className="font-semibold">{formatCurrency(data.total)}</span></div>
            <div className="flex justify-between"><span className="text-muted">Cost of goods</span><span className="text-muted">−{formatCurrency(data.costTotal)}</span></div>
            <div className="flex justify-between border-t border-border pt-1"><span className="font-semibold text-foreground">Profit on this sale</span><span className="font-bold text-emerald-500">{formatCurrency(data.total - data.costTotal)}</span></div>
            <div className="mt-1 flex justify-between"><span className="text-muted">Paid</span><span>{formatCurrency(data.amountPaid)}</span></div>
            <div className="flex justify-between"><span className="text-muted">Balance</span><span className={data.balanceDue > 0 ? 'text-rose-600' : ''}>{formatCurrency(data.balanceDue)}</span></div>
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

  return (
    <div>
      <PageHeader title="Sales" subtitle="Cash sales across the business.">
        <Button onClick={() => setModalOpen(true)}><Plus className="h-4 w-4" /> New sale</Button>
      </PageHeader>

      <Card>
        <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row">
          <Select value={type} onChange={(e) => { setType(e.target.value); setPage(1); }} className="sm:w-44">
            <option value="">All types</option><option value="CASH">Cash</option>
          </Select>
          <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="sm:w-44">
            <option value="">All statuses</option>
            {Object.entries(SALE_STATUS_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </Select>
        </div>

        {isLoading ? <PageSpinner /> : !data?.data?.length ? (
          <EmptyState title="No sales yet" message="Record your first sale." icon={ShoppingCart} action={<Button onClick={() => setModalOpen(true)}><Plus className="h-4 w-4" /> New sale</Button>} />
        ) : (
          <>
            <Table>
              <THead><TR><TH>Sale</TH><TH>Customer</TH><TH>Rep</TH><TH>Type</TH><TH>Total</TH><TH>Profit</TH><TH>Balance</TH><TH>Status</TH><TH>Date</TH><TH /></TR></THead>
              <TBody>
                {data.data.map((s) => {
                  const meta = SALE_STATUS_META[s.status] || {};
                  const profit = s.total - (s.costTotal || 0);
                  return (
                    <TR key={s.id}>
                      <TD className="font-medium text-foreground">{s.saleNumber}</TD>
                      <TD>{s.customer?.name || 'Walk-in'}</TD>
                      <TD>{s.salesRep?.user?.name || '—'}</TD>
                      <TD>{s.type}</TD>
                      <TD>{formatCurrency(s.total)}</TD>
                      <TD className={s.status === 'CANCELLED' ? 'text-faint line-through' : 'font-semibold text-emerald-500'}>{formatCurrency(profit)}</TD>
                      <TD className={s.balanceDue > 0 ? 'text-rose-600' : 'text-faint'}>{formatCurrency(s.balanceDue)}</TD>
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

      {modalOpen && <NewSaleModal open={modalOpen} onClose={() => setModalOpen(false)} />}
      {detailId && <SaleDetail id={detailId} onClose={() => setDetailId(null)} />}
    </div>
  );
}
