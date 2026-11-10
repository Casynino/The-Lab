import { STEADY } from '@/lib/polling';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import clsx from 'clsx';
import {
  ClipboardList, Undo2, ArrowRight, Timer, Eye, NotebookPen,
} from 'lucide-react';
import api, { unwrap } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { formatCurrency, formatNumber, formatDateTime } from '@/lib/format';
import ProgressRows from '@/components/ProgressRows';
import { SETTLEMENT_STATUS_META } from '@/lib/constants';
import OrderDetailModal from '@/components/OrderDetail';
import ActiveOrderCard from '@/components/ActiveOrderCard';
import { PageSpinner, EmptyState, Badge } from '@/components/ui';

function hoursLabel(h) {
  if (h == null) return '—';
  if (h < 0) return `${Math.abs(Math.round(h))}h overdue`;
  if (h < 24) return `${Math.round(h)}h left`;
  return `${Math.round(h / 24)}d left`;
}

// ── Standard dash card ───────────────────────────────────────────────────────

function DashCard({ icon: Icon, label, value, hint, badge, highlight, onClick }) {
  // A small soft card, the same family as the active orders (Nino, 11 Nov 2026: "the home page feels
  // big and too much"): the icon, the name, and a figure only where there is one worth showing.
  return (
    <button
      type="button"
      onClick={onClick}
      data-tone={highlight ? 'brand' : undefined}
      className="active-card active-card--compact flex flex-col"
    >
      <span className={clsx(
        'relative flex h-7 w-7 items-center justify-center rounded-lg',
        highlight ? 'bg-brand-500 text-white' : 'bg-white/[0.07] text-brand-500',
      )}>
        <Icon className="h-4 w-4" />
        {badge != null && (
          <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white">
            {badge}
          </span>
        )}
      </span>
      {/* One word, big (Nino, 11 Nov 2026: "just say one word, big and nice — Requests, Return, Report"). */}
      <span className="mt-3 text-[19px] font-bold leading-tight text-foreground">{label}</span>
      {value && <span className="mt-1 text-[15px] font-semibold leading-tight tabular-nums text-foreground/90">{value}</span>}
      {hint && <span className="mt-0.5 text-[11px] text-muted">{hint}</span>}
    </button>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function RepDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [viewing, setViewing] = useState(null);
  // or not at all. Above the early returns, where every hook has to be.

  const { data: bonus } = useQuery({
    queryKey: ['bonus', 'me'],
    queryFn: async () => unwrap(await api.get('/commissions/bonus/me')).data,
  });
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard', 'me'],
    queryFn: async () => unwrap(await api.get('/dashboard/me')).data,
    refetchInterval: STEADY,
  });

  if (isLoading) return <PageSpinner />;
  if (!data) return <EmptyState title="No data yet" />;

  const { commission, openSettlements, openSettlementsValue, openSettlementBoxes, pendingRequests, orders } = data;

  // The money he owes and the stock he is carrying, in one line. Two orders is
  // still one pile of boxes to him, so the count is the total across them.
  const settlementHint = openSettlements === 0
    ? 'No open orders'
    : `${openSettlements} order${openSettlements !== 1 ? 's' : ''}${
      openSettlementBoxes > 0 ? ` · ${formatNumber(openSettlementBoxes)} box${openSettlementBoxes === 1 ? '' : 'es'} left` : ' · settle now'}`;

  return (
    <div className="space-y-6">
      {/* The greeting that used to stand here — "MONDAY 9 NOVEMBER / Good
          evening, KP." — is gone. The banner directly above it already carries
          the rep's name, their role and the date in full, so this was the same
          three facts a second time, in a second style, pushing the work down
          the screen (owner, 9 Nov 2026). */}

      {/* Sales bonus — separate from box commission, so it sits on its own. */}
      <ProgressRows commission={commission} bonus={bonus} onOpenCommission={() => navigate('/commissions')} />

      {/* The withdrawal card lived here, under the balance. A request already
          shows in the payouts list on the Commissions page with its own status,
          so this was the same thing said twice and the bigger of the two. */}

      {/* Card grid. The two "ZELab" titles ("Order from ZELab", "Return to ZELab") are
          one word at the end of the line, so they can only break in front of it. They
          used to say "The Lab" with a non-breaking space for the same reason. Every
          hint is short enough to survive the
          one-line clamp on a 390px phone; the settlement one was not, and was
          eating the box count. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <DashCard
          icon={ClipboardList}
          label="Request"
          badge={pendingRequests > 0 ? pendingRequests : undefined}
          onClick={() => navigate('/stock-requests')}
        />
        <DashCard
          icon={Timer}
          label="Settle"
          value={openSettlementsValue > 0 ? formatCurrency(openSettlementsValue) : 'Clear'}
          hint={settlementHint}
          highlight={openSettlements > 0}
          badge={openSettlements > 0 ? openSettlements : undefined}
          onClick={() => navigate('/settlements')}
        />
        <DashCard
          icon={NotebookPen}
          label="Report"
          onClick={() => navigate('/daily-reports')}
        />
        <DashCard
          icon={Undo2}
          label="Return"
          onClick={() => navigate('/settlements')}
        />
      </div>

      {/* Open orders */}
      {orders.length > 0 && (
        <div>
          {/* One short heading, and on a phone compact versions of the Settle page's soft cards (the orders
              here have exactly the same shape). Most urgent first, at most three — the rest are one tap
              away on the Settle page. */}
          <h2 className="mb-3 px-1 text-base font-semibold text-foreground lg:text-sm">
            Open orders
            <span className="ml-2 text-sm font-medium text-muted lg:hidden">{orders.length}</span>
          </h2>

          <div className="space-y-2.5 lg:hidden">
            {[...orders].sort((a, b) => (a.hoursRemaining ?? 1e9) - (b.hoursRemaining ?? 1e9)).slice(0, 3).map((o) => (
              <ActiveOrderCard compact key={o.id} s={o} onClick={() => setViewing(o.id)} />
            ))}
            {orders.length > 3 && (
              <button
                type="button"
                onClick={() => navigate('/settlements')}
                className="px-1 pt-1 text-[13px] font-semibold text-brand-600 transition hover:text-brand-500"
              >
                See all {orders.length} orders
              </button>
            )}
          </div>

          {/* Desktop table */}
          <div className="hidden overflow-hidden rounded-2xl border border-border bg-surface lg:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-elevated/50">
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-faint">Order</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-faint">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-faint">Balance</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-faint">Deadline</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {orders.map((o) => {
                  const overdue = o.hoursRemaining < 0;
                  const approaching = o.approaching;
                  return (
                    <tr key={o.id} className="cursor-pointer transition hover:bg-elevated" onClick={() => setViewing(o.id)}>
                      <td className="px-4 py-3 font-semibold text-foreground">{o.settlementNumber}</td>
                      <td className="px-4 py-3">
                        <Badge className={SETTLEMENT_STATUS_META[o.status]?.cls}>
                          {SETTLEMENT_STATUS_META[o.status]?.label}
                        </Badge>
                      </td>
                      <td className={clsx('px-4 py-3 font-bold', o.balance > 0 ? 'text-rose-400' : 'text-emerald-400')}>
                        {formatCurrency(o.balance)}
                        {o.boxes?.issued > 0 && (
                          <div className="text-[11px] font-semibold text-muted">
                            {formatNumber(o.boxes.remaining)} {o.boxes.remaining === 1 ? 'box' : 'boxes'} {overdue ? 'missing' : 'left'}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-muted">{formatDateTime(o.deadlineAt)}</div>
                        <div className={clsx('text-xs', overdue ? 'text-rose-400' : approaching ? 'text-amber-400' : 'text-faint')}>
                          {hoursLabel(o.hoursRemaining)}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600">
                          Open <Eye className="h-3.5 w-3.5" />
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {viewing && <OrderDetailModal settlementId={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}
