import { describe, it, expect, vi, beforeEach } from 'vitest';

// Owner 2026-10-24: an organization heard nothing between sending a course
// request and Course Admin confirming it. The user who made the request now
// gets a receipt, and the organization's admins are copied.
const { poolQuery, sendReceipt, repoCreate } = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  sendReceipt: vi.fn(),
  repoCreate: vi.fn(),
}));
vi.mock('../config/database.js', () => ({ getPool: () => ({ query: poolQuery }) }));
vi.mock('../config/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../config/env.js', () => ({ env: { FRONTEND_URL: 'https://stage.example' } }));
vi.mock('../services/EmailService.js', () => ({ emailService: { sendCourseRequestReceivedEmail: sendReceipt } }));

import { CourseService } from '../services/CourseService.js';
import type { CourseRequestRepository } from '../repositories/CourseRequestRepository.js';
import type { CourseStudentRepository } from '../repositories/CourseStudentRepository.js';
import type { UserRepository } from '../repositories/UserRepository.js';

const INPUT = { organizationId: 1, courseTypeId: 18, scheduledDate: '2026-11-16', location: '123 Main St', registeredStudents: 8 };

function service() {
  const forOrg = { findDuplicate: vi.fn().mockResolvedValue(null), create: repoCreate.mockResolvedValue(55) };
  const courseRepo = { forOrg: () => forOrg, findById: vi.fn().mockResolvedValue({ id: 55 }) } as unknown as CourseRequestRepository;
  return new CourseService(courseRepo, {} as CourseStudentRepository, {} as UserRepository);
}
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('course request received email', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendReceipt.mockResolvedValue(true);
    poolQuery.mockImplementation(async (sql: string) => {
      if (/FROM course_requests cr\s+LEFT JOIN class_types/.test(sql)) return [[{ course_name: 'Basic First Aid', organization_name: 'Test Organization' }]];
      if (/FROM users\s+WHERE id = \?/.test(sql)) return [[{ email: 'sam@org.test', first_name: 'Sam', last_name: 'Ng', username: 'sam' }]];
      if (/role IN \('org_admin', 'organization'\)/.test(sql)) return [[{ id: 7, email: 'sam@org.test' }, { id: 8, email: 'Admin@org.test' }, { id: 9, email: 'pat@org.test' }]];
      return [[]]; // no notification_preferences rows: everyone gets email
    });
  });

  it('sends to the requester and copies the other organization admins', async () => {
    await service().createRequest({ ...INPUT, requestedByUserId: 7 });
    await settle();
    expect(sendReceipt).toHaveBeenCalledTimes(1);
    const [to, cc, data] = sendReceipt.mock.calls[0];
    expect(to).toBe('sam@org.test');
    expect(cc).toEqual(['Admin@org.test', 'pat@org.test']); // the requester is not copied on their own email
    expect(data).toMatchObject({
      requesterName: 'Sam Ng', organizationName: 'Test Organization', courseName: 'Basic First Aid',
      date: '2026-11-16', location: '123 Main St', students: 8,
    });
  });

  it('skips admins who turned status emails off', async () => {
    poolQuery.mockImplementation(async (sql: string) => {
      if (/FROM course_requests cr\s+LEFT JOIN class_types/.test(sql)) return [[{ course_name: 'X', organization_name: 'Y' }]];
      if (/FROM users\s+WHERE id = \?/.test(sql)) return [[{ email: 'sam@org.test', first_name: 'Sam', last_name: '', username: 'sam' }]];
      if (/role IN \('org_admin', 'organization'\)/.test(sql)) return [[{ id: 8, email: 'admin@org.test' }, { id: 9, email: 'pat@org.test' }]];
      if (/notification_preferences/.test(sql)) return [[{ email_enabled: 0 }]];
      return [[]];
    });
    await service().createRequest({ ...INPUT, requestedByUserId: 7 });
    await settle();
    expect(sendReceipt.mock.calls[0][0]).toBe('sam@org.test');
    expect(sendReceipt.mock.calls[0][1]).toEqual([]);
  });

  it("looks the requester up inside the request's own organization", async () => {
    await service().createRequest({ ...INPUT, requestedByUserId: 7 });
    await settle();
    const call = poolQuery.mock.calls.find(([sql]) => /FROM users\s+WHERE id = \?/.test(sql as string))!;
    expect(call[0]).toContain('organization_id = ?');
    expect(call[1]).toEqual([7, 1]);
  });

  it('copies each admin once, ignoring case, and skips malformed addresses', async () => {
    poolQuery.mockImplementation(async (sql: string) => {
      if (/FROM course_requests cr\s+LEFT JOIN class_types/.test(sql)) return [[{ course_name: 'X', organization_name: 'Y' }]];
      if (/FROM users\s+WHERE id = \?/.test(sql)) return [[{ email: 'sam@org.test', first_name: 'Sam', last_name: '', username: 'sam' }]];
      if (/role IN \('org_admin', 'organization'\)/.test(sql)) {
        return [[{ id: 1, email: 'SAM@org.test' }, { id: 2, email: 'pat@org.test' }, { id: 3, email: 'Pat@org.test' }, { id: 4, email: 'not an email' }]];
      }
      return [[]];
    });
    await service().createRequest({ ...INPUT, requestedByUserId: 7 });
    await settle();
    expect(sendReceipt.mock.calls[0][0]).toBe('sam@org.test');
    expect(sendReceipt.mock.calls[0][1]).toEqual(['pat@org.test']);
  });

  it('with no usable requester email, the first admin is the recipient and the rest are copied', async () => {
    poolQuery.mockImplementation(async (sql: string) => {
      if (/FROM course_requests cr\s+LEFT JOIN class_types/.test(sql)) return [[{ course_name: 'X', organization_name: 'Y' }]];
      if (/FROM users\s+WHERE id = \?/.test(sql)) return [[]];
      if (/role IN \('org_admin', 'organization'\)/.test(sql)) return [[{ id: 8, email: 'admin@org.test' }, { id: 9, email: 'pat@org.test' }]];
      return [[]];
    });
    await service().createRequest({ ...INPUT, requestedByUserId: 7 });
    await settle();
    expect(sendReceipt.mock.calls[0][0]).toBe('admin@org.test');
    expect(sendReceipt.mock.calls[0][1]).toEqual(['pat@org.test']);
    expect(sendReceipt.mock.calls[0][2].requesterName).toBe('there');
  });

  it('marks the email as coming from an emailed request only when the source is email', async () => {
    await service().createRequest({ ...INPUT, requestedByUserId: 7, source: 'email' });
    await settle();
    expect(sendReceipt.mock.calls[0][2].viaEmail).toBe(true);

    sendReceipt.mockClear();
    await service().createRequest({ ...INPUT, requestedByUserId: 7, source: 'portal' });
    await settle();
    expect(sendReceipt.mock.calls[0][2].viaEmail).toBe(false);

    sendReceipt.mockClear();
    await service().createRequest({ ...INPUT, requestedByUserId: 7 });
    await settle();
    expect(sendReceipt.mock.calls[0][2].viaEmail).toBe(false);
  });

  it('shows the requested date stored on the request, as a calendar day', async () => {
    poolQuery.mockImplementation(async (sql: string) => {
      if (/FROM course_requests cr\s+LEFT JOIN class_types/.test(sql)) {
        return [[{ course_name: 'X', organization_name: 'Y', scheduled_date: new Date('2026-12-01T00:00:00Z') }]];
      }
      if (/FROM users\s+WHERE id = \?/.test(sql)) return [[{ email: 'sam@org.test', first_name: 'Sam', last_name: '', username: 'sam' }]];
      return [[]];
    });
    await service().createRequest({ ...INPUT, requestedByUserId: 7 });
    await settle();
    expect(sendReceipt.mock.calls[0][2].date).toBe('2026-12-01');
  });

  it("also copies the organization's contact email, once, and skips it if malformed", async () => {
    const setup = (contact: string | null) => poolQuery.mockImplementation(async (sql: string) => {
      if (/FROM course_requests cr\s+LEFT JOIN class_types/.test(sql)) return [[{ course_name: 'X', organization_name: 'Y', contact_email: contact }]];
      if (/FROM users\s+WHERE id = \?/.test(sql)) return [[{ email: 'sam@org.test', first_name: 'Sam', last_name: '', username: 'sam' }]];
      if (/role IN \('org_admin', 'organization'\)/.test(sql)) return [[{ id: 8, email: 'admin@org.test' }]];
      return [[]];
    });

    setup('Office@Org.test');
    await service().createRequest({ ...INPUT, requestedByUserId: 7 });
    await settle();
    expect(sendReceipt.mock.calls[0][1]).toEqual(['admin@org.test', 'Office@Org.test']);

    sendReceipt.mockClear();
    setup('ADMIN@org.test'); // same person as an admin: copied once
    await service().createRequest({ ...INPUT, requestedByUserId: 7 });
    await settle();
    expect(sendReceipt.mock.calls[0][1]).toEqual(['admin@org.test']);

    sendReceipt.mockClear();
    setup('SAM@org.test'); // same as the requester: not copied on their own email
    await service().createRequest({ ...INPUT, requestedByUserId: 7 });
    await settle();
    expect(sendReceipt.mock.calls[0][1]).toEqual(['admin@org.test']);

    sendReceipt.mockClear();
    setup('not an email');
    await service().createRequest({ ...INPUT, requestedByUserId: 7 });
    await settle();
    expect(sendReceipt.mock.calls[0][1]).toEqual(['admin@org.test']);
  });

  it('a lone admin who is the requester still gets the contact email copied', async () => {
    poolQuery.mockImplementation(async (sql: string) => {
      if (/FROM course_requests cr\s+LEFT JOIN class_types/.test(sql)) return [[{ course_name: 'X', organization_name: 'Y', contact_email: 'office@org.test' }]];
      if (/FROM users\s+WHERE id = \?/.test(sql)) return [[{ email: 'sam@org.test', first_name: 'Sam', last_name: '', username: 'sam' }]];
      if (/role IN \('org_admin', 'organization'\)/.test(sql)) return [[{ id: 7, email: 'sam@org.test' }]];
      return [[]];
    });
    await service().createRequest({ ...INPUT, requestedByUserId: 7 });
    await settle();
    expect(sendReceipt.mock.calls[0][0]).toBe('sam@org.test');
    expect(sendReceipt.mock.calls[0][1]).toEqual(['office@org.test']);
  });

  it('sends nothing when staff created the request (no requester)', async () => {
    await service().createRequest({ ...INPUT });
    await settle();
    expect(sendReceipt).not.toHaveBeenCalled();
  });

  it('a failing email never undoes the request', async () => {
    sendReceipt.mockRejectedValue(new Error('Resend is down'));
    const course = await service().createRequest({ ...INPUT, requestedByUserId: 7 });
    await settle();
    expect(course).toEqual({ id: 55 });
    expect(repoCreate).toHaveBeenCalledTimes(1);
  });
});
