import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';

// Course Admin → Email Requests: turn a held email into a request, or dismiss it.
const { mockQuery, mockAudit, repoMock, mockCreateRequest } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockAudit: vi.fn(),
  repoMock: { findOne: vi.fn(), transition: vi.fn(), findNeedsReview: vi.fn(), findHandled: vi.fn() },
  mockCreateRequest: vi.fn(),
}));

vi.mock('../config/database.js', () => ({ getPool: () => ({ query: mockQuery }) }));
vi.mock('../config/logger.js', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock('../config/env.js', () => ({ env: {} }));
vi.mock('../utils/auditLog.js', () => ({ logAudit: mockAudit }));
vi.mock('../plugins/auth.js', () => ({
  requireAuth: async () => {},
  requireRole: () => async (request: { userId: number }) => { request.userId = 1; },
}));
vi.mock('../repositories/InboundEmailRepository.js', () => ({
  InboundEmailRepository: vi.fn(() => repoMock),
}));
vi.mock('../services/CourseService.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/CourseService.js')>();
  return { ...actual, CourseService: vi.fn(() => ({ createRequest: mockCreateRequest })) };
});

import { inboundEmailRoutes } from '../routes/inbound-email.js';
import { errorHandler } from '../plugins/errorHandler.js';
import { CourseError } from '../services/CourseService.js';
import { env } from '../config/env.js';

const heldEmail = {
  id: 5, status: 'needs_review', subject: 'Course Request', reject_reason: 'Date (2026-09-01) is today or in the past',
};
const validBody = {
  organizationId: 1, courseTypeId: 2, scheduledDate: '2099-12-15', location: '400 University Ave', registeredStudents: 5,
};

