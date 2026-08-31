import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Wallet, Undo2, CheckCircle2, Clock, CalendarPlus, ShieldAlert } from 'lucide-react';
import api, { unwrap, apiError } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useProducts, useWarehouses } from '@/lib/hooks';
import { ROLES, SETTLEMENT_STATUS_META } from '@/lib/constants';
import { formatCurrency, formatNumber, formatDateTime } from '@/lib/format';
import {
  Modal, Button, Field, Input, Select, Badge, PageSpinner,
  Table, THead, TBody, TR, TH, TD,
} from '@/components/ui';

// --- Submit settlement: the rep submits boxes + cash for The Doctor's approval
// Nothing is recorded (no sale, commission, revenue or profit) until approved.
function pendingBoxesByProduct(order) {
  const m = {};
  (order.pendingSubmissionsList || []).forEach((p) => { m[p.productId] = (m[p.productId] || 0) + p.boxes; });
  return m;
}

function SettleBoxesModal({ order, onClose, onDone }) {
  const pendingMap = pendingBoxesByProduct(order);
  // Locked boxes: pending settlement submissions AND pending returns.
  const availFor = (l) => Math.max(0, l.remaining - (pendingMap[l.productId] || 0) - (l.pendingReturn || 0));
  const lines = order.order.lines.filter((l) => availFor(l) > 0);
  const [productId, setProductId] = useState(lines[0]?.productId || '');
  const [boxes, setBoxes] = useState('');
  const [accountId, setAccountId] = useState('');

  // Where was the money paid? (Cash / M-Pesa / Airtel Money — names & numbers
  // only, no balances.) Brand-reserved accounts only show for their own brand:
  // an OHIS product offers Cash + the OHIS account, never the Civlily one.
  const { data: payAccounts = [] } = useQuery({
    queryKey: ['settlements', 'payment-accounts'],
    queryFn: async () => unwrap(await api.get('/settlements/payment-accounts')).data,
  });

  const line = lines.find((l) => l.productId === productId);
  const max = line ? availFor(line) : 0;
  const value = (Number(boxes) || 0) * (line?.sellingPrice || 0);

  const accountOptions = payAccounts.filter((a) => !a.brandId || a.brandId === line?.brandId);
  const account = accountOptions.find((a) => a.id === accountId) || null;
  if (accountId && !account && accountOptions.length) setAccountId(''); // product changed brand — reset choice

  const settle = useMutation({
    mutationFn: () => api.post(`/settlements/${order.id}/settle-boxes`, { productId, boxes: Number(boxes), accountId: accountId || undefined }),
    onSuccess: () => { toast.success('Settlement submitted — awaiting The Lab approval'); onDone(); onClose(); },
    onError: (e) => toast.error(apiError(e)),
  });

  return (
    <Modal open onClose={onClose} title={`Submit settlement · ${order.settlementNumber}`}
      footer={<>
        <div className="mr-auto text-sm"><span className="text-muted">Amount</span> <b>{formatCurrency(value)}</b></div>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button loading={settle.isPending} disabled={!productId || !boxes || Number(boxes) <= 0 || Number(boxes) > max || !accountId} onClick={() => settle.mutate()}>Submit for approval</Button>
      </>}>
      <div className="space-y-4">
        <p className="text-sm text-muted">Submit the boxes you've sold and the cash collected. The Doctor verifies the money and approves — your sale and commission are recorded <b>only after approval</b>.</p>
        {lines.length === 0 ? (
          <p className="rounded-lg border border-border bg-elevated px-3 py-2 text-sm text-faint">Every outstanding box is already submitted and awaiting approval.</p>
        ) : (<>
          <Field label="Product">
            <Select value={productId} onChange={(e) => { setProductId(e.target.value); setBoxes(''); }}>
              {lines.map((l) => <option key={l.productId} value={l.productId}>{l.name} — {formatNumber(availFor(l))} left</option>)}
            </Select>
          </Field>
          <Field label="Boxes to settle" required hint={`Max ${formatNumber(max)} · ${formatCurrency(line?.sellingPrice || 0)} / box`}>
            <Input type="number" min="1" max={max} value={boxes} onChange={(e) => setBoxes(e.target.value)} autoFocus />
          </Field>
          <Field label="Where was it paid?" required hint={account?.notes || 'Select the account the money went to'}>
            <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">Select payment account…</option>
              {accountOptions.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          </Field>
        </>)}
      </div>
    </Modal>
  );
}

// --- Return unsold boxes (rep → warehouse) against this order --------------
function RecordReturnModal({ order, onClose, onDone }) {
  const { data: allProducts = [] } = useProducts();
  const { data: warehouses = [] } = useWarehouses();
  const warehouseId = warehouses[0]?.id;

  // Boxes already inside a pending return are LOCKED — only the rest can be
  // put on a new return request.
  const returnAvail = (l) => Math.max(0, l.remaining - (l.pendingReturn || 0));
  const returnableLines = order.order.lines.filter((l) => returnAvail(l) > 0);

  // cart: { [productId]: qty }
  const [cart, setCart] = useState({});
  function setQty(productId, qty) {
    const line = returnableLines.find((l) => l.productId === productId);
    const capped = Math.min(Math.max(0, qty), line ? returnAvail(line) : 0);
    setCart((prev) => {
      if (capped <= 0) { const n = { ...prev }; delete n[productId]; return n; }
      return { ...prev, [productId]: capped };
    });
  }
  const inc = (id) => setQty(id, (cart[id] || 0) + 1);
  const dec = (id) => setQty(id, (cart[id] || 0) - 1);

  const totalBoxes = Object.values(cart).reduce((s, q) => s + q, 0);
  const hasCart = totalBoxes > 0;

  const create = useMutation({
    mutationFn: () => {
      const items = Object.entries(cart).map(([productId, quantity]) => {
        const product = allProducts.find((p) => p.id === productId);
        const pkg = product?.packagings?.find((p) => p.isBaseUnit) || product?.packagings?.[0];
        return { productId, packagingUnitId: pkg?.packagingUnitId, quantity };
      });
      return api.post('/returns', {
        type: 'SALES_RETURN',
        salesRepId: order.salesRepId,
        warehouseId,
        settlementId: order.id,
        items,
        reason: `Return on order ${order.settlementNumber}`,
      });
    },
    onSuccess: () => { toast.success('Return submitted — awaiting The Lab approval'); onDone(); onClose(); },
    onError: (e) => toast.error(apiError(e)),
  });

  const footer = (
    <>
      {hasCart && (
        <div className="flex flex-1 flex-col">
          <span className="text-sm font-semibold text-foreground">{formatNumber(totalBoxes)} box{totalBoxes !== 1 ? 'es' : ''} to return</span>
        </div>
      )}
      <Button variant="secondary" onClick={onClose}>Cancel</Button>
      <Button loading={create.isPending} disabled={!warehouseId || !hasCart} onClick={() => create.mutate()}>
        <Undo2 className="h-4 w-4" /> Return to The Lab
      </Button>
    </>
  );

  return (
    <Modal open onClose={onClose} size="lg" title={`Return to The Lab · ${order.settlementNumber}`} footer={footer}>
      {returnableLines.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted">No boxes left to return on this order.</p>
      ) : (
        <div className="-mx-1 divide-y divide-border">
          {returnableLines.map((line) => {
            const qty = cart[line.productId] || 0;
            const inCart = qty > 0;
            return (
              <div key={line.productId} className={`flex items-center gap-3 px-1 py-3 transition ${inCart ? 'bg-brand-500/5' : ''}`}>
                <div className="min-w-0 flex-1">
                  <div className={`text-sm font-medium leading-snug ${inCart ? 'text-foreground' : 'text-muted'}`}>{line.name}</div>
                  <div className="mt-0.5 text-xs text-faint">
                    {formatNumber(returnAvail(line))} box{returnAvail(line) !== 1 ? 'es' : ''} available to return
                    {(line.pendingReturn || 0) > 0 && <span className="text-amber-500"> · {formatNumber(line.pendingReturn)} locked in a pending return</span>}
                  </div>
                </div>
                {/* −  input  + */}
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => dec(line.productId)}
                    disabled={qty === 0}
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-elevated text-lg font-bold text-muted transition hover:bg-surface disabled:opacity-30"
                  >−</button>
                  <input
                    type="number"
                    min="0"
                    max={returnAvail(line)}
                    value={qty === 0 ? '' : qty}
                    onChange={(e) => {
                      const v = parseInt(e.target.value, 10);
                      setQty(line.productId, isNaN(v) || v < 0 ? 0 : v);
                    }}
                    placeholder="0"
                    className="h-8 w-14 rounded-lg border border-border bg-elevated text-center text-sm font-semibold text-foreground [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  />
                  <button
                    onClick={() => inc(line.productId)}
                    disabled={qty >= returnAvail(line)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500 text-lg font-bold text-slate-950 transition hover:bg-brand-400 disabled:opacity-40"
                  >+</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}

// --- Extend deadline (staff / admin only) -----------------------------------
// The rep grants themselves +96h. Deliberately spells out the trade-off before
// they commit — more time, but a doubled late fine and a costlier failed return.
function SelfExtendModal({ order, onClose, onDone }) {
  const [confirmed, setConfirmed] = useState(false);
  const extend = useMutation({
    mutationFn: () => api.post(`/settlements/${order.id}/self-extend`),
    onSuccess: () => { toast.success('Extension activated — you have 96 more hours'); onDone(); onClose(); },
    onError: (e) => toast.error(apiError(e)),
  });
  const newDeadline = new Date(new Date(order.deadlineAt).getTime() + (order.extensionHours || 96) * 3600000);

  return (
    <Modal open onClose={onClose} title="Extend settlement time" footer={
      <>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button loading={extend.isPending} disabled={!confirmed} onClick={() => extend.mutate()}>
          <CalendarPlus className="h-4 w-4" /> Activate extension
        </Button>
      </>
    }>
      <div className="space-y-4 text-sm">
        <div className="rounded-xl border border-border bg-elevated p-3">
          <div className="flex justify-between"><span className="text-muted">Current deadline</span><span className="font-medium">{formatDateTime(order.deadlineAt)}</span></div>
          <div className="mt-1 flex justify-between"><span className="text-muted">Extra time</span><span className="font-medium text-brand-400">+{order.extensionHours || 96} hours</span></div>
          <div className="mt-1 flex justify-between border-t border-border pt-1 font-semibold">
            <span>New deadline</span><span>{formatDateTime(newDeadline)}</span>
          </div>
        </div>

        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-amber-300">
          <div className="mb-1.5 flex items-center gap-2 font-semibold text-amber-400">
            <ShieldAlert className="h-4 w-4" /> What changes if you take it
          </div>
          <ul className="list-disc space-y-1 pl-4 text-xs">
            <li>No fine at all until the new deadline.</li>
            <li>After it, the late fine becomes <b>{formatCurrency(20000)} per day</b> (normally {formatCurrency(10000)}).</li>
            <li>A return still has to be approved within <b>24 hours</b>; if it isn't, the fine is <b>{formatCurrency(30000)}</b> (normally {formatCurrency(15000)}).</li>
            <li>This can only be used <b>once</b> on this order, and can't be undone.</li>
          </ul>
        </div>

        <label className="flex cursor-pointer items-start gap-2">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5" />
          <span className="text-muted">I understand the higher penalties and want the extra time.</span>
        </label>
      </div>
    </Modal>
  );
}

function ExtendDeadlineModal({ order, onClose, onDone }) {
  const [mode, setMode] = useState('quick'); // 'quick' | 'custom'
  const [hours, setHours] = useState(24);
  const [customDate, setCustomDate] = useState('');

  const extend = useMutation({
    mutationFn: () => api.post(`/settlements/${order.id}/extend-deadline`,
      mode === 'quick'
        ? { additionalHours: hours }
        : { deadlineAt: new Date(customDate).toISOString() },
    ),
    onSuccess: () => { toast.success('Deadline extended'); onDone(); onClose(); },
    onError: (e) => toast.error(apiError(e)),
  });

  const QUICK = [
    { label: '+24 h', h: 24 },
    { label: '+48 h', h: 48 },
    { label: '+72 h', h: 72 },
  ];

  return (
    <Modal open onClose={onClose} title={`Extend deadline · ${order.settlementNumber}`}
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button
          loading={extend.isPending}
          disabled={mode === 'custom' && !customDate}
          onClick={() => extend.mutate()}
        >
          <Clock className="h-4 w-4" /> Extend deadline
        </Button>
      </>}
    >
      <div className="space-y-4">
        <p className="text-sm text-muted">
          Current deadline: <span className="font-medium text-foreground">{new Date(order.deadlineAt).toLocaleString()}</span>
          {order.status === 'OVERDUE' && <span className="ml-2 text-xs font-semibold text-rose-500">· Overdue</span>}
        </p>

        <div className="flex gap-2">
          <button onClick={() => setMode('quick')} className={`rounded-lg border px-3 py-1.5 text-sm transition ${mode === 'quick' ? 'border-brand-500 bg-brand-500/10 text-brand-400' : 'border-border text-muted hover:bg-elevated'}`}>Quick</button>
          <button onClick={() => setMode('custom')} className={`rounded-lg border px-3 py-1.5 text-sm transition ${mode === 'custom' ? 'border-brand-500 bg-brand-500/10 text-brand-400' : 'border-border text-muted hover:bg-elevated'}`}>Custom date</button>
        </div>

        {mode === 'quick' ? (
          <div className="flex gap-2">
            {QUICK.map(({ label, h }) => (
              <button
                key={h}
                onClick={() => setHours(h)}
                className={`flex-1 rounded-xl border py-3 text-sm font-semibold transition ${hours === h ? 'border-brand-500 bg-brand-500/10 text-brand-400' : 'border-border text-muted hover:bg-elevated'}`}
              >
                {label}
              </button>
            ))}
          </div>
        ) : (
          <Field label="New deadline">
            <Input type="datetime-local" value={customDate} onChange={(e) => setCustomDate(e.target.value)} />
          </Field>
        )}

        <p className="text-xs text-faint">
          {mode === 'quick'
            ? `New deadline will be ${hours}h from ${order.status === 'OVERDUE' ? 'now' : 'current deadline'}.`
            : 'Set an exact date and time for the new deadline.'
          }
          {order.status === 'OVERDUE' && ' The order will revert from Overdue to Open/Partial.'}
        </p>
      </div>
    </Modal>
  );
}

// --- Reject a pending return (staff / admin) --------------------------------
function RejectReturnModal({ ret, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const reject = useMutation({
    mutationFn: () => api.post(`/returns/${ret.id}/reject`, { reason: reason || undefined }),
    onSuccess: () => { toast.success('Return rejected'); onDone(); onClose(); },
    onError: (e) => toast.error(apiError(e)),
  });
  return (
    <Modal open onClose={onClose} title={`Reject return · ${ret.returnNumber}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={reject.isPending} onClick={() => reject.mutate()} className="bg-rose-600 text-white hover:bg-rose-500">Reject return</Button></>}>
      <div className="space-y-3">
        <p className="text-sm text-muted">Rejecting keeps these boxes outstanding on the order — the rep must still settle them or submit a new return.</p>
        <Field label="Reason (optional)">
          <textarea className="input min-h-[90px]" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. boxes never arrived at the warehouse" autoFocus />
        </Field>
      </div>
    </Modal>
  );
}

// --- Reject a pending settlement submission (staff / admin) -----------------
function RejectSubmissionModal({ submission, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const reject = useMutation({
    mutationFn: () => api.post(`/settlements/submissions/${submission.id}/reject`, { reason: reason || undefined }),
    onSuccess: () => { toast.success('Settlement rejected'); onDone(); onClose(); },
    onError: (e) => toast.error(apiError(e)),
  });
  return (
    <Modal open onClose={onClose} title={`Reject settlement · ${submission.submissionNumber}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={reject.isPending} onClick={() => reject.mutate()} className="bg-rose-600 text-white hover:bg-rose-500">Reject settlement</Button></>}>
      <div className="space-y-3">
        <p className="text-sm text-muted">Rejecting records nothing — the boxes stay outstanding and the rep must resubmit. No sale or commission is created.</p>
        <Field label="Reason (optional)">
          <textarea className="input min-h-[90px]" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. amount doesn't match cash received" autoFocus />
        </Field>
      </div>
    </Modal>
  );
}

function MoneyCard({ label, value, tone }) {
  const tones = { brand: 'text-brand-600', emerald: 'text-emerald-500', rose: 'text-rose-500', default: 'text-foreground' };
  return (
    <div className="rounded-xl border border-border bg-elevated p-3">
      <div className="text-[11px] uppercase tracking-wide text-faint">{label}</div>
      <div className={`mt-0.5 text-lg font-bold ${tones[tone] || tones.default}`}>{value}</div>
    </div>
  );
}

export default function OrderDetailModal({ settlementId, onClose }) {
  const qc = useQueryClient();
  const { hasRole, user } = useAuth();
  const staff = hasRole(ROLES.WAREHOUSE_STAFF);
  const [sub, setSub] = useState(null); // 'settle' | 'return' | 'flag' | 'extend'
  const [rejectingReturn, setRejectingReturn] = useState(null); // pending return being rejected
  const [rejectingSubmission, setRejectingSubmission] = useState(null); // pending settlement being rejected

  const { data: order, isLoading } = useQuery({
    queryKey: ['settlement', settlementId],
    queryFn: async () => unwrap(await api.get(`/settlements/${settlementId}`)).data,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['settlement', settlementId] });
    qc.invalidateQueries({ queryKey: ['settlements'] });
    qc.invalidateQueries({ queryKey: ['inventory'] });
    qc.invalidateQueries({ queryKey: ['commissions'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] }); // refresh rep/admin dashboards live
  };

  const settle = useMutation({
    mutationFn: () => api.post(`/settlements/${settlementId}/settle`, {}),
    onSuccess: () => { toast.success('Order closed'); refresh(); onClose(); },
    onError: (e) => toast.error(apiError(e)),
  });

  const approveReturn = useMutation({
    mutationFn: (id) => api.post(`/returns/${id}/approve`),
    onSuccess: () => { toast.success('Return approved — inventory updated'); refresh(); },
    onError: (e) => toast.error(apiError(e)),
  });

  const approveSubmission = useMutation({
    mutationFn: (id) => api.post(`/settlements/submissions/${id}/approve`),
    onSuccess: () => { toast.success('Settlement approved — sale & commission recorded'); refresh(); },
    onError: (e) => toast.error(apiError(e)),
  });

  const isOwnRep = user?.role === ROLES.SALES_REP && order?.salesRepId === user?.salesRepId;
  const canAct = staff || isOwnRep;
  const active = order && order.status !== 'SETTLED';
  const remaining = order?.order?.totals?.remainingBoxes ?? 0;
  const overdue = order?.status === 'OVERDUE';

  return (
    <>
      <Modal open onClose={onClose} size="xl" title={order ? `Order ${order.settlementNumber}` : 'Order'}
        footer={order && (
          <>
            <Button variant="secondary" onClick={onClose}>Close</Button>
            {staff && active && <Button variant="ghost" onClick={() => setSub('extend')}><Clock className="h-4 w-4" /> Extend deadline</Button>}
            {canAct && active && order.canSelfExtend && (
              <Button variant="secondary" onClick={() => setSub('self-extend')}>
                <CalendarPlus className="h-4 w-4" /> Extend settlement time
              </Button>
            )}
            {canAct && active && remaining > 0 && <Button variant="secondary" onClick={() => setSub('return')}><Undo2 className="h-4 w-4" /> Return</Button>}
            {canAct && active && remaining > 0 && <Button onClick={() => setSub('settle')}><Wallet className="h-4 w-4" /> Submit settlement</Button>}
            {staff && active && (remaining <= 0
              ? <Button variant="ghost" className="text-emerald-500" loading={settle.isPending} onClick={() => settle.mutate()}><CheckCircle2 className="h-4 w-4" /> Close order</Button>
              : <span className="self-center text-xs text-faint">{formatNumber(remaining)} box(es) left to account for</span>)}
          </>
        )}>
        {isLoading || !order ? <PageSpinner /> : (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div><div className="text-xs text-faint">Rep</div><div className="font-medium">{order.salesRep?.user?.name}</div></div>
              <div><div className="text-xs text-faint">Status</div><Badge className={SETTLEMENT_STATUS_META[order.status]?.cls}>{SETTLEMENT_STATUS_META[order.status]?.label}</Badge></div>
              {order.status === 'SETTLED' ? (
                <div><div className="text-xs text-faint">Settled</div><div className="font-medium text-emerald-500">{order.settledAt ? formatDateTime(order.settledAt) : '—'}</div></div>
              ) : (
                <div><div className="text-xs text-faint">Deadline</div><div className="font-medium">{formatDateTime(order.deadlineAt)}</div></div>
              )}
              <div><div className="text-xs text-faint">Issued</div><div className="font-medium">{formatDateTime(order.issuedAt)}</div></div>
            </div>

            {/* Extension status + the penalty rule currently in force */}
            {active && (
              <div className={`rounded-xl border px-3 py-2.5 text-sm ${
                order.extensionStatus === 'ACTIVE' ? 'border-brand-500/30 bg-brand-500/10'
                : order.extensionStatus === 'EXPIRED' ? 'border-rose-500/30 bg-rose-500/10'
                : 'border-border bg-elevated'}`}>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span className="text-xs uppercase tracking-wide text-faint">Extension</span>
                  <Badge className={
                    order.extensionStatus === 'ACTIVE' ? 'bg-brand-500/20 text-brand-400'
                    : order.extensionStatus === 'EXPIRED' ? 'bg-rose-500/15 text-rose-300'
                    : 'bg-elevated text-muted'}>
                    {order.extensionStatus === 'ACTIVE' ? 'Extension active'
                      : order.extensionStatus === 'EXPIRED' ? 'Extension expired'
                      : 'Not used'}
                  </Badge>
                  {order.hoursRemaining != null && (
                    <span className={order.hoursRemaining < 0 ? 'text-rose-400' : 'text-muted'}>
                      {order.hoursRemaining < 0
                        ? `${Math.abs(Math.round(order.hoursRemaining))}h overdue`
                        : `${Math.round(order.hoursRemaining)}h remaining`}
                    </span>
                  )}
                  <span className="ml-auto text-xs text-faint">
                    Late penalty: <b className={order.extensionUsed ? 'text-rose-400' : 'text-muted'}>{formatCurrency(order.penaltyPerDay)}/day</b>
                  </span>
                </div>
                {order.extensionUsed && order.preExtensionDeadline && (
                  <div className="mt-1 text-xs text-faint">
                    Original deadline was {formatDateTime(order.preExtensionDeadline)} · extended by {order.extensionHours}h
                    {order.selfExtendedAt ? ` on ${formatDateTime(order.selfExtendedAt)}` : ''}
                  </div>
                )}
              </div>
            )}

            {/* Pending-return warning */}
            {order.pendingReturns > 0 && (
              <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-400">
                <Clock className="h-4 w-4 shrink-0" />
                <span>{order.pendingReturns} return{order.pendingReturns !== 1 ? 's' : ''} awaiting The Lab approval — boxes remain outstanding until approved.</span>
              </div>
            )}

            {/* Pending returns — staff/admin approve or reject inline */}
            {staff && order.pendingReturnsList?.length > 0 && (
              <div className="space-y-2">
                {order.pendingReturnsList.map((r) => (
                  <div key={r.id} className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-foreground">{r.returnNumber}</div>
                        <div className="mt-0.5 text-xs text-faint">
                          {r.items.map((i) => `${formatNumber(i.quantity)} ${i.unitName || 'box'}(s) ${i.productName}`).join(' · ')}
                        </div>
                        {r.reason && <div className="mt-0.5 text-xs text-faint">Reason: {r.reason}</div>}
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <Button variant="ghost" className="text-rose-500" disabled={approveReturn.isPending} onClick={() => setRejectingReturn(r)}>Reject</Button>
                        <Button loading={approveReturn.isPending && approveReturn.variables === r.id} onClick={() => approveReturn.mutate(r.id)}>
                          <CheckCircle2 className="h-4 w-4" /> Approve return
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Pending settlement submissions — awaiting The Doctor's approval */}
            {order.pendingSubmissions > 0 && (
              <div className="flex items-center gap-2 rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2.5 text-sm text-sky-300">
                <Clock className="h-4 w-4 shrink-0" />
                <span>{order.pendingSubmissions} settlement{order.pendingSubmissions !== 1 ? 's' : ''} awaiting approval — no sale or commission is recorded until The Doctor approves.</span>
              </div>
            )}
            {staff && order.pendingSubmissionsList?.length > 0 && (
              <div className="space-y-2">
                {order.pendingSubmissionsList.map((p) => (
                  <div key={p.id} className="rounded-lg border border-sky-500/30 bg-sky-500/5 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-foreground">{p.submissionNumber} · {formatCurrency(p.amount)}</div>
                        <div className="mt-0.5 text-xs text-faint">{formatNumber(p.boxes)} box(es) {p.productName}{p.method ? ` · ${p.method}` : ''}</div>
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <Button variant="ghost" className="text-rose-500" disabled={approveSubmission.isPending} onClick={() => setRejectingSubmission(p)}>Reject</Button>
                        <Button loading={approveSubmission.isPending && approveSubmission.variables === p.id} onClick={() => approveSubmission.mutate(p.id)}>
                          <CheckCircle2 className="h-4 w-4" /> Approve settlement
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Money picture — all derived from settled/returned boxes */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <MoneyCard label="Order value" value={formatCurrency(order.order.totals.orderValue)} tone="brand" />
              <MoneyCard label="Settled" value={formatCurrency(order.order.totals.settledValue)} tone="emerald" />
              <MoneyCard label="Returned value" value={formatCurrency(order.order.totals.returnedValue)} />
              <MoneyCard label="Outstanding" value={formatCurrency(order.order.totals.outstanding)} tone="rose" />
            </div>

            {/* Box-by-box breakdown: issued vs settled vs returned vs remaining */}
            <div>
              <div className="mb-2 text-sm font-semibold text-foreground">Stock breakdown (boxes)</div>
              <Table>
                <THead><TR><TH>Product</TH><TH>Issued</TH><TH>Settled</TH><TH>Returned</TH><TH>{overdue ? 'Missing' : 'Remaining'}</TH></TR></THead>
                <TBody>
                  {order.order.lines.map((l) => (
                    <TR key={l.productId}>
                      <TD className="font-medium text-foreground">{l.name}</TD>
                      <TD>{formatNumber(l.assigned)}</TD>
                      <TD className="text-emerald-500">{formatNumber(l.settled)}</TD>
                      <TD className="text-sky-400">{formatNumber(l.returned)}{(l.pendingReturn || 0) > 0 && <span className="ml-1 text-xs text-amber-500">+{formatNumber(l.pendingReturn)} pending</span>}</TD>
                      <TD className={l.remaining > 0 && overdue ? 'font-semibold text-rose-500' : 'text-muted'}>{formatNumber(l.remaining)}</TD>
                    </TR>
                  ))}
                  <TR className="font-semibold">
                    <TD>Total</TD>
                    <TD>{formatNumber(order.order.totals.assignedBoxes)}</TD>
                    <TD className="text-emerald-500">{formatNumber(order.order.totals.settledBoxes)}</TD>
                    <TD className="text-sky-400">{formatNumber(order.order.totals.returnedBoxes)}</TD>
                    <TD className={order.order.totals.remainingBoxes > 0 && overdue ? 'text-rose-500' : 'text-muted'}>{formatNumber(order.order.totals.remainingBoxes)}</TD>
                  </TR>
                </TBody>
              </Table>
              <p className="mt-1 text-xs text-faint">Remaining = Issued − Settled − Returned. The order closes only when every box is <span className="text-emerald-500">settled</span> or <span className="text-sky-400">returned</span>. After the 72h deadline, unaccounted boxes show as <span className="text-rose-500">missing</span> · value {formatCurrency(order.order.totals.remainingValue)}.</p>
              <p className="mt-1 text-xs text-faint">Commission earned on {formatNumber(order.order.totals.settledBoxes)} settled box(es): <span className="font-medium text-brand-600">{formatCurrency(order.order.totals.commission)}</span> · rate depends on brand · paid via Commissions.</p>
            </div>

            {/* Settlement history — each settle is a recorded sale transaction */}
            <div>
              <div className="mb-2 text-sm font-semibold text-foreground">Settlements</div>
              {!order.sales?.length ? <p className="text-sm text-faint">Nothing settled yet.</p> : (
                <ul className="space-y-1 text-sm">
                  {order.sales.map((s) => (
                    <li key={s.id} className="flex justify-between text-muted">
                      <span>{formatDateTime(s.soldAt)} · {s.items?.map((i) => `${formatNumber(i.quantity)} box(es) ${i.product?.name}`).join(', ')} · {s.saleNumber}</span>
                      <span className="font-medium text-emerald-500">{formatCurrency(s.total)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </Modal>

      {order && sub === 'settle' && <SettleBoxesModal order={order} onClose={() => setSub(null)} onDone={refresh} />}
      {order && sub === 'return' && <RecordReturnModal order={order} onClose={() => setSub(null)} onDone={refresh} />}
      {order && sub === 'extend' && <ExtendDeadlineModal order={order} onClose={() => setSub(null)} onDone={refresh} />}
      {order && sub === 'self-extend' && <SelfExtendModal order={order} onClose={() => setSub(null)} onDone={refresh} />}
      {rejectingReturn && <RejectReturnModal ret={rejectingReturn} onClose={() => setRejectingReturn(null)} onDone={refresh} />}
      {rejectingSubmission && <RejectSubmissionModal submission={rejectingSubmission} onClose={() => setRejectingSubmission(null)} onDone={refresh} />}
    </>
  );
}
