import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api, { unwrap } from '@/lib/api';
import { sortByCanonical } from '@/lib/productOrder';

// Fetch a (large) list and return just the array — handy for select options.
// `opts` is merged into the query (e.g. a `select` transform).
function listHook(key, url, params = {}, opts = {}) {
  return function useList(extra = {}, queryOpts = {}) {
    return useQuery({
      queryKey: [key, 'options', { ...params, ...extra }],
      queryFn: async () => {
        const res = await api.get(url, { params: { limit: 200, ...params, ...extra } });
        return unwrap(res).data;
      },
      staleTime: 60_000,
      ...opts,
      ...queryOpts,
    });
  };
}

// Products always come back in the one canonical order, so every selection list
// across the app (rep + admin) shows them identically.
export const useProducts = listHook(
  'products',
  '/products',
  { isActive: true, sortBy: 'name', sortDir: 'asc' },
  { select: (rows) => sortByCanonical(rows) },
);
export const useBrands = listHook('brands', '/brands');
export const useCategories = listHook('categories', '/categories');
export const useWarehouses = listHook('warehouses', '/warehouses', { isActive: true });
export const useSalesReps = listHook('sales-reps', '/sales-reps', { isActive: true });
export const useCustomers = listHook('customers', '/customers');

export function usePackagingUnits() {
  return useQuery({
    queryKey: ['packaging-units', 'options'],
    queryFn: async () => unwrap(await api.get('/packaging-units')).data,
    staleTime: 300_000,
  });
}

// Debounce a fast-changing value (e.g. a search box) for query params.
export function useDebounce(value, delay = 350) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}
