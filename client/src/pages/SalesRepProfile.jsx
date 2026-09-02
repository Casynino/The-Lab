import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import {
  ArrowLeft, Package, Timer, Wallet, AlertTriangle, TrendingUp, History,
  ShieldCheck, ShieldAlert, Power, CheckCircle2, Clock, Undo2, ClipboardList,
  Boxes, ChevronRight, Mail, Phone, MapPin, Calendar, Coins, PackagePlus, Pencil, MessageCircle, Gauge,
} from 'lucide-react';
import api, { unwrap, apiError } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { ROLES, SETTLEMENT_STATUS_META } from '@/lib/constants';
import { formatCurrency, formatNumber, formatDate, formatDateTime, initials } from '@/lib/format';
import { sortByCanonical } from '@/lib/productOrder';
import { TZ_REGIONS } from '@/lib/regions';
import OrderDetailModal from '@/components/OrderDetail';
import ProgressRows from '@/components/ProgressRows';
import WithdrawalNote, { PayoutHistory, withdrawalState } from '@/components/WithdrawalNote';
import { TrendChart } from '@/components/charts';
import {
  PageHeader, Card, PageSpinner, EmptyState, Badge, Button, StatCard,
  Table, THead, TBody, TR, TH, TD, Modal, Field, Select, Input, Textarea,
} from '@/components/ui';

// ── Section wrapper ──────────────────────────────────────────────────────────
function Section({ icon: Icon, title, count, children, action }) {
  return (
    <Card>
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          {Icon && <Icon className="h-4 w-4 text-brand-500" />}
          <h2 className="text-sm font-bold text-foreground">{title}</h2>
          {count != null && <span className="rounded-full bg-elevated px-2 py-0.5 text-[11px] font-semibold text-muted">{count}</span>}
        </div>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </Card>
  );
}

