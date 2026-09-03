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

// A small uppercase rule the eye can scan on a phone, instead of a stack of
// identical form labels.
function StepHead({ n, children, right }) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-500/15 text-[10px] font-bold text-brand-300">{n}</span>
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">{children}</span>
      {right && <span className="ml-auto text-[11px] text-faint">{right}</span>}
    </div>
  );
}

// Counting boxes on a phone should not open a keyboard. Two big targets and a
// shortcut to the whole lot covers almost every settlement, and the value is
// clamped here so the rep cannot ask for more than they hold.
function BoxStepper({ value, max, onChange }) {
  const n = Number(value) || 0;
  const set = (next) => onChange(String(Math.max(0, Math.min(max, next))));
  const btn = 'flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-elevated text-xl font-bold text-foreground ring-1 ring-white/[0.08] transition active:scale-95 disabled:opacity-30';
  return (
    <div className="flex items-center gap-3">
      <button type="button" className={btn} onClick={() => set(n - 1)} disabled={n <= 0} aria-label="One fewer box">−</button>
      <input
        type="number" inputMode="numeric" min="0" max={max} value={value}
        onChange={(e) => set(Number(e.target.value))}
        className="h-12 min-w-0 flex-1 rounded-xl bg-elevated text-center text-2xl font-bold tabular-nums text-foreground ring-1 ring-white/[0.08] focus:outline-none focus:ring-2 focus:ring-brand-500/50"
      />
      <button type="button" className={btn} onClick={() => set(n + 1)} disabled={n >= max} aria-label="One more box">+</button>
      {max > 1 && (
        <button
          type="button"
          onClick={() => set(max)}
          className="shrink-0 rounded-xl bg-brand-500/15 px-3 py-3 text-xs font-semibold text-brand-300 ring-1 ring-brand-500/25 transition active:scale-95"
        >
          All {formatNumber(max)}
        </button>
      )}
    </div>
  );
}

// What a rep sees the moment it lands. A toast that vanishes in three seconds
// is a poor answer to "did that work?" when the person has just handed over
// real money — so the modal turns into the confirmation, says the amount back,
// and tells them plainly what happens next and when the commission is theirs.
function SettleDone({ amount, boxes, productName, onClose }) {
  return (
    <div className="flex flex-col items-center px-2 py-6 text-center">
      <div className="relative mb-5">
        <span className="animate-halo absolute inset-0 rounded-full bg-emerald-400/30" aria-hidden="true" />
        <span className="animate-pop relative flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500/15 ring-1 ring-emerald-400/40">
          <svg viewBox="0 0 24 24" className="h-10 w-10" fill="none" aria-hidden="true">
            <path d="M5 12.5l4.5 4.5L19 7.5" stroke="#34d399" strokeWidth="2.6"
              strokeLinecap="round" strokeLinejoin="round" className="animate-tick" />
          </svg>
        </span>
      </div>

      <h3 className="animate-rise text-2xl font-bold tracking-tight text-foreground" style={{ animationDelay: '0.28s' }}>
        Deposited
      </h3>
      <span
        className="animate-rise mt-2 inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2.5 py-1 text-[11px] font-semibold text-amber-300 ring-1 ring-amber-500/25"
        style={{ animationDelay: '0.33s' }}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
        Waiting on approval
      </span>

      <p className="animate-rise mt-4 text-3xl font-bold tabular-nums text-emerald-400" style={{ animationDelay: '0.36s' }}>
        {formatCurrency(amount)}
      </p>
      <p className="animate-rise mt-1 text-xs text-faint" style={{ animationDelay: '0.42s' }}>
        {formatNumber(boxes)} {Number(boxes) === 1 ? 'box' : 'boxes'}{productName ? ` · ${productName}` : ''}
      </p>

      <p className="animate-rise mt-5 text-[13px] text-muted" style={{ animationDelay: '0.5s' }}>
        Approved, and <b className="text-foreground">the commission is yours</b>.
      </p>

      <Button className="animate-rise mt-6 w-full" style={{ animationDelay: '0.58s' }} onClick={onClose}>
        Done
      </Button>
    </div>
  );
}

