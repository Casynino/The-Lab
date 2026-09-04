import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import BonusProgress from '@/components/BonusProgress';
import { Coins, Wallet, Clock, TrendingUp, AlertTriangle, Info, ShieldAlert, HeartHandshake, PartyPopper, ShieldCheck, Boxes } from 'lucide-react';
import api, { unwrap, apiError } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { ROLES, WITHDRAWAL_STATUS_META } from '@/lib/constants';
import { formatCurrency, formatNumber, formatDate, formatDateTime } from '@/lib/format';
import { PayoutHistory, earnedOn } from '@/components/WithdrawalNote';
import {
  PageHeader, Card, CardHeader, StatCard, PageSpinner, EmptyState, Badge, Button, Modal, Field, Input, Textarea,
  Pagination, Select, Table, THead, TBody, TR, TH, TD,
} from '@/components/ui';

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
  // something to say; what The Lab actually needs is an address to send to, and
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
  const valid = amt > 0 && amt <= available && addressed;

  if (done != null) {
    return (
      <Modal open onClose={onClose} title="Withdrawal requested">
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
            On its way{firstName ? `, ${firstName}` : ''}
          </h3>
          <span
            className="animate-rise mt-2 inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2.5 py-1 text-[11px] font-semibold text-amber-300 ring-1 ring-amber-500/25"
            style={{ animationDelay: '0.33s' }}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
            Waiting on approval
          </span>

          <p className="animate-rise mt-4 text-3xl font-bold tabular-nums text-emerald-400" style={{ animationDelay: '0.36s' }}>
            {formatCurrency(done.amount)}
          </p>
          <p className="animate-rise mt-1 max-w-xs truncate text-xs text-faint" style={{ animationDelay: '0.42s' }}>
            to {done.to}
          </p>

          <p className="animate-rise mt-5 max-w-xs text-[13px] leading-relaxed text-muted" style={{ animationDelay: '0.5s' }}>
            Once approved the money reaches you in <b className="text-foreground">1–2 hours</b>, during working hours.
          </p>
          <p className="animate-rise mt-2 max-w-xs text-[11px] leading-snug text-faint" style={{ animationDelay: '0.56s' }}>
            It is held aside from now, so the same money cannot be requested twice.
          </p>

          <Button className="animate-rise mt-6 w-full justify-center py-3 text-[15px]" style={{ animationDelay: '0.62s' }} onClick={onClose}>
            Done
          </Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open onClose={onClose} title="Request commission withdrawal"
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
          <Input type="number" min="0" max={available} value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
        </Field>
        {amt > 0 && amt < available && (
          <button type="button" onClick={() => setAmount(String(Math.floor(available)))}
            className="cursor-pointer text-xs font-medium text-brand-400 hover:text-brand-300">
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
                    ? 'bg-brand-500/15 text-brand-300 ring-brand-500/30'
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
                what makes clear whose mistake it is — The Lab pays what it is
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
                Check the number and the name before you send this. The Lab pays exactly what you write here — if it
                is wrong the money goes to whoever owns that number, and <b className="text-amber-200">it cannot be
                brought back</b>. Getting it right is on you.
              </p>
            </div>
          </div>
        </div>

        <p className="text-xs text-faint">
          The Lab reviews every request. The minimum balance to request one is {formatCurrency(minWithdrawal)}.
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
// Opening a request. The table can only show a line; deciding one deserves the
// whole picture — who asked, how much, where they want it sent, what it leaves
// them with, and who decided it if someone already has.
function WithdrawalDetail({ w, balance, onClose, refresh }) {
  const decide = useMutation({
    mutationFn: (action) => api.post(`/commissions/withdrawals/${w.id}/decide`, { action }),
    onSuccess: (_r, action) => {
      toast.success(action === 'APPROVE' ? 'Approved — ready to pay' : action === 'PAY' ? 'Marked paid' : 'Request rejected');
      refresh();
      onClose();
    },
    onError: (e) => toast.error(apiError(e)),
  });

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

        {pending && (
          <div className="grid grid-cols-2 gap-2">
            <Button className="justify-center py-2.5" loading={decide.isPending} onClick={() => decide.mutate('APPROVE')}>
              <ShieldCheck className="h-4 w-4" /> Approve
            </Button>
            <Button variant="secondary" className="justify-center py-2.5 text-rose-400"
              disabled={decide.isPending} onClick={() => decide.mutate('REJECT')}>
              Reject
            </Button>
          </div>
        )}
        {approved && (
          <Button className="w-full justify-center py-2.5" loading={decide.isPending} onClick={() => decide.mutate('PAY')}>
            <Coins className="h-4 w-4" /> Mark paid — from my pocket
          </Button>
        )}
        {pending && (
          <p className="text-[11px] leading-snug text-faint">
            Approving moves no money. It clears the request so you can send it, and the amount stays held aside from
            their balance either way until you decide.
          </p>
        )}
      </div>
    </Modal>
  );
}

function PendingWithdrawalsStrip({ items, refresh, onOpen }) {
  const decide = useMutation({
    mutationFn: ({ id, action }) => api.post(`/commissions/withdrawals/${id}/decide`, { action }),
    onSuccess: (_r, v) => {
      toast.success(v.action === 'APPROVE' ? 'Approved — ready to pay' : 'Request rejected');
      refresh();
    },
    onError: (e) => toast.error(apiError(e)),
  });

  if (!items.length) return null;

  return (
    <Card className="mb-6 border-amber-500/30">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Coins className="h-4 w-4 text-amber-400" />
        <h2 className="text-sm font-bold text-foreground">Commission requests</h2>
        <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-bold text-amber-400">{items.length}</span>
        <span className="ml-auto hidden text-xs text-faint sm:block">Approving clears it to pay — no money moves yet</span>
      </div>
      <div className="divide-y divide-border">
        {items.map((w) => {
          const busy = decide.isPending && decide.variables?.id === w.id;
          return (
            <div key={w.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <button type="button" onClick={() => onOpen?.(w)} className="min-w-0 flex-1 text-left" title="Open to see the details">
                <div className="text-sm font-semibold text-foreground">
                  {w.salesRep?.user?.name}{w.salesRep?.code ? ` (${w.salesRep.code})` : ''} · {formatCurrency(w.amount)}
                </div>
                {/* Where they asked it to go. This is the line to read. */}
                {w.notes && <div className="mt-0.5 font-mono text-xs text-amber-300">{w.notes}</div>}
                <div className="mt-0.5 text-xs text-faint">{formatDateTime(w.requestedAt)}</div>
              </button>
              <div className="flex shrink-0 gap-2">
                <Button variant="ghost" className="text-rose-400" disabled={busy}
                  onClick={() => decide.mutate({ id: w.id, action: 'REJECT' })}>Reject</Button>
                <Button loading={busy} onClick={() => decide.mutate({ id: w.id, action: 'APPROVE' })}>
                  <ShieldCheck className="h-4 w-4" /> Approve
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function PenaltyBreakdown({ breakdown }) {
  if (!breakdown?.length) return null;
  return (
    <Card className="mt-4 border border-rose-500/20 bg-rose-500/5">
      <CardHeader
        title="Penalty deductions by order"
        subtitle="Late-settlement fines (TZS 10,000/day) actually deducted from your commission balance."
      />
      <Table>
        <THead>
          <TR>
            <TH>Order</TH>
            <TH>Days overdue</TH>
            <TH>Daily rate</TH>
            <TH className="text-right">Total deducted</TH>
            <TH>Status</TH>
          </TR>
        </THead>
        <TBody>
          {breakdown.map((p) => (
            <TR key={p.settlementId}>
              <TD className="font-medium">{p.settlementNumber}</TD>
              <TD className="text-rose-400">{p.daysOverdue}</TD>
              <TD>{formatCurrency(p.penaltyPerDay)}</TD>
              <TD className="text-right font-semibold text-rose-400">−{formatCurrency(p.totalPenalty)}</TD>
              <TD className="text-xs">
                {p.closed ? <span className="text-emerald-500">Order closed</span>
                  : p.exemptPendingReturn ? <span className="text-sky-400">Paused — return under review</span>
                    : <span className="text-rose-400">Still accruing daily</span>}
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </Card>
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
function FinesHistory({ admin }) {
  const [forgiving, setForgiving] = useState(null);
  const [showForgiven, setShowForgiven] = useState(false);
  const { data } = useQuery({
    queryKey: ['penalties', admin ? 'all' : 'mine'],
    queryFn: async () => unwrap(await api.get('/penalties', { params: { limit: 50 } })),
  });
  const all = data?.data || [];
  // A forgiven fine is settled business. Showing dozens of them first buried the
  // handful still costing someone money, so they are collapsed by default.
  const active = all.filter((p) => p.status !== 'WAIVED');
  const forgivenCount = all.length - active.length;
  const items = showForgiven ? all : active;
  if (!all.length) return null;
  return (
    <Card className="mt-6">
      <CardHeader
        title="Penalty transactions"
        subtitle={active.length
          ? `${active.length} fine${active.length !== 1 ? 's' : ''} still reducing a balance.`
          : 'Nothing is currently reducing anyone\u2019s balance.'}
        action={admin && forgivenCount > 0 && (
          <Button variant="ghost" className="text-xs" onClick={() => setShowForgiven((v) => !v)}>
            {showForgiven ? 'Hide forgiven' : `Show ${forgivenCount} forgiven`}
          </Button>
        )} />
      <Table>
        <THead><TR>{admin && <TH>Rep</TH>}<TH>Type</TH><TH>Order</TH><TH className="text-right">Amount</TH><TH>Status</TH><TH>Date</TH>{admin && <TH />}</TR></THead>
        <TBody>
          {items.map((p) => {
            const waived = p.status === 'WAIVED';
            return (
              <TR key={p.id}>
                {admin && <TD className="font-medium">{p.salesRep?.user?.name}</TD>}
                <TD>{p.kind === 'ADJUSTMENT' ? 'Commission Deduction' : p.kind === 'EXPIRY_FINE' ? 'Return Delay Fine (24h)' : 'Late Settlement Fine'}</TD>
                <TD className="text-faint" title={p.notes || undefined}>{p.settlement?.settlementNumber || '—'}</TD>
                <TD className={`text-right font-semibold ${waived ? 'text-faint line-through' : 'text-rose-400'}`}>−{formatCurrency(p.amount)}</TD>
                <TD>
                  {waived
                    ? <Badge className="bg-emerald-500/15 text-emerald-300" title={p.waiveReason || undefined}>Forgiven</Badge>
                    : <Badge className="bg-rose-500/15 text-rose-300">Applied</Badge>}
                </TD>
                <TD className="text-faint">{waived && p.waivedAt ? `${formatDateTime(p.appliedAt)} · forgiven ${formatDateTime(p.waivedAt)}` : formatDateTime(p.appliedAt)}</TD>
                {admin && (
                  <TD>
                    {!waived && (
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
          })}
        </TBody>
      </Table>
      {forgiving && <ForgiveModal penalty={forgiving} onClose={() => setForgiving(null)} />}
    </Card>
  );
}

function PenaltyPolicyCard() {
  return (
    <Card className="mt-4 border border-amber-500/20 bg-amber-500/5">
      <div className="flex gap-3 p-4">
        <Info className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
        <div className="space-y-1.5 text-sm text-amber-300/80">
          <p className="font-semibold text-amber-300">Settlement Penalty Policy</p>
          <ul className="list-disc space-y-1.5 pl-4">
            <li>Orders must be settled or returned within <b>72 hours</b> after stock is issued.</li>
            <li>After 72 hours, <b>TZS 10,000</b> is deducted daily from your commission.</li>
            <li>You may extend an order <b>once</b> by <b>96 hours</b> (7 days total) from the order screen — no approval needed.
              During the extension there is no fine, but afterwards the daily fine becomes <b>TZS 20,000</b>,
              and a return not completed in 24 hours costs <b>TZS 30,000</b>.</li>
            <li>No penalty while a return awaits review — but the review window is <b>24 hours</b>.</li>
            <li>A return not completed within 24 hours expires automatically and costs <b>TZS 15,000</b>; the boxes go back on your order.</li>
            <li>Penalties stop once everything is settled or returned.</li>
          </ul>
        </div>
      </div>
    </Card>
  );
}

// What a box is worth today, per brand. Orders keep the rate that was in force
// when they were CREATED, so this card describes new orders only.
function RatesCard({ rates }) {
  if (!rates?.perBrand?.length) return null;
  return (
    <Card className="mt-4">
      <CardHeader title="Commission rate per box" subtitle="What one settled box earns today." />
      <div className="grid grid-cols-2 gap-3 p-4 pt-0 sm:grid-cols-3">
        {rates.perBrand.map((r) => (
          <div key={r.brand} className="rounded-lg border border-white/10 bg-white/5 p-3">
            <p className="text-xs uppercase tracking-wide text-faint">{r.brand}</p>
            <p className="mt-1 text-lg font-semibold text-emerald-300">{formatCurrency(r.perBox)}</p>
            <p className="text-xs text-faint">per box</p>
          </div>
        ))}
      </div>
      <p className="px-4 pb-4 text-xs text-faint">
        Orders you already have keep the rate they were issued with — nothing you have earned changes.
      </p>
    </Card>
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

// Three seven-digit amounts do not fit across a phone, and truncating them to
// "TSh 656,0…" is worse than rounding: a shortened number still reads, a cut one
// does not. Exact figures are a tap away on the tabs below.
const compactTsh = (n) => {
  const v = Math.abs(Number(n) || 0);
  const sign = Number(n) < 0 ? '-' : '';
  if (v >= 1_000_000) return `${sign}TSh ${(v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1)}M`;
  if (v >= 1_000) return `${sign}TSh ${Math.round(v / 1_000)}K`;
  return `${sign}TSh ${Math.round(v)}`;
};

// A small figure that supports the headline without competing with it.
function MiniStat({ label, value, tone }) {
  return (
    <div className="min-w-0 rounded-xl border border-border bg-surface px-3 py-2.5">
      <p className="truncate text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">{label}</p>
      <p className={clsx(
        'mt-0.5 truncate text-sm font-bold tabular-nums',
        tone === 'rose' ? 'text-rose-400' : 'text-foreground',
      )}>
        {compactTsh(value)}
      </p>
    </div>
  );
}

function RepView() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('bonus');
  const { data: c, isLoading } = useQuery({ queryKey: ['commissions', 'me'], queryFn: async () => unwrap(await api.get('/commissions/me')).data });
  const { data: wd } = useQuery({ queryKey: ['commissions', 'withdrawals', 'mine'], queryFn: async () => unwrap(await api.get('/commissions/withdrawals', { params: { limit: 20 } })) });
  const { data: bonusProgress } = useQuery({ queryKey: ['bonus', 'me'], queryFn: async () => unwrap(await api.get('/commissions/bonus/me')).data });

  if (isLoading || !c) return <PageSpinner />;

  const hasPenalties = c.penalties > 0;
  const balanceNegative = c.available < 0;
  const canWithdraw = c.available >= c.minWithdrawal;
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
      {/* The balance is the one number this page exists for, so it takes the
          headline and the action sits beside it. Everything else supports it. */}
      <div className={clsx(
        'rounded-2xl border p-4',
        balanceNegative ? 'border-rose-500/40 bg-rose-500/[0.06]'
          : canWithdraw ? 'border-emerald-500/40 bg-emerald-500/[0.07]'
            : 'border-border bg-surface',
      )}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">Available balance</p>
            <p className={clsx(
              'mt-1 text-3xl font-bold leading-none tabular-nums',
              balanceNegative ? 'text-rose-400' : canWithdraw ? 'text-emerald-300' : 'text-foreground',
            )}>
              {formatCurrency(c.available)}
            </p>
          </div>
          {/* 44px minimum, so it is comfortably tappable on a phone. */}
          <Button className="min-h-[44px] shrink-0" onClick={() => setOpen(true)} disabled={!canWithdraw}>
            Withdraw
          </Button>
        </div>

        {balanceNegative ? (
          <p className="mt-3 text-[11px] leading-snug text-rose-400">
            Your balance is negative from overdue fines. Settle your outstanding orders to clear it.
          </p>
        ) : (
          <>
            <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-white/[0.07]">
              <div
                className={clsx(
                  'h-full rounded-full transition-[width] duration-700 ease-out',
                  canWithdraw ? 'bg-gradient-to-r from-emerald-500 to-emerald-300' : 'bg-gradient-to-r from-brand-600 to-brand-400',
                )}
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="mt-1.5 text-[11px] leading-snug text-muted">
              {canWithdraw
                ? <span className="font-semibold text-emerald-400">Ready to withdraw — earned on {earnedOn(c)}</span>
                : c.earned > 0
                  ? `${formatCurrency(c.available)} of ${formatCurrency(c.minWithdrawal)} minimum · ${formatCurrency(c.minWithdrawal - c.available)} to go`
                  : `Every box you settle earns commission. The first ${formatCurrency(c.minWithdrawal)} unlocks a withdrawal.`}
            </p>
          </>
        )}
      </div>

      {/* The live request used to get a card here, under the balance. It is
          already in the payouts list below with its own status, so the card was
          the same fact twice — and the balance is what this part of the page is
          for. */}

      {/* These swapped themselves out when the note above was showing the same
          figure. With the note gone they just state the three facts. */}
      <div className="mt-3 grid grid-cols-3 gap-2">
        <MiniStat label="Earned" value={c.earned} />
        <MiniStat label="Paid out" value={c.paid} />
        {hasPenalties
          ? <MiniStat label="Fines" value={c.penalties} tone="rose" />
          : <MiniStat label="Pending" value={c.pendingRequests} />}
      </div>

      {/* Four stacked sections became four tabs. The page was a single scroll
          through everything at once; now it opens on one thing. */}
      <SectionTabs
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'bonus', label: 'Bonus' },
          { key: 'withdrawals', label: 'Payouts', count: pendingCount },
          { key: 'fines', label: 'Fines' },
          { key: 'rules', label: 'Rules' },
        ]}
      />

      {tab === 'bonus' && (
        bonusProgress?.configured
          ? <div className="mt-4"><BonusProgress p={bonusProgress} /></div>
          : <Card className="mt-4"><EmptyState title="No bonus running" description="Nothing to chase right now." /></Card>
      )}

      {tab === 'withdrawals' && (
        <Card className="mt-4">
          <CardHeader title="My withdrawal requests" subtitle={`Minimum ${formatCurrency(c.minWithdrawal)}`} />
          {!withdrawals.length ? (
            <EmptyState title="No withdrawals yet" description="Settle boxes and the first request will appear here." />
          ) : (
            // A table of three columns for what is really a list of one fact
            // each: how much, what happened to it, when. The date now says PAID
            // when it was paid — the one thing a rep opens this list to check.
            <div className="p-4"><PayoutHistory items={withdrawals} /></div>
          )}
        </Card>
      )}

      {tab === 'fines' && (
        hasPenalties ? (
          <>
            <PenaltyBreakdown breakdown={c.penaltyBreakdown} />
            <FinesHistory admin={false} />
          </>
        ) : (
          <Card className="mt-4"><EmptyState title="No fines" description="Nothing is reducing your balance." /></Card>
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
          <Input type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Reason" required hint="Shown to the rep and kept in the record">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Commission removed by The Lab" />
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
  return (
    <div className="mt-4 flex flex-wrap gap-1 rounded-xl border border-border bg-elevated p-1">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => onChange(t.key)}
          className={clsx(
            // 44px minimum: below that a tab is uncomfortable to hit on a phone.
            'min-h-[44px] flex-1 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition',
            value === t.key ? 'bg-brand-500 text-black' : 'text-muted hover:text-foreground',
          )}
        >
          {t.label}
          {t.count != null && t.count > 0 && (
            <span className={clsx('ml-2 rounded-full px-1.5 py-0.5 text-[11px]', value === t.key ? 'bg-black/20' : 'bg-white/10')}>
              {t.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

// ── Admin: commission rates ──────────────────────────────────────────────────
// Rates are added, never edited. A new rate must start in the future, which is
// what guarantees a settled box can never be re-priced — so the form offers a
// start date rather than an "edit" button, and says why.
function CommissionRateSettings() {
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
    <Card className="mt-6">
      <CardHeader title="Commission rates" subtitle="What one settled box earns, per brand. Add a rate to change it from a future date." />
      <div className="grid grid-cols-1 gap-3 border-b border-border p-4 sm:grid-cols-4">
        <Field label="Brand" hint="Leave blank for all other brands">
          <Select value={brandId} onChange={(e) => setBrandId(e.target.value)}>
            <option value="">All other brands</option>
            {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        </Field>
        <Field label="Commission per box" required>
          <Input type="number" min="0" value={perBox} onChange={(e) => setPerBox(e.target.value)} placeholder="5000" />
        </Field>
        <Field label="Starts" required hint="Must be in the future">
          <Input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <div className="flex items-end">
          <Button className="w-full" loading={add.isPending} disabled={!valid} onClick={() => add.mutate()}>Save rate</Button>
        </div>
      </div>
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
                  {future && (
                    <Button variant="ghost" className="px-2 py-1 text-xs text-rose-600" onClick={() => remove.mutate(r.id)}>Remove</Button>
                  )}
                </TD>
              </TR>
            );
          })}
        </TBody>
      </Table>
      <p className="px-4 py-3 text-xs text-faint">
        A rate can only start in the future, and rates already in force cannot be edited or removed. That is what keeps
        settled commission fixed: every box is paid at the rate that was in force when its order was created.
      </p>
    </Card>
  );
}

// ── Admin: sales bonus ───────────────────────────────────────────────────────
function BonusSettings() {
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
    onSuccess: () => { toast.success('Bonus paid — that rep\u2019s count starts again from zero'); refresh(); },
    onError: (e) => toast.error(apiError(e)),
  });

  const valid = Number(target) > 0 && Number(amount) > 0;
  return (
    <Card className="mt-6">
      <CardHeader title="Sales bonus" subtitle="Reach a sales target, earn a bonus. Kept entirely separate from box commission." />
      <div className="grid grid-cols-1 gap-3 border-b border-border p-4 sm:grid-cols-4">
        <Field label="Sales target" required><Input type="number" min="0" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="10000000" /></Field>
        <Field label="Bonus amount" required><Input type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="500000" /></Field>
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
                <div className="flex justify-end gap-1">
                  {/* Figures are only editable while nothing has been earned under them. */}
                  {(r._count?.awards ?? 0) === 0 && (
                    <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => startEdit(r)}>Edit</Button>
                  )}
                  <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => toggle.mutate({ id: r.id, isActive: !r.isActive })}>
                    {r.isActive ? 'Switch off' : 'Switch on'}
                  </Button>
                </div>
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
                        <div className={clsx('h-full rounded-full', i.claimable ? 'bg-emerald-400' : 'bg-brand-500')} style={{ width: `${Math.min(100, i.progress)}%` }} />
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
                      {(i.tiers || []).filter((t) => t.reached).map((t) => (
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
      <p className="px-4 py-3 text-xs text-faint">
        Bonus money never enters a rep's commission balance and never changes what a box is worth — it is paid on its own.
        Sales count from the date set above, so moving that date back counts selling the reps have already done. A rule
        can be edited freely until someone earns it; after that the terms are fixed and a new rule replaces it.
      </p>
    </Card>
  );
}

// One row per rep. It opens on the RUN IN PROGRESS — boxes settled and money
// owed since that rep was last paid — because a lifetime total answers "how big
// has this rep been", while the question the owner is actually asking at this
// table is "since I paid him, how is he doing, and what do I owe him now".
//
// Nothing is lost: the lifetime figures are the other half of the switch, with
// total boxes, total earned and everything ever paid out.
function BalancesTable({ items }) {
  const [view, setView] = useState('run');
  const runView = view === 'run';
  return (
    <Card className="mt-4">
      <CardHeader
        title="Commission by representative"
        subtitle={runView ? 'Since each rep was last paid' : 'Everything since day one'}
        action={<RunSwitch value={view} onChange={setView} />}
      />
      <Table>
        <THead>
          <TR>
            <TH>Rep</TH>
            <TH>{runView ? 'Boxes this run' : 'Boxes settled'}</TH>
            <TH>Earned</TH>
            <TH>{runView ? 'Fines' : 'Penalties'}</TH>
            {!runView && <TH>Paid</TH>}
            <TH>Available</TH>
          </TR>
        </THead>
        <TBody>{items.map((i) => {
          const run = i.run || {};
          const fines = runView ? (run.penalties || 0) : i.penalties;
          const carried = runView ? wholeShillings(run.broughtForward) : 0;
          return (
            <TR key={i.salesRepId}>
              <TD className="font-medium">
                {i.name}
                {runView && (
                  // Every rep's run starts on their own date, so the row has to
                  // say which date it is measuring from or the boxes mean nothing.
                  <div className="mt-0.5 text-[11px] font-normal text-faint">
                    {run.since ? `since ${formatDate(run.since)}` : 'never withdrawn'}
                  </div>
                )}
              </TD>
              <TD className="tabular-nums">{formatNumber(runView ? (run.boxes || 0) : i.boxesSettled)}</TD>
              <TD className="tabular-nums">
                {formatCurrency(runView ? (run.earned || 0) : i.earned)}
                {/* An agreed one-off adjustment makes lifetime Earned differ from
                    boxes × rate — say so on the row, or the arithmetic looks
                    broken. In the run view it sits in brought forward instead,
                    because it was never earned on this run's boxes. */}
                {!runView && Number(i.adjustment) !== 0 && (
                  <span
                    className="ml-1 cursor-help text-amber-400"
                    title={`${formatCurrency(i.grossEarned)} earned ${Number(i.adjustment) < 0 ? '−' : '+'} ${formatCurrency(Math.abs(i.adjustment))} adjustment${i.adjustmentNote ? ` — ${i.adjustmentNote}` : ''}`}
                  >*</span>
                )}
              </TD>
              <TD className={fines > 0 ? 'font-semibold tabular-nums text-rose-400' : 'text-faint'}>
                {fines > 0 ? `−${formatCurrency(fines)}` : '—'}
              </TD>
              {!runView && <TD className="tabular-nums">{formatCurrency(i.paid)}</TD>}
              <TD className={clsx('tabular-nums', i.available < 0 && 'font-semibold text-rose-400')}>
                {formatCurrency(i.available)}
                {/* What the balance was already carrying when this run opened —
                    a part-taken payout leaves a remainder behind. Shown only
                    when there is one, so that earned − fines + this always
                    comes to the figure above it. */}
                {runView && carried !== 0 && (
                  <div className="text-[10px] text-faint">
                    {carried > 0 ? '+' : '−'}{formatCurrency(Math.abs(carried))} brought forward
                  </div>
                )}
                {i.pendingRequests > 0 && (
                  <div className="text-[10px] text-faint">{formatCurrency(i.pendingRequests)} requested</div>
                )}
              </TD>
            </TR>
          );
        })}</TBody>
      </Table>
      {runView && (
        <p className="border-t border-border px-5 py-3 text-xs text-faint">
          A run closes the moment a rep is paid, and the next one opens there. Whatever was left over comes forward,
          so earned − fines + brought forward is always what he can withdraw today.
        </p>
      )}
    </Card>
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
            value === o.k ? 'bg-brand-500 text-black' : 'text-muted hover:text-foreground',
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
  const [deducting, setDeducting] = useState(false);
  const [tab, setTab] = useState('balances');
  const [openWd, setOpenWd] = useState(null); // a withdrawal being read
  const { data: summary, isLoading } = useQuery({ queryKey: ['commissions', 'summary'], queryFn: async () => unwrap(await api.get('/commissions/summary')).data });
  const { data: wd } = useQuery({ queryKey: ['commissions', 'withdrawals', 'all'], queryFn: async () => unwrap(await api.get('/commissions/withdrawals', { params: { limit: 30 } })) });
  // Same query key as FinesHistory, so this shares its cache rather than refetching.
  const { data: penaltyData } = useQuery({
    queryKey: ['penalties', 'all'],
    queryFn: async () => unwrap(await api.get('/penalties', { params: { limit: 50 } })),
  });
  // Only fines still charged are worth a badge — counted by the SERVER over
  // the whole table. Counting the visible page understated it as soon as the
  // history outgrew one page.
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
  return (
    <>
      {/* This page answers "what do I owe, and how are they doing since I last
          paid them" — so it leads with the payable and the run in progress. The
          lifetime totals are still here, as the hint under the figure they
          explain, rather than as headlines of their own. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        {/* "Total pending" was earned − paid, which still contained fines the
            reps will never receive — this is the money actually withdrawable. */}
        <StatCard label="Available to withdraw" value={formatCurrency(summary.totals.available ?? summary.totals.pending)} icon={Clock} tone="amber"
          hint={summary.totals.requested > 0 ? `+ ${formatCurrency(summary.totals.requested)} requested` : 'after fines & payouts'} />
        <StatCard label="Boxes this run" value={formatNumber(summary.totals.runBoxes ?? 0)} icon={Boxes} tone="violet"
          hint={`${formatCurrency(summary.totals.runEarned ?? 0)} earned since each rep's last payout`} />
        <StatCard label="Paid out" value={formatCurrency(summary.totals.paid)} icon={Wallet} tone="emerald"
          hint={`of ${formatCurrency(summary.totals.earned)} earned all time`} />
        <StatCard label="Total penalties" value={formatCurrency(summary.totals.penalties)} icon={AlertTriangle} tone="rose" />
      </div>

      <div className="mt-4 flex justify-end">
        <Button variant="secondary" loading={applyPenalties.isPending} onClick={() => applyPenalties.mutate()}>
          <AlertTriangle className="h-4 w-4" /> Apply daily penalties
        </Button>
        <Button variant="secondary" onClick={() => setDeducting(true)}>
          <Coins className="h-4 w-4" /> Deduct commission
        </Button>
      </div>
      {deducting && <DeductModal reps={summary?.items || []} onClose={() => setDeducting(false)} />}
      {openWd && (
        <WithdrawalDetail
          w={openWd}
          balance={(summary?.items || []).find((r) => r.salesRepId === openWd.salesRepId)?.available ?? null}
          onClose={() => setOpenWd(null)}
          refresh={() => ['commissions', 'dashboard'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }))}
        />
      )}

      <PendingWithdrawalsStrip
        items={(wd?.data || []).filter((w) => w.status === 'PENDING')}
        refresh={() => ['commissions', 'dashboard'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }))}
        onOpen={setOpenWd}
      />

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

      {tab === 'balances' && <BalancesTable items={summary.items} />}

      {tab === 'penalties' && <FinesHistory admin />}

      {tab === 'payouts' && (
      <Card className="mt-4">
        <CardHeader title="Withdrawal requests" />
        {!wd?.data?.length ? <EmptyState title="No withdrawal requests" /> : (
          <Table>
            <THead><TR><TH>Rep</TH><TH>Amount</TH><TH>Status</TH><TH>Requested</TH><TH /></TR></THead>
            <TBody>{wd.data.map((w) => (
              <TR key={w.id}>
                <TD className="font-medium">
                  <button type="button" onClick={() => setOpenWd(w)} className="text-left hover:text-brand-300">
                    {w.salesRep?.user?.name}
                  </button>
                </TD>
                <TD>
                  <button type="button" onClick={() => setOpenWd(w)} className="text-left">
                    <div className="font-semibold tabular-nums text-foreground">{formatCurrency(w.amount)}</div>
                  {/* Where to send it. This is the whole point of the request,
                      and it was only visible by hovering a different column. */}
                    {w.notes && <div className="mt-0.5 text-[11px] text-brand-300">{w.notes}</div>}
                  </button>
                </TD>
                <TD><Badge className={WITHDRAWAL_STATUS_META[w.status]?.cls}>{WITHDRAWAL_STATUS_META[w.status]?.label}</Badge></TD>
                <TD className="text-faint">{formatDateTime(w.requestedAt)}</TD>
                <TD>
                  <div className="flex justify-end gap-1">
                    {w.status === 'PENDING' && <>
                      <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => decide.mutate({ id: w.id, action: 'APPROVE' })}>Approve</Button>
                      <Button variant="ghost" className="px-2 py-1 text-xs text-rose-600" onClick={() => decide.mutate({ id: w.id, action: 'REJECT' })}>Reject</Button>
                    </>}
                    {w.status === 'APPROVED' && (
                      // One button, because there is only one truth: rep
                      // commission comes out of the owner's own pocket, for
                      // both brands. The pair that stood here offered "paid
                      // from business" as though a wallet could fund it — the
                      // two called the same endpoint with the same result, and
                      // the choice only invited the confusion the Commission
                      // account exists to end.
                      <Button className="px-2 py-1 text-xs" onClick={() => decide.mutate({ id: w.id, action: 'PAY', fromOwnPocket: true })}>
                        Mark paid — from my pocket
                      </Button>
                    )}
                  </div>
                </TD>
              </TR>
            ))}</TBody>
          </Table>
        )}
      </Card>

      )}

      {tab === 'rules' && (
        <>
          <CommissionRateSettings />
          <BonusSettings />
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
        <PageHeader title="Commissions" subtitle={isRep ? 'Your commission earnings and withdrawals.' : 'Commission performance and withdrawal approvals.'} />
      )}
      {isRep ? <RepView /> : <AdminView />}
    </div>
  );
}