function Money({ label, value, tone = 'default', sub }) {
  const tones = { default: 'text-foreground', emerald: 'text-emerald-500', rose: 'text-rose-500', brand: 'text-brand-500', amber: 'text-amber-500' };
  return (
    <div className="rounded-xl border border-border bg-elevated p-3">
      <div className="text-[11px] uppercase tracking-wide text-faint">{label}</div>
      <div className={`mt-0.5 text-lg font-bold tabular-nums ${tones[tone]}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-faint">{sub}</div>}
    </div>
  );
}

// The rep's on-time grade, worded and rounded exactly as the Sales Reps list
// card words and rounds it (SalesReps.jsx gradeOf) — the same fraction from the
// same server field, so the two screens can never print different verdicts on
// the same rep.
function gradeOf(d) {
  const settled = Number(d?.settledOrders || 0);
  const onTime = Number(d?.onTimeOrders || 0);
  if (d?.onTimeRate == null || settled <= 0) {
    // "none closed yet" is a lie when orders ARE closed but none can be timed.
    return { known: false, sub: Number(d?.closed || 0) > 0 ? 'none timed yet' : 'none closed yet' };
  }
  // Rounding must neither flatter nor libel: a rep who was late once can never
  // read 100, and a rep who was on time once can never read 0.
  let pct = Math.round(Number(d.onTimeRate));
  if (pct >= 100 && onTime < settled) pct = 99;
  if (pct <= 0 && onTime > 0) pct = 1;
  pct = Math.min(100, Math.max(0, pct));
  return { known: true, pct, sub: `of ${formatNumber(settled)} closed` };
}

// ── Closing speed ────────────────────────────────────────────────────────────
// The on-time rate says how OFTEN a rep makes the deadline. It cannot say by how
// much, and those are different reps: one who clears at a third of his window
// and one who lands at 97% of it both score "on time", and only one of them is
// still fine the week the roads are bad. Every row here is one closed order
// drawn against the window it actually had — 72h, or 168h once the rep has spent
// his one extension — on a single shared scale, so the deadline sits at the same
// point on every row and reads as one line down the list. Anything crossing it
// was late, and by how far.
//
// The grading is the server's (`settlements.closings`), never recomputed here: a
// row badge that disagreed with the percentage in the other column is precisely
// the bug this section would otherwise introduce.
function medianOf(xs) {
  if (!xs.length) return null;
  const a = [...xs].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

// Whole literal strings — a class assembled at runtime compiles to nothing.
function barTone(row) {
  if (!row.timed) return 'bg-white/20';
  if (row.ratio > 1) return 'bg-rose-500';
  if (row.ratio >= 0.8) return 'bg-amber-500';
  return 'bg-emerald-500';
}

function ClosingSpeed({ closings, discipline, onOpen }) {
  // Field not shipped by this server build: say nothing, rather than tell a rep
  // with fifty closed orders that he has none.
  if (!Array.isArray(closings)) return null;

  const rows = closings.map((o) => {
    const timed = o.hoursTaken != null && o.windowHours > 0;
    return { ...o, timed, ratio: timed ? o.hoursTaken / o.windowHours : null };
  });
  const timed = rows.filter((r) => r.timed);
  const untimed = rows.length - timed.length;

  // One scale for every row, so a bar end means the same thing on all of them.
  // It stretches to the worst order and stops at twice the window: without a
  // ceiling, one order abandoned for three weeks squashes every other bar into
  // the left edge and the section stops answering its own question.
  const worst = timed.reduce((m, r) => Math.max(m, r.ratio), 0);
  const axisMax = Math.min(2, Math.max(1.15, Math.ceil(worst * 4) / 4));
  const deadlineX = 100 / axisMax;
  // The share of the window, not raw hours: an order graded against 168h and one
  // graded against 72h are not comparable in hours, and the hours are on the row.
  const medRatio = medianOf(timed.map((r) => r.ratio));
  // The rate is graded over every order the rep ever closed; this list is the
  // most recent handful. Say so, or the reader reads the rate off six bars.
  const deeper = discipline?.closed != null && discipline.closed > rows.length;

  return (
    <Section
      icon={Gauge}
      title="Closing speed"
      action={<span className="text-xs text-faint">{rows.length ? `${formatNumber(rows.length)} most recent closures` : 'no closures yet'}</span>}
    >
      {!rows.length ? (
        <p className="py-2 text-sm text-faint">
          Nothing closed yet, so there is no closing record behind the on-time rate.
          {discipline?.overdue > 0
            ? ` ${formatNumber(discipline.overdue)} of the orders they are holding ${discipline.overdue === 1 ? 'is already past its deadline' : 'are already past their deadlines'}.`
            : discipline?.open > 0 ? ' Every order they hold is still inside its window.' : ''}
        </p>
      ) : (
        <>
          {medRatio != null && timed.length >= 3 && (
            <p className="text-xs text-muted">
              Half of these closed inside{' '}
              <span className="font-semibold tabular-nums text-foreground">{Math.round(medRatio * 100)}%</span>
              {' '}of the window they had.
            </p>
          )}

          <ul className="mt-2 divide-y divide-white/[0.06]">
            {rows.map((r) => (
              <li key={r.id || r.settlementNumber}>
                <button
                  type="button"
                  onClick={() => onOpen?.(r.id)}
                  className="w-full rounded-lg px-2 py-2 text-left transition hover:bg-elevated"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-xs font-semibold text-foreground">{r.settlementNumber}</span>
                    <span className="shrink-0 text-[11px] tabular-nums text-muted">
                      {r.timed
                        ? <>{Math.round(r.hoursTaken)}h <span className="font-normal text-faint">of {r.windowHours}</span></>
                        : <span className="text-faint">no close time</span>}
                    </span>
                  </div>
                  <div className="relative mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.07]">
                    {r.timed && (
                      <div
                        className={`h-full rounded-full ${barTone(r)}`}
                        style={{ width: `${Math.max(2, (Math.min(r.ratio, axisMax) / axisMax) * 100)}%` }}
                      />
                    )}
                    <div className="absolute inset-y-0 w-px bg-white/40" style={{ left: `${deadlineX}%` }} />
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-faint">
                    <span className="truncate">
                      {r.settledAt ? `closed ${formatDate(r.settledAt)}` : 'close date not recorded'}
                      {r.value ? ` · ${formatCurrency(r.value)} taken out` : ''}
                    </span>
                    {/* The extension appears nowhere else on this page. A rep who
                        spends it every time grades clean while running 168h. */}
                    {r.extended && <span className="shrink-0 text-amber-400">used the +96h</span>}
                  </div>
                </button>
              </li>
            ))}
          </ul>

          {timed.length > 0 && (
            <p className="mt-2 text-[11px] text-faint">The line is each order&rsquo;s deadline — a bar past it came back late.</p>
          )}
          {untimed > 0 && (
            <p className="mt-1 text-[11px] text-faint">
              {formatNumber(untimed)} of these closed with no recorded close time, so {untimed === 1 ? 'it is' : 'they are'} not
              timed here and {untimed === 1 ? 'is' : 'are'} left out of the on-time rate rather than counted as having met it.
            </p>
          )}
          {deeper && (
            <p className="mt-1 text-[11px] text-faint">
              The on-time rate is graded over every order this rep has closed, not only these. Older ones are on the Settlements page.
            </p>
          )}
        </>
      )}
    </Section>
  );
}

const ACTIVITY_META = {
  STOCK_REQUEST: { icon: ClipboardList, cls: 'text-slate-400 bg-slate-500/10' },
  ISSUE: { icon: Package, cls: 'text-brand-400 bg-brand-500/10' },
  SETTLEMENT: { icon: CheckCircle2, cls: 'text-emerald-400 bg-emerald-500/10' },
  RETURN: { icon: Undo2, cls: 'text-sky-400 bg-sky-500/10' },
  COMMISSION: { icon: Coins, cls: 'text-violet-400 bg-violet-500/10' },
};

function hoursLabel(h) {
  if (h == null) return '';
  if (h < 0) return `${Math.abs(Math.round(h))}h overdue`;
  if (h < 24) return `${Math.round(h)}h left`;
  return `${Math.round(h / 24)}d left`;
}

// ── Edit rep details (admin) ─────────────────────────────────────────────────
// Name + email live on the user account; phone, region and target on the rep —
// so this saves to both endpoints. Region was the gap that left a rep's sales
// showing as an undefined location.
// Take an amount off this rep's commission balance. Money and future accrual are
// untouched; the rep is told, and the record can be reversed with Forgive.
function DeductCommissionModal({ rep, available, onClose }) {
  const qc = useQueryClient();
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');

  const deduct = useMutation({
    mutationFn: () => api.post('/penalties/adjust', { salesRepId: rep.id, amount: Number(amount), reason }),
    onSuccess: () => {
      toast.success(`${formatCurrency(Number(amount))} deducted from ${rep.name || 'the rep'}'s commission`);
      ['salesRep', 'commissions', 'penalties', 'dashboard'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      onClose();
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const amt = Number(amount);
  const valid = amt > 0 && reason.trim();
  return (
    <Modal open onClose={onClose} title={`Deduct commission — ${rep.name || rep.code}`} footer={
      <>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button loading={deduct.isPending} disabled={!valid} onClick={() => deduct.mutate()}>
          Deduct {amt > 0 ? formatCurrency(amt) : ''}
        </Button>
      </>
    }>
      <div className="space-y-4">
        <Field label="Amount to deduct" required hint={`Available now: ${formatCurrency(available)}`}>
          <Input type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        {/* Clearing the balance exactly is the common case — save the arithmetic. */}
        {available > 0 && (
          <button type="button" className="text-xs text-brand-500 hover:underline" onClick={() => setAmount(String(available))}>
            Use the full available balance ({formatCurrency(available)})
          </button>
        )}
        <Field label="Reason" required hint="Shown to the rep and kept in the record">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Commission removed by The Lab" />
        </Field>
        <p className="text-xs text-faint">
          Removes the amount from available balance only — future commission keeps accruing normally.
          It appears under Overdue &amp; penalties as a manual deduction and can be reversed with Forgive.
        </p>
      </div>
    </Modal>
  );
}

function EditRepModal({ rep, onClose }) {

  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: rep.name || '',
    email: rep.email || '',
    phone: rep.phone || '',
    region: rep.region || '',
    monthlyTarget: rep.monthlyTarget != null ? String(rep.monthlyTarget) : '',
    whatsappPhone: rep.whatsappPhone || '',
    whatsappApiKey: rep.whatsappApiKey || '',
  });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = useMutation({
    mutationFn: async () => {
      const target = form.monthlyTarget === '' ? null : Number(form.monthlyTarget);
      await api.put(`/users/${rep.userId}`, { name: form.name.trim(), email: form.email.trim().toLowerCase() });
      await api.put(`/sales-reps/${rep.id}`, {
        region: form.region.trim() || null,
        phone: form.phone.trim() || null,
        monthlyTarget: target,
        whatsappPhone: form.whatsappPhone.trim() || null,
        whatsappApiKey: form.whatsappApiKey.trim() || null,
      });
    },
    onSuccess: () => {
      toast.success('Rep details updated');
      qc.invalidateQueries({ queryKey: ['sales-rep-profile', rep.id] });
      qc.invalidateQueries({ queryKey: ['sales-reps'] });
      onClose();
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const valid = form.name.trim() && form.email.trim();

  return (
    <Modal
      open
      onClose={onClose}
      title={`Edit ${rep.name || 'rep'} (${rep.code})`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!valid}>
            <Pencil className="h-4 w-4" /> Save changes
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Full name" required><Input value={form.name} onChange={set('name')} placeholder="Full name" /></Field>
        <Field label="Email" required><Input type="email" value={form.email} onChange={set('email')} placeholder="name@example.com" /></Field>
        <Field label="Phone"><Input value={form.phone} onChange={set('phone')} placeholder="07.." /></Field>
        <Field label="Region / location" hint="Where this rep sells — shown on their sales & profile">
          <Select value={form.region} onChange={set('region')}>
            <option value="">— Select region —</option>
            {TZ_REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </Select>
        </Field>
        <Field label="Monthly target (TZS)" hint="Optional">
          <Input type="number" min="0" value={form.monthlyTarget} onChange={set('monthlyTarget')} placeholder="0" />
        </Field>

        <div className="rounded-xl border border-border bg-elevated/40 p-3">
          <div className="mb-1 text-sm font-semibold text-foreground">WhatsApp alerts (CallMeBot)</div>
          <p className="mb-3 text-xs text-faint">
            The rep sends <b>“I allow callmebot to send me messages”</b> to CallMeBot from their own WhatsApp, then
            gives you the number + API key from the reply. Once both are set, all their important alerts (approvals,
            commission earned, deadline reminders, fines) are pushed to their phone.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="WhatsApp number" hint="With country code, starting 255">
              <Input value={form.whatsappPhone} onChange={set('whatsappPhone')} placeholder="2557.." />
            </Field>
            <Field label="CallMeBot API key">
              <Input value={form.whatsappApiKey} onChange={set('whatsappApiKey')} placeholder="From CallMeBot" />
            </Field>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ── Add stock to a rep (admin) ───────────────────────────────────────────────
// Issues boxes OUT of The Lab and attaches them to the rep's active order (or
// opens a new one). The product list is the warehouse's live stock so the admin
// can only pick what The Lab actually holds.
function AddStockModal({ repId, repName, onClose }) {
  const qc = useQueryClient();
  const [productId, setProductId] = useState('');
  const [boxes, setBoxes] = useState('');
  const [reason, setReason] = useState('');

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['inventory', 'balances', 'warehouse', 'add-stock'],
    queryFn: async () => unwrap(await api.get('/inventory/balances', { params: { scope: 'WAREHOUSE', limit: 200 } })).data,
    select: (r) => sortByCanonical(r),
  });

  const selected = rows.find((r) => r.productId === productId) || null;
  const available = selected?.totalBase ?? 0;
  const n = Math.trunc(Number(boxes)) || 0;
  const overMax = !!selected && n > available;
  const valid = !!productId && n > 0 && !overMax;

  const add = useMutation({
    mutationFn: () => api.post(`/sales-reps/${repId}/add-stock`, { productId, boxes: n, reason: reason.trim() || undefined }),
    onSuccess: (res) => {
      const r = res.data?.data || {};
      toast.success(
        r.mode === 'attached'
          ? `Added ${formatNumber(r.boxes)} box(es) to ${repName}'s active order`
          : `Issued ${formatNumber(r.boxes)} box(es) to ${repName} — new order opened`,
      );
      ['sales-rep-profile', 'settlements', 'commissions', 'inventory', 'dashboard'].forEach((k) =>
        qc.invalidateQueries({ queryKey: [k] }));
      onClose();
    },
    onError: (e) => toast.error(apiError(e)),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={`Add stock — ${repName}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => add.mutate()} loading={add.isPending} disabled={!valid}>
            <PackagePlus className="h-4 w-4" /> Add stock
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="rounded-lg border border-border bg-elevated px-3 py-2 text-xs text-muted">
          Boxes are issued out of The Lab and attached to {repName}'s latest active order (a new order opens if they have none).
          Their order value, outstanding balance and stock-held all update, and they get a notification.
        </p>
        <Field label="Product (from The Lab)" required hint={isLoading ? 'Loading stock…' : `${rows.length} product${rows.length !== 1 ? 's' : ''} in stock`}>
          <Select value={productId} onChange={(e) => { setProductId(e.target.value); setBoxes(''); }}>
            <option value="">Select a product…</option>
            {rows.map((r) => (
              <option key={r.productId} value={r.productId}>{r.name} — {formatNumber(r.totalBase)} in stock</option>
            ))}
          </Select>
        </Field>
        <Field
          label="Boxes to add"
          required
          error={overMax ? `Only ${formatNumber(available)} box(es) in The Lab` : undefined}
          hint={selected && !overMax ? `${formatCurrency(selected.sellingPrice)}/box · adds ${formatCurrency((selected.sellingPrice || 0) * n)} to the order` : undefined}
        >
          <Input type="number" min="1" max={available || undefined} value={boxes} disabled={!productId}
            onChange={(e) => setBoxes(e.target.value)} placeholder="0" />
        </Field>
        <Field label="Reason / note" hint="Optional — saved to the audit log">
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Restock for weekend market" />
        </Field>
      </div>
    </Modal>
  );
}

export default function SalesRepProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { hasRole } = useAuth();
  const isAdmin = hasRole(ROLES.ADMIN);
  const [viewing, setViewing] = useState(null); // settlementId for OrderDetailModal
  const [addOpen, setAddOpen] = useState(false); // "Add stock" modal
  const [editOpen, setEditOpen] = useState(false); // "Edit details" modal
  const [deducting, setDeducting] = useState(false); // "Deduct commission" modal

  // Which window the performance figures cover. Kept in the query key so
  // switching period refetches rather than showing last period's numbers.
  const [period, setPeriod] = useState('all');
  const { data, isLoading } = useQuery({
    queryKey: ['sales-rep-profile', id, period],
    queryFn: async () => unwrap(await api.get(`/sales-reps/${id}/profile`, {
      params: period === 'all' ? {} : { period },
    })).data,
    refetchInterval: 60_000,
    keepPreviousData: true,
  });
  // This rep's payouts, so the admin and the rep are looking at one list. Not
  // folded into the profile payload: it is a small, separate question, and it
  // has to invalidate on the Commissions screen's own mutations.
  const { data: wd } = useQuery({
    queryKey: ['commissions', 'withdrawals', 'rep', id],
    queryFn: async () => unwrap(await api.get('/commissions/withdrawals', { params: { salesRepId: id, limit: 6 } })),
  });

  const toggleActive = useMutation({
    mutationFn: (isActive) => api.put(`/sales-reps/${id}`, { isActive }),
    onSuccess: (_r, isActive) => {
      toast.success(isActive ? 'Sales rep activated' : 'Sales rep suspended');
      qc.invalidateQueries({ queryKey: ['sales-rep-profile', id] });
      qc.invalidateQueries({ queryKey: ['sales-reps'] });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const testWa = useMutation({
    mutationFn: () => api.post(`/sales-reps/${id}/whatsapp-test`),
    onSuccess: (res) => {
      const r = res.data?.data;
      if (r?.sent) toast.success('Test sent — the rep should get it on WhatsApp');
      else toast.error(`Not sent: ${r?.reason === 'no-whatsapp' ? 'no WhatsApp set for this rep' : 'delivery failed'}`);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ['sales-rep-profile', id] });
    qc.invalidateQueries({ queryKey: ['settlements'] });
    qc.invalidateQueries({ queryKey: ['commissions'] });
  };

  if (isLoading || !data) return <PageSpinner />;

  const { rep, stock, commission: c, settlements, performance: perf, activity } = data;
  const outstanding = settlements.active.reduce((s, x) => s + (x.balance || 0), 0);
  const hasPenalties = c.penalties > 0 || (c.penaltyBreakdown?.length > 0);
  // The profile calls the minimum `threshold`; withdrawalState reads either.
  const withdrawals = wd?.data || [];
  const latestPayout = withdrawals[0] || null;
  const payoutState = withdrawalState({ commission: c, latest: latestPayout, firstName: rep.name?.split(' ')[0] || '' });
  const showPayoutNote = ['pending', 'approved', 'paid', 'rejected'].includes(payoutState.key);

  return (
    <div>
      <PageHeader title="Sales Rep Profile" subtitle="Full control center — stock, settlements, commission, compliance.">
        <Button variant="secondary" onClick={() => navigate('/reps')}><ArrowLeft className="h-4 w-4" /> All reps</Button>
      </PageHeader>

      {/* ── Identity header ── */}
      <Card className="mb-6">
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
          <span className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 text-xl font-bold text-white">
            {initials(rep.name)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold text-foreground">{rep.name}</h1>
              <Badge className="bg-brand-500/15 text-brand-400">{rep.code}</Badge>
              {rep.isActive
                ? <Badge className="bg-emerald-500/15 text-emerald-300">Active</Badge>
                : <Badge className="bg-rose-500/15 text-rose-300">Suspended</Badge>}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted">
              {rep.email && <span className="inline-flex items-center gap-1.5"><Mail className="h-3.5 w-3.5 text-faint" />{rep.email}</span>}
              {rep.phone && <span className="inline-flex items-center gap-1.5"><Phone className="h-3.5 w-3.5 text-faint" />{rep.phone}</span>}
              {rep.region && <span className="inline-flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5 text-faint" />{rep.region}</span>}
              <span className="inline-flex items-center gap-1.5"><Calendar className="h-3.5 w-3.5 text-faint" />Joined {formatDate(rep.joinDate)}</span>
            </div>
          </div>
          {isAdmin && (
            <div className="flex flex-shrink-0 flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setEditOpen(true)}>
                <Pencil className="h-4 w-4" /> Edit
              </Button>
              {rep.isActive && (
                <Button onClick={() => setAddOpen(true)}>
                  <PackagePlus className="h-4 w-4" /> Add stock
                </Button>
              )}
              {rep.whatsappPhone && rep.whatsappApiKey && (
                <Button variant="secondary" loading={testWa.isPending} onClick={() => testWa.mutate()}>
                  <MessageCircle className="h-4 w-4" /> Test WhatsApp
                </Button>
              )}
              {rep.isActive ? (
                <Button variant="ghost" className="text-rose-500" loading={toggleActive.isPending} onClick={() => toggleActive.mutate(false)}>
                  <Power className="h-4 w-4" /> Suspend
                </Button>
              ) : (
                <Button loading={toggleActive.isPending} onClick={() => toggleActive.mutate(true)}>
                  <Power className="h-4 w-4" /> Activate
                </Button>
              )}
            </div>
          )}
        </div>
      </Card>

      {/* ── Top stats ── */}
      <div className="mb-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard label="Stock in hand" value={formatNumber(perf.net)} icon={Boxes} tone="brand" hint={`${formatCurrency(stock.value)} cost`} />
        <StatCard
          label="Available balance"
          value={formatCurrency(c.available)}
          icon={c.available < 0 ? ShieldAlert : Wallet}
          tone={c.available < 0 ? 'rose' : 'emerald'}
          hint={c.eligible ? 'Eligible to withdraw' : `Min ${formatCurrency(c.threshold)}`}
        />
        <StatCard label="Outstanding (open orders)" value={formatCurrency(outstanding)} icon={Timer} tone="amber" hint={`${settlements.activeCount} active`} />
        <StatCard label="Penalties" value={formatCurrency(c.penalties)} icon={AlertTriangle} tone={hasPenalties ? 'rose' : 'default'} hint={hasPenalties ? 'Overdue settlements' : 'None'} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* ── Left column (wider) ── */}
        <div className="space-y-6 lg:col-span-2">
          {/* Performance */}
          <Section
            icon={TrendingUp}
            title="Performance"
            action={
              <div className="flex gap-1 rounded-lg border border-border bg-elevated p-0.5">
                {[['today', 'Today'], ['week', 'This week'], ['month', 'This month'], ['all', 'All time']].map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setPeriod(k)}
                    className={clsx(
                      'rounded-md px-2.5 py-1 text-xs font-medium transition',
                      period === k ? 'bg-brand-500 text-black' : 'text-muted hover:text-foreground',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            }
          >
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
              <Money label="Received" value={formatNumber(perf.received)} tone="brand" sub="boxes" />
              <Money label="Sold" value={formatNumber(perf.sold)} tone="emerald" sub="settled" />
              <Money label="Returned" value={formatNumber(perf.returned)} sub="boxes" />
              {/* Held is a stock, not a flow — it only means anything all-time. */}
              {perf.net != null
                ? <Money label="Net (held)" value={formatNumber(perf.net)} sub="boxes" />
                : <Money label="Revenue" value={formatCurrency(perf.revenue)} tone="emerald" sub="settled value" />}
              <Money label="Conversion" value={`${perf.conversion}%`} tone={perf.conversion >= 80 ? 'emerald' : 'amber'} sub="sold / received" />
            </div>
            {perf.commissionEarned != null && (
              <p className="mt-3 text-xs text-muted">
                Commission earned {period === 'all' ? 'in total' : 'in this period'}:{' '}
                <span className="font-semibold text-emerald-400">{formatCurrency(perf.commissionEarned)}</span>
                {perf.net == null && <> · Revenue {formatCurrency(perf.revenue)}</>}
              </p>
            )}
          </Section>

          {/* The shape behind the totals. A flat run of zeroes is as much of an
              answer as a spike, which is why empty days are drawn, not skipped. */}
          {data.trend?.length > 1 && (
            <Section icon={TrendingUp} title="Daily settled sales"
              action={<span className="text-xs text-faint">{period === 'all' ? 'last 30 days' : 'this period'}</span>}>
              <TrendChart
                data={data.trend}
                height={200}
                series={[{ key: 'revenue', name: 'Revenue', color: '#a3e635' }]}
              />
            </Section>
          )}

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            {/* What to send them more of. */}
            <Section icon={Boxes} title="Top products">
              {!data.topProducts?.length ? (
                <p className="text-sm text-faint">Nothing settled in this period.</p>
              ) : (
                <div className="space-y-2">
                  {data.topProducts.map((t) => {
                    const top = data.topProducts[0].boxes || 1;
                    return (
                      <div key={t.productId}>
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-xs text-foreground">{t.name}</span>
                          <span className="shrink-0 text-xs font-semibold tabular-nums text-muted">
                            {formatNumber(t.boxes)} · {formatCurrency(t.revenue)}
                          </span>
                        </div>
                        <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-white/[0.07]">
                          <div className="h-full rounded-full bg-gradient-to-r from-brand-600 to-brand-400"
                            style={{ width: `${Math.max(4, (t.boxes / top) * 100)}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Section>

            {/* The 72-hour contract is what the whole model exists to enforce,
                so how well a rep keeps it is the clearest read on reliability. */}
            {data.discipline && (() => {
              // The rate and its sample size, worded exactly as the Sales Reps
              // card words them, because they are now literally the same
              // fraction: on-time closures over CLOSED orders. Open orders are
              // not in it — an order still out has not succeeded yet.
              const g = gradeOf(data.discipline);
              return (
                <Section icon={Timer} title="Settlement discipline">
                  {/* "Still open" used to sit here too, but the Active
                      settlements section already counts those — from a query
                      bounded differently, so above 200 lifetime orders the two
                      disagreed outright. One source, one figure. */}
                  <div className="grid grid-cols-2 gap-3">
                    <Money
                      label="On time"
                      value={g.known ? `${g.pct}%` : '—'}
                      tone={!g.known ? 'default' : g.pct >= 90 ? 'emerald' : g.pct >= 70 ? 'amber' : 'rose'}
                      sub={g.sub}
                    />
                    <Money
                      label="Overdue now"
                      value={formatNumber(data.discipline.overdue)}
                      tone={data.discipline.overdue > 0 ? 'rose' : 'default'}
                      sub="past deadline"
                    />
                  </div>
                  {/* Closed orders that cannot be timed are dropped from the
                      fraction, not counted as having met the deadline. Saying so
                      is the difference between a rate and a guess. */}
                  {data.discipline.ungradeable > 0 && (
                    <p className="mt-3 text-xs text-muted">
                      {formatNumber(data.discipline.ungradeable)} closed order
                      {data.discipline.ungradeable === 1 ? ' has' : 's have'} no recorded close time, so
                      {data.discipline.ungradeable === 1 ? ' it is' : ' they are'} left out of that rate rather than counted as
                      having met the deadline.
                    </p>
                  )}
                  {/* A late fine is a money fact, not the basis of the rate: the
                      fines are written by the daily sweep, so an order that blew
                      its deadline and closed before the sweep ran never drew one.
                      This line counts fines; the rate reads the timestamps. */}
                  {data.discipline.finedOrders > 0 && (
                    <p className="mt-2 text-xs text-muted">
                      {formatNumber(data.discipline.finedOrders)} order
                      {data.discipline.finedOrders === 1 ? ' has' : 's have'} drawn a late fine — fewer than were actually late,
                      because fines are only written by the daily sweep.
                    </p>
                  )}
                </Section>
              );
            })()}
          </div>

          {/* Active settlements */}
          <Section icon={Timer} title="Active settlements" count={settlements.activeCount}>
            {settlements.active.length === 0 ? (
              <p className="py-2 text-sm text-faint">No active settlements — all orders are closed.</p>
            ) : (
              <div className="space-y-3">
                {settlements.active.map((s) => {
                  const meta = SETTLEMENT_STATUS_META[s.status] || {};
                  return (
                    <button key={s.id} onClick={() => setViewing(s.id)}
                      className="w-full rounded-xl border border-border bg-elevated p-3 text-left transition hover:border-brand-500/40">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-foreground">{s.settlementNumber}</span>
                        <div className="flex items-center gap-2">
                          {s.pendingReturns > 0 && <Badge className="bg-amber-500/15 text-amber-300">Return review</Badge>}
                          <Badge className={meta.cls}>{meta.label || s.status}</Badge>
                        </div>
                      </div>
                      <div className="mt-1 text-xs text-faint">{s.products.join(', ') || '—'}</div>
                      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                        <span className="text-muted">Taken <b className="text-foreground">{formatNumber(s.boxesTaken)}</b></span>
                        <span className="text-emerald-500">Settled <b>{formatNumber(s.boxesSettled)}</b></span>
                        <span className="text-sky-400">Returned <b>{formatNumber(s.boxesReturned)}</b></span>
                        <span className={s.boxesRemaining > 0 ? 'font-semibold text-rose-500' : 'text-muted'}>Remaining {formatNumber(s.boxesRemaining)}</span>
                        <span className="ml-auto text-faint">{hoursLabel(s.hoursRemaining)} · bal {formatCurrency(s.balance)}</span>
                        <ChevronRight className="h-3.5 w-3.5 text-brand-500" />
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </Section>

          {/* Current stock */}
          <Section icon={Package} title="Stock in hand" count={stock.items.length} action={isAdmin && rep.isActive && <Button variant="ghost" className="text-xs" onClick={() => setAddOpen(true)}><PackagePlus className="h-3.5 w-3.5" /> Add stock</Button>}>
            {stock.items.length === 0 ? (
              <p className="py-2 text-sm text-faint">Holding no stock.</p>
            ) : (
              <Table>
                <THead><TR><TH>Product</TH><TH>Boxes held</TH><TH>Value (cost)</TH></TR></THead>
                <TBody>
                  {stock.items.map((s) => (
                    <TR key={s.productId}>
                      <TD className="font-medium text-foreground">{s.name}</TD>
                      <TD>{formatNumber(s.baseQuantity)} {s.baseUnitName || 'Box'}{s.baseQuantity !== 1 ? 'es' : ''}</TD>
                      <TD>{formatCurrency(s.value)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </Section>
        </div>

        {/* ── Right column ── */}
        <div className="space-y-6">
          {/* The same two bars the rep sees, so a conversation about their
              progress is had over identical numbers. */}
          <ProgressRows
            commission={{ available: c.available, minWithdrawal: c.threshold }}
            bonus={data.bonus}
          />
          {/* Commission overview */}
          <Section icon={Wallet} title="Commission overview"
            action={isAdmin && (
              <div className="flex items-center gap-1">
                <Button variant="ghost" className="text-xs" onClick={() => setDeducting(true)}>Deduct</Button>
                <Button variant="ghost" className="text-xs" onClick={() => navigate('/commissions')}>Payouts</Button>
              </div>
            )}>
            <div className="grid grid-cols-2 gap-3">
              <Money label="Total earned" value={formatCurrency(c.earned)} tone="emerald"
                sub={[
                  c.earnedByBrand?.length
                    ? c.earnedByBrand.map((b) => `${formatNumber(b.boxes)} ${b.brand} — ${formatCurrency(b.amount)}`).join(' · ')
                    : `${formatNumber(c.boxesSettled)} boxes settled`,
                  // Without this the brand lines would not add up to the headline.
                  c.adjustment ? `adjustment ${formatCurrency(c.adjustment)}` : null,
                ].filter(Boolean).join(' · ')} />
              <Money label="Paid out" value={formatCurrency(c.paid)} />
              <Money label="Available" value={formatCurrency(c.available)} tone={c.available < 0 ? 'rose' : 'emerald'} />
              <Money label="Penalties" value={formatCurrency(c.penalties)} tone={c.penalties > 0 ? 'rose' : 'default'} />
            </div>
            <div className={`mt-3 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${c.eligible ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400' : 'border-border bg-elevated text-muted'}`}>
              {c.eligible ? <ShieldCheck className="h-4 w-4" /> : <ShieldAlert className="h-4 w-4" />}
              {c.eligible
                ? <span>Eligible to withdraw — balance ≥ {formatCurrency(c.threshold)}</span>
                : <span>Not eligible — needs {formatCurrency(c.threshold)} (has {formatCurrency(c.available)})</span>}
            </div>
            {c.hasCustomThreshold && (
              <div className="mt-2 text-xs text-faint">
                This rep withdraws at {formatCurrency(c.threshold)} — their own terms, not the business default.
              </div>
            )}
            {c.adjustmentNote && (
              <div className="mt-2 rounded-lg border border-border bg-elevated px-3 py-2 text-xs text-faint">
                <span className="font-medium text-muted">Commission adjustment {formatCurrency(c.adjustment)}</span> — {c.adjustmentNote}
              </div>
            )}
            {c.pendingRequests > 0 && <p className="mt-2 text-xs text-amber-400">{formatCurrency(c.pendingRequests)} in pending withdrawal requests.</p>}
          </Section>

          {/* ── Payouts ──
              What this rep has actually been handed, and where the latest
              request has got to. The same note and the same list the rep sees
              on their own screen, so a conversation about a payout is had over
              one set of words. Every payout here was paid from the owner's own
              pocket and is recorded on the Commission account — it has never
              moved M-Pesa or Airtel Money. */}
          <Section icon={Coins} title="Payouts" count={withdrawals.length || null}>
            {showPayoutNote && (
              <WithdrawalNote className="mb-3" audience="owner" commission={c} latest={latestPayout} firstName={rep.name?.split(' ')[0] || ''} />
            )}
            <PayoutHistory items={withdrawals} empty="No withdrawal has been requested yet." />
            <p className="mt-3 text-[11px] leading-snug text-faint">
              Paid from your own pocket and kept on the Commission account. It never comes out of a wallet and never
              off your profit — it is money the business owes you back.
            </p>
          </Section>

          {/* Overdue / penalties */}
          {hasPenalties && (
            <Section icon={AlertTriangle} title="Overdue & penalties">
              <div className="space-y-2">
                {c.penaltyBreakdown.map((p) => (
                  <div key={p.settlementId} className="flex items-center justify-between gap-2 rounded-lg border border-rose-500/20 bg-rose-500/5 px-3 py-2 text-sm">
                    <div>
                      <div className="font-medium text-foreground">{p.settlementNumber}</div>
                      <div className="text-xs text-faint">
                        {/* A manual deduction and a return-expiry fine are not late — say what they are. */}
                        {p.daysOverdue > 0
                          ? `${p.daysOverdue} day${p.daysOverdue !== 1 ? 's' : ''} overdue`
                          : `${p.fines} charge${p.fines !== 1 ? 's' : ''}`}
                        {p.exemptPendingReturn ? ' · exempt (return under review)' : ''}
                      </div>
                    </div>
                    <div className={`font-bold ${p.exemptPendingReturn ? 'text-faint line-through' : 'text-rose-500'}`}>{formatCurrency(p.totalPenalty)}</div>
                  </div>
                ))}
                <div className="flex items-center justify-between border-t border-border pt-2 text-sm font-semibold">
                  <span>Total penalties</span><span className="text-rose-500">{formatCurrency(c.penalties)}</span>
                </div>
                <p className="text-xs text-faint">TZS 10,000/day applies after the 72h deadline until the order is settled or returned.</p>
              </div>
            </Section>
          )}

          {/* How much of the window each closure actually used. The rate above
              says how often; this says by how much, which is the difference
              between a rep who is safe and one who has simply been lucky. */}
          <ClosingSpeed closings={settlements.closings} discipline={data.discipline} onOpen={setViewing} />

          {/* Activity */}
          <Section icon={History} title="Activity history" count={activity.length}>
            {activity.length === 0 ? (
              <p className="py-2 text-sm text-faint">No recorded activity yet.</p>
            ) : (
              // Capped and scrolled inside itself. An unbounded feed made this
              // column run hundreds of pixels past the other one, and nothing
              // on the left could ever be long enough to meet it.
              <ul className="max-h-[520px] space-y-3 overflow-y-auto pr-1">
                {activity.map((e, i) => {
                  const m = ACTIVITY_META[e.type] || ACTIVITY_META.STOCK_REQUEST;
                  const Icon = m.icon;
                  return (
                    <li key={i} className="flex gap-3">
                      <span className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg ${m.cls}`}><Icon className="h-3.5 w-3.5" /></span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm text-foreground">{e.title}</span>
                          {e.amount != null && <span className="text-sm font-semibold text-emerald-500">{formatCurrency(e.amount)}</span>}
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-faint">
                          <Clock className="h-3 w-3" />{formatDateTime(e.at)}
                          {e.status && <span className="rounded bg-elevated px-1.5 py-0.5">{e.status}</span>}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>
        </div>
      </div>

      {viewing && <OrderDetailModal settlementId={viewing} onClose={() => { setViewing(null); refreshAll(); }} />}
      {addOpen && <AddStockModal repId={id} repName={rep.name} onClose={() => setAddOpen(false)} />}
      {editOpen && <EditRepModal rep={rep} onClose={() => setEditOpen(false)} />}
      {deducting && (
        <DeductCommissionModal
          rep={{ id: rep.id, name: rep.name, code: rep.code }}
          available={c.available}
          onClose={() => setDeducting(false)}
        />
      )}
    </div>
  );
}
