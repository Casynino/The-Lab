import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      // Ask again when somebody comes back to the tab, rather than asking all
      // day in case they do. staleTime keeps that from firing on every click
      // between windows — see lib/polling for why the volume matters.
      refetchOnWindowFocus: true,
      staleTime: 30_000,
    },
    mutations: {
      retry: 0,
    },
  },
});
