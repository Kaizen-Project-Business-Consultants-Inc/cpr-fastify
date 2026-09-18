import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock database — same shape as BillingFinancial.test.ts
const mockPoolQuery = vi.fn();
vi.mock('../config/database.js', () => ({
  getPool: () => ({ query: mockPoolQuery }),
}));

vi.mock('../config/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  parsePagination,
  paginatedQuery,
  isPaginated,
  maybePaginate,
  paginatedResponse,
  rowsOf,
  metaOf,
  MAX_LIMIT,
  DEFAULT_LIMIT,
} from '../utils/pagination.js';

/** [sql, params] of the nth call to the mocked pool. */
function call(n: number): [string, unknown[]] {
  const c = mockPoolQuery.mock.calls[n];
  return [c[0] as string, (c[1] ?? []) as unknown[]];
}

/** The call whose SQL starts with SELECT COUNT — order is not guaranteed (Promise.all). */
function countCall(): [string, unknown[]] {
  const idx = mockPoolQuery.mock.calls.findIndex((c) => /^\s*SELECT COUNT/i.test(c[0] as string));
  return call(idx);
}

function dataCall(): [string, unknown[]] {
  const idx = mockPoolQuery.mock.calls.findIndex((c) => !/^\s*SELECT COUNT/i.test(c[0] as string));
  return call(idx);
}

const DATA_SQL = 'SELECT id, name FROM widgets WHERE org_id = ? ORDER BY name';
const COUNT_SQL = 'SELECT COUNT(*) as count FROM widgets WHERE org_id = ?';

