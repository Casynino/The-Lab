import { useId } from 'react';
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, PieChart, Pie, Cell, Legend,
} from 'recharts';
import { formatCurrency, formatNumber } from '@/lib/format';
import { RED } from '@/lib/brand';

const AXIS = { fontSize: 11, fill: '#94a3b8' };

function MoneyTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-md">
      <div className="mb-1 font-semibold text-foreground">{label}</div>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center justify-between gap-3" style={{ color: p.color }}>
          <span>{p.name}</span>
          <span className="font-medium">{formatCurrency(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

function CountTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-md">
      <div className="mb-1 font-semibold text-foreground">{label}</div>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center justify-between gap-3" style={{ color: p.color }}>
          <span>{p.name}</span>
          <span className="font-medium">{formatNumber(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

export function TrendChart({ data, series = [{ key: 'revenue', name: 'Revenue', color: RED }], height = 260, money = true }) {
  /* An SVG id is global to the document. Two charts on one page that both
     plot a series called "revenue" were defining `grad-revenue` twice, and
     the first definition won — so the second chart drew its Revenue band in
     the first chart's colour while its own stroke and legend stayed correct,
     and colour stopped identifying the series. One id per chart instance. */
  const uid = useId().replace(/:/g, '');
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <defs>
          {series.map((s) => (
            <linearGradient key={s.key} id={`grad-${uid}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={s.color} stopOpacity={0.3} />
              <stop offset="95%" stopColor={s.color} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
        <XAxis dataKey="period" tick={AXIS} tickLine={false} axisLine={false} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} tickFormatter={(v) => formatNumber(v, { compact: true })} width={48} />
        <Tooltip content={money ? <MoneyTooltip /> : <CountTooltip />} />
        {series.map((s) => (
          <Area key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={2} fill={`url(#grad-${uid}-${s.key})`} />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function BarChartCard({ data, dataKey = 'value', labelKey = 'name', money = true, height = 280, color = RED }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#27272a" horizontal={false} />
        <XAxis type="number" tick={AXIS} tickLine={false} axisLine={false} tickFormatter={(v) => formatNumber(v, { compact: true })} />
        <YAxis type="category" dataKey={labelKey} tick={AXIS} tickLine={false} axisLine={false} width={170} />
        <Tooltip
          cursor={false}
          formatter={(v) => (money ? formatCurrency(v) : formatNumber(v))}
          contentStyle={{ fontSize: 12, borderRadius: 8, background: '#151517', border: '1px solid #2a2a30', color: '#f4f4f5' }}
        />
        <Bar dataKey={dataKey} fill={color} radius={[0, 4, 4, 0]} barSize={16} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// The admin donuts take the rep side's mix — sky, violet, amber, emerald, rose — with red as one colour
// among many, not the first two (red + salmon made a two-slice donut entirely red). Pass `colors` to tie
// slices to colours the page already uses (Finance gives each account its Accounts-tab colour).
const DONUT_MIX = ['#38bdf8', '#a78bfa', '#fbbf24', '#34d399', '#fb7185', RED, '#f472b6', '#facc15'];

export function DonutChart({ data, dataKey = 'value', nameKey = 'name', height = 260, colors = DONUT_MIX }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie data={data} dataKey={dataKey} nameKey={nameKey} innerRadius={55} outerRadius={85} paddingAngle={2}>
          {data.map((_, i) => (
            <Cell key={i} fill={colors[i % colors.length]} />
          ))}
        </Pie>
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Tooltip formatter={(v) => formatCurrency(v)} contentStyle={{ fontSize: 12, borderRadius: 8, background: '#151517', border: '1px solid #2a2a30', color: '#f4f4f5' }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

/* Months side by side — what came in against what went out. Bars, not a line:
   two columns a month apart are a comparison, where two lines are a story. */
export function MonthBars({ data, series, height = 230, money = true }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2}>
        <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
        <XAxis dataKey="period" tick={AXIS} tickLine={false} axisLine={false} interval={0} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} tickFormatter={(v) => formatNumber(v, { compact: true })} width={48} />
        <Tooltip cursor={{ fill: 'rgba(255,255,255,0.04)' }} content={money ? <MoneyTooltip /> : <CountTooltip />} />
        {series.map((s) => (
          <Bar key={s.key} dataKey={s.key} name={s.name} fill={s.color} radius={[3, 3, 0, 0]} maxBarSize={14} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
