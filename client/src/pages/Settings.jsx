import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Save, Send, MessageCircle } from 'lucide-react';
import dayjs from 'dayjs';
import api, { unwrap, apiError } from '@/lib/api';
import { PageHeader, Card, CardHeader, CardBody, PageSpinner, EmptyState, Input, Button, Select, Badge, Table, THead, TBody, TR, TH, TD } from '@/components/ui';

const PRIORITY_ICON = { INFO: '🟢', ACTION: '🟡', WARNING: '🟠', CRITICAL: '🔴' };

// Settings the WhatsApp panel manages itself — hidden from the raw list below.
const MANAGED_PREFIXES = ['whatsapp.notify.', 'whatsapp.quiet'];
const MANAGED_KEYS = ['whatsapp.lastWeeklySent', 'commission.boxThreshold'];

function useSettingSave() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, value }) => api.put(`/settings/${key}`, { value, group: 'whatsapp' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
    onError: (e) => toast.error(apiError(e)),
  });
}

function Toggle({ checked, onChange, disabled }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${checked ? 'bg-lime-500' : 'bg-border'} ${disabled ? 'opacity-50' : ''}`}
      aria-checked={checked}
      role="switch"
    >
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
    </button>
  );
}

function StatusChip({ row }) {
  if (row.status === 'SENT') {
    return <Badge className="bg-lime-500/15 text-lime-600">{row.attempts > 1 ? 'Sent · retried' : 'Sent'}</Badge>;
  }
  if (row.status === 'FAILED') return <Badge className="bg-red-500/15 text-red-600">Failed</Badge>;
  return <Badge className="bg-amber-500/15 text-amber-600">Pending</Badge>;
}

function WhatsAppPanel({ settings }) {
  const qc = useQueryClient();
  const save = useSettingSave();
  const settingMap = new Map((settings || []).map((s) => [s.key, s.value]));

  const { data: types } = useQuery({
    queryKey: ['whatsapp-types'],
    queryFn: async () => unwrap(await api.get('/settings/whatsapp/types')).data,
  });
  const { data: history, isLoading: historyLoading } = useQuery({
    queryKey: ['whatsapp-history'],
    queryFn: async () => unwrap(await api.get('/settings/whatsapp/history?limit=25')).data,
    refetchInterval: 30000,
  });

  const test = useMutation({
    mutationFn: async (kind) => unwrap(await api.post('/settings/whatsapp/test', kind ? { kind } : {})).data,
    onSuccess: (r) => {
      if (r.sent) toast.success('Test message sent — check your WhatsApp');
      else toast.error(`Not sent: ${r.reason || 'delivery failed (will retry automatically)'}`);
      qc.invalidateQueries({ queryKey: ['whatsapp-history'] });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const configured = Boolean(settingMap.get('whatsapp.phone') && settingMap.get('whatsapp.apikey'));
  const quietFrom = settingMap.get('whatsapp.quietFrom') ?? '';
  const quietTo = settingMap.get('whatsapp.quietTo') ?? '';

  const hourOptions = [
    <option key="off" value="">Off</option>,
    ...Array.from({ length: 24 }, (_, h) => (
      <option key={h} value={String(h)}>{String(h).padStart(2, '0')}:00</option>
    )),
  ];

  return (
    <Card>
      <CardHeader
        title="WhatsApp notifications"
        subtitle={configured
          ? 'Live business alerts sent to your phone the moment something happens.'
          : 'Set whatsapp.phone and whatsapp.apikey below to activate.'}
        action={
          // Samples of the two alerts that fire on their own, so they can be
          // seen once rather than waited for.
          <div className="flex flex-wrap items-center justify-end gap-1">
            <Button variant="ghost" className="whitespace-nowrap text-xs" disabled={!configured}
              loading={test.isPending && test.variables === 'deadline'}
              onClick={() => test.mutate('deadline')}>
              Sample: fine warning
            </Button>
            <Button variant="ghost" className="whitespace-nowrap text-xs" disabled={!configured}
              loading={test.isPending && test.variables === 'extension'}
              onClick={() => test.mutate('extension')}>
              Sample: extension
            </Button>
            <Button variant="secondary" className="whitespace-nowrap" disabled={!configured}
              loading={test.isPending && !test.variables}
              onClick={() => test.mutate()}>
              <Send className="mr-1.5 h-4 w-4" /> Send test
            </Button>
          </div>
        }
      />
      <CardBody>
        <div className="space-y-5">
          <div>
            <div className="mb-2 text-sm font-semibold text-foreground">Notification types</div>
            <div className="divide-y divide-border">
              {(types || []).map((t) => {
                const key = `whatsapp.notify.${t.key}`;
                const enabled = settingMap.get(key) !== '0';
                return (
                  <div key={t.key} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0 text-sm text-foreground">
                      {PRIORITY_ICON[t.priority] || '🟢'} {t.label}
                    </div>
                    <Toggle
                      checked={enabled}
                      disabled={save.isPending}
                      onChange={(next) =>
                        save.mutate(
                          { key, value: next ? '1' : '0' },
                          { onSuccess: () => toast.success(`${t.label}: ${next ? 'on' : 'off'}`) },
                        )
                      }
                    />
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <div className="mb-1 text-sm font-semibold text-foreground">Quiet hours (EAT)</div>
            <div className="mb-2 text-xs text-faint">
              Non-critical notifications are held during quiet hours and delivered after. 🔴 Critical alerts always come through.
            </div>
            <div className="flex items-center gap-2">
              <Select
                value={quietFrom}
                onChange={(e) => save.mutate({ key: 'whatsapp.quietFrom', value: e.target.value }, { onSuccess: () => toast.success('Quiet hours updated') })}
                className="w-28"
              >
                {hourOptions}
              </Select>
              <span className="text-sm text-faint">to</span>
              <Select
                value={quietTo}
                onChange={(e) => save.mutate({ key: 'whatsapp.quietTo', value: e.target.value }, { onSuccess: () => toast.success('Quiet hours updated') })}
                className="w-28"
              >
                {hourOptions}
              </Select>
            </div>
          </div>

          <div>
            <div className="mb-2 text-sm font-semibold text-foreground">Recent notifications</div>
            {historyLoading ? (
              <PageSpinner label="Loading history…" />
            ) : (history || []).length === 0 ? (
              <EmptyState icon={MessageCircle} title="Nothing sent yet" message="Notifications appear here as events happen." />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <THead>
                    <TR>
                      <TH>When</TH>
                      <TH>Type</TH>
                      <TH>Priority</TH>
                      <TH>Status</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {(history || []).map((row) => (
                      <TR key={row.id}>
                        <TD className="whitespace-nowrap text-xs">{dayjs(row.createdAt).format('DD MMM HH:mm')}</TD>
                        <TD className="text-xs">{row.type.replaceAll('_', ' ')}</TD>
                        <TD>{PRIORITY_ICON[row.priority] || '🟢'}</TD>
                        <TD><StatusChip row={row} /></TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </div>
            )}
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

function SettingRow({ setting }) {
  const qc = useQueryClient();
  const [value, setValue] = useState(setting.value);
  useEffect(() => setValue(setting.value), [setting.value]);

  const save = useMutation({
    mutationFn: () => api.put(`/settings/${setting.key}`, { value, type: setting.type, group: setting.group, description: setting.description }),
    onSuccess: () => {
      toast.success(`Saved ${setting.key}`);
      qc.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  return (
    <div className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
      <div className="sm:w-1/3">
        <div className="text-sm font-medium text-foreground">{setting.key}</div>
        {setting.description && <div className="text-xs text-faint">{setting.description}</div>}
      </div>
      <div className="flex flex-1 items-center gap-2">
        <Input value={value} onChange={(e) => setValue(e.target.value)} />
        <Button variant="secondary" loading={save.isPending} disabled={value === setting.value} onClick={() => save.mutate()}>
          <Save className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

export default function Settings() {
  const { data, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => unwrap(await api.get('/settings')).data,
  });

  if (isLoading) return <PageSpinner />;

  const visible = (data || []).filter(
    (s) => !MANAGED_PREFIXES.some((p) => s.key.startsWith(p)) && !MANAGED_KEYS.includes(s.key),
  );
  const groups = visible.reduce((acc, s) => {
    (acc[s.group] = acc[s.group] || []).push(s);
    return acc;
  }, {});

  return (
    <div>
      <PageHeader title="Settings" subtitle="System-wide configuration." />
      <div className="space-y-4">
        <WhatsAppPanel settings={data} />
        {Object.entries(groups).map(([group, items]) => (
          <Card key={group}>
            <CardHeader title={group.charAt(0).toUpperCase() + group.slice(1)} />
            <CardBody>
              <div className="divide-y divide-border">
                {items.map((s) => <SettingRow key={s.id} setting={s} />)}
              </div>
            </CardBody>
          </Card>
        ))}
      </div>
    </div>
  );
}
