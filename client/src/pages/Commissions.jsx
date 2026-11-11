import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
} from 'recharts';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import BonusProgress from '@/components/BonusProgress';
import WalletCard from '@/components/WalletCard';
import { EarningsCard, BrandCard, SettlementCard, TopProductsCard, PayoutsCard, Ring } from '@/components/RepCharts';
import { Coins, Crown, TrendingUp, AlertTriangle, ShieldAlert, HeartHandshake, ShieldCheck } from 'lucide-react';
import api, { unwrap, apiError } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { ROLES, WITHDRAWAL_STATUS_META } from '@/lib/constants';
import { formatCurrency, formatNumber, formatDate, formatDateTime, sharePercents } from '@/lib/format';
import { PayoutHistory, earnedOn } from '@/components/WithdrawalNote';
import {
  PageHeader, Card, CardHeader, PageSpinner, EmptyState, Badge, Button, Modal, Field, Input, NumberInput, Textarea,
  Pagination, Select, Table, THead, TBody, TR, TH, TD,
} from '@/components/ui';
import DoneReceipt from '@/components/DoneReceipt';

// Requesting a payout used to be a bare number field over a green strip, and it
// ended in a four-word toast. It is the one moment in this app that is purely
// good news for the rep, so it now says what the money was earned on before it
// is asked for, and says well done afterwards — quietly, once, by name.
function WithdrawModal({ commission, firstName, onClose }) {
  const qc = useQueryClient();
  const available = Number(commission.available) || 0;
  const minWithdrawal = Number(commission.minWithdrawal) || 0;
  // Prefilled with the whole balance: that is what nearly every request is, and
  // an empty box asks the rep to do arithmetic to arrive at their own number.
  const [amount, setAmount] = useState(String(Math.floor(available)));
  // Where the money should go. A free-text note asked the rep to think of
  // something to say; what ZELab actually needs is an address to send to, and
  // what the rep needs is to be asked for it rather than to remember.
  const [via, setVia] = useState('mobile');
  const [payNumber, setPayNumber] = useState('');
  const [bank, setBank] = useState('');
  const [payName, setPayName] = useState('');
  const [done, setDone] = useState(null); // { amount, to }
  // The payout address, written as one line so it reads back plainly wherever
  // the notes are shown — the Payouts list, the ledger, the WhatsApp message.
  const payTo = via === 'mobile'
    ? `Mobile money · ${payNumber.trim()} · ${payName.trim()}`
    : `Bank · ${bank.trim()} · ${payNumber.trim()} · ${payName.trim()}`;

  const req = useMutation({
    mutationFn: () => api.post('/commissions/withdrawals', { amount: Number(amount), notes: payTo }),
    onSuccess: () => {
      setDone({ amount: Number(amount), to: payTo });
      ['commissions', 'dashboard'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    },
    onError: (e) => toast.error(apiError(e)),
  });
  const amt = Number(amount);
  // The same rule the server applies: the BALANCE must clear the minimum, the
  // amount need only be some of it. Mirrored here so the button never offers
  // something the API is about to refuse. And there is no point requesting
  // money without saying where it goes.
  const addressed = payNumber.trim().length >= 6 && payName.trim().length >= 2 && (via === 'mobile' || bank.trim());
  // The floor the server is actually enforcing right now — sent as one field so
  // the button cannot refuse what the API would accept, or offer what it would
  // refuse.
  const floor = Number(commission.emergencyFloor) || 0;
  const valid = amt > 0 && amt <= available && amt >= floor && addressed;

  if (done != null) {
    return (
      <Modal open onClose={onClose} title="Withdraw">
        {/* "Withdrawal successful" (Nino, 11 Nov 2026): where the money goes on two short lines (how and the
            number, then the name), and one line for when it arrives. It is still paid only after approval,
            which the small amber line under the title says. */}
        <DoneReceipt
          title="Withdrawal successful"
          amount={done.amount}
          detail={String(done.to || '').split(' · ').slice(0, 2).join(' · ')}
          onClose={onClose}
        />
      </Modal>
    );
  }

  return (
    <Modal open onClose={onClose} title="Withdraw from my wallet"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={req.isPending} disabled={!valid} onClick={() => req.mutate()}>Request {valid ? formatCurrency(amt) : 'withdrawal'}</Button></>}>
      <div className="space-y-4">
        <div className="relative overflow-hidden rounded-2xl bg-surface p-4 ring-1 ring-emerald-500/25">
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-emerald-500/[0.12] to-transparent" aria-hidden="true" />
          <div className="relative">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">Yours to withdraw</p>
            <p className="mt-1 text-2xl font-bold leading-none tabular-nums text-emerald-300">{formatCurrency(available)}</p>
            <p className="mt-1.5 text-[11px] text-faint">Earned on {earnedOn(commission)}.</p>
          </div>
        </div>
        <Field label="Amount" required hint={`Up to ${formatCurrency(available)} — take all of it, or leave some to build up`}>
          <NumberInput min="0" max={available} value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
        </Field>
        {amt > 0 && amt < available && (
          <button type="button" onClick={() => setAmount(String(Math.floor(available)))}
            className="cursor-pointer text-xs font-medium text-brand-600 hover:text-brand-600">
            Take the whole {formatCurrency(available)}
          </button>
        )}
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">How should we send it?</p>
          <div className="grid grid-cols-2 gap-2">
            {[
              { key: 'mobile', label: 'Mobile money' },
              { key: 'bank', label: 'Bank' },
            ].map((o) => (
              <button
                key={o.key}
                type="button"
                onClick={() => setVia(o.key)}
                className={`rounded-xl px-3 py-2.5 text-sm font-semibold ring-1 transition active:scale-[0.98] ${
                  via === o.key
                    ? 'bg-brand-500/15 text-brand-600 ring-brand-500/30'
                    : 'bg-elevated text-muted ring-white/[0.08] hover:text-foreground'
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>

          <div className="mt-3 space-y-3">
            {via === 'bank' && (
              <Field label="Which bank" required>
                <Input value={bank} onChange={(e) => setBank(e.target.value)} placeholder="e.g. CRDB, NMB" />
              </Field>
            )}
            <Field label={via === 'mobile' ? 'Phone number' : 'Account number'} required>
              <Input
                type="tel"
                inputMode="numeric"
                value={payNumber}
                onChange={(e) => setPayNumber(e.target.value)}
                placeholder={via === 'mobile' ? '0766 790 794' : '0150 1234 5678'}
              />
            </Field>

            {/* The money goes exactly where this says. Reading it back large
                is the only chance to catch a wrong digit, and the warning is
                what makes clear whose mistake it is — ZELab pays what it is
                told to pay and cannot pull it back afterwards. */}
            <Field label="Name on the account" required
              hint={via === 'mobile' ? 'The name that shows when the money is sent' : 'Exactly as the bank has it'}>
              <Input value={payName} onChange={(e) => setPayName(e.target.value)} placeholder={firstName || 'Full name'} />
            </Field>

            {payNumber.trim() && (
              <div className="rounded-xl bg-elevated/60 px-4 py-3 text-center ring-1 ring-white/[0.07]">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">Sending to</p>
                <p className="mt-1 font-mono text-xl font-bold tracking-wide text-foreground">{payNumber.trim()}</p>
                {payName.trim() && <p className="mt-0.5 text-sm font-semibold text-foreground">{payName.trim()}</p>}
                {via === 'bank' && bank.trim() && <p className="mt-0.5 text-xs text-muted">{bank.trim()}</p>}
              </div>
            )}

            <div className="flex gap-2.5 rounded-xl bg-amber-500/[0.07] px-3.5 py-3 ring-1 ring-amber-500/25">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
              <p className="text-[12px] leading-relaxed text-amber-200/90">
                Check the number and the name before you send this. ZELab pays exactly what you write here — if it
                is wrong the money goes to whoever owns that number, and <b className="text-amber-200">it cannot be
                brought back</b>. Getting it right is on you.
              </p>
            </div>
          </div>
        </div>

        <p className="text-xs text-faint">
          {floor > 0
            ? <>ZELab has opened this one for you, so your usual {formatCurrency(minWithdrawal)} minimum does not apply. It still has to be at least {formatCurrency(floor)}, and no more than you have.</>
            : <>ZELab reviews every request. The minimum balance to request one is {formatCurrency(minWithdrawal)}.</>}
        </p>
      </div>
    </Modal>
  );
}

// The same strip the Stock Requests page uses for pending approvals. A rep
// waiting on their money is the same kind of thing — someone stopped, waiting
// on a decision — so it sits at the top of the page rather than three tabs
// deep, and carries the detail the decision needs: who, how much, and the name
// and number they asked it to be sent to.
// Reject was one tap in all three places, and the rep is told at once that the request was not approved.
// It now asks this first, everywhere.
const rejectQuestion = (w) =>
  `Reject ${w.salesRep?.user?.name || 'this rep'}'s request for ${formatCurrency(w.amount)}? They will be told it was not approved, and the amount goes back into their balance.`;

function RejectWithdrawalModal({ w, busy, onConfirm, onClose }) {
  return (
    <Modal open onClose={busy ? () => {} : onClose} title="Reject this request?" footer={
      <>
        <Button variant="secondary" disabled={busy} onClick={onClose}>Cancel</Button>
        <Button variant="danger" loading={busy} onClick={onConfirm}>Yes, reject</Button>
      </>
    }>
      <p className="text-sm leading-snug text-foreground">{rejectQuestion(w)}</p>
    </Modal>
  );
}

// Opening a request. The table can only show a line; deciding one deserves the
// whole picture — who asked, how much, where they want it sent, what it leaves
// them with, and who decided it if someone already has.
function WithdrawalDetail({ w, balance, onClose, refresh }) {
  // Approving and then marking paid were two presses for one decision. There
  // was never a case where he approved and did not pay — the money leaves his
  // own pocket either way, and the balance already treated APPROVED and PAID
  // the same. So the one button goes straight to PAID, which is also the only
  // status that records the payment in the ledger.
  const decide = useMutation({
    mutationFn: (action) => api.post(`/commissions/withdrawals/${w.id}/decide`, { action, fromOwnPocket: action === 'PAY' }),
    onSuccess: (_r, action) => {
      toast.success(action === 'PAY' ? 'Paid — and recorded on the Commission account' : 'Request rejected');
      refresh();
      onClose();
    },
    onError: (e) => toast.error(apiError(e)),
  });

  // Reject asks once more before it goes: the rep is told at once that it was not approved.
  const [confirmReject, setConfirmReject] = useState(false);

  const meta = WITHDRAWAL_STATUS_META[w.status] || {};
  const pending = w.status === 'PENDING';
  const approved = w.status === 'APPROVED';

  return (
    <Modal open onClose={onClose} title={`${w.salesRep?.user?.name || 'Request'} · ${formatCurrency(w.amount)}`}>
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Badge className={meta.cls}>{meta.label || w.status}</Badge>
          <span className="ml-auto text-[11px] text-faint">Asked {formatDateTime(w.requestedAt)}</span>
        </div>

        {/* Where the money is meant to go — the reason to open this at all. */}
        <div className="rounded-xl bg-elevated/60 px-4 py-3 ring-1 ring-white/[0.07]">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">Send to</p>
          {w.notes ? (
            <p className="mt-1 break-words font-mono text-[15px] font-bold text-foreground">{w.notes}</p>
          ) : (
            <p className="mt-1 text-[13px] text-faint">
              No payout details on this one — it was asked for before the app collected them. Check with the rep before paying.
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-elevated/60 p-3 ring-1 ring-white/[0.07]">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-faint">Asking for</p>
            <p className="mt-1 text-xl font-bold tabular-nums text-emerald-400">{formatCurrency(w.amount)}</p>
          </div>
          <div className="rounded-xl bg-elevated/60 p-3 ring-1 ring-white/[0.07]">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-faint">Left after this</p>
            <p className="mt-1 text-xl font-bold tabular-nums text-foreground">
              {balance == null ? '—' : formatCurrency(Math.max(0, balance))}
            </p>
          </div>
        </div>

        {(w.decidedAt || w.paidAt) && (
          <div className="space-y-1 border-t border-white/[0.06] pt-3 text-[12px] text-muted">
            {w.decidedAt && (
              <p>Decided {formatDateTime(w.decidedAt)}{w.decidedBy?.name ? ` by ${w.decidedBy.name}` : ''}</p>
            )}
            {w.paidAt && <p className="text-emerald-400">Paid {formatDateTime(w.paidAt)}</p>}
          </div>
        )}

        {pending && !confirmReject && (
          <div className="grid grid-cols-2 gap-2">
            <Button className="justify-center py-2.5" loading={decide.isPending} onClick={() => decide.mutate('PAY')}>
              <ShieldCheck className="h-4 w-4" /> Approve &amp; pay
            </Button>
            <Button variant="secondary" className="justify-center py-2.5 text-rose-400"
              disabled={decide.isPending} onClick={() => setConfirmReject(true)}>
              Reject
            </Button>
          </div>
        )}
        {pending && confirmReject && (
          <div className="space-y-3 rounded-xl bg-rose-500/[0.06] p-3 ring-1 ring-rose-500/20">
            <p className="text-[13px] leading-snug text-foreground">{rejectQuestion(w)}</p>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" className="justify-center py-2.5" disabled={decide.isPending} onClick={() => setConfirmReject(false)}>
                Cancel
              </Button>
              <Button variant="danger" className="justify-center py-2.5" loading={decide.isPending} onClick={() => decide.mutate('REJECT')}>
                Yes, reject
              </Button>
            </div>
          </div>
        )}
        {approved && (
          <Button className="w-full justify-center py-2.5" loading={decide.isPending} onClick={() => decide.mutate('PAY')}>
            <Coins className="h-4 w-4" /> Mark paid — from my pocket
          </Button>
        )}
        {pending && !confirmReject && (
          <p className="text-[11px] leading-snug text-faint">
            One press marks it paid from your own pocket, records it on the Commission account and tells the rep it
            has been paid. Send the money first.
          </p>
        )}
      </div>
    </Modal>
  );
}

function PendingWithdrawalsStrip({ items, refresh, onOpen }) {
  const [rejecting, setRejecting] = useState(null);
  const decide = useMutation({
    mutationFn: ({ id, action }) => api.post(`/commissions/withdrawals/${id}/decide`, { action, fromOwnPocket: action === 'PAY' }),
    onSuccess: (_r, v) => {
      toast.success(v.action === 'PAY' ? 'Paid — and recorded on the Commission account' : 'Request rejected');
      refresh();
    },
    onError: (e) => toast.error(apiError(e)),
  });

  if (!items.length) return null;

  return (
    <Card className="mb-5 !border-amber-500/30">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Coins className="h-4 w-4 text-amber-400" />
        <h2 className="text-sm font-bold text-foreground">Commission requests</h2>
        <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-bold text-amber-400">{items.length}</span>
        <span className="ml-auto hidden text-xs text-faint sm:block">One press pays it, from your own pocket</span>
      </div>
      <div className="divide-y divide-border">
        {items.map((w) => {
          const busy = decide.isPending && decide.variables?.id === w.id;
          return (
            <div key={w.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <button type="button" onClick={() => onOpen?.(w)} className="min-w-[13rem] flex-1 text-left" title="Open to see the details">
                <div className="text-sm font-semibold text-foreground">
                  {w.salesRep?.user?.name}{w.salesRep?.code ? ` (${w.salesRep.code})` : ''} · {formatCurrency(w.amount)}
                </div>
                {/* Where they asked it to go. This is the line to read. */}
                {w.notes && <div className="mt-0.5 font-mono text-xs text-amber-300">{w.notes}</div>}
                <div className="mt-0.5 text-xs text-faint">{formatDateTime(w.requestedAt)}</div>
              </button>
              <div className="flex shrink-0 gap-2 max-sm:w-full max-sm:justify-end">
                <Button variant="ghost" className="text-rose-400" disabled={busy}
                  onClick={() => setRejecting(w)}>Reject</Button>
                <Button loading={busy} onClick={() => decide.mutate({ id: w.id, action: 'PAY' })}>
                  <ShieldCheck className="h-4 w-4" /> Approve &amp; pay
                </Button>
              </div>
            </div>
          );
        })}
      </div>
      {rejecting && (
        <RejectWithdrawalModal
          w={rejecting}
          busy={decide.isPending}
          onClose={() => setRejecting(null)}
          onConfirm={() => decide.mutate({ id: rejecting.id, action: 'REJECT' }, { onSettled: () => setRejecting(null) })}
        />
      )}
    </Card>
  );
}

function PenaltyBreakdown({ breakdown }) {
  if (!breakdown?.length) return null;
  // Plain rows on the page, no card and no table (Nino, 11 Nov 2026: the Fines tab too should sit on the
  // galaxy like the others). Only reps see this; the owner's fines are the table in FinesHistory.
  return (
    <section className="mt-6 px-1">
      <h3 className="text-sm font-semibold text-foreground">Fines by order</h3>
      <p className="mt-0.5 text-xs text-muted">Taken from your wallet balance.</p>
      <ul className="mt-2 divide-y divide-white/[0.06]">
        {breakdown.map((p) => {
          // A manual deduction has no order, no days and no rate; an order fined only for a late return
          // (0 days) has no daily rate. Only a late order still open and not paused keeps accruing.
          const days = Number(p.daysOverdue) || 0;
          const status = p.closed ? 'Order closed'
            : p.exemptPendingReturn ? 'Paused — return under review'
              : days > 0 ? 'Still accruing daily' : null;
          return (
            <li key={p.settlementId} className="flex items-start justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="text-[15px] font-semibold text-foreground">{p.settlementNumber}</p>
                <p className="mt-0.5 text-xs text-muted">
                  {!p.settlementId ? 'Deduction by ZELab'
                    : days > 0 ? `${days} ${days === 1 ? 'day' : 'days'} overdue · ${formatCurrency(p.penaltyPerDay)} a day`
                      : 'Return delay fine'}
                </p>
                {p.settlementId && status && (
                  <p className={clsx('mt-0.5 text-xs', p.closed ? 'text-emerald-400' : p.exemptPendingReturn ? 'text-sky-400' : 'text-rose-300')}>
                    {status}
                  </p>
                )}
              </div>
              <p className="shrink-0 text-[15px] font-semibold tabular-nums text-rose-300">−{formatCurrency(p.totalPenalty)}</p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// Forgive one fine: keeps the record, returns the money to the rep's balance.
function ForgiveModal({ penalty, onClose }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const waive = useMutation({
    mutationFn: () => api.post(`/penalties/${penalty.id}/waive`, { reason: reason || undefined }),
    onSuccess: () => {
      toast.success(`Fine forgiven — ${formatCurrency(penalty.amount)} returned to ${penalty.salesRep?.user?.name || 'the rep'}`);
      ['penalties', 'commissions', 'dashboard'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      onClose();
    },
    onError: (e) => toast.error(apiError(e)),
  });
  return (
    <Modal open onClose={onClose} title="Forgive this fine?" footer={
      <>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button loading={waive.isPending} onClick={() => waive.mutate()}>
          <HeartHandshake className="h-4 w-4" /> Forgive — return {formatCurrency(penalty.amount)}
        </Button>
      </>
    }>
      <div className="space-y-3 text-sm">
        <p>
          <b>{penalty.salesRep?.user?.name}</b> · {formatCurrency(penalty.amount)} fine on order{' '}
          <b>{penalty.settlement?.settlementNumber || '—'}</b> ({formatDateTime(penalty.appliedAt)}).
        </p>
        <p className="text-muted">
          The fine stays on record as “Forgiven”, but the {formatCurrency(penalty.amount)} goes back into the rep's
          commission balance immediately. This only affects this one transaction.
        </p>
        <Field label="Reason" hint="Optional — shown in the audit log">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. order was cancelled — fine applied by mistake" />
        </Field>
      </div>
    </Modal>
  );
}

// Permanent fine transactions (Commission/Wallet history). Each row is a real
// deduction record, like any other financial transaction.
// canForgive: only the owner forgives (the server refuses staff), so staff see the fines without the button.
function FinesHistory({ admin, canForgive = admin }) {
  const [forgiving, setForgiving] = useState(null);
  const [showForgiven, setShowForgiven] = useState(false);
  const [page, setPage] = useState(1);
  const [forgivenPage, setForgivenPage] = useState(1);
  // The fines still charged and the forgiven ones are asked for separately. One page of both, newest
  // first, left older applied fines unloaded — and this table is the only place a fine can be forgiven.
  const { data } = useQuery({
    queryKey: ['penalties', admin ? 'all' : 'mine', 'APPLIED', page],
    queryFn: async () => unwrap(await api.get('/penalties', { params: { status: 'APPLIED', limit: 50, page } })),
    placeholderData: keepPreviousData, // turning a page keeps the table on screen until the next one arrives
  });
  const { data: forgivenData } = useQuery({
    queryKey: ['penalties', 'all', 'WAIVED', forgivenPage],
    queryFn: async () => unwrap(await api.get('/penalties', { params: { status: 'WAIVED', limit: 50, page: forgivenPage } })),
    enabled: Boolean(admin && showForgiven),
    placeholderData: keepPreviousData,
  });
  // Forgiving the last fine on a later page leaves that page empty: step back to one that has rows.
  // (Only once the page has loaded: while it loads there is no answer yet, and that is not "no rows".)
  const lastPage = data?.meta ? Math.max(1, data.meta.totalPages || 1) : page;
  useEffect(() => { if (page > lastPage) setPage(lastPage); }, [page, lastPage]);
  // A forgiven fine is settled business. Showing dozens of them first buried the
  // handful still costing someone money, so they are collapsed by default.
  const active = (data?.data || []).filter((p) => p.status !== 'WAIVED');
  const forgiven = showForgiven ? (forgivenData?.data || []) : [];
  // Counted by the server over the whole table, not from the page on screen.
  const activeCount = data?.meta?.counts?.applied ?? active.length;
  const forgivenCount = data?.meta?.counts?.waived ?? 0;
  if (!activeCount && !(admin && forgivenCount)) return null;
  const kindLabel = (p) => (p.kind === 'ADJUSTMENT' ? 'Deduction' : p.kind === 'EXPIRY_FINE' ? 'Return Delay Fine (24h)' : 'Late Settlement Fine');
  if (!admin) {
    // The rep's own history: plain rows on the page — what, which order and when on the left, the amount
    // on the right. (Forgiven fines are hidden here, as before; only the owner can show them.)
    return (
      <section className="mt-9 px-1">
        <h3 className="text-sm font-semibold text-foreground">Fine history</h3>
        <p className="mt-0.5 text-xs text-muted">
          {activeCount ? `${activeCount} fine${activeCount !== 1 ? 's' : ''} still reducing your balance.` : 'Nothing is reducing your balance now.'}
        </p>
        <ul className="mt-2 divide-y divide-white/[0.06]">
          {active.map((p) => (
            <li key={p.id} className="flex items-start justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="text-[13px] text-foreground">{kindLabel(p)}</p>
                <p className="mt-0.5 text-xs text-muted">
                  {p.settlement?.settlementNumber ? `${p.settlement.settlementNumber} · ` : ''}{formatDateTime(p.appliedAt)}
                </p>
              </div>
              <p className="shrink-0 text-sm font-semibold tabular-nums text-rose-300">−{formatCurrency(p.amount)}</p>
            </li>
          ))}
        </ul>
        {data?.meta?.totalPages > 1 && (
          <Pagination page={page} totalPages={data.meta.totalPages} total={activeCount} onChange={setPage} />
        )}
      </section>
    );
  }
  // Badge takes no title, so the forgiven reason sits on a span round it (hover to read it).
  const statusBadge = (p) => (p.status === 'WAIVED'
    ? <span title={p.waiveReason || undefined}><Badge className="bg-emerald-500/15 text-emerald-300">Forgiven</Badge></span>
    : <Badge className="bg-rose-500/15 text-rose-300">Applied</Badge>);
  const dateLine = (p) => (p.status === 'WAIVED' && p.waivedAt
    ? `${formatDateTime(p.appliedAt)} · forgiven ${formatDateTime(p.waivedAt)}`
    : formatDateTime(p.appliedAt));
  // On a phone Type and Order move under the rep, Status and Date under the amount, so a 390 px screen
  // shows the whole fine (and its Forgive) without scrolling sideways. Below xl the order sits under the
  // type, so a 1024 px screen keeps Forgive inside the card.
  const head = (
    <THead><TR>{admin && <TH>Rep</TH>}<TH className="hidden sm:table-cell">Type</TH><TH className="hidden xl:table-cell">Order</TH><TH className="text-right">Amount</TH><TH className="hidden sm:table-cell">Status</TH><TH className="hidden sm:table-cell">Date</TH>{admin && <TH />}</TR></THead>
  );
  const row = (p) => {
    const waived = p.status === 'WAIVED';
    return (
      <TR key={p.id}>
        {admin && (
          <TD className="font-medium">
            {p.salesRepId
              ? <Link to={`/reps/${p.salesRepId}`} className="hover:underline">{p.salesRep?.user?.name}</Link>
              : p.salesRep?.user?.name}
            <div className="mt-0.5 whitespace-normal text-[11px] font-normal text-muted sm:hidden">
              {kindLabel(p)}
              {p.settlement?.settlementNumber && <span className="block whitespace-nowrap text-faint">{p.settlement.settlementNumber}</span>}
            </div>
          </TD>
        )}
        <TD className="hidden sm:table-cell">
          {kindLabel(p)}
          {p.settlement?.settlementNumber && (
            <div className="mt-0.5 text-[11px] text-faint xl:hidden" title={p.notes || undefined}>{p.settlement.settlementNumber}</div>
          )}
        </TD>
        <TD className="hidden text-faint xl:table-cell" title={p.notes || undefined}>{p.settlement?.settlementNumber || '—'}</TD>
        <TD className="text-right">
          <span className={`font-semibold tabular-nums ${waived ? 'text-faint line-through' : 'text-rose-300'}`}>−{formatCurrency(p.amount)}</span>
          <div className="mt-1 flex flex-col items-end gap-0.5 text-[11px] text-faint sm:hidden">
            {statusBadge(p)}
            <span className="mt-0.5 whitespace-nowrap">{formatDateTime(p.appliedAt)}</span>
            {waived && p.waivedAt && <span className="whitespace-nowrap">forgiven {formatDateTime(p.waivedAt)}</span>}
          </div>
        </TD>
        <TD className="hidden sm:table-cell">{statusBadge(p)}</TD>
        <TD className="hidden text-faint sm:table-cell">{dateLine(p)}</TD>
        {admin && (
          <TD>
            {!waived && canForgive && (
              <button
                onClick={() => setForgiving(p)}
                className="inline-flex items-center gap-1 rounded-lg bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-600 transition hover:bg-emerald-500/20"
              >
                <HeartHandshake className="h-3.5 w-3.5" /> Forgive
              </button>
            )}
          </TD>
        )}
      </TR>
    );
  };
  return (
    <Card className="mt-5">
      <CardHeader
        title="Penalty transactions"
        subtitle={activeCount
          ? `${activeCount} fine${activeCount !== 1 ? 's' : ''} still reducing a balance.`
          : 'Nothing is currently reducing anyone’s balance.'}
        action={admin && forgivenCount > 0 && (
          <Button variant="ghost" className="text-xs" onClick={() => setShowForgiven((v) => !v)}>
            {showForgiven ? 'Hide forgiven' : `Show ${forgivenCount} forgiven`}
          </Button>
        )} />
      {active.length > 0 && (
        <Table>
          {head}
          <TBody>{active.map(row)}</TBody>
        </Table>
      )}
      {data?.meta?.totalPages > 1 && (
        <Pagination page={page} totalPages={data.meta.totalPages} total={activeCount} onChange={setPage} />
      )}
      {showForgiven && (
        <div className="border-t border-border">
          <p className="px-5 pb-1 pt-4 text-xs font-semibold text-muted">Forgiven</p>
          {!forgivenData ? (
            <p className="px-5 py-3 text-xs text-faint">Loading…</p>
          ) : (
            <>
              <Table>
                {head}
                <TBody>{forgiven.map(row)}</TBody>
              </Table>
              {forgivenData.meta?.totalPages > 1 && (
                <Pagination page={forgivenPage} totalPages={forgivenData.meta.totalPages} total={forgivenCount} onChange={setForgivenPage} />
              )}
            </>
          )}
        </div>
      )}
      {forgiving && <ForgiveModal penalty={forgiving} onClose={() => setForgiving(null)} />}
    </Card>
  );
}

// The rules as a small table, not sentences and not big numbers (Nino, 11 Nov 2026: "cool, but it feels too
// much — make it better arranged"). The two situations run down the side, three columns across, and the
// column headings carry the words so every cell is just a plain figure. Straight on the page.
const FINE_COLS = 'grid-cols-[4.75rem_repeat(3,minmax(0,1fr))]';

function FineRow({ label, time, daily, late, first }) {
  return (
    <div className={clsx('grid items-baseline gap-x-2 py-3.5', FINE_COLS, !first && 'border-t border-white/[0.06]')}>
      <p className="text-xs text-muted">{label}</p>
      <p className="text-[15px] font-semibold tabular-nums text-foreground">{time}</p>
      <p className="text-[15px] font-semibold tabular-nums text-foreground">{daily}</p>
      <p className="text-[15px] font-semibold tabular-nums text-foreground">{late}</p>
    </div>
  );
}

function PenaltyPolicyCard() {
  return (
    <section className="mt-9 px-1">
      <h2 className="text-xs font-medium text-muted">Fines <span className="text-faint">· TZS</span></h2>
      <div className={clsx('mt-4 grid gap-x-2 text-[10.5px] leading-tight text-faint', FINE_COLS)}>
        <span />
        <span>Time</span>
        <span>Fine a day</span>
        <span>Late return</span>
      </div>
      <div className="mt-2 border-t border-white/[0.06]">
        <FineRow first label="Normal" time="72 hours" daily="10,000" late="15,000" />
        <FineRow label="Extension" time="+96 hours" daily="20,000" late="30,000" />
      </div>
      {/* What the table means, one short line per row (Nino, 11 Nov 2026: "explain the rule a bit — if you
          take a box you have 72 hours to settle, if not this fine applies; very simple, clear, not too many
          words, same style"). The words sit under the same first column as the table so they line up. */}
      <dl className="mt-5 grid grid-cols-[4.75rem_minmax(0,1fr)] gap-x-2 gap-y-3 text-[12px] leading-relaxed text-muted [text-wrap:pretty]">
        <dt className="text-faint">Normal</dt>
        <dd>
          <span className="block">Settle within <b className="font-medium text-foreground">72 hours</b> of taking boxes.</span>
          <span className="block">If not, the Fine a day applies until it is settled.</span>
        </dd>
        <dt className="text-faint">Extension</dt>
        <dd>
          <span className="block">Once per order: <b className="font-medium text-foreground">96 more hours</b>, no fine.</span>
          <span className="block">After that, the higher Fine a day applies.</span>
        </dd>
        <dt className="text-faint">Return</dt>
        <dd>
          <span className="block">Complete a return within <b className="font-medium text-foreground">24 hours</b>.</span>
          <span className="block">If not, the Late return fine applies.</span>
        </dd>
      </dl>
    </section>
  );
}

// What a box is worth today, per brand. Orders keep the rate that was in force
// when they were CREATED, so this describes new orders only.
function RatesCard({ rates }) {
  if (!rates?.perBrand?.length) return null;
  return (
    <section className="mt-6 px-1">
      <h2 className="text-xs font-medium text-muted">You earn per box</h2>
      <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-4">
        {rates.perBrand.map((r) => (
          <div key={r.brand} className="min-w-0">
            <p className="text-[11px] text-muted">{r.brand}</p>
            <p className="mt-0.5 text-[17px] font-semibold tabular-nums text-emerald-300">{formatCurrency(r.perBox)}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

// How far the rep is from the withdrawal minimum.
function WithdrawalProgress({ available, minimum }) {
  const pct = Math.max(0, Math.min(100, (available / minimum) * 100));
  const short = Math.max(0, minimum - available);
  return (
    <div className="mt-3 rounded-lg border border-white/10 bg-white/5 p-3">
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-faint">Progress to withdrawal</span>
        <span className="font-medium text-body">{formatCurrency(Math.max(0, available))} / {formatCurrency(minimum)}</span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full bg-emerald-400 transition-all" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-2 text-xs text-faint">
        {short > 0 ? `${formatCurrency(short)} to go before you can request a withdrawal.` : 'You can request a withdrawal now.'}
      </p>
    </div>
  );
}

// An empty tab, said quietly on the page: a small icon, a title, one line. No card, no circle round the
// icon (Nino, 11 Nov 2026: the same galaxy background as every other tab).
function QuietEmpty({ icon: Icon, title, text }) {
  return (
    <div className="mt-16 px-1 text-center">
      <Icon className="mx-auto h-6 w-6 text-emerald-400/80" aria-hidden="true" />
      <p className="mt-3 text-sm font-medium text-foreground">{title}</p>
      <p className="mt-1 text-xs text-muted">{text}</p>
    </div>
  );
}

function RepView() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('overview');
  const { data: insights } = useQuery({ queryKey: ['commissions', 'me', 'insights'], queryFn: async () => unwrap(await api.get('/commissions/me/insights')).data });
  const { data: c, isLoading } = useQuery({ queryKey: ['commissions', 'me'], queryFn: async () => unwrap(await api.get('/commissions/me')).data });
  const { data: wd } = useQuery({ queryKey: ['commissions', 'withdrawals', 'mine'], queryFn: async () => unwrap(await api.get('/commissions/withdrawals', { params: { limit: 20 } })) });
  const { data: bonusProgress } = useQuery({ queryKey: ['bonus', 'me'], queryFn: async () => unwrap(await api.get('/commissions/bonus/me')).data });

  if (isLoading || !c) return <PageSpinner />;

  const hasPenalties = c.penalties > 0;
  const balanceNegative = c.available < 0;
  // The server's own answer, not a second copy of the rule — otherwise a rep
  // with an open window would be told he cannot withdraw by the very button
  // the window exists to unlock.
  const canWithdraw = c.eligible ?? (c.available >= c.minWithdrawal);
  const windowOpen = Boolean(c.emergency?.open);
  const pct = c.minWithdrawal > 0
    ? Math.max(0, Math.min(100, (Math.max(0, c.available) / c.minWithdrawal) * 100))
    : 0;
  const withdrawals = wd?.data || [];
  const pendingCount = withdrawals.filter((w) => w.status === 'PENDING').length;
  const firstName = user?.name?.split(' ')[0] || '';
  // The headline above answers "what is my balance". The note answers "where
  // has my request got to" — a different number and a different question, so it
  // only appears once there IS a request. Printing the balance twice on one
  // screen is exactly what the owner threw out last time.

  return (
    <>
      {/* The balance is the one number this page exists for, so it is a small
          wallet card: balance, Withdraw, how far to the minimum, and the three
          supporting figures, all in one place. The live request is not repeated
          here — it is in the payouts list with its own status. */}
      <WalletCard
        balance={formatCurrency(c.available)}
        negative={balanceNegative}
        canWithdraw={canWithdraw}
        pct={pct}
        stats={[
          { label: 'Earned', value: formatCurrency(c.earned) },
          { label: 'Paid out', value: formatCurrency(c.paid) },
          hasPenalties
            ? { label: 'Fines', value: formatCurrency(c.penalties), tone: 'rose' }
            : { label: 'Pending', value: formatCurrency(c.pendingRequests) },
        ]}
        onWithdraw={() => setOpen(true)}
      />

      {/* The two rare states that need a sentence get it HERE, as one quiet line under
          the card — the card itself stays figures only. No box, no icon: a dot
          and a coloured line. */}
      {balanceNegative && (
        <p className="mt-2 flex items-center gap-1.5 px-1 text-[11px] text-rose-300">
          <span aria-hidden="true" className="h-1 w-1 shrink-0 rounded-full bg-current" />
          {/* Blame the fines only when they explain the whole deficit — a claw-back can take it below zero too. */}
          {c.penalties > 0 && c.available + c.penalties >= 0
            ? 'Negative balance from overdue fines'
            : 'Negative balance — new commission pays it off first'}
        </p>
      )}
      {windowOpen && (
        <p className="mt-2 flex items-center gap-1.5 px-1 text-[11px] text-amber-300">
          <span aria-hidden="true" className="h-1 w-1 shrink-0 rounded-full bg-current" />
          Withdrawal open for you until {formatDateTime(c.emergency.until)}
        </p>
      )}

      {/* Four stacked sections became four tabs. The page was a single scroll
          through everything at once; now it opens on one thing. */}
      <SectionTabs
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'overview', label: 'Overview' },
          { key: 'bonus', label: 'Bonus' },
          { key: 'withdrawals', label: 'Payouts', count: pendingCount },
          { key: 'fines', label: 'Fines' },
          { key: 'rules', label: 'Rules' },
        ]}
      />

      {tab === 'overview' && (
        <div className="mt-6 space-y-9">
          {!insights ? (
            <PageSpinner />
          ) : (
            <>
              <EarningsCard insights={insights} />
              <SettlementCard insights={insights} />
              <BrandCard insights={insights} />
              <TopProductsCard insights={insights} />
            </>
          )}
        </div>
      )}

      {tab === 'bonus' && (
        bonusProgress?.configured
          ? <div className="mt-4"><BonusProgress p={bonusProgress} /></div>
          : <QuietEmpty icon={TrendingUp} title="No bonus running" text="Nothing to chase right now." />
      )}

      {tab === 'withdrawals' && (
        <div className="mt-6 space-y-9">
          <PayoutsCard items={withdrawals} />
          {/* Plain rows on the page, no card and no box per request: how much, when, and a coloured
              word for what happened. The date says PAID when it was paid — the one thing a rep opens
              this list to check. */}
          <section className="px-1">
            <h3 className="text-sm font-semibold text-foreground">My withdrawals</h3>
            <p className="mt-0.5 text-xs text-muted">Minimum {formatCurrency(c.minWithdrawal)}</p>
            {!withdrawals.length ? (
              <p className="mt-4 text-sm text-muted">No withdrawals yet. Settle boxes and the first request will appear here.</p>
            ) : (
              <div className="mt-2"><PayoutHistory flat items={withdrawals} /></div>
            )}
          </section>
        </div>
      )}

      {tab === 'fines' && (
        hasPenalties ? (
          <>
            <PenaltyBreakdown breakdown={c.penaltyBreakdown} />
            <FinesHistory admin={false} />
          </>
        ) : (
          <QuietEmpty icon={ShieldCheck} title="No fines" text="Nothing is reducing your balance." />
        )
      )}

      {tab === 'rules' && (
        <>
          <RatesCard rates={c.rates} />
          <PenaltyPolicyCard />
        </>
      )}

      {open && <WithdrawModal commission={c} firstName={firstName} onClose={() => setOpen(false)} />}
    </>
  );
}

function DeductModal({ reps, onClose }) {
  const qc = useQueryClient();
  const [salesRepId, setSalesRepId] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const rep = reps.find((r) => r.salesRepId === salesRepId);

  const deduct = useMutation({
    mutationFn: () => api.post('/penalties/adjust', { salesRepId, amount: Number(amount), reason }),
    onSuccess: () => {
      toast.success(`${formatCurrency(Number(amount))} deducted from ${rep?.name || 'the rep'}'s commission`);
      ['commissions', 'penalties', 'dashboard'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      onClose();
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const valid = salesRepId && Number(amount) > 0 && reason.trim();
  return (
    <Modal open onClose={onClose} title="Deduct commission" footer={
      <>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button loading={deduct.isPending} disabled={!valid} onClick={() => deduct.mutate()}>
          Deduct {Number(amount) > 0 ? formatCurrency(Number(amount)) : ''}
        </Button>
      </>
    }>
      <div className="space-y-4">
        <Field label="Sales rep" required>
          <Select value={salesRepId} onChange={(e) => setSalesRepId(e.target.value)}>
            <option value="">Select rep…</option>
            {reps.map((r) => <option key={r.salesRepId} value={r.salesRepId}>{r.name} — available {formatCurrency(r.available)}</option>)}
          </Select>
        </Field>
        <Field label="Amount to deduct" required hint={rep ? `${rep.name} currently has ${formatCurrency(rep.available)} available` : undefined}>
          <NumberInput min="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Reason" required hint="Shown to the rep and kept in the record">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Commission removed by ZELab" />
        </Field>
        <p className="text-xs text-faint">
          This removes the amount from the rep's available balance only — future commission keeps accruing normally.
          The deduction appears in Penalty transactions and can be reversed with Forgive.
        </p>
      </div>
    </Modal>
  );
}

// One section at a time. The page had grown to four stacked tables and a wall
// of forgiven fines, which buried the balances everyone actually opens it for.
function SectionTabs({ value, onChange, tabs }) {
  // Plain words on a hairline, the active one underlined in red — no boxed bar,
  // no filled pill (Nino, 10 Nov 2026: no big shapes for small things).
  return (
    <div
      role="tablist"
      className="mt-4 flex items-stretch justify-between gap-4 overflow-x-auto border-b border-border px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {tabs.map((t) => {
        const on = value === t.key;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(t.key)}
            className={clsx(
              // 44px tall to hit on a phone, though only the words and the line show.
              'relative -mb-px flex min-h-[44px] shrink-0 items-center whitespace-nowrap text-[13px] font-medium transition-colors sm:text-sm',
              on
                ? 'text-foreground after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:rounded-full after:bg-brand-500'
                : 'text-muted hover:text-foreground',
            )}
          >
            {t.label}
            {t.count != null && t.count > 0 && (
              <span className="ml-1.5 text-[11px] font-semibold text-brand-600">{t.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ── Admin: commission rates ──────────────────────────────────────────────────
// Rates are added, never edited. A new rate must start in the future, which is
// what guarantees a settled box can never be re-priced — so the form offers a
// start date rather than an "edit" button, and says why.
// canEdit: only the owner adds or removes a rate (the server refuses staff); staff see the rates only.
function CommissionRateSettings({ canEdit }) {
  const qc = useQueryClient();
  const [brandId, setBrandId] = useState('');
  const [perBox, setPerBox] = useState('');
  const [from, setFrom] = useState('');

  const { data: rates = [] } = useQuery({
    queryKey: ['commission-rates'],
    queryFn: async () => unwrap(await api.get('/commissions/rates')).data,
  });
  const { data: brands = [] } = useQuery({
    queryKey: ['brands'],
    queryFn: async () => unwrap(await api.get('/brands')).data,
  });

  const add = useMutation({
    mutationFn: () => api.post('/commissions/rates', {
      brandId: brandId || null,
      perBox: Number(perBox),
      effectiveFrom: new Date(from).toISOString(),
    }),
    onSuccess: () => {
      toast.success('New rate saved');
      setPerBox(''); setFrom('');
      ['commission-rates', 'commissions'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const remove = useMutation({
    mutationFn: (id) => api.delete(`/commissions/rates/${id}`),
    onSuccess: () => {
      toast.success('Rate removed');
      qc.invalidateQueries({ queryKey: ['commission-rates'] });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const now = Date.now();
  const valid = Number(perBox) > 0 && from && new Date(from).getTime() > now;

  return (
    <Card className="mt-5">
      <CardHeader title="Commission rates" subtitle="What one settled box earns, per brand." />
      {canEdit && (
      <div className="grid grid-cols-1 gap-3 border-b border-border p-4 sm:grid-cols-4">
        <Field label="Brand" hint="Leave blank for all other brands">
          <Select value={brandId} onChange={(e) => setBrandId(e.target.value)}>
            <option value="">All other brands</option>
            {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        </Field>
        <Field label="Commission per box" required>
          <NumberInput min="0" value={perBox} onChange={(e) => setPerBox(e.target.value)} placeholder="5000" />
        </Field>
        <Field label="Starts" required hint="Must be in the future">
          <Input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <div className="flex items-end">
          <Button className="w-full" loading={add.isPending} disabled={!valid} onClick={() => add.mutate()}>Save rate</Button>
        </div>
      </div>
      )}
      <Table>
        <THead><TR><TH>Brand</TH><TH className="text-right">Per box</TH><TH>Starts</TH><TH>Note</TH><TH /></TR></THead>
        <TBody>
          {rates.map((r) => {
            const starts = new Date(r.effectiveFrom);
            const future = starts.getTime() > now;
            return (
              <TR key={r.id}>
                <TD className="font-medium text-foreground">{r.brand?.name || 'All other brands'}</TD>
                <TD className="text-right font-semibold">{formatCurrency(r.perBox)}</TD>
                <TD className={future ? 'text-amber-400' : 'text-muted'}>
                  {starts.getFullYear() < 2000 ? 'From the beginning' : formatDateTime(starts)}
                  {future && ' · not yet in force'}
                </TD>
                <TD className="text-faint">{r.note || '—'}</TD>
                <TD>
                  {/* Only a rate that has not priced anything yet can be taken back. */}
                  {canEdit && future && (
                    <Button variant="ghost" className="px-2 py-1 text-xs text-rose-600" onClick={() => remove.mutate(r.id)}>Remove</Button>
                  )}
                </TD>
              </TR>
            );
          })}
        </TBody>
      </Table>
      <p
        className="px-5 py-3 text-xs text-faint"
        title="A rate can only start in the future, and rates already in force cannot be edited or removed. That is what keeps settled commission fixed: every box is paid at the rate that was in force when its order was created."
      >
        New rates start in the future; a rate in force is fixed.
      </p>
    </Card>
  );
}

// ── Admin: sales bonus ───────────────────────────────────────────────────────
// canEdit: only the owner sets rules and pays bonuses (the server refuses staff); staff see the figures only.
function BonusSettings({ canEdit }) {
  const qc = useQueryClient();
  const [target, setTarget] = useState('');
  const [amount, setAmount] = useState('');
  const [from, setFrom] = useState('');
  // When set, the form edits that rule instead of creating another one.
  const [editingId, setEditingId] = useState(null);

  // datetime-local wants local wall time, not an ISO string with a zone.
  const toLocalInput = (d) => {
    const dt = new Date(d);
    const off = dt.getTimezoneOffset() * 60000;
    return new Date(dt.getTime() - off).toISOString().slice(0, 16);
  };
  const startEdit = (r) => {
    setEditingId(r.id);
    setTarget(String(r.salesTarget));
    setAmount(String(r.bonusAmount));
    setFrom(toLocalInput(r.effectiveFrom));
  };
  const cancelEdit = () => { setEditingId(null); setTarget(''); setAmount(''); setFrom(''); };

  const { data: rules = [] } = useQuery({ queryKey: ['bonus-rules'], queryFn: async () => unwrap(await api.get('/commissions/bonus/rules')).data });
  const { data: progress } = useQuery({ queryKey: ['bonus-summary'], queryFn: async () => unwrap(await api.get('/commissions/bonus/summary')).data });
  const { data: awards = [] } = useQuery({ queryKey: ['bonus-awards'], queryFn: async () => unwrap(await api.get('/commissions/bonus/awards')).data });

  const refresh = () => ['bonus-rules', 'bonus-summary', 'bonus-awards'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

  const add = useMutation({
    mutationFn: () => api.post('/commissions/bonus/rules', {
      salesTarget: Number(target), bonusAmount: Number(amount),
      effectiveFrom: from ? new Date(from).toISOString() : new Date().toISOString(),
    }),
    onSuccess: () => { toast.success('Bonus rule saved'); cancelEdit(); refresh(); },
    onError: (e) => toast.error(apiError(e)),
  });
  const edit = useMutation({
    mutationFn: () => api.patch(`/commissions/bonus/rules/${editingId}`, {
      salesTarget: Number(target), bonusAmount: Number(amount),
      effectiveFrom: from ? new Date(from).toISOString() : undefined,
    }),
    onSuccess: () => { toast.success('Bonus rule updated'); cancelEdit(); refresh(); },
    onError: (e) => toast.error(apiError(e)),
  });
  const toggle = useMutation({
    mutationFn: ({ id, isActive }) => api.patch(`/commissions/bonus/rules/${id}/active`, { isActive }),
    onSuccess: () => { refresh(); }, onError: (e) => toast.error(apiError(e)),
  });
  const pay = useMutation({
    mutationFn: ({ salesRepId, bonusRuleId }) => api.post('/commissions/bonus/pay', { salesRepId, bonusRuleId }),
    onSuccess: () => { toast.success('Bonus paid'); refresh(); },
    onError: (e) => toast.error(apiError(e)),
  });

  const valid = Number(target) > 0 && Number(amount) > 0;
  return (
    <Card className="mt-5">
      <CardHeader title="Sales bonus" subtitle="Reach a sales target, earn a bonus — separate from box commission." />
      {canEdit && (
      <div className="grid grid-cols-1 gap-3 border-b border-border p-4 sm:grid-cols-4">
        <Field label="Sales target" required><NumberInput min="0" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="10000000" /></Field>
        <Field label="Bonus amount" required><NumberInput min="0" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="500000" /></Field>
        <Field label="Counts sales from" hint="Blank means straight away"><Input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <div className="flex items-end gap-2">
          {editingId ? (
            <>
              <Button className="flex-1" loading={edit.isPending} disabled={!valid} onClick={() => edit.mutate()}>Update</Button>
              <Button variant="secondary" onClick={cancelEdit}>Cancel</Button>
            </>
          ) : (
            <Button className="w-full" loading={add.isPending} disabled={!valid} onClick={() => add.mutate()}>Save bonus rule</Button>
          )}
        </div>
      </div>
      )}

      <Table>
        <THead><TR><TH>Target</TH><TH className="text-right">Bonus</TH><TH>Starts</TH><TH>Awards</TH><TH /></TR></THead>
        <TBody>
          {rules.map((r) => (
            <TR key={r.id}>
              <TD className="font-medium text-foreground">{formatCurrency(r.salesTarget)}</TD>
              <TD className="text-right font-semibold text-emerald-500">{formatCurrency(r.bonusAmount)}</TD>
              <TD className="text-muted">{formatDateTime(r.effectiveFrom)}</TD>
              <TD>{r._count?.awards ?? 0}</TD>
              <TD>
                {canEdit && (
                <div className="flex justify-end gap-1">
                  {/* Figures are only editable while nothing has been earned under them. */}
                  {(r._count?.awards ?? 0) === 0 && (
                    <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => startEdit(r)}>Edit</Button>
                  )}
                  <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => toggle.mutate({ id: r.id, isActive: !r.isActive })}>
                    {r.isActive ? 'Switch off' : 'Switch on'}
                  </Button>
                </div>
                )}
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>

      {!!progress?.items?.length && (
        <>
          <CardHeader title="Rep progress" subtitle="Against the rule in force now." />
          <Table>
            <THead><TR><TH>Rep</TH><TH className="text-right">Sales this run</TH><TH>Next tier</TH><TH>Progress</TH><TH>Can take</TH><TH /></TR></THead>
            <TBody>
              {progress.items.filter((i) => i.configured).map((i) => (
                <TR key={i.salesRepId}>
                  <TD className="font-medium text-foreground">{i.name}</TD>
                  <TD className="text-right">{formatCurrency(i.sales)}</TD>
                  <TD className="text-muted">{i.next ? `${formatCurrency(i.next.target)} → ${formatCurrency(i.next.bonusAmount)}` : 'all tiers reached'}</TD>
                  <TD>
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-white/10">
                        <div className={clsx('h-full rounded-full', i.claimable ? 'bg-emerald-400' : 'bg-sky-400/80')} style={{ width: `${Math.min(100, i.progress)}%` }} />
                      </div>
                      <span className="text-xs text-muted">{i.progress}%</span>
                    </div>
                  </TD>
                  <TD>
                    {i.claimable
                      ? <Badge className="bg-emerald-500/15 text-emerald-300">{formatCurrency(i.claimable.bonusAmount)}</Badge>
                      : <span className="text-xs text-faint">{formatCurrency(i.remaining)} to go</span>}
                  </TD>
                  <TD>
                    <div className="flex justify-end gap-1">
                      {/* Every tier they have passed can be paid — the rep may have
                          chosen to hold out, so the choice stays open here too. */}
                      {canEdit && (i.tiers || []).filter((t) => t.reached).map((t) => (
                        <Button
                          key={t.ruleId}
                          className="px-2 py-1 text-xs"
                          loading={pay.isPending}
                          onClick={() => pay.mutate({ salesRepId: i.salesRepId, bonusRuleId: t.ruleId })}
                        >
                          Pay {formatCurrency(t.bonusAmount)}
                        </Button>
                      ))}
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </>
      )}

      {!!awards.length && (
        <>
          <CardHeader title="Bonuses earned" />
          <Table>
            <THead><TR><TH>Rep</TH><TH className="text-right">Bonus</TH><TH>Paid</TH><TH>Status</TH><TH className="text-right">Run total</TH></TR></THead>
            <TBody>
              {awards.map((a) => (
                <TR key={a.id}>
                  <TD className="font-medium text-foreground">{a.salesRep?.user?.name || a.salesRep?.code}</TD>
                  <TD className="text-right font-semibold text-emerald-500">{formatCurrency(a.bonusAmount)}</TD>
                  <TD className="text-muted">{a.paidAt ? formatDateTime(a.paidAt) : formatDateTime(a.unlockedAt)}</TD>
                  <TD><Badge className={a.status === 'PAID' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'}>{a.status}</Badge></TD>
                  <TD className="text-right text-xs text-faint">{formatCurrency(a.qualifyingSales)} sold</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </>
      )}
      <p
        className="px-5 py-3 text-xs text-faint"
        title="Bonus money never enters a rep's commission balance and never changes what a box is worth — it is paid on its own. Sales count from the date set above, so moving that date back counts selling the reps have already done. A rule can be edited freely until someone earns it; after that the terms are fixed and a new rule replaces it."
      >
        Paid on its own, never into the balance · editable until someone earns it.
      </p>
    </Card>
  );
}

// ── Admin: the picture at a glance ───────────────────────────────────────────
// Nino, 11 Nov 2026: "it should feel nice like the rep's Wallet — nice cards, nice progress, how each one is
// performing, the pies, the tables". The rep's own pieces (the wallet card, the progress rows, the rings)
// told for the whole business, in the admin's neutral glass: colour lives on the figures, the chips and the
// bars; red only on fines and the main buttons.

// Chart colours without the house red, so a slice never reads as an alarm.
const PIE = ['#34d399', '#38bdf8', '#a78bfa', '#fbbf24', '#f472b6', '#2dd4bf', '#94a3b8', '#fb923c'];
const AXIS = { fontSize: 11, fill: '#94a3b8' };
const compactNumber = (v) => formatNumber(v, { compact: true });
const clampPct = (n) => Math.max(0, Math.min(100, Number.isFinite(n) ? n : 0));

// A small figure: a muted label over a bold number, the way the wallet card shows its three.
function Fig({ label, value, sub, tone, title, className }) {
  return (
    <div className={clsx('min-w-0', className)} title={title}>
      <dt className="truncate text-[11px] text-muted xl:text-xs">{label}</dt>
      <dd className={clsx('mt-0.5 whitespace-nowrap text-[14px] font-semibold leading-tight tabular-nums', tone || 'text-foreground')}>{value}</dd>
      {sub && <dd className="mt-0.5 truncate text-[11px] text-muted">{sub}</dd>}
    </div>
  );
}

// A signed amount with a real minus sign (formatCurrency prints a hyphen), so fines and an overdrawn
// balance read the same everywhere on the page.
const minusCurrency = (n) => `−${formatCurrency(Math.abs(Number(n) || 0))}`;
const signedCurrency = (n) => (Number(n) < 0 ? minusCurrency(n) : formatCurrency(n));

// The business's wallet: what the reps can take out today, how much of what they earned has been paid,
// and the fines — the rep's wallet card, told for everyone, on neutral glass (no red-lit card on admin).
// `wide`: on the tabs without the payout chart it runs the full width — from lg the figures sit beside the
// balance, and from xl the buttons join that row too. The row wraps rather than overlaps if figures grow.
function BusinessWallet({ totals, items = [], wide = false, isAdmin, applying, onApply, onDeduct }) {
  const earned = Number(totals.earned) || 0;
  const paid = Number(totals.paid) || 0;
  const paidPct = earned > 0 ? clampPct((paid / earned) * 100) : 0;
  // The server's Available adds up only balances above zero, so a rep paid ahead of what he earned is
  // named here: earned − paid − fines − requested + overdrawn is then exactly the figure above.
  const overdrawn = items.filter((i) => (Number(i.available) || 0) < 0);
  const overdrawnSum = overdrawn.reduce((sum, i) => sum + Number(i.available), 0);
  const fines = Number(totals.penalties) || 0;
  return (
    <section className={clsx('stat-glass flex flex-col p-5', wide && 'lg:flex-row lg:flex-wrap lg:items-center lg:gap-x-8')}>
      {/* Two hair-thin arcs, as on the rep's wallet card: decoration only, behind everything. */}
      <svg aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 h-full w-full" viewBox="0 0 360 220" preserveAspectRatio="none">
        <path d="M-10 190 C 100 110, 240 70, 380 120" fill="none" stroke="rgba(255,255,255,.06)" strokeWidth="1" />
        <path d="M-10 218 C 120 140, 250 108, 380 156" fill="none" stroke="rgba(255,255,255,.04)" strokeWidth="1" />
      </svg>
      <div className={clsx(wide && 'lg:w-[22rem] lg:shrink-0')}>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-medium text-white/60">Available to withdraw</p>
            {/* "Total pending" was earned − paid, which still contained fines the reps will never receive — this
                is the money actually withdrawable. */}
            <p className="mt-2 whitespace-nowrap text-[28px] font-bold leading-none tabular-nums text-foreground sm:text-[32px]">
              {formatCurrency(totals.available ?? totals.pending)}
            </p>
            <p className={clsx('mt-1.5 text-[11px]', totals.requested > 0 ? 'font-medium text-amber-300' : 'text-muted')}>
              {totals.requested > 0 ? `+ ${formatCurrency(totals.requested)} requested` : 'after fines & payouts'}
            </p>
          </div>
          {overdrawn.length > 0 && (
            <dl className="shrink-0 pt-0.5 text-right">
              <Fig
                label="Overdrawn"
                value={minusCurrency(overdrawnSum)}
                tone="text-rose-300"
                sub={overdrawn.length === 1 ? `${overdrawn[0].name} · not counted` : `${overdrawn.length} reps · not counted`}
                title={`Below zero, so left out of Available: ${overdrawn.map((i) => `${i.name} ${minusCurrency(i.available)}`).join(', ')}`}
              />
            </dl>
          )}
        </div>

        <div className="mt-5">
          <div className="flex items-baseline justify-between gap-3 text-[11px]">
            <span className="text-muted">Paid out of earned</span>
            <span className="font-semibold tabular-nums text-emerald-300">{Math.round(paidPct)}%</span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
            <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-300 transition-[width] duration-700 ease-out" style={{ width: `${paidPct}%` }} />
          </div>
        </div>
      </div>

      <dl className={clsx('mt-5 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4', wide ? 'lg:mt-0 lg:flex-1 lg:grid-cols-2 xl:grid-cols-4' : 'lg:grid-cols-2 2xl:grid-cols-4')}>
        <Fig label="Earned · all time" value={formatCurrency(totals.earned)} />
        <Fig label="Paid out" value={formatCurrency(totals.paid)} tone="text-emerald-300" />
        <Fig label="Fines" value={fines > 0 ? minusCurrency(fines) : formatCurrency(0)} tone={fines > 0 ? 'text-rose-300' : undefined} />
        <Fig
          label="This run"
          value={`${formatNumber(totals.runBoxes ?? 0)} boxes`}
          sub={`${formatCurrency(totals.runEarned ?? 0)} earned`}
          title="Since each rep's last payout"
        />
      </dl>

      {isAdmin && (
        <div className={clsx('mt-auto pt-5', wide && 'lg:mt-0 lg:basis-full xl:basis-52 xl:shrink-0 xl:pt-0')}>
          <div className={clsx('grid grid-cols-2 gap-2 border-t border-white/[0.06] pt-4', wide && 'xl:grid-cols-1 xl:border-l xl:border-t-0 xl:pl-6 xl:pt-0')}>
            <Button variant="secondary" className="justify-center px-2 text-xs" loading={applying} onClick={onApply}>
              <AlertTriangle className="hidden h-4 w-4 shrink-0 min-[400px]:block" /> Apply daily penalties
            </Button>
            <Button variant="secondary" className="justify-center px-2 text-xs" onClick={onDeduct}>
              <Coins className="hidden h-4 w-4 shrink-0 min-[400px]:block" /> Deduct commission
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

function PaidTip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-md">
      <div className="mb-0.5 font-semibold text-foreground">{label}</div>
      <div className="text-muted">{formatCurrency(row.amount)} paid out</div>
      <div className="text-faint">{row.count} payout{row.count === 1 ? '' : 's'}</div>
    </div>
  );
}

// Paid out, month by month — the rep's "Paid out" bars, for everyone. Built from the withdrawals list
// (PAID, or APPROVED from before approving meant paying, as the server's own Paid counts them), in East
// Africa time. It waits for the 200-row list rather than drawing from the 30 newest and then changing.
// The list is newest-requested first and capped at 200: when more exist and the oldest one loaded is still
// inside the six months, older payouts in the window were not loaded, and the subtitle says so.
function PayoutTrend({ items, loading, hasMore }) {
  const eatMonth = (d) => { const t = new Date(new Date(d).getTime() + 3 * 3600e3); return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}`; };
  const now = new Date(Date.now() + 3 * 3600e3);
  const windowStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1) - 3 * 3600e3;
  const oldestRequested = (items || []).reduce((m, w) => Math.min(m, new Date(w.requestedAt).getTime()), Infinity);
  const capped = Boolean(hasMore) && oldestRequested >= windowStart;
  const months = [];
  for (let k = 5; k >= 0; k -= 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - k, 1));
    months.push({ key: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`, label: d.toLocaleString('en', { month: 'short', timeZone: 'UTC' }), amount: 0, count: 0 });
  }
  for (const w of items || []) {
    if (w.status !== 'PAID' && w.status !== 'APPROVED') continue;
    const m = months.find((x) => x.key === eatMonth(w.paidAt || w.decidedAt || w.requestedAt));
    if (m) { m.amount += Number(w.amount) || 0; m.count += 1; }
  }
  const total = months.reduce((s, m) => s + m.amount, 0);
  const count = months.reduce((s, m) => s + m.count, 0);
  const best = months.reduce((b, m) => (m.amount > (b?.amount || 0) ? m : b), null);
  return (
    <section className="card flex flex-col p-5">
      <h3 className="text-sm font-semibold text-foreground">Paid out</h3>
      <p className={clsx('mt-0.5 text-xs', capped ? 'text-amber-300' : 'text-muted')}>
        {capped ? `Last 6 months · latest ${formatNumber(items.length)} payouts` : 'Last 6 months'}
      </p>
      {loading ? (
        <p className="my-auto py-10 text-center text-xs text-muted">Loading payouts…</p>
      ) : count === 0 ? (
        <p className="my-auto py-10 text-center text-xs text-muted">No payouts in the last 6 months.</p>
      ) : (
        <>
          <dl className="mt-4 flex flex-wrap justify-between gap-x-4 gap-y-3 sm:justify-start sm:gap-x-10">
            <Fig label="Paid" value={formatCurrency(total)} tone="text-emerald-300" />
            <Fig label="Payouts" value={formatNumber(count)} />
            {best && <Fig label={`Best month · ${best.label}`} value={formatCurrency(best.amount)} />}
          </dl>
          <div className="mt-4 min-h-[150px] flex-1">
            <ResponsiveContainer width="100%" height="100%" minHeight={150}>
              <BarChart data={months} margin={{ top: 6, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} />
                <YAxis tick={AXIS} tickLine={false} axisLine={false} tickFormatter={compactNumber} width={46} />
                <Tooltip content={<PaidTip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                <Bar dataKey="amount" radius={[6, 6, 0, 0]} maxBarSize={38}>
                  {months.map((m) => <Cell key={m.key} fill="#34d399" fillOpacity={best && m.key === best.key ? 0.95 : 0.5} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </section>
  );
}

// A ring and its legend in one glass card: the share of each part, the amount on the right. It fills its
// grid cell and centres the ring, so short legends never leave a blank half-card. `twoCol` lays a long
// legend in two columns while the card spans a full row (md–lg).
function ShareCard({ title, said, rows, center, centerUnit, twoCol = false }) {
  const total = rows.reduce((sum, r) => sum + r.value, 0);
  return (
    <section className="card flex h-full flex-col p-5">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {said && <p className="mt-0.5 text-xs text-muted">{said}</p>}
      <div className="my-auto flex items-center gap-5 pt-4">
        <Ring size={112} stroke={12} total={total} segments={rows.map((r) => ({ value: r.value, color: r.color }))}>
          <span className="text-base font-bold leading-none tabular-nums text-foreground">{center}</span>
          {centerUnit && <span className="mt-1 max-w-[76px] truncate text-[10px] font-semibold uppercase tracking-wide text-faint">{centerUnit}</span>}
        </Ring>
        {/* Two columns read down, then across, so the ranking still runs top to bottom. */}
        <ul
          className={clsx('grid min-w-0 flex-1 grid-cols-1 gap-y-2', twoCol && 'md:grid-flow-col md:grid-cols-2 md:gap-x-8 xl:grid-flow-row xl:grid-cols-1')}
          style={twoCol ? { gridTemplateRows: `repeat(${Math.ceil(rows.length / 2)}, auto)` } : undefined}
        >
          {rows.map((r) => (
            <li key={r.label} className="flex items-center gap-2 text-[13px]">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: r.color }} aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-muted">{r.label}</span>
                {r.sub && <span className="block whitespace-nowrap text-[11px] leading-snug text-faint">{r.sub}</span>}
              </span>
              <span className="shrink-0 text-right">
                <span className={clsx('block font-semibold tabular-nums', r.tone || 'text-foreground')}>{r.shown}</span>
                {r.subRight && <span className="block whitespace-nowrap text-[11px] leading-snug text-faint">{r.subRight}</span>}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

// Who earns the commission, all time — one slice per rep. Shares by largest remainder, so they add to 100.
function EarnedByRep({ items, className }) {
  const rows = items
    .map((i) => ({ name: i.name, earned: Math.max(0, Number(i.earned) || 0) }))
    .filter((r) => r.earned > 0)
    .sort((a, b) => b.earned - a.earned);
  if (!rows.length) return null;
  const total = rows.reduce((sum, r) => sum + r.earned, 0);
  const shares = sharePercents(rows.map((r) => r.earned), total);
  return (
    <div className={className}>
      <ShareCard
        title="Who earns it"
        said={`${rows[0].name} has earned ${shares[0]}% of it, all time.`}
        center={compactNumber(total)}
        centerUnit="TSh"
        twoCol={rows.length > 3}
        rows={rows.map((r, n) => ({
          label: r.name, sub: `${shares[n]}%`, value: r.earned, shown: formatCurrency(r.earned), color: PIE[n % PIE.length],
        }))}
      />
    </div>
  );
}

// Brands take colours from the far end of the palette, so a brand never wears a rep's colour beside it.
const BRAND_PIE = ['#2dd4bf', '#fb923c', '#94a3b8', '#fbbf24', '#f472b6', '#a78bfa', '#38bdf8', '#34d399'];

// Where it comes from — the box commission by brand, added up over every rep. The centre is the top
// brand's share, the rep's own wording, so the two rings never read as the same chart twice.
function EarnedByBrand({ items }) {
  const byBrand = new Map();
  for (const i of items) {
    for (const b of i.earnedByBrand || []) {
      const r = byBrand.get(b.brand) || { brand: b.brand, amount: 0, boxes: 0 };
      r.amount += Number(b.amount) || 0;
      r.boxes += Number(b.boxes) || 0;
      byBrand.set(b.brand, r);
    }
  }
  const rows = [...byBrand.values()].filter((r) => r.amount > 0).sort((a, b) => b.amount - a.amount);
  if (!rows.length) return null;
  const total = rows.reduce((sum, r) => sum + r.amount, 0);
  const shares = sharePercents(rows.map((r) => r.amount), total);
  return (
    <ShareCard
      title="Where it comes from"
      said={rows.length > 1 ? `${rows[0].brand} brings ${shares[0]}% of it, all time.` : `All of it from ${rows[0].brand}, all time.`}
      center={`${shares[0]}%`}
      centerUnit={rows[0].brand}
      rows={rows.map((r, n) => ({
        label: r.brand, sub: `${shares[n]}%`, subRight: `${formatNumber(r.boxes)} boxes`, value: r.amount, shown: formatCurrency(r.amount), color: BRAND_PIE[n % BRAND_PIE.length],
      }))}
    />
  );
}

// How the orders get settled — the rep's "Settlement record" ring, for everyone (/settlements/analytics).
function SettlementRecord({ a, className }) {
  const o = a?.onTime;
  if (!o || !(o.decided + o.liveOrders > 0)) return null;
  const late = Math.max(0, o.decided - o.inside);
  const overdue = o.currentlyLate || 0;
  const open = Math.max(0, (o.liveOrders || 0) - overdue);
  const rows = [
    { label: 'Settled on time', value: o.inside, color: '#34d399' },
    { label: 'Settled late', value: late, color: '#fbbf24' },
    { label: 'Still open', value: open, color: '#38bdf8' },
    { label: 'Overdue', value: overdue, color: '#fb7185', tone: overdue > 0 ? 'text-rose-300' : undefined },
  ].filter((r) => r.value > 0).map((r) => ({ ...r, shown: formatNumber(r.value) }));
  return (
    <div className={className}>
      <ShareCard
        title="Settlement record"
        said={o.decided ? `${formatNumber(o.inside)} of ${formatNumber(o.decided)} closed orders settled on time.` : 'No order closed yet.'}
        center={o.decided ? `${Math.round(o.rate)}%` : formatNumber(o.liveOrders)}
        centerUnit={o.decided ? 'on time' : 'open'}
        rows={rows}
      />
    </div>
  );
}

// The sales bonus as a bar with a notch per tier. Drawn against the TOP tier, never the next one: the
// server's own `progress` tracks the next unreached tier, so a bar built from it would fall from 99% to
// 67% the moment a rep crossed a tier — shrinking exactly when he did well. Against the top tier it only
// ever rises. The figures under it are the same as before: what he has sold, what is already earned, and
// the distance to the next bonus with the money it unlocks (never beside a target it does not belong to).
// That caption leads with the server's own % to the next tier — the figure Rates & bonus shows — so the
// two tabs never give two answers; the bar's scale is named beside the amount ("of" the top target).
function BonusBar({ b, sharedStart }) {
  const tiers = b.tiers || [];
  const top = tiers.reduce((m, t) => Math.max(m, Number(t.target) || 0), 0);
  const pct = top > 0 ? clampPct((Number(b.sales) / top) * 100) : 0;
  const won = b.claimable;
  const next = b.next;
  // Once one rep has been paid a bonus the runs diverge, and each card states its own start instead.
  const ownStart = sharedStart == null && b.cycleStart;
  return (
    <div className="mt-3 border-t border-white/[0.06] pt-3">
      <div className="flex items-baseline justify-between gap-3 text-[11px]">
        <span className="shrink-0 text-muted">Sold toward bonus</span>
        <span className="min-w-0 truncate text-right">
          <span className="text-[13px] font-semibold tabular-nums text-foreground">{formatCurrency(b.sales)}</span>
          {top > 0 && <span className="tabular-nums text-faint"> of {formatCurrency(top)}</span>}
        </span>
      </div>
      <div className="relative mt-1.5">
        <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
          <div className={clsx('h-full rounded-full transition-[width] duration-700 ease-out', won ? 'bg-emerald-400' : 'bg-sky-400/80')} style={{ width: `${pct}%` }} />
        </div>
        {top > 0 && tiers.map((t) => (
          <span
            key={t.ruleId}
            title={`Sell ${formatCurrency(t.target)} → ${formatCurrency(t.bonusAmount)}`}
            className={clsx('absolute top-1/2 h-2.5 w-[2px] -translate-y-1/2 rounded-full', t.reached ? 'bg-emerald-200' : 'bg-white/35')}
            style={{ left: `calc(${Math.min(100, ((Number(t.target) || 0) / top) * 100)}% - 1px)` }}
          />
        ))}
      </div>
      <div className="mt-1.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-[11px]">
        {won && <span className="font-semibold text-emerald-300">{formatCurrency(won.bonusAmount)} earned</span>}
        {next && (
          <span className="text-muted">
            <span className="font-semibold tabular-nums text-sky-300">{next.progress}%</span> · {formatCurrency(next.remaining)} more → {formatCurrency(next.bonusAmount)}
          </span>
        )}
        {!next && !won && <span className="text-muted">no target set</span>}
        {ownStart && <span className="text-faint">from {formatDate(b.cycleStart)}</span>}
      </div>
    </div>
  );
}

// One card per rep: who, what he can take out today and how far that is from his withdrawal minimum,
// the run in progress (or his lifetime), the sales bonus, and how reliably he settles.
//
// The minimum is a FLOOR, not a target — nobody is made to withdraw when they reach it — so past the line
// the bar simply says he can withdraw. It is quoted from the rep's OWN minimum (a setting that can differ
// per rep): when everyone is on the same one it is named once, under the cards.
function RepCard({ i, runView, leads, bonus, sharedMin, sharedStart, onTime }) {
  const run = i.run || {};
  const offCommission = i.earnsCommission === false;
  const avail = Number(i.available) || 0;
  const carried = runView ? wholeShillings(run.broughtForward) : 0;
  const fines = runView ? (run.penalties || 0) : (Number(i.penalties) || 0);
  const min = Number(i.minWithdrawal) || 0;
  const showMin = !offCommission && min > 0;
  const ready = showMin && avail >= min;
  const minPct = showMin ? clampPct((Math.max(0, avail) / min) * 100) : 0;
  const rate = onTime && onTime.decided > 0 ? Math.round(onTime.onTimeRate) : null;
  // Every rep's run starts on their own date, so the card says which date it is measuring from.
  const since = [
    offCommission && 'not on commission',
    !offCommission && !run.since && 'never withdrawn',
    run.since && `since ${formatDate(run.since)}`,
  ].filter(Boolean).join(' · ');
  return (
    <article className="stat-glass flex flex-col p-3.5 sm:p-4">
      <header className="flex items-start gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-sm font-semibold text-white/80 ring-1 ring-inset ring-white/10 sm:h-9 sm:w-9" aria-hidden="true">
          {String(i.name || '?').trim().charAt(0).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <Link to={`/reps/${i.salesRepId}`} className={clsx('truncate text-[15px] font-semibold hover:underline', leads ? 'text-amber-300' : 'text-foreground')}>
              {i.name}
            </Link>
            {leads && <Crown className="h-3.5 w-3.5 shrink-0 text-amber-300" aria-label="Most earned this run" />}
          </div>
          <p className="mt-0.5 truncate text-[11px] text-faint">{runView ? since : (i.code || '')}</p>
        </div>
        {rate != null && (
          <span
            title={`${formatNumber(onTime.decided)} closed orders`}
            className={clsx(
              'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ring-1 ring-inset',
              rate >= 80 ? 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/25'
                : rate >= 50 ? 'bg-amber-500/10 text-amber-300 ring-amber-500/25'
                  : 'bg-rose-500/10 text-rose-300 ring-rose-500/25',
            )}
          >
            {rate}% on time
          </span>
        )}
      </header>

      <div className="mt-3 flex items-end justify-between gap-3 sm:mt-4">
        <div className="min-w-0">
          <p className="text-[11px] text-muted">Available</p>
          <p className={clsx('mt-1 whitespace-nowrap text-[22px] font-bold leading-none tabular-nums', avail < 0 ? 'text-rose-300' : 'text-foreground')}>
            {signedCurrency(avail)}
          </p>
        </div>
        <div className="min-w-0 text-right text-[11px] leading-snug">
          {/* What the balance was already carrying when this run opened, so that earned − fines + this
              always comes to the figure beside it. */}
          {carried !== 0 && <p className="text-faint">{carried > 0 ? '+' : '−'}{formatCurrency(Math.abs(carried))} brought forward</p>}
          {i.pendingRequests > 0 && <p className="font-medium text-amber-300">{formatCurrency(i.pendingRequests)} requested</p>}
        </div>
      </div>

      {showMin && (
        <div className="mt-3">
          <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
            <div className={clsx('h-full rounded-full transition-[width] duration-700 ease-out', ready ? 'bg-emerald-400' : 'bg-emerald-400/50')} style={{ width: `${minPct}%` }} />
          </div>
          <p className="mt-1.5 text-[11px]">
            {ready
              ? <span className="font-semibold text-emerald-300">can withdraw</span>
              : <span className="text-muted">{formatCurrency(min - avail)} to the {sharedMin ? 'minimum' : `${formatCurrency(min)} minimum`}</span>}
          </p>
        </div>
      )}

      <dl className={clsx('mt-3 grid gap-3 border-t border-white/[0.06] pt-3 sm:mt-4', runView ? 'grid-cols-3' : 'grid-cols-2')}>
        {runView ? (
          <>
            <Fig label="Boxes this run" value={formatNumber(run.boxes || 0)} />
            <Fig label="Fines" value={fines > 0 ? minusCurrency(fines) : '—'} tone={fines > 0 ? 'text-rose-300' : 'text-faint'} />
            <Fig label="Last paid" value={run.lastPayout ? formatCurrency(run.lastPayout.amount) : '—'} tone={run.lastPayout ? undefined : 'text-faint'} />
          </>
        ) : (
          <>
            <Fig
              label="Earned"
              // An agreed one-off adjustment makes lifetime Earned differ from boxes × rate — say so, or the
              // arithmetic looks broken.
              value={<>{formatCurrency(i.earned)}{Number(i.adjustment) !== 0 && <span className="ml-0.5 cursor-help text-amber-400">*</span>}</>}
              title={Number(i.adjustment) !== 0
                ? `${formatCurrency(i.grossEarned)} earned ${Number(i.adjustment) < 0 ? '−' : '+'} ${formatCurrency(Math.abs(i.adjustment))} adjustment${i.adjustmentNote ? ` — ${i.adjustmentNote}` : ''}`
                : undefined}
            />
            <Fig label="Boxes settled" value={formatNumber(i.boxesSettled)} />
            <Fig label="Penalties" value={fines > 0 ? minusCurrency(fines) : '—'} tone={fines > 0 ? 'text-rose-300' : 'text-faint'} />
            <Fig label="Paid" value={formatCurrency(i.paid)} tone={Number(i.paid) > 0 ? 'text-emerald-300' : undefined} />
          </>
        )}
      </dl>

      {runView && bonus && <BonusBar b={bonus} sharedStart={sharedStart} />}
    </article>
  );
}

// The reps, one card each. It opens on the RUN IN PROGRESS — boxes settled and money owed since that rep
// was last paid — because the question here is "since I paid him, how is he doing, and what do I owe him
// now". All time is the other half of the switch: total boxes, total earned, everything ever paid out.
function RepBoard({ items, bonus, onTime }) {
  const [view, setView] = useState('run');
  const runView = view === 'run';

  // The leader of the round comes first, ranked on money earned this run (brands pay different rates, so
  // boxes would crown whoever carries the dearer stock; `available` carries money from before the run).
  // Copied before sorting: `items` is react-query's cached array, shared with the deduct dialog.
  const rows = runView
    ? [...items].sort((a, b) => (
      (b.run?.earned || 0) - (a.run?.earned || 0)
        || (b.run?.boxes || 0) - (a.run?.boxes || 0)
        || String(a.name || '').localeCompare(String(b.name || ''))
    ))
    : items;
  // Nobody is crowned in a table of zeros, and All time has no leader — it is a ledger.
  const leadEarned = runView ? (rows[0]?.run?.earned || 0) : 0;

  // The bonus keeps a run of its own; only reps on a configured bonus get the bar.
  const bonusFor = new Map((bonus || []).filter((b) => b.configured).map((b) => [b.salesRepId, b]));
  const showBonus = runView && bonusFor.size > 0;
  const starts = [...bonusFor.values()].map((b) => new Date(b.cycleStart).getTime());
  const sharedStart = starts.length && starts.every((t) => t === starts[0]) ? starts[0] : null;
  const mins = items.filter((i) => i.earnsCommission !== false).map((i) => Number(i.minWithdrawal) || 0);
  const sharedMin = mins.length && mins.every((m) => m === mins[0]) ? mins[0] : null;
  const onTimeFor = new Map((onTime || []).map((r) => [r.salesRepId, r]));

  return (
    <section className="mt-5">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3 px-1">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Commission by representative</h2>
          <p className="mt-0.5 text-xs text-muted">{runView ? 'Since each rep was last paid · most earned first' : 'Everything since day one'}</p>
        </div>
        <RunSwitch value={view} onChange={setView} />
      </div>
      {!rows.length ? (
        <p className="px-1 py-8 text-center text-sm text-muted">No reps on commission yet.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((i, n) => (
            <RepCard
              key={i.salesRepId}
              i={i}
              runView={runView}
              leads={runView && n === 0 && leadEarned > 0}
              bonus={showBonus ? bonusFor.get(i.salesRepId) : null}
              sharedMin={sharedMin}
              sharedStart={sharedStart}
              onTime={onTimeFor.get(i.salesRepId)}
            />
          ))}
        </div>
      )}
      {runView && (
        <p
          className="mt-3 px-1 text-[11px] text-faint"
          title={'A run closes the moment a rep is paid, and the next one opens there. Whatever was left over comes forward, so earned − fines + brought forward is always what he can withdraw today. The minimum is a floor, not a target. The sales bonus restarts when a bonus is paid, not when commission is, and never enters what he can withdraw.'}
        >
          A run closes when a rep is paid
          {sharedMin > 0 && <> · minimum {formatCurrency(sharedMin)}</>}
          {showBonus && <> · sales bonus counted{sharedStart ? ` from ${formatDate(new Date(sharedStart))}` : ' per rep'}, paid on its own</>}
        </p>
      )}
    </section>
  );
}

// Who is carrying fines now — a thin rose bar per rep, against the largest.
function FinesByRep({ items }) {
  const rows = items.filter((i) => Number(i.penalties) > 0).sort((a, b) => b.penalties - a.penalties);
  if (!rows.length) return null;
  const max = Number(rows[0].penalties) || 1;
  return (
    <section className="card mt-5 p-5">
      <h3 className="text-sm font-semibold text-foreground">Fines by rep</h3>
      <p className="mt-0.5 text-xs text-muted">Still reducing a balance</p>
      <ul className="mt-4 grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2 xl:grid-cols-3">
        {rows.map((i) => (
          <li key={i.salesRepId}>
            <div className="flex items-baseline justify-between gap-3 text-[13px]">
              <Link to={`/reps/${i.salesRepId}`} className="truncate text-muted hover:text-foreground hover:underline">{i.name}</Link>
              <span className="shrink-0 font-semibold tabular-nums text-rose-300">{minusCurrency(i.penalties)}</span>
            </div>
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/[0.07]">
              <div className="h-full rounded-full bg-rose-400/70" style={{ width: `${Math.max(3, (Number(i.penalties) / max) * 100)}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

// Rounded to whole shillings before it is compared to zero: brought forward is
// the difference of two derived figures, and a stray fraction of a shilling
// would print "+TSh 0 brought forward" under a row that is square.
const wholeShillings = (n) => Math.round(Number(n) || 0);

function RunSwitch({ value, onChange }) {
  return (
    <div className="flex shrink-0 rounded-lg border border-border bg-elevated p-0.5">
      {[{ k: 'run', l: 'This run' }, { k: 'all', l: 'All time' }].map((o) => (
        <button
          key={o.k}
          type="button"
          onClick={() => onChange(o.k)}
          className={clsx(
            'rounded-md px-3 py-1.5 text-xs font-semibold transition',
            value === o.k ? 'bg-white/[0.12] text-foreground ring-1 ring-inset ring-white/20' : 'text-muted hover:text-foreground',
          )}
        >
          {o.l}
        </button>
      ))}
    </div>
  );
}

function AdminView() {
  const qc = useQueryClient();
  // Shown to staff too. Fines, deductions, rates and bonuses are the owner's (the server refuses staff), so
  // staff see them without the buttons; withdrawals stay as they are.
  const isAdmin = useAuth().user?.role === ROLES.ADMIN;
  const [deducting, setDeducting] = useState(false);
  const [tab, setTab] = useState('balances');
  const [openWd, setOpenWd] = useState(null); // a withdrawal being read
  const [rejectingWd, setRejectingWd] = useState(null); // a Reject waiting for its confirmation
  const { data: summary, isLoading } = useQuery({ queryKey: ['commissions', 'summary'], queryFn: async () => unwrap(await api.get('/commissions/summary')).data });
  const { data: wd } = useQuery({ queryKey: ['commissions', 'withdrawals', 'all'], queryFn: async () => unwrap(await api.get('/commissions/withdrawals', { params: { limit: 30 } })) });
  // The "Paid out" bars need six months of payouts, more than the 30 newest the table lists. Same
  // endpoint, under the 'commissions' key, so every decision refreshes it with the rest.
  const { data: wdTrend } = useQuery({
    queryKey: ['commissions', 'withdrawals', 'all', 'trend'],
    queryFn: async () => unwrap(await api.get('/commissions/withdrawals', { params: { limit: 200 } })),
  });
  // How reliably orders are settled, overall and per rep — the existing staff analytics. Optional: the
  // page draws without it.
  const { data: analytics } = useQuery({
    queryKey: ['settlements', 'analytics'],
    queryFn: async () => unwrap(await api.get('/settlements/analytics')).data,
    staleTime: 60_000,
  });
  // Only the whole-table counts are read here (meta.counts), so one row is enough. FinesHistory asks for
  // its own lists by status under longer keys; invalidating ['penalties'] refreshes both.
  const { data: penaltyData } = useQuery({
    queryKey: ['penalties', 'all'],
    queryFn: async () => unwrap(await api.get('/penalties', { params: { limit: 1 } })),
  });
  // The sales bonus, for the rep cards. Same key BonusSettings uses, so the two share one cache entry and
  // paying a bonus over on Rates & bonus already invalidates this.
  const { data: bonusRun } = useQuery({ queryKey: ['bonus-summary'], queryFn: async () => unwrap(await api.get('/commissions/bonus/summary')).data });
  // Only fines still charged are worth a badge — counted by the SERVER over the whole table.
  const activeFines = penaltyData?.meta?.counts?.applied
    ?? (penaltyData?.data || []).filter((p) => p.status !== 'WAIVED').length;
  const pendingWithdrawals = (wd?.data || []).filter((w) => w.status === 'PENDING').length;

  const applyPenalties = useMutation({
    mutationFn: () => api.post('/penalties/apply'),
    onSuccess: (res) => {
      const d = res.data?.data;
      toast.success(`${d?.penalties?.applied ?? 0} penalty deduction(s) applied`);
      qc.invalidateQueries({ queryKey: ['commissions'] });
      qc.invalidateQueries({ queryKey: ['penalties'] });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const decide = useMutation({
    mutationFn: ({ id, action, fromOwnPocket }) => api.post(`/commissions/withdrawals/${id}/decide`, { action, fromOwnPocket }),
    onSuccess: (_r, v) => {
      toast.success(v?.fromOwnPocket ? 'Paid from your own money — the business account is untouched' : 'Updated');
      qc.invalidateQueries({ queryKey: ['commissions'] });
      qc.invalidateQueries({ queryKey: ['finance'] });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  if (isLoading || !summary) return <PageSpinner />;
  const items = summary.items || [];
  // The payout bars belong with the balances and the payouts; on Penalties and Rates & bonus the wallet
  // runs the full width alone, so the tab's own table starts high on the screen.
  const withTrend = tab === 'balances' || tab === 'payouts';
  const wallet = (
    <BusinessWallet
      totals={summary.totals}
      items={items}
      wide={!withTrend}
      isAdmin={isAdmin}
      applying={applyPenalties.isPending}
      onApply={() => applyPenalties.mutate()}
      onDeduct={() => setDeducting(true)}
    />
  );
  return (
    <>
      {/* A request waiting for the owner is the one thing here that needs a hand, so it comes first (it only
          shows while something is waiting). */}
      <PendingWithdrawalsStrip
        items={(wd?.data || []).filter((w) => w.status === 'PENDING')}
        refresh={() => ['commissions', 'dashboard'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }))}
        onOpen={setOpenWd}
      />

      {/* The top answers "what do I owe, and how much have I paid": the business's wallet beside the
          payouts month by month. */}
      {withTrend ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <div className="flex lg:col-span-6 xl:col-span-5 [&>*]:w-full">{wallet}</div>
          <div className="flex lg:col-span-6 xl:col-span-7 [&>*]:w-full">
            <PayoutTrend items={wdTrend?.data} loading={!wdTrend} hasMore={wdTrend?.meta?.hasMore} />
          </div>
        </div>
      ) : wallet}

      {deducting && <DeductModal reps={items} onClose={() => setDeducting(false)} />}
      {openWd && (
        <WithdrawalDetail
          w={openWd}
          balance={items.find((r) => r.salesRepId === openWd.salesRepId)?.available ?? null}
          onClose={() => setOpenWd(null)}
          refresh={() => ['commissions', 'dashboard'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }))}
        />
      )}

      {/* SectionTabs spreads its words edge to edge (right for the rep's phone); on a wide admin screen
          they sit together as one control. Overridden here only, so the rep's Wallet is untouched. */}
      <div className="mt-4 sm:[&>[role=tablist]]:justify-start sm:[&>[role=tablist]]:gap-8">
        <SectionTabs
          value={tab}
          onChange={setTab}
          tabs={[
            { key: 'balances', label: 'Balances' },
            { key: 'payouts', label: 'Payouts', count: pendingWithdrawals },
            { key: 'penalties', label: 'Penalties', count: activeFines },
            { key: 'rules', label: 'Rates & bonus' },
          ]}
        />
      </div>

      {tab === 'balances' && (
        <>
          <RepBoard items={items} bonus={bonusRun?.items} onTime={analytics?.byRep} />
          {/* The rep's pies, for the whole business: who earns it, where it comes from, how orders close.
              md–lg: the long one takes a full row, the two short ones share the next. */}
          <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            <EarnedByRep items={items} className="md:col-span-2 xl:col-span-1" />
            <EarnedByBrand items={items} />
            <SettlementRecord a={analytics} />
          </div>
        </>
      )}

      {tab === 'penalties' && (
        <>
          <FinesByRep items={items} />
          <FinesHistory admin canForgive={isAdmin} />
        </>
      )}

      {tab === 'payouts' && (
      <Card className="mt-5">
        <CardHeader
          title="Withdrawal requests"
          subtitle={wd?.data?.length
            ? `${pendingWithdrawals ? `${pendingWithdrawals} waiting · ` : ''}newest first`
            : undefined}
        />
        {!wd?.data?.length ? <EmptyState title="No withdrawal requests" /> : (
          <Table>
            {/* On a phone Status and Requested move under the amount and the buttons stack, so a 390 px
                screen shows the whole row instead of only Rep and Amount. */}
            {/* From sm up the button column takes the spare width, so Amount, Status and Requested sit
                together instead of spreading across a wide screen. */}
            <THead><TR><TH>Rep</TH><TH>Amount</TH><TH className="hidden sm:table-cell">Status</TH><TH className="hidden sm:table-cell">Requested</TH><TH className="sm:w-full" /></TR></THead>
            <TBody>{wd.data.map((w) => (
              <TR key={w.id}>
                <TD className="font-medium">
                  <button type="button" onClick={() => setOpenWd(w)} className="text-left hover:text-brand-600">
                    {w.salesRep?.user?.name}
                  </button>
                </TD>
                <TD className="whitespace-normal sm:whitespace-nowrap">
                  <button type="button" onClick={() => setOpenWd(w)} className="text-left">
                    <div className="font-semibold tabular-nums text-foreground">{formatCurrency(w.amount)}</div>
                  {/* Where to send it. This is the whole point of the request,
                      and it was only visible by hovering a different column. */}
                    {/* Amber only while the money still has to be sent; settled rows keep the note quiet. */}
                    {w.notes && (
                      <div className={clsx('mt-0.5 max-w-[18rem] whitespace-normal text-[11px] sm:w-max', w.status === 'PENDING' || w.status === 'APPROVED' ? 'text-amber-300' : 'text-faint')}>
                        {w.notes}
                      </div>
                    )}
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 sm:hidden">
                      <Badge className={WITHDRAWAL_STATUS_META[w.status]?.cls}>{WITHDRAWAL_STATUS_META[w.status]?.label}</Badge>
                      <span className="text-[11px] text-faint">{formatDateTime(w.requestedAt)}</span>
                    </div>
                  </button>
                </TD>
                <TD className="hidden sm:table-cell"><Badge className={WITHDRAWAL_STATUS_META[w.status]?.cls}>{WITHDRAWAL_STATUS_META[w.status]?.label}</Badge></TD>
                <TD className="hidden text-faint sm:table-cell">{formatDateTime(w.requestedAt)}</TD>
                <TD className="whitespace-normal sm:whitespace-nowrap">
                  <div className="flex flex-col items-end gap-1 sm:flex-row sm:justify-end">
                    {/* Busy while a decision is on its way (audit #19): a second tap used to send a second PAY.
                        The server now refuses it too; this keeps the button from inviting it. */}
                    {w.status === 'PENDING' && <>
                      <Button className="whitespace-nowrap px-2 py-1 text-xs" aria-label="Approve & pay" loading={decide.isPending && decide.variables?.id === w.id && decide.variables?.action === 'PAY'} disabled={decide.isPending} onClick={() => decide.mutate({ id: w.id, action: 'PAY', fromOwnPocket: true })}>
                        {/* "Pay" on a phone so it stays on one line; the screen reader hears it in full. */}
                        <span className="sm:hidden">Pay</span><span className="hidden sm:inline">Approve &amp; pay</span>
                      </Button>
                      <Button variant="ghost" className="px-2 py-1 text-xs text-rose-400" disabled={decide.isPending} onClick={() => setRejectingWd(w)}>Reject</Button>
                    </>}
                    {w.status === 'APPROVED' && (
                      // One button, because there is only one truth: rep commission comes out of the owner's
                      // own pocket, for both brands. On a phone it says "Mark paid" only, so it cannot push the
                      // table wider than the screen; the payout's own sheet still says "from my pocket" in full.
                      <Button className="whitespace-nowrap px-2 py-1 text-xs" aria-label="Mark paid — from my pocket" loading={decide.isPending && decide.variables?.id === w.id} disabled={decide.isPending} onClick={() => decide.mutate({ id: w.id, action: 'PAY', fromOwnPocket: true })}>
                        Mark paid<span className="hidden sm:inline"> — from my pocket</span>
                      </Button>
                    )}
                  </div>
                </TD>
              </TR>
            ))}</TBody>
          </Table>
        )}
        {rejectingWd && (
          <RejectWithdrawalModal
            w={rejectingWd}
            busy={decide.isPending}
            onClose={() => setRejectingWd(null)}
            onConfirm={() => decide.mutate({ id: rejectingWd.id, action: 'REJECT' }, { onSettled: () => setRejectingWd(null) })}
          />
        )}
      </Card>
      )}

      {tab === 'rules' && (
        <>
          <CommissionRateSettings canEdit={isAdmin} />
          <BonusSettings canEdit={isAdmin} />
        </>
      )}
    </>
  );
}

// Renders standalone (reps' own page) or embedded inside Finance (staff).
export default function Commissions({ embedded = false }) {
  const { user } = useAuth();
  const isRep = user?.role === ROLES.SALES_REP;
  return (
    <div>
      {!embedded && (
        <PageHeader title={isRep ? 'My wallet' : 'Commissions'} subtitle={isRep ? 'Your money, bonuses and withdrawals.' : 'Commission performance and withdrawal approvals.'} />
      )}
      {isRep ? <RepView /> : <AdminView />}
    </div>
  );
}
