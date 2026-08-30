import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Plus, UserCog, ChevronRight, AlertTriangle } from 'lucide-react';
import api, { unwrap, apiError } from '@/lib/api';
import { formatCurrency, formatNumber, initials, fromNow } from '@/lib/format';
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
  { av: 'from-brand-400 to-brand-600', text: 'text-brand-300' },
  { av: 'from-violet-400 to-violet-600', text: 'text-violet-300' },
  { av: 'from-sky-400 to-sky-600', text: 'text-sky-300' },
  { av: 'from-amber-400 to-amber-600', text: 'text-amber-300' },
  { av: 'from-emerald-400 to-emerald-600', text: 'text-emerald-300' },
  { av: 'from-rose-400 to-rose-600', text: 'text-rose-300' },
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
  }), { boxes: 0, value: 0, owed: 0, late: 0, lateReps: 0 });

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
              { label: 'Reps active', value: formatNumber(reps.filter((r) => r.isActive).length), sub: `of ${formatNumber(reps.length)} on the books`, num: 'text-foreground' },
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
              return (
                <button
                  key={r.id}
                  onClick={() => navigate(`/reps/${r.id}`)}
                  style={{ animationDelay: `${i * 35}ms` }}
                  className="animate-rise group rounded-2xl bg-surface p-4 text-left ring-1 ring-white/[0.07] transition duration-200 hover:bg-white/[0.02] hover:ring-white/20"
                >
                  <div className="flex items-center gap-3">
                    <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br ${hue.av} text-sm font-bold text-slate-950`}>
                      {initials(r.user?.name)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold text-foreground">{r.user?.name}</div>
                      <div className="truncate text-xs text-faint">{r.code}{r.region ? ` · ${r.region}` : ''}</div>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-faint transition group-hover:translate-x-0.5" />
                  </div>

                  <div className="mt-3 flex items-end justify-between gap-3 border-t border-white/[0.06] pt-3">
                    <div>
                      <div className="text-lg font-bold tabular-nums text-foreground">
                        {formatNumber(r.heldUnits || 0)} <span className="text-sm font-normal text-faint">boxes</span>
                      </div>
                      <div className="text-[11px] text-faint">
                        {r.commissionOwed > 0
                          ? `${formatCurrency(r.commissionOwed)} commission owed`
                          : 'no commission owed'}
                      </div>
                    </div>
                    <div className="text-right">
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${st.cls}`}>
                        {st.key === 'late' && <AlertTriangle className="h-3 w-3" />}
                        {st.label}
                      </span>
                      <div className="mt-0.5 text-[11px] text-faint">{st.detail}</div>
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
