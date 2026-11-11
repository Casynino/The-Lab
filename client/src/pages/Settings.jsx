import { SLOW } from '@/lib/polling';
import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Save, Send, MessageCircle, Eye, EyeOff, Lock } from 'lucide-react';
import dayjs from 'dayjs';
import api, { unwrap, apiError } from '@/lib/api';
import { PageHeader, Card, CardHeader, CardBody, PageSpinner, EmptyState, Input, Button, Select, Badge } from '@/components/ui';

// Rearranged 11 Nov 2026 (Nino: "too many things — it should be well arranged"): two columns on a wide
// screen, the alerts as a compact grid with plain dots, every setting under a plain name, the API key
// hidden, the finance start date locked, and only the last few messages until you ask for more.

// How urgent an alert is, as a small dot (the emoji circles read as decoration).
const PRIORITY_DOT = { INFO: 'bg-emerald-400', ACTION: 'bg-amber-300', WARNING: 'bg-orange-400', CRITICAL: 'bg-rose-500' };
const Dot = ({ priority }) => <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${PRIORITY_DOT[priority] || PRIORITY_DOT.INFO}`} aria-hidden="true" />;

// Plain words for the keys the business actually uses. Anything not listed shows its key and description.
const SETTING_INFO = {
  'settlement.windowHours': { label: 'Order window', unit: 'hours', help: 'How long a rep has to settle an order.' },
  'credit.defaultTermDays': { label: 'Credit term', unit: 'days', help: 'Days a customer has to pay a credit sale.' },
  'reorder.coverDays': { label: 'Reorder: stock to cover', unit: 'days', help: 'How many days of sales a reorder should cover.' },
  'reorder.lookbackDays': { label: 'Reorder: sales to look back at', unit: 'days', help: 'Days of past sales used to plan a reorder.' },
  'commission.amountPerThreshold': { label: 'Commission: least a rep can withdraw', unit: 'TSh' },
  'commission.v1PerBox': { label: 'Commission per box (older orders)', unit: 'TSh' },
  'business.name': { label: 'Business name' },
  'business.country': { label: 'Country' },
  'business.currency': { label: 'Currency' },
  'whatsapp.phone': { label: 'Your WhatsApp number', help: 'Where the business alerts and reports are sent.' },
  'whatsapp.apikey': { label: 'CallMeBot key', help: 'The key CallMeBot gave this number.', secret: true },
  // Changing it would move every balance and report — shown, not edited here.
  'finance.epochAt': { label: 'Finance start', help: 'Money is counted from this moment (go-live).', locked: true },
};
const SETTING_ORDER = [
  'settlement.windowHours', 'credit.defaultTermDays', 'commission.amountPerThreshold', 'commission.v1PerBox',
  'reorder.coverDays', 'reorder.lookbackDays', 'whatsapp.phone', 'whatsapp.apikey',
  'business.name', 'business.country', 'business.currency', 'finance.epochAt',
];

// Settings the WhatsApp panel manages itself — hidden from the raw list below.
const MANAGED_PREFIXES = ['whatsapp.notify.', 'whatsapp.quiet'];
// public.productPage is JSON owned by the label editor; a hand edit here could break it.
const MANAGED_KEYS = ['whatsapp.lastWeeklySent', 'commission.boxThreshold', 'public.productPage'];

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
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${checked ? 'bg-emerald-500' : 'bg-border'} ${disabled ? 'opacity-50' : ''}`}
      aria-checked={checked}
      role="switch"
    >
      {/* left-0: without it the knob started from the button's centre and slid out past the track. */}
      <span className={`absolute left-0 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
    </button>
  );
}

function StatusChip({ row }) {
  if (row.status === 'SENT') {
    return <Badge className="bg-emerald-500/15 text-emerald-400">{row.attempts > 1 ? 'Sent · retried' : 'Sent'}</Badge>;
  }
  if (row.status === 'FAILED') return <Badge className="bg-red-500/15 text-red-600">Failed</Badge>;
  return <Badge className="bg-amber-500/15 text-amber-600">Pending</Badge>;
}

// The last messages: a short list, the rest on request.
function RecentMessages() {
  const [all, setAll] = useState(false);
  const { data: history, isLoading } = useQuery({
    queryKey: ['whatsapp-history'],
    queryFn: async () => unwrap(await api.get('/settings/whatsapp/history?limit=25')).data,
    refetchInterval: SLOW,
  });
  const rows = history || [];
  const shown = all ? rows : rows.slice(0, 8);
  return (
    <Card>
      <CardHeader title="Recent WhatsApp messages" subtitle="What was sent, and whether it arrived." />
      <CardBody>
        {isLoading ? <PageSpinner label="Loading…" /> : rows.length === 0 ? (
          <EmptyState icon={MessageCircle} title="Nothing sent yet" message="Messages appear here as things happen." />
        ) : (
          <>
            <ul className="divide-y divide-white/[0.06]">
              {shown.map((row) => (
                <li key={row.id} className="flex items-center gap-3 py-2.5">
                  <Dot priority={row.priority} />
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground">{row.type.replaceAll('_', ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase())}</span>
                  <span className="shrink-0 text-xs tabular-nums text-faint">{dayjs(row.createdAt).format('DD MMM, HH:mm')}</span>
                  <StatusChip row={row} />
                </li>
              ))}
            </ul>
            {rows.length > 8 && (
              <button type="button" onClick={() => setAll((v) => !v)} className="mt-2 text-xs font-semibold text-brand-400 hover:text-brand-300">
                {all ? 'Show fewer' : `Show all ${rows.length}`}
              </button>
            )}
          </>
        )}
      </CardBody>
    </Card>
  );
}

function WhatsAppPanel({ settings }) {
  const qc = useQueryClient();
  const save = useSettingSave();
  const settingMap = new Map((settings || []).map((s) => [s.key, s.value]));

  const { data: types } = useQuery({
    queryKey: ['whatsapp-types'],
    queryFn: async () => unwrap(await api.get('/settings/whatsapp/types')).data,
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
        title="WhatsApp alerts"
        subtitle={configured
          ? 'Sent to your phone the moment something happens.'
          : 'Add your WhatsApp number and CallMeBot key under Business settings to switch them on.'}
      />
      <CardBody>
        <div className="space-y-5">
          {/* Try it: a test, and samples of the two alerts that fire on their own (so they can be seen once
              rather than waited for) — one tidy row instead of squeezed into the header. */}
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" className="whitespace-nowrap py-1.5 text-xs" disabled={!configured}
              loading={test.isPending && !test.variables}
              onClick={() => test.mutate()}>
              <Send className="h-3.5 w-3.5" /> Send test
            </Button>
            <Button variant="ghost" className="whitespace-nowrap py-1.5 text-xs" disabled={!configured}
              loading={test.isPending && test.variables === 'deadline'}
              onClick={() => test.mutate('deadline')}>
              Sample: fine warning
            </Button>
            <Button variant="ghost" className="whitespace-nowrap py-1.5 text-xs" disabled={!configured}
              loading={test.isPending && test.variables === 'extension'}
              onClick={() => test.mutate('extension')}>
              Sample: extension
            </Button>
          </div>
          <div>
            <div className="mb-1 text-sm font-semibold text-foreground">What you receive</div>
            <div className="divide-y divide-white/[0.06]">
              {(types || []).map((t) => {
                const key = `whatsapp.notify.${t.key}`;
                const enabled = settingMap.get(key) !== '0';
                return (
                  <div key={t.key} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="flex min-w-0 items-center gap-2.5 text-sm text-foreground">
                      <Dot priority={t.priority} />
                      <span className="min-w-0">{t.label}</span>
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

          <div className="border-t border-white/[0.06] pt-4">
            <div className="mb-1 text-sm font-semibold text-foreground">Quiet hours</div>
            <div className="mb-2 flex items-center gap-1.5 text-xs text-faint">
              Ordinary alerts wait until the quiet hours end; <Dot priority="CRITICAL" /> urgent ones always come through. Tanzania time.
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
      toast.success(`Saved ${(SETTING_INFO[setting.key] || {}).label || setting.key}`);
      qc.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const info = SETTING_INFO[setting.key] || {};
  const [show, setShow] = useState(false);
  const label = info.label || setting.key;
  const help = info.help || setting.description;

  return (
    <div className="py-3">
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-foreground">{label}</span>
        {info.unit && <span className="text-[11px] text-faint">{info.unit}</span>}
      </div>
      {info.locked ? (
        <div className="flex items-center gap-2 rounded-lg bg-black/25 px-3 py-2 text-sm text-white/80 ring-1 ring-inset ring-white/10">
          <Lock className="h-3.5 w-3.5 shrink-0 text-faint" aria-hidden="true" />
          {dayjs(setting.value).isValid() ? dayjs(setting.value).format('D MMM YYYY, HH:mm') : setting.value}
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Input
              type={info.secret && !show ? 'password' : 'text'}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              aria-label={label}
              className={info.secret ? '[&]:pr-10' : undefined}
            />
            {info.secret && (
              <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? 'Hide' : 'Show'}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-faint hover:text-muted">
                {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            )}
          </div>
          <Button variant="secondary" loading={save.isPending} disabled={value === setting.value} onClick={() => save.mutate()} aria-label={`Save ${label}`}>
            <Save className="h-4 w-4" />
          </Button>
        </div>
      )}
      {help && <p className="mt-1 text-[11px] text-faint">{help}</p>}
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
  // Known settings in a sensible order, anything else after them.
  const rank = (k) => { const i = SETTING_ORDER.indexOf(k); return i === -1 ? 999 : i; };
  const ordered = [...visible].sort((a, b) => rank(a.key) - rank(b.key) || a.key.localeCompare(b.key));

  // A wide screen: the alerts on the left; the business settings and the messages on the right.
  return (
    <div>
      <PageHeader title="Settings" subtitle="Your alerts and how the business runs." />
      <div className="grid items-start gap-4 xl:grid-cols-2">
        <WhatsAppPanel settings={data} />
        <div className="space-y-4">
          <Card>
            <CardHeader title="Business settings" subtitle="Change a value, then press save beside it." />
            <CardBody>
              <div className="grid gap-x-6 divide-y divide-white/[0.06] sm:grid-cols-2 sm:divide-y-0">
                {ordered.map((s) => <SettingRow key={s.id} setting={s} />)}
              </div>
            </CardBody>
          </Card>
          <RecentMessages />
        </div>
      </div>
    </div>
  );
}
