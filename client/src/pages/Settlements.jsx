import { LIVE, STEADY } from '@/lib/polling';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'motion/react';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import {
  Timer, AlertTriangle, Clock, CheckCircle2, Eye,
  ChevronRight, Wallet, ShieldCheck, PackageOpen,
} from 'lucide-react';
import api, { apiError } from '@/lib/api';
import { pageQueries, keepOnPageTurn } from '@/lib/pageQueries';
import { useOnce } from '@/lib/useOnce';
import { pickParam, pageParam, withParams } from '@/lib/urlParams';
import { useAuth } from '@/context/AuthContext';
import { ROLES, SETTLEMENT_STATUS_META } from '@/lib/constants';
import { formatCurrency, formatDate, formatDateTime, formatNumber, unitWord } from '@/lib/format';
import OrderDetailModal, { RejectSubmissionModal } from '@/components/OrderDetail';
import ActiveOrderCard from '@/components/ActiveOrderCard';
import CollapsibleList from '@/components/CollapsibleList';
import {
  PageHeader, Card, PageSpinner, EmptyState, Badge, Button,
  Pagination, LoadError, Table, THead, TBody, TR, TH, TD,
  Remaining,
} from '@/components/ui';

// ── Rep-facing row for a COMPLETED order ─────────────────────────────────────

function CompletedRow({ s, onClick }) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-white/[0.04] active:bg-white/[0.06]"
    >
      {/* No tick and no eye: the heading already says these are completed, and the whole row is the button. */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{s.settlementNumber}</p>
        <p className="mt-0.5 text-xs tabular-nums text-muted">{formatCurrency(s.assignedValue)}</p>
      </div>
      <span className="shrink-0 text-xs text-muted">{formatDate(s.issuedAt)}</span>
    </button>
  );
}

// ── Rep view: two-section layout ─────────────────────────────────────────────

function RepSettlements({ viewing, setViewing }) {
  const { data, isLoading, isError, refetch } = useQuery({
    ...pageQueries.settlementsMine(),
    refetchInterval: STEADY,
  });

  if (isLoading) return <PageSpinner />;
  // A request that never came back is not "No orders yet" (audit #68).
  if (isError && !data) return <LoadError what="your orders" onRetry={refetch} />;

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
        <CollapsibleList title="Completed orders" count={completed.length} defaultOpen={active.length === 0}>
          {completed.map((s) => (
            <CompletedRow key={s.id} s={s} onClick={() => setViewing(s.id)} />
          ))}
        </CollapsibleList>
      )}
    </div>
  );
}

// ── Approval center: settlements awaiting The Doctor's verification ──────────

