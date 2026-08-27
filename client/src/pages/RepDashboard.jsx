import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import clsx from 'clsx';
import {
  ClipboardList, TrendingUp, Undo2, ArrowRight, Timer, Eye, NotebookPen,
} from 'lucide-react';
import api, { unwrap } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { formatCurrency, formatDateTime } from '@/lib/format';
import { tzGreeting, tzDateLabel } from '@/lib/tz';
import ProgressRows from '@/components/ProgressRows';
import { SETTLEMENT_STATUS_META } from '@/lib/constants';
import OrderDetailModal from '@/components/OrderDetail';
import { PageSpinner, EmptyState, Badge } from '@/components/ui';

function hoursLabel(h) {
  if (h == null) return '—';
  if (h < 0) return `${Math.abs(Math.round(h))}h overdue`;
  if (h < 24) return `${Math.round(h)}h left`;
  return `${Math.round(h / 24)}d left`;
}

// ── Standard dash card ───────────────────────────────────────────────────────

function DashCard({ icon: Icon, label, value, hint, badge, highlight, onClick }) {
  return (
    <motion.button
      whileTap={{ scale: 0.985 }}
      onClick={onClick}
      className={clsx(
        'flex w-full flex-col rounded-2xl border p-4 text-left shadow-card transition',
        highlight
          ? 'border-brand-500/50 bg-gradient-to-br from-brand-500/15 via-surface to-surface'
          : 'border-border bg-surface hover:bg-elevated',
      )}
    >
      <div className="mb-3 flex items-center justify-between">
        <span className={clsx(
          'relative flex h-10 w-10 items-center justify-center rounded-xl',
          highlight ? 'bg-brand-600 text-slate-950' : 'bg-elevated text-brand-500',
        )}>
          <Icon className="h-5 w-5" />
          {badge != null && (
            <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white">
              {badge}
            </span>
          )}
        </span>
        <ArrowRight className="h-4 w-4 text-faint" />
      </div>
      <span className="text-xs text-muted">{label}</span>
      <span className="mt-0.5 text-xl font-bold text-foreground">{value}</span>
      {hint && <span className="mt-0.5 text-xs text-faint">{hint}</span>}
    </motion.button>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function RepDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [viewing, setViewing] = useState(null);

  const { data: bonus } = useQuery({
    queryKey: ['bonus', 'me'],
    queryFn: async () => unwrap(await api.get('/commissions/bonus/me')).data,
  });
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard', 'me'],
    queryFn: async () => unwrap(await api.get('/dashboard/me')).data,
    refetchInterval: 60_000,
  });

  if (isLoading) return <PageSpinner />;
  if (!data) return <EmptyState title="No data yet" />;

  const { commission, openSettlements, openSettlementsValue, pendingRequests, orders } = data;
  const first = user?.name?.split(' ')[0] || 'there';

  const settlementHint = openSettlements === 0
    ? 'No open orders'
    : `${openSettlements} active order${openSettlements !== 1 ? 's' : ''} · settle now`;

  const available = commission?.available || 0;
  const commissionHint = available < 0
    ? 'You owe The Lab — overdue penalties'
    : available > 0 ? 'Available balance' : 'Settle boxes to earn commission';

  return (
    <div className="space-y-6">
      {/* Greeting */}
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">
          {tzDateLabel({ weekday: 'long', day: 'numeric', month: 'long' })}
        </p>
        <h1 className="mt-0.5 text-2xl font-bold text-foreground sm:text-3xl">
          {tzGreeting()}, {first}.
        </h1>
      </div>

      {/* Sales bonus — separate from box commission, so it sits on its own. */}
      <ProgressRows commission={commission} bonus={bonus} />

      {/* Card grid */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <DashCard
          icon={ClipboardList}
          label="Request stock"
          value="Order from The Lab"
          hint="Tap to request new inventory"
          badge={pendingRequests > 0 ? pendingRequests : undefined}
          onClick={() => navigate('/stock-requests')}
        />
        <DashCard
          icon={Timer}
          label="Settlement"
          value={openSettlementsValue > 0 ? formatCurrency(openSettlementsValue) : 'Clear'}
          hint={settlementHint}
          highlight={openSettlements > 0}
          badge={openSettlements > 0 ? openSettlements : undefined}
          onClick={() => navigate('/settlements')}
        />
        <DashCard
          icon={NotebookPen}
          label="Daily Report"
          value="Tap to Report"
          hint="Submit your opening or closing"
          onClick={() => navigate('/daily-reports')}
        />
        <DashCard
          icon={TrendingUp}
          label="My Earnings"
          value={formatCurrency(available)}
          hint={commissionHint}
          onClick={() => navigate('/commissions')}
        />
        <div className="col-span-2 lg:col-span-4">
          <DashCard
            icon={Undo2}
            label="Return stock"
            value="Return to The Lab"
            hint="Send back unsold boxes before the deadline"
            onClick={() => navigate('/settlements')}
          />
        </div>
      </div>

      {/* Open orders */}
      {orders.length > 0 && (
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Open orders</h2>
            <span className="text-xs text-faint">Settle or return before 72 h deadline</span>
          </div>

          {/* Mobile cards */}
          <div className="space-y-2 lg:hidden">
            {orders.map((o) => {
              const overdue = o.hoursRemaining < 0;
              const approaching = o.approaching;
              return (
                <motion.button
                  key={o.id}
                  whileTap={{ scale: 0.985 }}
                  onClick={() => setViewing(o.id)}
                  className={clsx(
                    'w-full rounded-2xl border p-4 text-left transition',
                    overdue ? 'border-rose-500/30 bg-rose-500/5' : 'border-border bg-surface hover:bg-elevated',
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-foreground">{o.settlementNumber}</span>
                      <Badge className={SETTLEMENT_STATUS_META[o.status]?.cls}>
                        {SETTLEMENT_STATUS_META[o.status]?.label}
                      </Badge>
                    </div>
                    <span className={clsx('font-bold', o.balance > 0 ? 'text-rose-400' : 'text-emerald-400')}>
                      {formatCurrency(o.balance)}
                    </span>
                  </div>
                  <div className={clsx('mt-1.5 flex items-center justify-between text-xs', overdue ? 'text-rose-400' : approaching ? 'text-amber-400' : 'text-faint')}>
                    <span>{hoursLabel(o.hoursRemaining)} · {formatDateTime(o.deadlineAt)}</span>
                    <span className="font-semibold text-brand-400">Settle &rsaquo;</span>
                  </div>
                </motion.button>
              );
            })}
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
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-muted">{formatDateTime(o.deadlineAt)}</div>
                        <div className={clsx('text-xs', overdue ? 'text-rose-400' : approaching ? 'text-amber-400' : 'text-faint')}>
                          {hoursLabel(o.hoursRemaining)}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-brand-400">
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
