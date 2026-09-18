import { useState, useCallback, useRef, useLayoutEffect } from 'react';

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

/**
 * Shape returned by a list endpoint. `pagination` is opt-in on the backend:
 * a call with no `page`/`limit` params comes back as `{ success, data }` only.
 */
export interface PaginatedResponse<T> {
  success?: boolean;
  data?: T[];
  pagination?: PaginationMeta;
}

export interface UseServerPaginationOptions<T> {
  /** Items per page (default 25) */
  pageSize?: number;
  /**
   * Fetch a page. Receives `{ page, limit }` and must return the API envelope
   * (`response.data`) — or a bare array for endpoints that return one.
   * Kept in a ref internally, so it may close over search/filter state freely
   * without destabilising `load`.
   */
  fetchFn: (params: { page: number; limit: number }) => Promise<PaginatedResponse<T> | T[] | null | undefined>;
  /** Called when the fetch throws. The hook never rethrows. */
  onError?: (error: unknown) => void;
}

const emptyMeta = (limit: number): PaginationMeta => ({ page: 1, limit, total: 0, pages: 0 });

/**
 * Server-side pagination.
 *
 * - Sends `page`/`limit` so the backend opts into paging.
 * - Tolerates a response with no `pagination` block: that is treated as a
 *   single page holding every row (`total = data.length`, `pages = 1`).
 * - Keeps the previously loaded rows in `items` while the next page is in
 *   flight, so a screen never flickers through an empty state.
 * - Ignores out-of-order responses (fast Next clicks / racing searches).
 *
 * Usage:
 *   const grid = useServerPagination({
 *     fetchFn: ({ page, limit }) =>
 *       api.get('/endpoint', { params: { page, limit, search } }).then(r => r.data),
 *     onError: () => showSnackbar('Failed to load', 'error'),
 *   });
 *   useEffect(() => { grid.load(1); }, [grid.load, debouncedSearch]);
 */
// `unknown` default breaks T inference at several call sites (object-literal fetchFn returns
// don't structurally match PaginatedResponse<T> for inference), so callers that omit the type
// argument fall through to `any` here intentionally.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useServerPagination<T = any>({
  pageSize = 25,
  fetchFn,
  onError,
}: UseServerPaginationOptions<T>) {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [meta, setMeta] = useState<PaginationMeta>(() => emptyMeta(pageSize));

  // Latest callbacks live in refs so `load` keeps a stable identity and can be
  // used directly as a useEffect dependency.
  const fetchRef = useRef(fetchFn);
  const onErrorRef = useRef(onError);
  // Synced in a layout effect (never during render) so the refs are up to date
  // before any consumer effect calls `load`.
  useLayoutEffect(() => {
    fetchRef.current = fetchFn;
    onErrorRef.current = onError;
  });

  // Guards against out-of-order responses.
  const requestIdRef = useRef(0);
  // The page currently displayed, for `reload`.
  const pageRef = useRef(1);

  const load = useCallback(
    async (page = 1) => {
      const requestId = ++requestIdRef.current;
      setLoading(true);
      try {
        const result = await fetchRef.current({ page, limit: pageSize });
        if (requestId !== requestIdRef.current) return;

        const rows: T[] = Array.isArray(result) ? result : result?.data ?? [];
        const pagination = Array.isArray(result) ? undefined : result?.pagination;

        setItems(rows);
        setError(null);
        // No `pagination` block: the endpoint gave us everything in one go.
        const next: PaginationMeta = pagination ?? {
          page: 1,
          limit: rows.length || pageSize,
          total: rows.length,
          pages: rows.length ? 1 : 0,
        };
        pageRef.current = next.page;
        setMeta(next);
      } catch (err) {
        if (requestId !== requestIdRef.current) return;
        setError(err);
        setItems([]);
        pageRef.current = 1;
        setMeta(emptyMeta(pageSize));
        onErrorRef.current?.(err);
      } finally {
        if (requestId === requestIdRef.current) setLoading(false);
      }
    },
    [pageSize]
  );

  /** Re-fetch the page currently on screen (after a mutation). */
  const reload = useCallback(() => load(pageRef.current), [load]);

  const hasNextPage = meta.page < meta.pages;

  const onPrevPage = useCallback(() => {
    if (meta.page > 1) load(meta.page - 1);
  }, [meta.page, load]);

  const onNextPage = useCallback(() => {
    if (meta.page < meta.pages) load(meta.page + 1);
  }, [meta.page, meta.pages, load]);

  return {
    items,
    loading,
    error,
    /** Raw 1-based pagination metadata from the server. */
    meta,
    /** Current 0-based page index, for DataTable's `page` prop. */
    page: meta.page - 1,
    totalCount: meta.total,
    shownCount: items.length,
    hasNextPage,
    onPrevPage,
    onNextPage,
    /** Load a specific 1-based page (defaults to page 1). Stable identity. */
    load,
    reload,
    /** Escape hatch for screens that mutate a row in place. */
    setItems,
  };
}

export default useServerPagination;
