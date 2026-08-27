import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
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
  const { data } = useQuery({
    queryKey: ['penalties', admin ? 'all' : 'mine'],
    queryFn: async () => unwrap(await api.get('/penalties', { params: { limit: 50 } })),
  });
  const items = data?.data || [];
  if (!items.length) return null;
  return (
    <Card className="mt-6">
      <CardHeader
        title="Penalty transactions"
        subtitle={admin
          ? 'Every late-settlement fine — a permanent record. Forgiven fines stay listed but no longer reduce the balance.'
          : 'Late-settlement fines currently charged to you. Forgiven fines are written off and are not shown.'} />
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
                    ? <Badge className="bg-emerald-100 text-emerald-700" title={p.waiveReason || undefined}>Forgiven</Badge>
                    : <Badge className="bg-rose-100 text-rose-700">Applied</Badge>}
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

// Progress toward the sales bonus. Shown to the rep and on the admin list.
function BonusProgressCard({ p }) {
  if (!p?.configured) return null;
  const pct = Math.max(0, Math.min(100, p.progress || 0));
  return (
    <Card className="mt-4">
      <CardHeader
        title="Sales bonus"
        subtitle={p.unlocked ? 'Target reached — this is separate from your box commission.' : 'Separate from your box commission.'}
      />
      <div className="p-4 pt-0">
        {p.unlocked ? (
          <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3">
            <p className="text-sm font-semibold text-emerald-400">Bonus unlocked</p>
            <p className="mt-1 text-2xl font-bold text-emerald-300">{formatCurrency(p.bonusAmount)}</p>
            <p className="mt-1 text-xs text-muted">
              {p.award?.status === 'PAID' ? 'Paid.' : 'Waiting to be paid by The Lab.'}
            </p>
          </div>
        ) : (
          <>
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-wide text-faint">Current sales</p>
                <p className="text-xl font-bold text-foreground">{formatCurrency(p.sales)}</p>
              </div>
              <div className="text-right">
                <p className="text-xs uppercase tracking-wide text-faint">Target</p>
                <p className="text-xl font-bold text-muted">{formatCurrency(p.target)}</p>
              </div>
            </div>
            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-brand-500 transition-all" style={{ width: `${pct}%` }} />
            </div>
            <div className="mt-2 flex justify-between text-xs text-muted">
              <span>{pct}% of the way</span>
              <span>{formatCurrency(p.remaining)} to go</span>
            </div>
            <p className="mt-3 text-sm text-muted">
              Reach the target and earn <span className="font-semibold text-emerald-400">{formatCurrency(p.bonusAmount)}</span>.
            </p>
          </>
        )}
      </div>
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

function RepView() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const { data: c, isLoading } = useQuery({ queryKey: ['commissions', 'me'], queryFn: async () => unwrap(await api.get('/commissions/me')).data });
  const { data: wd } = useQuery({ queryKey: ['commissions', 'withdrawals', 'mine'], queryFn: async () => unwrap(await api.get('/commissions/withdrawals', { params: { limit: 20 } })) });
  const { data: bonusProgress } = useQuery({ queryKey: ['bonus', 'me'], queryFn: async () => unwrap(await api.get('/commissions/bonus/me')).data });

  if (isLoading || !c) return <PageSpinner />;

  const hasPenalties = c.penalties > 0;
  const balanceNegative = c.available < 0;
  const canWithdraw = c.available >= c.minWithdrawal;

  return (
    <>
      <div className={`grid grid-cols-1 gap-4 sm:grid-cols-2 ${hasPenalties ? 'xl:grid-cols-5' : 'xl:grid-cols-4'}`}>
        <StatCard
          label="Available Balance"
          value={formatCurrency(c.available)}
          icon={balanceNegative ? ShieldAlert : Wallet}
          tone={balanceNegative ? 'rose' : 'emerald'}
          hint={balanceNegative ? 'Penalty debt — settle overdue orders' : 'Ready to withdraw'}
        />
        <StatCard
          label="Total Earned"
          value={formatCurrency(c.earned)}
          icon={Coins}
          tone="violet"
          hint={[
            c.earnedByBrand?.length
              ? c.earnedByBrand.map((b) => `${formatNumber(b.boxes)} ${b.brand}`).join(' · ')
              : `${formatNumber(c.boxesSettled)} boxes settled`,
            // Without this the rep reads a total that his own box count contradicts.
            c.adjustment ? `adjustment ${formatCurrency(c.adjustment)}` : null,
          ].filter(Boolean).join(' · ')}
        />
        <StatCard label="Total Paid Out" value={formatCurrency(c.paid)} icon={TrendingUp} tone="brand" />
        <StatCard label="Pending Requests" value={formatCurrency(c.pendingRequests)} icon={Clock} tone="amber" hint="Awaiting approval" />
        {hasPenalties && (
          <StatCard label="Total Penalties" value={formatCurrency(c.penalties)} icon={AlertTriangle} tone="rose" hint="Deducted from balance" />
        )}
      </div>

      {c.adjustmentNote && (
        <div className="mt-4 rounded-lg border border-border bg-elevated px-3 py-2 text-sm text-muted">
          <span className="font-medium text-foreground">Commission adjustment {formatCurrency(c.adjustment)}</span> — {c.adjustmentNote}
        </div>
      )}

      <div className="mt-4">
        <div className="flex items-center justify-between gap-4">
          {balanceNegative ? (
            <p className="text-sm text-rose-400">
              Your balance is negative due to overdue penalties. Settle your outstanding orders to restore your balance before withdrawing.
            </p>
          ) : !canWithdraw ? (
            <p className="text-sm text-amber-400">
              Minimum withdrawal is {formatCurrency(c.minWithdrawal)} — keep settling to reach it.
            </p>
          ) : null}
          <div className="ml-auto">
            <Button onClick={() => setOpen(true)} disabled={!canWithdraw}>
              <Coins className="h-4 w-4" /> Request withdrawal
            </Button>
          </div>
        </div>
        {!balanceNegative && !canWithdraw && (
          <WithdrawalProgress available={c.available} minimum={c.minWithdrawal} />
        )}
      </div>

      {hasPenalties && <PenaltyBreakdown breakdown={c.penaltyBreakdown} />}

      <RatesCard rates={c.rates} />
      <BonusProgressCard p={bonusProgress} />

      <Card className="mt-4">
        <CardHeader title="My withdrawal requests" subtitle={`Minimum withdrawal: ${formatCurrency(c.minWithdrawal)}`} />
        {!wd?.data?.length ? <EmptyState title="No withdrawals yet" /> : (
          <Table>
            <THead><TR><TH>Amount</TH><TH>Status</TH><TH>Requested</TH></TR></THead>
            <TBody>{wd.data.map((w) => (
              <TR key={w.id}><TD className="font-medium">{formatCurrency(w.amount)}</TD><TD><Badge className={WITHDRAWAL_STATUS_META[w.status]?.cls}>{WITHDRAWAL_STATUS_META[w.status]?.label}</Badge></TD><TD className="text-faint">{formatDateTime(w.requestedAt)}</TD></TR>
            ))}</TBody>
          </Table>
        )}
      </Card>

      <FinesHistory admin={false} />

      <PenaltyPolicyCard />

      {open && <WithdrawModal available={c.available} minWithdrawal={c.minWithdrawal} onClose={() => setOpen(false)} />}
    </>
  );
}

// Manual commission deduction: remove an amount from a rep's balance without
// touching money or future accrual. Reversible via Forgive.
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
    mutationFn: (id) => api.post(`/commissions/bonus/awards/${id}/pay`),
    onSuccess: () => { toast.success('Bonus marked paid'); refresh(); }, onError: (e) => toast.error(apiError(e)),
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
            <THead><TR><TH>Rep</TH><TH className="text-right">Sales</TH><TH className="text-right">Target</TH><TH>Progress</TH><TH>Status</TH></TR></THead>
            <TBody>
              {progress.items.filter((i) => i.configured).map((i) => (
                <TR key={i.salesRepId}>
                  <TD className="font-medium text-foreground">{i.name}</TD>
                  <TD className="text-right">{formatCurrency(i.sales)}</TD>
                  <TD className="text-right text-muted">{formatCurrency(i.target)}</TD>
                  <TD>
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-white/10">
                        <div className="h-full rounded-full bg-brand-500" style={{ width: `${Math.min(100, i.progress)}%` }} />
                      </div>
                      <span className="text-xs text-muted">{i.progress}%</span>
                    </div>
                  </TD>
                  <TD>{i.unlocked ? <Badge className="bg-emerald-100 text-emerald-700">Unlocked</Badge> : <span className="text-xs text-faint">{formatCurrency(i.remaining)} to go</span>}</TD>
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
            <THead><TR><TH>Rep</TH><TH className="text-right">Bonus</TH><TH>Unlocked</TH><TH>Status</TH><TH /></TR></THead>
            <TBody>
              {awards.map((a) => (
                <TR key={a.id}>
                  <TD className="font-medium text-foreground">{a.salesRep?.user?.name || a.salesRep?.code}</TD>
                  <TD className="text-right font-semibold text-emerald-500">{formatCurrency(a.bonusAmount)}</TD>
                  <TD className="text-muted">{formatDateTime(a.unlockedAt)}</TD>
                  <TD><Badge className={a.status === 'PAID' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}>{a.status}</Badge></TD>
                  <TD>
                    <div className="flex justify-end">
                      {a.status !== 'PAID' && <Button className="px-2 py-1 text-xs" loading={pay.isPending} onClick={() => pay.mutate(a.id)}>Mark paid</Button>}
                    </div>
                  </TD>
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
  const { data: summary, isLoading } = useQuery({ queryKey: ['commissions', 'summary'], queryFn: async () => unwrap(await api.get('/commissions/summary')).data });
  const { data: wd } = useQuery({ queryKey: ['commissions', 'withdrawals', 'all'], queryFn: async () => unwrap(await api.get('/commissions/withdrawals', { params: { limit: 30 } })) });

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
        <StatCard label="Total pending" value={formatCurrency(summary.totals.pending)} icon={Clock} tone="amber" />
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
              <TD>{formatCurrency(i.earned)}</TD>
              <TD className={i.penalties > 0 ? 'text-rose-400 font-semibold' : 'text-faint'}>
                {i.penalties > 0 ? `−${formatCurrency(i.penalties)}` : '—'}
              </TD>
              <TD>{formatCurrency(i.paid)}</TD>
              <TD className={i.available < 0 ? 'text-rose-400 font-semibold' : ''}>
                {formatCurrency(i.available)}
              </TD>
            </TR>
          ))}</TBody>
        </Table>
      </Card>

      <FinesHistory admin />

      <Card className="mt-6">
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

      <CommissionRateSettings />
      <BonusSettings />
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
