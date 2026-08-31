import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api, { unwrap } from '@/lib/api';
import { useDebounce } from '@/lib/hooks';
import { formatDateTime } from '@/lib/format';
import {
  PageHeader, Card, PageSpinner, EmptyState, Badge, SearchInput, Pagination,
  Table, THead, TBody, TR, TH, TD,
} from '@/components/ui';

const ACTION_CLS = {
  CREATE: 'bg-emerald-500/15 text-emerald-300',
  UPDATE: 'bg-amber-500/15 text-amber-300',
  DELETE: 'bg-rose-500/15 text-rose-300',
  DEACTIVATE: 'bg-rose-500/15 text-rose-300',
  LOGIN: 'bg-sky-500/15 text-sky-300',
  LOGOUT: 'bg-elevated text-muted',
};

export default function AuditLogs() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const debounced = useDebounce(search);

  const { data, isLoading } = useQuery({
    queryKey: ['audit-logs', { page, search: debounced }],
    queryFn: async () => unwrap(await api.get('/audit-logs', { params: { page, limit: 25, search: debounced } })),
  });

  return (
    <div>
      <PageHeader title="Audit Log" subtitle="Every important action, who did it and when." />
      <Card>
        <div className="border-b border-border p-4">
          <div className="max-w-sm"><SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search action, entity, id…" /></div>
        </div>
        {isLoading ? (
          <PageSpinner />
        ) : !data?.data?.length ? (
          <EmptyState title="No audit entries" />
        ) : (
          <>
            <Table>
              <THead><TR><TH>When</TH><TH>User</TH><TH>Action</TH><TH>Entity</TH><TH>IP</TH></TR></THead>
              <TBody>
                {data.data.map((log) => (
                  <TR key={log.id}>
                    <TD className="text-muted">{formatDateTime(log.createdAt)}</TD>
                    <TD>{log.user?.name || 'System'}</TD>
                    <TD><Badge className={ACTION_CLS[log.action] || 'bg-elevated text-muted'}>{log.action}</Badge></TD>
                    <TD>{log.entityType}{log.entityId ? ` · ${String(log.entityId).slice(0, 10)}` : ''}</TD>
                    <TD className="text-faint">{log.ipAddress || '—'}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <Pagination page={page} totalPages={data.meta?.totalPages} total={data.meta?.total} onChange={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}