function PendingApprovals({ onReview }) {
  const qc = useQueryClient();
  const { data: pending = [] } = useQuery({
    ...pageQueries.settlementsWaiting(),
    refetchInterval: LIVE,
  });

  const refresh = () => {
    ['settlements', 'commissions', 'dashboard', 'inventory'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  };
  // Per row: one press goes through until it has an answer. A same-frame double tap sent two approvals
  // and the refused second one showed "already decided" after a good approval (audit admin-ops-3).
  const once = useOnce();
  const approve = useMutation({
    mutationFn: (id) => api.post(`/settlements/submissions/${id}/approve`),
    onSuccess: () => { toast.success('Settlement approved'); refresh(); },
    onError: (e) => toast.error(apiError(e)),
    onSettled: (_d, _e, id) => once.release(id),
  });
  // Reject asks first, with an optional reason the rep is told — the same box as on the order itself.
  // It used to reject on one tap, with no reason (audit, 11 Nov 2026).
  const [rejecting, setRejecting] = useState(null);
  // Kept on screen even if the list empties under it (decided elsewhere), so it can be closed, and never
  // pops up again later for a submission that is already gone.
  const rejectModal = rejecting && <RejectSubmissionModal submission={rejecting} onClose={() => setRejecting(null)} onDone={refresh} />;

  if (!pending.length) return rejectModal || null;

  return (
    <>
    {/* The one card that needs action wears the rep's amber "waiting" glass. A plain card's tinted border
        is cleared by the admin glass, so this strip looked like every other card. */}
    <div className="stat-glass mb-6" data-tone="near">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <ShieldCheck className="h-4 w-4 text-amber-400" />
        <h2 className="text-sm font-bold text-foreground">Pending settlement approvals</h2>
        <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-bold text-amber-300">{pending.length}</span>
        <span className="ml-auto text-xs text-faint">Verify the money before approving</span>
      </div>
      <div className="divide-y divide-border">
        {pending.map((p) => {
          const approving = approve.isPending && approve.variables === p.id;
          return (
            <div key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <button onClick={() => onReview(p.settlementId)} className="min-w-0 flex-1 text-left">
                <div className="text-sm font-semibold text-foreground">{p.salesRep} · {formatCurrency(p.amount)}</div>
                <div className="mt-0.5 text-xs text-faint">
                  {formatNumber(p.boxes)} {unitWord(p.boxes)} {p.productName} · {p.settlementNumber}{p.method ? ` · ${p.method}` : ''} · {formatDateTime(p.submittedAt)}
                </div>
              </button>
              {/* On a phone the two decisions are full-size and apart (44 px, audit 12 Nov 2026): a near miss
                  on Reject used to land on Approve. */}
              <div className="flex w-full shrink-0 gap-3 sm:w-auto sm:gap-2">
                <Button variant="ghost" className="min-h-11 flex-1 text-rose-500 sm:min-h-0 sm:flex-none" disabled={approving} onClick={() => setRejecting(p)}>Reject</Button>
                <Button className="min-h-11 flex-1 sm:min-h-0 sm:flex-none" loading={approving} onClick={() => once.run(() => approve.mutate(p.id), p.id)}>
                  <CheckCircle2 className="h-4 w-4" /> Approve
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
    {rejectModal}
    </>
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
  // The chip and the page are in the address (?status=SETTLED&page=3), written with replace: Back from an
  // order's page comes back to the same list, a reload keeps it, and the Dashboard's "orders past the
  // deadline" link (?status=OVERDUE) and the chips always agree (navigation-6, navigation-11).
  const [params, setParams] = useSearchParams();
  const status = pickParam(params, 'status', ['OPEN', 'PARTIAL', 'OVERDUE', 'SETTLED']);
  const page = pageParam(params);
  const setPage = (n) => setParams((p) => withParams(p, { page: n }), { replace: true });

  const { data: summary } = useQuery({
    ...pageQueries.settlementsSummary(),
    refetchInterval: STEADY,
  });

  const { data, isLoading, isError, refetch } = useQuery({
    ...pageQueries.settlements({ page, status }),
    placeholderData: keepOnPageTurn({ status }),
  });

  const pick = (next) => setParams((p) => withParams(p, { status: next, page: null }), { replace: true });

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
          {/* Two across until there is room for all five, and the odd fifth card takes the whole row, so a
              tablet or phone never shows a hole beside it (three across left 3 + 2 on a tablet). */}
          <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-5">
            {cards.map((c, i) => (
              <div key={c.label} className={clsx('stat-glass p-4', i === cards.length - 1 && cards.length % 2 === 1 && 'col-span-2 xl:col-span-1')}>
                <div className="relative flex items-start justify-between gap-2">
                  <p className="text-xs font-medium text-muted">{c.label}</p>
                  <span className={`rounded-full p-1.5 ring-1 ring-inset ring-white/10 ${c.chip}`}><c.icon className="h-3.5 w-3.5" /></span>
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

        {isLoading ? <PageSpinner /> : isError && !data ? <LoadError what="the orders" onRetry={refetch} /> : !data?.data?.length ? (
          <EmptyState title="No orders here" message="Orders open automatically when stock is issued to a rep." icon={Timer} />
        ) : (
          <>
            <Table stack="wide">
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
                    <TR key={s.id} className="group cursor-pointer" onClick={() => setViewing(s.id)}>
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
                      {/* Every live order has a balance, so a red one on every row made a red column. It is
                          coloured like the rep's own order card: rose when late, amber when the deadline is
                          near, plain otherwise. */}
                      <TD className={s.balance > 0
                        ? clsx('font-semibold', s.status === 'OVERDUE' ? 'text-rose-400' : s.approaching ? 'text-amber-300' : 'text-foreground')
                        : 'text-faint'}>{formatCurrency(s.balance)}</TD>
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
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-muted transition-colors group-hover:text-foreground">
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
