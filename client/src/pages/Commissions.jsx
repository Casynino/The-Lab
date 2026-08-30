import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import BonusProgress from '@/components/BonusProgress';
import { Coins, Wallet, Clock, TrendingUp, AlertTriangle, Info, ShieldAlert, HeartHandshake } from 'lucide-react';
import api, { unwrap, apiError } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { ROLES, WITHDRAWAL_STATUS_META } from '@/lib/constants';
import { formatCurrency, formatNumber, formatDateTime } from '@/lib/format';
import {
  PageHeader, Card, CardHeader, StatCard, PageSpinner, EmptyState, Badge, Button, Modal, Field, Input, Textarea,
  Pagination, Select, Table, THead, TBody, TR, TH, TD,
} from '@/components/ui';

function WithdrawModal({ available, minWithdrawal, onClose }) {
  const qc = useQueryClient();
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const req = useMutation({
    mutationFn: () => api.post('/commissions/withdrawals', { amount: Number(amount), notes: notes || undefined }),
    onSuccess: () => { toast.success('Withdrawal requested'); qc.invalidateQueries({ queryKey: ['commissions'] }); onClose(); },
    onError: (e) => toast.error(apiError(e)),
  });
  const amt = Number(amount);
  const valid = amt > 0 && amt <= available;
  return (
    <Modal open onClose={onClose} title="Request commission withdrawal"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={req.isPending} disabled={!valid} onClick={() => req.mutate()}>Request withdrawal</Button></>}>
      <div className="space-y-4">
        <div className="rounded-lg bg-emerald-500/10 p-3 text-sm text-emerald-300">
          Available balance: <b>{formatCurrency(available)}</b>
        </div>
        <Field label="Amount" required hint={`Max ${formatCurrency(available)}`}>
          <Input type="number" min="0" max={available} value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
        </Field>
        <Field label="Notes"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
    </Modal>
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
            <p className="mt-1.5 text-[11px] leading-none text-muted">
              {canWithdraw
                ? <span className="font-semibold text-emerald-400">Ready to withdraw</span>
                : `${formatCurrency(c.available)} of ${formatCurrency(c.minWithdrawal)} minimum`}
            </p>
          </>
        )}
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <MiniStat label="Earned" value={c.earned} />
        <MiniStat label="Paid out" value={c.paid} />
        <MiniStat
          label={hasPenalties ? 'Fines' : 'Pending'}
          value={hasPenalties ? c.penalties : c.pendingRequests}
          tone={hasPenalties ? 'rose' : undefined}
        />
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
          {!withdrawals.length ? <EmptyState title="No withdrawals yet" /> : (
            <Table>
              <THead><TR><TH>Amount</TH><TH>Status</TH><TH>Requested</TH></TR></THead>
              <TBody>{withdrawals.map((w) => (
                <TR key={w.id}>
                  <TD className="font-medium">{formatCurrency(w.amount)}</TD>
                  <TD><Badge className={WITHDRAWAL_STATUS_META[w.status]?.cls}>{WITHDRAWAL_STATUS_META[w.status]?.label}</Badge></TD>
                  <TD className="text-faint">{formatDateTime(w.requestedAt)}</TD>
                </TR>
              ))}</TBody>
            </Table>
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

      {open && <WithdrawModal available={c.available} minWithdrawal={c.minWithdrawal} onClose={() => setOpen(false)} />}
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

function AdminView() {
  const qc = useQueryClient();
  const [deducting, setDeducting] = useState(false);
  const [tab, setTab] = useState('balances');
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
    mutationFn: ({ id, action }) => api.post(`/commissions/withdrawals/${id}/decide`, { action }),
    onSuccess: () => { toast.success('Updated'); qc.invalidateQueries({ queryKey: ['commissions'] }); },
    onError: (e) => toast.error(apiError(e)),
  });

  if (isLoading || !summary) return <PageSpinner />;
  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <StatCard label="Total earned" value={formatCurrency(summary.totals.earned)} icon={Coins} tone="violet" />
        <StatCard label="Total paid" value={formatCurrency(summary.totals.paid)} icon={Wallet} tone="emerald" />
        {/* "Total pending" was earned − paid, which still contained fines the
            reps will never receive — this is the money actually withdrawable. */}
        <StatCard label="Available to withdraw" value={formatCurrency(summary.totals.available ?? summary.totals.pending)} icon={Clock} tone="amber"
          hint={summary.totals.requested > 0 ? `+ ${formatCurrency(summary.totals.requested)} requested` : 'after fines & payouts'} />
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

      {tab === 'balances' && (
      <Card className="mt-4">
        <CardHeader title="Commission by representative" />
        <Table>
          <THead>
            <TR>
              <TH>Rep</TH>
              <TH>Boxes settled</TH>
              <TH>Earned</TH>
              <TH>Penalties</TH>
              <TH>Paid</TH>
              <TH>Available</TH>
            </TR>
          </THead>
          <TBody>{summary.items.map((i) => (
            <TR key={i.salesRepId}>
              <TD className="font-medium">{i.name}</TD>
              <TD>{formatNumber(i.boxesSettled)}</TD>
              {/* An agreed one-off adjustment makes Earned differ from boxes ×
                  rate — say so on the row, or the arithmetic looks broken. */}
              <TD>
                {formatCurrency(i.earned)}
                {Number(i.adjustment) !== 0 && (
                  <span
                    className="ml-1 cursor-help text-amber-400"
                    title={`${formatCurrency(i.grossEarned)} earned ${Number(i.adjustment) < 0 ? '−' : '+'} ${formatCurrency(Math.abs(i.adjustment))} adjustment${i.adjustmentNote ? ` — ${i.adjustmentNote}` : ''}`}
                  >*</span>
                )}
              </TD>
              <TD className={i.penalties > 0 ? 'text-rose-400 font-semibold' : 'text-faint'}>
                {i.penalties > 0 ? `−${formatCurrency(i.penalties)}` : '—'}
              </TD>
              <TD>{formatCurrency(i.paid)}</TD>
              <TD className={i.available < 0 ? 'text-rose-400 font-semibold' : ''}>
                {formatCurrency(i.available)}
                {i.pendingRequests > 0 && (
                  <div className="text-[10px] text-faint">{formatCurrency(i.pendingRequests)} requested</div>
                )}
              </TD>
            </TR>
          ))}</TBody>
        </Table>
      </Card>

      )}

      {tab === 'penalties' && <FinesHistory admin />}

      {tab === 'payouts' && (
      <Card className="mt-4">
        <CardHeader title="Withdrawal requests" />
        {!wd?.data?.length ? <EmptyState title="No withdrawal requests" /> : (
          <Table>
            <THead><TR><TH>Rep</TH><TH>Amount</TH><TH>Status</TH><TH>Requested</TH><TH /></TR></THead>
            <TBody>{wd.data.map((w) => (
              <TR key={w.id}>
                <TD className="font-medium">{w.salesRep?.user?.name}</TD>
                <TD>{formatCurrency(w.amount)}</TD>
                <TD><Badge className={WITHDRAWAL_STATUS_META[w.status]?.cls}>{WITHDRAWAL_STATUS_META[w.status]?.label}</Badge></TD>
                <TD className="text-faint">{formatDateTime(w.requestedAt)}</TD>
                <TD>
                  <div className="flex justify-end gap-1">
                    {w.status === 'PENDING' && <>
                      <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => decide.mutate({ id: w.id, action: 'APPROVE' })}>Approve</Button>
                      <Button variant="ghost" className="px-2 py-1 text-xs text-rose-600" onClick={() => decide.mutate({ id: w.id, action: 'REJECT' })}>Reject</Button>
                    </>}
                    {w.status === 'APPROVED' && <Button className="px-2 py-1 text-xs" onClick={() => decide.mutate({ id: w.id, action: 'PAY' })}>Mark paid</Button>}
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
