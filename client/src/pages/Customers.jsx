import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { Plus, Pencil, Eye, Users as UsersIcon } from 'lucide-react';
import api, { unwrap, apiError } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useSalesReps, useDebounce } from '@/lib/hooks';
import { ROLES, CREDIT_STATUS_META } from '@/lib/constants';
import { formatCurrency, formatDate } from '@/lib/format';
import { TZ_REGIONS } from '@/lib/regions';
import {
  PageHeader, Card, PageSpinner, EmptyState, Badge, Button, Modal, Field, Input, Textarea, Select,
  SearchInput, Pagination, Table, THead, TBody, TR, TH, TD,
} from '@/components/ui';

function CustomerModal({ open, onClose, editing, reps, canAssign }) {
  const qc = useQueryClient();
  const isEdit = !!editing;
  const { register, handleSubmit, formState: { errors } } = useForm({
    defaultValues: editing || { name: '', phone: '', region: '', address: '', notes: '', salesRepId: '' },
  });
  const save = useMutation({
    mutationFn: (v) => {
      const payload = { ...v, salesRepId: v.salesRepId || null };
      return isEdit ? api.put(`/customers/${editing.id}`, payload) : api.post('/customers', payload);
    },
    onSuccess: () => { toast.success(isEdit ? 'Customer updated' : 'Customer added'); qc.invalidateQueries({ queryKey: ['customers'] }); onClose(); },
    onError: (e) => toast.error(apiError(e)),
  });
  return (
    <Modal open={open} onClose={onClose} title={isEdit ? 'Edit customer' : 'New customer'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={save.isPending} onClick={handleSubmit((v) => save.mutate(v))}>{isEdit ? 'Save' : 'Add'}</Button></>}>
      <div className="space-y-4">
        <Field label="Name" required error={errors.name?.message}><Input {...register('name', { required: 'Name is required' })} /></Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Phone"><Input {...register('phone')} /></Field>
          <Field label="Region">
            <Select {...register('region')}>
            <option value="">— Select region —</option>
            {TZ_REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Address"><Input {...register('address')} /></Field>
        {canAssign && (
          <Field label="Assigned sales rep">
            <Select {...register('salesRepId')}>
              <option value="">— Unassigned —</option>
              {reps.map((r) => <option key={r.id} value={r.id}>{r.user?.name} ({r.code})</option>)}
            </Select>
          </Field>
        )}
        <Field label="Notes"><Textarea rows={2} {...register('notes')} /></Field>
      </div>
    </Modal>
  );
}

function CustomerDetail({ id, onClose }) {
  const { data, isLoading } = useQuery({ queryKey: ['customer', id], queryFn: async () => unwrap(await api.get(`/customers/${id}`)).data, enabled: !!id });
  return (
    <Modal open={!!id} onClose={onClose} size="lg" title={data?.name || 'Customer'}>
      {isLoading || !data ? <PageSpinner /> : (
        <div className="space-y-4 text-sm">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-lg bg-elevated p-3"><div className="text-xs text-muted">Total purchases</div><div className="text-lg font-bold">{formatCurrency(data.stats.totalPurchases)}</div></div>
            <div className="rounded-lg bg-elevated p-3"><div className="text-xs text-muted">Orders</div><div className="text-lg font-bold">{data.stats.orderCount}</div></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><span className="text-muted">Phone</span><div>{data.phone || '—'}</div></div>
            <div><span className="text-muted">Region</span><div>{data.region || '—'}</div></div>
            <div><span className="text-muted">Rep</span><div>{data.salesRep?.user?.name || '—'}</div></div>
            <div><span className="text-muted">Address</span><div>{data.address || '—'}</div></div>
          </div>
          <div>
            <div className="mb-1 font-medium text-foreground">Recent sales</div>
            {data.sales.length === 0 ? <p className="text-faint">No sales yet.</p> : (
              <Table>
                <THead><TR><TH>Sale</TH><TH>Type</TH><TH>Total</TH><TH>Balance</TH><TH>Date</TH></TR></THead>
                <TBody>{data.sales.map((s) => (
                  <TR key={s.id}><TD>{s.saleNumber}</TD><TD>{s.type}</TD><TD>{formatCurrency(s.total)}</TD><TD>{formatCurrency(s.balanceDue)}</TD><TD className="text-faint">{formatDate(s.soldAt)}</TD></TR>
                ))}</TBody>
              </Table>
            )}
          </div>
          {data.creditSales?.some((c) => c.balance > 0) && (
            <div>
              <div className="mb-1 font-medium text-foreground">Outstanding credit</div>
              <ul className="space-y-1">
                {data.creditSales.filter((c) => c.balance > 0).map((c) => (
                  <li key={c.id} className="flex items-center justify-between">
                    <span>Due {formatDate(c.dueDate)}</span>
                    <span className="flex items-center gap-2"><Badge className={CREDIT_STATUS_META[c.status]?.cls}>{CREDIT_STATUS_META[c.status]?.label}</Badge><b>{formatCurrency(c.balance)}</b></span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

export default function Customers() {
  const { hasRole } = useAuth();
  const qc = useQueryClient();
  const canAssign = hasRole(ROLES.WAREHOUSE_STAFF); // admin + warehouse
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState({ open: false, editing: null });
  const [detailId, setDetailId] = useState(null);
  const debounced = useDebounce(search);

  const { data: reps = [] } = useSalesReps();
  const { data, isLoading } = useQuery({
    queryKey: ['customers', { page, search: debounced }],
    queryFn: async () => unwrap(await api.get('/customers', { params: { page, limit: 15, search: debounced } })),
  });

  return (
    <div>
      <PageHeader title="Customers" subtitle="Your customer base and their history.">
        <Button onClick={() => setModal({ open: true, editing: null })}><Plus className="h-4 w-4" /> New customer</Button>
      </PageHeader>
      <Card>
        <div className="border-b border-border p-4"><div className="max-w-sm"><SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search name or phone…" /></div></div>
        {isLoading ? <PageSpinner /> : !data?.data?.length ? (
          <EmptyState title="No customers" icon={UsersIcon} action={<Button onClick={() => setModal({ open: true, editing: null })}><Plus className="h-4 w-4" /> New customer</Button>} />
        ) : (
          <>
            <Table>
              <THead><TR><TH>Name</TH><TH>Phone</TH><TH>Region</TH><TH>Rep</TH><TH>Orders</TH><TH /></TR></THead>
              <TBody>
                {data.data.map((c) => (
                  <TR key={c.id}>
                    <TD className="font-medium text-foreground">{c.name}</TD>
                    <TD>{c.phone || '—'}</TD>
                    <TD>{c.region || '—'}</TD>
                    <TD>{c.salesRep?.user?.name || '—'}</TD>
                    <TD>{c._count?.sales ?? 0}</TD>
                    <TD>
                      <div className="flex justify-end gap-1">
                        <button className="btn-ghost px-2 py-1" onClick={() => setDetailId(c.id)}><Eye className="h-4 w-4" /></button>
                        <button className="btn-ghost px-2 py-1" onClick={() => setModal({ open: true, editing: c })}><Pencil className="h-4 w-4" /></button>
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <Pagination page={page} totalPages={data.meta?.totalPages} total={data.meta?.total} onChange={setPage} />
          </>
        )}
      </Card>
      {modal.open && <CustomerModal open={modal.open} editing={modal.editing} reps={reps} canAssign={canAssign} onClose={() => setModal({ open: false, editing: null })} />}
      {detailId && <CustomerDetail id={detailId} onClose={() => setDetailId(null)} />}
    </div>
  );
}
