import { useState, useEffect } from 'react';
import { useQuery, useQueries, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { motion, useReducedMotion } from 'motion/react';
import { Wallet, Undo2, CheckCircle2, Clock, CalendarPlus, ShieldAlert, RotateCcw, ChevronDown } from 'lucide-react';
import api, { unwrap, apiError } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useProducts, useWarehouses } from '@/lib/hooks';
import { ROLES, SETTLEMENT_STATUS_META } from '@/lib/constants';
import { formatCurrency, formatNumber, formatDateTime, formatDate } from '@/lib/format';
import {
  Modal, Button, Field, Input, Select, Badge, PageSpinner,
  Table, THead, TBody, TR, TH, TD,
  BoxCount, Remaining,
} from '@/components/ui';
import NumberedLines from '@/components/NumberedLines';
import StepperLines from '@/components/StepperLines';

// --- Submit settlement: the rep submits boxes + cash for The Doctor's approval
// Nothing is recorded (no sale, commission, revenue or profit) until approved.
function pendingBoxesByProduct(order) {
  const m = {};
  (order.pendingSubmissionsList || []).forEach((p) => { m[p.productId] = (m[p.productId] || 0) + p.boxes; });
  return m;
}

// A small uppercase rule the eye can scan on a phone, instead of a stack of
// identical form labels.
function StepHead({ children, right }) {
  return (
    <div className="mb-2 flex items-center gap-2">
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
  const btn = 'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-elevated text-lg font-bold text-foreground ring-1 ring-white/[0.08] transition active:scale-95 disabled:opacity-30';
  return (
    <div className="flex items-center gap-2">
      <button type="button" className={btn} onClick={() => set(n - 1)} disabled={n <= 0} aria-label="One fewer box">−</button>
      <input
        type="number" inputMode="numeric" min="0" max={max} value={value}
        onChange={(e) => set(Number(e.target.value))}
        className="h-10 min-w-0 flex-1 rounded-lg bg-elevated text-center text-lg font-bold tabular-nums text-foreground ring-1 ring-white/[0.08] focus:outline-none focus:ring-2 focus:ring-brand-500/50"
      />
      <button type="button" className={btn} onClick={() => set(n + 1)} disabled={n >= max} aria-label="One more box">+</button>
      {max > 1 && (
        <button
          type="button"
          onClick={() => set(max)}
          className="h-10 shrink-0 rounded-lg bg-brand-500/15 px-3 text-xs font-semibold text-brand-600 ring-1 ring-brand-500/25 transition active:scale-95"
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
        Your commission is added once it is approved.
      </p>

      <Button className="animate-rise mt-6 w-full" style={{ animationDelay: '0.58s' }} onClick={onClose}>
        Done
      </Button>
    </div>
  );
}

function SettleOneModal({ order, onClose, onDone }) {
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
  const { data: accountOptions = [], isLoading: accountsLoading } = useQuery({
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
    <Modal open onClose={onClose} title="Submit settlement"
      footer={
        /* On a phone the action wants the width and the thumb wants the right
           hand side. Cancel stays quiet — it is the rarer choice, and it was
           competing with the button that matters. */
        <div className="flex w-full items-center gap-2">
          <button type="button" onClick={onClose} className={CANCEL_CLS}>Cancel</button>
          <Button className={PRIMARY_CLS} loading={settle.isPending} disabled={!ready} onClick={() => settle.mutate()}>
            {ready ? `Submit ${formatCurrency(value)}` : 'Submit for approval'}
          </Button>
        </div>
      }>
      <div className="space-y-4">
        {lines.length === 0 ? (
          <p className="rounded-lg border border-border bg-elevated px-3 py-2 text-sm text-faint">Every outstanding box is already submitted and awaiting approval.</p>
        ) : (<>
          {/* One product: the same row as in the list for several — the name, what is left, and the
              stepper (with an "All" shortcut) — so there is one way to say how many. */}
          {lines.length === 1 ? (
            <StepperLines
              items={[{
                key: line?.productId,
                name: line?.name,
                max,
                qty: Number(boxes) || 0,
                sub: `${formatNumber(max)} left · ${formatCurrency(line?.sellingPrice || 0)}`,
              }]}
              onChange={(_, q) => setBoxes(String(Math.max(0, Math.min(max, q))))}
            />
          ) : (
            <>
              <Select value={productId} onChange={(e) => { setProductId(e.target.value); setBoxes('1'); setPicked(''); }}>
                {lines.map((l) => <option key={l.productId} value={l.productId}>{l.name} — {formatNumber(availFor(l))} left</option>)}
              </Select>
              <BoxStepper value={boxes} max={max} onChange={setBoxes} />
            </>
          )}

          <SettleSummary boxes={boxes} unitPrice={line?.sellingPrice || 0} productName={lines.length > 1 ? line?.name : null} />

          {only ? (
            <div>
              <StepHead>Pay first to</StepHead>
              <PayTo account={only} brandName={line?.brandName} />
            </div>
          ) : accountsLoading ? (
            // Still asking the server: say nothing alarming yet.
            <p className="text-[13px] text-faint">Loading…</p>
          ) : accountOptions.length === 0 ? (
            /* A brand with no account of its own leaves the rep staring at an
               empty dropdown and a Submit button that never enables. Say why,
               and say who can fix it. */
            <p className="rounded-lg border border-amber-500/25 bg-amber-500/[0.06] px-3 py-2.5 text-sm text-amber-200">
              There is no account set up for {line?.brandName || 'this brand'} to settle into yet, so this cannot be
              submitted. Ask ZELab to add one.
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
// The product a rep can still settle: boxes left, less those already waiting for approval or
// locked in a return.
const settleAvail = (order, l) => Math.max(0, l.remaining - (pendingBoxesByProduct(order)[l.productId] || 0) - (l.pendingReturn || 0));

// The footer of a form: Cancel (outlined, quiet) and the one button that does the thing, which takes
// the rest of the width. Same height as the buttons on the order screen.
const CANCEL_CLS = 'h-10 shrink-0 rounded-lg px-4 text-[13px] font-medium text-foreground/80 ring-1 ring-white/[0.1] transition hover:bg-elevated/70 active:scale-[0.98]';
const PRIMARY_CLS = 'h-10 flex-1 justify-center text-sm font-semibold';

// Where to pay, for one brand's share of a settlement. One account is stated, not offered as a
// dropdown that cannot change; several are a choice; none says so out loud.
function PayBlock({ step, brandName, amount, options, picked, onPick, labelled }) {
  const only = options && options.length === 1 ? options[0] : null;
  return (
    <div>
      <StepHead right={labelled ? formatCurrency(amount) : undefined}>
        {labelled ? `Pay ${brandName || 'this brand'}` : 'Pay first to'}
      </StepHead>
      {!options ? (
        <p className="text-[13px] text-faint">Loading…</p>
      ) : only ? (
        <PayTo account={only} brandName={brandName} />
      ) : options.length === 0 ? (
        <p className="rounded-lg border border-amber-500/25 bg-amber-500/[0.06] px-3 py-2.5 text-sm text-amber-200">
          There is no account set up for {brandName || 'this brand'} yet, so this cannot be submitted. Ask ZELab to add one.
        </p>
      ) : (
        <Select value={picked || ''} onChange={(e) => onPick(e.target.value)}>
          <option value="">Select payment account…</option>
          {options.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </Select>
      )}
    </div>
  );
}

// Settling SEVERAL products at once: a numbered list with a small stepper on each row, then what
// to collect, then where each brand's share is paid (OHIS and Civlily settle to different wallets,
// so a mixed list shows one payment block per brand). Each line still becomes its own submission
// for approval — they are just sent together, and saved all or none.
function SettleManyModal({ order, onClose, onDone }) {
  const lines = order.order.lines.filter((l) => settleAvail(order, l) > 0);
  const [cart, setCart] = useState({}); // productId -> boxes
  const [picked, setPicked] = useState({}); // brandId -> accountId, where a brand has more than one
  const setQty = (id, qty) => {
    const line = lines.find((l) => l.productId === id);
    const capped = Math.min(Math.max(0, qty), line ? settleAvail(order, line) : 0);
    setCart((prev) => {
      if (capped <= 0) { const n = { ...prev }; delete n[id]; return n; }
      return { ...prev, [id]: capped };
    });
  };

  const chosen = lines.filter((l) => cart[l.productId] > 0);
  const totalBoxes = chosen.reduce((n, l) => n + cart[l.productId], 0);
  const lineValue = (l) => cart[l.productId] * (l.sellingPrice || 0);
  const total = chosen.reduce((n, l) => n + lineValue(l), 0);

  // One list per BRAND. Every brand settles into its own account (OHIS to M-Pesa, Civlily to Airtel
  // Money, and whatever brand comes next to its own), so the products of one brand are listed
  // together, with that brand's amount to collect and where to pay it right under them.
  const groups = [];
  for (const l of lines) {
    const b = l.brandId || '';
    let g = groups.find((x) => x.brandId === b);
    if (!g) { g = { brandId: b, brandName: l.brandName, lines: [] }; groups.push(g); }
    g.lines.push(l);
  }
  const accountQs = useQueries({
    queries: groups.map((g) => ({
      queryKey: ['settlements', 'payment-accounts', g.brandId],
      queryFn: async () => unwrap(await api.get('/settlements/payment-accounts', { params: g.brandId ? { brandId: g.brandId } : undefined })).data,
    })),
  });
  const optionsFor = (b) => accountQs[groups.findIndex((g) => g.brandId === b)]?.data;
  const accountFor = (b) => {
    const opts = optionsFor(b);
    return opts && opts.length === 1 ? opts[0].id : picked[b] || '';
  };
  const chosenIn = (g) => g.lines.filter((l) => cart[l.productId] > 0);
  const amountIn = (g) => chosenIn(g).reduce((n, l) => n + lineValue(l), 0);
  const boxesIn = (g) => chosenIn(g).reduce((n, l) => n + cart[l.productId], 0);
  const brandsChosen = groups.filter((g) => chosenIn(g).length > 0);

  const [sent, setSent] = useState(null);
  const settle = useMutation({
    mutationFn: () => api.post(`/settlements/${order.id}/settle-many`, {
      items: chosen.map((l) => ({ productId: l.productId, boxes: cart[l.productId], accountId: accountFor(l.brandId || '') || undefined })),
    }),
    onSuccess: () => {
      setSent({ amount: total, boxes: totalBoxes, productName: chosen.length > 1 ? `${chosen.length} products` : chosen[0]?.name });
      onDone();
    },
    onError: (e) => toast.error(apiError(e)),
  });

  if (sent) {
    return (
      <Modal open onClose={onClose} title="Settlement">
        <SettleDone {...sent} onClose={onClose} />
      </Modal>
    );
  }

  const ready = chosen.length > 0 && brandsChosen.every((g) => accountFor(g.brandId));
  return (
    <Modal open onClose={onClose} title="Submit settlement"
      footer={
        <div className="flex w-full items-center gap-2">
          <button type="button" onClick={onClose} className={CANCEL_CLS}>Cancel</button>
          <Button className={PRIMARY_CLS} loading={settle.isPending} disabled={!ready} onClick={() => settle.mutate()}>
            {ready ? `Submit ${formatCurrency(total)}` : 'Submit for approval'}
          </Button>
        </div>
      }>
      <div className="space-y-6">
        {groups.map((g) => {
          const gc = chosenIn(g);
          const opts = optionsFor(g.brandId);
          const only = opts && opts.length === 1 ? opts[0] : null;
          return (
            <section key={g.brandId || 'none'}>
              {/* A heading per brand, saying where that brand pays. With one brand on the order there is
                  nothing to tell apart, so no heading. */}
              {groups.length > 1 && (
                <div className="mb-2 flex items-baseline justify-between gap-3">
                  <h3 className="text-sm font-semibold text-foreground">{g.brandName || 'Other'}</h3>
                  {only && <span className="text-xs text-muted">pays to {only.name}</span>}
                </div>
              )}
              <StepperLines
                items={g.lines.map((l) => ({
                  key: l.productId,
                  name: l.name,
                  max: settleAvail(order, l),
                  qty: cart[l.productId] || 0,
                  sub: `${formatNumber(settleAvail(order, l))} left · ${formatCurrency(l.sellingPrice || 0)}`,
                }))}
                onChange={setQty}
              />
              {gc.length > 0 && (
                <div className="mt-3 space-y-3">
                  <div className="flex items-baseline justify-between gap-3 border-y border-white/[0.06] py-3">
                    <div className="min-w-0">
                      <p className="text-[13px] text-muted">To collect{groups.length > 1 && g.brandName ? ` · ${g.brandName}` : ''}</p>
                      <p className="text-[11px] text-faint">
                        {formatNumber(boxesIn(g))} {boxesIn(g) === 1 ? 'box' : 'boxes'} · {gc.length} {gc.length === 1 ? 'product' : 'products'}
                      </p>
                    </div>
                    <span className="shrink-0 text-xl font-bold tabular-nums text-brand-600">{formatCurrency(amountIn(g))}</span>
                  </div>
                  <PayBlock
                    labelled={false}
                    brandName={g.brandName}
                    amount={amountIn(g)}
                    options={opts}
                    picked={picked[g.brandId]}
                    onPick={(id) => setPicked((p) => ({ ...p, [g.brandId]: id }))}
                  />
                </div>
              )}
            </section>
          );
        })}

        {/* Only when two or more brands are in it: what the whole submission adds up to. */}
        {brandsChosen.length > 1 && (
          <div className="flex items-baseline justify-between gap-3 border-t border-white/[0.06] pt-3">
            <span className="text-[13px] text-muted">Total · {formatNumber(totalBoxes)} {totalBoxes === 1 ? 'box' : 'boxes'}</span>
            <span className="text-xl font-bold tabular-nums text-brand-600">{formatCurrency(total)}</span>
          </div>
        )}
      </div>
    </Modal>
  );
}

// One product left to settle keeps the simple form; two or more get the list. Decided once when
// the form opens, so submitting (which refreshes the order) cannot swap the form under the rep
// and lose the confirmation.
function SettleBoxesModal(props) {
  const [many] = useState(() => props.order.order.lines.filter((l) => settleAvail(props.order, l) > 0).length > 1);
  return many ? <SettleManyModal {...props} /> : <SettleOneModal {...props} />;
}

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
    onSuccess: () => { toast.success('Return submitted — awaiting ZELab approval'); onDone(); onClose(); },
    onError: (e) => toast.error(apiError(e)),
  });

  const footer = (
    <div className="flex w-full items-center gap-2">
      <button type="button" onClick={onClose} className={CANCEL_CLS}>Cancel</button>
      <Button className={PRIMARY_CLS} loading={create.isPending} disabled={!warehouseId || !hasCart} onClick={() => create.mutate()}>
        {hasCart ? `Return ${formatNumber(totalBoxes)} box${totalBoxes !== 1 ? 'es' : ''}` : 'Return boxes'}
      </Button>
    </div>
  );

  return (
    <Modal open onClose={onClose} size="lg" title="Return boxes" footer={footer}>
      {returnableLines.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted">No boxes left to return on this order.</p>
      ) : (
        <StepperLines
          items={returnableLines.map((line) => ({
            key: line.productId,
            name: line.name,
            max: returnAvail(line),
            qty: cart[line.productId] || 0,
            sub: (
              <>
                {formatNumber(returnAvail(line))} available
                {(line.pendingReturn || 0) > 0 && <span className="text-amber-500"> · {formatNumber(line.pendingReturn)} locked</span>}
              </>
            ),
          }))}
          onChange={setQty}
        />
      )}
    </Modal>
  );
}

// "+4 days", "+5 days 6 h", "−21 h" — a span of hours as a person says it.
// Rounded to the hour BEFORE it is split, or 47.8 hours reads "+1 day 24 h".
function spanOfHours(h) {
  const sign = h < 0 ? '−' : '+';
  const abs = Math.abs(Number(h) || 0);
  if (abs > 0 && abs < 1) return `${sign}${Math.max(1, Math.round(abs * 60))} min`;
  const total = Math.round(abs);
  const days = Math.floor(total / 24);
  const rest = total % 24;
  const parts = [];
  if (days) parts.push(`${days} day${days !== 1 ? 's' : ''}`);
  if (rest || !days) parts.push(`${rest} h`);
  return sign + parts.join(' ');
}

// Every lot of time an order was given, newest first. The owner asked for this
// after an order was extended twice and only one of them could be taken back.
function DeadlineHistory({ order }) {
  const [open, setOpen] = useState(false);
  const rows = order.deadlineHistory || [];
  if (!rows.length) return null;
  // What counts is the time that is still on the order: lots taken back are not in the total.
  const live = rows.filter((c) => !c.undoneAt);
  const total = live.reduce((sum, c) => sum + (Number(c.hours) || 0), 0);
  return (
    <div className="mt-3">
      {/* One line: how much time was added and how many times. The lots themselves are a tap away —
          three of them used to take half a phone screen before the boxes were even in view. */}
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 text-left">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-faint">Time added</span>
        <span className="flex items-center gap-1.5 text-[13px] font-medium text-foreground">
          {live.length ? spanOfHours(total) : 'Taken back'}
          {live.length > 0 && <span className="text-[11px] font-normal text-faint">{live.length} time{live.length === 1 ? '' : 's'}</span>}
          <ChevronDown className={`h-3.5 w-3.5 text-faint transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
        </span>
      </button>
      {open && (
        <ul className="mt-2.5 space-y-2.5">
          {rows.map((c, i) => (
            <li key={c.id || `synth-${i}`} className="text-[11px] leading-snug">
              <div className="flex items-baseline justify-between gap-3">
                <span className={`text-[13px] font-semibold ${c.undoneAt ? 'text-faint line-through' : 'text-foreground'}`}>
                  {spanOfHours(c.hours)}
                </span>
                <span className="text-faint">{c.at ? formatDate(c.at) : ''}</span>
              </div>
              <div className="text-faint">
                {c.kind === 'SELF_EXTENSION' ? `Own ${order.extensionHours || 96} hours` : (c.byName || 'ZELab')}
                {' · '}new deadline {formatDateTime(c.toAt)}
                {c.unrecorded && ' · added before the app kept a record'}
                {c.undoneAt && ` · taken back ${formatDate(c.undoneAt)}`}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// The boxes of an order as a ring: settled, returned, waiting for approval, and what is left — in
// one picture that reads the same for one product or twelve. The number in the middle is the one
// that matters (boxes left). The arcs grow in on open; under reduced motion they are simply there.
function SettleDonut({ total, segments, children, size = 104, stroke = 11 }) {
  const reduce = useReducedMotion();
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (reduce) { setOn(true); return undefined; }
    const t = setTimeout(() => setOn(true), 60);
    return () => clearTimeout(t);
  }, [reduce]);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={stroke} />
        {segments.filter((x) => x.value > 0).map((x, i) => {
          const len = (x.value / Math.max(1, total)) * c;
          const el = (
            <circle
              key={i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={x.color} strokeWidth={stroke}
              strokeDasharray={`${on ? Math.max(0, len - 1.5) : 0} ${c}`} strokeDashoffset={-offset}
              style={{ transition: reduce ? 'none' : 'stroke-dasharray 0.9s cubic-bezier(0.22, 1, 0.36, 1)' }}
            />
          );
          offset += len;
          return el;
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
    </div>
  );
}

// A short list that can grow: the latest few rows, and "Show all N" for the rest. An order with a
// dozen settlements used to be a dozen three-line cards between the rep and the buttons.
function FoldedRows({ title, rows, tone, keep = 3 }) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, keep);
  return (
    <div>
      <div className="mb-2 flex items-baseline gap-2">
        <span className="text-sm font-semibold text-foreground">{title}</span>
        <span className="text-[11px] text-faint">{formatNumber(rows.length)} time{rows.length === 1 ? '' : 's'}</span>
      </div>
      <ul className="divide-y divide-white/[0.06]">
        {shown.map((r) => (
          <li key={r.key} className="py-2.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[13px] font-semibold text-foreground">{r.left}</span>
              <span className={`shrink-0 text-[13px] font-semibold tabular-nums ${tone}`}>{r.right}</span>
            </div>
            {r.sub && <p className="mt-0.5 truncate text-[11px] text-faint">{r.sub}</p>}
          </li>
        ))}
      </ul>
      {rows.length > keep && (
        <button type="button" onClick={() => setAll((v) => !v)}
          className="mt-1.5 w-full rounded-lg py-2 text-xs font-semibold text-muted transition hover:text-foreground">
          {all ? 'Show fewer' : `Show all ${formatNumber(rows.length)}`}
        </button>
      )}
    </div>
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
          <div className="mt-1 flex justify-between"><span className="text-muted">Extra time</span><span className="font-medium text-brand-600">+{order.extensionHours || 96} hours</span></div>
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

// Time given by mistake, taken back — the last lot, or every lot that still
// stands. The screen says what that costs the rep before it happens, because
// cancelling their extension hands back their one use and their normal fine
// rate, and a restored deadline that has already passed makes the order
// overdue the moment it is done.
//
// Why "all of it" is offered: undoing one lot at a time can strand the order
// halfway. If the deadline in between has already passed the order goes
// overdue, the first daily fine lands on it, and a fined order refuses any
// further undo — the earlier lot could then never be taken back. So when that
// is where one step would land, taking the lot is what the screen suggests.
function UndoDeadlineModal({ order, onClose, onDone }) {
  const lastTo = order.undoDeadlineTo ? new Date(order.undoDeadlineTo) : null;
  const allTo = order.undoAllDeadlineTo ? new Date(order.undoAllDeadlineTo) : null;
  const canTakeAll = order.undoAllCount > 1 && allTo;
  const stepStrands = canTakeAll && lastTo && lastTo <= new Date();
  const [scope, setScope] = useState(stepStrands ? 'all' : 'last');
  const taking = scope === 'all' && canTakeAll ? 'all' : 'last';

  const undo = useMutation({
    mutationFn: () => api.post(`/settlements/${order.id}/undo-deadline`, { all: taking === 'all' }),
    onSuccess: () => { toast.success('Deadline put back'); onDone(); onClose(); },
    onError: (e) => toast.error(apiError(e)),
  });

  const standing = (order.deadlineHistory || []).filter((c) => !c.undoneAt);
  const taken = taking === 'all' ? standing : standing.slice(0, 1);
  // Cancelling the rep's own extension is what changes their fine rate, so the
  // warning follows what is actually being taken back, not the newest change.
  const wasSelfExtension = taken.some((c) => c.kind === 'SELF_EXTENSION');
  const back = taking === 'all' ? allTo : lastTo;
  const alreadyPast = back && back <= new Date();
  const dropsLaterTime = taken.some((c) => c.unrecorded);
  const title = wasSelfExtension ? 'Cancel extension' : 'Undo deadline change';

  return (
    <Modal open onClose={onClose} title={`${title} · ${order.settlementNumber}`}
      footer={<>
        <Button variant="secondary" onClick={onClose}>Leave it</Button>
        <Button variant="danger" loading={undo.isPending} onClick={() => undo.mutate()}>
          <RotateCcw className="h-4 w-4" /> {wasSelfExtension ? 'Cancel the extension' : 'Put the deadline back'}
        </Button>
      </>}
    >
      <div className="space-y-4 text-sm">
        {canTakeAll && (
          <div className="space-y-2">
            {[
              { key: 'last', label: 'Only the last lot of time', to: lastTo, note: standing[0] ? `takes off ${spanOfHours(standing[0].hours).replace(/^[+−]/, '')}` : null },
              { key: 'all', label: `All the extra time (${order.undoAllCount} lots)`, to: allTo, note: `takes off ${spanOfHours(standing.reduce((t, c) => t + (Number(c.hours) || 0), 0)).replace(/^[+−]/, '')} — the deadline before any of it` },
            ].map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => setScope(opt.key)}
                className={`flex w-full items-start gap-2.5 rounded-xl border p-3 text-left transition ${
                  scope === opt.key ? 'border-brand-500 bg-brand-500/10' : 'border-border bg-elevated hover:border-white/20'
                }`}
              >
                <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${scope === opt.key ? 'border-brand-500' : 'border-white/30'}`}>
                  {scope === opt.key && <span className="h-2 w-2 rounded-full bg-brand-500" />}
                </span>
                <span className="min-w-0">
                  <span className="block font-medium text-foreground">{opt.label}</span>
                  <span className="block text-xs text-muted">
                    Deadline becomes {formatDateTime(opt.to)}{opt.note ? ` · ${opt.note}` : ''}
                  </span>
                </span>
              </button>
            ))}
            {stepStrands && (
              <p className="text-xs text-faint">
                Taking only the last lot leaves the order overdue at {formatDateTime(lastTo)}. The first daily fine lands
                on that, and once a fine is charged the rest of the time can no longer be taken back — so all of it is
                selected for you.
              </p>
            )}
          </div>
        )}

        <div className="rounded-xl border border-border bg-elevated p-3">
          <div className="flex justify-between"><span className="text-muted">Deadline now</span><span className="font-medium">{formatDateTime(order.deadlineAt)}</span></div>
          <div className="mt-1 flex justify-between border-t border-border pt-1 font-semibold">
            <span>Goes back to</span><span>{back ? formatDateTime(back) : '—'}</span>
          </div>
        </div>

        {wasSelfExtension && (
          <div className="rounded-xl border border-border bg-elevated p-3">
            <div className="mb-1.5 font-semibold text-foreground">What changes for the rep</div>
            <ul className="list-disc space-y-1 pl-4 text-xs text-muted">
              <li>The late fine returns to <b>{formatCurrency(10000)} per day</b> (it is {formatCurrency(20000)} while extended).</li>
              <li>A return not approved in 24 hours costs <b>{formatCurrency(15000)}</b> again, not {formatCurrency(30000)}.</li>
              <li>
                Their {order.extensionHours || 96}-hour extension is unused again — they can take it themselves
                {alreadyPast ? ', once the order is no longer overdue.' : '.'}
              </li>
            </ul>
          </div>
        )}

        {dropsLaterTime && (
          <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-amber-300">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="text-xs">
              Some of this time was added before the app kept a record of it, so it cannot say who gave it — and the hours
              may include time credited back for a return that waited on us.
            </span>
          </div>
        )}

        {alreadyPast && (
          <div className="flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-rose-300">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="text-xs">
              That deadline has already passed, so the order is <b>overdue from now</b>. The daily fine runs from today —
              the days the extra time covered are not charged. Extend it again if the rep is meant to have more time.
            </span>
          </div>
        )}

        <p className="text-xs text-faint">
          The rep is told what changed, and it goes in the audit log.
        </p>
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
          <button onClick={() => setMode('quick')} className={`rounded-lg border px-3 py-1.5 text-sm transition ${mode === 'quick' ? 'border-brand-500 bg-brand-500/10 text-brand-600' : 'border-border text-muted hover:bg-elevated'}`}>Quick</button>
          <button onClick={() => setMode('custom')} className={`rounded-lg border px-3 py-1.5 text-sm transition ${mode === 'custom' ? 'border-brand-500 bg-brand-500/10 text-brand-600' : 'border-border text-muted hover:bg-elevated'}`}>Custom date</button>
        </div>

        {mode === 'quick' ? (
          <div className="flex gap-2">
            {QUICK.map(({ label, h }) => (
              <button
                key={h}
                onClick={() => setHours(h)}
                className={`flex-1 rounded-xl border py-3 text-sm font-semibold transition ${hours === h ? 'border-brand-500 bg-brand-500/10 text-brand-600' : 'border-border text-muted hover:bg-elevated'}`}
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
  brand: { ring: 'ring-brand-500/25', glow: 'from-brand-500/[0.12]', num: 'text-brand-600' },
  emerald: { ring: 'ring-emerald-500/25', glow: 'from-emerald-500/[0.12]', num: 'text-emerald-400' },
  rose: { ring: 'ring-rose-500/25', glow: 'from-rose-500/[0.12]', num: 'text-rose-400' },
  default: { ring: 'ring-white/[0.08]', glow: 'from-white/[0.03]', num: 'text-foreground' },
};

function MoneyCard({ label, value, tone, sub, quiet }) {
  // A zero is not worth a colour. It keeps the loud tones for figures that
  // actually say something.
  const t = MONEY_TONE[quiet ? 'default' : tone] || MONEY_TONE.default;
  return (
    <div className={`relative overflow-hidden rounded-xl bg-surface p-3 ring-1 ${t.ring}`}>
      <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${t.glow} to-transparent`} aria-hidden="true" />
      <div className="relative text-[10px] font-semibold uppercase tracking-wider text-faint">{label}</div>
      <div className={`relative mt-1 text-lg font-bold tabular-nums ${t.num}`}>{value}</div>
      {sub && <div className="relative mt-0.5 text-[11px] text-faint">{sub}</div>}
    </div>
  );
}

// The same segmented bar every product block already draws, at order level and
// half a pixel taller. It grows as the number falls: one event, told twice.
//
// Two kinds of pending, kept apart because their consequences are opposite: a
// return awaiting a decision PAUSES the daily fine, a settlement awaiting one
// does not. Summing them under a single word would tell a rep that boxes
// costing him TSh 10,000 a day and boxes costing him nothing are the same
// thing. Both sit inside the outstanding tail, never inside settled — no sale
// exists until The Doctor approves.
//
// Segments are sized by width and grown with scaleX rather than by animating
// width itself: transform is compositor-only, so the busiest 700ms on the
// screen does not also relayout a flex row on every frame. It also means a
// later data change resizes instantly instead of leaving a gap the emerald
// segment takes three quarters of a second to grow into.
function BoxBar({ settled, returned, pendingSubmitted, pendingReturned, total }) {
  const reduce = useReducedMotion();
  const pct = (n) => `${total > 0 ? Math.max(0, Math.min(100, (n / total) * 100)) : 0}%`;
  const seg = (n, cls, delay) => (
    <div className="h-full shrink-0" style={{ width: pct(n) }}>
      <motion.div
        className={`h-full w-full ${cls}`}
        style={{ transformOrigin: 'left' }}
        initial={{ scaleX: reduce ? 1 : 0 }}
        animate={{ scaleX: 1 }}
        transition={{ duration: reduce ? 0 : 0.7, delay: reduce ? 0 : delay, ease: [0.2, 0.7, 0.3, 1] }}
      />
    </div>
  );
  return (
    <div className="flex h-1 overflow-hidden rounded-full bg-white/[0.07]" aria-hidden="true">
      {seg(settled, 'bg-emerald-400', 0.05)}
      {seg(returned, 'bg-sky-400', 0.12)}
      {seg(pendingSubmitted, 'bg-amber-400/70', 0.19)}
      {seg(pendingReturned, 'bg-sky-400/40', 0.19)}
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
    <div className="rounded-xl bg-elevated/60 px-3.5 py-3 ring-1 ring-white/[0.08]">
      <div className="flex items-center gap-2">
        {/* White plate behind the logo: both are drawn for light backgrounds. */}
        {Logo ? (
          <span className="inline-flex items-center rounded bg-white px-1.5 py-0.5">
            <Logo className="h-3.5" />
          </span>
        ) : (
          <span className="text-[13px] font-semibold text-foreground">{account?.name}</span>
        )}
        <span className="ml-auto text-[11px] text-faint">{brandName || 'This brand'} settles here</span>
      </div>

      {number ? (
        <>
          {/* The number is what the rep came for: easy to read without shouting — 17px, a little
              letter spacing, selectable, and one tap to copy. */}
          <div className="mt-2.5 flex items-center gap-3">
            <div className="min-w-0">
              <span className="select-all font-mono text-[17px] font-semibold leading-none tracking-[0.08em] text-foreground">{number}</span>
              {holder && <p className="mt-1.5 text-[11px] font-medium uppercase tracking-wide text-muted">{holder}</p>}
            </div>
            <button
              type="button"
              onClick={copy}
              className="ml-auto h-8 shrink-0 rounded-lg bg-brand-500/15 px-3 text-xs font-semibold text-brand-600 ring-1 ring-brand-500/30 transition active:scale-95"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </>
      ) : (
        <p className="mt-2 text-sm font-semibold text-foreground">{account?.name}</p>
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
    <div className="flex items-baseline justify-between gap-3 border-y border-white/[0.06] py-3">
      <div className="min-w-0">
        <p className="text-[13px] text-muted">To collect</p>
        <p className="truncate text-[11px] text-faint">
          {formatNumber(n)} {n === 1 ? 'box' : 'boxes'} &times; {formatCurrency(unitPrice)}{productName ? ` · ${productName}` : ''}
        </p>
      </div>
      <span className="shrink-0 text-xl font-bold tabular-nums text-brand-600">{formatCurrency(total)}</span>
    </div>
  );
}

export default function OrderDetailModal({ settlementId, onClose }) {
  const qc = useQueryClient();
  const { hasRole, user } = useAuth();
  const staff = hasRole(ROLES.WAREHOUSE_STAFF);
  const [sub, setSub] = useState(null); // 'settle' | 'return' | 'flag' | 'extend'
  const [detailsOpen, setDetailsOpen] = useState(false); // issued date, extension, fine rate, time added
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
              cls: 'bg-brand-500 text-white ring-brand-500 font-bold', icon: 'text-white',
            });
          }
          if (staff && active && remaining <= 0) {
            actions.push({
              key: 'close-order', label: 'Close this order', Icon: CheckCircle2,
              onClick: () => settle.mutate(), busy: settle.isPending,
              cls: 'bg-emerald-400 text-slate-950 ring-emerald-400 font-bold', icon: 'text-slate-950',
            });
          }
          if (canAct && active && remaining > 0) {
            actions.push({
              key: 'return', label: 'Return boxes', short: 'Return', Icon: Undo2, onClick: () => setSub('return'),
              cls: 'bg-elevated text-foreground ring-white/[0.07]', icon: 'text-amber-400',
            });
          }
          // isOwnRep, not canAct: the 96 hours are the rep's one use, they
          // double the rep's own fines, and they cannot be given back. ZELab
          // sees whether it has been taken — that is in the header — but does
          // not get to take it for them.
          if (isOwnRep && active && order.canSelfExtend) {
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
          // Time given by mistake is not permanent any more.
          if (staff && active && order.canUndoDeadline) {
            actions.push({
              key: 'undo-deadline',
              label: order.undoDeadlineKind === 'SELF_EXTENSION' ? 'Cancel extension' : 'Undo deadline change',
              Icon: RotateCcw,
              onClick: () => setSub('undo-deadline'),
              cls: 'bg-elevated text-foreground ring-white/[0.07]', icon: 'text-rose-400',
            });
          }

          const [primary, ...rest] = actions;

          // ONE slim row. The other actions are plain words, no frame and no icon; the
          // one you came for is a single small filled button on the right (where the thumb is).
          // No full-width slab, no stack of three — the bar was taking a third of a phone screen.
          // If a screen is too narrow for it all, the row wraps instead of squeezing.
          const side = 'flex h-10 shrink-0 items-center rounded-lg px-3 text-[13px] font-medium text-foreground/85 ring-1 ring-white/[0.1] transition hover:bg-elevated/70 active:scale-[0.98] disabled:opacity-60';
          return (
            <div className="flex w-full flex-wrap items-center gap-2">
              {rest.map((a) => (
                <button key={a.key} type="button" onClick={a.onClick} disabled={a.busy} className={side}>
                  {a.short || a.label}
                </button>
              ))}
              {primary && (
                <button type="button" onClick={primary.onClick} disabled={primary.busy}
                  className={`flex h-10 min-w-[8.5rem] flex-1 items-center justify-center rounded-lg px-3 text-[13px] font-semibold transition active:scale-[0.98] disabled:opacity-60 ${primary.cls}`}>
                  {primary.label}
                </button>
              )}
            </div>
          );
        })()}
      >
        {isLoading || !order ? <PageSpinner /> : (
          <div className="space-y-4">
            {/* The top of the order says only what a rep needs at a glance: the deadline and the time
                left. It stays calm until it matters, and turns red — with the fine — when the order is
                overdue; that colour IS the status, so there is no "Open" / "Partial" badge (the ring
                below already shows how far it is). Issued, extension, the fine rate and time added are
                one tap away under "Details". ZELab staff see whose order it is. */}
            <div>
              {!isOwnRep && order.salesRep?.user?.name && (
                <div className="mb-2 text-[13px] font-medium text-muted">{order.salesRep.user.name}</div>
              )}
              <div className="flex items-end justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-faint">
                    {order.status === 'SETTLED' ? 'Settled' : 'Deadline'}
                  </div>
                  <div className={`mt-0.5 text-[15px] font-semibold ${
                    order.status === 'SETTLED' ? 'text-emerald-400' : overdue ? 'text-rose-400' : 'text-foreground'}`}>
                    {order.status === 'SETTLED'
                      ? (order.settledAt ? formatDateTime(order.settledAt) : '—')
                      : formatDateTime(order.deadlineAt)}
                  </div>
                </div>
                {active && <Remaining hours={order.hoursRemaining} />}
              </div>

              {/* One line, and only when it matters. */}
              {active && overdue && (
                <p className="mt-2 rounded-lg bg-rose-500/10 px-3 py-2 text-[13px] text-rose-300">
                  Overdue · fine {formatCurrency(order.penaltyPerDay)} a day
                </p>
              )}
              {active && !overdue && order.extensionStatus === 'ACTIVE' && (
                <p className="mt-1.5 text-xs text-brand-600">Extension active · fine {formatCurrency(order.penaltyPerDay)} a day</p>
              )}

              <button type="button" onClick={() => setDetailsOpen((v) => !v)} aria-expanded={detailsOpen}
                className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-faint transition hover:text-muted">
                Details
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${detailsOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
              </button>

              {detailsOpen && (
                <div className="mt-2">
                  <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-faint">Issued</div>
                      <div className="mt-0.5 text-[13px] font-medium text-muted">{formatDateTime(order.issuedAt)}</div>
                    </div>
                    {active && (
                      <>
                        <div>
                          <div className="text-[10px] font-semibold uppercase tracking-wider text-faint">Extension</div>
                          <div className={`mt-0.5 text-[13px] font-medium ${
                            order.extensionStatus === 'ACTIVE' ? 'text-brand-600'
                              : order.extensionStatus === 'EXPIRED' ? 'text-rose-400' : 'text-muted'}`}>
                            {order.extensionStatus === 'ACTIVE' ? 'Active'
                              : order.extensionStatus === 'EXPIRED' ? 'Expired' : 'Not used'}
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] font-semibold uppercase tracking-wider text-faint">Late penalty</div>
                          <div className={`mt-0.5 text-[13px] font-medium ${order.extensionUsed ? 'text-rose-400' : 'text-muted'}`}>
                            {formatCurrency(order.penaltyPerDay)}/day
                          </div>
                        </div>
                      </>
                    )}
                  </div>

                  <DeadlineHistory order={order} />
                  {/* ZELab's own note. A rep has no use for a countdown of the
                      time that might be taken off his order. */}
                  {staff && order.canUndoDeadline && (
                    <p className="mt-2 text-[11px] leading-snug text-faint">
                      This can be taken back — the last lot returns the deadline to {formatDateTime(order.undoDeadlineTo)}
                      {order.undoAllCount > 1 ? `, or all ${order.undoAllCount} lots return it to ${formatDateTime(order.undoAllDeadlineTo)}` : ''}.
                    </p>
                  )}
                  {/* And why it cannot, when it cannot: the button simply going
                      missing reads as a bug. */}
                  {staff && !order.canUndoDeadline && order.undoDeadlineTo && order.finesCharged > 0 && (
                    <p className="mt-2 text-[11px] leading-snug text-faint">
                      This cannot be taken back — {order.finesCharged} fine{order.finesCharged !== 1 ? 's' : ''} already charged against this
                      deadline. Set a new deadline instead.
                    </p>
                  )}
                  {/* An order can be overdue while the fine only starts later. */}
                  {order.finesFrom && (
                    <p className="mt-2 text-[11px] leading-snug text-amber-400/80">
                      Daily fine runs from {formatDateTime(order.finesFrom)} — the time that was taken back is not charged.
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Pending-return warning */}
            {order.pendingReturns > 0 && (
              <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-400">
                <Clock className="h-4 w-4 shrink-0" />
                <span>{order.pendingReturns} return{order.pendingReturns !== 1 ? 's' : ''} waiting for approval</span>
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
                        {r.items.map((i, k) => (
                          <div key={k} className="mt-0.5 flex gap-2 text-xs text-faint">
                            <span title={i.productName} className="min-w-0 truncate">{i.productName}</span>
                            <span className="shrink-0">· {formatNumber(i.quantity)} {i.unitName || 'box'}(s)</span>
                          </div>
                        ))}
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
                <span>{order.pendingSubmissions} settlement{order.pendingSubmissions !== 1 ? 's' : ''} waiting for approval</span>
              </div>
            )}
            {staff && order.pendingSubmissionsList?.length > 0 && (
              <div className="space-y-2">
                {order.pendingSubmissionsList.map((p) => (
                  <div key={p.id} className="rounded-lg border border-sky-500/30 bg-sky-500/5 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-foreground">{p.submissionNumber} · {formatCurrency(p.amount)}</div>
                        <div className="mt-0.5 flex gap-2 text-xs text-faint">
                          <span title={p.productName} className="min-w-0 truncate">{p.productName}</span>
                          <span className="shrink-0">· {formatNumber(p.boxes)} box(es){p.method ? ` · ${p.method}` : ''}</span>
                        </div>
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

            {/* The boxes, as one picture: a ring (settled / returned / awaiting approval / left) with the
                number that matters in the middle, and the same figures as a legend. The same for one
                product or twelve; the per-product bars are in the list below. */}
            {order.order.totals.assignedBoxes > 0 && (() => {
              const t = order.order.totals;
              const done = t.remainingBoxes <= 0;
              const shown = done ? t.assignedBoxes : t.remainingBoxes;
              // Submitted but not yet approved, plus returns awaiting a decision, fitted into the
              // outstanding tail so the ring can never add up to more than the order.
              const subs = (order.pendingSubmissionsList || []).reduce((n, x) => n + (x.boxes || 0), 0);
              const pendS = Math.max(0, Math.min(subs, t.remainingBoxes));
              const pendR = Math.max(0, Math.min(t.pendingReturnBoxes || 0, t.remainingBoxes - pendS));
              const left = Math.max(0, t.remainingBoxes - pendS - pendR);
              // The legend adds up to the number in the middle: "Left" is every box that is not yet
              // settled or returned, INCLUDING the ones waiting for approval, which are said
              // underneath in amber (the same colour as their slice of the ring).
              const legend = [
                ['Settled', t.settledBoxes, 'bg-emerald-400', true, null],
                ['Returned', t.returnedBoxes, 'bg-sky-400', t.returnedBoxes > 0, null],
                [overdue ? 'Missing' : 'Left', t.remainingBoxes, overdue ? 'bg-rose-400' : 'bg-white/25', true,
                  [pendS > 0 ? `${formatNumber(pendS)} awaiting approval` : null, pendR > 0 ? `${formatNumber(pendR)} in a return` : null].filter(Boolean)],
              ].filter((r) => r[3]);
              return (
                <div className="flex items-center gap-5 border-t border-white/[0.06] pt-4">
                  <SettleDonut
                    total={t.assignedBoxes}
                    segments={[
                      { value: t.settledBoxes, color: '#34d399' },
                      { value: t.returnedBoxes, color: '#38bdf8' },
                      { value: pendS, color: '#fbbf24' },
                      { value: pendR, color: 'rgba(125,211,252,0.6)' },
                      { value: left, color: overdue ? '#fb7185' : 'rgba(255,255,255,0.14)' },
                    ]}
                  >
                    {/* Counted down rather than up (28 went out, 16 came back, 12 remain); an overdue
                        order does not count at all — a rose figure tumbling reads as boxes being lost. */}
                    <span aria-hidden="true">
                      <BoxCount
                        from={t.assignedBoxes}
                        to={shown}
                        still={overdue || done}
                        className={`text-2xl font-black leading-none ${done ? 'text-emerald-400' : overdue ? 'text-rose-400' : 'text-foreground'}`}
                      />
                    </span>
                    <span className="sr-only">{formatNumber(shown)} of {formatNumber(t.assignedBoxes)} boxes {done ? 'accounted for' : overdue ? 'missing' : 'left'}</span>
                    <span aria-hidden="true" className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-faint">
                      {done ? 'done' : overdue ? 'missing' : 'left'}
                    </span>
                  </SettleDonut>
                  <ul className="min-w-0 flex-1 space-y-2">
                    {legend.map(([label, value, dot, , notes]) => (
                      <li key={label}>
                        <div className="flex items-center gap-2 text-[13px]">
                          <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} aria-hidden="true" />
                          <span className="min-w-0 truncate text-muted">{label}</span>
                          <span className="ml-auto shrink-0 font-semibold tabular-nums text-foreground">{formatNumber(value)}</span>
                        </div>
                        {notes && notes.length > 0 && (
                          <p className="mt-0.5 pl-4 text-[11px] text-amber-400">{notes.join(' · ')}</p>
                        )}
                      </li>
                    ))}
                    <li className="pt-0.5 text-[11px] text-faint">of {formatNumber(t.assignedBoxes)} boxes</li>
                  </ul>
                </div>
              );
            })()}

            {/* Money picture — all derived from settled/returned boxes. Plain rows, not four tinted
                cards; a row for settled or returned money only once there is some. */}
            {(() => {
              const t = order.order.totals;
              const rows = [
                ['Order value', t.orderValue, 'text-foreground', true],
                ['Settled', t.settledValue, 'text-emerald-400', t.settledValue > 0],
                ['Returned', t.returnedValue, 'text-sky-300', t.returnedValue > 0],
                ['Outstanding', t.outstanding, t.outstanding > 0 ? 'text-rose-400' : 'text-muted', true],
              ].filter((r) => r[3]);
              return (
                <dl className="divide-y divide-white/[0.06] border-y border-white/[0.06]">
                  {rows.map(([label, value, tone]) => (
                    <div key={label} className="flex items-baseline justify-between gap-3 py-2.5">
                      <dt className="text-[13px] text-muted">{label}</dt>
                      <dd className={`text-[15px] font-semibold tabular-nums ${tone}`}>{formatCurrency(value)}</dd>
                    </div>
                  ))}
                </dl>
              );
            })()}

            {/* Box-by-box, per product. A five-column table on a 390px phone
                scrolls the product name off the left edge, so the header reads
                "SUED" and the numbers belong to nothing. One block per product
                with its own bar says the same thing and fits. */}
            <div>
              <div className="mb-1 flex items-baseline justify-between gap-3">
                <span className="text-sm font-semibold text-foreground">{order.order.lines.length === 1 ? 'Product' : 'Products'}</span>
                {order.order.totals.settledBoxes > 0 && (
                  <span className="text-xs text-muted">
                    Commission <span className="font-semibold text-brand-600">{formatCurrency(order.order.totals.commission)}</span>
                  </span>
                )}
              </div>
              {/* On a single-product order the box panel above already says everything but the NAME,
                  so that row is the name and what was issued. Several products each get a thin bar. */}
              <ul className="divide-y divide-white/[0.06]">
                {order.order.lines.map((l, n) => {
                  const single = order.order.lines.length === 1;
                  const total = Math.max(1, l.assigned);
                  const pct = (x) => `${Math.max(0, (x / total) * 100)}%`;
                  const awaiting = Math.min(pendingBoxesByProduct(order)[l.productId] || 0, Math.max(0, l.remaining));
                  const notes = [
                    l.returned > 0 ? `${formatNumber(l.returned)} returned` : null,
                    awaiting > 0 ? `${formatNumber(awaiting)} awaiting approval` : null,
                    (l.pendingReturn || 0) > 0 ? `+${formatNumber(l.pendingReturn)} return pending` : null,
                    overdue && l.remaining > 0 ? `${formatNumber(l.remaining)} missing` : null,
                  ].filter(Boolean);
                  return (
                    <li key={l.productId} className="py-2.5">
                      {/* The name has its own line and stays on it; the bar and "x of y" sit underneath. */}
                      <div className="flex items-center gap-3">
                        {!single && <span className="w-5 shrink-0 text-[11px] font-semibold tabular-nums text-faint">{n + 1}</span>}
                        <span title={l.name} className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">{l.name}</span>
                        {single && <span className="shrink-0 text-[11px] tabular-nums text-muted">{formatNumber(l.assigned)} issued</span>}
                      </div>
                      {!single && (
                        <div className="mt-1.5 flex items-center gap-3 pl-8">
                          <div className="flex h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-white/[0.07]">
                            <div className="bg-emerald-400" style={{ width: pct(l.settled) }} />
                            <div className="bg-sky-400" style={{ width: pct(l.returned) }} />
                            <div className="bg-amber-400" style={{ width: pct(awaiting) }} />
                          </div>
                          <span className="shrink-0 text-[11px] tabular-nums text-muted">{formatNumber(l.settled)} of {formatNumber(l.assigned)}</span>
                        </div>
                      )}
                      {!single && notes.length > 0 && (
                        <p className={`mt-1 pl-8 text-[11px] ${overdue && l.remaining > 0 ? 'text-rose-400' : 'text-muted'}`}>{notes.join(' · ')}</p>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>

            {/* Money in: one compact row per settlement, newest first, the latest three shown. Nothing
                settled yet is already said by the box panel above, so there is no empty section. */}
            {order.sales?.length > 0 && (
              <FoldedRows
                title="Settled"
                tone="text-emerald-400"
                rows={order.sales.map((s) => {
                  const boxes = (s.items || []).reduce((n, i) => n + (i.quantity || 0), 0);
                  const names = [...new Set((s.items || []).map((i) => i.product?.name).filter(Boolean))].join(', ');
                  return {
                    key: s.id,
                    left: `${formatNumber(boxes)} box${boxes === 1 ? '' : 'es'}`,
                    right: formatCurrency(s.total),
                    sub: [names, formatDate(s.soldAt), staff ? s.saleNumber : null].filter(Boolean).join(' · '),
                  };
                })}
              />
            )}

            {/* Boxes that came back. These used to disappear into a total the moment they were
                approved, with no way to see which ones. */}
            {order.returnsList?.length > 0 && (
              <FoldedRows
                title="Returned"
                tone="text-sky-300"
                rows={order.returnsList.map((r) => ({
                  key: r.id,
                  left: `${formatNumber(r.boxes)} box${r.boxes === 1 ? '' : 'es'} back`,
                  right: r.at ? formatDate(r.at) : '—',
                  sub: [r.items.map((i) => i.productName).filter(Boolean).join(', '), r.reason].filter(Boolean).join(' · '),
                }))}
              />
            )}
          </div>
        )}
      </Modal>

      {order && sub === 'settle' && <SettleBoxesModal order={order} onClose={() => setSub(null)} onDone={refresh} />}
      {order && sub === 'return' && <RecordReturnModal order={order} onClose={() => setSub(null)} onDone={refresh} />}
      {order && sub === 'extend' && <ExtendDeadlineModal order={order} onClose={() => setSub(null)} onDone={refresh} />}
      {order && sub === 'undo-deadline' && <UndoDeadlineModal order={order} onClose={() => setSub(null)} onDone={refresh} />}
      {order && sub === 'self-extend' && <SelfExtendModal order={order} onClose={() => setSub(null)} onDone={refresh} />}
      {rejectingReturn && <RejectReturnModal ret={rejectingReturn} onClose={() => setRejectingReturn(null)} onDone={refresh} />}
      {rejectingSubmission && <RejectSubmissionModal submission={rejectingSubmission} onClose={() => setRejectingSubmission(null)} onDone={refresh} />}
    </>
  );
}
