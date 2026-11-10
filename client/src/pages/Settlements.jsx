import { LIVE, STEADY } from '@/lib/polling';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'motion/react';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import {
  Timer, AlertTriangle, Clock, CheckCircle2, Eye,
  ChevronRight, Wallet, ShieldCheck, PackageOpen,
} from 'lucide-react';
import api, { unwrap, apiError } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { ROLES, SETTLEMENT_STATUS_META } from '@/lib/constants';
import { formatCurrency, formatDate, formatDateTime, formatNumber } from '@/lib/format';
import OrderDetailModal from '@/components/OrderDetail';
import {
  PageHeader, Card, PageSpinner, EmptyState, Badge, Button,
  Pagination, Table, THead, TBody, TR, TH, TD,
  Remaining, BoxCount,
} from '@/components/ui';

// ── Rep-facing card for an ACTIVE order ─────────────────────────────────────

function ActiveOrderCard({ s, onClick }) {
  const overdue = s.status === 'OVERDUE';
  const approaching = s.approaching;

  const accent = overdue
    ? { border: 'border-rose-500/30', bg: 'bg-rose-500/5', text: 'text-rose-400' }
    : approaching
      ? { border: 'border-amber-500/30', bg: 'bg-amber-500/5', text: 'text-amber-400' }
      : { border: 'border-border', bg: 'bg-surface', text: 'text-brand-600' };

  const b = s.boxes || {};
  const issued = b.issued || 0;
  // Boxes the rep has already handed over and is waiting on ZELab for: a submission or a return.
  const withOffice = (b.pendingSubmitted || 0) + (b.pendingReturned || 0);
  const pct = (n) => `${issued > 0 ? Math.max(0, Math.min(100, (n / issued) * 100)) : 0}%`;
  // "Missing" is an accusation, and it is the wrong one when the rep has already handed the boxes
  // over and is waiting on The Doctor. A late order whose whole outstanding count is sitting in a
  // submission or a return says so instead.
  const waiting = b.remaining > 0 && withOffice >= b.remaining;

  return (
    <motion.button
      whileTap={{ scale: 0.985 }}
      onClick={onClick}
      className={clsx('w-full rounded-2xl border p-4 text-left transition hover:bg-elevated', accent.border, accent.bg)}
    >
      {/* The order, and how long is left — red words ("52h overdue") when it is late. There is no
          "Partial" / "Open" badge: nobody needs to be told an order they are working on is not
          finished, and the bar below already shows how far it is. */}
      <div className="flex items-center justify-between gap-3">
        <span className="text-[13px] font-semibold text-muted">{s.settlementNumber}</span>
        <Remaining hours={s.hoursRemaining} />
      </div>

      {/* What is still owed, and the boxes that stand for it. */}
      <div className="mt-3 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-faint">Outstanding</div>
          <div className={clsx('mt-0.5 text-2xl font-black tabular-nums', accent.text)}>{formatCurrency(s.balance)}</div>
        </div>
        {/* An order with no linked transfer has issued 0, and "0 boxes left" on a live order would be
            a lie about a finished one. */}
        {issued > 0 && (
          <span className="shrink-0 pb-0.5 text-right text-[12px] font-semibold text-muted">
            <BoxCount
              to={b.remaining}
              countOnMount={false}
              duration={450}
              unitOne="box"
              unitMany="boxes"
              suffix={waiting ? 'awaiting approval' : overdue ? 'missing' : 'left'}
              unitClassName="text-[12px] font-semibold text-muted"
              className={clsx('text-[15px] font-black', waiting ? 'text-amber-400' : overdue ? 'text-rose-400' : 'text-foreground')}
            />
          </span>
        )}
      </div>

      {/* How far along: settled, returned, and waiting for approval, as one thin bar. */}
      {issued > 0 && (
        <div className="mt-3 flex h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
          <div className="bg-emerald-400" style={{ width: pct(b.settled) }} />
          <div className="bg-sky-400" style={{ width: pct(b.returned) }} />
          <div className="bg-amber-400" style={{ width: pct(withOffice) }} />
        </div>
      )}

      <div className="mt-2.5 flex items-center justify-between gap-3 text-xs">
        <span className="min-w-0 truncate text-faint">
          {s.paid > 0
            ? <><span className="font-medium text-emerald-400">{formatCurrency(s.paid)}</span> settled</>
            : <>Order {formatCurrency(s.assignedValue)}</>}
        </span>
        <span className="inline-flex shrink-0 items-center gap-1 text-faint">
          {formatDateTime(s.deadlineAt)}
          <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
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
      className="flex w-full items-center gap-3 rounded-xl px-1 py-3.5 text-left transition hover:bg-elevated"
    >
      {/* No tick and no eye: the heading already says these are completed, and the whole row is the button. */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{s.settlementNumber}</p>
        <p className="mt-0.5 text-xs tabular-nums text-muted">{formatCurrency(s.assignedValue)}</p>
      </div>
      <span className="shrink-0 text-xs text-muted">{formatDateTime(s.issuedAt)}</span>
    </button>
  );
}

// ── Rep view: two-section layout ─────────────────────────────────────────────

function RepSettlements({ viewing, setViewing }) {
  const { data, isLoading } = useQuery({
    queryKey: ['settlements', 'rep-all'],
    queryFn: async () => unwrap(await api.get('/settlements', { params: { limit: 100 } })),
    refetchInterval: STEADY,
  });

  if (isLoading) return <PageSpinner />;

  const all = data?.data || [];
  const active = all.filter((s) => s.status !== 'SETTLED');
  const completed = all.filter((s) => s.status === 'SETTLED');

  // One short heading per list, no page title above them, no icons and no red badge (Nino, 11 Nov 2026:
  // "just say Active orders — if there are none, just show the completed orders; too many words").
  // The active section is not drawn at all when there is nothing active.
  const Heading = ({ children, count }) => (
    <h2 className="mb-3 px-1 text-lg font-bold text-foreground">
      {children}
      {count > 0 && <span className="ml-2 text-sm font-medium text-muted">{count}</span>}
    </h2>
  );

  if (!active.length && !completed.length) {
    return (
      <div className="mt-16 px-1 text-center">
        <Timer className="mx-auto h-6 w-6 text-muted" aria-hidden="true" />
        <p className="mt-3 text-sm font-medium text-foreground">No orders yet</p>
        <p className="mt-1 text-xs text-muted">Approved stock shows up here.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {active.length > 0 && (
        <div>
          <Heading count={active.length}>Active orders</Heading>
          <div className="space-y-3">
            {active.map((s) => (
              <ActiveOrderCard key={s.id} s={s} onClick={() => setViewing(s.id)} />
            ))}
          </div>
        </div>
      )}

      {completed.length > 0 && (
        <div>
          <Heading count={completed.length}>Completed orders</Heading>
          {/* Plain rows on the page, no card round them. */}
          <div className="divide-y divide-white/[0.06]">
            {completed.map((s) => (
              <CompletedRow key={s.id} s={s} onClick={() => setViewing(s.id)} />
            ))}
          </div>
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
    refetchInterval: LIVE,
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
    refetchInterval: STEADY,
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
      ring: 'ring-brand-500/25', glow: 'from-brand-500/[0.12]', chip: 'bg-brand-500/15 text-brand-600', num: 'text-brand-600',
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
      // "85 orders, all time" was dishonest twice over: the orders count is a
      // different population (every contract ever opened, including ones that
      // settled nothing), and "all time" names no date. The sub now states
      // exactly when this number starts counting — the first settled sale.
      label: 'Boxes settled by reps', value: formatNumber(summary.lifetime?.boxesSettled || 0), icon: CheckCircle2,
      sub: summary.lifetime?.since ? `since ${formatDate(summary.lifetime.since)}` : 'no boxes settled yet',
      ring: 'ring-emerald-500/25', glow: 'from-emerald-500/[0.12]', chip: 'bg-emerald-500/15 text-emerald-300', num: 'text-emerald-300',
    },
  ] : [];

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
                            <Remaining hours={s.hoursRemaining} />
                            <div className="mt-1 text-[11px] text-faint">{formatDateTime(s.deadlineAt)}</div>
                          </>
                        )}
                        {/* The self-extension rewrites deadlineAt, so without
                            this the date above is the extended one and the row
                            gives no sign that the rep took the extra time —
                            which also doubles what a late day costs them. */}
                        {s.extensionUsed && (
                          <div className="mt-1 text-[11px] font-semibold text-amber-400">
                            +{s.extensionHours}h taken
                          </div>
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
      {/* A rep's page opens straight on their orders — the menu already says Settle. */}
      {!isRep && (
        <PageHeader
          title="Orders & Settlements"
          subtitle="Each approved order is a 72-hour contract — open one to settle boxes and record returns."
        />
      )}

      {isRep
        ? <RepSettlements viewing={viewing} setViewing={setViewing} />
        : <StaffSettlements viewing={viewing} setViewing={setViewing} />
      }

      {viewing && <OrderDetailModal settlementId={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}
