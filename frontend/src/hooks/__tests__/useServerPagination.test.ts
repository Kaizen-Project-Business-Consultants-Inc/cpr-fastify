import { describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useServerPagination } from '../useServerPagination';

const page = (n: number, total = 60, limit = 25) => ({
  success: true,
  data: Array.from({ length: Math.min(limit, total - (n - 1) * limit) }, (_, i) => ({
    id: (n - 1) * limit + i + 1,
  })),
  pagination: { page: n, limit, total, pages: Math.ceil(total / limit) },
});

describe('useServerPagination', () => {
  it('requests page 1 with the configured limit and exposes the meta', async () => {
    const fetchFn = vi.fn().mockResolvedValue(page(1));
    const { result } = renderHook(() => useServerPagination({ fetchFn }));

    await act(async () => { await result.current.load(); });

    expect(fetchFn).toHaveBeenCalledWith({ page: 1, limit: 25 });
    expect(result.current.items).toHaveLength(25);
    expect(result.current.meta).toEqual({ page: 1, limit: 25, total: 60, pages: 3 });
    expect(result.current.page).toBe(0);
    expect(result.current.totalCount).toBe(60);
    expect(result.current.shownCount).toBe(25);
    expect(result.current.hasNextPage).toBe(true);
  });

  it('requests page 2 when onNextPage is called', async () => {
    const fetchFn = vi.fn(({ page: p }) => Promise.resolve(page(p)));
    const { result } = renderHook(() => useServerPagination({ fetchFn }));

    await act(async () => { await result.current.load(1); });
    await act(async () => { result.current.onNextPage(); });

    await waitFor(() => expect(result.current.meta.page).toBe(2));
    expect(fetchFn).toHaveBeenLastCalledWith({ page: 2, limit: 25 });
    expect(result.current.items[0]).toEqual({ id: 26 });
    expect(result.current.page).toBe(1);
  });

  it('does not advance past the last page and goes back with onPrevPage', async () => {
    const fetchFn = vi.fn(({ page: p }) => Promise.resolve(page(p)));
    const { result } = renderHook(() => useServerPagination({ fetchFn }));

    await act(async () => { await result.current.load(3); });
    expect(result.current.hasNextPage).toBe(false);

    await act(async () => { result.current.onNextPage(); });
    expect(fetchFn).toHaveBeenCalledTimes(1);

    await act(async () => { result.current.onPrevPage(); });
    await waitFor(() => expect(result.current.meta.page).toBe(2));
  });

  it('treats a response with no pagination block as a single page', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ success: true, data: [{ id: 1 }, { id: 2 }] });
    const { result } = renderHook(() => useServerPagination({ fetchFn }));

    await act(async () => { await result.current.load(); });

    expect(result.current.items).toHaveLength(2);
    expect(result.current.totalCount).toBe(2);
    expect(result.current.hasNextPage).toBe(false);
    expect(result.current.page).toBe(0);
  });

  it('accepts a bare array response', async () => {
    const fetchFn = vi.fn().mockResolvedValue([{ id: 1 }]);
    const { result } = renderHook(() => useServerPagination({ fetchFn }));

    await act(async () => { await result.current.load(); });

    expect(result.current.items).toEqual([{ id: 1 }]);
    expect(result.current.totalCount).toBe(1);
  });

  it('reload re-fetches the page currently shown', async () => {
    const fetchFn = vi.fn(({ page: p }) => Promise.resolve(page(p)));
    const { result } = renderHook(() => useServerPagination({ fetchFn }));

    await act(async () => { await result.current.load(2); });
    await act(async () => { await result.current.reload(); });

    expect(fetchFn).toHaveBeenLastCalledWith({ page: 2, limit: 25 });
  });

  it('reports errors through onError and never rejects', async () => {
    const onError = vi.fn();
    const fetchFn = vi.fn().mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useServerPagination({ fetchFn, onError }));

    await act(async () => { await result.current.load(); });

    expect(onError).toHaveBeenCalled();
    expect(result.current.items).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it('ignores an out-of-order response from a superseded request', async () => {
    let resolveFirst: (v: unknown) => void = () => {};
    const fetchFn = vi
      .fn()
      .mockImplementationOnce(() => new Promise((res) => { resolveFirst = res; }))
      .mockImplementationOnce(() => Promise.resolve(page(2)));

    const { result } = renderHook(() => useServerPagination({ fetchFn }));

    let first: Promise<void>;
    act(() => { first = result.current.load(1); });
    await act(async () => { await result.current.load(2); });
    await act(async () => { resolveFirst(page(1)); await first; });

    expect(result.current.meta.page).toBe(2);
    expect(result.current.items[0]).toEqual({ id: 26 });
  });

  it('keeps the previous rows visible while the next page is in flight', async () => {
    let resolveSecond: (v: unknown) => void = () => {};
    const fetchFn = vi
      .fn()
      .mockImplementationOnce(() => Promise.resolve(page(1)))
      .mockImplementationOnce(() => new Promise((res) => { resolveSecond = res; }));

    const { result } = renderHook(() => useServerPagination({ fetchFn }));
    await act(async () => { await result.current.load(1); });

    let pending: Promise<void>;
    act(() => { pending = result.current.load(2); });

    expect(result.current.loading).toBe(true);
    expect(result.current.items).toHaveLength(25);
    expect(result.current.items[0]).toEqual({ id: 1 });

    await act(async () => { resolveSecond(page(2)); await pending; });
    expect(result.current.items[0]).toEqual({ id: 26 });
  });

  it('keeps a stable load identity across renders', async () => {
    const fetchFn = vi.fn().mockResolvedValue(page(1));
    const { result, rerender } = renderHook(() => useServerPagination({ fetchFn }));
    const first = result.current.load;
    await act(async () => { await result.current.load(); });
    rerender();
    expect(result.current.load).toBe(first);
  });
});
