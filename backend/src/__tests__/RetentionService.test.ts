import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---- Mocks -----------------------------------------------------------------
const mockPoolQuery = vi.fn();
const mockConnQuery = vi.fn();
const mockBeginTransaction = vi.fn();
const mockCommit = vi.fn();
const mockRollback = vi.fn();
const mockRelease = vi.fn();
const mockGetConnection = vi.fn();

vi.mock('../config/database.js', () => ({
  getPool: () => ({ query: mockPoolQuery, getConnection: mockGetConnection }),
}));

vi.mock('../config/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const mockLogAudit = vi.fn();
vi.mock('../utils/auditLog.js', () => ({
  logAudit: (...args: unknown[]) => mockLogAudit(...args),
}));

import { RetentionService } from '../services/RetentionService.js';
import { logger } from '../config/logger.js';

const yearsAgo = (n: number) => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - n);
  return d;
};

/** Pool.getConnection() is used both for the named lock and per-user transactions. */
function makeConnection() {
  return {
    query: mockConnQuery,
    beginTransaction: mockBeginTransaction,
    commit: mockCommit,
    rollback: mockRollback,
    release: mockRelease,
  };
}

/** Rows returned by the candidate SELECT. */
function arrangeCandidates(rows: unknown[]) {
  mockGetConnection.mockResolvedValue(makeConnection());
  // Lock acquisition happens on the connection.
  mockConnQuery.mockResolvedValue([[{ got: 1 }]]);
  mockPoolQuery.mockResolvedValue([rows]);
}

const userUpdateCalls = () =>
  mockConnQuery.mock.calls.filter((c) => String(c[0]).includes('UPDATE users SET username'));

describe('RetentionService', () => {
  const originalEnforce = process.env.RETENTION_ENFORCE;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.RETENTION_ENFORCE;
  });

  afterEach(() => {
    if (originalEnforce === undefined) delete process.env.RETENTION_ENFORCE;
    else process.env.RETENTION_ENFORCE = originalEnforce;
  });

  it('dry run by default: rolls back and never commits', async () => {
    arrangeCandidates([
      { id: 7, email: 'jane@example.com', status: 'inactive', date_offboarded: yearsAgo(3), updated_at: yearsAgo(3) },
    ]);

    const result = await new RetentionService().run();

    expect(result).toMatchObject({ scanned: 1, anonymised: 1, skipped: 0, errors: 0 });
    expect(mockCommit).not.toHaveBeenCalled();
    expect(mockRollback).toHaveBeenCalledTimes(1);
    expect(mockLogAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'retention_anonymise',
        entityType: 'user',
        entityId: 7,
        details: expect.objectContaining({ dryRun: true }),
      })
    );
  });

  it('enforce mode anonymises a user closed 3 years ago, with the manual endpoint values', async () => {
    process.env.RETENTION_ENFORCE = 'true';
    arrangeCandidates([
      { id: 42, email: 'bob@example.com', status: 'deleted', date_offboarded: yearsAgo(3), updated_at: yearsAgo(1) },
    ]);

    const result = await new RetentionService().run();

    expect(result).toMatchObject({ scanned: 1, anonymised: 1, skipped: 0, errors: 0 });
    expect(mockBeginTransaction).toHaveBeenCalledTimes(1);
    expect(mockCommit).toHaveBeenCalledTimes(1);
    expect(mockRollback).not.toHaveBeenCalled();
    expect(mockRelease).toHaveBeenCalled();

    const [sql, params] = userUpdateCalls()[0];
    expect(sql).toContain("username = CONCAT('deleted_', id)");
    expect(sql).toContain("email = CONCAT('deleted_', id, '@deleted.invalid')");
    expect(sql).toContain('first_name = NULL');
    expect(sql).toContain('last_name = NULL');
    expect(sql).toContain('phone = NULL');
    expect(sql).toContain("status = 'deleted'");
    expect(params).toEqual([42]);
  });

  it('never touches course, invoice or payment rows', async () => {
    process.env.RETENTION_ENFORCE = 'true';
    arrangeCandidates([
      { id: 5, email: 'old@example.com', status: 'inactive', date_offboarded: yearsAgo(4), updated_at: yearsAgo(4) },
    ]);

    await new RetentionService().run();

    const allSql = [...mockPoolQuery.mock.calls, ...mockConnQuery.mock.calls].map((c) => String(c[0])).join('\n');
    expect(allSql).not.toMatch(/course_requests|course_students|invoices|payments/i);
  });

  it('skips a user closed only 1 year ago', async () => {
    process.env.RETENTION_ENFORCE = 'true';
    arrangeCandidates([
      { id: 9, email: 'recent@example.com', status: 'inactive', date_offboarded: yearsAgo(1), updated_at: yearsAgo(1) },
    ]);

    const result = await new RetentionService().run();

    expect(result).toMatchObject({ scanned: 1, anonymised: 0, skipped: 1 });
    expect(userUpdateCalls()).toHaveLength(0);
    expect(mockCommit).not.toHaveBeenCalled();
  });

  it('skips a user with no establishable closure date', async () => {
    process.env.RETENTION_ENFORCE = 'true';
    arrangeCandidates([
      { id: 11, email: 'nodate@example.com', status: 'deleted', date_offboarded: null, updated_at: null },
    ]);

    const result = await new RetentionService().run();

    expect(result).toMatchObject({ scanned: 1, anonymised: 0, skipped: 1 });
    expect(userUpdateCalls()).toHaveLength(0);
  });

  it('skips an already-anonymised user (sentinel email), so repeat runs are no-ops', async () => {
    process.env.RETENTION_ENFORCE = 'true';
    arrangeCandidates([
      { id: 13, email: 'deleted_13@deleted.invalid', status: 'deleted', date_offboarded: yearsAgo(5), updated_at: yearsAgo(5) },
    ]);

    const result = await new RetentionService().run();

    expect(result).toMatchObject({ scanned: 1, anonymised: 0, skipped: 1 });
    expect(userUpdateCalls()).toHaveLength(0);
  });

  it('excludes the sentinel email and closed statuses in the candidate SQL, batched at 100', async () => {
    arrangeCandidates([]);

    await new RetentionService().run();

    const [sql, params] = mockPoolQuery.mock.calls[0];
    expect(String(sql)).toContain('FROM users');
    expect(String(sql)).toContain('LIMIT 100');
    expect(String(sql)).toContain('COALESCE(date_offboarded, updated_at)');
    expect(params[0]).toEqual(['inactive', 'deleted']);
    expect(params[2]).toBe('%@deleted.invalid');
  });

  it('skips the run when another worker holds the named lock', async () => {
    mockGetConnection.mockResolvedValue(makeConnection());
    mockConnQuery.mockResolvedValue([[{ got: 0 }]]);

    const result = await new RetentionService().run();

    expect(result).toMatchObject({ scanned: 0, anonymised: 0 });
    expect(mockPoolQuery).not.toHaveBeenCalled();
    expect(mockRelease).toHaveBeenCalled();
  });

  it('handles a missing table/column without throwing', async () => {
    mockGetConnection.mockResolvedValue(makeConnection());
    mockConnQuery.mockResolvedValue([[{ got: 1 }]]);
    const err = Object.assign(new Error("Table 'cpr.users' doesn't exist"), { code: 'ER_NO_SUCH_TABLE' });
    mockPoolQuery.mockRejectedValue(err);

    const result = await new RetentionService().run();

    expect(result).toEqual({ scanned: 0, anonymised: 0, skipped: 0, errors: 0 });
    expect(logger.warn).toHaveBeenCalled();
  });
});
