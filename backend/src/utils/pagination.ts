import { RowDataPacket } from 'mysql2/promise';
import { getPool } from '../config/database.js';

export interface PaginationParams {
  page: number;
  limit: number;
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

export const MAX_LIMIT = 200;
export const DEFAULT_LIMIT = 25;

/**
 * Either a plain array (caller did not ask for a page) or a PaginatedResult.
 * See `isPaginated` for the opt-in rule.
 */
export type MaybePaginated<T> = T[] | PaginatedResult<T>;

/**
 * Parse page/limit from query string with safe defaults.
 */
export function parsePagination(query: Record<string, string>): PaginationParams {
  const page = Math.max(1, parseInt(query.page) || 1);
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(query.limit) || DEFAULT_LIMIT));
  return { page, limit };
}

/**
 * Run a paginated query. Executes both the data query (with LIMIT/OFFSET)
 * and a count query in parallel.
 *
 * @param dataSQL   – SQL for data rows (must NOT include LIMIT/OFFSET — they are appended)
 * @param countSQL  – SQL that returns a single `count` column
 * @param params    – Bind params shared by both queries
 * @param pagination – { page, limit } from parsePagination()
 */
export async function paginatedQuery<T = RowDataPacket>(
  dataSQL: string,
  countSQL: string,
  params: unknown[],
  pagination: PaginationParams,
): Promise<PaginatedResult<T>> {
  const pool = getPool();
  const offset = (pagination.page - 1) * pagination.limit;

  const [[rows], [countRows]] = await Promise.all([
    pool.query<RowDataPacket[]>(`${dataSQL} LIMIT ? OFFSET ?`, [...params, pagination.limit, offset]),
    pool.query<RowDataPacket[]>(countSQL, params),
  ]);

  const total = Number(countRows[0]?.count ?? 0);

  return {
    data: rows as unknown as T[],
    pagination: {
      page: pagination.page,
      limit: pagination.limit,
      total,
      pages: Math.ceil(total / pagination.limit),
    },
  };
}

/**
 * Pagination is OPT-IN. A caller asks for a page by sending `page` (and
 * optionally `limit`) in the query string. When neither is present the
 * endpoint keeps its historical behaviour and returns the full list.
 *
 * An empty value (`?page=`) counts as "not asked for".
 */
export function isPaginated(query: Record<string, unknown> | undefined | null): boolean {
  if (!query) return false;
  const present = (v: unknown) => v !== undefined && v !== null && v !== '';
  return present(query.page) || present(query.limit);
}

/**
 * Run `dataSQL` either unbounded (no `page`/`limit` in the query string) or
 * paginated (LIMIT/OFFSET appended, plus `countSQL` for the total).
 *
 * `countSQL` must use the same FROM/JOIN/WHERE and the same bind params as
 * `dataSQL`; it is only executed on the paginated path.
 *
 * @param dataSQL  – SQL for the data rows, WITHOUT LIMIT/OFFSET
 * @param countSQL – SQL returning a single `count` column
 * @param params   – bind params shared by both queries
 * @param query    – the raw request query string object
 */
export async function maybePaginate<T = RowDataPacket>(
  dataSQL: string,
  countSQL: string,
  params: unknown[],
  query: Record<string, unknown> | undefined | null,
): Promise<MaybePaginated<T>> {
  if (!isPaginated(query)) {
    const pool = getPool();
    const [rows] = await pool.query<RowDataPacket[]>(dataSQL, params);
    return rows as unknown as T[];
  }
  return paginatedQuery<T>(dataSQL, countSQL, params, parsePagination(query as Record<string, string>));
}

/**
 * Shape a MaybePaginated value into the wire response.
 *
 *   plain array      -> { success: true, data: [...] }
 *   PaginatedResult  -> { success: true, data: [...], pagination: {...} }
 *
 * `map` (optional) post-processes the rows without the caller having to know
 * which branch it got.
 */
export function paginatedResponse<T, R = T>(
  result: MaybePaginated<T>,
  map?: (rows: T[]) => R[],
): { success: true; data: T[] | R[]; pagination?: PaginatedResult<T>['pagination'] } {
  if (Array.isArray(result)) {
    return { success: true, data: map ? map(result) : result };
  }
  return {
    success: true,
    data: map ? map(result.data) : result.data,
    pagination: result.pagination,
  };
}

/** Rows of a MaybePaginated value, regardless of which branch it is. */
export function rowsOf<T>(result: MaybePaginated<T>): T[] {
  return Array.isArray(result) ? result : result.data;
}

/** Pagination meta of a MaybePaginated value, or undefined on the plain-array branch. */
export function metaOf<T>(result: MaybePaginated<T>): PaginatedResult<T>['pagination'] | undefined {
  return Array.isArray(result) ? undefined : result.pagination;
}
