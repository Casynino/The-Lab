import clsx from 'clsx';
import { Ring } from '@/components/Ring';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, PieChart, Pie,
} from 'recharts';
import { formatCurrency, formatNumber } from '@/lib/format';
import { RED, SERIES } from '@/lib/brand';

// ===========================================================================
// The rep's commission page as pictures (Nino, 10 Nov 2026: "don't just show
// numbers — show how nicely they are doing"). Every figure arrives already worked
// out by the server (/commissions/me/insights); these only draw it, and say in a
// plain sentence what the picture means.
// ===========================================================================

const AXIS = { fontSize: 11, fill: '#94a3b8' };
const GREEN = '#34d399';
const SKY = '#38bdf8';
const AMBER = '#fbbf24';
const ROSE = '#fb7185';
const compact = (v) => formatNumber(v, { compact: true });

/** A title, one plain sentence about what the picture says, and the picture — straight on the page,
 *  no card round it (Nino, 11 Nov 2026: "no need of too much shape; design the info nicely on that
 *  background"). */
export function InsightCard({ title, said, children, className }) {
  return (
    <section className={clsx('px-1', className)}>
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {said && <p className="mt-0.5 text-xs leading-snug text-muted">{said}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

// The ring lives in its own file (plain SVG, no chart library); kept here too
// so every existing `import { Ring } from '@/components/RepCharts'` still works.
export { Ring };

function Legend({ rows }) {
  return (
    <ul className="min-w-0 flex-1 space-y-2">
      {rows.map((r) => (
        <li key={r.label} className="flex items-center gap-2 text-[13px]">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: r.color }} aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-muted">{r.label}</span>
            {r.sub && <span className="block truncate text-[11px] text-faint">{r.sub}</span>}
          </span>
          <span className="shrink-0 font-semibold tabular-nums text-foreground">{r.value}</span>
        </li>
      ))}
    </ul>
  );
}

function MoneyTip({ active, payload, label, unit = 'earned' }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-md">
      <div className="mb-0.5 font-semibold text-foreground">{label}</div>
      <div className="text-muted">{formatCurrency(row.earned ?? row.amount)} {unit}</div>
      {row.boxes != null && <div className="text-faint">{formatNumber(row.boxes)} boxes</div>}
    </div>
  );
}

/** One figure: a small muted label over a bold number. No box, no line round it. */
function Figure({ label, value }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-muted">{label}</dt>
      <dd className="mt-0.5 whitespace-nowrap text-[17px] font-bold leading-tight tabular-nums text-foreground">{value}</dd>
    </div>
  );
}