function SettleBoxesModal({ order, onClose, onDone }) {
  const pendingMap = pendingBoxesByProduct(order);
  // Locked boxes: pending settlement submissions AND pending returns.
  const availFor = (l) => Math.max(0, l.remaining - (pendingMap[l.productId] || 0) - (l.pendingReturn || 0));
  const lines = order.order.lines.filter((l) => availFor(l) > 0);
  const [productId, setProductId] = useState(lines[0]?.productId || '');
  const [boxes, setBoxes] = useState('1');

  const line = lines.find((l) => l.productId === productId);
  const max = line ? availFor(line) : 0;
  const value = (Number(boxes) || 0) * (line?.sellingPrice || 0);

  // Where the money goes — decided by the brand, not by the rep. OHIS settles
  // to M-Pesa and Civlily to Airtel Money, so the server answers with the ONE
  // account for this product's brand. There is no filtering to do here and no
  // second copy of the rule: whatever comes back is what may be used.
  const { data: accountOptions = [] } = useQuery({
    queryKey: ['settlements', 'payment-accounts', line?.brandId || ''],
    queryFn: async () => unwrap(await api.get('/settlements/payment-accounts', {
      params: line?.brandId ? { brandId: line.brandId } : undefined,
    })).data,
    enabled: !!line,
  });

  // One option is not a choice. It is selected for the rep and shown as a
  // statement of where to pay — a dropdown you cannot change is a small lie.
  const only = accountOptions.length === 1 ? accountOptions[0] : null;
  const [picked, setPicked] = useState('');
  const accountId = only ? only.id : picked;
  const account = accountOptions.find((a) => a.id === accountId) || null;

  // The confirmation quotes the submission back, so the numbers are captured
  // before the form resets under it.
  const [sent, setSent] = useState(null);
  const settle = useMutation({
    mutationFn: () => api.post(`/settlements/${order.id}/settle-boxes`, { productId, boxes: Number(boxes), accountId: accountId || undefined }),
    onSuccess: () => {
      setSent({ amount: value, boxes: Number(boxes), productName: line?.name });
      onDone();
    },
    onError: (e) => toast.error(apiError(e)),
  });

  // Once it is sent the form is over: no footer buttons, nothing left to fill
  // in, just the confirmation and a way out.
  if (sent) {
    return (
      <Modal open onClose={onClose} title={`Settlement · ${order.settlementNumber}`}>
        <SettleDone {...sent} onClose={onClose} />
      </Modal>
    );
  }

  const ready = productId && Number(boxes) > 0 && Number(boxes) <= max && accountId;
  return (
    <Modal open onClose={onClose} title={`Submit settlement · ${order.settlementNumber}`}
      footer={
        /* On a phone the action wants the width and the thumb wants the right
           hand side. Cancel stays quiet — it is the rarer choice, and it was
           competing with the button that matters. */
        <div className="flex w-full items-center gap-3">
          <button type="button" onClick={onClose}
            className="shrink-0 rounded-xl px-4 py-3 text-sm font-medium text-muted transition hover:text-foreground">
            Cancel
          </button>
          <Button
            className="flex-1 justify-center py-3 text-[15px]"
            loading={settle.isPending}
            disabled={!ready}
            onClick={() => settle.mutate()}
          >
            {ready ? `Submit ${formatCurrency(value)}` : 'Submit for approval'}
          </Button>
        </div>
      }>
      <div className="space-y-5">
        <p className="text-[13px] leading-snug text-muted">
          Send the money, then submit. Your sale and commission are recorded <b className="text-foreground">once The Lab approves</b>.
        </p>
        {lines.length === 0 ? (
          <p className="rounded-lg border border-border bg-elevated px-3 py-2 text-sm text-faint">Every outstanding box is already submitted and awaiting approval.</p>
        ) : (<>
          <div>
            <StepHead n="1" right={lines.length > 1 ? `${formatNumber(lines.length)} to choose from` : undefined}>What you sold</StepHead>
            {/* One product is not a choice, so it is stated rather than put in
                a dropdown the rep cannot change. */}
            {lines.length === 1 ? (
              <div className="rounded-xl bg-elevated/60 px-4 py-3 ring-1 ring-white/[0.07]">
                <p className="text-[15px] font-semibold leading-tight text-foreground">{line?.name}</p>
                <p className="mt-1 text-xs text-faint">
                  {formatNumber(max)} left to settle · {formatCurrency(line?.sellingPrice || 0)} a box
                </p>
              </div>
            ) : (
              <Select value={productId} onChange={(e) => { setProductId(e.target.value); setBoxes('1'); setPicked(''); }}>
                {lines.map((l) => <option key={l.productId} value={l.productId}>{l.name} — {formatNumber(availFor(l))} left</option>)}
              </Select>
            )}
          </div>

          <div>
            <StepHead n="2" right={`${formatNumber(max)} left · ${formatCurrency(line?.sellingPrice || 0)} a box`}>How many boxes</StepHead>
            <BoxStepper value={boxes} max={max} onChange={setBoxes} />
          </div>

          <SettleSummary boxes={boxes} unitPrice={line?.sellingPrice || 0} productName={lines.length > 1 ? line?.name : null} />

          {only ? (
            <div>
              <StepHead n="3">Where to pay it</StepHead>
              <PayTo account={only} brandName={line?.brandName} />
            </div>
          ) : accountOptions.length === 0 ? (
            /* A brand with no account of its own leaves the rep staring at an
               empty dropdown and a Submit button that never enables. Say why,
               and say who can fix it. */
            <p className="rounded-lg border border-amber-500/25 bg-amber-500/[0.06] px-3 py-2.5 text-sm text-amber-200">
              There is no account set up for {line?.brandName || 'this brand'} to settle into yet, so this cannot be
              submitted. Ask The Lab to add one.
            </p>
          ) : (
            <Field label="Where was it paid?" required hint={account?.notes || 'Select the account the money went to'}>
              <Select value={accountId} onChange={(e) => setPicked(e.target.value)}>
                <option value="">Select payment account…</option>
                {accountOptions.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </Select>
            </Field>
          )}
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

// The same four figures, in the house card the rest of the app uses — a ring
// and a wash of the tone rather than four identical grey boxes. `brand-600`
// was a light-theme leftover and read muddy on a dark page.
const MONEY_TONE = {
  brand: { ring: 'ring-brand-500/25', glow: 'from-brand-500/[0.12]', num: 'text-brand-400' },
  emerald: { ring: 'ring-emerald-500/25', glow: 'from-emerald-500/[0.12]', num: 'text-emerald-400' },
  rose: { ring: 'ring-rose-500/25', glow: 'from-rose-500/[0.12]', num: 'text-rose-400' },
  default: { ring: 'ring-white/[0.08]', glow: 'from-white/[0.03]', num: 'text-foreground' },
};

function MoneyCard({ label, value, tone, sub, quiet }) {
  // A zero is not worth a colour. It keeps the loud tones for figures that
  // actually say something.
  const t = MONEY_TONE[quiet ? 'default' : tone] || MONEY_TONE.default;
  return (
    <div className={`relative overflow-hidden rounded-xl bg-surface p-3.5 ring-1 ${t.ring}`}>
      <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${t.glow} to-transparent`} aria-hidden="true" />
      <div className="relative text-[10px] font-semibold uppercase tracking-wider text-faint">{label}</div>
      <div className={`relative mt-1 text-lg font-bold tabular-nums ${t.num}`}>{value}</div>
      {sub && <div className="relative mt-0.5 text-[11px] text-faint">{sub}</div>}
    </div>
  );
}

// The number a rep has to send money to, made the biggest thing on the card.
// It used to sit in an 11px grey line under the account name, which is where
// you put something nobody needs to read — and this is the one thing they do
// need, standing in front of a customer, on a phone.
//
// The account's notes carry it as "0766 790 794 · CASMIRY CHUWA · OHIS
// payments", so the parts are pulled out and given their own weight.
function payDetails(account) {
  const parts = String(account?.notes || '').split('·').map((x) => x.trim()).filter(Boolean);
  const number = parts.find((x) => /\d[\d\s]{6,}/.test(x)) || null;
  const holder = parts.find((x) => x !== number && /[a-z]/i.test(x) && !/payments?$/i.test(x)) || null;
  return { number, holder };
}

// The wallet logos, drawn as SVG in the official brand colours — Vodacom red
// #E60000 with the m-pesa leaf in green, Airtel red #E40000 with "money" in
// its amber. Drawn rather than downloaded: a bundled logo file is someone
// else's trademarked artwork, and an SVG stays sharp at any size on a phone.
// Kept small on purpose. A rep needs to recognise the wallet in a glance, not
// look at a billboard — the number underneath is the thing they came for.
function MpesaLogo({ className = 'h-5' }) {
  return (
    <svg viewBox="0 0 92 24" className={className} role="img" aria-label="M-Pesa">
      {/* handset */}
      <rect x="1.6" y="2.2" width="14" height="19.6" rx="2.6" fill="none" stroke="#E60000" strokeWidth="2.2" />
      <rect x="6.2" y="18.4" width="4.8" height="1.6" rx="0.8" fill="#E60000" />
      {/* the leaf that sits across the handset */}
      <path d="M4.4 14.6c1.4-4.4 5.4-7 9.6-7.2-1.2 4.4-4.6 7.4-9.6 7.2z" fill="#63B22B" />
      <text x="20.5" y="18.2" fill="#E60000" fontSize="16" fontWeight="700" letterSpacing="-0.4"
        fontFamily="Inter, system-ui, -apple-system, sans-serif">m-pesa</text>
    </svg>
  );
}

function AirtelMoneyLogo({ className = 'h-5' }) {
  return (
    <svg viewBox="0 0 104 24" className={className} role="img" aria-label="Airtel Money">
      {/* the airtel swirl */}
      <path d="M14.6 19.8c-4.6 0-8.2-2.8-8.2-7.2 0-4.8 4.2-8.6 9.2-8.6 3.6 0 6.2 1.9 6.2 4.5 0 1.9-1.2 3.1-2.7 3.4"
        fill="none" stroke="#E40000" strokeWidth="3.6" strokeLinecap="round" />
      <text x="25" y="18.2" fill="#E40000" fontSize="16" fontWeight="700" letterSpacing="-0.4"
        fontFamily="Inter, system-ui, -apple-system, sans-serif">airtel</text>
      <text x="64.5" y="18.2" fill="#F6A800" fontSize="14" fontWeight="600" letterSpacing="-0.2"
        fontFamily="Inter, system-ui, -apple-system, sans-serif">money</text>
    </svg>
  );
}

const PAY_BRAND = {
  'M-Pesa': { Logo: MpesaLogo, ring: 'ring-[#E60000]/25', glow: 'from-[#E60000]/[0.08]' },
  'Airtel Money': { Logo: AirtelMoneyLogo, ring: 'ring-[#E40000]/25', glow: 'from-[#E40000]/[0.08]' },
};
const PAY_FALLBACK = { Logo: null, ring: 'ring-white/[0.10]', glow: 'from-white/[0.03]' };

function PayTo({ account, brandName }) {
  const [copied, setCopied] = useState(false);
  const { number, holder } = payDetails(account);
  const b = PAY_BRAND[account?.name] || PAY_FALLBACK;
  const Logo = b.Logo;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(String(number).replace(/\s+/g, ''));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className={`relative overflow-hidden rounded-xl bg-surface p-4 ring-1 ${b.ring}`}>
      <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${b.glow} to-transparent`} aria-hidden="true" />

      <div className="relative flex items-center gap-2">
        {/* White plate behind it: both logos are drawn for light backgrounds
            and red on near-black is hard to read. */}
        {Logo ? (
          <span className="inline-flex items-center rounded-md bg-white px-2 py-1">
            <Logo className="h-4" />
          </span>
        ) : (
          <span className="text-sm font-semibold text-foreground">{account?.name}</span>
        )}
        <span className="ml-auto text-[11px] text-faint">{brandName || 'This brand'} settles here</span>
      </div>

      {number ? (
        <>
          <div className="relative mt-3 flex items-center gap-3">
            <span className="select-all font-mono text-[26px] font-bold leading-none tracking-wide text-foreground">{number}</span>
            <button
              type="button"
              onClick={copy}
              className="ml-auto shrink-0 rounded-lg bg-elevated px-3 py-2 text-xs font-semibold text-foreground ring-1 ring-white/[0.10] transition active:scale-95"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          {holder && <p className="relative mt-1.5 text-sm font-medium text-muted">{holder}</p>}
        </>
      ) : (
        <p className="relative mt-2 text-sm font-semibold text-foreground">{account?.name}</p>
      )}
    </div>
  );
}

// What the rep is about to hand over, read like a receipt: the boxes, the price
// each, and the line they actually have to collect. It was a faint "Amount TSh
// 30,000" wedged next to the buttons, which is where a total goes to be missed.
function SettleSummary({ boxes, unitPrice, productName }) {
  const n = Number(boxes) || 0;
  const total = n * (Number(unitPrice) || 0);
  if (n <= 0) return null;
  return (
    <div className="rounded-xl bg-elevated/60 p-4 ring-1 ring-white/[0.07]">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">To collect</p>
      <div className="mt-2 flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-sm text-muted">
          {formatNumber(n)} {n === 1 ? 'box' : 'boxes'} &times; {formatCurrency(unitPrice)}
        </span>
        <span className="shrink-0 text-2xl font-bold tabular-nums text-brand-400">{formatCurrency(total)}</span>
      </div>
      {productName && <p className="mt-1 truncate text-[11px] text-faint">{productName}</p>}
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
        footer={order && (() => {
          /* Every one of these matters — settling money, sending stock back,
             buying more time. So they are one set: same size, same shape, each
             carrying a colour that says what it does. Settling keeps the filled
             green because it is the one you came for, but it is no longer a
             slab twice the height of the rest.

             Built from whichever actions are actually available, so a rep who
             cannot extend does not get a hole in the grid. */
          const actions = [];
          if (canAct && active && remaining > 0) {
            actions.push({
              key: 'settle', label: 'Submit settlement', Icon: Wallet, onClick: () => setSub('settle'),
              cls: 'bg-brand-500 text-slate-950 ring-brand-500 font-bold shadow-lg shadow-brand-500/20', icon: 'text-slate-950',
            });
          }
          if (staff && active && remaining <= 0) {
            actions.push({
              key: 'close-order', label: 'Close this order', Icon: CheckCircle2,
              onClick: () => settle.mutate(), busy: settle.isPending,
              cls: 'bg-emerald-400 text-slate-950 ring-emerald-400 font-bold shadow-lg shadow-emerald-500/20', icon: 'text-slate-950',
            });
          }
          if (canAct && active && remaining > 0) {
            actions.push({
              key: 'return', label: 'Return boxes', Icon: Undo2, onClick: () => setSub('return'),
              cls: 'bg-elevated text-foreground ring-white/[0.07]', icon: 'text-amber-400',
            });
          }
          if (canAct && active && order.canSelfExtend) {
            actions.push({
              key: 'more-time', label: 'More time', Icon: CalendarPlus, onClick: () => setSub('self-extend'),
              cls: 'bg-elevated text-foreground ring-white/[0.07]', icon: 'text-sky-400',
            });
          }
          if (staff && active) {
            actions.push({
              key: 'extend', label: 'Extend deadline', Icon: Clock, onClick: () => setSub('extend'),
              cls: 'bg-elevated text-foreground ring-white/[0.07]', icon: 'text-violet-400',
            });
          }

          const [primary, ...rest] = actions;
          const btn = 'flex h-11 items-center justify-center gap-2 rounded-xl px-3 text-[13px] font-semibold ring-1 transition duration-150 active:scale-[0.97] disabled:opacity-60';

          return (
            <div className="w-full space-y-2">
              {primary && (
                <button type="button" onClick={primary.onClick} disabled={primary.busy}
                  className={`${btn} w-full ${primary.cls}`}>
                  <primary.Icon className={`h-4 w-4 shrink-0 ${primary.icon}`} />
                  {primary.label}
                </button>
              )}
              {rest.length > 0 && (
                <div className={`grid gap-2 ${rest.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
                  {rest.map((a) => (
                    <button key={a.key} type="button" onClick={a.onClick} disabled={a.busy}
                      className={`${btn} ${a.cls}`}>
                      <a.Icon className={`h-4 w-4 shrink-0 ${a.icon}`} />
                      {a.label}
                    </button>
                  ))}
                </div>
              )}

              {staff && active && remaining > 0 && (
                <p className="text-center text-xs text-faint">
                  {formatNumber(remaining)} box{remaining === 1 ? '' : 'es'} left to account for
                </p>
              )}
            </div>
          );
        })()}
      >
        {isLoading || !order ? <PageSpinner /> : (
          <div className="space-y-5">
            {/* Who and what state, on one line — then the two dates below it as a
                pair, since they are read together. Same four facts, arranged so
                the eye is not hopping across a 2x2 of look-alike blocks. */}
            <div className="rounded-xl bg-elevated/50 px-4 py-3 ring-1 ring-white/[0.06]">
              <div className="flex items-center gap-3">
                {/* A rep opening their own order already knows whose it is.
                    Staff are looking at someone else's, so they still need it. */}
                {isOwnRep ? (
                  <div className="text-[13px] font-semibold text-muted">This order</div>
                ) : (
                  <div className="min-w-0">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-faint">Rep</div>
                    <div className="truncate text-[15px] font-semibold text-foreground">{order.salesRep?.user?.name}</div>
                  </div>
                )}
                <Badge className={`ml-auto shrink-0 ${SETTLEMENT_STATUS_META[order.status]?.cls}`}>
                  {SETTLEMENT_STATUS_META[order.status]?.label}
                </Badge>
              </div>
              <div className={`grid grid-cols-2 gap-3 border-t border-white/[0.06] pt-3 ${isOwnRep ? 'mt-2.5' : 'mt-3'}`}>
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-faint">Issued</div>
                  <div className="mt-0.5 text-[13px] font-medium text-muted">{formatDateTime(order.issuedAt)}</div>
                </div>
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-faint">
                    {order.status === 'SETTLED' ? 'Settled' : 'Deadline'}
                  </div>
                  <div className={`mt-0.5 text-[13px] font-medium ${
                    order.status === 'SETTLED' ? 'text-emerald-400'
                      : overdue ? 'text-rose-400' : 'text-foreground'}`}>
                    {order.status === 'SETTLED'
                      ? (order.settledAt ? formatDateTime(order.settledAt) : '—')
                      : formatDateTime(order.deadlineAt)}
                  </div>
                </div>
              </div>
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
              <MoneyCard label="Settled" value={formatCurrency(order.order.totals.settledValue)} tone="emerald"
                quiet={!(order.order.totals.settledValue > 0)} />
              <MoneyCard label="Returned value" value={formatCurrency(order.order.totals.returnedValue)} />
              <MoneyCard label="Outstanding" value={formatCurrency(order.order.totals.outstanding)} tone="rose"
                quiet={!(order.order.totals.outstanding > 0)} />
            </div>

            {/* Box-by-box, per product. A five-column table on a 390px phone
                scrolls the product name off the left edge, so the header reads
                "SUED" and the numbers belong to nothing. One block per product
                with its own bar says the same thing and fits. */}
            <div>
              <div className="mb-2 text-sm font-semibold text-foreground">Every box in this order</div>
              <div className="space-y-2">
                {order.order.lines.map((l) => {
                  const total = Math.max(1, l.assigned);
                  const pct = (n) => `${Math.max(0, (n / total) * 100)}%`;
                  return (
                    <div key={l.productId} className="rounded-xl bg-elevated/50 p-3 ring-1 ring-white/[0.06]">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground">{l.name}</span>
                        <span className="shrink-0 text-[11px] text-faint">{formatNumber(l.assigned)} issued</span>
                      </div>
                      <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
                        <div className="bg-emerald-400" style={{ width: pct(l.settled) }} />
                        <div className="bg-sky-400" style={{ width: pct(l.returned) }} />
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
                        <span className="text-emerald-400">{formatNumber(l.settled)} settled</span>
                        <span className="text-sky-400">
                          {formatNumber(l.returned)} returned
                          {(l.pendingReturn || 0) > 0 && <span className="ml-1 text-amber-400">+{formatNumber(l.pendingReturn)} pending</span>}
                        </span>
                        <span className={l.remaining > 0 && overdue ? 'ml-auto font-semibold text-rose-400' : 'ml-auto text-muted'}>
                          {formatNumber(l.remaining)} {overdue ? 'missing' : 'left'}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="relative mt-2 overflow-hidden rounded-xl bg-surface px-3 py-3 ring-1 ring-brand-500/25">
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-brand-500/[0.12] to-transparent" aria-hidden="true" />
                <div className="relative flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] font-semibold">
                <span className="text-brand-300">All {formatNumber(order.order.totals.assignedBoxes)} boxes</span>
                <span className="text-emerald-400">{formatNumber(order.order.totals.settledBoxes)} settled</span>
                <span className="text-sky-400">{formatNumber(order.order.totals.returnedBoxes)} returned</span>
                <span className={order.order.totals.remainingBoxes > 0 && overdue ? 'ml-auto text-rose-400' : 'ml-auto text-foreground'}>
                  {formatNumber(order.order.totals.remainingBoxes)} {overdue ? 'missing' : 'left'}
                </span>
                </div>
              </div>

              <p className="mt-2 text-[11px] leading-snug text-faint">
                The order closes only when every box is settled or returned. After the deadline, boxes not accounted
                for count as missing — {formatCurrency(order.order.totals.remainingValue)} on this one.
              </p>
              <p className="mt-1 text-[11px] leading-snug text-faint">
                Commission on {formatNumber(order.order.totals.settledBoxes)} settled box{order.order.totals.settledBoxes === 1 ? '' : 'es'}:{' '}
                <span className="font-semibold text-brand-400">{formatCurrency(order.order.totals.commission)}</span> · paid via Commissions.
              </p>
            </div>

            {/* Money in — one row per settlement, not a paragraph that wraps. */}
            <div>
              <div className="mb-2 flex items-baseline gap-2">
                <span className="text-sm font-semibold text-foreground">Settled</span>
                {order.sales?.length > 0 && (
                  <span className="text-[11px] text-faint">
                    {formatNumber(order.sales.length)} time{order.sales.length === 1 ? '' : 's'}
                  </span>
                )}
              </div>
              {!order.sales?.length ? (
                <p className="rounded-xl bg-elevated/40 px-3 py-2.5 text-[13px] text-faint">Nothing settled yet.</p>
              ) : (
                <ul className="space-y-2">
                  {order.sales.map((s) => {
                    const boxes = (s.items || []).reduce((n, i) => n + (i.quantity || 0), 0);
                    return (
                      <li key={s.id} className="rounded-xl bg-emerald-500/[0.06] p-3 ring-1 ring-emerald-500/20">
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="text-[13px] font-semibold text-foreground">
                            {formatNumber(boxes)} box{boxes === 1 ? '' : 'es'}
                          </span>
                          <span className="shrink-0 text-[15px] font-bold tabular-nums text-emerald-400">{formatCurrency(s.total)}</span>
                        </div>
                        <p className="mt-1 truncate text-[11px] text-muted">
                          {(s.items || []).map((i) => i.product?.name).filter(Boolean).join(', ')}
                        </p>
                        <p className="mt-0.5 text-[11px] text-faint">{formatDateTime(s.soldAt)} · {s.saleNumber}</p>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* Boxes that came back. These used to disappear into a total the
                moment they were approved, with no way to see which ones. */}
            {order.returnsList?.length > 0 && (
              <div>
                <div className="mb-2 flex items-baseline gap-2">
                  <span className="text-sm font-semibold text-foreground">Returned</span>
                  <span className="text-[11px] text-faint">
                    {formatNumber(order.returnsList.length)} time{order.returnsList.length === 1 ? '' : 's'}
                  </span>
                </div>
                <ul className="space-y-2">
                  {order.returnsList.map((r) => (
                    <li key={r.id} className="rounded-xl bg-sky-500/[0.06] p-3 ring-1 ring-sky-500/20">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-[13px] font-semibold text-foreground">
                          {formatNumber(r.boxes)} box{r.boxes === 1 ? '' : 'es'} back
                        </span>
                        <span className="shrink-0 text-[11px] text-sky-300">{r.returnNumber}</span>
                      </div>
                      <p className="mt-1 truncate text-[11px] text-muted">
                        {r.items.map((i) => i.productName).filter(Boolean).join(', ')}
                      </p>
                      <p className="mt-0.5 text-[11px] text-faint">
                        {r.at ? formatDateTime(r.at) : '—'}{r.reason ? ` · ${r.reason}` : ''}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            )}
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
