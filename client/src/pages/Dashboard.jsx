import { STEADY } from '@/lib/polling';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Wallet,
  TrendingUp,
  TrendingDown,
  Boxes,
  Warehouse,
  Truck,
  AlertTriangle,
  ArrowRight,
  Timer,
  CheckCircle2,
  Banknote,
  Landmark,
  Smartphone,
  PiggyBank,
  ClipboardList,
  ArrowLeftRight,
  Undo2,
  Factory,
  PackageX,
  Receipt,
  ShoppingCart,
  SlidersHorizontal,
  ArrowDownLeft,
  ArrowUpRight,
  Scale,
  ChevronRight,
  Coins,
  ShieldCheck,
  X,
} from 'lucide-react';
import { motion } from 'motion/react';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import api, { unwrap, apiError } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { formatCurrency, formatNumber, formatDateTime } from '@/lib/format';
import { TrendChart, BarChartCard, DonutChart } from '@/components/charts';
import { tzDateLabel, eatDay } from '@/lib/tz';
import {
  StatCard,
  Card,
  CardHeader,
  CardBody,
  PageSpinner,
  EmptyState,
  Badge,
  Button,
  Table,
  THead,
  TBody,
  TR,
  TH,
  TD,
  Modal,
} from '@/components/ui';

// How many attention rows are visible before the list scrolls, and the height
// of one row: py-2.5 top and bottom (20px) over two leading-tight lines at
// 13px and 11px (30px). 56 leaves a sliver of the next row showing, which is
// what tells you the list scrolls at all.
const ATTENTION_ROWS = 3;
const ATTENTION_ROW_PX = 56;

const ACCOUNT_ICON = { CASH: Banknote, BANK: Landmark, MOBILE_MONEY: Smartphone, OTHER: Wallet, COMMISSION: Coins };

const BRAND_TONE = {
  OHIS: { ring: 'border-emerald-500/30', bg: 'bg-emerald-500/5', badge: 'bg-emerald-500/15 text-emerald-400', dot: 'bg-emerald-400' },
  CIVLILY: { ring: 'border-violet-500/30', bg: 'bg-violet-500/5', badge: 'bg-violet-500/15 text-violet-400', dot: 'bg-violet-400' },
};

// Compact "act on this" tile — glows when something needs the Doctor.
function AttentionTile({ label, value, sub, icon: Icon, active, tone = 'rose', onClick }) {
  const tones = {
    rose: 'border-rose-500/40 shadow-[0_0_20px_-8px_rgba(244,63,94,0.6)] text-rose-300',
    amber: 'border-amber-500/40 shadow-[0_0_20px_-8px_rgba(245,158,11,0.6)] text-amber-300',
    sky: 'border-sky-500/40 shadow-[0_0_20px_-8px_rgba(14,165,233,0.6)] text-sky-300',
  };
  return (
    <motion.button
      whileTap={{ scale: 0.985 }}
      onClick={onClick}
      className={clsx(
        'flex w-full items-center gap-3 rounded-xl border bg-[#0a0d12] p-3 text-left transition-all hover:-translate-y-0.5',
        active ? tones[tone] : 'border-white/10 text-faint',
      )}
    >
      <Icon className="h-5 w-5 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className={clsx('break-words text-lg font-black leading-tight tabular-nums', active ? '' : 'text-white/20')}>{value}</div>
        <div className="mt-0.5 truncate text-[11px] uppercase tracking-wide text-faint">{label}</div>
        {sub && <div className="truncate text-[11px] text-faint">{sub}</div>}
      </div>
      <ArrowRight className="h-3.5 w-3.5 shrink-0 text-faint" />
    </motion.button>
  );
}

function Mini({ label, value, sub }) {
  return (
    <div className="min-w-0 rounded-xl bg-black/20 p-3">
      <div className="text-[11px] uppercase tracking-wide text-faint">{label}</div>
      <div className="mt-0.5 break-words text-sm font-bold leading-snug tabular-nums text-foreground lg:text-base">{value}</div>
      {sub && <div className="text-[11px] text-faint">{sub}</div>}
    </div>
  );
}

// One colour per account, used by the hero bar and its dots so a pocket is
// recognisable at a glance.
const HERO_BAR = ['bg-brand-400', 'bg-violet-400', 'bg-cyan-300', 'bg-amber-300'];
const HERO_DOT = ['bg-brand-400', 'bg-violet-400', 'bg-cyan-300', 'bg-amber-300'];

