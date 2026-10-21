import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { UserPlus, Pencil, Power, Trash2 } from 'lucide-react';
import api, { unwrap, apiError } from '@/lib/api';
import { useWarehouses, useDebounce } from '@/lib/hooks';
import { ROLE_LABELS } from '@/lib/constants';
import { useAuth } from '@/context/AuthContext';
import { formatDateTime } from '@/lib/format';
import { TZ_REGIONS } from '@/lib/regions';
import {
  PageHeader, Card, PageSpinner, EmptyState, Badge, Button, Modal, Field, Input, Select,
  SearchInput, Pagination, Table, THead, TBody, TR, TH, TD,
} from '@/components/ui';

function UserModal({ open, onClose, editing, roles, warehouses }) {
  const qc = useQueryClient();
  const isEdit = !!editing;
  const { register, handleSubmit, watch, reset, formState: { errors } } = useForm({
    defaultValues: editing
      ? { name: editing.name, email: editing.email, phone: editing.phone || '', roleId: editing.roleId, warehouseId: editing.warehouse?.id || '', isActive: editing.isActive }
      : { name: '', email: '', password: '', phone: '', roleId: roles[0]?.id || '', warehouseId: '', isActive: true },
  });

  const selectedRole = roles.find((r) => r.id === watch('roleId'));
  const isRep = selectedRole?.name === 'SALES_REP';

  const save = useMutation({
    mutationFn: (values) => {
      const payload = { ...values, warehouseId: values.warehouseId || null };
      if (!payload.password) delete payload.password;
      if (isEdit) return api.put(`/users/${editing.id}`, payload);
      if (isRep) payload.salesRep = { region: values.region || null };
      delete payload.region;
      return api.post('/users', payload);
    },
    onSuccess: () => {
      toast.success(isEdit ? 'User updated' : 'User created');
      qc.invalidateQueries({ queryKey: ['users'] });
      onClose();
      reset();
    },
    onError: (e) => toast.error(apiError(e)),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit user' : 'New user'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={save.isPending} onClick={handleSubmit((v) => save.mutate(v))}>{isEdit ? 'Save' : 'Create'}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Full name" required error={errors.name?.message}>
          <Input {...register('name', { required: 'Name is required' })} />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Email" required error={errors.email?.message}>
            <Input type="email" {...register('email', { required: 'Email is required' })} />
          </Field>
          <Field label="Phone"><Input {...register('phone')} /></Field>
        </div>
        <Field label={isEdit ? 'New password (leave blank to keep)' : 'Password'} required={!isEdit} error={errors.password?.message}>
          <Input type="password" {...register('password', isEdit ? {} : { required: 'Password is required', minLength: { value: 8, message: 'Min 8 characters' } })} />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Role" required>
            <Select {...register('roleId', { required: true })}>
              {roles.map((r) => <option key={r.id} value={r.id}>{ROLE_LABELS[r.name] || r.name}</option>)}
            </Select>
          </Field>
          <Field label="Home warehouse" hint="For warehouse staff">
            <Select {...register('warehouseId')}>
              <option value="">— None —</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </Select>
          </Field>
        </div>
        {!isEdit && isRep && (
          <Field label="Sales region" hint="Used to compare how regions are performing">
            <Select {...register('region')}>
            <option value="">— Select region —</option>
            {TZ_REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </Select>
          </Field>
        )}
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input type="checkbox" {...register('isActive')} className="h-4 w-4 rounded border-slate-300" /> Active
        </label>
      </div>
    </Modal>
  );
}

// Deleting an account for good. One press, one question, done — the owner
// asked for exactly that and nothing more. The confirmation the API wants is
// sent for him; it guards the endpoint against anything calling it directly,
// not against the person who just pressed the button.
function DeleteUserModal({ user, onClose, onDone }) {
  const del = useMutation({
    mutationFn: () => api.delete(`/users/${user.id}`, { data: { purge: true, confirm: user.email } }),
    onSuccess: (res) => {
      const d = res?.data?.data || {};
      toast.success(d.salesRepCode ? `${user.name} and rep ${d.salesRepCode} deleted` : `${user.name} deleted`);
      onDone(); onClose();
    },
    onError: (e) => toast.error(apiError(e)),
  });

  return (
    <Modal open onClose={onClose} title={`Delete ${user.name}?`}
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="danger" loading={del.isPending} onClick={() => del.mutate()} autoFocus>
          <Trash2 className="h-4 w-4" /> Delete
        </Button>
      </>}>
      <p className="text-sm text-muted">
        {user.name} is removed for good and cannot sign in again. If they are a sales rep, their orders, sales, returns and
        commission go too — boxes still in their hands will stop it.
      </p>
    </Modal>
  );
}

export default function Users() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState({ open: false, editing: null });
  const debounced = useDebounce(search);

  const { data, isLoading } = useQuery({
    queryKey: ['users', { page, search: debounced }],
    queryFn: async () => unwrap(await api.get('/users', { params: { page, limit: 20, search: debounced } })),
  });
  const { data: roles = [] } = useQuery({ queryKey: ['roles'], queryFn: async () => unwrap(await api.get('/roles')).data });
  const { data: warehouses = [] } = useWarehouses();

  const toggle = useMutation({
    mutationFn: (u) => (u.isActive ? api.delete(`/users/${u.id}`) : api.put(`/users/${u.id}`, { isActive: true })),
    onSuccess: () => { toast.success('Updated'); qc.invalidateQueries({ queryKey: ['users'] }); },
    onError: (e) => toast.error(apiError(e)),
  });
  // Removing an account for good, rather than parking it as Inactive.
  const { user: me } = useAuth();
  const [deleting, setDeleting] = useState(null);

  return (
    <div>
      <PageHeader title="Users" subtitle="Manage accounts, roles and access.">
        <Button onClick={() => setModal({ open: true, editing: null })}><UserPlus className="h-4 w-4" /> New user</Button>
      </PageHeader>

      <Card>
        <div className="border-b border-border p-4">
          <div className="max-w-sm"><SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search name or email…" /></div>
        </div>
        {isLoading ? <PageSpinner /> : !data?.data?.length ? <EmptyState title="No users" /> : (
          <>
            <Table>
              <THead><TR><TH>Name</TH><TH>Email</TH><TH>Role</TH><TH>Last login</TH><TH>Status</TH><TH /></TR></THead>
              <TBody>
                {data.data.map((u) => (
                  <TR key={u.id}>
                    <TD className="font-medium text-foreground">{u.name}</TD>
                    <TD>{u.email}</TD>
                    <TD><Badge className="bg-elevated text-muted">{ROLE_LABELS[u.role?.name] || u.role?.name}</Badge></TD>
                    <TD className="text-faint">{u.lastLoginAt ? formatDateTime(u.lastLoginAt) : 'Never'}</TD>
                    <TD>
                      <Badge className={u.isActive ? 'bg-emerald-500/15 text-emerald-300' : 'bg-elevated text-muted'}>
                        {u.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </TD>
                    <TD>
                      <div className="flex justify-end gap-1">
                        <button title="Edit" className="btn-ghost px-2 py-1" onClick={() => setModal({ open: true, editing: u })}><Pencil className="h-4 w-4" /></button>
                        <button title={u.isActive ? 'Suspend' : 'Activate'} className="btn-ghost px-2 py-1 text-rose-600" onClick={() => toggle.mutate(u)}><Power className="h-4 w-4" /></button>
                        {/* Your own account is never offered — the server refuses
                            it too, but the button should not be there to click. */}
                        {u.id !== me?.id && (
                          <button title="Delete for good" className="btn-ghost px-2 py-1 text-rose-600" onClick={() => setDeleting(u)}><Trash2 className="h-4 w-4" /></button>
                        )}
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

      {deleting && (
        <DeleteUserModal
          user={deleting}
          onClose={() => setDeleting(null)}
          onDone={() => { qc.invalidateQueries({ queryKey: ['users'] }); qc.invalidateQueries({ queryKey: ['sales-reps'] }); }}
        />
      )}

      {modal.open && <UserModal open={modal.open} editing={modal.editing} roles={roles} warehouses={warehouses} onClose={() => setModal({ open: false, editing: null })} />}
    </div>
  );
}
