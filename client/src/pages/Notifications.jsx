import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { CheckCheck, Bell } from 'lucide-react';
import api, { apiError } from '@/lib/api';
import { pageQueries, keepOnPageTurn } from '@/lib/pageQueries';
import { fromNow, formatDate } from '@/lib/format';
import { PageSpinner, Pagination, LoadError } from '@/components/ui';

// Notifications in the same premium family as the rest (Nino, 11 Nov 2026: "the information is good, but arrange
// it better and make the page feel premium like the pages"): grouped by day, each group one soft glass card,
// each row a coloured dot for how serious it is, the title and the time on one line, then the message. A tap
// on a new one marks it read — no INFO badge, no "Mark read" link, no icon tile.

const DOT = {
  INFO: { cls: 'bg-sky-400', glow: 'rgba(56,189,248,0.7)' },
  WARNING: { cls: 'bg-amber-400', glow: 'rgba(251,191,36,0.7)' },
  CRITICAL: { cls: 'bg-rose-400', glow: 'rgba(251,113,133,0.7)' },
};

const dayKey = (v) => {
  const d = new Date(v);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

// "Today", "Yesterday", then the date — in the viewer's own clock, which is the rep's.
function dayLabel(v) {
  const now = new Date();
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (dayKey(v) === dayKey(now)) return 'Today';
  if (dayKey(v) === dayKey(yesterday)) return 'Yesterday';
  return formatDate(v);
}

export default function Notifications() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);

  const { data, isLoading, isError, refetch } = useQuery({
    ...pageQueries.notifications({ page }),
    placeholderData: keepOnPageTurn(),
  });

  const markRead = useMutation({
    mutationFn: (id) => api.post(`/notifications/${id}/read`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const markAll = useMutation({
    mutationFn: () => api.post('/notifications/read-all'),
    onSuccess: () => {
      toast.success('All marked as read');
      qc.invalidateQueries({ queryKey: ['notifications'] });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const items = data?.data || [];
  // The server counts every unread one (meta.unread); this page only holds 20 of them.
  const unread = data?.meta?.unread ?? items.filter((n) => !n.isRead).length;

  // Newest first, in day groups (the server already sends newest first; this only splits it up).
  const groups = useMemo(() => {
    const out = [];
    for (const n of items) {
      const key = dayKey(n.createdAt);
      const last = out[out.length - 1];
      if (last && last.key === key) last.rows.push(n);
      else out.push({ key, label: dayLabel(n.createdAt), rows: [n] });
    }
    return out;
  }, [items]);

  return (
    <div className="mx-auto max-w-3xl lg:max-w-5xl">
      <div className="mb-5 flex items-end justify-between gap-3 px-1">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Notifications</h1>
          {unread > 0 && <p className="mt-0.5 text-[13px] text-muted">{unread} new</p>}
        </div>
        {unread > 0 && (
          <button
            type="button"
            disabled={markAll.isPending}
            onClick={() => markAll.mutate()}
            className="tap-phone flex items-center gap-1.5 pb-0.5 text-[13px] font-semibold text-brand-600 transition hover:text-brand-500 disabled:opacity-50"
          >
            <CheckCheck className="h-4 w-4" /> Mark all read
          </button>
        )}
      </div>

      {isLoading ? (
        <PageSpinner />
      ) : isError && !data ? (
        // A request that never came back is not "You're all caught up" (audit #68).
        <LoadError what="your notifications" onRetry={refetch} />
      ) : !items.length ? (
        <div className="mt-16 px-1 text-center">
          <Bell className="mx-auto h-6 w-6 text-muted" aria-hidden="true" />
          <p className="mt-3 text-sm font-medium text-foreground">You're all caught up</p>
          <p className="mt-1 text-xs text-muted">No notifications right now.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <section key={g.key}>
              <h2 className="mb-2 px-1 text-xs font-medium text-muted">{g.label}</h2>
              <div className="glass-list divide-y divide-white/[0.07]">
                {g.rows.map((n) => {
                  const fresh = !n.isRead;
                  const sev = DOT[n.severity] || DOT.INFO;
                  return (
                    <button
                      key={n.id}
                      type="button"
                      onClick={() => fresh && markRead.mutate(n.id)}
                      className={clsx(
                        'flex w-full items-start gap-3 px-4 py-4 text-left transition',
                        // Staff pages (`lab-app`) mark a new one with the dot and a quiet white tint, not red; the rep's own view is unchanged.
                        fresh ? 'bg-brand-500/[0.07] hover:bg-brand-500/[0.1] [.lab-app_&]:bg-white/[0.035] [.lab-app_&]:hover:bg-white/[0.06]' : 'cursor-default',
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className={clsx('mt-[7px] h-2 w-2 shrink-0 rounded-full', fresh ? sev.cls : 'bg-white/15')}
                        style={fresh ? { boxShadow: `0 0 10px ${sev.glow}` } : undefined}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-3">
                          <span className={clsx('text-[15px] font-semibold leading-snug', fresh ? 'text-foreground' : 'text-foreground/70')}>{n.title}</span>
                          <span className="shrink-0 text-[11px] text-faint">{fromNow(n.createdAt)}</span>
                        </div>
                        <p className={clsx('mt-1 text-[13px] leading-relaxed', fresh ? 'text-muted' : 'text-faint')}>{n.message}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
          <Pagination page={page} totalPages={data.meta?.totalPages} total={data.meta?.total} onChange={setPage} />
        </div>
      )}
    </div>
  );
}
