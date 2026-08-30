import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Wallet, TrendingUp, TrendingDown, Boxes, Warehouse, Truck, AlertTriangle,
  ArrowRight, Timer, CheckCircle2, Banknote, Landmark, Smartphone, PiggyBank,
  ClipboardList, Undo2, Factory, PackageX, Receipt, ShoppingCart, SlidersHorizontal,
  ArrowDownLeft, ArrowUpRight, Scale, ChevronRight,
} from 'lucide-react';
import { motion } from 'motion/react';
import clsx from 'clsx';
import api, { unwrap } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { formatCurrency, formatNumber } from '@/lib/format';
import { TrendChart, BarChartCard, DonutChart } from '@/components/charts';
import { tzGreeting, tzDateLabel } from '@/lib/tz';
import {
  StatCard, Card, CardHeader, CardBody, PageSpinner, EmptyState, Badge, Button,
  Table, THead, TBody, TR, TH, TD,
} from '@/components/ui';

const ACCOUNT_ICON = { CASH: Banknote, BANK: Landmark, MOBILE_MONEY: Smartphone, OTHER: Wallet };

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

export default function Dashboard() {
  const [attentionFilter, setAttentionFilter] = useState('All');
  // The actual month by name, so "this month" can never be mistaken for
  // "everything". Tanzania is UTC+3 with no DST, so the shift is fixed.
  const monthLabel = new Date(Date.now() + 3 * 3600_000)
    .toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['dashboard', 'command'],
    queryFn: async () => unwrap(await api.get('/dashboard/command')).data,
    refetchInterval: 30_000, // live business status
  });

  if (isLoading) return <PageSpinner label="Building your command center…" />;
  if (isError || !data) return <EmptyState title="Couldn't load the dashboard" message="Please try again shortly." icon={AlertTriangle} />;

  const { accounts, totalFunds, today, month, brands, reps, attention, inventory, charts} = data;
  const firstName = user?.name?.split(' ')[0] || 'there';
  const attentionCount =
    attention.stockRequests + attention.settlements + attention.returns +
    attention.overdueSettlements + attention.lowStock.count + attention.outOfStock;

  const QUICK = [
    { label: 'Approve requests', icon: ClipboardList, to: '/stock-requests', badge: attention.stockRequests },
    { label: 'Approve settlements', icon: Timer, to: '/settlements', badge: attention.settlements },
    { label: 'Approve returns', icon: Undo2, to: '/returns', badge: attention.returns },
    { label: 'Record sale', icon: ShoppingCart, to: '/sales' },
    { label: 'Record expense', icon: Receipt, to: '/finance?tab=expenses' },
    { label: 'Purchase stock', icon: Factory, to: '/finance?tab=suppliers' },
    { label: 'Adjust stock', icon: SlidersHorizontal, to: '/inventory' },
  ];

  return (
    <div>
      {/* ── Hero ────────────────────────────────────────────────────────────
             The greeting used to take the top line and the money came third,
             under two chips; the accounts were three flat tiles crammed to
             the right. Now the money leads, the greeting is a byline, and the
             accounts read as one bar split between them — which also shows at
             a glance which pocket actually holds the business's cash. ── */}
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.2, 0.7, 0.3, 1] }}
        className="relative mb-5 overflow-hidden rounded-3xl border border-white/10 shadow-2xl"
        style={{ background: 'linear-gradient(118deg, #14260a 0%, #06402f 45%, #0b3242 100%)' }}
      >
        {/* Two light sources and a hairline sheen, so the panel reads as a
            surface catching light rather than a flat block of colour. */}
        <div className="pointer-events-none absolute -left-24 -top-28 h-80 w-80 rounded-full bg-brand-400/25 blur-3xl" aria-hidden="true" />
        <div className="pointer-events-none absolute -bottom-28 right-0 h-72 w-72 rounded-full bg-cyan-300/12 blur-3xl" aria-hidden="true" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent" aria-hidden="true" />

        <div className="relative grid gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:items-center lg:gap-10 lg:p-7">
          {/* The money, first. */}
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-brand-300/90">Money you can use right now</p>
            <p className="mt-2 text-4xl font-bold leading-none tracking-tight text-white sm:text-5xl">
              {formatCurrency(totalFunds)}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className={clsx(
                'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold',
                today.netCash >= 0 ? 'bg-emerald-400/15 text-emerald-200' : 'bg-rose-400/15 text-rose-200',
              )}>
                {today.netCash >= 0 ? <ArrowDownLeft className="h-3 w-3" /> : <ArrowUpRight className="h-3 w-3" />}
                {formatCurrency(Math.abs(today.netCash))} {today.netCash >= 0 ? 'in' : 'out'} today
              </span>
              {today.boxesSold > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-white/80">
                  <Boxes className="h-3 w-3" /> {formatNumber(today.boxesSold)} boxes sold today
                </span>
              )}
            </div>
            <p className="mt-4 text-sm text-white/55">
              {tzGreeting()}, {firstName} · {tzDateLabel({ weekday: 'long', day: 'numeric', month: 'long' })}
            </p>
          </div>

          {/* Where that money sits — one bar, then the pockets. */}
          <div className="min-w-0">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-white/45">Where it sits</p>
              <button onClick={() => navigate('/finance?tab=accounts')}
                className="cursor-pointer text-[11px] font-semibold text-brand-300 transition hover:text-brand-200">
                Open accounts →
              </button>
            </div>
            {totalFunds > 0 && (
              <div className="mt-3 flex h-2 w-full overflow-hidden rounded-full bg-white/10">
                {accounts.map((a, i) => (
                  <div key={a.id} className={HERO_BAR[i % HERO_BAR.length]}
                    style={{ width: `${Math.max(0, (a.balance / totalFunds) * 100)}%` }} />
                ))}
              </div>
            )}
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
              {accounts.map((a, i) => {
                const Icon = ACCOUNT_ICON[a.type] || Wallet;
                const share = totalFunds > 0 ? Math.round((a.balance / totalFunds) * 100) : 0;
                return (
                  <button key={a.id} onClick={() => navigate('/finance?tab=accounts')}
                    className="cursor-pointer rounded-2xl border border-white/10 bg-white/[0.07] p-3 text-left backdrop-blur-sm transition duration-200 hover:border-white/25 hover:bg-white/[0.13]">
                    <div className="flex items-center gap-1.5">
                      <span className={clsx('h-2 w-2 shrink-0 rounded-full', HERO_DOT[i % HERO_DOT.length])} />
                      <Icon className="h-3.5 w-3.5 shrink-0 text-white/50" />
                      <span className="truncate text-[11px] font-semibold uppercase tracking-wide text-white/55">{a.name}</span>
                    </div>
                    <div className={clsx('mt-1.5 text-lg font-bold tabular-nums', a.balance < 0 ? 'text-rose-300' : 'text-white')}>
                      {formatCurrency(a.balance)}
                    </div>
                    <div className="text-[10px] text-white/40">{share}% of the total</div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </motion.div>

      {/* ── Needs your attention ──
          Seven tiles showing a number each told you how many of something there
          were, but not what any of it was or which mattered. A list says the
          thing itself: what it is, why it is here, what it is worth, and where
          it goes when you tap it — ordered so the costly ones are first. */}
      {(() => {
        const items = [
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
                  <div className="max-h-[168px] overflow-y-auto">
                  {shown.map((i, idx) => (
                    <button key={i.key} type="button" onClick={() => navigate(i.to)}
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
                  {shown.length > 3 && (
                    <div className="border-t border-white/[0.06] py-1.5 text-center text-[11px] text-faint">
                      scroll for {shown.length - 3} more
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        );
      })()}

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
          ? { pct: Math.round(((today.revenue - avg) / avg) * 100), avg }
          : null;
        return (
          <>
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Today's business</h2>
                <p className="text-xs text-faint">Money in and out since midnight, straight from Finance.</p>
              </div>
              {cmp && (
                <span className={clsx(
                  'rounded-full px-2.5 py-1 text-[11px] font-semibold',
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

      {/* ── This month ──
          The month's revenue, profit and volume were a line of grey text at the
          very bottom of the page, under everything. It is the question an owner
          opens the app to answer, so it sits under the hero, and the margin —
          which was not shown at all — is the figure that says whether the
          revenue above it was worth earning. */}
      <div className="mb-5">
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
              This month · {tzDateLabel({ month: 'long' })}
            </h2>
            <p className="text-xs text-faint">The running total today is measured against.</p>
          </div>
          <button type="button" onClick={() => navigate('/finance')}
            className="shrink-0 cursor-pointer text-xs font-medium text-brand-500 transition duration-200 hover:underline">
            Open Finance →
          </button>
        </div>

        <div className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.06] sm:grid-cols-3">
          {(() => {
            const margin = month.revenue > 0 ? (month.grossProfit / month.revenue) * 100 : null;
            const cells = [
              {
                label: 'Revenue', value: formatCurrency(month.revenue),
                sub: `${formatNumber(month.boxes)} boxes settled`, tone: 'text-foreground',
              },
              {
                label: 'Gross profit', value: formatCurrency(month.grossProfit),
                sub: margin == null ? 'no sales yet' : `${margin.toFixed(1)}% margin`,
                tone: month.grossProfit >= 0 ? 'text-emerald-300' : 'text-rose-400',
              },
              {
                label: 'Boxes sold', value: formatNumber(month.boxes),
                sub: month.revenue > 0 ? `${formatCurrency(Math.round(month.revenue / Math.max(1, month.boxes)))} a box` : 'nothing settled yet',
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

      {/* ── Quick actions ──
          Eight identical grey buttons make you read all eight. Tinting them by
          what they touch — approvals, money, stock — lets the eye find the one
          it wants without reading, and the colours match the rest of the page. */}
      <div className="mt-5 flex flex-wrap gap-2">
        {QUICK.map((q) => {
          const TINT = {
            approve: 'border-sky-500/30 bg-sky-500/10 text-sky-300 hover:bg-sky-500/20',
            money: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20',
            stock: 'border-violet-500/30 bg-violet-500/10 text-violet-300 hover:bg-violet-500/20',
          };
          const kind = q.label.startsWith('Approve') ? 'approve'
            : /sale|expense/i.test(q.label) ? 'money' : 'stock';
          return (
            <button
              key={q.label}
              type="button"
              onClick={() => navigate(q.to)}
              className={clsx(
                'relative inline-flex cursor-pointer items-center gap-2 rounded-xl border px-3.5 py-2 text-sm font-medium transition duration-200',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60',
                TINT[kind],
              )}
            >
              <q.icon className="h-4 w-4" /> {q.label}
              {q.badge > 0 && (
                <span className="ml-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">{q.badge}</span>
              )}
            </button>
          );
        })}
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
          <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Brand performance</h2>
            <span className="rounded-full bg-brand-500/15 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-brand-300">
              {monthLabel}
            </span>
            <p className="w-full text-xs text-faint">
              Sales made this month only — not money in an account, and not the all-time figures on the Finance page.
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
                    <span className="ml-auto text-[11px] font-medium text-faint">{monthLabel}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-3">
                    <Mini label="Revenue" value={formatCurrency(b.revenueMonth)} sub={`${formatNumber(b.boxesSoldMonth)} boxes sold`} />
                    <Mini label="Gross profit" value={formatCurrency(b.grossProfitMonth)} sub={`${b.marginMonth}% margin`} />
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
                      ? <Badge className="bg-rose-100 text-rose-700">{r.overdueOrders} overdue</Badge>
                      : r.activeOrders > 0
                        ? <Badge className="bg-sky-100 text-sky-700">Settling</Badge>
                        : <Badge className="bg-emerald-100 text-emerald-700">Clear</Badge>}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

    </div>
  );
}
