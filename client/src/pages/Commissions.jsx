import { useEffect, useId, useState } from 'react';
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
import { Coins, Crown, TrendingUp, AlertTriangle, ShieldAlert, HeartHandshake, ShieldCheck, Search, X, ChevronRight, ArrowUpDown } from 'lucide-react';
import SideSheet from '@/components/SideSheet';
import api, { unwrap, apiError } from '@/lib/api';
import { pageQueries } from '@/lib/pageQueries';
import { useAuth } from '@/context/AuthContext';
import { ROLES, WITHDRAWAL_STATUS_META } from '@/lib/constants';
import { formatCurrency, formatNumber, formatDate, formatDateTime, sharePercents, initials } from '@/lib/format';
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
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={req.isPending} disabled={!valid} onClick={() => req.mutate()}>Withdraw{valid ? ` ${formatCurrency(amt)}` : ''}</Button></>}>
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
              <div className="flex shrink-0 gap-2 max-sm:w-full max-sm:gap-3">
                <Button variant="ghost" className="text-rose-400 max-sm:min-h-11 max-sm:flex-1" disabled={busy}
                  onClick={() => setRejecting(w)}>Reject</Button>
                <Button className="max-sm:min-h-11 max-sm:flex-1" loading={busy} onClick={() => decide.mutate({ id: w.id, action: 'PAY' })}>
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
                className="inline-flex min-h-11 items-center gap-1 rounded-lg bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-600 transition hover:bg-emerald-500/20 sm:min-h-0 sm:px-2.5"
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
  const { data: insights } = useQuery(pageQueries.commissionsInsights());
  const { data: c, isLoading } = useQuery(pageQueries.commissionsMine());
  const { data: wd } = useQuery(pageQueries.withdrawalsMine());
  const { data: bonusProgress } = useQuery(pageQueries.bonusMe());

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
          // "all time", so nobody reads it as money in hand today (Nino, 11 Nov 2026).
          { label: 'Earned all time', value: formatCurrency(c.earned) },
          { label: 'Paid out', value: formatCurrency(c.paid) },
          // A withdrawal waiting to be paid is already off the balance above (the server counts it out of
          // Available at once), so while one waits the card says where it went: Pending, even for a rep with fines.
          (Number(c.pendingRequests) || 0) > 0 || !hasPenalties
            ? { label: 'Pending', value: formatCurrency(c.pendingRequests), tone: (Number(c.pendingRequests) || 0) > 0 ? 'amber' : undefined }
            : { label: 'Fines', value: formatCurrency(c.penalties), tone: 'rose' },
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
              'relative -mb-px flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center whitespace-nowrap text-[13px] font-medium transition-colors sm:text-sm',
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
    <section className={clsx('stat-glass flex flex-col', wide ? 'p-4 lg:flex-row lg:flex-wrap lg:items-center lg:gap-x-8 lg:px-5 lg:py-3.5' : 'p-5')}>
      {/* Two hair-thin arcs, as on the rep's wallet card: decoration only, behind everything. */}
      <svg aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 h-full w-full" viewBox="0 0 360 220" preserveAspectRatio="none">
        <path d="M-10 190 C 100 110, 240 70, 380 120" fill="none" stroke="rgba(255,255,255,.06)" strokeWidth="1" />
        <path d="M-10 218 C 120 140, 250 108, 380 156" fill="none" stroke="rgba(255,255,255,.04)" strokeWidth="1" />
      </svg>
      <div className={clsx(wide && 'lg:w-[22rem] lg:shrink-0')}>
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <p className="text-xs font-medium text-white/60">Available to withdraw</p>
            {/* "Total pending" was earned − paid, which still contained fines the reps will never receive — this
                is the money actually withdrawable. */}
            <p className={clsx('whitespace-nowrap font-bold leading-none tabular-nums text-foreground', wide ? 'mt-1.5 text-[26px]' : 'mt-2 text-[28px] sm:text-[32px]')}>
              {formatCurrency(totals.available ?? totals.pending)}
            </p>
            <p className={clsx('mt-1 text-[11px]', totals.requested > 0 ? 'font-medium text-amber-300' : 'text-muted')}>
              {totals.requested > 0 ? `+ ${formatCurrency(totals.requested)} requested` : 'after fines & payouts'}
            </p>
          </div>
          {overdrawn.length > 0 && (
            <dl className="ml-auto shrink-0 pt-0.5 text-right">
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

        <div className={wide ? 'mt-3' : 'mt-5'}>
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
            <Button variant="secondary" className={clsx('justify-center px-2 text-xs', wide && 'xl:py-1.5')} loading={applying} onClick={onApply}>
              <AlertTriangle className="hidden h-4 w-4 shrink-0 min-[400px]:block" /> Apply daily penalties
            </Button>
            <Button variant="secondary" className={clsx('justify-center px-2 text-xs', wide && 'xl:py-1.5')} onClick={onDeduct}>
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
            <li key={r.label} className="flex items-center gap-2 text-[13px]" title={r.title}>
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
  // With many reps the legend would run the length of the page: past seven, the first six keep their own
  // line and the rest share one (each of them by name on hover, and on his own card).
  const cut = rows.length > 7 ? 6 : rows.length;
  const rest = rows.slice(cut);
  const restSum = rest.reduce((sum, r) => sum + r.earned, 0);
  const restShare = shares.slice(cut).reduce((sum, p) => sum + p, 0);
  return (
    <div className={className}>
      <ShareCard
        title="Who earns it"
        said={`${rows[0].name} has earned ${shares[0]}% of it, all time.`}
        center={compactNumber(total)}
        centerUnit="TSh"
        twoCol={cut + (rest.length ? 1 : 0) > 3}
        rows={[
          ...rows.slice(0, cut).map((r, n) => ({
            label: r.name, sub: `${shares[n]}%`, value: r.earned, shown: formatCurrency(r.earned), color: PIE[n % PIE.length],
          })),
          ...(rest.length ? [{
            label: `${formatNumber(rest.length)} others`, sub: `${restShare}%`, value: restSum, shown: formatCurrency(restSum), color: '#52525b',
            title: rest.map((r, n) => `${r.name} ${formatCurrency(r.earned)} (${shares[cut + n]}%)`).join('\n'),
          }] : []),
        ]}
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
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-[11px]">
        <span className="shrink-0 text-muted">Sold toward bonus</span>
        <span className="whitespace-nowrap text-right">
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
            <span className="font-semibold tabular-nums text-sky-300">{next.progress}%</span> to the next bonus · {formatCurrency(next.remaining)} more → {formatCurrency(next.bonusAmount)}
          </span>
        )}
        {!next && !won && <span className="text-muted">no target set</span>}
        {ownStart && <span className="text-faint">from {formatDate(b.cycleStart)}</span>}
      </div>
    </div>
  );
}

// ── The reps: a small card each, and the rep's own view behind it ───────────────────────────────────────
// Nino, 11 Nov 2026: "we might have many reps, so these cards need to be nice, well made and SMALL — and we
// should be able to OPEN them and see the good views and the performance." Each card keeps only what is
// scanned — who, the on-time chip, what he can take out, how far that is from his minimum, one short line of
// facts — and the whole card opens the rep's view: his wallet, this run and all time, the sales bonus, how he
// performs, how he settles, his payouts and his fines.

const onTimeTone = (rate) => (rate >= 80 ? 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/25'
  : rate >= 50 ? 'bg-amber-500/10 text-amber-300 ring-amber-500/25'
    : 'bg-rose-500/10 text-rose-300 ring-rose-500/25');

