import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../config/env.js', () => ({ env: { RESEND_API_KEY: 're_test', EMAIL_FROM: 'staging-noreply@kpbc.ca' } }));
vi.mock('../config/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { EmailService } from '../services/EmailService.js';

const DATA = {
  instructorName: 'Pat Lee', courseName: 'CPR Advanced', organizationName: 'Test <Org>',
  date: '2026-11-16', startTime: '09:00', location: '123 Main St',
};

describe('class reminder emails', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset().mockResolvedValue({ ok: true, json: async () => ({ id: 'e1' }) });
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());
  const sent = () => JSON.parse(fetchMock.mock.calls[0][1].body as string) as { subject: string; html: string };

  it('the 15-minute email has a real, clickable I\'m ready button (not escaped code)', async () => {
    await EmailService.getInstance().sendClassReminderEmail('pat@example.com', {
      ...DATA, kind: 'soon', readyUrl: 'https://stagecprapp.kpbc.ca/ready/9/abc',
    });
    const { subject, html } = sent();
    expect(subject).toBe('Starting soon: CPR Advanced at 9:00 AM');
    expect(html).toContain('<a href="https://stagecprapp.kpbc.ca/ready/9/abc"');
    expect(html).not.toContain('&lt;a ');
    expect(html).toContain('Test &lt;Org&gt;'); // names stay escaped
  });

  it('the day-before email has no button', async () => {
    await EmailService.getInstance().sendClassReminderEmail('pat@example.com', { ...DATA, kind: 'day_before' });
    const { subject, html } = sent();
    expect(subject).toBe('Reminder: CPR Advanced tomorrow at 9:00 AM');
    expect(html).not.toContain('<a href');
  });

  it('the admin alert says who, their phone and when', async () => {
    await EmailService.getInstance().sendInstructorNotReadyAlert('ca@example.com', {
      ...DATA, instructorPhone: '416-555-0100', minutesToStart: 5,
    });
    const { subject, html } = sent();
    expect(subject).toBe('Instructor not confirmed: CPR Advanced starts in 5 min');
    expect(html).toContain('416-555-0100');
    expect(html).toContain('Pat Lee');
  });
});
