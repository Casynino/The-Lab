import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'motion/react';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import {
  Timer, AlertTriangle, Clock, CheckCircle2, Eye,
  ChevronRight, Wallet, ShieldCheck, PackageOpen, Boxes, Users, Truck,
} from 'lucide-react';
import api, { unwrap, apiError } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { ROLES, SETTLEMENT_STATUS_META } from '@/lib/constants';
import { formatCurrency, formatDateTime, formatNumber, sharePercents } from '@/lib/format';
import OrderDetailModal from '@/components/OrderDetail';
import {
  PageHeader, Card, PageSpinner, EmptyState, Badge, Button,
  Pagination, Table, THead, TBody, TR, TH, TD,
} from '@/components/ui';

function hoursLabel(h) {
  if (h == null) return '—';
  if (h < 0) return `${Math.abs(Math.round(h))}h overdue`;
  if (h < 24) return `${Math.round(h)}h left`;
  return `${Math.round(h / 24)}d left`;
}

// ── Rep-facing card for an ACTIVE order ─────────────────────────────────────

function ActiveOrderCard({ s, onClick }) {
  const overdue = s.status === 'OVERDUE';
  const approaching = s.approaching;

  const accent = overdue
    ? { border: 'border-rose-500/30', bg: 'bg-rose-500/5', text: 'text-rose-400', timeCls: 'text-rose-400' }
    : approaching
      ? { border: 'border-amber-500/30', bg: 'bg-amber-500/5', text: 'text-amber-400', timeCls: 'text-amber-400' }
      : { border: 'border-border', bg: 'bg-surface', text: 'text-brand-400', timeCls: 'text-faint' };

  return (
    <motion.button
      whileTap={{ scale: 0.985 }}
      onClick={onClick}
      className={clsx('w-full rounded-2xl border p-4 text-left transition hover:bg-elevated', accent.border, accent.bg)}
    >
      {/* Order number + status */}
      <div className="flex items-center justify-between gap-2">
        <span className="font-bold text-foreground">{s.settlementNumber}</span>
        <Badge className={SETTLEMENT_STATUS_META[s.status]?.cls}>
          {SETTLEMENT_STATUS_META[s.status]?.label}
        </Badge>
      </div>

      {/* Outstanding — hero figure */}
      <div className="mt-3">
        <div className="text-[11px] uppercase tracking-widest text-faint">Outstanding</div>
        <div className={clsx('mt-0.5 text-2xl font-black tabular-nums', accent.text)}>
          {formatCurrency(s.balance)}
        </div>
      </div>

      {/* Secondary money line */}
      <div className="mt-2 flex gap-4 text-xs text-faint">
        <span>Order {formatCurrency(s.assignedValue)}</span>
        {s.paid > 0 && <span className="text-emerald-400">Settled {formatCurrency(s.paid)}</span>}
        {s.returned > 0 && <span className="text-sky-400">Returned {formatCurrency(s.returned)}</span>}
      </div>

      {/* Footer */}
      <div className="mt-3 flex items-center justify-between border-t border-white/8 pt-3">
        <span className={clsx('text-xs font-medium', accent.timeCls)}>
          {hoursLabel(s.hoursRemaining)} · {formatDateTime(s.deadlineAt)}
        </span>
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-brand-400">
          Open <ChevronRight className="h-3.5 w-3.5" />
        </span>
      </div>
    </motion.button>
  );
}

// ── Rep-facing row for a COMPLETED order ─────────────────────────────────────

function CompletedRow({ s, onClick }) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-xl px-2 py-3 text-left transition hover:bg-elevated"
    >
      <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
      <div className="min-w-0 flex-1">
        <span className="text-sm font-medium text-muted">{s.settlementNumber}</span>
        <span className="ml-2 text-sm text-faint">{formatCurrency(s.assignedValue)}</span>
      </div>
      <span className="shrink-0 text-xs text-faint">{formatDateTime(s.issuedAt)}</span>
      <Eye className="h-3.5 w-3.5 shrink-0 text-faint" />
    </button>
  );
}

// ── Rep view: two-section layout ─────────────────────────────────────────────

