import { describe, it, expect, vi } from 'vitest';

// Course requests showed no "Date Submitted": createRequest never set
// date_requested, so MariaDB stored 0000-00-00. Migration v28 backfills it.
vi.mock('../config/database.js', () => ({ getPool: () => ({}) }));
vi.mock('../config/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../services/EmailService.js', () => ({ emailService: {} }));

import { torontoToday } from '../utils/torontoDate.js';
import { CourseService } from '../services/CourseService.js';
import { migrations } from '../config/migrations.js';
import type { CourseRequestRepository } from '../repositories/CourseRequestRepository.js';
import type { CourseStudentRepository } from '../repositories/CourseStudentRepository.js';
import type { UserRepository } from '../repositories/UserRepository.js';

describe('torontoToday', () => {
  it('uses the Toronto day, not the UTC day, in the evening', () => {
    // 01:30 UTC on Oct 20 is 21:30 on Oct 19 in Toronto (EDT).
    expect(torontoToday(new Date('2026-10-20T01:30:00Z'))).toBe('2026-10-19');
    // 03:00 UTC on Jan 15 is 22:00 on Jan 14 in Toronto (EST).
    expect(torontoToday(new Date('2026-01-15T03:00:00Z'))).toBe('2026-01-14');
    expect(torontoToday(new Date('2026-10-19T16:00:00Z'))).toBe('2026-10-19');
  });
});

describe('CourseService.createRequest', () => {
  it('records the date the request was submitted', async () => {
    const create = vi.fn().mockResolvedValue(9);
    const courseRepo = {
      forOrg: () => ({ findDuplicate: vi.fn().mockResolvedValue(null), create }),
      findById: vi.fn().mockResolvedValue({ id: 9 }),
    } as unknown as CourseRequestRepository;
    const service = new CourseService(courseRepo, {} as CourseStudentRepository, {} as UserRepository);

    await service.createRequest({
      organizationId: 1, courseTypeId: 2, scheduledDate: '2026-12-15', location: '300 Front St W', registeredStudents: 5,
    });

    expect(create.mock.calls[0][0].date_requested).toBe(torontoToday());
  });
});

describe('migration 28: backfill date_requested', () => {
  it('fills each missing date with the Toronto day it was created', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce([[
        { id: 3, created_at: new Date('2026-06-15T01:50:00Z') },
        { id: 4, created_at: new Date('2026-09-18T16:50:31Z') },
      ]])
      .mockResolvedValue([{}]);
    const v28 = migrations.find((m) => m.version === 28)!;

    await (v28.up as (pool: unknown) => Promise<void>)({ query });

    expect(query.mock.calls[0][0]).toMatch(/date_requested = '0000-00-00'/);
    expect(query.mock.calls.slice(1)).toEqual([
      ['UPDATE course_requests SET date_requested = ? WHERE id = ?', ['2026-06-14', 3]],
      ['UPDATE course_requests SET date_requested = ? WHERE id = ?', ['2026-09-18', 4]],
    ]);
  });
});
