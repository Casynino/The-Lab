import { STEADY } from '@/lib/polling';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Wallet,
  TrendingUp,
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
  ArrowLeftRight,
  Receipt,
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
import { formatCurrency, formatNumber, formatPercent, formatDateTime } from '@/lib/format';
import { TrendChart, BarChartCard, DonutChart, MonthBars } from '@/components/charts';
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
import { RED } from '@/lib/brand';

// How many attention rows are visible before the list scrolls, and the height
// of one row. A row is h-10 (40px) with a 1px divider above all but the first;
// the box is cut at ROWS x 45, which leaves a sliver of the next row showing —
// and that sliver is what tells you the list scrolls at all. Both numbers come
// from here, so the box and the "scroll for N more" line can never disagree.
const ATTENTION_ROWS = 3;
const ATTENTION_ROW_PX = 45;

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
      <div className="mt-0.5 break-words text-sm font-bold leading-snug tabular-nums text-foreground lg:text-base xl:text-sm 2xl:text-base">{value}</div>
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
                className="flex h-11 items-center justify-center gap-2 rounded-xl bg-brand-500 text-[13px] font-bold text-white ring-1 ring-brand-500 transition active:scale-[0.97] disabled:opacity-60">
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
            value === o.key ? 'bg-brand-500 text-white' : 'text-muted hover:text-foreground',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ── The shape of the business ───────────────────────────────────────────────

/* A month against the one before it. The arrow is the direction of the money,
   not of the mood: expenses falling is green, revenue falling is red, and the
   card says which it is rather than leaving the colour to say it. */
function Delta({ pct, goodWhenDown = false }) {
  // Growth from a base of zero — or from a loss — is not a percentage, it is
  // an unanswerable question. The server sends null for it and the card falls
  // back to simply stating what last month was, which is never wrong. It used
  // to say "nothing last month", which is a lie about a month that lost money.
  if (pct == null) return null;
  const flat = Math.abs(pct) < 0.05;
  const good = flat ? null : goodWhenDown ? pct < 0 : pct > 0;
  return (
    <span className={clsx(
      'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums',
      good === null ? 'bg-white/[0.06] text-muted' : good ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300',
    )}>
      {flat ? '—' : pct > 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownLeft className="h-3 w-3" />}
      {formatPercent(Math.abs(pct))}
    </span>
  );
}

function MonthCard({ label, icon: Icon, tone, value, delta, beforeLabel, goodWhenDown = false, note }) {
  return (
    <div className="card p-3.5 sm:p-4">
      <div className="flex items-center gap-2">
        <span className={clsx('grid h-7 w-7 shrink-0 place-items-center rounded-lg', tone)}>
          <Icon className="h-3.5 w-3.5" />
        </span>
        <span className="min-w-0 truncate text-[13px] font-medium text-muted">{label}</span>
      </div>
      <div className="mt-2 break-words text-xl font-bold leading-tight tabular-nums text-foreground sm:text-2xl">{value}</div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
        <Delta pct={delta} goodWhenDown={goodWhenDown} />
        <span className="text-[11px] text-faint">{note || `last month ${beforeLabel}`}</span>
      </div>
    </div>
  );
}

/* A ratio with no denominator is not zero, it is unanswerable — so it prints
   as a dash and says why on hover, rather than as a confident 0%. */
function Ratio({ label, value, hint, bands }) {
  const tone = value == null ? 'text-faint'
    : bands === 'up' ? (value >= 0 ? 'text-emerald-300' : 'text-rose-300')
      : bands === 'down' ? (value <= 25 ? 'text-emerald-300' : value <= 50 ? 'text-amber-300' : 'text-rose-300')
        : value >= 30 ? 'text-emerald-300' : value >= 10 ? 'text-amber-300' : 'text-rose-300';
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/70 py-2.5 last:border-0">
      <span className="min-w-0 truncate text-[13px] text-muted" title={hint}>{label}</span>
      <span className={clsx('shrink-0 text-sm font-bold tabular-nums sm:text-base', tone)}>
        {value == null ? '—' : `${value > 0 && bands === 'up' ? '+' : ''}${formatPercent(value)}`}
      </span>
    </div>
  );
}

