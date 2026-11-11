import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { NotebookPen, Sun, Moon } from 'lucide-react';
import api, { apiError } from '@/lib/api';
import { pageQueries, keepOnPageTurn } from '@/lib/pageQueries';
import { useAuth } from '@/context/AuthContext';
import { ROLES } from '@/lib/constants';
import { formatCurrency, formatDate } from '@/lib/format';
import {
  PageHeader, Card, PageSpinner, EmptyState, Badge, Button, Modal, Field, Input, NumberInput, Textarea,
  Pagination, Table, THead, TBody, TR, TH, TD,
} from '@/components/ui';

function ReportModal({ type, onClose }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({});
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value === '' ? undefined : Number(e.target.value) });
  const setText = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = useMutation({
    mutationFn: () => api.post('/daily-reports', { type, ...form }),
    onSuccess: () => { toast.success('Report submitted'); qc.invalidateQueries({ queryKey: ['daily-reports'] }); onClose(); },
    onError: (e) => toast.error(apiError(e)),
  });
  // Nothing to send until at least one figure or a note is filled in.
  const filled = Object.values(form).some((v) => (typeof v === 'string' ? v.trim() !== '' : v !== undefined && !Number.isNaN(v)));

  return (
    <Modal open onClose={onClose} title={type === 'OPENING' ? 'Opening report' : 'Closing report'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={submit.isPending} disabled={!filled} onClick={() => submit.mutate()}>Submit</Button></>}>
      <div className="space-y-4">
        {type === 'OPENING' ? (
          <>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Cash on hand"><NumberInput min="0" onChange={set('cashOnHand')} /></Field>
              <Field label="Customers to visit"><NumberInput min="0" onChange={set('customersToVisit')} /></Field>
            </div>
            <Field label="Notes"><Textarea rows={2} onChange={setText('openingNote')} placeholder="Plan for the day…" /></Field>
          </>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Sales made"><NumberInput min="0" onChange={set('salesAmount')} /></Field>
              <Field label="Cash collected"><NumberInput min="0" onChange={set('cashCollected')} /></Field>
              <Field label="Debts created"><NumberInput min="0" onChange={set('debtsCreated')} /></Field>
              <Field label="Debts collected"><NumberInput min="0" onChange={set('debtsCollected')} /></Field>
            </div>
            <Field label="Notes"><Textarea rows={2} onChange={setText('closingNote')} placeholder="Remaining stock, issues…" /></Field>
          </>
        )}
      </div>
    </Modal>
  );
}

export default function DailyReports() {
  const { user, hasRole } = useAuth();
  const isRep = user?.role === ROLES.SALES_REP;
  const staff = hasRole(ROLES.WAREHOUSE_STAFF);
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState(null); // 'OPENING' | 'CLOSING'

  const { data, isLoading } = useQuery({
    ...pageQueries.dailyReports({ page }),
    placeholderData: keepOnPageTurn(),
  });

  return (
    <div>
      <PageHeader title="Daily Reports" subtitle={isRep ? 'Submit your opening and closing reports.' : 'Reps’ daily opening and closing reports.'}>
        {isRep && <>
          <Button variant="secondary" onClick={() => setModal('OPENING')}><Sun className="h-4 w-4" /> Opening</Button>
          <Button onClick={() => setModal('CLOSING')}><Moon className="h-4 w-4" /> Closing</Button>
        </>}
      </PageHeader>
      <Card>
        {isLoading ? <PageSpinner /> : !data?.data?.length ? (
          <EmptyState title="No daily reports yet" icon={NotebookPen} />
        ) : (
          <>
            {/* On a phone, one stacked row per report: the six-column table pushed Collected and
                Notes off the screen. The table stays from the sm breakpoint up. */}
            <div className="divide-y divide-border sm:hidden">
              {data.data.map((r) => (
                <div key={r.id} className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="shrink-0 text-sm font-semibold text-foreground">{formatDate(r.reportDate)}</span>
                    <Badge className={r.type === 'OPENING' ? 'bg-amber-500/15 text-amber-300' : 'bg-indigo-500/15 text-indigo-300'}>{r.type}</Badge>
                    {staff && <span className="ml-auto truncate text-xs text-muted">{r.salesRep?.user?.name}</span>}
                  </div>
                  <p className="mt-1 text-xs tabular-nums text-muted">
                    {r.type === 'OPENING'
                      ? <>Cash <span className="text-foreground">{formatCurrency(r.cashOnHand || 0)}</span></>
                      : <>Sales <span className="text-foreground">{formatCurrency(r.salesAmount || 0)}</span> · Collected <span className="text-foreground">{formatCurrency(r.cashCollected || 0)}</span></>}
                  </p>
                  {(r.openingNote || r.closingNote) && <p className="mt-0.5 truncate text-xs text-faint">{r.openingNote || r.closingNote}</p>}
                </div>
              ))}
            </div>
            <div className="hidden sm:block">
              <Table>
                <THead><TR><TH>Date</TH>{staff && <TH>Rep</TH>}<TH>Type</TH><TH>Cash / Sales</TH><TH>Collected</TH><TH>Notes</TH></TR></THead>
                <TBody>
                  {data.data.map((r) => (
                    <TR key={r.id}>
                      <TD>{formatDate(r.reportDate)}</TD>
                      {staff && <TD>{r.salesRep?.user?.name}</TD>}
                      <TD><Badge className={r.type === 'OPENING' ? 'bg-amber-500/15 text-amber-300' : 'bg-indigo-500/15 text-indigo-300'}>{r.type}</Badge></TD>
                      <TD>{r.type === 'OPENING' ? formatCurrency(r.cashOnHand || 0) : formatCurrency(r.salesAmount || 0)}</TD>
                      <TD>{r.type === 'CLOSING' ? formatCurrency(r.cashCollected || 0) : '—'}</TD>
                      <TD className="max-w-[260px] truncate text-muted">{r.openingNote || r.closingNote || '—'}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
            <Pagination page={page} totalPages={data.meta?.totalPages} total={data.meta?.total} onChange={setPage} />
          </>
        )}
      </Card>
      {modal && <ReportModal type={modal} onClose={() => setModal(null)} />}
    </div>
  );
}
