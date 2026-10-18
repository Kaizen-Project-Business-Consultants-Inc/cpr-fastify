import { describe, it, expect, vi, beforeEach } from 'vitest';

// Migration v26: replace the old-shape token_blacklist safely, even if a previous run stopped half-way.
const { mockTableExists, mockColumnExists } = vi.hoisted(() => ({ mockTableExists: vi.fn(), mockColumnExists: vi.fn() }));
vi.mock('../config/database.js', () => ({ getPool: () => ({}) }));
vi.mock('../config/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../config/schemaHelpers.js', () => ({
  tableExists: mockTableExists,
  columnExists: mockColumnExists,
  addColumnIfMissing: vi.fn(),
  addIndexIfMissing: vi.fn(),
  addForeignKeyIfMissing: vi.fn(),
  dropIndexIfExists: vi.fn(),
}));

import { migrations } from '../config/migrations.js';

const v26 = migrations.find((m) => m.version === 26)!;
const run = async () => {
  const query = vi.fn().mockResolvedValue([{}]);
  await (v26.up as (pool: unknown) => Promise<void>)({ query });
  return query.mock.calls.map(([sql]) => String(sql));
};

describe('migration 26: token_blacklist per user', () => {
  beforeEach(() => vi.clearAllMocks());

  it('moves the old table aside and creates the per-user one', async () => {
    mockTableExists.mockResolvedValue(true);
    mockColumnExists.mockResolvedValue(false);

    const sqls = await run();

    expect(sqls[0]).toBe('RENAME TABLE token_blacklist TO token_blacklist_legacy_20261017');
    expect(sqls[1]).toContain('CREATE TABLE IF NOT EXISTS token_blacklist');
    expect(sqls[1]).toContain('user_id INT NOT NULL PRIMARY KEY');
  });

  it('still creates the table if an earlier run stopped after the rename', async () => {
    mockTableExists.mockResolvedValue(false);

    const sqls = await run();

    expect(sqls).toHaveLength(1);
    expect(sqls[0]).toContain('CREATE TABLE IF NOT EXISTS token_blacklist');
  });

  it('leaves a correct table alone', async () => {
    mockTableExists.mockResolvedValue(true);
    mockColumnExists.mockResolvedValue(true);

    const sqls = await run();

    expect(sqls.some((q) => q.startsWith('RENAME'))).toBe(false);
  });
});
