import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Wallet, TrendingUp, TrendingDown, Boxes, Warehouse, Truck, AlertTriangle,
  ArrowRight, Timer, CheckCircle2, Banknote, Landmark, Smartphone, PiggyBank,
  ClipboardList, Undo2, Factory, PackageX, Receipt, ShoppingCart, SlidersHorizontal,
  ArrowDownLeft, ArrowUpRight, Scale,
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

export default function Dashboard() {
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
      {/* ── Hero: greeting + the number that matters most ── */}
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.2, 0.7, 0.3, 1] }}
        className="relative mb-6 overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-[#0e120c] via-[#0b0c0a] to-[#16210a] p-6 text-white shadow-xl sm:p-7"
      >
        <div className="pointer-events-none absolute -right-10 -top-10 h-48 w-48 rounded-full bg-brand-500/25 blur-3xl" aria-hidden="true" />
        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="text-xs font-medium uppercase tracking-wider text-white/50">
              {tzDateLabel({ weekday: 'long', day: 'numeric', month: 'long' })}
            </div>
            <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">{tzGreeting()}, {firstName}.</h1>
            <div className="mt-3 text-xs uppercase tracking-wider text-white/50">Total available business funds</div>
            <div className="text-4xl font-black tabular-nums text-brand-400 [text-shadow:0_0_24px_rgba(163,230,53,0.35)]">
              {formatCurrency(totalFunds)}
            </div>
          </div>
          {/* Where the money is */}
          <div className="grid w-full max-w-xl grid-cols-1 gap-2 sm:grid-cols-3">
            {accounts.map((a) => {
              const Icon = ACCOUNT_ICON[a.type] || Wallet;
              return (
                <button key={a.id} onClick={() => navigate('/finance?tab=accounts')}
                  className="rounded-xl border border-white/10 bg-white/[0.04] p-3 text-left transition hover:bg-white/[0.08]">
                  <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-white/50">
                    <Icon className="h-3.5 w-3.5" /> {a.name}
                  </div>
                  <div className={clsx('mt-1 text-lg font-bold tabular-nums', a.balance < 0 ? 'text-rose-400' : 'text-white')}>
                    {formatCurrency(a.balance)}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </motion.div>

      {/* ── Needs your attention ── */}
      <div className="mb-6">
        <div className="mb-3 flex items-center gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Needs your attention</h2>
          {attentionCount === 0 && (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-400"><CheckCircle2 className="h-3.5 w-3.5" /> All clear</span>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
          <AttentionTile label="Stock requests" value={attention.stockRequests} icon={ClipboardList} tone="sky" active={attention.stockRequests > 0} onClick={() => navigate('/stock-requests')} />
          <AttentionTile label="Settlements" value={attention.settlements} icon={Timer} tone="sky" active={attention.settlements > 0} onClick={() => navigate('/settlements')} />
          <AttentionTile label="Returns" value={attention.returns} sub={attention.returnsToday > 0 ? `${attention.returnsToday} today · ${attention.returnsTodayBoxes} boxes` : undefined} icon={Undo2} tone="sky" active={attention.returns > 0} onClick={() => navigate('/returns')} />
          <AttentionTile label="Overdue orders" value={attention.overdueSettlements} sub={attention.overdueSettlements > 0 ? formatCurrency(attention.overdueValue) : undefined} icon={AlertTriangle} tone="rose" active={attention.overdueSettlements > 0} onClick={() => navigate('/settlements')} />
          <AttentionTile label="Low stock" value={attention.lowStock.count} sub={attention.lowStock.items[0]?.name} icon={TrendingDown} tone="amber" active={attention.lowStock.count > 0} onClick={() => navigate('/reorder')} />
          <AttentionTile label="Out of stock" value={attention.outOfStock} icon={PackageX} tone="amber" active={attention.outOfStock > 0} onClick={() => navigate('/reorder')} />
          <AttentionTile label="Owed to suppliers" value={formatNumber(attention.supplierDue, { compact: false })} icon={Factory} tone="amber" active={attention.supplierDue > 0} onClick={() => navigate('/finance?tab=suppliers')} />
        </div>
      </div>

      {/* ── Today's business (all from Finance) ── */}
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">Today's business</h2>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        <StatCard label="Revenue" value={formatCurrency(today.revenue)} icon={TrendingUp} tone="emerald" />
        <StatCard label="Gross profit" value={formatCurrency(today.grossProfit)} icon={Wallet} tone="brand" onClick={() => navigate('/finance?tab=profit')} />
        <StatCard label="Expenses" value={formatCurrency(today.expenses)} icon={Receipt} tone="rose" onClick={() => navigate('/finance?tab=expenses')} />
        <StatCard label="Net profit" value={formatCurrency(today.netProfit)} icon={Scale} tone={today.netProfit >= 0 ? 'violet' : 'rose'} />
        <StatCard label="Cash flow" value={formatCurrency(today.netCash)} icon={today.netCash >= 0 ? ArrowDownLeft : ArrowUpRight} tone={today.netCash >= 0 ? 'emerald' : 'rose'} hint={`in ${formatCurrency(today.moneyIn)} · out ${formatCurrency(today.moneyOut)}`} onClick={() => navigate('/finance?tab=cashflow')} />
      </div>

      {/* ── Quick actions ── */}
      <div className="mt-5 flex flex-wrap gap-2">
        {QUICK.map((q) => (
          <Button key={q.label} variant="secondary" onClick={() => navigate(q.to)} className="relative">
            <q.icon className="h-4 w-4" /> {q.label}
            {q.badge > 0 && (
              <span className="ml-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">{q.badge}</span>
            )}
          </Button>
        ))}
      </div>

      {/* ── Charts ──
          The dashboard could say what today was worth but never whether that
          was good. These give the totals a shape: where the money has been
          going, and which region, rep and product carry it. */}
      {charts && (
        <div className="mb-6 space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Trend</h2>

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

            <Card>
              <CardHeader title="Top reps" subtitle="Revenue this month" />
              {charts.byRep?.length ? (
                <div className="px-2 pb-2"><BarChartCard data={charts.byRep} height={230} /></div>
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
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">Brand performance</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {brands.map((b) => {
              const t = BRAND_TONE[b.name?.toUpperCase()] || { ring: 'border-border', bg: 'bg-surface', badge: 'bg-elevated text-muted', dot: 'bg-border' };
              return (
                <button key={b.brandId} onClick={() => navigate('/finance?tab=profit')} className={`w-full rounded-2xl border ${t.ring} ${t.bg} p-4 text-left transition hover:bg-elevated`}>
                  <div className="mb-3 flex items-center gap-2">
                    <span className={`h-2.5 w-2.5 rounded-full ${t.dot}`} />
                    <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${t.badge}`}>{b.name}</span>
                    <span className="ml-auto text-[11px] text-faint">this month</span>
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

      {/* ── Inventory overview ── */}
      <div className="mt-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">Inventory overview</h2>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
          <StatCard label="Inventory value" value={formatCurrency(inventory.costValue)} icon={Boxes} tone="brand" hint={`selling ${formatCurrency(inventory.sellingValue)}`} onClick={() => navigate('/inventory')} />
          <StatCard label="Total boxes" value={formatNumber(inventory.units)} icon={Boxes} tone="slate" />
          <StatCard label="In warehouse" value={formatNumber(inventory.warehouseBoxes)} icon={Warehouse} tone="emerald" onClick={() => navigate('/inventory')} />
          <StatCard label="With reps" value={formatNumber(inventory.repBoxes)} icon={Truck} tone="violet" onClick={() => navigate('/reps')} />
          <StatCard label="Returned today" value={formatNumber(inventory.returnedToday)} icon={Undo2} tone="sky" hint="boxes back to The Lab" onClick={() => navigate('/returns')} />
        </div>
      </div>

      {/* Month context strip */}
      <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-1 rounded-xl border border-border bg-surface px-4 py-3 text-sm text-muted">
        <span className="inline-flex items-center gap-1.5"><PiggyBank className="h-4 w-4 text-brand-500" /> This month:</span>
        <span>Revenue <b className="text-foreground">{formatCurrency(month.revenue)}</b></span>
        <span>Gross profit <b className="text-foreground">{formatCurrency(month.grossProfit)}</b></span>
        <span>{formatNumber(month.boxes)} boxes sold</span>
        <button onClick={() => navigate('/finance')} className="ml-auto inline-flex items-center gap-1 text-brand-500 hover:underline">Open Finance <ArrowRight className="h-3.5 w-3.5" /></button>
      </div>
    </div>
  );
}
