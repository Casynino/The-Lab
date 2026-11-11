import { useCallback, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { WifiOff, CloudOff } from 'lucide-react';
import { Button } from '@/components/ui';
import { fromNow } from '@/lib/format';
import { staleSince, noticeKind } from '@/lib/freshness';

// The device's own word on the connection. A browser without one is taken as online.
function subscribeOnline(onChange) {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}
const readOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false);

/** One quiet line above the page when what is on screen is not live: no signal, or a refresh that failed
 *  while the page kept its figures from before (audit pwa-brand-load-1). Nothing at all otherwise. */
export default function ConnectionNotice() {
  const qc = useQueryClient();
  const cache = qc.getQueryCache();
  const online = useSyncExternalStore(subscribeOnline, readOnline, () => true);
  const subscribeCache = useCallback((onChange) => cache.subscribe(onChange), [cache]);
  const since = useSyncExternalStore(
    subscribeCache,
    () => staleSince(cache.getAll().map((q) => ({ active: q.isActive(), state: q.state }))),
    () => 0,
  );
  const kind = noticeKind({ online, since });
  if (!kind) return null;

  const offline = kind === 'offline';
  const Icon = offline ? WifiOff : CloudOff;
  const retry = () => qc.refetchQueries({ type: 'active', predicate: (q) => q.state.status === 'error' });

  return (
    <div role="status" aria-live="polite"
      className="mb-3 flex items-center gap-2.5 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-[12.5px] leading-snug text-muted">
      <Icon className="h-4 w-4 shrink-0 text-amber-300" aria-hidden="true" />
      <p className="min-w-0 flex-1">
        {offline ? (
          <><span className="font-semibold text-foreground">No internet.</span> What you see was loaded earlier and may be out of date; nothing can be saved until the line is back.</>
        ) : (
          <><span className="font-semibold text-foreground">Could not refresh.</span> Showing figures loaded {fromNow(since)}; they may be out of date.</>
        )}
      </p>
      {!offline && (
        <Button variant="secondary" className="shrink-0 px-3 py-1.5 text-xs" onClick={retry}>Try again</Button>
      )}
    </div>
  );
}
