import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Owner 2026-10-19: colleges often don't know the number of students yet, so
// an emailed request without one is booked with 0 ("TBC") instead of held.
const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));
vi.mock('../config/database.js', () => ({ getPool: () => ({ query: mockQuery }) }));
vi.mock('../config/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../config/env.js', () => ({ env: { ANTHROPIC_API_KEY: undefined, RESEND_API_KEY: 're_test', RESEND_WEBHOOK_SECRET: undefined } }));

import { InboundEmailService } from '../services/InboundEmailService.js';
import type { InboundEmailRepository } from '../repositories/InboundEmailRepository.js';
import type { CourseService } from '../services/CourseService.js';

describe('an emailed request with no number of students', () => {
  const create = vi.fn().mockResolvedValue(1);
  const createRequest = vi.fn().mockResolvedValue({ id: 40 });
  const service = new InboundEmailService(
    { findByResendId: vi.fn().mockResolvedValue(null), create } as unknown as InboundEmailRepository,
    { createRequest } as unknown as CourseService,
  );

  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery
      .mockResolvedValueOnce([[{ id: 6, organization_id: 1 }]])        // sender
      .mockResolvedValueOnce([[{ id: 1, name: 'CPR Basic' }]]);        // active course types
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ text: 'Course: CPR Basic\nDate: 2099-12-15\nLocation: 300 Front St W, Toronto' }),
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('is booked with 0 students and a note that the count is to be confirmed', async () => {
    await service.processReceivedEmail('em_tbc', 'College <orguser@cpr.com>', 'Course Request');

    expect(create.mock.calls.map((c) => [c[0].status, c[0].reject_reason])).toEqual([['created_request', undefined]]);
    expect(createRequest).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: 1, courseTypeId: 1, scheduledDate: '2099-12-15', registeredStudents: 0, source: 'email',
      notes: 'Received by email — subject: "Course Request" Number of students to be confirmed.',
    }));
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ status: 'created_request', course_request_id: 40 }));
  });
});