function RepSettlements({ viewing, setViewing }) {
  const { data, isLoading } = useQuery({
    queryKey: ['settlements', 'rep-all'],
    queryFn: async () => unwrap(await api.get('/settlements', { params: { limit: 100 } })),
    refetchInterval: 60_000,
  });

  if (isLoading) return <PageSpinner />;

  const all = data?.data || [];
  const active = all.filter((s) => s.status !== 'SETTLED');
  const completed = all.filter((s) => s.status === 'SETTLED');

  return (
    <div className="space-y-8">
      {/* ── Active ── */}
      <div>
        <div className="mb-3 flex items-center gap-2">
          <Wallet className="h-4 w-4 text-brand-500" />
          <h2 className="text-base font-bold text-foreground">
            Active orders
            {active.length > 0 && (
              <span className="ml-2 rounded-full bg-brand-500 px-2 py-0.5 text-[11px] font-black text-slate-950">
                {active.length}
              </span>
            )}
          </h2>
        </div>

        {active.length === 0 ? (
          <div className="rounded-2xl border border-border bg-surface">
            <EmptyState
              title="No active orders"
              message="When stock is approved and issued to you, the order appears here within the 72h settlement window."
              icon={Timer}
            />
          </div>
        ) : (
          <div className="space-y-3">
            {active.map((s) => (
              <ActiveOrderCard key={s.id} s={s} onClick={() => setViewing(s.id)} />
            ))}
          </div>
        )}
      </div>

      {/* ── Completed ── */}
      {completed.length > 0 && (
        <div>
          <div className="mb-2 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            <h2 className="text-sm font-semibold text-muted">
              Completed orders ({completed.length})
            </h2>
          </div>
          <Card>
            <div className="divide-y divide-border px-2">
              {completed.map((s) => (
                <CompletedRow key={s.id} s={s} onClick={() => setViewing(s.id)} />
              ))}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

// ── Approval center: settlements awaiting The Doctor's verification ──────────

function PendingApprovals({ onReview }) {
  const qc = useQueryClient();
  const { data: pending = [] } = useQuery({
    queryKey: ['settlements', 'pending-approvals'],
    queryFn: async () => unwrap(await api.get('/settlements/pending-approvals')).data,
    refetchInterval: 30_000,
  });

  const refresh = () => {
    ['settlements', 'commissions', 'dashboard', 'inventory'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  };
  const approve = useMutation({
    mutationFn: (id) => api.post(`/settlements/submissions/${id}/approve`),
    onSuccess: () => { toast.success('Settlement approved — sale & commission recorded'); refresh(); },
    onError: (e) => toast.error(apiError(e)),
  });
  const reject = useMutation({
    mutationFn: (id) => api.post(`/settlements/submissions/${id}/reject`),
    onSuccess: () => { toast.success('Settlement rejected'); refresh(); },
    onError: (e) => toast.error(apiError(e)),
  });

  if (!pending.length) return null;

  return (
    <Card className="mb-6 border-sky-500/30">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <ShieldCheck className="h-4 w-4 text-sky-400" />
        <h2 className="text-sm font-bold text-foreground">Pending settlement approvals</h2>
        <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[11px] font-bold text-sky-400">{pending.length}</span>
        <span className="ml-auto text-xs text-faint">Verify the money before approving</span>
      </div>
      <div className="divide-y divide-border">
        {pending.map((p) => {
          const busy = (approve.isPending && approve.variables === p.id) || (reject.isPending && reject.variables === p.id);
          return (
            <div key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <button onClick={() => onReview(p.settlementId)} className="min-w-0 flex-1 text-left">
                <div className="text-sm font-semibold text-foreground">{p.salesRep} · {formatCurrency(p.amount)}</div>
                <div className="mt-0.5 text-xs text-faint">
                  {p.boxes} box(es) {p.productName} · {p.settlementNumber}{p.method ? ` · ${p.method}` : ''} · {formatDateTime(p.submittedAt)}
                </div>
              </button>
              <div className="flex shrink-0 gap-2">
                <Button variant="ghost" className="text-rose-500" disabled={busy} onClick={() => reject.mutate(p.id)}>Reject</Button>
                <Button loading={busy} onClick={() => approve.mutate(p.id)}>
                  <CheckCircle2 className="h-4 w-4" /> Approve
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ── Staff / admin view ───────────────────────────────────────────────────────

// One filter chip. Replaces the lone dropdown: the counts are the point — you
// can see there are four overdue orders before deciding to look at them, which
// a <select> can never show.
function FilterChip({ label, count, active, tone, onClick }) {
  const TONE = {
    slate: 'bg-white/10 text-foreground ring-white/20',
    sky: 'bg-sky-500/15 text-sky-300 ring-sky-500/30',
    amber: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
    rose: 'bg-rose-500/15 text-rose-300 ring-rose-500/30',
    emerald: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'inline-flex cursor-pointer items-center gap-2 rounded-full px-3.5 py-2 text-sm font-medium ring-1 transition duration-200',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400',
        active ? TONE[tone] : 'bg-transparent text-muted ring-white/10 hover:bg-white/[0.05] hover:text-foreground',
      )}
    >
      {label}
      {count != null && (
        <span className={clsx('rounded-full px-1.5 py-0.5 text-[11px] font-bold tabular-nums',
          active ? 'bg-black/25' : 'bg-white/[0.07] text-faint')}>
          {formatNumber(count)}
        </span>
      )}
    </button>
  );
}

function StaffSettlements({ viewing, setViewing }) {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');

  const { data: summary } = useQuery({
    queryKey: ['settlements', 'summary'],
    queryFn: async () => unwrap(await api.get('/settlements/summary')).data,
    refetchInterval: 60_000,
  });

  const { data, isLoading } = useQuery({
    queryKey: ['settlements', { page, status }],
    queryFn: async () => unwrap(await api.get('/settlements', { params: { page, limit: 15, status: status || undefined } })),
  });

  const pick = (next) => { setStatus(next); setPage(1); };

  const b = summary?.boxes || { issued: 0, settled: 0, returned: 0, remaining: 0 };
  const sc = summary?.statusCounts || {};
  const pct = (n, of) => (of > 0 ? (n / of) * 100 : 0);

  const cards = summary ? [
    {
      label: 'Outstanding', value: formatCurrency(summary.outstandingValue), icon: Timer,
      sub: `${summary.outstandingCount} live order${summary.outstandingCount === 1 ? '' : 's'}`,
      ring: 'ring-brand-500/25', glow: 'from-brand-500/[0.12]', chip: 'bg-brand-500/15 text-brand-300', num: 'text-brand-300',
    },
    {
      label: 'Boxes with reps', value: formatNumber(b.remaining), icon: PackageOpen,
      sub: 'still to settle or return',
      ring: 'ring-violet-500/25', glow: 'from-violet-500/[0.12]', chip: 'bg-violet-500/15 text-violet-300', num: 'text-violet-300',
    },
    {
      label: 'Overdue', value: formatNumber(summary.overdueCount), icon: AlertTriangle,
      sub: summary.overdueCount ? formatCurrency(summary.overdueValue) : 'nobody is late',
      ring: summary.overdueCount ? 'ring-rose-500/30' : 'ring-white/[0.07]',
      glow: summary.overdueCount ? 'from-rose-500/[0.14]' : 'from-white/[0.02]',
      chip: 'bg-rose-500/15 text-rose-300', num: summary.overdueCount ? 'text-rose-300' : 'text-foreground',
    },
    {
      label: 'Due within 12h', value: formatNumber(summary.approachingCount), icon: Clock,
      sub: summary.approachingCount ? 'chase these today' : 'nothing closing yet',
      ring: summary.approachingCount ? 'ring-amber-500/30' : 'ring-white/[0.07]',
      glow: summary.approachingCount ? 'from-amber-500/[0.14]' : 'from-white/[0.02]',
      chip: 'bg-amber-500/15 text-amber-300', num: summary.approachingCount ? 'text-amber-300' : 'text-foreground',
    },
    {
      label: 'Boxes settled', value: formatNumber(summary.lifetime?.boxesSettled || 0), icon: CheckCircle2,
      sub: `${formatNumber(summary.totalOrders || 0)} orders, all time`,
      ring: 'ring-emerald-500/25', glow: 'from-emerald-500/[0.12]', chip: 'bg-emerald-500/15 text-emerald-300', num: 'text-emerald-300',
    },
  ] : [];

  // The boxes on every live order, split by what has happened to them. These
  // four add up: issued = settled + returned + still out.
  const flowShares = sharePercents([b.settled, b.returned, b.remaining], b.issued);
  const flow = [
    { label: 'Settled by the rep', value: b.settled, share: flowShares[0], dot: 'bg-emerald-400', bar: 'bg-emerald-500' },
    { label: 'Returned to the store', value: b.returned, share: flowShares[1], dot: 'bg-sky-400', bar: 'bg-sky-500' },
    { label: 'Still out, unaccounted', value: b.remaining, share: flowShares[2], dot: 'bg-violet-400', bar: 'bg-violet-500' },
  ];

  const chips = [
    { key: '', label: 'All orders', count: summary?.totalOrders, tone: 'slate' },
    { key: 'OPEN', label: 'Open', count: sc.OPEN, tone: 'sky' },
    { key: 'PARTIAL', label: 'Partial', count: sc.PARTIAL, tone: 'amber' },
    { key: 'OVERDUE', label: 'Overdue', count: sc.OVERDUE, tone: 'rose' },
    { key: 'SETTLED', label: 'Settled', count: sc.SETTLED, tone: 'emerald' },
  ];

  return (
    <div>
      <PendingApprovals onReview={setViewing} />

      {summary && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-5">
            {cards.map((c) => (
              <div key={c.label} className={`relative overflow-hidden rounded-2xl bg-surface p-4 ring-1 ${c.ring}`}>
                <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${c.glow} to-transparent`} aria-hidden="true" />
                <div className="relative flex items-start justify-between gap-2">
                  <p className="text-xs font-medium text-muted">{c.label}</p>
                  <span className={`rounded-lg p-1.5 ${c.chip}`}><c.icon className="h-3.5 w-3.5" /></span>
                </div>
                <p className={`relative mt-2 text-2xl font-bold tabular-nums ${c.num}`}>{c.value}</p>
                <p className="relative mt-0.5 text-[11px] text-faint">{c.sub}</p>
              </div>
            ))}
          </div>

          <div className="mb-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* What the live orders are MADE OF. The money cards say what they
                are worth; this says how many boxes are actually in play. */}
            <Card>
              <div className="p-5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">The boxes on contract</h3>
                    <p className="mt-0.5 text-xs text-muted">Every box issued on a live order, and what became of it.</p>
                  </div>
                  <span className="rounded-lg bg-violet-500/15 p-1.5 text-violet-300"><Boxes className="h-3.5 w-3.5" /></span>
                </div>

                <p className="mt-4 text-4xl font-bold leading-none tabular-nums text-foreground">
                  {formatNumber(b.issued)}
                  <span className="ml-2 text-sm font-normal text-muted">boxes issued, not yet closed</span>
                </p>

                {b.issued > 0 ? (
                  <>
                    <div className="mt-4 flex h-2.5 w-full overflow-hidden rounded-full bg-white/[0.07]">
                      {flow.map((f) => (
                        <div key={f.label} className={`h-full ${f.bar}`} style={{ width: `${pct(f.value, b.issued)}%` }} />
                      ))}
                    </div>
                    <div className="mt-4 space-y-2.5">
                      {flow.map((f) => (
                        <div key={f.label} className="flex items-center gap-3">
                          <span className={`h-2 w-2 shrink-0 rounded-full ${f.dot}`} />
                          <span className="flex-1 text-sm text-muted">{f.label}</span>
                          <span className="text-sm font-bold tabular-nums text-foreground">{formatNumber(f.value)}</span>
                          <span className="w-10 text-right text-xs tabular-nums text-faint">
                            {f.share}%
                          </span>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="mt-4 text-sm text-faint">No boxes are out on contract. Every issued box has been settled or returned.</p>
                )}
              </div>
            </Card>

            {/* Who is actually holding it. The same question the Inventory page
                answers for the store — here it is scoped to what is owed. */}
            <Card>
              <div className="p-5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">Who owes what</h3>
                    <p className="mt-0.5 text-xs text-muted">Live orders only, biggest debt first.</p>
                  </div>
                  <span className="rounded-lg bg-brand-500/15 p-1.5 text-brand-300"><Users className="h-3.5 w-3.5" /></span>
                </div>

                {summary.byRep?.length ? (
                  <div className="mt-4 max-h-[232px] space-y-2.5 overflow-y-auto pr-1">
                    {summary.byRep.map((r) => {
                      const share = pct(r.outstanding, summary.outstandingValue);
                      return (
                        <button
                          key={r.salesRepId}
                          type="button"
                          onClick={() => pick('')}
                          className="w-full cursor-pointer rounded-lg px-1 py-1 text-left transition duration-200 hover:bg-white/[0.04]"
                        >
                          <div className="flex items-center gap-2">
                            {r.overdueCount > 0
                              ? <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-rose-400" />
                              : <Truck className="h-3.5 w-3.5 shrink-0 text-brand-400" />}
                            <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{r.name}</span>
                            <span className="w-24 shrink-0 text-right text-sm font-bold tabular-nums text-foreground">
                              {formatCurrency(r.outstanding)}
                            </span>
                          </div>
                          <div className="ml-5 mt-1 h-1 overflow-hidden rounded-full bg-white/[0.06]">
                            <div className={clsx('h-full rounded-full', r.overdueCount > 0 ? 'bg-rose-500' : 'bg-brand-500')}
                              style={{ width: `${Math.max(2, share)}%` }} />
                          </div>
                          {/* Who owes what is only half the question — when it
                              is due is the other half, and it decides who gets
                              chased first. */}
                          <div className="ml-5 mt-1 flex items-center gap-2 text-[11px] text-faint">
                            <span className="tabular-nums">{formatNumber(r.boxesRemaining)} boxes</span>
                            <span className="text-white/15">·</span>
                            <span className="tabular-nums">{r.activeOrders} order{r.activeOrders === 1 ? '' : 's'}</span>
                            <span className="ml-auto tabular-nums">
                              {r.overdueCount > 0
                                ? <span className="text-rose-400">{r.overdueCount} overdue</span>
                                : hoursLabel(r.nearestHoursRemaining)}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="mt-4 text-sm text-faint">Nobody is holding stock on an open order.</p>
                )}
              </div>
            </Card>
          </div>
        </>
      )}

      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-4">
          {chips.map((c) => (
            <FilterChip
              key={c.key || 'all'}
              label={c.label}
              count={c.count}
              tone={c.tone}
              active={status === c.key}
              onClick={() => pick(c.key)}
            />
          ))}
        </div>

        {isLoading ? <PageSpinner /> : !data?.data?.length ? (
          <EmptyState title="No orders here" message="Orders open automatically when stock is issued to a rep." icon={Timer} />
        ) : (
          <>
            <Table>
              <THead>
                <TR>
                  <TH>Order</TH><TH>Rep</TH>
                  <TH>Boxes</TH>
                  <TH>Value</TH><TH>Settled</TH><TH>Balance</TH>
                  <TH>Deadline</TH><TH>Status</TH><TH />
                </TR>
              </THead>
              <TBody>
                {data.data.map((s) => {
                  const bx = s.boxes || { issued: 0, settled: 0, returned: 0, remaining: 0 };
                  const done = bx.settled + bx.returned;
                  return (
                    <TR key={s.id} className="cursor-pointer" onClick={() => setViewing(s.id)}>
                      <TD className="font-medium">{s.settlementNumber}</TD>
                      <TD>{s.salesRep?.user?.name}</TD>
                      {/* What the order is made of, not only what it is worth. */}
                      <TD>
                        <div className="flex items-baseline gap-1 tabular-nums">
                          <span className="font-semibold text-foreground">{formatNumber(done)}</span>
                          <span className="text-faint">/ {formatNumber(bx.issued)}</span>
                        </div>
                        <div className="mt-1 flex h-1 w-20 overflow-hidden rounded-full bg-white/[0.07]">
                          <div className="h-full bg-emerald-500" style={{ width: `${pct(bx.settled, bx.issued)}%` }} />
                          <div className="h-full bg-sky-500" style={{ width: `${pct(bx.returned, bx.issued)}%` }} />
                        </div>
                      </TD>
                      <TD>{formatCurrency(s.assignedValue)}</TD>
                      <TD className="text-emerald-500">{formatCurrency(s.paid)}</TD>
                      <TD className={s.balance > 0 ? 'font-semibold text-rose-500' : 'text-faint'}>{formatCurrency(s.balance)}</TD>
                      <TD>
                        {s.status === 'SETTLED' ? (
                          // Finalized order — no countdown, no overdue, just when it closed.
                          <div className="inline-flex items-center gap-1 text-xs text-emerald-500">
                            <CheckCircle2 className="h-3.5 w-3.5" /> Settled{s.settledAt ? ` · ${formatDateTime(s.settledAt)}` : ''}
                          </div>
                        ) : (
                          <>
                            <div className="text-muted">{formatDateTime(s.deadlineAt)}</div>
                            <div className={clsx('text-xs', s.hoursRemaining < 0 ? 'text-rose-500' : s.approaching ? 'text-amber-500' : 'text-faint')}>
                              {hoursLabel(s.hoursRemaining)}
                            </div>
                          </>
                        )}
                      </TD>
                      <TD><Badge className={SETTLEMENT_STATUS_META[s.status]?.cls}>{SETTLEMENT_STATUS_META[s.status]?.label}</Badge></TD>
                      <TD>
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-brand-600">
                          Open <Eye className="h-3.5 w-3.5" />
                        </span>
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
            <Pagination page={page} totalPages={data.meta?.totalPages} total={data.meta?.total} onChange={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}

// ── Page shell ───────────────────────────────────────────────────────────────

export default function Settlements() {
  const { hasRole } = useAuth();
  const isRep = !hasRole(ROLES.WAREHOUSE_STAFF);
  const [viewing, setViewing] = useState(null);

  return (
    <div>
      <PageHeader
        title="Orders & Settlements"
        subtitle={isRep
          ? 'Active orders need action within 72 hours — settle boxes or return unsold stock.'
          : 'Each approved order is a 72-hour contract — open one to settle boxes and record returns.'
        }
      />

      {isRep
        ? <RepSettlements viewing={viewing} setViewing={setViewing} />
        : <StaffSettlements viewing={viewing} setViewing={setViewing} />
      }

      {viewing && <OrderDetailModal settlementId={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}
