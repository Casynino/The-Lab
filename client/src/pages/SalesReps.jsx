import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Plus, UserCog, ChevronRight } from 'lucide-react';
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
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {data.data.map((r, i) => (
              <button
                key={r.id}
                onClick={() => navigate(`/reps/${r.id}`)}
                className="card-tile animate-rise text-left"
                style={{ animationDelay: `${i * 40}ms` }}
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-sm font-bold text-white">
                    {initials(r.user?.name)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold text-foreground">{r.user?.name}</div>
                    <div className="text-xs text-faint">{r.code}{r.region ? ` · ${r.region}` : ''}</div>
                  </div>
                  <span className={`h-2.5 w-2.5 rounded-full ${r.isActive ? 'bg-emerald-500' : 'bg-slate-300'}`} title={r.isActive ? 'Active' : 'Inactive'} />
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2">
                  <div className="rounded-xl bg-elevated p-3">
                    <div className="text-[11px] uppercase tracking-wide text-faint">Stock held</div>
                    <div className="text-sm font-bold text-foreground">{formatCurrency(r.heldStockValue)}</div>
                    <div className="text-[11px] text-faint">{formatNumber(r.heldUnits)} boxes</div>
                  </div>
                  <div className="rounded-xl bg-elevated p-3">
                    <div className="text-[11px] uppercase tracking-wide text-faint">Total sales</div>
                    <div className="text-sm font-bold text-emerald-600">{formatCurrency(r.totalSales)}</div>
                  </div>
                  <div className="rounded-xl bg-elevated p-3">
                    <div className="text-[11px] uppercase tracking-wide text-faint">Commission owed</div>
                    <div className={`text-sm font-bold ${r.commissionOwed > 0 ? 'text-amber-500' : r.commissionOwed < 0 ? 'text-rose-600' : 'text-foreground'}`}>{formatCurrency(r.commissionOwed)}</div>
                  </div>
                  <div className="rounded-xl bg-elevated p-3">
                    <div className="text-[11px] uppercase tracking-wide text-faint">Customers</div>
                    <div className="text-sm font-bold text-foreground">{r._count?.customers ?? 0}</div>
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-end gap-1 text-xs font-medium text-brand-600">
                  View profile <ChevronRight className="h-3.5 w-3.5" />
                </div>
              </button>
            ))}
          </div>
          <div className="mt-4">
            <Pagination page={page} totalPages={data.meta?.totalPages} total={data.meta?.total} onChange={setPage} />
          </div>
        </>
      )}
      {open && <RepModal onClose={() => setOpen(false)} />}
    </div>
  );
}