// The on-time share from the settlement analytics, coloured in three steps. Nothing until an order has closed.
function OnTimeChip({ onTime }) {
  const rate = onTime && onTime.decided > 0 ? Math.round(onTime.onTimeRate) : null;
  if (rate == null) return null;
  return (
    <span
      title={`${formatNumber(onTime.decided)} closed orders`}
      className={clsx('shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ring-1 ring-inset', onTimeTone(rate))}
    >
      {rate}% on time
    </span>
  );
}

const initialOf = (name) => String(name || '?').trim().charAt(0).toUpperCase();

// Where a rep stands against his OWN withdrawal minimum (a setting that can differ per rep). The minimum is a
// floor, not a target: past it the line simply says he can withdraw. One helper, so the card and the rep's
// view can never say two different things.
function minState(i) {
  const offCommission = i.earnsCommission === false;
  const avail = Number(i.available) || 0;
  const min = Number(i.minWithdrawal) || 0;
  const show = !offCommission && min > 0;
  return {
    offCommission, avail, min, show,
    ready: show && avail >= min,
    pct: show ? clampPct((Math.max(0, avail) / min) * 100) : 0,
  };
}

// Every rep's run starts on their own date.
const runSince = (i) => {
  const run = i.run || {};
  if (i.earnsCommission === false) return 'not on commission';
  return run.since ? `since ${formatDate(run.since)}` : 'never withdrawn';
};

// An agreed one-off adjustment makes lifetime Earned differ from boxes × rate — the star and its title say so.
const adjustmentTitle = (i) => (Number(i.adjustment) !== 0
  ? `${formatCurrency(i.grossEarned)} earned ${Number(i.adjustment) < 0 ? '−' : '+'} ${formatCurrency(Math.abs(i.adjustment))} adjustment${i.adjustmentNote ? ` — ${i.adjustmentNote}` : ''}`
  : undefined);
const EarnedValue = ({ i }) => (
  <>{formatCurrency(i.earned)}{Number(i.adjustment) !== 0 && <span className="ml-0.5 cursor-help text-amber-400">*</span>}</>
);

// A withdrawal he asked for that waits on the owner — the urgent item, in amber with a dot.
const RequestedNote = ({ amount }) => (
  <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[11px] font-medium leading-none text-amber-300" title="Waiting to be approved or rejected">
    <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
    {formatCurrency(amount)} requested
  </span>
);

// The note beside the amount, the same words on the card, the phone row and the rep's view: where he stands
// against his minimum — after a waiting request, when `request` is on (the phone row has room for one note).
function MinNote({ i, request = true }) {
  const { offCommission, avail, min, show, ready } = minState(i);
  const requested = Number(i.pendingRequests) || 0;
  if (request && requested > 0) return <RequestedNote amount={requested} />;
  if (offCommission) return <span className="whitespace-nowrap text-[11px] text-faint">not on commission</span>;
  if (!show) return null;
  return ready
    ? <span className="whitespace-nowrap text-[11px] font-semibold text-emerald-300">can withdraw</span>
    : <span className="whitespace-nowrap text-[11px] text-muted" title={`To the ${formatCurrency(min)} minimum`}>{formatCurrency(min - avail)} to go</span>;
}

// The facts line of a card: boxes, fines, then the bonus (this run) or what he earned (all time). A fact
// that does not fit moves whole to a second line; none is ever hidden. It used to be one line high with the
// rest cut off, and on a phone that line was 35-105 px wide, so "−TSh 120,000 fines" and the bonus % were
// silently gone (audit, 12 Nov 2026). Cards in a row still end level: the grid stretches them.
function repFacts(i, runView, bonus) {
  const run = i.run || {};
  const fines = runView ? (Number(run.penalties) || 0) : (Number(i.penalties) || 0);
  const facts = [
    <span key="boxes"><b className="font-semibold text-foreground">{formatNumber(runView ? run.boxes || 0 : i.boxesSettled)}</b> boxes</span>,
  ];
  if (fines > 0) facts.push(<span key="fines" className="text-rose-300">{minusCurrency(fines)} fines</span>);
  if (!runView) facts.push(<span key="earned" title={adjustmentTitle(i)}><EarnedValue i={i} /> earned</span>);
  else if (bonus?.claimable) {
    facts.push(<span key="bonus" className="font-medium text-emerald-300">{formatCurrency(bonus.claimable.bonusAmount)} bonus earned</span>);
  } else if (bonus?.next && (bonus.next.progress > 0 || Number(bonus.sales) > 0)) {
    facts.push(
      <span key="bonus" title={`${formatCurrency(bonus.next.remaining)} more sales → ${formatCurrency(bonus.next.bonusAmount)} bonus`}>
        <b className="font-semibold text-sky-300">{bonus.next.progress}%</b> to next bonus
      </span>,
    );
  }
  return facts;
}

const Avatar = ({ name, className }) => (
  <span className={clsx('flex shrink-0 items-center justify-center rounded-full bg-white/[0.06] font-semibold text-white/80 ring-1 ring-inset ring-white/10', className)} aria-hidden="true">
    {initialOf(name)}
  </span>
);

// The small card (a row in one list on a phone). The whole of it is one button that opens the rep's view;
// the switch above decides whether the facts tell this run or all time. Money never wraps or gets cut.
// What a card's rep view asks for, started on a hover or touch of the card (see the Commissions case in
// lib/routeQueries.js). Only a hint for the read-ahead: the address is never opened.
const sheetAhead = (i) => `/commissions?rep=${encodeURIComponent(i.salesRepId)}`;

