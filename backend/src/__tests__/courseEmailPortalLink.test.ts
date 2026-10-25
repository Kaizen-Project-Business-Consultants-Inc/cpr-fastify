import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Owner 2026-10-25: the "Course Confirmed" email said "through your organization portal"
// with no link, unlike the "request received" email.
vi.mock('../config/env.js', () => ({
  env: { RESEND_API_KEY: 're_test', EMAIL_FROM: 'staging-noreply@kpbc.ca', FRONTEND_URL: 'https://stagecprapp.kpbc.ca' },
}));
vi.mock('../config/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { EmailService } from '../services/EmailService.js';

describe('course emails to an organization link to the portal', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset().mockResolvedValue({ ok: true, json: async () => ({ id: 'e1' }) });
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());
  const html = () => (JSON.parse(fetchMock.mock.calls[0][1].body as string) as { html: string }).html;

  it('confirmed', async () => {
    await EmailService.getInstance().sendCourseConfirmedEmail('a@org.test', {
      courseName: 'Basic First Aid', date: '2026-10-25', location: 'markham', instructorName: 'Coujoe', startTime: '09:00', endTime: '12:00',
    });
    expect(html()).toContain('<a href="https://stagecprapp.kpbc.ca">https://stagecprapp.kpbc.ca</a>');
  });

  it('completed', async () => {
    await EmailService.getInstance().sendCourseCompletedEmail('a@org.test', {
      courseName: 'Basic First Aid', date: '2026-10-25', studentsAttended: 5, totalStudents: 6,
    });
    expect(html()).toContain('<a href="https://stagecprapp.kpbc.ca">https://stagecprapp.kpbc.ca</a>');
  });
});
