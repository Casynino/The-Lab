import { useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import dayjs from 'dayjs';
import { FileBarChart, ExternalLink, Download } from 'lucide-react';
import api, { unwrap, apiError } from '@/lib/api';
import { formatCurrency, formatNumber } from '@/lib/format';
import { Card, EmptyState, Input, Select } from '@/components/ui';

// The business reports the owner receives on WhatsApp — daily, weekly and monthly PDFs — kept here exactly
// as they were generated and sent (Nino, 11 Nov 2026: "the reports should be saved here too, like Vegas;
// they are sent to the boss as a link"). One card per report: its kind, its period, the headline figures
// it carried, and Open / Download. Used in the owner's profile (Reports) and in Finance > Statements.

const KINDS = [['', 'All'], ['DAILY', 'Daily'], ['WEEKLY', 'Weekly'], ['MONTHLY', 'Monthly'], ['YEARLY', 'Yearly']];
const TONE = {
  DAILY: 'bg-amber-500/15 text-amber-300',
  WEEKLY: 'bg-emerald-500/15 text-emerald-300',
  MONTHLY: 'bg-violet-500/15 text-violet-300',
  YEARLY: 'bg-sky-500/15 text-sky-300',
};
const NAME = { DAILY: 'Daily', WEEKLY: 'Weekly', MONTHLY: 'Monthly', YEARLY: 'Yearly' };

function period(r) {
  const from = dayjs(r.from);
  const to = dayjs(r.to);
  if (r.type === 'DAILY') return from.format('dddd, D MMM YYYY');
  if (r.type === 'MONTHLY') return from.format('MMMM YYYY');
  if (r.type === 'YEARLY') return `The year ${from.format('YYYY')}`;
  return `${from.format('D MMM')} – ${to.format('D MMM YYYY')}`;
}

export default function ReportsArchive() {
  const [type, setType] = useState('');
  const [year, setYear] = useState('');
  const [search, setSearch] = useState('');
  const [shown, setShown] = useState(24);
  const { data: rows = [], isLoading, isFetching } = useQuery({
    queryKey: ['report-archive', type, year, search],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (type) params.set('type', type);
      if (year) params.set('year', year);
      if (search) params.set('search', search);
      return unwrap(await api.get(`/finance/report-archive?${params}`)).data;
    },
    placeholderData: keepPreviousData,
  });

  const years = [];
  for (let y = new Date().getFullYear(); y >= 2026; y -= 1) years.push(String(y));

  const download = async (r) => {
    try {
      const res = await api.get(`/finance/report-archive/${r.id}/pdf`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ZELab-${r.type.toLowerCase()}-${r.periodKey}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(apiError(e));
    }
  };

  return (
    <section>
      <div className="mb-4">
        <h2 className="text-lg font-bold text-foreground sm:text-2xl">Business reports</h2>
        <p className="mt-1 text-sm text-muted">Every report sent to your WhatsApp, kept exactly as it was sent.</p>
      </div>

      {/* Which reports: chips, a year, a search. */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {KINDS.map(([k, label]) => (
          <button key={k || 'all'} type="button" onClick={() => setType(k)} aria-pressed={type === k}
            className={`rounded-full px-3.5 py-1.5 text-xs font-semibold ring-1 transition ${type === k
              ? 'bg-white/[0.12] text-foreground ring-white/20'
              : 'text-muted ring-white/10 hover:bg-white/[0.05] hover:text-foreground'}`}>
            {label}
          </button>
        ))}
        <Select value={year} onChange={(e) => setYear(e.target.value)} className="w-28" aria-label="Year">
          <option value="">All years</option>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </Select>
        <Input placeholder="Search (W45, 2026-10, 2026-11-10)" value={search} onChange={(e) => setSearch(e.target.value)} className="w-72 max-w-full" aria-label="Search reports" />
      </div>

      {isLoading ? (
        <Card>
          <ul className="divide-y divide-white/[0.06]" aria-hidden="true">
            {Array.from({ length: 6 }, (_, i) => (
              <li key={i} className="flex items-center gap-3 px-4 py-3"><span className="h-5 w-16 animate-pulse rounded-full bg-white/[0.06]" /><span className="h-3 flex-1 animate-pulse rounded bg-white/[0.06]" /></li>
            ))}
          </ul>
        </Card>
      ) : rows.length === 0 ? (
        <Card><EmptyState icon={FileBarChart} title="No reports here yet" message="Reports are kept here automatically the moment they are sent." /></Card>
      ) : (
        // One slim line per report, grouped by month (Nino, 11 Nov 2026: "they will be many — list them
        // nicely, not taking so much space; they can be opened").
        <div className={`space-y-5 transition-opacity ${isFetching ? 'opacity-70' : ''}`}>
          {byMonth(rows.slice(0, shown)).map((g) => (
            <section key={g.label}>
              <h3 className="mb-2 px-1 text-[12px] font-semibold uppercase tracking-wide text-white/45">{g.label}</h3>
              <Card>
                <ul className="divide-y divide-white/[0.06]">
                  {g.items.map((r) => {
                    const m = r.meta || {};
                    return (
                      <li key={r.id} className="flex items-center gap-3 px-4 py-2.5">
                        <span className={`w-[68px] shrink-0 rounded-full px-2 py-0.5 text-center text-[11px] font-semibold ${TONE[r.type] || 'bg-white/[0.07] text-white/60'}`}>{NAME[r.type] || r.type}</span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-white">{period(r)}</p>
                          {(m.revenue != null || m.boxes != null) && (
                            <p className="truncate text-[11px] text-faint">
                              {m.revenue != null && <>Sales {formatCurrency(m.revenue)}</>}
                              {m.boxes != null && <> · {formatNumber(m.boxes)} {m.boxes === 1 ? 'box' : 'boxes'}</>}
                            </p>
                          )}
                        </div>
                        <a href={r.link} target="_blank" rel="noreferrer" aria-label={`Open ${period(r)}`}
                          className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white/[0.07] px-3 py-1 text-xs font-semibold text-foreground ring-1 ring-inset ring-white/15 transition hover:bg-white/[0.12]">
                          <ExternalLink className="h-3.5 w-3.5" /> Open
                        </a>
                        <button type="button" onClick={() => download(r)} aria-label={`Download ${period(r)}`} title="Download"
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white/60 ring-1 ring-white/15 transition hover:bg-white/[0.06] hover:text-white">
                          <Download className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            </section>
          ))}
          {rows.length > shown && (
            <button type="button" onClick={() => setShown((n) => n + 24)} className="text-xs font-semibold text-brand-400 hover:text-brand-300">
              Show more ({rows.length - shown})
            </button>
          )}
        </div>
      )}
    </section>
  );
}

// Reports grouped by the month their period starts in, newest first (the rows already come newest first).
function byMonth(rows) {
  const out = [];
  for (const r of rows) {
    const label = dayjs(r.from).format('MMMM YYYY');
    const last = out[out.length - 1];
    if (last && last.label === label) last.items.push(r);
    else out.push({ label, items: [r] });
  }
  return out;
}
