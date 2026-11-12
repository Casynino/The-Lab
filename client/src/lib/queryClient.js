import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      // Ask again when somebody comes back to the tab, rather than asking all
      // day in case they do. staleTime keeps that from firing on every click
      // between windows — see lib/polling for why the volume matters.
      refetchOnWindowFocus: true,
      // An answer younger than this is shown as it is when its page opens again;
      // an older one is shown at once and asked again behind it. 30 s, the same as
      // before the speed work: money, stock and the queues people decide on
      // (payouts, approvals, an order's settlement) are never more than half a
      // minute old when a page opens. The spinners are gone because answers are
      // kept (gcTime below), read ahead and saved for the next visit, not because
      // they are trusted for longer.
      staleTime: 30_000,
      // Keep answers in memory for an hour (the idle sign-out limit) rather than
      // five minutes, so a page opened again later shows at once instead of a
      // spinner. Signing out clears all of it (AuthContext endSession).
      gcTime: 60 * 60_000,
      // Ask even when the phone says it is offline, and let the request fail.
      // The library's default ('online') PAUSES a query while the device is
      // offline: no figures, no error and no spinner, so every page read it as
      // an empty list — "No orders yet", "TSh 0" — and the rep's Profile read a
      // missing figure and blacked out the app (audit pwa-brand-load-1). Failing
      // instead lands on each page's own "Couldn't load … Try again", and a
      // page with figures from earlier keeps them, marked as not fresh by the
      // notice in Layout.
      networkMode: 'always',
      // Coming back online asks again by itself. Said out loud: with
      // networkMode 'always' the library turns this OFF unless it is set.
      refetchOnReconnect: true,
    },
    mutations: {
      retry: 0,
      // A save made offline fails at once with "No connection" instead of
      // waiting, spinner turning, to be sent by itself whenever the line comes
      // back — by then the person may have tapped again, or left the screen,
      // and two of the same money or stock movement could go out.
      networkMode: 'always',
    },
  },
});

// Lists that barely move — brands, categories, packaging units, commission
// rates, bonus rules, roles — are asked again at most every five minutes. The
// screens that change them refresh them at once.
for (const key of [['brands'], ['categories'], ['packaging-units'], ['commission-rates'], ['bonus-rules'], ['finance', 'categories'], ['roles']]) {
  queryClient.setQueryDefaults(key, { staleTime: 5 * 60_000 });
}
