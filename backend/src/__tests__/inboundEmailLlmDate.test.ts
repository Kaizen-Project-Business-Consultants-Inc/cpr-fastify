import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// An email that isn't in the template format is read by the AI. Its date must
// pass the same real-calendar-day check as every other date, so an impossible
// one (Feb 30) is held for review instead of booking a course on a day that
// doesn't exist.
const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));
vi.mock('../config/database.js', () => ({ getPool: () => ({ query: mockQuery }) }));
vi.mock('../config/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../config/env.js', () => ({ env: { ANTHROPIC_API_KEY: 'k', RESEND_API_KEY: 're_test', RESEND_WEBHOOK_SECRET: undefined } }));

import { InboundEmailService } from '../services/InboundEmailService.js';
import type { InboundEmailRepository } from '../repositories/InboundEmailRepository.js';
import type { CourseService } from '../services/CourseService.js';

const sure = { courseType: 1, scheduledDate: 1, location: 1, registeredStudents: 1 };

function aiAnswer(scheduledDate: string) {
  const json = { courseType: 'CPR Basic', scheduledDate, location: '300 Front St W, Toronto', registeredStudents: 10, confidence: sure };
  return { ok: true, json: async () => ({ content: [{ type: 'text', text: JSON.stringify(json) }] }) };
}

describe('an emailed request read by the AI', () => {
  const create = vi.fn().mockResolvedValue(1);
  const createRequest = vi.fn().mockResolvedValue({ id: 41 });
  const service = new InboundEmailService(
    { findByResendId: vi.fn().mockResolvedValue(null), create } as unknown as InboundEmailRepository,
    { createRequest } as unknown as CourseService,
  );

  function stubFetch(scheduledDate: string) {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ text: 'Hi, we would like a CPR class for 10 staff in December.' }) }) // Resend: the email text
      .mockResolvedValueOnce(aiAnswer(scheduledDate)));                                                                              // Anthropic: the reading
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery
      .mockResolvedValueOnce([[{ id: 6, organization_id: 1 }]])   // sender
      .mockResolvedValueOnce([[{ id: 1, name: 'CPR Basic' }]]);   // active course types
  });
  afterEach(() => vi.unstubAllGlobals());

  it('holds the email for review when the AI gives a day that does not exist', async () => {
    stubFetch('2099-02-30');
    await service.processReceivedEmail('em_feb30', 'College <orguser@cpr.com>', 'Course Request');

    expect(createRequest).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      status: 'needs_review', reject_reason: 'Date missing or not understood',
    }));
  });

  it('still books a request when the AI gives a real date and is sure of every detail', async () => {
    stubFetch('2099-12-15');
    await service.processReceivedEmail('em_ok', 'College <orguser@cpr.com>', 'Course Request');

    expect(createRequest).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: 1, courseTypeId: 1, scheduledDate: '2099-12-15', registeredStudents: 10, source: 'email',
    }));
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ status: 'created_request', course_request_id: 41 }));
  });
});
