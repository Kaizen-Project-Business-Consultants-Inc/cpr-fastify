import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../config/env.js', () => ({ env: { RESEND_API_KEY: 're_test', EMAIL_FROM: 'staging-noreply@kpbc.ca' } }));
vi.mock('../config/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { EmailService } from '../services/EmailService.js';

const DATA = {
  requesterName: 'Sam Ng', organizationName: 'Test <Org>', courseName: 'Basic First Aid',
  date: '2026-11-16', location: '123 <script>alert(1)</script> St', students: 8, portalUrl: 'https://stagecprapp.kpbc.ca',
};

describe('course request received email', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset().mockResolvedValue({ ok: true, json: async () => ({ id: 'e1' }) });
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const sent = () => JSON.parse(fetchMock.mock.calls[0][1].body as string) as { to: string[]; cc?: string[]; subject: string; html: string };

  it('goes to the requester, copies the admins, and shows what was asked for', async () => {
    await EmailService.getInstance().sendCourseRequestReceivedEmail('sam@org.test', ['admin@org.test', 'pat@org.test'], DATA);
    const { to, cc, subject, html } = sent();
    expect(to).toEqual(['sam@org.test']);
    expect(cc).toEqual(['admin@org.test', 'pat@org.test']);
    expect(subject).toBe('Request received: Basic First Aid on November 16, 2026');
    expect(html).toContain('Hi Sam Ng,');
    expect(html).toContain('November 16, 2026');
    expect(html).toContain('<strong>Students:</strong> 8');
    expect(html).toContain('href="https://stagecprapp.kpbc.ca"');
  });

  it('escapes anything a person typed', async () => {
    await EmailService.getInstance().sendCourseRequestReceivedEmail('sam@org.test', [], DATA);
    const { html } = sent();
    expect(html).toContain('Test &lt;Org&gt;');
    expect(html).toContain('123 &lt;script&gt;alert(1)&lt;/script&gt; St');
    expect(html).not.toContain('<script>');
  });

  it('for a request that came in as an email, asks "was this you?" and leaves out what the sender typed', async () => {
    await EmailService.getInstance().sendCourseRequestReceivedEmail('sam@org.test', ['admin@org.test'], { ...DATA, viaEmail: true });
    const { subject, html } = sent();
    expect(subject).toBe('Course request received by email: Basic First Aid on November 16, 2026');
    expect(html).toContain('We received an email asking for a course');
    expect(html).toContain('If that was you, there is nothing more to do');
    expect(html).toContain('Was this not you?');
    expect(html).toContain('admin@kpbc.ca');
    expect(html).toContain('Basic First Aid');
    expect(html).toContain('November 16, 2026');
    expect(html).not.toContain('Location');
    expect(html).not.toContain('alert(1)'); // the location text a sender typed is never repeated back
  });

  it('for a request that came in as an email, still escapes the organization name', async () => {
    await EmailService.getInstance().sendCourseRequestReceivedEmail('sam@org.test', [], { ...DATA, viaEmail: true });
    const { html } = sent();
    expect(html).toContain('Test &lt;Org&gt;');
    expect(html).not.toContain('<Org>');
  });

  it('for a portal request, does not ask "was this you?" and shows the location', async () => {
    await EmailService.getInstance().sendCourseRequestReceivedEmail('sam@org.test', [], DATA);
    const { subject, html } = sent();
    expect(subject.startsWith('Request received:')).toBe(true);
    expect(html).toContain('We received your course request');
    expect(html).toContain('<strong>Location:</strong>');
    expect(html).not.toContain('Was this not you?');
  });

  it('sends no cc field when nobody is copied', async () => {
    await EmailService.getInstance().sendCourseRequestReceivedEmail('sam@org.test', [], DATA);
    expect(sent().cc).toBeUndefined();
  });

  it('says the student count is to be confirmed when it is zero', async () => {
    await EmailService.getInstance().sendCourseRequestReceivedEmail('sam@org.test', [], { ...DATA, students: 0 });
    expect(sent().html).toContain('To be confirmed');
  });
});
