import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../config/env.js', () => ({ env: { RESEND_API_KEY: 're_test', EMAIL_FROM: 'staging-noreply@kpbc.ca' } }));
vi.mock('../config/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { EmailService } from '../services/EmailService.js';

const DATA = {
  instructorName: 'Pat Lee', courseName: 'Basic First Aid', organizationName: 'Test <Org>',
  date: '2026-11-16', startTime: '09:00:00', endTime: '13:30:00', location: '123 Main St',
  scheduleUrl: 'https://stagecprapp.kpbc.ca/instructor/classes',
};

describe('instructor course email', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset().mockResolvedValue({ ok: true, json: async () => ({ id: 'e1' }) });
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const sent = () => JSON.parse(fetchMock.mock.calls[0][1].body as string) as { to: string[]; subject: string; html: string };

  it('a booking says what, where and when, with a link to My Schedule', async () => {
    await EmailService.getInstance().sendInstructorCourseEmail('pat@example.com', 'booked', DATA);
    const { to, subject, html } = sent();
    expect(to).toEqual(['pat@example.com']);
    expect(subject).toBe("You're booked: Basic First Aid on November 16, 2026");
    expect(html).toContain('Hi Pat Lee,');
    expect(html).toContain('9:00 AM - 1:30 PM');
    expect(html).toContain('123 Main St');
    expect(html).toContain('href="https://stagecprapp.kpbc.ca/instructor/classes"');
    expect(html).toContain('Test &lt;Org&gt;'); // names are escaped
    expect(html).not.toContain('Reason:');
  });

  it('a cancellation includes the reason, escaped', async () => {
    await EmailService.getInstance().sendInstructorCourseEmail('pat@example.com', 'cancelled', { ...DATA, reason: 'Venue <closed>' });
    const { subject, html } = sent();
    expect(subject).toBe('Class cancelled: Basic First Aid on November 16, 2026');
    expect(html).toContain('<strong>Reason:</strong> Venue &lt;closed&gt;');
  });

  it('shows "To be confirmed" when times are missing', async () => {
    await EmailService.getInstance().sendInstructorCourseEmail('pat@example.com', 'rescheduled', { ...DATA, startTime: null, endTime: null });
    expect(sent().html).toContain('<strong>Time:</strong> To be confirmed');
  });
});