describe('inbound email review routes', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    vi.clearAllMocks();
    mockQuery.mockResolvedValue([[{ id: 1 }]]); // organization and course exist
    app = Fastify();
    app.decorateRequest('userId', 0);
    app.setErrorHandler(errorHandler);
    await app.register(inboundEmailRoutes, { prefix: '/inbound-email' });
    await app.ready();
  });
  afterEach(() => app.close());

  it('creates the request, marks the email done and logs it', async () => {
    repoMock.findOne.mockResolvedValue(heldEmail);
    repoMock.transition.mockResolvedValue(true);
    mockCreateRequest.mockResolvedValue({ id: 40 });

    const res = await app.inject({ method: 'POST', url: '/inbound-email/5/create-request', payload: validBody });

    expect(res.statusCode).toBe(200);
    expect(mockCreateRequest).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: 1, courseTypeId: 2, scheduledDate: '2099-12-15', source: 'email',
      notes: 'Received by email — subject: "Course Request"',
    }));
    expect(repoMock.transition).toHaveBeenNthCalledWith(1, 5, 'needs_review', 'received');
    expect(repoMock.transition).toHaveBeenNthCalledWith(2, 5, 'received', 'created_request', { course_request_id: 40, handled_by: 1 });
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'inbound_email_request_created', entityId: 5 }));
  });

  it('tells the sender about the request only when they belong to the chosen organization', async () => {
    repoMock.transition.mockResolvedValue(true);
    mockCreateRequest.mockResolvedValue({ id: 40 });

    repoMock.findOne.mockResolvedValue({ ...heldEmail, matched_organization_id: 1, matched_user_id: 77 });
    await app.inject({ method: 'POST', url: '/inbound-email/5/create-request', payload: validBody });
    expect(mockCreateRequest).toHaveBeenLastCalledWith(expect.objectContaining({ requestedByUserId: 77 }));

    repoMock.findOne.mockResolvedValue({ ...heldEmail, matched_organization_id: 2, matched_user_id: 77 });
    await app.inject({ method: 'POST', url: '/inbound-email/5/create-request', payload: validBody });
    expect(mockCreateRequest).toHaveBeenLastCalledWith(expect.objectContaining({ requestedByUserId: null }));

    repoMock.findOne.mockResolvedValue({ ...heldEmail, matched_organization_id: null, matched_user_id: null });
    await app.inject({ method: 'POST', url: '/inbound-email/5/create-request', payload: validBody });
    expect(mockCreateRequest).toHaveBeenLastCalledWith(expect.objectContaining({ requestedByUserId: null }));
  });

  it('puts the email back on the list when the request is refused', async () => {
    repoMock.findOne.mockResolvedValue(heldEmail);
    repoMock.transition.mockResolvedValue(true);
    mockCreateRequest.mockRejectedValue(new CourseError('You already have a course request for this location on this date'));

    const res = await app.inject({ method: 'POST', url: '/inbound-email/5/create-request', payload: validBody });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/already have a course request/);
    expect(repoMock.transition).toHaveBeenLastCalledWith(5, 'received', 'needs_review');
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it('refuses a second click once someone else has handled it', async () => {
    repoMock.findOne.mockResolvedValue(heldEmail);
    repoMock.transition.mockResolvedValue(false);

    const res = await app.inject({ method: 'POST', url: '/inbound-email/5/create-request', payload: validBody });

    expect(res.statusCode).toBe(409);
    expect(mockCreateRequest).not.toHaveBeenCalled();
  });

  it('refuses an email that is already done', async () => {
    repoMock.findOne.mockResolvedValue({ ...heldEmail, status: 'created_request' });
    const res = await app.inject({ method: 'POST', url: '/inbound-email/5/create-request', payload: validBody });
    expect(res.statusCode).toBe(409);
    expect(repoMock.transition).not.toHaveBeenCalled();
  });

  it('checks the details before doing anything', async () => {
    const res = await app.inject({
      method: 'POST', url: '/inbound-email/5/create-request', payload: { ...validBody, registeredStudents: 0, scheduledDate: 'next week' },
    });
    expect(res.statusCode).toBe(400);
    expect(repoMock.findOne).not.toHaveBeenCalled();
  });

  it('refuses a date that has passed or does not exist', async () => {
    for (const scheduledDate of ['2020-01-01', '2099-02-31']) {
      const res = await app.inject({ method: 'POST', url: '/inbound-email/5/create-request', payload: { ...validBody, scheduledDate } });
      expect(res.statusCode).toBe(400);
    }
    expect(repoMock.findOne).not.toHaveBeenCalled();
  });

  it('refuses an organization that is not active', async () => {
    repoMock.findOne.mockResolvedValue(heldEmail);
    mockQuery.mockImplementation(async (sql: string) => (String(sql).includes('FROM organizations') ? [[]] : [[{ id: 2 }]]));
    const res = await app.inject({ method: 'POST', url: '/inbound-email/5/create-request', payload: validBody });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/active organization/);
    expect(repoMock.transition).not.toHaveBeenCalled();
  });

  it('still reports success when the request was made but the email could not be marked done', async () => {
    repoMock.findOne.mockResolvedValue(heldEmail);
    repoMock.transition.mockResolvedValueOnce(true).mockRejectedValueOnce(new Error('db hiccup'));
    mockCreateRequest.mockResolvedValue({ id: 41 });
    const res = await app.inject({ method: 'POST', url: '/inbound-email/5/create-request', payload: validBody });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ courseRequestId: 41 });
  });

  it('returns 404 for an unknown email', async () => {
    repoMock.findOne.mockResolvedValue(null);
    const res = await app.inject({ method: 'POST', url: '/inbound-email/99/dismiss', payload: {} });
    expect(res.statusCode).toBe(404);
  });

  it('dismisses with a note and keeps the old reason in the audit log', async () => {
    repoMock.findOne.mockResolvedValue(heldEmail);
    repoMock.transition.mockResolvedValue(true);

    const res = await app.inject({ method: 'POST', url: '/inbound-email/5/dismiss', payload: { note: '  Called the client  ' } });

    expect(res.statusCode).toBe(200);
    expect(repoMock.transition).toHaveBeenCalledWith(5, 'needs_review', 'rejected', { reject_reason: 'Dismissed: Called the client', handled_by: 1 });
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'inbound_email_dismissed', details: expect.objectContaining({ previousReason: heldEmail.reject_reason }),
    }));
  });

  it('lists handled emails', async () => {
    repoMock.findHandled.mockResolvedValue([{ id: 3, status: 'created_request', course_request_id: 34 }]);
    const res = await app.inject({ method: 'GET', url: '/inbound-email/handled' });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([{ id: 3, status: 'created_request', course_request_id: 34 }]);
  });

  it('lists organizations for an unrecognized sender', async () => {
    mockQuery.mockResolvedValue([[{ id: 1, name: 'Test Organization' }]]);
    const res = await app.inject({ method: 'GET', url: '/inbound-email/organizations' });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([{ id: 1, name: 'Test Organization' }]);
  });

  describe('webhook (raw body, after moving into its own scope)', () => {
    afterEach(() => { (env as Record<string, unknown>).RESEND_WEBHOOK_SECRET = undefined; });

    it('is off when no signing secret is set', async () => {
      const res = await app.inject({ method: 'POST', url: '/inbound-email/webhook', payload: { type: 'email.received' } });
      expect(res.statusCode).toBe(503);
    });

    it('rejects a request without a valid signature', async () => {
      (env as Record<string, unknown>).RESEND_WEBHOOK_SECRET = 'whsec_' + Buffer.from('test-secret').toString('base64');
      const res = await app.inject({
        method: 'POST', url: '/inbound-email/webhook', payload: { type: 'email.received' },
        headers: { 'svix-id': 'msg_1', 'svix-timestamp': String(Math.floor(Date.now() / 1000)), 'svix-signature': 'v1,bad' },
      });
      expect(res.statusCode).toBe(401);
      expect(repoMock.findOne).not.toHaveBeenCalled();
    });
  });
});
