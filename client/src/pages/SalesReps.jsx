import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Plus, UserCog, AlertTriangle } from 'lucide-react';
import api, { unwrap, apiError } from '@/lib/api';
import { formatCurrency, formatNumber, fromNow } from '@/lib/format';
import { TZ_REGIONS } from '@/lib/regions';
import {
  PageHeader, Card, PageSpinner, EmptyState, Button, Modal, Field, Select, Input, Pagination,
} from '@/components/ui';

function RepModal({ onClose }) {
  const qc = useQueryClient();
  const { data: users = [] } = useQuery({ queryKey: ['users', 'all'], queryFn: async () => unwrap(await api.get('/users', { params: { limit: 200 } })).data });
  const [userId, setUserId] = useState('');
  const [region, setRegion] = useState('');
  const [monthlyTarget, setMonthlyTarget] = useState('');

  const candidates = users.filter((u) => !u.salesRep);

  const create = useMutation({
    mutationFn: () => api.post('/sales-reps', { userId, region: region || null, monthlyTarget: monthlyTarget ? Number(monthlyTarget) : null }),
    onSuccess: () => { toast.success('Sales rep created'); qc.invalidateQueries({ queryKey: ['sales-reps'] }); onClose(); },
    onError: (e) => toast.error(apiError(e)),
  });

  return (
    <Modal open onClose={onClose} title="New sales representative"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={create.isPending} disabled={!userId} onClick={() => create.mutate()}>Create</Button></>}>
      <div className="space-y-4">
        <Field label="User account" required hint="Pick a user who isn't already a rep. Tip: create SALES_REP users from the Users page.">
          <Select value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">Select user…</option>
            {candidates.map((u) => <option key={u.id} value={u.id}>{u.name} · {u.email}</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Region">
            <Select value={region} onChange={(e) => setRegion(e.target.value)}>
            <option value="">— Select region —</option>
            {TZ_REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </Select>
          </Field>
          <Field label="Monthly target"><Input type="number" value={monthlyTarget} onChange={(e) => setMonthlyTarget(e.target.value)} /></Field>
        </div>
      </div>
    </Modal>
  );
}

// One colour per rep, fixed by their code so a face keeps its colour wherever
// the list moves it.
const HUES = [
  { edge: 'bg-brand-400', text: 'text-brand-300' },
  { edge: 'bg-violet-400', text: 'text-violet-300' },
  { edge: 'bg-sky-400', text: 'text-sky-300' },
  { edge: 'bg-amber-400', text: 'text-amber-300' },
  { edge: 'bg-emerald-400', text: 'text-emerald-300' },
  { edge: 'bg-rose-400', text: 'text-rose-300' },
];
const hueFor = (code) => HUES[[...String(code || '')].reduce((n, c) => n + c.charCodeAt(0), 0) % HUES.length];

// What the row says about a rep, in the order it matters. Late first: that is
// the only line that needs a decision today.
function standingOf(r) {
  if (r.overdueOrders > 0) {
    return {
      key: 'late', rank: 0,
      label: `${formatNumber(r.overdueOrders)} late`,
      detail: `due ${fromNow(r.oldestOverdueAt)}`,
      cls: 'bg-rose-500/15 text-rose-300 ring-rose-500/25',
      dot: 'bg-rose-400',
    };
  }
  if (r.openOrders > 0) {
    return {
      key: 'out', rank: 1,
      label: `${formatNumber(r.openOrders)} running`,
      detail: r.nextDeadlineAt ? `next due ${fromNow(r.nextDeadlineAt)}` : 'inside the window',
      cls: 'bg-amber-500/15 text-amber-300 ring-amber-500/25',
      dot: 'bg-amber-400',
    };
  }
  if (!r.isActive) {
    return { key: 'off', rank: 3, label: 'Not active', detail: 'no stock out', cls: 'bg-white/[0.06] text-faint ring-white/[0.08]', dot: 'bg-white/20' };
  }
  return { key: 'clear', rank: 2, label: 'Settled', detail: 'nothing out',  cls: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/25', dot: 'bg-emerald-400' };
}

// How often this rep brings the boxes back inside their contract window. It is
// the one number that says whether a rep can be trusted, and unlike a sales
// total it is about the rep rather than about the money.
function gradeOf(r) {
  const settled = Number(r.settledOrders || 0);
  const onTime = Number(r.onTimeOrders || 0);
  if (r.onTimeRate == null || settled <= 0) {
    return { known: false, text: 'text-muted', sub: 'none closed yet' };
  }
  // Rounding must neither flatter nor libel: a rep who was late once can never
  // read 100, and a rep who was on time once can never read 0.
  let pct = Math.round(Number(r.onTimeRate));
  if (pct >= 100 && onTime < settled) pct = 99;
  if (pct <= 0 && onTime > 0) pct = 1;
  pct = Math.min(100, Math.max(0, pct));
  return {
    known: true,
    pct,
    text: pct >= 90 ? 'text-emerald-300' : pct >= 70 ? 'text-amber-300' : 'text-rose-300',
    // Always the sample size, never the percentage twice. 100% of two orders
    // and 100% of forty are not the same claim.
    sub: `of ${formatNumber(settled)} closed`,
  };
}

export default function SalesReps() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['sales-reps', { page }],
    queryFn: async () => unwrap(await api.get('/sales-reps', { params: { page, limit: 100 } })),
  });

  // Late first, then whoever is holding the most of your stock.
  const reps = [...(data?.data || [])].sort((a, b) => {
    const sa = standingOf(a); const sb = standingOf(b);
    return sa.rank - sb.rank
      || Number(b.heldUnits || 0) - Number(a.heldUnits || 0)
      || String(a.user?.name || '').localeCompare(String(b.user?.name || ''));
  });

  const t = reps.reduce((a, r) => ({
    boxes: a.boxes + Number(r.heldUnits || 0),
    value: a.value + Number(r.heldStockValue || 0),
    owed: a.owed + Math.max(0, Number(r.commissionOwed || 0)),
    late: a.late + Number(r.overdueOrders || 0),
    lateReps: a.lateReps + (r.overdueOrders > 0 ? 1 : 0),
    settled: a.settled + Number(r.settledOrders || 0),
    onTime: a.onTime + Number(r.onTimeOrders || 0),
  }), { boxes: 0, value: 0, owed: 0, late: 0, lateReps: 0, settled: 0, onTime: 0 });

  // Every closed order belongs to exactly one rep, so summing the reps gives
  // the team's true rate — no second query needed.
  // The same guards gradeOf applies per rep: without them 199 on time of 200
  // rounds to a clean 100% here while a card below it correctly reads 99%.
  const teamRate = (() => {
    if (t.settled <= 0) return null;
    let pct = Math.round((t.onTime / t.settled) * 100);
    if (pct >= 100 && t.onTime < t.settled) pct = 99;
    if (pct <= 0 && t.onTime > 0) pct = 1;
    return Math.min(100, Math.max(0, pct));
  })();

  return (
    <div>
      <PageHeader title="Sales Representatives" subtitle="Who is holding your stock, and who is late with it.">
        <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> New rep</Button>
      </PageHeader>

      {reps.length > 0 && (
        <div className="mb-4 overflow-hidden rounded-2xl bg-surface ring-1 ring-white/[0.07]">
          <div className="grid grid-cols-2 divide-x divide-white/[0.06] sm:grid-cols-4">
            {[
              { label: 'Boxes out with reps', value: formatNumber(t.boxes), sub: `${formatCurrency(t.value)} of stock`, num: 'text-violet-300' },
              { label: 'Running late', value: formatNumber(t.late), sub: t.late > 0 ? `${formatNumber(t.lateReps)} rep${t.lateReps === 1 ? '' : 's'} past deadline` : 'everyone inside the window', num: t.late > 0 ? 'text-rose-300' : 'text-foreground' },
              { label: 'Commission owed', value: formatCurrency(t.owed), sub: 'earned, not yet withdrawn', num: t.owed > 0 ? 'text-amber-300' : 'text-foreground' },
              { label: 'Settled on time', value: teamRate == null ? '—' : `${teamRate}%`, sub: teamRate == null ? 'no orders closed yet' : `of ${formatNumber(t.settled)} orders closed`, num: teamRate == null ? 'text-foreground' : teamRate >= 90 ? 'text-emerald-300' : teamRate >= 70 ? 'text-amber-300' : 'text-rose-300' },
            ].map((c) => (
              <div key={c.label} className="p-4">
                <p className="text-xs font-medium text-muted">{c.label}</p>
                <p className={`mt-1.5 text-xl font-bold tabular-nums ${c.num}`}>{c.value}</p>
                <p className="mt-0.5 text-[11px] text-faint">{c.sub}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {isLoading ? (
        <Card><PageSpinner /></Card>
      ) : !reps.length ? (
        <Card><EmptyState title="No sales reps" icon={UserCog} action={<Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> New rep</Button>} /></Card>
      ) : (
        <>
          {/* Four things per card and nothing else: who, where they stand,
              what they are carrying, what they are owed. The rest is a click
              away on their own page — a card is a glance, not a report. */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {reps.map((r, i) => {
              const hue = hueFor(r.code);
              const st = standingOf(r);
              const g = gradeOf(r);
              return (
                <button
                  key={r.id}
                  onClick={() => navigate(`/reps/${r.id}`)}
                  style={{ animationDelay: `${i * 35}ms` }}
                  className="animate-rise group relative overflow-hidden rounded-2xl bg-surface p-4 pl-5 text-left ring-1 ring-white/[0.07] transition duration-200 hover:bg-white/[0.02] hover:ring-white/20"
                >
                  <span className={`absolute inset-y-0 left-0 w-1 ${hue.edge}`} aria-hidden="true" />

                  {/* Who they are, where they stand, and how they grade. */}
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate font-semibold text-foreground">{r.user?.name}</span>
                        <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ring-1 ${st.cls}`}>
                          {st.key === 'late'
                            ? <AlertTriangle className="h-2.5 w-2.5" />
                            : <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />}
                          {st.label}
                        </span>
                      </div>
                      <div className="mt-0.5 truncate text-xs text-faint">{r.code}{r.region ? ` · ${r.region}` : ''}</div>
                    </div>
                    <div className="shrink-0 text-right">
                      {g.known ? (
                        <div className={`text-2xl font-bold leading-none tabular-nums ${g.text}`}>
                          {g.pct}<span className="text-sm font-semibold">%</span>
                        </div>
                      ) : (
                        <div className="text-2xl font-bold leading-none text-muted">—</div>
                      )}
                      <div className="mt-1 whitespace-nowrap text-[11px] text-faint">{g.sub}</div>
                    </div>
                  </div>

                  {/* What they are holding, and what they are owed — peers, not
                      a figure and a whisper. */}
                  <div className="mt-3 grid grid-cols-2 border-t border-white/[0.06] pt-3">
                    <div className="min-w-0 pr-3">
                      <div className={`truncate text-base font-bold tabular-nums ${r.heldUnits > 0 ? 'text-foreground' : 'text-muted'}`}>
                        {formatNumber(r.heldUnits || 0)} <span className="text-xs font-normal text-faint">boxes</span>
                      </div>
                      <div className="mt-0.5 truncate text-[11px] text-faint">{st.detail}</div>
                    </div>
                    <div className="min-w-0 border-l border-white/[0.06] pl-3">
                      <div className={`truncate text-base font-bold tabular-nums ${r.commissionOwed > 0 ? 'text-amber-300' : 'text-muted'}`}>
                        {formatCurrency(Math.max(0, Number(r.commissionOwed || 0)))}
                      </div>
                      <div className="mt-0.5 truncate text-[11px] text-faint">
                        {r.commissionOwed > 0 ? 'commission owed' : 'nothing owed'}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
          {data.meta?.totalPages > 1 && (
            <div className="mt-4">
              <Pagination page={page} totalPages={data.meta?.totalPages} total={data.meta?.total} onChange={setPage} />
            </div>
          )}
        </>
      )}
      {open && <RepModal onClose={() => setOpen(false)} />}
    </div>
  );
}
