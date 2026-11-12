import { LIVE } from '@/lib/polling';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import {
  ShoppingCart, HandCoins, ClipboardList, Coins, Timer, Boxes, Activity as ActivityIcon,
} from 'lucide-react';
import api, { unwrap } from '@/lib/api';
import { formatCurrency } from '@/lib/format';
import { PageHeader, Card, PageSpinner, EmptyState, LoadError } from '@/components/ui';

// Rearranged 11 Nov 2026 (Nino: "it looks bad and is not well arranged"): the feed is grouped by day, every
// line is in plain words (no CASH_SALE / TRANSFER_IN), amounts are shillings, a status is a small coloured
// chip instead of capitals in the title, and the rows are compact with who and when on the right.

const KIND = {
  SALE: { icon: ShoppingCart, cls: 'bg-blue-500/15 text-blue-300' },
  PAYMENT: { icon: HandCoins, cls: 'bg-emerald-500/15 text-emerald-300' },
  STOCK_REQUEST: { icon: ClipboardList, cls: 'bg-amber-500/15 text-amber-300' },
  WITHDRAWAL: { icon: Coins, cls: 'bg-violet-500/15 text-violet-300' },
  SETTLEMENT: { icon: Timer, cls: 'bg-sky-500/15 text-sky-300' },
  MOVEMENT: { icon: Boxes, cls: 'bg-white/[0.06] text-white/60' },
};

// Stock-ledger movement types, in words.
const MOVEMENT = {
  CASH_SALE: 'Boxes sold',
  CREDIT_SALE: 'Boxes sold on credit',
  TRANSFER_IN: 'Stock in',
  TRANSFER_OUT: 'Stock out',
  SALES_RETURN: 'Returned to the warehouse',
  CUSTOMER_RETURN: 'Customer return',
  PURCHASE_RECEIPT: 'Stock received from the supplier',
  ADJUSTMENT: 'Stock adjusted',
  CORRECTION: 'Stock corrected',
  STOCK_COUNT: 'Stock count',
  DAMAGE: 'Damaged stock',
};

// A status at the end of a title ("Stock request REQ-1 — CANCELLED") becomes a chip.
const STATUS_TONE = {
  FULFILLED: 'bg-emerald-500/15 text-emerald-300', APPROVED: 'bg-emerald-500/15 text-emerald-300', PAID: 'bg-emerald-500/15 text-emerald-300',
  COMPLETED: 'bg-emerald-500/15 text-emerald-300', PENDING: 'bg-amber-500/15 text-amber-300', PARTIAL: 'bg-amber-500/15 text-amber-300',
  REJECTED: 'bg-rose-500/15 text-rose-300', CANCELLED: 'bg-white/[0.07] text-white/55', EXPIRED: 'bg-white/[0.07] text-white/55',
};
const sentence = (s) => String(s || '').toLowerCase().replace(/^./, (c) => c.toUpperCase());

function present(a) {
  let title = a.title || '';
  let status = null;
  const m = /^(.*?)\s+—\s+([A-Z_]+)$/.exec(title);
  if (m) { title = m[1]; status = m[2]; }
  if (a.kind === 'MOVEMENT') title = MOVEMENT[title] || sentence(title.replaceAll('_', ' '));
  // "60000 TZS" -> "TSh 60,000"; "· -2" / "· +2" -> "· 2 boxes out / in".
  const detail = String(a.detail || '')
    .replace(/(\d+(?:\.\d+)?)\s*TZS/g, (_, n) => formatCurrency(Number(n)))
    .replace(/·\s*([+-])(\d+)\s*$/, (_, sign, n) => `· ${n} ${Number(n) === 1 ? 'box' : 'boxes'} ${sign === '-' ? 'out' : 'in'}`);
  return { title, status, detail };
}

function dayLabel(d) {
  const day = dayjs(d).startOf('day');
  const today = dayjs().startOf('day');
  if (day.isSame(today)) return 'Today';
  if (day.isSame(today.subtract(1, 'day'))) return 'Yesterday';
  return day.format('dddd, D MMMM');
}

export default function Activity() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['activity'],
    queryFn: async () => unwrap(await api.get('/activity', { params: { limit: 50 } })).data,
    refetchInterval: LIVE,
  });

  // Newest first, grouped by day.
  const groups = [];
  for (const a of data || []) {
    const label = dayLabel(a.at);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(a);
    else groups.push({ label, items: [a] });
  }

  return (
    <div>
      <PageHeader title="Activity" subtitle="Everything happening across the business, as it happens." />
      {isLoading ? <PageSpinner /> : isError && !data ? (
        <Card><LoadError what="the activity" onRetry={refetch} /></Card>
      ) : !groups.length ? (
        <Card><EmptyState title="No recent activity" icon={ActivityIcon} /></Card>
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <section key={g.label}>
              <h2 className="mb-2 px-1 text-[12px] font-semibold uppercase tracking-wide text-white/45">{g.label}</h2>
              <Card>
                <ul className="divide-y divide-white/[0.06]">
                  {g.items.map((a, i) => {
                    const k = KIND[a.kind] || KIND.MOVEMENT;
                    const Icon = k.icon;
                    const { title, status, detail } = present(a);
                    return (
                      <li key={`${a.at}-${i}`} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
                        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${k.cls}`}><Icon className="h-4 w-4" /></span>
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="truncate text-sm font-medium text-foreground">{title}</span>
                            {status && (
                              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${STATUS_TONE[status] || 'bg-white/[0.07] text-white/60'}`}>
                                {sentence(status)}
                              </span>
                            )}
                          </div>
                          {detail && <div className="truncate text-xs text-muted">{detail}</div>}
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="text-xs tabular-nums text-white/70">{dayjs(a.at).format('HH:mm')}</div>
                          {a.by && <div className="max-w-[9rem] truncate text-[11px] text-faint">{a.by}</div>}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
