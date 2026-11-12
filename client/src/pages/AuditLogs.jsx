import { useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import dayjs from 'dayjs';
import {
  LogIn, LogOut, Plus, Pencil, Trash2, Ban, CheckCircle2, XCircle, HandCoins, Power, ScrollText,
  Send, Clock, SlidersHorizontal, PackagePlus, Undo2, RefreshCw, KeyRound,
} from 'lucide-react';
import api, { unwrap } from '@/lib/api';
import { useDebounce } from '@/lib/hooks';
import { matchingCodes } from '@/lib/auditSearch';
import { PageHeader, Card, EmptyState, LoadError, SearchInput, Pagination } from '@/components/ui';

// Rearranged 11 Nov 2026 (Nino: "it should be nice — and why does it take so long to load"): plain
// sentences ("Nino updated a rep"), grouped by day, each kind of action with its own small icon, the time
// on the right; skeleton rows while it loads, and the current page stays on screen while the next one
// comes (no blank spinner between pages or searches).

// `also`: other words people use for it, so a search finds it by them too (lib/auditSearch.js).
const ACTION = {
  CREATE: { verb: 'created', icon: Plus, cls: 'bg-emerald-500/15 text-emerald-300', also: 'added new' },
  UPDATE: { verb: 'updated', icon: Pencil, cls: 'bg-amber-500/15 text-amber-300', also: 'edited changed' },
  DELETE: { verb: 'deleted', icon: Trash2, cls: 'bg-rose-500/15 text-rose-300', also: 'removed' },
  DEACTIVATE: { verb: 'deactivated', icon: Power, cls: 'bg-rose-500/15 text-rose-300', also: 'suspended suspend switched off' },
  CANCEL: { verb: 'cancelled', icon: Ban, cls: 'bg-white/[0.07] text-white/60' },
  APPROVE: { verb: 'approved', icon: CheckCircle2, cls: 'bg-emerald-500/15 text-emerald-300' },
  REJECT: { verb: 'rejected', icon: XCircle, cls: 'bg-rose-500/15 text-rose-300' },
  PAY: { verb: 'paid', icon: HandCoins, cls: 'bg-emerald-500/15 text-emerald-300' },
  LOGIN: { verb: 'signed in', icon: LogIn, cls: 'bg-sky-500/15 text-sky-300', self: true, also: 'sign in log in login', anon: 'An account' },
  LOGOUT: { verb: 'signed out', icon: LogOut, cls: 'bg-white/[0.07] text-white/60', self: true, also: 'sign out log out logout' },
  LOGIN_FAILED: { verb: 'refused a sign-in', icon: Ban, cls: 'bg-rose-500/15 text-rose-300', self: true, also: 'failed sign in login wrong password' },
  CHANGE_PASSWORD: { verb: 'changed the password', icon: KeyRound, cls: 'bg-amber-500/15 text-amber-300', self: true },
  CHANGE_PASSWORD_FAILED: { verb: 'typed a wrong current password', icon: Ban, cls: 'bg-rose-500/15 text-rose-300', self: true, also: 'failed change password refused' },
  // Every other action the live log holds (11 Nov 2026), in words.
  SUBMIT_SETTLEMENT: { verb: 'sent', icon: Send, cls: 'bg-sky-500/15 text-sky-300', obj: 'a settlement' },
  APPROVE_SETTLEMENT: { verb: 'approved', icon: CheckCircle2, cls: 'bg-emerald-500/15 text-emerald-300', obj: 'a settlement' },
  REJECT_SETTLEMENT: { verb: 'rejected', icon: XCircle, cls: 'bg-rose-500/15 text-rose-300', obj: 'a settlement' },
  SETTLE_BOXES: { verb: 'settled boxes on', icon: CheckCircle2, cls: 'bg-emerald-500/15 text-emerald-300' },
  EXTEND_DEADLINE: { verb: 'gave more time on', icon: Clock, cls: 'bg-amber-500/15 text-amber-300', obj: 'an order' },
  UNDO_DEADLINE: { verb: 'undid more time on', icon: Clock, cls: 'bg-white/[0.07] text-white/60', obj: 'an order' },
  ADJUSTMENT: { verb: 'adjusted', icon: SlidersHorizontal, cls: 'bg-amber-500/15 text-amber-300' },
  UPDATE_PACKAGING: { verb: 'changed the packaging of', icon: Pencil, cls: 'bg-amber-500/15 text-amber-300' },
  STOCK_IN: { verb: 'brought stock in for', icon: PackagePlus, cls: 'bg-emerald-500/15 text-emerald-300' },
  ADD_STOCK: { verb: 'added stock for', icon: PackagePlus, cls: 'bg-emerald-500/15 text-emerald-300' },
  RECEIVE: { verb: 'received', icon: PackagePlus, cls: 'bg-emerald-500/15 text-emerald-300' },
  SUBMIT: { verb: 'sent', icon: Send, cls: 'bg-sky-500/15 text-sky-300' },
  SUPPLIER_GOODS_RETURNED: { verb: 'returned goods to', icon: Undo2, cls: 'bg-white/[0.07] text-white/60', obj: 'a supplier' },
  EMERGENCY_WINDOW_OPEN: { verb: 'opened a one-off withdrawal for', icon: HandCoins, cls: 'bg-amber-500/15 text-amber-300', obj: 'a rep' },
  EMERGENCY_WINDOW_CLOSE: { verb: 'closed the one-off withdrawal for', icon: HandCoins, cls: 'bg-white/[0.07] text-white/60', obj: 'a rep' },
  UPSERT: { verb: 'saved', icon: Pencil, cls: 'bg-amber-500/15 text-amber-300' },
  SYNC: { verb: 'synced', icon: RefreshCw, cls: 'bg-white/[0.07] text-white/60' },
  RECOMPUTE_CACHE: { verb: 'recounted', icon: RefreshCw, cls: 'bg-white/[0.07] text-white/60' },
};

// What was acted on, in words.
const ENTITY = {
  SalesRepresentative: 'a rep', User: 'a user account', Return: 'a return', StockRequest: 'a stock request',
  Settlement: 'an order', SettlementSubmission: 'a settlement', FinanceTransaction: 'a ledger entry',
  CommissionWithdrawal: 'a withdrawal', CommissionRate: 'a commission rate', Product: 'a product',
  PurchaseOrder: 'a purchase', Sale: 'a sale', Setting: 'a setting', StockTransfer: 'a transfer',
  Customer: 'a customer', Supplier: 'a supplier', BusinessAccount: 'an account', Penalty: 'a fine',
  SettlementPenalty: 'a fine', Warehouse: 'the warehouse', WhatsAppNotification: 'a WhatsApp message',
  Inventory: 'the stock', InventoryTransaction: 'a stock movement', StockCount: 'a stock count', Brand: 'a brand',
  Notification: 'a notification', ExpenseCategory: 'an expense category', DailyReport: 'a daily report',
};

const words = (s) => String(s || '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();

// The words each code is shown with, so a search for them finds the rows (lib/auditSearch.js).
const ACTION_WORDS = Object.fromEntries(Object.entries(ACTION).map(([code, a]) => [code, [a.verb, a.obj, a.also].filter(Boolean).join(' ')]));
function searchParams(text) {
  const actions = matchingCodes(text, ACTION_WORDS);
  const entities = matchingCodes(text, ENTITY);
  return {
    search: text,
    searchActions: actions.length ? actions.join(',') : undefined,
    searchEntities: entities.length ? entities.join(',') : undefined,
  };
}

function line(log) {
  const a = ACTION[log.action] || { verb: words(log.action), icon: ScrollText, cls: 'bg-white/[0.07] text-white/60' };
  // Sign-ins written before 12 Nov 2026 have no person (the account is the subject): not "The system".
  const who = log.user?.name || a.anon || 'The system';
  const what = a.self ? '' : ` ${a.obj || ENTITY[log.entityType] || `a ${words(log.entityType)}`}`;
  return { ...a, text: `${who} ${a.verb}${what}` };
}

function dayLabel(d) {
  const day = dayjs(d).startOf('day');
  const today = dayjs().startOf('day');
  if (day.isSame(today)) return 'Today';
  if (day.isSame(today.subtract(1, 'day'))) return 'Yesterday';
  return day.format('dddd, D MMMM');
}

function SkeletonRows({ n = 8 }) {
  return (
    <ul className="divide-y divide-white/[0.06]" aria-hidden="true">
      {Array.from({ length: n }, (_, i) => (
        <li key={i} className="flex items-center gap-3 px-4 py-3 sm:px-5">
          <span className="h-8 w-8 shrink-0 animate-pulse rounded-lg bg-white/[0.06]" />
          <span className="h-3 flex-1 animate-pulse rounded bg-white/[0.06]" style={{ maxWidth: `${40 + ((i * 17) % 35)}%` }} />
          <span className="h-3 w-10 animate-pulse rounded bg-white/[0.06]" />
        </li>
      ))}
    </ul>
  );
}

export default function AuditLogs() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const debounced = useDebounce(search);

  const { data, isLoading, isFetching, isError, refetch } = useQuery({
    queryKey: ['audit-logs', { page, search: debounced }],
    // A person's name or email, the words on the screen ("signed in", "suspended", "a rep"), or a code or id.
    queryFn: async () => unwrap(await api.get('/audit-logs', { params: { page, limit: 25, ...searchParams(debounced) } })),
    placeholderData: keepPreviousData,
  });

  const rows = data?.data || [];
  const groups = [];
  for (const log of rows) {
    const label = dayLabel(log.createdAt);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(log);
    else groups.push({ label, items: [log] });
  }

  return (
    <div>
      <PageHeader title="Audit log" subtitle="Every important action — who did it, and when." />
      <div className="mb-4 max-w-sm">
        <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search a name, an email or what happened…" />
      </div>
      {isLoading ? (
        <Card><SkeletonRows /></Card>
      ) : isError && !data ? (
        <Card><LoadError what="the audit log" onRetry={refetch} /></Card>
      ) : !rows.length ? (
        <Card>
          {debounced.trim()
            ? <EmptyState title="No entries match" message="Try a name, an email, or words like signed in, deleted or a rep." icon={ScrollText} />
            : <EmptyState title="Nothing recorded yet" icon={ScrollText} />}
        </Card>
      ) : (
        <div className={`space-y-6 transition-opacity ${isFetching ? 'opacity-70' : ''}`}>
          {groups.map((g) => (
            <section key={g.label}>
              <h2 className="mb-2 px-1 text-[12px] font-semibold uppercase tracking-wide text-white/45">{g.label}</h2>
              <Card>
                <ul className="divide-y divide-white/[0.06]">
                  {g.items.map((log) => {
                    const l = line(log);
                    const Icon = l.icon;
                    return (
                      <li key={log.id} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
                        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${l.cls}`}><Icon className="h-4 w-4" /></span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium text-foreground">{l.text}</div>
                          <div className="truncate text-[11px] text-faint">
                            {log.entityId ? `#${String(log.entityId).slice(0, 10)}` : log.entityType}
                            {log.ipAddress ? ` · ${log.ipAddress}` : ''}
                          </div>
                        </div>
                        <span className="shrink-0 text-xs tabular-nums text-white/70">{dayjs(log.createdAt).format('HH:mm')}</span>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            </section>
          ))}
          <Pagination page={page} totalPages={data.meta?.totalPages} total={data.meta?.total} onChange={setPage} />
        </div>
      )}
    </div>
  );
}
