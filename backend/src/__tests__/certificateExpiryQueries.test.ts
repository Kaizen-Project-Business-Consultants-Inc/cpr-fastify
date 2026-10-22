import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Certificate expiry is counted in Toronto days (see torontoTodaySql). These
// cover the reminder emails and the student detail dialog's countdown.
const { mockQuery, mockConn } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockConn: { query: vi.fn(), release: vi.fn() },
}));
vi.mock('../config/database.js', () => ({
  getPool: () => ({ query: mockQuery, getConnection: () => Promise.resolve(mockConn) }),
}));
vi.mock('../config/logger.js', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock('../services/EmailService.js', () => ({ EmailService: { getInstance: () => ({}) } }));

import { CertReminderService } from '../services/CertReminderService.js';
import { StudentRepository } from '../repositories/StudentRepository.js';

const flat = (sql: unknown) => String(sql).replace(/\s+/g, ' ');

describe('certificate expiry queries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-22T00:30:00Z')); // 8:30 pm on Oct 21 in Toronto
    mockQuery.mockResolvedValue([[]]);
    mockConn.query.mockResolvedValue([[{ got: 1 }]]);
  });
  afterEach(() => vi.useRealTimers());

  it('reminders count days from the Toronto day and skip removed students', async () => {
    await new CertReminderService().sendReminders();
    const reminderSqls = mockQuery.mock.calls.map(([sql]) => flat(sql)).filter((s) => s.includes('days_until_expiry'));
    expect(reminderSqls).toHaveLength(3); // the 30, 60 and 90 day windows
    for (const sql of reminderSqls) {
      expect(sql).toContain("DATEDIFF(cs.certificate_expires_at, DATE('2026-10-21'))");
      expect(sql).toContain('cs.deleted_at IS NULL');
      expect(sql).not.toMatch(/NOW\(\)|CURDATE\(\)/);
    }
  });

  it('the student detail dialog gets the days left from the server', async () => {
    await new StudentRepository().getCourseHistory(5);
    const sql = flat(mockQuery.mock.calls[0][0]);
    expect(sql).toContain("DATEDIFF(cs.certificate_expires_at, DATE('2026-10-21')) as days_until_expiry");
  });
});