const AGE_TONE = {
  fresh: { bar: 'bg-emerald-500', dot: 'bg-emerald-400', text: 'text-emerald-300' },
  week: { bar: 'bg-sky-500', dot: 'bg-sky-400', text: 'text-sky-300' },
  fortnight: { bar: 'bg-amber-500', dot: 'bg-amber-400', text: 'text-amber-300' },
  old: { bar: 'bg-rose-500', dot: 'bg-rose-400', text: 'text-rose-300' },
};

function Analysis({ a, navigate }) {
  const { month, lastMonth, health, growth, trend, boxesByYear, ageing, spend, spendTotal } = a;
  const anyTrend = trend.some((t) => t.revenue || t.moneyIn || t.moneyOut);
  const anyYear = boxesByYear.some((b) => b.thisYear || b.lastYear);
  // Read once, so the figure and the colour it is printed in can never be
  // about two different numbers.
  const netThisMonth = trend[trend.length - 1]?.net || 0;

  return (
    <>
      <SectionHeading title={`This month · against ${lastMonth.label}`} action={{ label: 'Profit & loss', to: '/finance?tab=profit' }} navigate={navigate} />
      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:mb-5 sm:gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <MonthCard label="Revenue" icon={TrendingUp} tone="bg-sky-500/15 text-sky-300"
          value={formatCurrency(month.revenue)} delta={growth.revenue}
          beforeLabel={formatCurrency(lastMonth.revenue)} />
        <MonthCard label="Gross profit" icon={Scale} tone="bg-emerald-500/15 text-emerald-300"
          value={formatCurrency(month.grossProfit)} delta={growth.grossProfit}
          beforeLabel={formatCurrency(lastMonth.grossProfit)} />
        <MonthCard label="Expenses" icon={Receipt} tone="bg-orange-500/15 text-orange-300"
          value={formatCurrency(month.expenses)} delta={growth.expenses}
          beforeLabel={formatCurrency(lastMonth.expenses)} goodWhenDown />
        <MonthCard label="Net profit" icon={Coins} tone="bg-violet-500/15 text-violet-300"
          value={formatCurrency(month.netProfit)} delta={growth.netProfit}
          beforeLabel={formatCurrency(lastMonth.netProfit)} />
        <MonthCard label="Boxes sold" icon={Boxes} tone="bg-brand-500/15 text-brand-600"
          value={formatNumber(month.boxes)} delta={growth.boxes}
          beforeLabel={formatNumber(lastMonth.boxes)} />
        {/* Not a month's figure at all, so it carries no comparison: it is
            what is standing against a rep's name right now. */}
        <MonthCard label="Out with reps" icon={Timer} tone="bg-rose-500/15 text-rose-300"
          value={formatCurrency(ageing.total)}
          note={ageing.overdueValue > 0 ? `${formatCurrency(ageing.overdueValue)} of it past the deadline` : 'all of it still inside its deadline'} />
      </div>

      <div className="mb-4 grid gap-3 sm:mb-5 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <div className="card overflow-hidden">
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-base font-semibold text-foreground">Revenue, cost and what was left</h2>
            <p className="mt-0.5 text-xs text-muted">The last twelve months · TSh</p>
          </div>
          <div className="px-2 pb-2 pt-3">
            {anyTrend ? (
              <TrendChart data={trend} height={240} series={[
                { key: 'revenue', name: 'Revenue', color: '#38bdf8' },
                { key: 'cost', name: 'Cost of boxes', color: '#f43f5e' },
                { key: 'profit', name: 'What was left', color: RED },
              ]} />
            ) : (
              <p className="px-3 py-10 text-center text-sm text-muted">Nothing sold in the last twelve months yet.</p>
            )}
          </div>
        </div>

        <div className="card overflow-hidden">
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-base font-semibold text-foreground">Financial health</h2>
            <p className="mt-0.5 text-xs text-muted">This month, read against the rules the business keeps</p>
          </div>
          <div className="px-4 py-1">
            <Ratio label="Gross margin" value={health.grossMargin} hint="What is left of a shilling after the boxes it sold cost you" />
            <Ratio label="Expense ratio" value={health.expenseRatio} bands="down" hint="How much of the month's revenue the running costs ate" />
            <Ratio label="Net margin" value={health.netMargin} hint="What the business actually kept, after boxes and expenses" />
            <Ratio label="Revenue growth" value={health.revenueGrowth} bands="up" hint={`Against ${lastMonth.label}`} />
            <Ratio label="Profit growth" value={health.profitGrowth} bands="up" hint={`Against ${lastMonth.label}`} />
            <Ratio label="Overdue share of what is out" value={health.overdueShare} bands="down" hint="How much of the money still with reps is already past its deadline" />
          </div>
        </div>
      </div>

      <div className="mb-4 grid gap-3 sm:mb-5 lg:grid-cols-2">
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-foreground">Money in and out</h2>
              <p className="mt-0.5 text-xs text-muted">What arrived against what it cost, month by month</p>
            </div>
            <div className="shrink-0 text-right">
              <div className={clsx('text-sm font-bold tabular-nums', netThisMonth >= 0 ? 'text-emerald-300' : 'text-rose-300')}>
                {formatCurrency(netThisMonth)}
              </div>
              <div className="text-[11px] text-faint">net this month</div>
            </div>
          </div>
          <div className="px-2 pb-2 pt-3">
            {anyTrend ? (
              <MonthBars data={trend} height={220} series={[
                { key: 'moneyIn', name: 'Money in', color: '#10b981' },
                { key: 'moneyOut', name: 'Money out', color: '#f43f5e' },
              ]} />
            ) : (
              <p className="px-3 py-10 text-center text-sm text-muted">No money has moved through the accounts yet.</p>
            )}
          </div>
        </div>

        {/* The boxes that have left but not come back — as money, aged from
            the day they were issued. The only question the settlement model
            ever asks is where every issued box is; this is that question with
            a clock on it. */}
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-foreground">Boxes still out with reps</h2>
              <p className="mt-0.5 text-xs text-muted">From the day they were issued</p>
            </div>
            <button onClick={() => navigate('/settlements')} className="shrink-0 cursor-pointer text-xs font-semibold text-brand-600 hover:text-brand-600">
              Open orders →
            </button>
          </div>
          <div className="p-4">
            {ageing.total > 0 ? (
              <>
                <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-white/[0.07]">
                  {ageing.buckets.filter((b) => b.value > 0).map((b) => (
                    <div key={b.key} className={AGE_TONE[b.key].bar} style={{ width: `${b.share}%` }} />
                  ))}
                </div>
                <div className="mt-3 divide-y divide-border/70">
                  {ageing.buckets.map((b) => (
                    <div key={b.key} className="flex items-center gap-3 py-2">
                      <span className={clsx('h-2 w-2 shrink-0 rounded-full', AGE_TONE[b.key].dot)} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] text-foreground">{b.label}</span>
                        <span className="block text-[11px] text-faint">{formatNumber(b.orders)} {b.orders === 1 ? 'order' : 'orders'}</span>
                      </span>
                      <span className={clsx('shrink-0 text-sm font-bold tabular-nums', AGE_TONE[b.key].text)}>{formatCurrency(b.value)}</span>
                      <span className="w-10 shrink-0 text-right text-[11px] tabular-nums text-faint">{formatPercent(b.share, 0)}</span>
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-[11px] text-faint">
                  {formatCurrency(ageing.total)} issued and not yet settled or returned.
                </p>
              </>
            ) : (
              <div className="py-10 text-center">
                <CheckCircle2 className="mx-auto h-7 w-7 text-emerald-400" />
                <p className="mt-2 text-sm text-muted">Every issued box is accounted for.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mb-4 grid gap-3 sm:mb-5 lg:grid-cols-2">
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-foreground">Where money is spent</h2>
              <p className="mt-0.5 text-xs text-muted">This month's costs, largest first</p>
            </div>
            <span className="shrink-0 text-sm font-bold tabular-nums text-orange-300">{formatCurrency(spendTotal)}</span>
          </div>
          <div className="p-4">
            {spend.length ? (
              <div className="divide-y divide-border/70">
                {spend.slice(0, 7).map((row) => (
                  <div key={row.name} className="py-2">
                    <div className="flex items-center justify-between gap-3">
                      <span className="min-w-0 truncate text-[13px] text-foreground">{row.name}</span>
                      <span className="shrink-0 text-sm font-bold tabular-nums text-foreground">{formatCurrency(row.amount)}</span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.07]">
                        <div className="h-full rounded-full bg-orange-500/70" style={{ width: `${row.share}%` }} />
                      </div>
                      <span className="w-10 shrink-0 text-right text-[11px] tabular-nums text-faint">{formatPercent(row.share, 0)}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="py-10 text-center text-sm text-muted">No costs recorded this month.</p>
            )}
          </div>
        </div>

        <div className="card overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-foreground">Boxes this year against last</h2>
              <p className="mt-0.5 text-xs text-muted">Every box sold, month by month</p>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-sm font-bold tabular-nums text-foreground">
                {formatNumber(boxesByYear.reduce((n, b) => n + b.thisYear, 0))}
              </div>
              <div className="text-[11px] text-faint">this year</div>
            </div>
          </div>
          <div className="px-2 pb-2 pt-3">
            {anyYear ? (
              <TrendChart data={boxesByYear} height={220} money={false} series={[
                { key: 'thisYear', name: 'This year', color: RED },
                { key: 'lastYear', name: 'Last year', color: '#64748b' },
              ]} />
            ) : (
              <p className="px-3 py-10 text-center text-sm text-muted">No boxes sold in either year yet.</p>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

/* The little heading that sits above a region, with the way deeper into it. */
function SectionHeading({ title, action, navigate }) {
  return (
    <div className="mb-2.5 flex items-end justify-between gap-3">
      <h2 className="min-w-0 truncate text-[11px] font-bold uppercase tracking-[0.16em] text-faint">{title}</h2>
      {action && (
        <button onClick={() => navigate(action.to)} className="shrink-0 cursor-pointer text-xs font-semibold text-brand-600 hover:text-brand-600">
          {action.label} →
        </button>
      )}
    </div>
  );
}

export default function Dashboard() {
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
  // The shape of the business, read on its own: months, ratios, the age of the
  // boxes still out and where the money goes. A slow pass over two years of
  // sales must never keep the headline figures off the screen, and a failure
  // here hides one region rather than the page.
  const { data: analysis } = useQuery({
    queryKey: ['dashboard', 'analysis'],
    queryFn: async () => unwrap(await api.get('/dashboard/analysis')).data,
    refetchInterval: STEADY * 4,
    retry: 1,
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

  return (
    <div>
      {/* No quick-action row here: Nino, 10 Nov 2026 — "I don't need these"; the
          phone has the same doors in its bottom bar and the menu. */}

      {/* ── Attention ──
          The same box as before: three rows showing, the rest by scrolling
          inside it, a "scroll for N more" line under it — and NOTHING on top of
          it. Nino, 10 Nov 2026, from his phone: the filter pills, the count
          badge, the tinted icon tiles, the line saying why each item was there
          and the heading were "too much". Each item is one line now (a dot for
          urgency, the words, the figure, an arrow); the reason for an item is
          still its tooltip. The heading is kept for screen readers only. */}
      {(() => {
        const items = [
          (attention.commissionRequests?.count || 0) > 0 && {
            key: 'commission-req', tone: 'amber',
            title: `${attention.commissionRequests.count} commission request${attention.commissionRequests.count !== 1 ? 's' : ''} to decide`,
            desc: attention.commissionRequests.items?.[0]
              ? `${attention.commissionRequests.items[0].repName}${attention.commissionRequests.count > 1 ? ' and others' : ''} — waiting on your approval`
              : 'Waiting on your approval',
            value: formatCurrency(attention.commissionRequests.total),
            onOpen: () => setReviewing(attention.commissionRequests.items || []),
          },
          attention.overdueSettlements > 0 && {
            key: 'overdue', tone: 'rose',
            title: `${attention.overdueSettlements} order${attention.overdueSettlements !== 1 ? 's' : ''} past the deadline`,
            desc: 'Past 72 hours and collecting a daily fine',
            value: formatCurrency(attention.overdueValue), to: '/settlements?status=OVERDUE',
          },
          attention.outOfStock > 0 && {
            key: 'oos', tone: 'rose',
            title: `${attention.outOfStock} product${attention.outOfStock !== 1 ? 's' : ''} out of stock`,
            desc: 'Nothing left to sell or issue', to: '/reorder',
          },
          attention.settlements > 0 && {
            key: 'stl', tone: 'amber',
            title: `${attention.settlements} settlement${attention.settlements !== 1 ? 's' : ''} to approve`,
            desc: 'Money reported by reps, not yet confirmed', to: '/settlements',
          },
          attention.stockRequests > 0 && {
            key: 'req', tone: 'sky',
            title: `${attention.stockRequests} stock request${attention.stockRequests !== 1 ? 's' : ''} waiting`,
            desc: 'Reps cannot sell until this is issued', to: '/stock-requests',
          },
          attention.returns > 0 && {
            key: 'ret', tone: 'sky',
            title: `${attention.returns} return${attention.returns !== 1 ? 's' : ''} to decide`,
            desc: attention.returnsToday > 0
              ? `${attention.returnsToday} today · ${attention.returnsTodayBoxes} boxes · boxes stay locked until you decide`
              : 'Boxes stay locked until you decide',
            to: '/returns',
          },
          attention.lowStock.count > 0 && {
            key: 'low', tone: 'amber',
            title: `${attention.lowStock.count} product${attention.lowStock.count !== 1 ? 's' : ''} running low`,
            desc: attention.lowStock.items[0]?.name ? `Lowest: ${attention.lowStock.items[0].name}` : 'Below reorder level',
            to: '/reorder',
          },
          attention.supplierDue > 0 && {
            key: 'sup', tone: 'violet',
            title: 'Owed to suppliers',
            desc: 'Bills raised against stock you have received',
            value: formatCurrency(attention.supplierDue), to: '/finance?tab=suppliers',
          },
        ].filter(Boolean);

        // The dot is the only urgency cue: red for what is costing money or
        // stopping sales, amber for what is waiting on a decision, grey for
        // a bill that is simply owed.
        const DOT = { rose: 'bg-rose-500', amber: 'bg-amber-400', sky: 'bg-amber-400', violet: 'bg-zinc-400' };

        // Nothing waiting: one quiet line in the same kind of box.
        if (items.length === 0) {
          return (
            <div className="mb-6 flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.02] px-3.5 py-2.5 text-[13px] text-muted">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" /> All clear. Nothing is waiting on you.
            </div>
          );
        }

        return (
          <section aria-label="Attention" className="mb-6 overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.02] backdrop-blur-sm">
            <h2 className="sr-only">Attention</h2>
            <div className="overflow-y-auto" style={{ maxHeight: ATTENTION_ROWS * ATTENTION_ROW_PX }}>
              <ul className="divide-y divide-white/[0.06]">
                {items.map((i) => (
                  <li key={i.key}>
                    <button type="button" title={i.desc} onClick={() => (i.onOpen ? i.onOpen() : navigate(i.to))}
                      className="flex h-10 w-full cursor-pointer items-center gap-2.5 px-3.5 text-left transition duration-200 hover:bg-white/[0.04] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500/60">
                      <span aria-hidden className={clsx('h-1.5 w-1.5 shrink-0 rounded-full', DOT[i.tone])} />
                      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">{i.title}</span>
                      {i.value && <span className="shrink-0 text-[13px] font-semibold tabular-nums text-foreground">{i.value}</span>}
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-faint" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            {/* Say how many are below the fold, so a capped list never hides
                the fact that there is more. */}
            {items.length > ATTENTION_ROWS && (
              <div className="border-t border-white/[0.06] py-1.5 text-center text-[11px] text-faint">
                scroll for {items.length - ATTENTION_ROWS} more
              </div>
            )}
          </section>
        );
      })()}

      {/* ── The money ──────────────────────────────────────────────────────
             One band, not a panel. It carried a second column of today's
             movement — money in, money out, net, boxes sold — which is the
             same four figures the tiles directly below state better, and
             holding both made the card tall enough to push the day's business
             off the screen. The card now answers one question, the one it is
             named for: how much is there, and which pocket is holding it. ── */}
      <div className="card mb-3 overflow-hidden sm:mb-4">
        <div className="flex flex-col gap-3 p-4 sm:p-5 lg:flex-row lg:items-center lg:gap-6">
          <div className="min-w-0 lg:w-[16rem] lg:shrink-0">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-faint">In the accounts</p>
              <button onClick={() => navigate('/finance?tab=accounts')}
                className="cursor-pointer text-[11px] font-semibold text-brand-600 transition hover:text-brand-600 lg:hidden">
                Open accounts →
              </button>
            </div>
            <p className="mt-1 text-[26px] font-bold leading-none tracking-tight text-foreground sm:text-[32px]">
              {formatCurrency(totalFunds)}
            </p>
            {/* The net move in the balance above it, worded as one. It read
                "TSh 449,000 out today" on a day when 624,000 went out and
                175,000 came in; both gross figures are on the tooltip. */}
            <span
              title={`In ${formatCurrency(today.moneyIn || 0)} · out ${formatCurrency(today.moneyOut || 0)}`}
              className={clsx(
                'mt-2 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold',
                today.netCash === 0 ? 'bg-white/[0.06] text-muted'
                  : today.netCash > 0 ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300',
              )}>
              {today.netCash === 0 ? null : today.netCash > 0 ? <ArrowDownLeft className="h-3 w-3" /> : <ArrowUpRight className="h-3 w-3" />}
              {today.netCash === 0
                ? 'No change today'
                : <>{formatCurrency(Math.abs(today.netCash))} {today.netCash > 0 ? 'up' : 'down'} today</>}
            </span>
          </div>

          {/* Where it sits: the bar carries the proportions, so each pocket
              only has to name itself. An account holding nothing is not an
              answer to "where does it sit", so it is left out; its colour
              stays reserved by its original position, and the others do not
              shuffle when one empties. */}
          <div className="min-w-0 flex-1">
            {totalFunds > 0 && (
              <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-white/[0.07]">
                {heroAccounts.map((a) => (
                  <div key={a.id} className={HERO_BAR[a._i % HERO_BAR.length]}
                    style={{ width: `${Math.max(0, (a.balance / totalFunds) * 100)}%` }} />
                ))}
              </div>
            )}
            <div className="mt-2.5 grid gap-x-5 gap-y-1.5 sm:grid-cols-2">
              {heroAccounts.map((a) => {
                const share = totalFunds > 0 ? Math.round((a.balance / totalFunds) * 100) : 0;
                return (
                  <button key={a.id} onClick={() => navigate('/finance?tab=accounts')}
                    className="flex w-full cursor-pointer items-center gap-2 text-left transition hover:opacity-80">
                    <span className={clsx('h-2 w-2 shrink-0 rounded-full', HERO_DOT[a._i % HERO_DOT.length])} />
                    <span className="min-w-0 flex-1 truncate text-[13px] text-muted">{a.name}</span>
                    <span className={clsx('shrink-0 text-[13px] font-bold tabular-nums', a.balance < 0 ? 'text-rose-300' : 'text-foreground')}>
                      {formatCurrency(a.balance)}
                    </span>
                    <span className="w-8 shrink-0 text-right text-[11px] tabular-nums text-faint">{share}%</span>
                  </button>
                );
              })}
            </div>
          </div>

          <button onClick={() => navigate('/finance?tab=accounts')}
            className="hidden shrink-0 cursor-pointer text-xs font-semibold text-brand-600 transition hover:text-brand-600 lg:block">
            Open accounts →
          </button>
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

      {/* ── This month, against last ────────────────────────────────────────
             Everything from here down is the SHAPE of the business rather
             than its state: the month set against the one before it, the
             ratios it is run by, two years of months, the age of the boxes
             still standing against a rep's name, and where the money goes.
             It is read from /dashboard/analysis, which is a separate trip —
             if that trip fails, this region is simply not here. ── */}
      {analysis && <Analysis a={analysis} navigate={navigate} />}

      {/* ── Where every box is ──
          Five separate stat cards stated the same total five ways and never
          said how the stock is split. One bar does: the whole holding, divided
          where it actually sits, with the numbers underneath. */}
      <div className="mt-8">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Inventory · where every box is</h2>
            <p className="text-xs text-faint">Everything ZELab is carrying, in the warehouse and out with the reps.</p>
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
                { key: 'wh', label: 'In warehouse', value: wh, colour: RED, to: '/inventory' },
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
                  { key: 'revenue', name: 'Revenue', color: RED },
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
              <span className="rounded-full bg-brand-500/15 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-brand-600">
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
                  <div className="grid grid-cols-2 gap-2.5 xl:grid-cols-3">
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