function RepTile({ i, runView, leads, bonus, usualMin, onTime, onOpen, phone }) {
  const { offCommission, avail, min, show, ready, pct } = minState(i);
  const ownMin = show && usualMin != null && min !== usualMin;
  const requested = Number(i.pendingRequests) || 0;
  const facts = repFacts(i, runView, bonus);
  const bar = show ? (
    <span className="block h-1 min-w-[48px] flex-1 overflow-hidden rounded-full bg-white/[0.07]" aria-hidden="true">
      <span className={clsx('block h-full rounded-full transition-[width] duration-700 ease-out', ready ? 'bg-emerald-400' : 'bg-emerald-400/50')} style={{ width: `${pct}%` }} />
    </span>
  ) : null;
  const name = (
    <span className="flex min-w-0 items-center gap-1">
      <span className={clsx('truncate text-[14px] font-semibold', leads ? 'text-amber-300' : 'text-foreground')}>{i.name}</span>
      {leads && <Crown className="h-3.5 w-3.5 shrink-0 text-amber-300" aria-label="Most earned this run" />}
      {!runView && i.code && <span className="ml-1 shrink-0 text-[11px] text-faint">{i.code}</span>}
    </span>
  );
  const amount = (size) => (
    <span className={clsx('whitespace-nowrap font-bold leading-none tabular-nums', size, avail < 0 ? 'text-rose-300' : 'text-foreground')}>
      {signedCurrency(avail)}
    </span>
  );
  const factLine = (
    <span className="flex min-w-0 flex-1 flex-wrap gap-x-3 gap-y-0.5 text-[11px] leading-[15px] text-muted">
      {facts.map((f) => <span key={f.key} className="whitespace-nowrap">{f}</span>)}
    </span>
  );
  const hasOnTime = Boolean(onTime && onTime.decided > 0);
  const minTag = ownMin && <span className="shrink-0 whitespace-nowrap text-[10px] leading-none tabular-nums text-faint">min {formatCurrency(min)}</span>;
  const focus = 'focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white/50';

  if (phone) {
    return (
      <button type="button" onClick={onOpen} aria-haspopup="dialog" data-prefetch={sheetAhead(i)} data-prefetch-hover="off" className={clsx('flex w-full items-center gap-3 px-3.5 py-2 text-left transition active:bg-white/[0.05]', focus)}>
        <Avatar name={i.name} className="h-8 w-8 text-[13px]" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center justify-between gap-3">
            {name}
            {amount('text-[17px]')}
          </span>
          {/* The facts get the row's whole width (they shared it with the chip and the note, and lost);
              the on-time chip, the note and the bar follow on their own line. */}
          <span className="mt-1 flex">{factLine}</span>
          {(hasOnTime || requested > 0 || offCommission || show || minTag) && (
            <span className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <OnTimeChip onTime={onTime} />
              <MinNote i={i} />
              {bar}{minTag}
            </span>
          )}
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-faint" aria-hidden="true" />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      data-prefetch={sheetAhead(i)}
      data-prefetch-hover="off"
      className={clsx('stat-glass group flex h-full w-full flex-col px-3.5 py-3 text-left transition hover:brightness-[1.15] active:scale-[0.99]', focus)}
    >
      <span className="flex w-full items-center gap-2.5">
        <Avatar name={i.name} className="h-7 w-7 text-[12px]" />
        <span className="flex min-w-0 flex-1">{name}</span>
        <OnTimeChip onTime={onTime} />
      </span>
      <span className="mt-2.5 flex w-full flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
        {amount('text-[20px] tracking-tight')}
        <MinNote i={i} request={false} />
      </span>
      {/* Pushed to the bottom, so the bars and the facts of every card in a row sit on one line. */}
      <span className="mt-auto block w-full pt-2.5">
        {(bar || minTag || requested > 0) && (
          <span className="mb-1.5 flex h-3 items-center gap-2">{bar}{requested > 0 ? <RequestedNote amount={requested} /> : minTag}</span>
        )}
        <span className="flex items-center gap-2">
          {factLine}
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-faint transition group-hover:translate-x-0.5 group-hover:text-foreground" aria-hidden="true" />
        </span>
      </span>
    </button>
  );
}

// A payout or a fine waiting on the owner is read and decided in the windows the page already has; the rep's
// view only lists them and opens those.
const fineKind = (p) => (p.kind === 'ADJUSTMENT' ? 'Deduction' : p.kind === 'EXPIRY_FINE' ? 'Return delay fine' : 'Late settlement fine');
const hoursText = (h) => (h == null ? '—' : h < 10 ? `${(Math.round(h * 10) / 10).toFixed(1)} h` : `${formatNumber(Math.round(h))} h`);

function DayTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-md">
      <div className="mb-0.5 font-semibold text-foreground">{formatDate(row.date)}</div>
      <div className="text-muted">{formatNumber(row.boxes)} boxes settled</div>
      <div className="text-faint">{formatCurrency(row.revenue)} sales</div>
    </div>
  );
}

// How the rep performs — from his profile (the same figures as /reps/:id, all time), and his last 30 days.
function RepPerformance({ p }) {
  const perf = p.performance || {};
  const days = p.trend || [];
  const boxes30 = days.reduce((s, d) => s + (Number(d.boxes) || 0), 0);
  const sales30 = days.reduce((s, d) => s + (Number(d.revenue) || 0), 0);
  const active30 = days.filter((d) => Number(d.boxes) > 0).length;
  return (
    <section>
      <h3 className="text-sm font-semibold text-foreground">Performance</h3>
      <p className="mt-0.5 text-xs text-muted">All time, from the rep's orders</p>
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
        <Fig label="Sales settled" value={formatCurrency(perf.revenue)} />
        <Fig label="Boxes received" value={formatNumber(perf.received)} />
        <Fig label="Sold of received" value={`${formatNumber(perf.conversion)}%`} tone="text-emerald-300" title={`${formatNumber(perf.sold)} of ${formatNumber(perf.received)} boxes settled`} />
        <Fig label="Returned" value={formatNumber(perf.returned)} />
        <Fig label="Holding now" value={perf.net == null ? '—' : `${formatNumber(perf.net)} boxes`} />
        {p.discipline && <Fig label="Orders" value={formatNumber(p.discipline.totalOrders)} />}
      </dl>
      <div className="mt-5 border-t border-white/[0.06] pt-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p className="text-xs font-medium text-muted">Last 30 days</p>
          <p className="text-[11px] text-faint">
            <span className="font-semibold tabular-nums text-foreground">{formatNumber(boxes30)}</span> boxes ·{' '}
            <span className="whitespace-nowrap">{formatCurrency(sales30)} sales</span> · settled on {formatNumber(active30)} day{active30 === 1 ? '' : 's'}
          </p>
        </div>
        {boxes30 > 0 ? (
          <div className="mt-3 h-[130px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={days} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                <XAxis dataKey="date" tick={AXIS} tickLine={false} axisLine={false} minTickGap={18} tickFormatter={(d) => String(Number(String(d).slice(8, 10)))} />
                <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} tickCount={3} width={30} />
                <Tooltip content={<DayTip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                <Bar dataKey="boxes" fill="#38bdf8" fillOpacity={0.7} radius={[4, 4, 0, 0]} maxBarSize={14} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="py-6 text-center text-xs text-muted">No boxes settled in the last 30 days.</p>
        )}
      </div>
    </section>
  );
}

// His settlement record — the page's ring, for one rep, graded on the server (the profile's discipline).
function RepSettlement({ d }) {
  if (!d || !(d.settledOrders + d.open > 0)) return null;
  const late = Math.max(0, d.settledOrders - d.onTimeOrders);
  const overdue = d.overdue || 0;
  const open = Math.max(0, (d.open || 0) - overdue);
  const rows = [
    { label: 'Settled on time', value: d.onTimeOrders, color: '#34d399' },
    { label: 'Settled late', value: late, color: '#fbbf24' },
    { label: 'Still open', value: open, color: '#38bdf8' },
    { label: 'Overdue', value: overdue, color: '#fb7185', tone: overdue > 0 ? 'text-rose-300' : undefined },
  ].filter((r) => r.value > 0).map((r) => ({ ...r, shown: formatNumber(r.value) }));
  return (
    <ShareCard
      title="Settlement record"
      said={d.settledOrders ? `${formatNumber(d.onTimeOrders)} of ${formatNumber(d.settledOrders)} closed orders settled on time.` : 'No order closed yet.'}
      center={d.onTimeRate != null ? `${Math.round(d.onTimeRate)}%` : formatNumber(d.open)}
      centerUnit={d.onTimeRate != null ? 'on time' : 'open'}
      rows={rows}
    />
  );
}

