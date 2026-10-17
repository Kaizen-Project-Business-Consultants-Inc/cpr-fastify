import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock factories are hoisted — cannot reference outer variables.
// Use vi.hoisted() to create mocks that can be referenced in factories.
const { mockQuery, mockWarn } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockWarn: vi.fn(),
}));

vi.mock('../config/database.js', () => ({
  getPool: () => ({ query: mockQuery }),
}));

vi.mock('../config/logger.js', () => ({
  logger: { warn: mockWarn },
}));

import { logAudit, writeAudit } from '../utils/auditLog.js';

describe('writeAudit', () => {
  it('writes through the transaction connection, not the pool', async () => {
    const conn = { query: vi.fn().mockResolvedValueOnce([{}]) };
    mockQuery.mockClear();

    await writeAudit(conn as never, { userId: 2, action: 'verify_payment', entityType: 'payment', entityId: 9, details: { amount: 100 } });

    expect(conn.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO audit_logs'),
      [2, null, 'verify_payment', 'payment', 9, '{"amount":100}', null],
    );
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('throws on failure so the transaction rolls back', async () => {
    const conn = { query: vi.fn().mockRejectedValueOnce(new Error('disk full')) };
    await expect(writeAudit(conn as never, { action: 'x' })).rejects.toThrow('disk full');
  });
});

describe('logAudit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('inserts into audit_logs table with all params', () => {
    mockQuery.mockResolvedValueOnce([{}]);

    logAudit({
      userId: 1,
      username: 'admin',
      action: 'login',
      entityType: 'user',
      entityId: 42,
      details: { browser: 'Chrome' },
      ipAddress: '127.0.0.1',
    });

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO audit_logs'),
      [1, 'admin', 'login', 'user', 42, '{"browser":"Chrome"}', '127.0.0.1'],
    );
  });

  it('uses null for optional params when not provided', () => {
    mockQuery.mockResolvedValueOnce([{}]);

    logAudit({ action: 'system_check' });

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO audit_logs'),
      [null, null, 'system_check', null, null, null, null],
    );
  });

  it('catches and logs failures without throwing', async () => {
    const dbError = new Error('Connection refused');
    mockQuery.mockRejectedValueOnce(dbError);

    // logAudit is fire-and-forget; it should not throw
    expect(() => logAudit({ action: 'test_action' })).not.toThrow();

    // Wait for the promise rejection to be handled
    await vi.waitFor(() => {
      expect(mockWarn).toHaveBeenCalledWith(
        { err: dbError, action: 'test_action' },
        'Failed to write audit log',
      );
    });
  });

  it('serializes details as JSON string', () => {
    mockQuery.mockResolvedValueOnce([{}]);

    logAudit({
      action: 'update_user',
      details: { field: 'email', oldValue: 'a@b.com', newValue: 'c@d.com' },
    });

    const callArgs = mockQuery.mock.calls[0][1] as unknown[];
    expect(callArgs[5]).toBe('{"field":"email","oldValue":"a@b.com","newValue":"c@d.com"}');
  });

  it('passes null for details when not provided', () => {
    mockQuery.mockResolvedValueOnce([{}]);

    logAudit({ action: 'logout' });

    const callArgs = mockQuery.mock.calls[0][1] as unknown[];
    expect(callArgs[5]).toBeNull();
  });
});