describe('pagination helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================
  // isPaginated — the opt-in rule
  // =========================================================
  describe('isPaginated', () => {
    it('is false for an empty query — the caller did not ask for a page', () => {
      expect(isPaginated({})).toBe(false);
    });

    it('is false for a query with only unrelated filters', () => {
      expect(isPaginated({ search: 'bob', status: 'active' })).toBe(false);
    });

    it('is false for undefined/null', () => {
      expect(isPaginated(undefined)).toBe(false);
      expect(isPaginated(null)).toBe(false);
    });

    it('is false for an empty page value (?page=)', () => {
      expect(isPaginated({ page: '' })).toBe(false);
      expect(isPaginated({ limit: '' })).toBe(false);
    });

    it('is true when page is present', () => {
      expect(isPaginated({ page: '1' })).toBe(true);
      expect(isPaginated({ page: '2', limit: '10' })).toBe(true);
    });

    it('is true when only limit is present', () => {
      expect(isPaginated({ limit: '50' })).toBe(true);
    });
  });

  // =========================================================
  // parsePagination — clamping
  // =========================================================
  describe('parsePagination', () => {
    it('defaults to page 1 and the default limit', () => {
      expect(parsePagination({})).toEqual({ page: 1, limit: DEFAULT_LIMIT });
      expect(DEFAULT_LIMIT).toBe(25);
    });

    it('clamps limit at MAX_LIMIT (200)', () => {
      expect(MAX_LIMIT).toBe(200);
      expect(parsePagination({ page: '1', limit: '1000' }).limit).toBe(200);
      expect(parsePagination({ page: '1', limit: '201' }).limit).toBe(200);
      expect(parsePagination({ page: '1', limit: '200' }).limit).toBe(200);
    });

    it('floors page at 1', () => {
      expect(parsePagination({ page: '0' }).page).toBe(1);
      expect(parsePagination({ page: '-5' }).page).toBe(1);
      expect(parsePagination({ page: 'nonsense' }).page).toBe(1);
    });

    it('floors limit at 1', () => {
      expect(parsePagination({ page: '1', limit: '0' }).limit).toBe(DEFAULT_LIMIT);
      expect(parsePagination({ page: '1', limit: '-3' }).limit).toBe(1);
    });

    it('passes through a valid page/limit', () => {
      expect(parsePagination({ page: '3', limit: '10' })).toEqual({ page: 3, limit: 10 });
    });
  });

  // =========================================================
  // maybePaginate — the plain-array branch (no page param)
  // =========================================================
  describe('maybePaginate — no page param', () => {
    it('runs the data query unchanged and returns a plain array', async () => {
      mockPoolQuery.mockResolvedValue([[{ id: 1, name: 'a' }, { id: 2, name: 'b' }]]);

      const result = await maybePaginate(DATA_SQL, COUNT_SQL, [7], {});

      expect(Array.isArray(result)).toBe(true);
      expect(result).toEqual([{ id: 1, name: 'a' }, { id: 2, name: 'b' }]);

      // Exactly one query — no count query on this branch.
      expect(mockPoolQuery).toHaveBeenCalledTimes(1);
      const [sql, params] = call(0);
      expect(sql).toBe(DATA_SQL);
      expect(sql).not.toMatch(/LIMIT/i);
      expect(sql).not.toMatch(/OFFSET/i);
      expect(params).toEqual([7]);
    });

    it('does not truncate — every row comes back', async () => {
      const rows = Array.from({ length: 500 }, (_, i) => ({ id: i }));
      mockPoolQuery.mockResolvedValue([rows]);

      const result = await maybePaginate(DATA_SQL, COUNT_SQL, [7], { search: 'x' });

      expect(rowsOf(result)).toHaveLength(500);
      expect(metaOf(result)).toBeUndefined();
    });
  });

  // =========================================================
  // maybePaginate — the paginated branch
  // =========================================================
  describe('maybePaginate — ?page=2&limit=10', () => {
    beforeEach(() => {
      mockPoolQuery.mockImplementation((sql: string) =>
        /^\s*SELECT COUNT/i.test(sql)
          ? Promise.resolve([[{ count: 43 }]])
          : Promise.resolve([[{ id: 11 }, { id: 12 }]]),
      );
    });

    it('appends LIMIT/OFFSET with the right offset', async () => {
      await maybePaginate(DATA_SQL, COUNT_SQL, [7], { page: '2', limit: '10' });

      const [sql, params] = dataCall();
      expect(sql).toBe(`${DATA_SQL} LIMIT ? OFFSET ?`);
      // page 2, limit 10 -> OFFSET 10
      expect(params).toEqual([7, 10, 10]);
    });

    it('runs the count query with the same params and no LIMIT/OFFSET', async () => {
      await maybePaginate(DATA_SQL, COUNT_SQL, [7], { page: '2', limit: '10' });

      const [sql, params] = countCall();
      expect(sql).toBe(COUNT_SQL);
      expect(params).toEqual([7]);
      expect(mockPoolQuery).toHaveBeenCalledTimes(2);
    });

    it('returns pagination meta derived from the count', async () => {
      const result = await maybePaginate(DATA_SQL, COUNT_SQL, [7], { page: '2', limit: '10' });

      expect(Array.isArray(result)).toBe(false);
      expect(metaOf(result)).toEqual({ page: 2, limit: 10, total: 43, pages: 5 });
      expect(rowsOf(result)).toEqual([{ id: 11 }, { id: 12 }]);
    });

    it('page 1 uses OFFSET 0', async () => {
      await maybePaginate(DATA_SQL, COUNT_SQL, [], { page: '1', limit: '25' });
      const [, params] = dataCall();
      expect(params).toEqual([25, 0]);
    });

    it('clamps the limit at 200 in the emitted SQL', async () => {
      await maybePaginate(DATA_SQL, COUNT_SQL, [], { page: '3', limit: '9999' });
      const [, params] = dataCall();
      // limit 200, page 3 -> OFFSET 400
      expect(params).toEqual([200, 400]);
    });

    it('floors page at 1 in the emitted SQL', async () => {
      await maybePaginate(DATA_SQL, COUNT_SQL, [], { page: '0', limit: '10' });
      const [, params] = dataCall();
      expect(params).toEqual([10, 0]);
    });

    it('defaults the limit to 25 when only page is given', async () => {
      await maybePaginate(DATA_SQL, COUNT_SQL, [], { page: '2' });
      const [, params] = dataCall();
      expect(params).toEqual([25, 25]);
    });

    it('treats a bare ?limit= as a page-1 request', async () => {
      await maybePaginate(DATA_SQL, COUNT_SQL, [], { limit: '5' });
      const [, params] = dataCall();
      expect(params).toEqual([5, 0]);
    });
  });

  // =========================================================
  // paginatedQuery — unchanged signature, still always paginates
  // =========================================================
  describe('paginatedQuery', () => {
    it('keeps its existing contract (always paginated)', async () => {
      mockPoolQuery.mockImplementation((sql: string) =>
        /^\s*SELECT COUNT/i.test(sql)
          ? Promise.resolve([[{ count: 7 }]])
          : Promise.resolve([[{ id: 1 }]]),
      );

      const result = await paginatedQuery(DATA_SQL, COUNT_SQL, [7], { page: 1, limit: 25 });

      expect(result.pagination).toEqual({ page: 1, limit: 25, total: 7, pages: 1 });
      expect(result.data).toEqual([{ id: 1 }]);
    });

    it('reports 0 pages for an empty result set', async () => {
      mockPoolQuery.mockImplementation((sql: string) =>
        /^\s*SELECT COUNT/i.test(sql)
          ? Promise.resolve([[{ count: 0 }]])
          : Promise.resolve([[]]),
      );

      const result = await paginatedQuery(DATA_SQL, COUNT_SQL, [], { page: 1, limit: 25 });
      expect(result.pagination).toEqual({ page: 1, limit: 25, total: 0, pages: 0 });
    });
  });

  // =========================================================
  // paginatedResponse — the wire contract
  // =========================================================
  describe('paginatedResponse', () => {
    it('omits `pagination` entirely on the plain-array branch', () => {
      const body = paginatedResponse([{ id: 1 }]);
      expect(body).toEqual({ success: true, data: [{ id: 1 }] });
      expect('pagination' in body && body.pagination !== undefined).toBe(false);
    });

    it('includes `pagination` alongside `data` on the paginated branch', () => {
      const meta = { page: 2, limit: 10, total: 43, pages: 5 };
      const body = paginatedResponse({ data: [{ id: 11 }], pagination: meta });
      expect(body).toEqual({ success: true, data: [{ id: 11 }], pagination: meta });
    });

    it('applies the row mapper on both branches', () => {
      const double = (rows: { id: number }[]) => rows.map((r) => ({ id: r.id * 2 }));

      expect(paginatedResponse([{ id: 2 }], double).data).toEqual([{ id: 4 }]);

      const meta = { page: 1, limit: 25, total: 1, pages: 1 };
      expect(paginatedResponse({ data: [{ id: 3 }], pagination: meta }, double).data).toEqual([{ id: 6 }]);
    });
  });
});
