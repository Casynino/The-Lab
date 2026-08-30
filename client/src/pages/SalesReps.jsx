import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Plus, UserCog, ChevronRight, Coins, TrendingUp, Boxes } from 'lucide-react';
import api, { unwrap, apiError } from '@/lib/api';
import { formatCurrency, formatNumber, initials } from '@/lib/format';
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

export default function SalesReps() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ['sales-reps', { page }],
    queryFn: async () => unwrap(await api.get('/sales-reps', { params: { page, limit: 15 } })),
  });

  return (
    <div>
      <PageHeader title="Sales Representatives" subtitle="Field reps, the stock they carry, and accountability.">
        <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> New rep</Button>
      </PageHeader>
      {isLoading ? (
        <Card><PageSpinner /></Card>
      ) : !data?.data?.length ? (
        <Card><EmptyState title="No sales reps" icon={UserCog} action={<Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> New rep</Button>} /></Card>
      ) : (
        <>
          {/* Ranked by what they have sold, best first. Ten identical cards in
              catalogue order told you nothing about who is carrying the team;
              a rank, a share bar and one colour per rep do. */}
          {(() => {
            const reps = [...data.data].sort((a, b) => Number(b.totalSales || 0) - Number(a.totalSales || 0));
            const topSales = Number(reps[0]?.totalSales || 0);
            const totals = reps.reduce((a, r) => ({
              sales: a.sales + Number(r.totalSales || 0),
              stock: a.stock + Number(r.heldStockValue || 0),
              boxes: a.boxes + Number(r.heldUnits || 0),
              owed: a.owed + Math.max(0, Number(r.commissionOwed || 0)),
            }), { sales: 0, stock: 0, boxes: 0, owed: 0 });

            const cards = [
              { label: 'Reps selling', value: formatNumber(reps.filter((r) => r.isActive).length), icon: UserCog,
                sub: `of ${formatNumber(reps.length)} on the books`,
                ring: 'ring-brand-500/25', glow: 'from-brand-500/[0.12]', chip: 'bg-brand-500/15 text-brand-300', num: 'text-brand-300' },
              { label: 'Sold between them', value: formatCurrency(totals.sales), icon: TrendingUp, sub: 'all time',
                ring: 'ring-emerald-500/25', glow: 'from-emerald-500/[0.12]', chip: 'bg-emerald-500/15 text-emerald-300', num: 'text-emerald-300' },
              { label: 'Stock they hold', value: formatCurrency(totals.stock), icon: Boxes,
                sub: `${formatNumber(totals.boxes)} boxes out with reps`,
                ring: 'ring-violet-500/25', glow: 'from-violet-500/[0.14]', chip: 'bg-violet-500/15 text-violet-300', num: 'text-violet-300' },
              { label: 'Commission owed', value: formatCurrency(totals.owed), icon: Coins, sub: 'earned, not yet withdrawn',
                ring: totals.owed > 0 ? 'ring-amber-500/30' : 'ring-white/[0.07]',
                glow: totals.owed > 0 ? 'from-amber-500/[0.14]' : 'from-white/[0.02]',
                chip: 'bg-amber-500/15 text-amber-300', num: totals.owed > 0 ? 'text-amber-300' : 'text-foreground' },
            ];

            // One colour per rep, held steady by their code so a face keeps
            // its colour as the ranking moves.
            // Every class spelled out: Tailwind only ships what it can read in
            // the source, so a name assembled at runtime compiles to nothing.
            const HUES = [
              { ring: 'ring-brand-500/25', glow: 'from-brand-500/[0.07]', av: 'from-brand-400 to-brand-600', bar: 'bg-brand-400', text: 'text-brand-300' },
              { ring: 'ring-violet-500/25', glow: 'from-violet-500/[0.07]', av: 'from-violet-400 to-violet-600', bar: 'bg-violet-400', text: 'text-violet-300' },
              { ring: 'ring-sky-500/25', glow: 'from-sky-500/[0.07]', av: 'from-sky-400 to-sky-600', bar: 'bg-sky-400', text: 'text-sky-300' },
              { ring: 'ring-amber-500/25', glow: 'from-amber-500/[0.07]', av: 'from-amber-400 to-amber-600', bar: 'bg-amber-400', text: 'text-amber-300' },
              { ring: 'ring-emerald-500/25', glow: 'from-emerald-500/[0.07]', av: 'from-emerald-400 to-emerald-600', bar: 'bg-emerald-400', text: 'text-emerald-300' },
              { ring: 'ring-rose-500/25', glow: 'from-rose-500/[0.07]', av: 'from-rose-400 to-rose-600', bar: 'bg-rose-400', text: 'text-rose-300' },
            ];
            const hueFor = (code) => HUES[[...String(code || '')].reduce((n, c) => n + c.charCodeAt(0), 0) % HUES.length];

            return (
              <>
                <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
                  {cards.map((c) => (
                    <div key={c.label} className={`relative overflow-hidden rounded-2xl bg-surface p-4 ring-1 ${c.ring}`}>
                      <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${c.glow} to-transparent`} aria-hidden="true" />
                      <div className="relative flex items-start justify-between gap-2">
                        <p className="text-xs font-medium text-muted">{c.label}</p>
                        <span className={`rounded-lg p-1.5 ${c.chip}`}><c.icon className="h-3.5 w-3.5" /></span>
                      </div>
                      <p className={`relative mt-2 text-2xl font-bold tabular-nums ${c.num}`}>{c.value}</p>
                      <p className="relative mt-0.5 text-[11px] text-faint">{c.sub}</p>
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {reps.map((r, i) => {
                    const hue = hueFor(r.code);
                    const sales = Number(r.totalSales || 0);
                    const share = totals.sales > 0 ? (sales / totals.sales) * 100 : 0;
                    const bar = topSales > 0 ? (sales / topSales) * 100 : 0;
                    const owed = Number(r.commissionOwed || 0);
                    return (
                      <button
                        key={r.id}
                        onClick={() => navigate(`/reps/${r.id}`)}
                        className={`animate-rise group relative overflow-hidden rounded-2xl bg-surface p-5 text-left ring-1 transition duration-200 hover:ring-white/25 ${hue.ring}`}
                        style={{ animationDelay: `${i * 40}ms` }}
                      >
                        <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${hue.glow} to-transparent`} aria-hidden="true" />

                        <div className="relative flex items-center gap-3">
                          <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br ${hue.av} text-sm font-bold text-slate-950`}>
                            {initials(r.user?.name)}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="truncate font-semibold text-foreground">{r.user?.name}</span>
                              {i < 3 && sales > 0 && (
                                <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                                  i === 0 ? 'bg-amber-500/20 text-amber-300' : 'bg-white/10 text-muted'}`}>
                                  #{i + 1}
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-faint">{r.code}{r.region ? ` · ${r.region}` : ''}</div>
                          </div>
                          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${r.isActive ? 'bg-emerald-400' : 'bg-white/20'}`} title={r.isActive ? 'Active' : 'Inactive'} />
                        </div>

                        {/* What they have sold, with their share of the team. */}
                        <div className="relative mt-4">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="text-2xl font-bold tabular-nums text-emerald-400">{formatCurrency(sales)}</span>
                            <span className="text-[11px] tabular-nums text-faint">{Math.round(share)}% of the team</span>
                          </div>
                          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
                            <div className={`h-full rounded-full ${hue.bar}`} style={{ width: `${Math.max(2, bar)}%` }} />
                          </div>
                        </div>

                        {/* Rows, not boxes inside a box. */}
                        <div className="relative mt-4 space-y-2 border-t border-white/[0.06] pt-3">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="text-xs text-muted">Carrying now</span>
                            <span className="text-sm font-semibold tabular-nums text-foreground">
                              {formatNumber(r.heldUnits || 0)} boxes
                              <span className="ml-1.5 text-[11px] font-normal text-faint">{formatCurrency(r.heldStockValue)}</span>
                            </span>
                          </div>
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="text-xs text-muted">Commission owed</span>
                            <span className={`text-sm font-semibold tabular-nums ${owed > 0 ? 'text-amber-300' : owed < 0 ? 'text-rose-400' : 'text-faint'}`}>
                              {formatCurrency(owed)}
                            </span>
                          </div>
                          {(r._count?.customers ?? 0) > 0 && (
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="text-xs text-muted">Customers</span>
                              <span className="text-sm font-semibold tabular-nums text-foreground">{formatNumber(r._count.customers)}</span>
                            </div>
                          )}
                        </div>

                        <div className={`relative mt-3 flex items-center justify-end gap-1 text-xs font-medium ${hue.text}`}>
                          View profile <ChevronRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
                        </div>
                      </button>
                    );
                  })}
                </div>
              </>
            );
          })()}

          <div className="mt-4">
            <Pagination page={page} totalPages={data.meta?.totalPages} total={data.meta?.total} onChange={setPage} />
          </div>
        </>
      )}
      {open && <RepModal onClose={() => setOpen(false)} />}
    </div>
  );
}
