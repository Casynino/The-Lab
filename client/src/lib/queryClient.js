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
      // an older one is shown at once and asked again behind it. Two minutes is
      // the day's-figures pace of lib/polling (STEADY): the queues people sit
      // and watch (approvals, returns) still poll faster, and every save the app
      // makes refreshes what it touched straight away.
      staleTime: 2 * 60_000,
      // Keep answers in memory for an hour (the idle sign-out limit) rather than
      // five minutes, so a page opened again later shows at once instead of a
      // spinner. Signing out clears all of it (AuthContext endSession).
      gcTime: 60 * 60_000,
    },
    mutations: {
      retry: 0,
    },
  },
});

// Lists that barely move — brands, categories, packaging units, commission
// rates, bonus rules, roles — are asked again at most every five minutes. The
// screens that change them refresh them at once.
for (const key of [['brands'], ['categories'], ['packaging-units'], ['commission-rates'], ['bonus-rules'], ['finance', 'categories'], ['roles']]) {
  queryClient.setQueryDefaults(key, { staleTime: 5 * 60_000 });
}