/** Commission earned, month by month. The best month stands out in the house red. */
export function EarningsCard({ insights }) {
  const { months, totals, best } = insights;
  const bestIdx = best ? months.findIndex((m) => m.label === best.label && m.earned === best.earned) : -1;
  const quiet = totals.earned <= 0;
  // Nino, 11 Nov 2026: "say My earnings, not Your earnings, and arrange the information under it nicely, not
  // as one long sentence" — so the title is first person, the sentence is gone, and the three figures it
  // carried stand in a row above the chart, small label over bold figure, the way the wallet card does it.
  const said = quiet
    ? 'Settle boxes and your earnings will start to show here.'
    : `Last ${months.length} months`;
  return (
    <InsightCard title="My earnings" said={said}>
      {!quiet && (
        <dl className="mb-5 flex flex-wrap justify-between gap-x-4 gap-y-3">
          <Figure label={`Earned · ${months.length} months`} value={formatCurrency(totals.earned)} />
          <Figure label="Boxes" value={formatNumber(totals.boxes)} />
          {best && <Figure label={`Best month · ${best.label}`} value={formatCurrency(best.earned)} />}
        </dl>
      )}
      <ResponsiveContainer width="100%" height={170}>
        <BarChart data={months} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
          <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} />
          <YAxis tick={AXIS} tickLine={false} axisLine={false} tickFormatter={compact} width={46} />
          <Tooltip content={<MoneyTip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
          <Bar dataKey="earned" radius={[6, 6, 0, 0]} maxBarSize={34}>
            {months.map((m, i) => <Cell key={m.key} fill={i === bestIdx ? RED : 'rgba(238,49,36,0.42)'} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </InsightCard>
  );
}

/** Where the commission comes from, by brand — a donut with the share of each. */
export function BrandCard({ insights }) {
  const rows = insights.byBrand;
  if (!rows.length) return null;
  const lead = rows[0];
  const said = rows.length > 1
    ? `${lead.brand} brings ${lead.share}% of what you earn.`
    : `All of what you earn is from ${lead.brand}.`;
  return (
    <InsightCard title="Where it comes from" said={said}>
      <div className="flex items-center gap-5">
        <div className="relative h-[116px] w-[116px] shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={rows} dataKey="earned" nameKey="brand" innerRadius={38} outerRadius={56} paddingAngle={rows.length > 1 ? 3 : 0} stroke="none">
                {rows.map((r, i) => <Cell key={r.brand} fill={SERIES[i % SERIES.length]} />)}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-base font-bold tabular-nums text-foreground">{compact(insights.totals.earned)}</span>
            <span className="text-[10px] uppercase tracking-wide text-faint">TSh</span>
          </div>
        </div>
        <Legend rows={rows.map((r, i) => ({ label: r.brand, sub: `${r.share}%`, value: formatCurrency(r.earned), color: SERIES[i % SERIES.length] }))} />
      </div>
    </InsightCard>
  );
}

/** How the orders were settled: the share closed without a late fine, as a ring. */
export function SettlementCard({ insights }) {
  const s = insights.settlement;
  if (!s.orders) return null;
  const hasRecord = s.settled > 0;
  const said = !hasRecord
    ? `${s.orders} order${s.orders === 1 ? '' : 's'} so far — none closed yet.`
    : s.late === 0
      ? `All ${s.settled} closed order${s.settled === 1 ? ' was' : 's were'} settled on time. Keep it up.`
      : `${s.onTime} of ${s.settled} closed orders were settled on time.`;
  const rows = [
    { label: 'Settled on time', value: formatNumber(s.onTime), color: GREEN },
    ...(s.late ? [{ label: 'Settled late', value: formatNumber(s.late), color: AMBER }] : []),
    ...(s.open ? [{ label: 'Still open', value: formatNumber(s.open), color: SKY }] : []),
    ...(s.overdue ? [{ label: 'Overdue', value: formatNumber(s.overdue), color: ROSE }] : []),
  ];
  return (
    <InsightCard title="Settlement record" said={said}>
      <div className="flex items-center gap-5">
        <Ring
          total={s.orders}
          segments={[
            { value: s.onTime, color: GREEN }, { value: s.late, color: AMBER },
            { value: s.open, color: SKY }, { value: s.overdue, color: ROSE },
          ]}
        >
          <span className="text-2xl font-black leading-none tabular-nums text-foreground">{hasRecord ? `${s.onTimeRate}%` : s.orders}</span>
          <span className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-faint">{hasRecord ? 'on time' : 'orders'}</span>
        </Ring>
        <Legend rows={rows} />
      </div>
      {s.fines.count > 0 && (
        <p className="mt-3 border-t border-white/[0.06] pt-3 text-xs text-muted">
          Fines in this time: <span className="font-semibold text-rose-400">{formatCurrency(s.fines.amount)}</span> ({s.fines.count})
        </p>
      )}
    </InsightCard>
  );
}

/** The best seller as a hero card, the next ones as a short quiet list (Nino, 11 Nov 2026: "four heavy rows
 *  looks overwhelming — present it another way"). One name, one amount and its share of everything earned for
 *  the leader; for the rest only a name, an amount and a thin bar against the leader. */
export function TopProductsCard({ insights }) {
  const rows = insights.topProducts;
  if (!rows.length) return null;
  const [first, ...rest] = rows;
  const share = Number.isFinite(first.share) ? first.share : 0;
  return (
    <section className="px-1">
      <h3 className="text-sm font-semibold text-foreground">Best sellers</h3>

      <div className="premium-card mt-3 p-5">
        <div className="flex items-center gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-medium text-white/50">Best seller</p>
            <p className="mt-1 text-[15px] font-semibold leading-snug text-white">{first.name}</p>
            <p className="mt-3 text-[24px] font-bold leading-none tabular-nums text-white">{formatCurrency(first.earned)}</p>
            <p className="mt-1 text-[11px] text-white/45">{formatNumber(first.boxes)} boxes</p>
          </div>
          <div style={{ filter: 'drop-shadow(0 0 8px rgba(238,49,36,0.4))' }}>
            <Ring size={76} stroke={7} total={100} segments={[{ value: share, color: RED }]}>
              <span className="text-base font-bold leading-none tabular-nums text-white">{Math.round(share)}%</span>
              <span className="mt-1 text-[9px] text-white/45">of earned</span>
            </Ring>
          </div>
        </div>
      </div>

      {rest.length > 0 && (
        <ul className="mt-2 divide-y divide-white/[0.06]">
          {rest.map((r) => (
            <li key={r.name} className="py-3">
              <div className="flex items-baseline justify-between gap-3">
                <span title={r.name} className="min-w-0 flex-1 truncate text-[13px] text-muted">{r.name}</span>
                <span className="shrink-0 text-[13px] font-semibold tabular-nums text-foreground">{formatCurrency(r.earned)}</span>
              </div>
              <div className="mt-2 h-[3px] overflow-hidden rounded-full bg-white/[0.07]">
                <div className="h-full rounded-full bg-white/35" style={{ width: `${Math.max(3, (r.earned / Math.max(1, first.earned)) * 100)}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** What has been paid out, month by month — built from the withdrawals already on the page. */
export function PayoutsCard({ items }) {
  const eatMonth = (d) => { const t = new Date(new Date(d).getTime() + 3 * 3600e3); return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}`; };
  const paid = items.filter((w) => w.status === 'PAID' || w.status === 'APPROVED');
  if (!paid.length) return null;
  const now = new Date(Date.now() + 3 * 3600e3);
  const months = [];
  for (let i = 5; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    months.push({ key: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`, label: d.toLocaleString('en', { month: 'short', timeZone: 'UTC' }), amount: 0, count: 0 });
  }
  for (const w of paid) {
    const m = months.find((x) => x.key === eatMonth(w.paidAt || w.decidedAt || w.requestedAt));
    if (m) { m.amount += Number(w.amount) || 0; m.count += 1; }
  }
  const total = paid.reduce((s, w) => s + (Number(w.amount) || 0), 0);
  return (
    <InsightCard title="Paid out" said={`${formatCurrency(total)} paid to you in ${paid.length} payout${paid.length === 1 ? '' : 's'}.`}>
      <ResponsiveContainer width="100%" height={130}>
        <BarChart data={months} margin={{ top: 6, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
          <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} />
          {/* interval 0 keeps every tick: at 130px tall the default dropped one label and its gridline. */}
          <YAxis tick={AXIS} tickLine={false} axisLine={false} tickFormatter={compact} width={46} interval={0} />
          <Tooltip content={<MoneyTip unit="paid out" />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
          <Bar dataKey="amount" fill={GREEN} fillOpacity={0.75} radius={[6, 6, 0, 0]} maxBarSize={34} />
        </BarChart>
      </ResponsiveContainer>
    </InsightCard>
  );
}
