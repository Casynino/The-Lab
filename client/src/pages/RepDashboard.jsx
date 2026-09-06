import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { motion, useReducedMotion } from 'motion/react';
import clsx from 'clsx';
import {
  ClipboardList, Undo2, ArrowRight, Timer, Eye, NotebookPen,
} from 'lucide-react';
import api, { unwrap } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { formatCurrency, formatNumber, formatDateTime } from '@/lib/format';
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

// Time of day already chooses the words, so it chooses the light too — keyed on
// tzGreeting()'s own return value rather than on the hour, so the tint and the
// sentence can never drift apart: move a boundary in tz.js and both move.
//
// Every class is a whole literal string. A gradient assembled from a variable
// compiles to nothing and renders as flat black.
//
// Deliberately still. The drift these were designed with was a permanently
// looping compositor animation on the most-opened screen in the app, which is
// a standing battery cost on a cheap phone for something at 6% alpha. The tint
// changes three times a day on its own, which is the part that survives
// daylight anyway.
const HEADER_LIGHT = {
  'Good morning': {
    near: 'bg-[radial-gradient(closest-side,rgba(251,146,60,0.10),transparent_72%)]',
    far: 'bg-[radial-gradient(closest-side,rgba(163,230,53,0.06),transparent_75%)]',
  },
  'Good afternoon': {
    near: 'bg-[radial-gradient(closest-side,rgba(132,204,22,0.11),transparent_72%)]',
    far: 'bg-[radial-gradient(closest-side,rgba(16,185,129,0.06),transparent_75%)]',
  },
  'Good evening': {
    near: 'bg-[radial-gradient(closest-side,rgba(99,102,241,0.13),transparent_72%)]',
    far: 'bg-[radial-gradient(closest-side,rgba(132,204,22,0.05),transparent_75%)]',
  },
};

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
      <div className="mb-2.5 flex items-center justify-between">
        <span className={clsx(
          'relative flex h-8 w-8 items-center justify-center rounded-lg',
          highlight ? 'bg-brand-500 text-slate-950' : 'bg-elevated text-brand-500',
        )}>
          <Icon className="h-4 w-4" />
          {badge != null && (
            <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white">
              {badge}
            </span>
          )}
        </span>
        <ArrowRight className="h-3.5 w-3.5 text-faint" />
      </div>
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</span>
      <span className="mt-0.5 text-lg font-bold leading-tight text-foreground">{value}</span>
      {hint && <span className="mt-0.5 line-clamp-1 text-[11px] text-faint">{hint}</span>}
    </motion.button>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function RepDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [viewing, setViewing] = useState(null);
  // motion v12 ships reducedMotion: "never", so the preference is honoured here
  // or not at all. Above the early returns, where every hook has to be.
  const reduce = useReducedMotion();

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

  const { commission, openSettlements, openSettlementsValue, openSettlementBoxes, pendingRequests, orders } = data;
  const first = user?.name?.split(' ')[0] || 'there';
  const greeting = tzGreeting();
  const light = HEADER_LIGHT[greeting] || HEADER_LIGHT['Good evening'];

  // The money he owes and the stock he is carrying, in one line. Two orders is
  // still one pile of boxes to him, so the count is the total across them.
  const settlementHint = openSettlements === 0
    ? 'No open orders'
    : `${openSettlements} order${openSettlements !== 1 ? 's' : ''}${
      openSettlementBoxes > 0 ? ` · ${formatNumber(openSettlementBoxes)} box${openSettlementBoxes === 1 ? '' : 'es'} left` : ' · settle now'}`;

  return (
    <div className="space-y-6">
      {/* Greeting.
          It read badly because it was two labels shouting past each other: an
          11px all-caps date crammed onto a 24px bold sentence, no size
          relationship between them, and a full stop closing the door. Nothing
          is added — the sentence carries the hierarchy itself now, greeting
          small and muted, the rep's own name large and white on the same
          baseline, so the page is titled with his name rather than with a
          pleasantry.
          Exactly 50.5px tall, the height it has always been, so nothing below
          it moves by a pixel. text-[16px] and leading-none pin the h1 strut, so
          the line box is the name's own 28px box and the height cannot drift
          with a longer name or a longer greeting.
          The name stays white: brand-400 at 28px would sit 24px above the
          brand-400 percentages in ProgressRows and read as their heading. The
          accent goes on the full stop instead, which is the whole brand colour
          this block needs.
          The date is composed from three tzDateLabel calls to read "Saturday 5
          September" — day before month, the order every deadline on this page
          already uses — which also drops the comma that made the all-caps line
          look like a typo. */}
      <div className="relative">
        {/* Absolute, pointer-events-none and -z-10, so the block is still the
            same height and nothing here can be tapped. ProgressRows below is
            opaque bg-surface, so the tail that spills past this block is
            painted under it rather than over anything. */}
        <span aria-hidden="true" className={clsx('pointer-events-none absolute -left-16 -top-16 -z-10 h-44 w-72', light.near)} />
        <span aria-hidden="true" className={clsx('pointer-events-none absolute -top-12 left-44 -z-10 h-40 w-64', light.far)} />

        <motion.p
          initial={{ opacity: reduce ? 1 : 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: reduce ? 0 : 0.5, delay: reduce ? 0 : 0.05, ease: 'easeOut' }}
          className="whitespace-nowrap text-[11px] font-semibold uppercase tracking-[0.22em] text-muted"
        >
          {tzDateLabel({ weekday: 'long' })} {tzDateLabel({ day: 'numeric' })} {tzDateLabel({ month: 'long' })}
        </motion.p>

        <h1 className="mt-1.5 text-[16px] font-normal leading-none">
          <motion.span
            initial={{ opacity: reduce ? 1 : 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: reduce ? 0 : 0.35, delay: reduce ? 0 : 0.12, ease: 'easeOut' }}
            className="text-[18px] font-medium text-muted sm:text-[20px]"
          >
            {greeting},
          </motion.span>{' '}
          {/* inline-block so the slide applies at all — transforms are ignored
              on non-replaced inline elements — and it still sits on the
              greeting's baseline. */}
          <motion.span
            initial={{ opacity: reduce ? 1 : 0, x: reduce ? 0 : 8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: reduce ? 0 : 0.42, delay: reduce ? 0 : 0.22, ease: [0.2, 0.8, 0.3, 1] }}
            className="inline-block text-[28px] font-bold tracking-[-0.02em] text-foreground sm:text-[34px]"
          >
            {first}<span className="text-brand-400">.</span>
          </motion.span>
        </h1>
      </div>

      {/* Sales bonus — separate from box commission, so it sits on its own. */}
      <ProgressRows commission={commission} bonus={bonus} onOpenCommission={() => navigate('/commissions')} />

      {/* The withdrawal card lived here, under the balance. A request already
          shows in the payouts list on the Commissions page with its own status,
          so this was the same thing said twice and the bigger of the two. */}

      {/* Card grid. The two "The Lab" titles carry a non-breaking space before
          "Lab" so the line can only break in front of the whole name: "Order
          from / The Lab", not "Order from The / Lab". text-wrap: balance was
          the obvious fix and changes nothing here — measured in a browser
          rather than assumed. Every hint is short enough to survive the
          one-line clamp on a 390px phone; the settlement one was not, and was
          eating the box count. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <DashCard
          icon={ClipboardList}
          label="Request stock"
          value={'Order from The\u00A0Lab'}
          hint="Request new inventory"
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
          hint="Opening or closing count"
          onClick={() => navigate('/daily-reports')}
        />
        <DashCard
          icon={Undo2}
          label="Return stock"
          value={'Return to The\u00A0Lab'}
          hint="Send back unsold boxes"
          onClick={() => navigate('/settlements')}
        />
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
                  {o.boxes?.issued > 0 && (
                    <div className="mt-1 text-xs font-semibold text-muted">
                      <span className={clsx('tabular-nums', overdue ? 'text-rose-400' : 'text-foreground')}>
                        {formatNumber(o.boxes.remaining)}
                      </span>{' '}
                      {o.boxes.remaining === 1 ? 'box' : 'boxes'} {overdue ? 'missing' : 'left'}
                    </div>
                  )}
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