// The orders he closed last, each with the hours it took against its window (72 h, or 168 h with the
// extension), as the server graded them.
function RepClosings({ d, closings }) {
  if (!closings?.length) return null;
  return (
    <section>
      <h3 className="text-sm font-semibold text-foreground">Last closed orders</h3>
      {d && <p className="mt-0.5 text-xs text-muted">Extra time on {formatNumber(d.extended)} · fined on {formatNumber(d.finedOrders)}, all time</p>}
      <ul className="mt-2 divide-y divide-white/[0.06]">
        {closings.map((o) => (
          <li key={o.id} className="flex items-center justify-between gap-3 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-[13px] font-medium text-foreground">{o.settlementNumber}</p>
              <p className="mt-0.5 text-[11px] text-faint">
                {formatDate(o.settledAt)} · <span className="whitespace-nowrap">{hoursText(o.hoursTaken)} of {formatNumber(o.windowHours)} h</span>
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="whitespace-nowrap text-[13px] font-semibold tabular-nums text-foreground">{formatCurrency(o.value)}</p>
              {o.onTime != null && (
                <p className={clsx('mt-0.5 text-[11px] font-medium', o.onTime ? 'text-emerald-300' : 'text-amber-300')}>
                  {o.onTime ? 'on time' : 'late'}
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

// What he moves most, by boxes, all time — a thin bar per product against the first.
function RepBestSellers({ rows }) {
  if (!rows?.length) return null;
  const top = Math.max(1, Number(rows[0].boxes) || 0);
  return (
    <section>
      <h3 className="text-sm font-semibold text-foreground">Best sellers</h3>
      <p className="mt-0.5 text-xs text-muted">All time, by boxes settled</p>
      <ul className="mt-3 space-y-3">
        {rows.map((r) => (
          <li key={r.productId}>
            <p className="truncate text-[13px] text-muted" title={r.name}>{r.name}</p>
            <div className="mt-1 flex items-center gap-3">
              <div className="h-[3px] min-w-0 flex-1 overflow-hidden rounded-full bg-white/[0.07]">
                <div className="h-full rounded-full bg-white/35" style={{ width: `${Math.max(3, ((Number(r.boxes) || 0) / top) * 100)}%` }} />
              </div>
              <span className="shrink-0 whitespace-nowrap text-[11px] tabular-nums text-faint">
                <b className="text-[12px] font-semibold text-foreground">{formatNumber(r.boxes)}</b> boxes · {formatCurrency(r.revenue)}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

// The rep's own view, opened from his card: his wallet, this run, all time, the sales bonus, how he performs
// and settles, his payouts and his fines. Everything the old big card showed is here with the same figure,
// plus what the existing staff endpoints already know about him. The figures at the top come from the
// Commissions summary the page already holds; the rest is asked for when the view opens, and a part that
// cannot be loaded is left out rather than shown as an error.
function RepSheet({ i, bonus, onTime, leads, isAdmin, onClose, onOpenWithdrawal, onForgive }) {
  const titleId = useId();
  const [tab, setTab] = useState('overview');
  const id = i.salesRepId;
  const run = i.run || {};
  const { avail, min, show, ready, pct } = minState(i);
  const carried = wholeShillings(run.broughtForward);
  const requested = Number(i.pendingRequests) || 0;
  const fines = Number(i.penalties) || 0;
  const runFines = Number(run.penalties) || 0;

  // Staff and the owner may both read these (the profile is staff-only, payouts and fines are open to any
  // signed-in user and scoped by the server). Same key as the rep's profile page, so opening it is instant.
  // The card's data-prefetch starts all three on a press or touch, not a hover (lib/routeQueries.js).
  const profileQ = useQuery({
    ...pageQueries.repProfile({ id, period: 'all' }),
    staleTime: 60_000,
    retry: false,
  });
  const wdQ = useQuery({
    // A key of its own: the profile page keeps its latest 6 under ['commissions', 'withdrawals', 'rep', id].
    // It still starts with 'commissions', so every refresh of the page refreshes it too.
    ...pageQueries.repSheetWithdrawals(id),
    retry: false,
  });
  const finesQ = useQuery({
    ...pageQueries.repFines(id),
    retry: false,
  });
  const profile = profileQ.data;
  const withdrawals = wdQ.data?.data || [];
  const waiting = withdrawals.filter((w) => w.status === 'PENDING').length;
  const fineRows = finesQ.data?.data || [];
  const fineCounts = finesQ.data?.meta?.counts;
  // The two rings show only when they have something to draw (the same tests the rings make themselves).
  const hasBrands = (i.earnedByBrand || []).some((b) => Number(b.amount) > 0);
  const disc = profile?.discipline;
  const hasRecord = !!disc && disc.settledOrders + disc.open > 0;

  const tabs = [
    { key: 'overview', label: 'Overview' },
    ...(wdQ.isError ? [] : [{ key: 'payouts', label: 'Payouts', count: waiting }]),
    ...(finesQ.isError ? [] : [{ key: 'fines', label: 'Fines', count: fineCounts?.applied }]),
  ];
  const current = tabs.some((t) => t.key === tab) ? tab : 'overview';

  return (
    <SideSheet onClose={onClose} labelledBy={titleId}>
      <header className="flex shrink-0 items-start gap-3 border-b border-white/[0.07] px-4 py-3.5 sm:px-6 sm:py-4">
        <Avatar name={i.name} className="mt-0.5 h-10 w-10 text-base" />
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="flex min-w-0 items-center gap-1.5 text-[17px] font-semibold leading-tight">
            <span className={clsx('truncate', leads ? 'text-amber-300' : 'text-foreground')}>{i.name}</span>
            {leads && <Crown className="h-4 w-4 shrink-0 text-amber-300" aria-label="Most earned this run" />}
          </h2>
          <p className="mt-0.5 truncate text-xs text-faint">{[i.code, runSince(i)].filter(Boolean).join(' · ')}</p>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <OnTimeChip onTime={onTime} />
            <Link to={`/reps/${id}`} className="-my-3 inline-flex min-h-11 items-center gap-1 text-xs font-medium text-muted transition hover:text-foreground sm:my-0 sm:min-h-0">
              Open full profile <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="-mr-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-faint transition hover:bg-elevated hover:text-foreground">
          <X className="h-5 w-5" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto overscroll-contain px-4 pb-10 pt-4 sm:px-6">
        {/* His wallet: what he can take out today and how far that is from his minimum, then his lifetime. */}
        <section className="stat-glass p-5">
          <svg aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 h-full w-full" viewBox="0 0 360 220" preserveAspectRatio="none">
            <path d="M-10 190 C 100 110, 240 70, 380 120" fill="none" stroke="rgba(255,255,255,.06)" strokeWidth="1" />
          </svg>
          <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
            <div className="min-w-0">
              <p className="text-xs font-medium text-white/60">Available to withdraw</p>
              <p className={clsx('mt-2 whitespace-nowrap text-[28px] font-bold leading-none tabular-nums sm:text-[30px]', avail < 0 ? 'text-rose-300' : 'text-foreground')}>
                {signedCurrency(avail)}
              </p>
            </div>
            {/* The same note as on his card, beside the amount; the minimum it is measured against above it. */}
            <div className="ml-auto flex flex-col items-end gap-1 pb-0.5 text-right">
              {show && (
                <p className="whitespace-nowrap text-[11px] text-muted">
                  Minimum <span className="font-semibold tabular-nums text-foreground">{formatCurrency(min)}</span>
                </p>
              )}
              {show ? (ready
                ? <p className="whitespace-nowrap text-[11px] font-semibold text-emerald-300">can withdraw</p>
                : <p className="whitespace-nowrap text-[11px] text-muted" title={`To the ${formatCurrency(min)} minimum`}>{formatCurrency(min - avail)} to go</p>)
                : <MinNote i={i} request={false} />}
              {requested > 0 && <RequestedNote amount={requested} />}
            </div>
          </div>
          {show && (
            <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
              <div className={clsx('h-full rounded-full transition-[width] duration-700 ease-out', ready ? 'bg-emerald-400' : 'bg-emerald-400/50')} style={{ width: `${pct}%` }} />
            </div>
          )}
          {avail < 0 && (
            <p className="mt-2 flex items-center gap-1.5 text-[11px] text-rose-300">
              <span aria-hidden="true" className="h-1 w-1 shrink-0 rounded-full bg-current" />
              {fines > 0 && avail + fines >= 0 ? 'Below zero from overdue fines' : 'Below zero — new commission pays it off first'}
            </p>
          )}
          {i.emergency?.open && (
            <p className="mt-2 flex items-center gap-1.5 text-[11px] text-amber-300">
              <span aria-hidden="true" className="h-1 w-1 shrink-0 rounded-full bg-current" />
              Withdrawal window open until {formatDateTime(i.emergency.until)}
            </p>
          )}
          <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-white/[0.06] pt-4 sm:grid-cols-4">
            <Fig label="Earned · all time" value={<EarnedValue i={i} />} title={adjustmentTitle(i)} />
            <Fig label="Paid out" value={formatCurrency(i.paid)} tone={Number(i.paid) > 0 ? 'text-emerald-300' : 'text-faint'} />
            <Fig label="Fines · all time" value={fines > 0 ? minusCurrency(fines) : '—'} tone={fines > 0 ? 'text-rose-300' : 'text-faint'} />
            <Fig label="Boxes settled" value={formatNumber(i.boxesSettled)} />
          </dl>
        </section>

        <div className="mt-2 [&>[role=tablist]]:justify-start [&>[role=tablist]]:gap-6 sm:[&>[role=tablist]]:gap-8">
          <SectionTabs value={current} onChange={setTab} tabs={tabs} />
        </div>

        {current === 'overview' && (
          // Open sections on the sheet, a hairline between them, like the rep's own Wallet: the wallet above is
          // the one card; only the two rings keep theirs, side by side.
          <div className="divide-y divide-white/[0.06] [&>*]:py-6 [&>*:last-child]:pb-0">
            {profile && <RepPerformance p={profile} />}
            {profileQ.isLoading && <p className="text-center text-xs text-muted">Loading performance…</p>}
            {/* The run in progress: since he was last paid. Earned − fines + brought forward = available. */}
            <section>
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
                <h3 className="text-sm font-semibold text-foreground">This run</h3>
                <p className="text-[11px] text-faint">{runSince(i)}</p>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-5">
                <Fig label="Earned" value={formatCurrency(run.earned || 0)} />
                <Fig label="Boxes this run" value={formatNumber(run.boxes || 0)} />
                <Fig label="Fines" value={runFines > 0 ? minusCurrency(runFines) : '—'} tone={runFines > 0 ? 'text-rose-300' : 'text-faint'} />
                <Fig
                  label="Brought forward"
                  value={carried !== 0 ? `${carried > 0 ? '+' : '−'}${formatCurrency(Math.abs(carried))}` : '—'}
                  tone={carried < 0 ? 'text-rose-300' : carried === 0 ? 'text-faint' : undefined}
                  title="What the balance carried when this run opened"
                />
                <Fig
                  label="Last paid"
                  value={run.lastPayout ? formatCurrency(run.lastPayout.amount) : '—'}
                  tone={run.lastPayout ? undefined : 'text-faint'}
                  sub={run.lastPayout ? formatDate(run.lastPayout.at) : undefined}
                />
              </dl>
              {bonus && <BonusBar b={bonus} sharedStart={null} />}
            </section>
            {(hasBrands || hasRecord) && (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <EarnedByBrand items={[i]} />
                {hasRecord && <RepSettlement d={profile.discipline} />}
              </div>
            )}
            {profile && (profile.settlements?.closings?.length > 0 || profile.topProducts?.length > 0) && (
              <div className="grid grid-cols-1 gap-x-10 gap-y-8 md:grid-cols-2">
                <RepClosings d={profile.discipline} closings={profile.settlements?.closings} />
                <RepBestSellers rows={profile.topProducts} />
              </div>
            )}
          </div>
        )}

        {current === 'payouts' && (
          <div className="mt-5 space-y-4">
            <PayoutTrend items={withdrawals} loading={!wdQ.data} hasMore={wdQ.data?.meta?.hasMore} />
            {wdQ.data && (
              withdrawals.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted">No withdrawal requests yet.</p>
              ) : (
                <section className="glass-list">
                  <div className="flex items-baseline justify-between gap-3 border-b border-white/[0.06] px-4 py-3">
                    <h3 className="text-sm font-semibold text-foreground">Withdrawal requests</h3>
                    <span className="text-[11px] text-faint">{waiting ? `${waiting} waiting · ` : ''}newest first</span>
                  </div>
                  <ul className="divide-y divide-white/[0.06]">
                    {withdrawals.map((w) => {
                      const meta = WITHDRAWAL_STATUS_META[w.status] || {};
                      const live = w.status === 'PENDING' || w.status === 'APPROVED';
                      return (
                        <li key={w.id}>
                          <button type="button" onClick={() => onOpenWithdrawal(w)} className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left transition hover:bg-white/[0.035]">
                            <span className="min-w-0">
                              <span className="block text-[13px] text-muted">Asked {formatDateTime(w.requestedAt)}</span>
                              {w.notes && <span className={clsx('mt-0.5 block break-words text-[11px]', live ? 'text-amber-300' : 'text-faint')}>{w.notes}</span>}
                              {w.paidAt && <span className="mt-0.5 block text-[11px] text-emerald-400/80">Paid {formatDateTime(w.paidAt)}</span>}
                              {w.status === 'PENDING' && <span className="mt-1 block text-[11px] font-medium text-amber-300">Open to approve or reject</span>}
                            </span>
                            <span className="flex shrink-0 flex-col items-end gap-1">
                              <span className="whitespace-nowrap text-[14px] font-semibold tabular-nums text-foreground">{formatCurrency(w.amount)}</span>
                              <Badge className={meta.cls}>{meta.label || w.status}</Badge>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )
            )}
          </div>
        )}

        {current === 'fines' && (
          <div className="mt-5 space-y-4">
            {!finesQ.data ? (
              <p className="py-6 text-center text-xs text-muted">Loading fines…</p>
            ) : !fineRows.length ? (
              <div className="py-10 text-center">
                <ShieldCheck className="mx-auto h-6 w-6 text-emerald-400/80" aria-hidden="true" />
                <p className="mt-3 text-sm font-medium text-foreground">No fines</p>
                <p className="mt-1 text-xs text-muted">
                  Nothing is reducing this balance{fineCounts?.waived ? ` · ${formatNumber(fineCounts.waived)} forgiven earlier` : ''}.
                </p>
              </div>
            ) : (
              <section className="glass-list">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-b border-white/[0.06] px-4 py-3">
                  <h3 className="text-sm font-semibold text-foreground">Fines still charged</h3>
                  <span className="text-[11px] text-faint">
                    <span className="font-semibold tabular-nums text-rose-300">{minusCurrency(fines)}</span>
                    {' '}from {formatNumber(fineCounts?.applied ?? fineRows.length)} fine{(fineCounts?.applied ?? fineRows.length) === 1 ? '' : 's'}
                    {fineCounts?.waived ? ` · ${formatNumber(fineCounts.waived)} forgiven` : ''}
                  </span>
                </div>
                <ul className="divide-y divide-white/[0.06]">
                  {fineRows.map((p) => (
                    <li key={p.id} className="flex items-start justify-between gap-3 px-4 py-3">
                      <div className="min-w-0">
                        <p className="text-[13px] text-foreground">{fineKind(p)}</p>
                        <p className="mt-0.5 text-[11px] text-faint" title={p.notes || undefined}>
                          {p.settlement?.settlementNumber ? `${p.settlement.settlementNumber} · ` : ''}{formatDateTime(p.appliedAt)}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1.5">
                        <span className="whitespace-nowrap text-[14px] font-semibold tabular-nums text-rose-300">{minusCurrency(p.amount)}</span>
                        {isAdmin && (
                          <button
                            type="button"
                            onClick={() => onForgive({ ...p, salesRep: p.salesRep || { user: { name: i.name } } })}
                            className="inline-flex min-h-11 items-center gap-1 rounded-lg bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-600 transition hover:bg-emerald-500/20 sm:min-h-0 sm:px-2.5"
                          >
                            <HeartHandshake className="h-3.5 w-3.5" /> Forgive
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
                {finesQ.data?.meta?.totalPages > 1 && (
                  <p className="border-t border-white/[0.06] px-4 py-3 text-[11px] text-faint">The latest 50 — the Penalties tab lists them all.</p>
                )}
              </section>
            )}
          </div>
        )}
      </div>
    </SideSheet>
  );
}

// Below 640 px the reps are rows in one list instead of cards (twice as many fit on a screen).
const PHONE_QUERY = '(max-width: 639.98px)';
function usePhone() {
  const [phone, setPhone] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(PHONE_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(PHONE_QUERY);
    if (!mq) return undefined;
    const on = () => setPhone(mq.matches);
    on();
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return phone;
}

const SORTS = [
  { k: 'earned', l: 'Most earned' },
  { k: 'available', l: 'Most available' },
  { k: 'fines', l: 'Most fines' },
  { k: 'name', l: 'Name' },
];

// The reps, one small card each. It opens on the RUN IN PROGRESS — boxes settled and money owed since that
// rep was last paid — because the question here is "since I paid him, how is he doing, and what do I owe him
// now". All time is the other half of the switch. With many reps a search and a sort appear.
function RepBoard({ items, bonus, onTime, isAdmin }) {
  const qc = useQueryClient();
  const [view, setView] = useState('run');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('earned');
  const [openId, setOpenId] = useState(null);
  const [openWd, setOpenWd] = useState(null); // a payout opened from the rep's view
  const [forgiving, setForgiving] = useState(null); // a fine opened from the rep's view
  const runView = view === 'run';
  const phone = usePhone();
  const many = items.length > 8;
  const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''));

  // The leader of the round is ranked on money earned this run (brands pay different rates, so boxes would
  // crown whoever carries the dearer stock; `available` carries money from before the run). Copied before
  // sorting: `items` is react-query's cached array, shared with the deduct dialog.
  const ranked = [...items].sort((a, b) => (
    (b.run?.earned || 0) - (a.run?.earned || 0)
      || (b.run?.boxes || 0) - (a.run?.boxes || 0)
      || byName(a, b)
  ));
  // Nobody is crowned in a table of zeros, and All time has no leader — it is a ledger.
  const leaderId = (ranked[0]?.run?.earned || 0) > 0 ? ranked[0].salesRepId : null;

  let rows;
  if (sort === 'available') rows = [...items].sort((a, b) => (Number(b.available) || 0) - (Number(a.available) || 0) || byName(a, b));
  else if (sort === 'fines') {
    const f = (i) => (runView ? Number(i.run?.penalties) || 0 : Number(i.penalties) || 0);
    rows = [...items].sort((a, b) => f(b) - f(a) || byName(a, b));
  } else if (sort === 'name') rows = [...items].sort(byName);
  // "Most earned" means what the switch shows: earned this run, or earned all time.
  else rows = runView ? ranked : [...items].sort((a, b) => (Number(b.earned) || 0) - (Number(a.earned) || 0) || byName(a, b));
  const q = query.trim().toLowerCase();
  if (q) rows = rows.filter((i) => `${i.name || ''} ${i.code || ''}`.toLowerCase().includes(q));

  // The bonus keeps a run of its own; only reps on a configured bonus get it.
  const bonusFor = new Map((bonus || []).filter((b) => b.configured).map((b) => [b.salesRepId, b]));
  const showBonus = runView && bonusFor.size > 0;
  const starts = [...bonusFor.values()].map((b) => new Date(b.cycleStart).getTime());
  const sharedStart = starts.length && starts.every((t) => t === starts[0]) ? starts[0] : null;
  // The minimum most reps are on is named once, under the cards (in both views); a card on a different one
  // names its own beside its bar.
  const mins = items.filter((i) => i.earnsCommission !== false).map((i) => Number(i.minWithdrawal) || 0);
  const sharedMin = mins.length && mins.every((m) => m === mins[0]) ? mins[0] : null;
  const tally = new Map();
  for (const m of mins) tally.set(m, (tally.get(m) || 0) + 1);
  const usualMin = [...tally.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? null;
  const onTimeFor = new Map((onTime || []).map((r) => [r.salesRepId, r]));
  const open = openId ? items.find((i) => i.salesRepId === openId) : null;
  // The rep's view also fills the profile page's cache ('sales-rep-profile'), so a payout decided or a fine
  // forgiven from it refreshes that too — "Open full profile" is the next click.
  const refresh = () => ['commissions', 'dashboard', 'sales-rep-profile'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const sortLabel = SORTS.find((s) => s.k === sort)?.l;
  const subtitle = [
    many && `${formatNumber(items.length)} reps`,
    runView ? 'since last paid' : 'all time',
    sort === 'name' ? 'by name' : `${sortLabel.toLowerCase()} first`,
  ].filter(Boolean).join(' · ');
  const footer = [
    runView && 'a run closes when a rep is paid',
    sharedMin > 0 ? `minimum ${formatCurrency(sharedMin)}` : usualMin > 0 ? `minimum ${formatCurrency(usualMin)} unless the card names another` : null,
    showBonus && `sales bonus counted ${sharedStart ? `from ${formatDate(new Date(sharedStart))}` : 'per rep'}, paid on its own`,
  ].filter(Boolean).join(' · ');
  const upper = (t) => t.charAt(0).toUpperCase() + t.slice(1);

  const search = many && (
    <label className={clsx('relative', phone ? 'min-w-0 flex-1' : 'w-48')}>
      <span className="sr-only">Find a rep</span>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" aria-hidden="true" />
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Find a rep"
        className="h-9 w-full rounded-lg border border-border bg-elevated pl-8 pr-2 text-xs text-foreground placeholder:text-faint focus:border-white/25 focus:outline-none sm:h-8"
      />
    </label>
  );
  // The sort looks like the switch beside it (same height, 12 px words); the real select lies on top of it,
  // invisible, so the phone's own picker opens and the page never zooms.
  const sorter = many && (
    <label className="relative flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-elevated px-2.5 text-xs font-semibold text-muted transition focus-within:border-white/25 hover:text-foreground sm:h-8">
      <ArrowUpDown className="h-3.5 w-3.5" aria-hidden="true" />
      {!phone && <span aria-hidden="true">{sortLabel}</span>}
      <select
        aria-label="Sort the reps"
        value={sort}
        onChange={(e) => setSort(e.target.value)}
        className="absolute inset-0 h-full w-full cursor-pointer appearance-none text-base opacity-0"
      >
        {SORTS.map((s) => <option key={s.k} value={s.k}>{s.l}</option>)}
      </select>
    </label>
  );
  const switcher = <RunSwitch value={view} onChange={setView} />;
  const tile = (i) => (
    <RepTile
      key={i.salesRepId}
      i={i}
      phone={phone}
      runView={runView}
      leads={runView && i.salesRepId === leaderId}
      bonus={showBonus ? bonusFor.get(i.salesRepId) : null}
      usualMin={usualMin}
      onTime={onTimeFor.get(i.salesRepId)}
      onOpen={() => setOpenId(i.salesRepId)}
    />
  );

  return (
    <section className="mt-5">
      <div className="mb-3 px-1">
        <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-2">
          <div className="min-w-0 flex-1 sm:min-w-[15rem]">
            <h2 className="text-sm font-semibold text-foreground">Commission by representative</h2>
            {phone && !many ? (
              <div className="mt-1 flex items-center justify-between gap-2">
                <p className="min-w-0 text-xs text-muted">{upper(subtitle)}</p>
                {switcher}
              </div>
            ) : (
              <p className="mt-0.5 text-xs text-muted">{upper(subtitle)}</p>
            )}
          </div>
          {!phone && <div className="flex flex-wrap items-center gap-2">{search}{sorter}{switcher}</div>}
        </div>
        {/* A phone with many reps: the search, the sort and the switch on one row under the title. */}
        {phone && many && <div className="mt-2.5 flex items-center gap-2">{search}{sorter}{switcher}</div>}
      </div>
      {!items.length ? (
        <p className="px-1 py-8 text-center text-sm text-muted">No reps on commission yet.</p>
      ) : !rows.length ? (
        <p className="px-1 py-8 text-center text-sm text-muted">No rep matches “{query.trim()}”.</p>
      ) : phone ? (
        <div className="glass-list divide-y divide-white/[0.06]">{rows.map(tile)}</div>
      ) : (
        // A card is never narrower than ~285 px, so the biggest amount and its note share one line.
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 min-[1360px]:grid-cols-4 min-[1700px]:grid-cols-5">{rows.map(tile)}</div>
      )}
      {footer && (
        <p
          className="mt-3 px-1 text-[11px] text-faint"
          title={'A run closes the moment a rep is paid, and the next one opens there. Whatever was left over comes forward, so earned − fines + brought forward is always what he can withdraw today. The minimum is a floor, not a target. The sales bonus restarts when a bonus is paid, not when commission is, and never enters what he can withdraw.'}
        >
          {upper(footer)}
        </p>
      )}

      {/* The rep's view, then any window opened from inside it — after it, so it sits on top. */}
      {open && (
        <RepSheet
          i={open}
          bonus={bonusFor.get(open.salesRepId) || null}
          onTime={onTimeFor.get(open.salesRepId)}
          leads={open.salesRepId === leaderId}
          isAdmin={isAdmin}
          onClose={() => setOpenId(null)}
          onOpenWithdrawal={setOpenWd}
          onForgive={setForgiving}
        />
      )}
      {openWd && (
        <WithdrawalDetail
          w={openWd}
          balance={items.find((r) => r.salesRepId === openWd.salesRepId)?.available ?? null}
          onClose={() => setOpenWd(null)}
          refresh={refresh}
        />
      )}
      {forgiving && (
        <ForgiveModal penalty={forgiving} onClose={() => { setForgiving(null); qc.invalidateQueries({ queryKey: ['sales-rep-profile'] }); }} />
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
      {/* Columns as the reps need them: two reps fill the card instead of leaving its last third empty. */}
      <ul className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(16rem,1fr))] gap-x-8 gap-y-3">
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

// What each rep has been paid, from the same list the Paid-out chart reads (PAID and APPROVED, as the server
// counts "paid out"), so the rows add up to the wallet's Paid out figure. Biggest first, with a bar against the top.
function PaidByRep({ items, hasMore }) {
  if (!items) return <section className="stat-glass p-4 text-xs text-muted">Loading payouts…</section>;
  const by = new Map();
  let rejected = 0;
  for (const w of items) {
    if (w.status === 'REJECTED') rejected += 1;
    if (w.status !== 'PAID' && w.status !== 'APPROVED') continue;
    const id = w.salesRepId || w.salesRep?.id || w.salesRep?.code;
    const cur = by.get(id) || { name: w.salesRep?.user?.name || w.salesRep?.code || '—', total: 0, count: 0, last: null };
    cur.total += Number(w.amount) || 0;
    cur.count += 1;
    const at = w.paidAt || w.decidedAt || w.requestedAt;
    if (!cur.last || new Date(at) > new Date(cur.last)) cur.last = at;
    by.set(id, cur);
  }
  const rows = [...by.values()].sort((a, b) => b.total - a.total);
  const total = rows.reduce((s, r) => s + r.total, 0);
  const count = rows.reduce((s, r) => s + r.count, 0);
  const top = rows[0]?.total || 0;
  return (
    <section className="stat-glass flex flex-col p-4">
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">Paid by rep</h3>
          <p className={clsx('mt-0.5 text-[11px]', hasMore ? 'text-amber-300' : 'text-white/50')}>
            {hasMore ? `Latest ${formatNumber(items.length)} payouts` : 'All time'} · biggest first
          </p>
        </div>
        <span className="shrink-0 whitespace-nowrap text-sm font-bold tabular-nums text-emerald-300">{formatCurrency(total)}</span>
      </div>
      {!rows.length ? <p className="my-auto py-8 text-center text-xs text-muted">Nothing paid yet.</p> : (
        <ul className="mt-3 space-y-3">
          {rows.map((r) => (
            <li key={r.name}>
              <div className="flex items-baseline justify-between gap-3 text-[13px]">
                <span className="min-w-0 truncate text-foreground">{r.name}</span>
                <span className="shrink-0 whitespace-nowrap font-semibold tabular-nums text-foreground">{formatCurrency(r.total)}</span>
              </div>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/[0.07]">
                <div className="h-full rounded-full bg-emerald-400/80" style={{ width: `${top ? Math.max(2, (r.total / top) * 100) : 0}%` }} />
              </div>
              <p className="mt-1 text-[10.5px] text-faint">{formatNumber(r.count)} payout{r.count === 1 ? '' : 's'} · last {formatDate(r.last)}</p>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-auto border-t border-white/[0.06] pt-2.5 text-[11px] text-white/50">
        {formatNumber(count)} paid{rejected ? ` · ${formatNumber(rejected)} rejected` : ''}
      </p>
    </section>
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
  const { data: summary, isLoading } = useQuery(pageQueries.commissionsSummary());
  const { data: wd } = useQuery(pageQueries.withdrawalsAll());
  // The "Paid out" bars need six months of payouts, more than the 30 newest the table lists. Same
  // endpoint, under the 'commissions' key, so every decision refreshes it with the rest.
  const { data: wdTrend } = useQuery(pageQueries.withdrawalsTrend());
  // How reliably orders are settled, overall and per rep — the existing staff analytics. Optional: the
  // page draws without it.
  const { data: analytics } = useQuery({
    ...pageQueries.settlementsAnalytics(),
    staleTime: 60_000,
  });
  // Only the whole-table counts are read here (meta.counts), so one row is enough. FinesHistory asks for
  // its own lists by status under longer keys; invalidating ['penalties'] refreshes both.
  const { data: penaltyData } = useQuery(pageQueries.penaltiesCount());
  // The sales bonus, for the rep cards. Same key BonusSettings uses, so the two share one cache entry and
  // paying a bonus over on Rates & bonus already invalidates this.
  const { data: bonusRun } = useQuery(pageQueries.bonusSummary());
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
  // Owner, 11 Nov 2026: "the cards here are big … the rep list should be up; the charts can be down a bit —
  // we will have many reps". The business wallet is one slim strip on every tab, and the Paid-out chart sits
  // under the reps (and under the payouts) instead of beside the wallet, so the list starts high on the screen.
  const trend = <PayoutTrend items={wdTrend?.data} loading={!wdTrend} hasMore={wdTrend?.meta?.hasMore} />;
  const wallet = (
    <BusinessWallet
      totals={summary.totals}
      items={items}
      wide
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

      {/* The top answers "what do I owe, and how much have I paid" in one slim strip. */}
      {wallet}

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
          <RepBoard items={items} bonus={bonusRun?.items} onTime={analytics?.byRep} isAdmin={isAdmin} />
          {/* The rep's pies, for the whole business: who earns it, where it comes from, how orders close.
              md–lg: the long one takes a full row, the two short ones share the next. */}
          <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            <EarnedByRep items={items} className="md:col-span-2 xl:col-span-1" />
            <EarnedByBrand items={items} />
            <SettlementRecord a={analytics} />
          </div>
          <div className="mt-4">{trend}</div>
        </>
      )}

      {tab === 'penalties' && (
        <>
          <FinesByRep items={items} />
          <FinesHistory admin canForgive={isAdmin} />
        </>
      )}

      {tab === 'payouts' && (
        // Owner, 11 Nov 2026: the table "feels big and not nice". Rows are now one tight line each (waiting ones
        // first, in their own group), and the spare width holds what was paid to each rep.
        <div className="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-3">
          <section className="stat-glass flex flex-col xl:col-span-2">
            <div className="flex items-baseline justify-between gap-3 px-4 pb-2 pt-4">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-foreground">Withdrawal requests</h3>
                {wd?.data?.length ? (
                  <p className="mt-0.5 text-[11px] text-white/50">
                    {/* The waiting count is on the group's own label below (pending and approved alike). */}
                    newest first{wd.data.length >= 30 ? ' · latest 30' : ''}
                  </p>
                ) : null}
              </div>
            </div>
            {!wd?.data?.length ? <EmptyState title="No withdrawal requests" /> : (
              <>
                {[
                  { key: 'waiting', label: 'Waiting for you', rows: wd.data.filter((w) => w.status === 'PENDING' || w.status === 'APPROVED') },
                  { key: 'done', label: 'History', rows: wd.data.filter((w) => w.status !== 'PENDING' && w.status !== 'APPROVED') },
                ].filter((g) => g.rows.length).map((g, gi, groups) => (
                  <div key={g.key}>
                    {/* A group label only when there are two groups — with nothing waiting it is just the list. */}
                    {groups.length > 1 && (
                      <p className={clsx('px-4 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-wider', g.key === 'waiting' ? 'text-amber-300/90' : 'text-white/40')}>
                        {g.label} · {formatNumber(g.rows.length)}
                      </p>
                    )}
                    <ul>
                      {g.rows.map((w) => {
                        const meta = WITHDRAWAL_STATUS_META[w.status];
                        const open = w.status === 'PENDING' || w.status === 'APPROVED';
                        const name = w.salesRep?.user?.name || w.salesRep?.code || '—';
                        return (
                          <li key={w.id} className={clsx('flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-white/[0.05] px-4 py-2', open && 'bg-amber-400/[0.035]')}>
                            <button type="button" onClick={() => setOpenWd(w)}
                              className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 rounded-lg">
                              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-[11px] font-semibold text-white/70 ring-1 ring-inset ring-white/10" aria-hidden="true">
                                {initials(name) || '?'}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="flex min-w-0 items-center gap-2">
                                  <span className="truncate text-[13px] font-medium text-foreground">{name}</span>
                                  <span className={clsx('shrink-0 rounded-full px-1.5 text-[10px] font-medium leading-4', meta?.cls)}>{meta?.label}</span>
                                </span>
                                {/* Where to send it — amber only while the money still has to be sent. */}
                                <span className={clsx('block break-words text-[11px] leading-4 sm:truncate', open ? 'text-amber-300' : 'text-faint')} title={w.notes || undefined}>
                                  {w.notes || formatDateTime(w.requestedAt)}
                                </span>
                              </span>
                              <span className="shrink-0 text-right">
                                <span className="block whitespace-nowrap text-[13.5px] font-semibold tabular-nums text-foreground">{formatCurrency(w.amount)}</span>
                                {w.notes && <span className="block whitespace-nowrap text-[10.5px] leading-4 text-faint">{formatDateTime(w.requestedAt)}</span>}
                              </span>
                            </button>
                            {open && (
                              // On a phone the buttons share the row's width, 44 px tall and 12 px apart: Pay records
                              // the payout at once, so a thumb must not reach it on its way to Reject.
                              <div className="flex w-full shrink-0 justify-end gap-3 sm:w-auto sm:gap-1">
                                {/* Busy while a decision is on its way (audit #19): a second tap used to send a second PAY.
                                    The server now refuses it too; this keeps the button from inviting it. */}
                                {w.status === 'PENDING' && <>
                                  <Button className="min-h-11 flex-1 whitespace-nowrap px-3 py-1 text-[13px] sm:min-h-0 sm:flex-none sm:px-2 sm:text-xs" aria-label="Approve & pay" loading={decide.isPending && decide.variables?.id === w.id && decide.variables?.action === 'PAY'} disabled={decide.isPending} onClick={() => decide.mutate({ id: w.id, action: 'PAY', fromOwnPocket: true })}>
                                    <span className="sm:hidden">Pay</span><span className="hidden sm:inline">Approve &amp; pay</span>
                                  </Button>
                                  <Button variant="ghost" className="min-h-11 flex-1 px-3 py-1 text-[13px] text-rose-400 ring-1 ring-inset ring-rose-400/25 sm:min-h-0 sm:flex-none sm:px-2 sm:text-xs sm:ring-0" disabled={decide.isPending} onClick={() => setRejectingWd(w)}>Reject</Button>
                                </>}
                                {w.status === 'APPROVED' && (
                                  // One button, because there is only one truth: rep commission comes out of the owner's
                                  // own pocket, for both brands. The payout's own sheet says "from my pocket" in full.
                                  <Button className="min-h-11 flex-1 whitespace-nowrap px-3 py-1 text-[13px] sm:min-h-0 sm:flex-none sm:px-2 sm:text-xs" aria-label="Mark paid — from my pocket" loading={decide.isPending && decide.variables?.id === w.id} disabled={decide.isPending} onClick={() => decide.mutate({ id: w.id, action: 'PAY', fromOwnPocket: true })}>
                                    Mark paid<span className="hidden sm:inline"> — from my pocket</span>
                                  </Button>
                                )}
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </>
            )}
          </section>

          {/* The spare width: what each rep was paid, and the payouts month by month under it. */}
          <div className="flex flex-col gap-4 xl:self-start">
            <PaidByRep items={wdTrend?.data} hasMore={wdTrend?.meta?.hasMore} />
            {trend}
          </div>

          {rejectingWd && (
            <RejectWithdrawalModal
              w={rejectingWd}
              busy={decide.isPending}
              onClose={() => setRejectingWd(null)}
              onConfirm={() => decide.mutate({ id: rejectingWd.id, action: 'REJECT' }, { onSettled: () => setRejectingWd(null) })}
            />
          )}
        </div>
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