// Deciding a withdrawal needs three things in front of you: who is asking, how
// much, and where they want it sent — plus what they are actually owed, so an
// amount that looks wrong can be caught before the money moves. It opens from
// the attention list rather than sending you off to hunt for it.
function ReviewWithdrawals({ items, onClose }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(null);

  // One press, not two. Approving and then marking paid were separate steps for
  // a single decision, and there was never a case where he approved and did not
  // pay — so this goes straight to PAID, which is also the only status that
  // records the payment against the Commission account.
  const decide = useMutation({
    mutationFn: ({ id, action }) => api.post(`/commissions/withdrawals/${id}/decide`, { action, fromOwnPocket: action === 'PAY' }),
    onSuccess: (_r, v) => {
      toast.success(v.action === 'PAY' ? 'Paid' : 'Rejected');
      ['dashboard', 'commissions'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      onClose();
    },
    onError: (e) => toast.error(apiError(e)),
    onSettled: () => setBusy(null),
  });

  const run = (id, action) => { setBusy(`${id}:${action}`); decide.mutate({ id, action }); };

  return (
    <Modal open onClose={onClose} size="lg"
      title={`Commission request${items.length !== 1 ? 's' : ''} · ${formatNumber(items.length)}`}>
      <div className="space-y-3">
        {items.map((w) => (
          <div key={w.id} className="rounded-2xl bg-surface p-4 ring-1 ring-white/[0.07]">
            <div className="flex items-baseline justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-[15px] font-semibold text-foreground">{w.repName}</p>
                {w.repCode && <p className="text-[11px] text-faint">{w.repCode}</p>}
              </div>
              <p className="shrink-0 text-2xl font-bold tabular-nums text-emerald-400">{formatCurrency(w.amount)}</p>
            </div>

            {/* Where the money is going. This is the part that has to be read. */}
            {w.payTo && (
              <div className="mt-3 rounded-xl bg-elevated/60 px-3.5 py-3 ring-1 ring-white/[0.07]">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">Send to</p>
                <p className="mt-1 break-words font-mono text-[15px] font-bold text-foreground">{w.payTo}</p>
              </div>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-[11px] text-faint">
              {w.available != null && (
                <span>
                  Balance after this: <b className="text-foreground">{formatCurrency(Math.max(0, w.available))}</b>
                </span>
              )}
              {w.earned != null && <span>Earned all time {formatCurrency(w.earned)}</span>}
              <span className="ml-auto">{formatDateTime(w.requestedAt)}</span>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <button type="button" disabled={!!busy}
                onClick={() => run(w.id, 'PAY')}
                className="flex h-11 items-center justify-center gap-2 rounded-xl bg-brand-500 text-[13px] font-bold text-slate-950 ring-1 ring-brand-500 transition active:scale-[0.97] disabled:opacity-60">
                <ShieldCheck className="h-4 w-4" />
                {busy === `${w.id}:PAY` ? 'Paying…' : 'Approve & pay'}
              </button>
              <button type="button" disabled={!!busy}
                onClick={() => run(w.id, 'REJECT')}
                className="flex h-11 items-center justify-center gap-2 rounded-xl bg-elevated text-[13px] font-semibold text-foreground ring-1 ring-white/[0.07] transition active:scale-[0.97] disabled:opacity-60">
                <X className="h-4 w-4 text-rose-400" />
                Reject
              </button>
            </div>
          </div>
        ))}

        <p className="text-[11px] leading-snug text-faint">
          Approving does not move any money — it clears the request so you can pay it. The amount stays held aside
          from the rep&rsquo;s balance either way until you decide.
        </p>
      </div>
    </Modal>
  );
}

// Today · This week · This month. One control, used in two places on the page
// and driving both, so the figures under it are never from different windows.
function PeriodTabs({ value, onChange, options }) {
  return (
    <div className="inline-flex shrink-0 rounded-xl bg-elevated p-0.5 ring-1 ring-white/[0.07]">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          className={clsx(
            'rounded-[10px] px-3 py-1.5 text-xs font-semibold transition',
            value === o.key ? 'bg-brand-500 text-slate-950' : 'text-muted hover:text-foreground',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default function Dashboard() {
  const [attentionFilter, setAttentionFilter] = useState('All');
  // Today, this week, this month — one choice for the whole page, changeable
  // from the totals strip or from the brand cards. It opens on the week: the
  // month is the figure that was always there, and the week is the one an
  // owner has to wait for otherwise.
  const [period, setPeriod] = useState('week');
  const [reviewing, setReviewing] = useState(null); // pending commission requests
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['dashboard', 'command'],
    queryFn: async () => unwrap(await api.get('/dashboard/command')).data,
    refetchInterval: STEADY, // live business status
  });

  if (isLoading) return <PageSpinner label="Building your command center…" />;
  if (isError || !data) return <EmptyState title="Couldn't load the dashboard" message="Please try again shortly." icon={AlertTriangle} />;

  const { accounts, totalFunds, today, week, month, brands, reps, attention, inventory, charts} = data;
  // The same three windows everywhere on this page: the same figures, the same
  // names for them, whether they are being read as a total or brand by brand.
  const periods = {
    today: {
      key: 'today', label: 'Today', heading: 'Today',
      when: tzDateLabel({ weekday: 'long', day: 'numeric', month: 'long' }),
      revenue: today.revenue, grossProfit: today.grossProfit, boxes: today.boxesSold ?? 0,
      suffix: 'Today', available: true,
    },
    week: {
      key: 'week', label: 'This week', heading: 'This week',
      when: week ? `${eatDay(week.start)} – ${eatDay(week.end)}` : 'Monday to Sunday',
      revenue: week?.revenue ?? 0, grossProfit: week?.grossProfit ?? 0, boxes: week?.boxes ?? 0,
      suffix: 'Week', available: Boolean(week),
    },
    month: {
      key: 'month', label: 'This month', heading: `This month · ${tzDateLabel({ month: 'long' })}`,
      when: tzDateLabel({ month: 'long', year: 'numeric' }),
      revenue: month.revenue, grossProfit: month.grossProfit, boxes: month.boxes,
      suffix: 'Month', available: true,
    },
  };
  // A window the server could not read is not offered as a tab and never
  // shown as a row of zeros: the month, which is read separately, stands in.
  const shown = periods[period].available ? periods[period] : periods.month;
  // Only accounts actually holding money belong in "where it sits". The index
  // is carried along so each keeps its own colour when another empties. The
  // Commission account is not one of them: it is the record of what the owner
  // paid reps from his own pocket, and no money sits in it at all.
  const withIndex = accounts.filter((a) => !a.isCommissionRecord).map((a, i) => ({ ...a, _i: i }));
  const funded = withIndex.filter((a) => Number(a.balance) !== 0);
  const heroAccounts = funded.length ? funded : withIndex;
  const attentionCount =
    attention.stockRequests + attention.settlements + attention.returns +
    attention.overdueSettlements + attention.lowStock.count + attention.outOfStock;

  // `short` is the tile's word on a phone. "Approve requests" in an 80 px
  // tile wraps to three lines and the row stops being a row.
  const QUICK = [
    { label: 'Approve requests', short: 'Requests', kind: 'sky', icon: ClipboardList, to: '/stock-requests', badge: attention.stockRequests },
    { label: 'Approve settlements', short: 'Settle', kind: 'amber', icon: Timer, to: '/settlements', badge: attention.settlements },
    { label: 'Approve returns', short: 'Returns', kind: 'rose', icon: Undo2, to: '/returns', badge: attention.returns },
    { label: 'Record sale', short: 'Sale', kind: 'emerald', icon: ShoppingCart, to: '/sales' },
    { label: 'Record expense', short: 'Expense', kind: 'orange', icon: Receipt, to: '/finance?tab=expenses' },
    { label: 'Purchase stock', short: 'Purchase', kind: 'violet', icon: Factory, to: '/finance?tab=suppliers' },
    { label: 'Adjust stock', short: 'Adjust', kind: 'cyan', icon: SlidersHorizontal, to: '/inventory' },
    { label: 'Move stock', short: 'Transfer', kind: 'indigo', icon: ArrowLeftRight, to: '/transfers' },
  ];

  return (
    <div>
      {/* ── Quick actions ──
          Above the attention list, not below it: these are what you DO about
          what the list tells you, and burying them under it meant scrolling
          past the whole thing to act on the first line of it.
          Eight identical grey buttons make you read all eight. Tinting them by
          what they touch — approvals, money, stock — lets the eye find the one
          it wants without reading, and the colours match the rest of the page. */}
      {/* On a phone these are tiles on a four-column grid, the way a banking
          app lays its actions out: one glyph, one word, every tile the same
          size. As pills they wrapped by their own width, so eight buttons made
          a staircase with an orphan on the last line — it looked like an
          accident rather than a set of things you can do. From sm they are
          the tinted pills they always were, where there is room for the whole
          phrase. */}
      <div className="mb-4 grid grid-cols-4 gap-2 sm:mb-5 sm:flex sm:flex-wrap sm:gap-2">
        {QUICK.map((q) => {
          // Every tint class carries the sm: prefix. The tile's own dark
          // surface is unprefixed, so the two never fight over which `bg-`
          // wins — responsive variants are emitted after the base utilities,
          // and the pill gets its colour back at every width above a phone.
          const TINT = {
            sky: 'sm:border-sky-500/30 sm:bg-sky-500/10 sm:text-sky-300 sm:hover:bg-sky-500/20',
            amber: 'sm:border-amber-500/30 sm:bg-amber-500/10 sm:text-amber-300 sm:hover:bg-amber-500/20',
            rose: 'sm:border-rose-500/30 sm:bg-rose-500/10 sm:text-rose-300 sm:hover:bg-rose-500/20',
            emerald: 'sm:border-emerald-500/30 sm:bg-emerald-500/10 sm:text-emerald-300 sm:hover:bg-emerald-500/20',
            orange: 'sm:border-orange-500/30 sm:bg-orange-500/10 sm:text-orange-300 sm:hover:bg-orange-500/20',
            violet: 'sm:border-violet-500/30 sm:bg-violet-500/10 sm:text-violet-300 sm:hover:bg-violet-500/20',
            cyan: 'sm:border-cyan-500/30 sm:bg-cyan-500/10 sm:text-cyan-300 sm:hover:bg-cyan-500/20',
            indigo: 'sm:border-indigo-500/30 sm:bg-indigo-500/10 sm:text-indigo-300 sm:hover:bg-indigo-500/20',
          };
          const GLYPH = {
            sky: 'bg-sky-500/15 text-sky-300',
            amber: 'bg-amber-500/15 text-amber-300',
            rose: 'bg-rose-500/15 text-rose-300',
            emerald: 'bg-emerald-500/15 text-emerald-300',
            orange: 'bg-orange-500/15 text-orange-300',
            violet: 'bg-violet-500/15 text-violet-300',
            cyan: 'bg-cyan-500/15 text-cyan-300',
            indigo: 'bg-indigo-500/15 text-indigo-300',
          };
          return (
            <button
              key={q.label}
              type="button"
              onClick={() => navigate(q.to)}
              title={q.label}
              className={clsx(
                'relative cursor-pointer transition duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60',
                // phone: a tile
                'flex flex-col items-center gap-1.5 rounded-2xl border border-white/[0.06] bg-white/[0.03] px-1 py-2.5 active:scale-95',
                // desktop: the pill it has always been
                'sm:flex-row sm:items-center sm:gap-2 sm:rounded-full sm:border sm:px-4 sm:py-2 sm:text-sm sm:font-semibold sm:active:scale-100',
                TINT[q.kind],
              )}
            >
              <span className={clsx('flex h-9 w-9 items-center justify-center rounded-xl sm:h-auto sm:w-auto sm:rounded-none sm:!bg-transparent', GLYPH[q.kind])}>
                <q.icon className="h-[18px] w-[18px] sm:h-4 sm:w-4" />
              </span>
              <span className="w-full truncate text-center text-[11px] font-medium leading-none text-white/70 sm:w-auto sm:text-left sm:text-sm sm:leading-tight sm:text-inherit">
                <span className="sm:hidden">{q.short}</span>
                <span className="hidden sm:inline">{q.label}</span>
              </span>
              {q.badge > 0 && (
                <span className="absolute right-1.5 top-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white sm:static sm:ml-0.5">{q.badge}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Needs your attention ──
          Seven tiles showing a number each told you how many of something there
          were, but not what any of it was or which mattered. A list says the
          thing itself: what it is, why it is here, what it is worth, and where
          it goes when you tap it — ordered so the costly ones are first. */}
      {/* The well shows three rows and scrolls; the footer says how many are
          below the fold. Both come from ONE number — set the height and the
          count separately and a padding change silently makes the footer lie. */}
      {(() => {
        const items = [
          (attention.commissionRequests?.count || 0) > 0 && {
            key: 'commission-req', group: 'Sign-offs', tone: 'amber', icon: Coins,
            title: `${attention.commissionRequests.count} commission request${attention.commissionRequests.count !== 1 ? 's' : ''} to decide`,
            desc: attention.commissionRequests.items?.[0]
              ? `${attention.commissionRequests.items[0].repName}${attention.commissionRequests.count > 1 ? ' and others' : ''} — waiting on your approval`
              : 'Waiting on your approval',
            value: formatCurrency(attention.commissionRequests.total),
            onOpen: () => setReviewing(attention.commissionRequests.items || []),
          },
          attention.overdueSettlements > 0 && {
            key: 'overdue', group: 'Overdue', tone: 'rose', icon: AlertTriangle,
            title: `${attention.overdueSettlements} order${attention.overdueSettlements !== 1 ? 's' : ''} past the deadline`,
            desc: 'Past 72 hours and collecting a daily fine',
            value: formatCurrency(attention.overdueValue), to: '/settlements',
          },
          attention.outOfStock > 0 && {
            key: 'oos', group: 'Stock', tone: 'rose', icon: PackageX,
            title: `${attention.outOfStock} product${attention.outOfStock !== 1 ? 's' : ''} out of stock`,
            desc: 'Nothing left to sell or issue', to: '/reorder',
          },
          attention.settlements > 0 && {
            key: 'stl', group: 'Approvals', tone: 'amber', icon: Timer,
            title: `${attention.settlements} settlement${attention.settlements !== 1 ? 's' : ''} to approve`,
            desc: 'Money reported by reps, not yet confirmed', to: '/settlements',
          },
          attention.stockRequests > 0 && {
            key: 'req', group: 'Approvals', tone: 'sky', icon: ClipboardList,
            title: `${attention.stockRequests} stock request${attention.stockRequests !== 1 ? 's' : ''} waiting`,
            desc: 'Reps cannot sell until this is issued', to: '/stock-requests',
          },
          attention.returns > 0 && {
            key: 'ret', group: 'Approvals', tone: 'sky', icon: Undo2,
            title: `${attention.returns} return${attention.returns !== 1 ? 's' : ''} to decide`,
            desc: attention.returnsToday > 0
              ? `${attention.returnsToday} today · ${attention.returnsTodayBoxes} boxes · boxes stay locked until you decide`
              : 'Boxes stay locked until you decide',
            to: '/returns',
          },
          attention.lowStock.count > 0 && {
            key: 'low', group: 'Stock', tone: 'amber', icon: TrendingDown,
            title: `${attention.lowStock.count} product${attention.lowStock.count !== 1 ? 's' : ''} running low`,
            desc: attention.lowStock.items[0]?.name ? `Lowest: ${attention.lowStock.items[0].name}` : 'Below reorder level',
            to: '/reorder',
          },
          attention.supplierDue > 0 && {
            key: 'sup', group: 'Money', tone: 'violet', icon: Factory,
            title: 'Owed to suppliers',
            desc: 'Bills raised against stock you have received',
            value: formatCurrency(attention.supplierDue), to: '/finance?tab=suppliers',
          },
        ].filter(Boolean);

        const groups = ['All', ...[...new Set(items.map((i) => i.group))]];
        const shown = attentionFilter === 'All' ? items : items.filter((i) => i.group === attentionFilter);
        const TONE = {
          rose: 'bg-rose-500/15 text-rose-400 ring-rose-500/25',
          amber: 'bg-amber-500/15 text-amber-400 ring-amber-500/25',
          sky: 'bg-sky-500/15 text-sky-400 ring-sky-500/25',
          violet: 'bg-violet-500/15 text-violet-400 ring-violet-500/25',
        };

        return (
          <div className="mb-6">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Needs your attention</h2>
                {items.length > 0 && (
                  <span className="rounded-full bg-rose-500/20 px-2 py-0.5 text-[11px] font-bold text-rose-400">{items.length}</span>
                )}
              </div>
              {items.length === 0 && (
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-400">
                  <CheckCircle2 className="h-3.5 w-3.5" /> All clear
                </span>
              )}
            </div>

            {items.length === 0 ? (
              <Card><p className="p-5 text-sm text-faint">Nothing is waiting on you. Every request, settlement and return has been dealt with.</p></Card>
            ) : (
              <>
                {groups.length > 2 && (
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {groups.map((g) => {
                      const n = g === 'All' ? items.length : items.filter((i) => i.group === g).length;
                      return (
                        <button key={g} type="button" onClick={() => setAttentionFilter(g)}
                          className={clsx(
                            'cursor-pointer rounded-full px-2.5 py-0.5 text-[11px] font-medium transition duration-200',
                            attentionFilter === g ? 'bg-brand-500 text-black' : 'bg-elevated text-muted hover:text-foreground',
                          )}>
                          {g} <span className="opacity-60">{n}</span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Frosted rows over the page, per the glass style: a 1px light
                    border and a blur, so the list reads as raised rather than drawn. */}
                <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.02] backdrop-blur-sm">
                  <div className="overflow-y-auto" style={{ maxHeight: ATTENTION_ROWS * ATTENTION_ROW_PX }}>
                  {shown.map((i, idx) => (
                    <button key={i.key} type="button" onClick={() => (i.onOpen ? i.onOpen() : navigate(i.to))}
                      className={clsx(
                        'flex w-full cursor-pointer items-center gap-2.5 px-3.5 py-2.5 text-left transition duration-200 hover:bg-white/[0.04]',
                        idx > 0 && 'border-t border-white/[0.06]',
                      )}>
                      <span className={clsx('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ring-1', TONE[i.tone])}>
                        <i.icon className="h-3.5 w-3.5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-semibold leading-tight text-foreground">{i.title}</span>
                        <span className="block truncate text-[11px] leading-tight text-muted">{i.desc}</span>
                      </span>
                      {i.value && <span className="shrink-0 text-[13px] font-bold tabular-nums text-foreground">{i.value}</span>}
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-faint" />
                    </button>
                  ))}
                  </div>
                  {/* Say how many are below the fold, so a capped list never
                      hides the fact that there is more. */}
                  {shown.length > ATTENTION_ROWS && (
                    <div className="border-t border-white/[0.06] py-1.5 text-center text-[11px] text-faint">
                      scroll for {shown.length - ATTENTION_ROWS} more
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        );
      })()}

      {/* ── The money ──────────────────────────────────────────────────────
             This used to be a tall green banner at the very top: the figure,
             two chips, a greeting, a section label, a bar and three rows. The
             banner above it already says who is signed in and what day it is,
             so this is now a card like any other — the total on the left with
             the pockets it sits in, the day's movement on the right — and it
             sits under the attention list, because what needs deciding comes
             before what is simply true. ── */}
      <div className="card mb-4 overflow-hidden sm:mb-5">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
          <h2 className="text-base font-semibold text-foreground">The money</h2>
          <div className="flex items-center gap-2">
            {/* This is the NET move in the balance, so it has to be worded as
                one. It read "TSh 449,000 out today" on a day when 624,000 went
                out and 175,000 came in. Both gross figures are in the payload,
                so they carry the detail on hover. */}
            <span
              title={`In ${formatCurrency(today.moneyIn || 0)} · out ${formatCurrency(today.moneyOut || 0)}`}
              className={clsx(
                'hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold sm:inline-flex',
                today.netCash === 0 ? 'bg-white/[0.06] text-muted'
                  : today.netCash > 0 ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300',
              )}>
              {today.netCash === 0 ? null : today.netCash > 0 ? <ArrowDownLeft className="h-3 w-3" /> : <ArrowUpRight className="h-3 w-3" />}
              {today.netCash === 0
                ? 'No change today'
                : <>{formatCurrency(Math.abs(today.netCash))} {today.netCash > 0 ? 'up' : 'down'} today</>}
            </span>
            <button onClick={() => navigate('/finance?tab=accounts')}
              className="cursor-pointer text-xs font-semibold text-brand-400 transition hover:text-brand-300">
              Open accounts →
            </button>
          </div>
        </div>

        <div className="grid lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          {/* Left: what there is, and which pocket holds it. An account with
              nothing in it is not an answer to "where does it sit", so it is
              left out; its colour stays reserved by its original position so
              the others do not shuffle when one empties. */}
          <div className="min-w-0 p-4 sm:p-5">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-faint">In the accounts</p>
            <p className="mt-1.5 text-[30px] font-bold leading-none tracking-tight text-foreground sm:text-4xl">
              {formatCurrency(totalFunds)}
            </p>
            {totalFunds > 0 && (
              <div className="mt-4 flex h-2 w-full overflow-hidden rounded-full bg-white/[0.07]">
                {heroAccounts.map((a) => (
                  <div key={a.id} className={HERO_BAR[a._i % HERO_BAR.length]}
                    style={{ width: `${Math.max(0, (a.balance / totalFunds) * 100)}%` }} />
                ))}
              </div>
            )}
            <div className="mt-3 divide-y divide-border/70">
              {heroAccounts.map((a) => {
                const Icon = ACCOUNT_ICON[a.type] || Wallet;
                const share = totalFunds > 0 ? Math.round((a.balance / totalFunds) * 100) : 0;
                return (
                  <button key={a.id} onClick={() => navigate('/finance?tab=accounts')}
                    className="group flex w-full cursor-pointer items-center gap-2.5 py-2 text-left transition hover:opacity-80 sm:gap-3 sm:py-2.5">
                    <span className={clsx('h-2 w-2 shrink-0 rounded-full sm:h-2.5 sm:w-2.5', HERO_DOT[a._i % HERO_DOT.length])} />
                    <Icon className="hidden h-4 w-4 shrink-0 text-faint sm:block" />
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-muted sm:text-sm">{a.name}</span>
                    <span className={clsx('shrink-0 text-sm font-bold tabular-nums sm:text-base', a.balance < 0 ? 'text-rose-300' : 'text-foreground')}>
                      {formatCurrency(a.balance)}
                    </span>
                    <span className="w-9 shrink-0 text-right text-[11px] tabular-nums text-faint">{share}%</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right: what moved today. */}
          <div className="min-w-0 border-t border-border p-4 sm:p-5 lg:border-l lg:border-t-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-faint">Today</p>
            <div className="mt-1 divide-y divide-border/70">
              {[
                { label: 'Money in today', value: formatCurrency(today.moneyIn || 0), tone: (today.moneyIn || 0) > 0 ? 'text-emerald-300' : 'text-muted' },
                { label: 'Money out today', value: formatCurrency(today.moneyOut || 0), tone: (today.moneyOut || 0) > 0 ? 'text-rose-300' : 'text-muted' },
                { label: 'Net cash today', value: formatCurrency(today.netCash || 0), tone: today.netCash > 0 ? 'text-emerald-300' : today.netCash < 0 ? 'text-rose-300' : 'text-muted' },
                { label: 'Boxes sold today', value: formatNumber(today.boxesSold || 0), tone: 'text-foreground' },
              ].map((r) => (
                <div key={r.label} className="flex items-center justify-between gap-3 py-2.5 sm:py-3">
                  <span className="min-w-0 truncate text-[13px] text-muted sm:text-sm">{r.label}</span>
                  <span className={clsx('shrink-0 text-sm font-bold tabular-nums sm:text-base', r.tone)}>{r.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>


      {/* ── Today's business (all from Finance) ──
          A figure on its own says how much and nothing about whether that is
          good. The 30-day series is already on the page, so today is compared
          against the fortnight behind it — no extra query, and the number
          finally means something. */}
      {(() => {
        const days = charts?.daily || [];
        const past = days.slice(0, -1).slice(-14).filter((d) => d.revenue > 0);
        const avg = past.length ? past.reduce((a, d) => a + d.revenue, 0) / past.length : 0;
        // Below three trading days there is no average worth comparing against,
        // and a delta drawn from one quiet day would mislead more than it helps.
        const cmp = past.length >= 3 && avg > 0
          ? { pct: Math.round(((today.revenue - avg) / avg) * 100), avg, days: past.length }
          : null;
        return (
          <>
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Today's business</h2>
                <p className="text-xs text-faint">Money in and out since midnight, straight from Finance.</p>
              </div>
              {cmp && (
                // "Daily average" is looser than the figure behind it, which is
                // the mean of the days that actually had sales — a quiet
                // Sunday is left out rather than dragging every working day
                // above the line. And today is still running, so before the
                // afternoon a part-day is being measured against whole ones.
                // Both are stated on hover rather than crammed into the pill.
                <span
                  title={`Average of the ${cmp.days} day${cmp.days === 1 ? '' : 's'} with sales in the last fortnight, today not counted. Today is still running, so it is a part-day against whole ones.`}
                  className={clsx(
                    'cursor-help rounded-full px-2.5 py-1 text-[11px] font-semibold',
                    cmp.pct >= 0 ? 'bg-emerald-500/15 text-emerald-400' : 'bg-rose-500/15 text-rose-400',
                  )}>
                  {cmp.pct >= 0 ? '▲' : '▼'} {Math.abs(cmp.pct)}% vs the {formatCurrency(Math.round(cmp.avg))} daily average
                </span>
              )}
            </div>
          </>
        );
      })()}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard compact label="Revenue" value={formatCurrency(today.revenue)} icon={TrendingUp} tone="emerald" />
        <StatCard compact label="Gross profit" value={formatCurrency(today.grossProfit)} icon={Wallet} tone="brand" onClick={() => navigate('/finance?tab=profit')} />
        <StatCard compact label="Expenses" value={formatCurrency(today.expenses)} icon={Receipt} tone="rose" onClick={() => navigate('/finance?tab=expenses')} />
        <StatCard compact label="Net profit" value={formatCurrency(today.netProfit)} icon={Scale} tone={today.netProfit >= 0 ? 'violet' : 'rose'} />
        <StatCard
          compact
          label="Boxes sold"
          value={formatNumber((charts?.daily || []).slice(-1)[0]?.boxes || 0)}
          icon={Boxes}
          tone="sky"
          hint="settled today"
        />
        <StatCard compact label="Cash flow" value={formatCurrency(today.netCash)} icon={today.netCash >= 0 ? ArrowDownLeft : ArrowUpRight} tone={today.netCash >= 0 ? 'emerald' : 'rose'} hint={`in ${formatCurrency(today.moneyIn)} · out ${formatCurrency(today.moneyOut)}`} onClick={() => navigate('/finance?tab=cashflow')} />
      </div>

      {/* ── The running total: today, this week, or this month ──
          It was the month and only the month, at the very bottom of the page.
          The month is the question an owner opens the app to answer — but not
          the only one: the week is what says whether the money is coming in
          now, and waiting for month end to find out is too late. All three sit
          under the hero, one tap apart, on the same figures. */}
      <div className="mb-5">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-2">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{shown.heading}</h2>
            <p className="text-xs text-faint">
              {shown.key === 'today'
                ? 'Settled so far today.'
                : `What has been collected ${shown.key === 'week' ? 'this week' : 'this month'} · ${shown.when}.`}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <PeriodTabs value={period} onChange={setPeriod} options={Object.values(periods).filter((o) => o.available)} />
            <button type="button" onClick={() => navigate('/finance')}
              className="shrink-0 cursor-pointer text-xs font-medium text-brand-500 transition duration-200 hover:underline">
              Open Finance →
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.06] sm:grid-cols-3">
          {(() => {
            const margin = shown.revenue > 0 ? (shown.grossProfit / shown.revenue) * 100 : null;
            const cells = [
              {
                label: 'Revenue', value: formatCurrency(shown.revenue),
                sub: `${formatNumber(shown.boxes)} boxes settled`, tone: 'text-foreground',
              },
              {
                label: 'Gross profit', value: formatCurrency(shown.grossProfit),
                sub: margin == null ? 'no sales yet' : `${margin.toFixed(1)}% margin`,
                tone: shown.grossProfit >= 0 ? 'text-emerald-300' : 'text-rose-400',
              },
              {
                label: 'Boxes sold', value: formatNumber(shown.boxes),
                sub: shown.revenue > 0 ? `${formatCurrency(Math.round(shown.revenue / Math.max(1, shown.boxes)))} a box` : 'nothing settled yet',
                tone: 'text-foreground',
              },
            ];
            return cells.map((c) => (
              <div key={c.label} className="flex items-baseline justify-between gap-3 bg-surface px-4 py-2.5">
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">{c.label}</p>
                  <p className="truncate text-[11px] text-faint">{c.sub}</p>
                </div>
                <p className={clsx('shrink-0 text-base font-bold tabular-nums', c.tone)}>{c.value}</p>
              </div>
            ));
          })()}
        </div>
      </div>

      {/* ── Where every box is ──
          Five separate stat cards stated the same total five ways and never
          said how the stock is split. One bar does: the whole holding, divided
          where it actually sits, with the numbers underneath. */}
      <div className="mt-8">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Inventory · where every box is</h2>
            <p className="text-xs text-faint">Everything The Lab is carrying, in the warehouse and out with the reps.</p>
          </div>
          <button type="button" onClick={() => navigate('/inventory')} className="shrink-0 text-xs font-medium text-brand-500 hover:underline">
            Inventory →
          </button>
        </div>

        <Card>
          <div className="p-5">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-3xl font-bold tabular-nums text-foreground">{formatCurrency(inventory.costValue)}</p>
                <p className="mt-0.5 text-xs text-faint">stock value · at cost · selling {formatCurrency(inventory.sellingValue)}</p>
              </div>
              <p className="text-sm font-semibold tabular-nums text-muted">
                {formatNumber(inventory.units)} boxes in stock
              </p>
            </div>

            {(() => {
              const wh = Math.max(0, inventory.warehouseBoxes || 0);
              const rep = Math.max(0, inventory.repBoxes || 0);
              const total = wh + rep;
              const pct = (n) => (total > 0 ? (n / total) * 100 : 0);
              const parts = [
                { key: 'wh', label: 'In warehouse', value: wh, colour: '#a3e635', to: '/inventory' },
                { key: 'rep', label: 'With reps', value: rep, colour: '#7c3aed', to: '/reps' },
              ];
              return (
                <>
                  <div className="mt-4 flex h-2.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
                    {parts.map((p) => (
                      <div key={p.key} style={{ width: `${pct(p.value)}%`, background: p.colour }} title={`${p.label}: ${p.value}`} />
                    ))}
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
                    {parts.map((p) => (
                      <button key={p.key} type="button" onClick={() => navigate(p.to)} className="text-left">
                        <span className="flex items-center gap-2">
                          <span className="h-2 w-2 rounded-full" style={{ background: p.colour }} />
                          <span className="text-xs text-muted">{p.label}</span>
                        </span>
                        <p className="mt-0.5 text-xl font-bold tabular-nums text-foreground">{formatNumber(p.value)}</p>
                        <p className="text-[11px] text-faint">{Math.round(pct(p.value))}% of stock</p>
                      </button>
                    ))}
                    <div>
                      <span className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full bg-emerald-400" />
                        <span className="text-xs text-muted">Sold this month</span>
                      </span>
                      <p className="mt-0.5 text-xl font-bold tabular-nums text-emerald-300">{formatNumber(month.boxes)}</p>
                      <p className="text-[11px] text-faint">boxes settled</p>
                    </div>
                    <button type="button" onClick={() => navigate('/returns')} className="text-left">
                      <span className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full bg-sky-400" />
                        <span className="text-xs text-muted">Returned today</span>
                      </span>
                      <p className="mt-0.5 text-xl font-bold tabular-nums text-foreground">{formatNumber(inventory.returnedToday)}</p>
                      <p className="text-[11px] text-faint">boxes back</p>
                    </button>
                  </div>
                </>
              );
            })()}
          </div>
        </Card>
      </div>

      {/* ── Charts ──
          The dashboard could say what today was worth but never whether that
          was good. These give the totals a shape: where the money has been
          going, and which region, rep and product carry it. */}
      {charts && (
        <div className="mb-6 space-y-4">
          <div><h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Trend</h2><p className="text-xs text-faint">Where the money has been going, and who is bringing it in.</p></div>

          <Card>
            <CardHeader title="Revenue and gross profit" subtitle="Last 30 days" />
            <div className="px-2 pb-2">
              <TrendChart
                data={charts.daily}
                height={240}
                series={[
                  { key: 'revenue', name: 'Revenue', color: '#a3e635' },
                  { key: 'profit', name: 'Gross profit', color: '#34d399' },
                ]}
              />
            </div>
          </Card>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <Card>
              <CardHeader title="Revenue by region" subtitle="This month" />
              {charts.byRegion?.length ? (
                <div className="px-2 pb-2"><DonutChart data={charts.byRegion} height={230} /></div>
              ) : (
                <p className="px-5 pb-5 text-sm text-faint">No sales recorded this month.</p>
              )}
            </Card>

            {/* Ranked rather than plotted: eight bars of similar length are hard
                to order at a glance, where a numbered list is already ordered,
                and it has room to carry the region alongside the money. */}
            <Card>
              <CardHeader title="Top reps" subtitle="Revenue this month" />
              {charts.byRep?.length ? (
                <div className="space-y-2 p-4 pt-0">
                  {charts.byRep.slice(0, 6).map((r, i) => {
                    const top = charts.byRep[0].value || 1;
                    return (
                      <div key={r.name + i}>
                        <div className="flex items-center gap-2.5">
                          <span className={clsx(
                            'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold',
                            i === 0 ? 'bg-brand-500 text-black' : 'bg-elevated text-muted',
                          )}>
                            {i + 1}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-sm text-foreground">{r.name}</span>
                          <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">{formatCurrency(r.value)}</span>
                        </div>
                        <div className="mt-1 ml-7 h-1 overflow-hidden rounded-full bg-white/[0.06]">
                          <div className="h-full rounded-full bg-gradient-to-r from-brand-600 to-brand-400"
                            style={{ width: `${Math.max(4, (r.value / top) * 100)}%` }} />
                        </div>
                        {r.region && <p className="ml-7 mt-0.5 text-[11px] text-faint">{r.region}</p>}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="px-5 pb-5 text-sm text-faint">No rep sales this month.</p>
              )}
            </Card>

            <Card>
              <CardHeader title="Top products" subtitle="Revenue this month" />
              {charts.topProducts?.length ? (
                <div className="px-2 pb-2"><BarChartCard data={charts.topProducts} height={230} color="#f59e0b" /></div>
              ) : (
                <p className="px-5 pb-5 text-sm text-faint">Nothing sold this month.</p>
              )}
            </Card>
          </div>
        </div>
      )}

      {/* ── Brand performance ── */}
      {brands.length > 0 && (
        <div className="mt-8">
          {/* The period was a whisper in the corner, so these figures got
              compared against Finance's all-time view and looked wrong. They
              are not wrong — they are THIS MONTH, and the heading now says so
              loudly enough that the comparison is never made by accident. */}
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-2">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Brand performance</h2>
              <span className="rounded-full bg-brand-500/15 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-brand-300">
                {shown.when}
              </span>
            </div>
            <PeriodTabs value={period} onChange={setPeriod} options={Object.values(periods).filter((o) => o.available)} />
            <p className="w-full text-xs text-faint">
              Sales made {shown.key === 'today' ? 'today' : shown.key === 'week' ? 'this week' : 'this month'} only — not
              money in an account, and not the all-time figures on the Finance page. The stock figures below are what the
              brand holds right now.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {brands.map((b) => {
              const t = BRAND_TONE[b.name?.toUpperCase()] || { ring: 'border-border', bg: 'bg-surface', badge: 'bg-elevated text-muted', dot: 'bg-border' };
              return (
                <button key={b.brandId} onClick={() => navigate('/finance?tab=profit')} className={`w-full rounded-2xl border ${t.ring} ${t.bg} p-4 text-left transition hover:bg-elevated`}>
                  <div className="mb-3 flex items-center gap-2">
                    <span className={`h-2.5 w-2.5 rounded-full ${t.dot}`} />
                    <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${t.badge}`}>{b.name}</span>
                    <span className="ml-auto text-[11px] font-medium text-faint">{shown.label}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-3">
                    <Mini label="Revenue" value={formatCurrency(b[`revenue${shown.suffix}`])} sub={`${formatNumber(b[`boxesSold${shown.suffix}`])} boxes sold`} />
                    <Mini label="Gross profit" value={formatCurrency(b[`grossProfit${shown.suffix}`])} sub={`${b[`margin${shown.suffix}`]}% margin`} />
                    <Mini label="Inventory value" value={formatCurrency(b.inventoryValue)} />
                    <Mini label="In warehouse" value={`${formatNumber(b.warehouseBoxes)} boxes`} />
                    <Mini label="With reps" value={`${formatNumber(b.repBoxes)} boxes`} />
                    <Mini label="Top product" value={b.topProduct ? b.topProduct.name.replace(/civlily|ohis/i, '').trim().slice(0, 18) : '—'} sub={b.topProduct ? formatCurrency(b.topProduct.revenue) : 'no sales yet'} />
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Sales rep performance ── */}
      <Card className="mt-8">
        <CardHeader title="Sales rep performance" subtitle="Who is selling, who is holding, who needs follow-up" />
        {reps.length === 0 ? <EmptyState title="No active reps" /> : (
          <Table>
            <THead>
              <TR><TH>Rep</TH><TH>Boxes held</TH><TH>Sales today</TH><TH>Sales (month)</TH><TH>Commission</TH><TH>Orders</TH><TH>Status</TH></TR>
            </THead>
            <TBody>
              {reps.map((r) => (
                <TR key={r.salesRepId} className="cursor-pointer" onClick={() => navigate(`/reps/${r.salesRepId}`)}>
                  <TD className="font-medium text-foreground">{r.name} <span className="text-xs text-faint">{r.code}</span></TD>
                  <TD>{formatNumber(r.boxesHeld)}</TD>
                  <TD className={r.salesToday > 0 ? 'text-emerald-500' : 'text-faint'}>{formatCurrency(r.salesToday)}</TD>
                  <TD>{formatCurrency(r.salesMonth)}</TD>
                  <TD className={r.commissionAvailable < 0 ? 'text-rose-500' : ''}>{formatCurrency(r.commissionAvailable)}</TD>
                  <TD>{r.activeOrders > 0 ? `${r.activeOrders} active` : '—'}</TD>
                  <TD>
                    {r.overdueOrders > 0
                      ? <Badge className="bg-rose-500/15 text-rose-300">{r.overdueOrders} overdue</Badge>
                      : r.activeOrders > 0
                        ? <Badge className="bg-sky-500/15 text-sky-300">Settling</Badge>
                        : <Badge className="bg-emerald-500/15 text-emerald-300">Clear</Badge>}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      {reviewing && <ReviewWithdrawals items={reviewing} onClose={() => setReviewing(null)} />}
    </div>
  );
}
