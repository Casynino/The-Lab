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

const KINDS = [['', 'Weekly & monthly'], ['DAILY', 'Daily'], ['WEEKLY', 'Weekly'], ['MONTHLY', 'Monthly']];
const TONE = {
  DAILY: 'bg-amber-500/15 text-amber-300',
  WEEKLY: 'bg-emerald-500/15 text-emerald-300',
  MONTHLY: 'bg-violet-500/15 text-violet-300',
};
const NAME = { DAILY: 'Daily', WEEKLY: 'Weekly', MONTHLY: 'Monthly' };

function period(r) {
  const from = dayjs(r.from);
  const to = dayjs(r.to);
  if (r.type === 'DAILY') return from.format('dddd, D MMM YYYY');
  if (r.type === 'MONTHLY') return from.format('MMMM YYYY');
  return `${from.format('D MMM')} – ${to.format('D MMM YYYY')}`;
}

export default function ReportsArchive() {
  const [type, setType] = useState('');
  const [year, setYear] = useState('');
  const [search, setSearch] = useState('');
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
        <h2 className="text-xl font-bold tracking-tight text-foreground">Business reports</h2>
        <p className="mt-1 text-sm text-muted">Every report sent to your WhatsApp, kept exactly as it was sent.</p>
      </div>

      {/* Which reports: chips, a year, a search. */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {KINDS.map(([k, label]) => (
          <button key={k || 'all'} type="button" onClick={() => setType(k)} aria-pressed={type === k}
            className={`rounded-full px-3.5 py-1.5 text-xs font-semibold ring-1 transition ${type === k
              ? 'bg-brand-500 text-white ring-brand-500'
              : 'text-muted ring-white/10 hover:bg-white/[0.05] hover:text-foreground'}`}>
            {label}
          </button>
        ))}
        <Select value={year} onChange={(e) => setYear(e.target.value)} className="w-28" aria-label="Year">
          <option value="">All years</option>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </Select>
        <Input placeholder="Search (W45, 2026-10, 2026-11-10)" value={search} onChange={(e) => setSearch(e.target.value)} className="w-56" aria-label="Search reports" />
      </div>

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-hidden="true">
          {Array.from({ length: 6 }, (_, i) => <div key={i} className="h-[136px] animate-pulse rounded-[1.4rem] bg-white/[0.04]" />)}
        </div>
      ) : rows.length === 0 ? (
        <Card><EmptyState icon={FileBarChart} title="No reports here yet" message="Reports are kept here automatically the moment they are sent." /></Card>
      ) : (
        <div className={`grid gap-3 sm:grid-cols-2 xl:grid-cols-3 transition-opacity ${isFetching ? 'opacity-70' : ''}`}>
          {rows.map((r) => {
            const m = r.meta || {};
            return (
              <Card key={r.id} className="flex flex-col p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${TONE[r.type] || 'bg-white/[0.07] text-white/60'}`}>{NAME[r.type] || r.type}</span>
                  <span className="text-[11px] tabular-nums text-faint">{r.periodKey}</span>
                </div>
                <p className="mt-2.5 text-[15px] font-semibold leading-snug text-white">{period(r)}</p>
                {(m.revenue != null || m.boxes != null) && (
                  <p className="mt-1 text-xs text-muted">
                    {m.revenue != null && <>Sales <span className="tabular-nums text-white/85">{formatCurrency(m.revenue)}</span></>}
                    {m.boxes != null && <> · <span className="tabular-nums text-white/85">{formatNumber(m.boxes)}</span> {m.boxes === 1 ? 'box' : 'boxes'}</>}
                  </p>
                )}
                <div className="mt-auto flex gap-2 pt-4">
                  <a href={r.link} target="_blank" rel="noreferrer"
                    className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-600">
                    <ExternalLink className="h-3.5 w-3.5" /> Open
                  </a>
                  <button type="button" onClick={() => download(r)}
                    className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-white/80 ring-1 ring-white/15 transition hover:bg-white/[0.06]">
                    <Download className="h-3.5 w-3.5" /> Download
                  </button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </section>
  );
}
