import { describe, it, expect, vi, beforeEach } from 'vitest';

// Migration v29: the live DBs' hand-added CHECK constraints rejected the
// statuses the payment flow writes, so "Submit Payment" always failed.
const { mockConstraintExists } = vi.hoisted(() => ({ mockConstraintExists: vi.fn() }));
vi.mock('../config/database.js', () => ({ getPool: () => ({}) }));
vi.mock('../config/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../config/schemaHelpers.js', () => ({
  constraintExists: mockConstraintExists,
  tableExists: vi.fn(),
  columnExists: vi.fn(),
  addColumnIfMissing: vi.fn(),
  addIndexIfMissing: vi.fn(),
  addForeignKeyIfMissing: vi.fn(),
  dropIndexIfExists: vi.fn(),
}));

import { migrations } from '../config/migrations.js';

const v29 = migrations.find((m) => m.version === 29)!;
const run = async () => {
  const query = vi.fn().mockResolvedValue([{}]);
  await (v29.up as (pool: unknown) => Promise<void>)({ query });
  return query.mock.calls.map(([sql]) => String(sql).replace(/\s+/g, ' '));
};

describe('migration 29: payment and invoice status checks match the code', () => {
  beforeEach(() => vi.clearAllMocks());

  it('widens both checks to every status the payment flow writes', async () => {
    mockConstraintExists.mockResolvedValue(true);

    const sqls = await run();

    expect(sqls).toHaveLength(3);
    expect(sqls[0]).toContain('ALTER TABLE payments DROP CONSTRAINT chk_pay_status');
    // org-billing.ts payment-submission inserts 'pending_verification'; verify/reject/reverse write the rest.
    for (const s of ['pending_verification', 'verified', 'rejected', 'reversed']) expect(sqls[0]).toContain(`'${s}'`);
    expect(sqls[1]).toContain('ALTER TABLE invoices DROP CONSTRAINT chk_inv_status');
    // payment-submission sets 'payment_submitted' / 'partial_payment'.
    for (const s of ['pending', 'payment_submitted', 'partial_payment', 'paid', 'cancelled']) expect(sqls[1]).toContain(`'${s}'`);
    // "Erase personal data" sets users.status = 'deleted'.
    expect(sqls[2]).toContain('ALTER TABLE users DROP CONSTRAINT chk_users_status');
    for (const s of ['active', 'inactive', 'suspended', 'deleted']) expect(sqls[2]).toContain(`'${s}'`);
  });

  it('does nothing on a database without those constraints', async () => {
    mockConstraintExists.mockResolvedValue(false);

    expect(await run()).toHaveLength(0);
  });
});
