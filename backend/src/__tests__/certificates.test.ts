import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';

const { mockQuery, mockSend, mockSheet, auth } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockSend: vi.fn(),
  mockSheet: vi.fn(),
  auth: { role: 'organization', orgId: 5 as number | undefined },
}));

vi.mock('../config/database.js', () => ({ getPool: () => ({ query: mockQuery }) }));
vi.mock('../config/logger.js', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock('../config/env.js', () => ({ env: { FRONTEND_URL: 'https://example.test/' } }));
vi.mock('../services/EmailService.js', () => ({ emailService: { sendCertificateEmail: mockSend, sendCertificateSheetEmail: mockSheet } }));
vi.mock('../plugins/auth.js', () => ({
  requireAuth: async () => {},
  requireRole: () => async (request: { userId?: number; userRole?: string; userOrgId?: number }) => {
    request.userId = 9;
    request.userRole = auth.role;
    request.userOrgId = auth.orgId;
  },
}));

import { certificateRoutes } from '../routes/certificates.js';
import {
  assignCertificateNumbers, checkCertificate, emailCertificates, emailClassCertificateSheet, formatCertificateNumber, verifyUrl,
} from '../services/CertificateService.js';
import { migrations } from '../config/migrations.js';
import { CertificatePDFService } from '../services/CertificatePDFService.js';

const certRow = (over: Record<string, unknown> = {}) => ({
  id: 11, email: 'sam@example.com', first_name: 'Sam', last_name: 'Student', certificate_number: 'GTACPR-2026-000007',
  class_date: '2026-10-27', expires_on: '2028-10-27', organization_id: 5, course_name: 'CPR Basic', instructor_name: 'Coujoe Smith',
  ...over,
});

describe('certificate numbers', () => {
  it('formats the year and a six-digit sequence', () => {
    expect(formatCertificateNumber(2026, 7)).toBe('GTACPR-2026-000007');
    expect(formatCertificateNumber(2027, 1234567)).toBe('GTACPR-2027-1234567');
  });

  it('numbers each student without one, from the counter, oldest id first', async () => {
    const conn = { query: vi.fn() };
    conn.query
      .mockResolvedValueOnce([[{ id: 3, yr: 2026 }, { id: 4, yr: 2026 }]])
      .mockResolvedValueOnce([{}]).mockResolvedValueOnce([[{ n: 41 }]]).mockResolvedValueOnce([{}])
      .mockResolvedValueOnce([{}]).mockResolvedValueOnce([[{ n: 42 }]]).mockResolvedValueOnce([{}]);

    const ids = await assignCertificateNumbers(conn as never, { classId: 8 });

    expect(ids).toEqual([3, 4]);
    expect(String(conn.query.mock.calls[0][0])).toMatch(/certificate_number IS NULL[\s\S]*FOR UPDATE/);
    expect(conn.query.mock.calls[3]).toEqual(['UPDATE course_students SET certificate_number = ? WHERE id = ?', ['GTACPR-2026-000041', 3]]);
    expect(conn.query.mock.calls[6]).toEqual(['UPDATE course_students SET certificate_number = ? WHERE id = ?', ['GTACPR-2026-000042', 4]]);
  });

  it('does nothing when everyone already has a number', async () => {
    const conn = { query: vi.fn().mockResolvedValueOnce([[]]) };
    expect(await assignCertificateNumbers(conn as never, { studentId: 3 })).toEqual([]);
    expect(conn.query).toHaveBeenCalledTimes(1);
  });

  it('is part of the migrations, after the certificate dates one', () => {
    const m = migrations.find((x) => x.name === 'certificate_numbers');
    expect(m?.version).toBe(31);
  });
});

describe('public check', () => {
  beforeEach(() => mockQuery.mockReset());

  it('shows first name and last initial only', async () => {
    mockQuery.mockResolvedValueOnce([[{
      first_name: 'Sam', last_name: 'Student', certificate_number: 'GTACPR-2026-000007', course_name: 'CPR Basic',
      issued_on: '2026-10-27', expires_on: '2028-10-27', is_expired: 0,
    }]]);
    const res = await checkCertificate(' gtacpr-2026-000007 ');
    expect(res).toEqual({
      number: 'GTACPR-2026-000007', studentName: 'Sam S.', courseName: 'CPR Basic',
      issuedOn: '2026-10-27', expiresOn: '2028-10-27', status: 'valid',
    });
    expect(mockQuery.mock.calls[0][1]).toEqual(['GTACPR-2026-000007']);
  });

  it('says expired once past the expiry day', async () => {
    mockQuery.mockResolvedValueOnce([[{
      first_name: 'Sam', last_name: 'Student', certificate_number: 'GTACPR-2024-000001', course_name: 'CPR Basic',
      issued_on: '2024-01-05', expires_on: '2026-01-05', is_expired: 1,
    }]]);
    expect((await checkCertificate('GTACPR-2024-000001'))?.status).toBe('expired');
  });

  it('never queries for something that is not a certificate number', async () => {
    expect(await checkCertificate("x' OR 1=1 --")).toBeNull();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('builds the link without doubling slashes', () => {
    expect(verifyUrl('GTACPR-2026-000007')).toBe('https://example.test/verify/GTACPR-2026-000007');
    expect(verifyUrl()).toBe('https://example.test/verify');
  });
});

describe('certificate routes', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    mockQuery.mockReset();
    auth.role = 'organization';
    auth.orgId = 5;
    app = Fastify();
    await app.register(certificateRoutes, { prefix: '/certificates' });
    await app.ready();
  });
  afterEach(async () => { await app.close(); });

  it('verify answers 404 for an unknown number', async () => {
    mockQuery.mockResolvedValueOnce([[]]);
    const res = await app.inject({ method: 'GET', url: '/certificates/verify/GTACPR-2026-999999' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('Certificate not found');
  });

  it('verify answers with the check result', async () => {
    mockQuery.mockResolvedValueOnce([[{
      first_name: 'Sam', last_name: 'Student', certificate_number: 'GTACPR-2026-000007', course_name: 'CPR Basic',
      issued_on: '2026-10-27', expires_on: null, is_expired: 0,
    }]]);
    const res = await app.inject({ method: 'GET', url: '/certificates/verify/GTACPR-2026-000007' });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ studentName: 'Sam S.', status: 'valid', expiresOn: null });
  });

  it('gives the organization its own certificate as a PDF', async () => {
    mockQuery.mockResolvedValueOnce([[certRow()]]);
    const res = await app.inject({ method: 'GET', url: '/certificates/11/pdf' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toContain('Certificate-GTACPR-2026-000007.pdf');
    expect(res.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
  });

  it("will not give an organization another school's certificate", async () => {
    mockQuery.mockResolvedValueOnce([[certRow({ organization_id: 6 })]]);
    const res = await app.inject({ method: 'GET', url: '/certificates/11/pdf' });
    expect(res.statusCode).toBe(404);
  });

  it('lets staff download any certificate', async () => {
    auth.role = 'admin';
    auth.orgId = undefined;
    mockQuery.mockResolvedValueOnce([[certRow({ organization_id: 6 })]]);
    const res = await app.inject({ method: 'GET', url: '/certificates/11/pdf' });
    expect(res.statusCode).toBe(200);
  });

  it('answers 404 when there is no certificate yet', async () => {
    mockQuery.mockResolvedValueOnce([[]]);
    expect((await app.inject({ method: 'GET', url: '/certificates/11/pdf' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/certificates/abc/pdf' })).statusCode).toBe(404);
  });
});

describe('emailing certificates', () => {
  beforeEach(() => { mockQuery.mockReset(); mockSend.mockReset(); });

  it('sends the PDF once and keeps the claim', async () => {
    mockQuery.mockResolvedValueOnce([[certRow()]]).mockResolvedValueOnce([{ affectedRows: 1 }]);
    mockSend.mockResolvedValueOnce(true);
    await emailCertificates([11]);
    expect(mockSend).toHaveBeenCalledTimes(1);
    const [to, data, pdf] = mockSend.mock.calls[0];
    expect(to).toBe('sam@example.com');
    expect(data).toMatchObject({ studentName: 'Sam Student', certificateNumber: 'GTACPR-2026-000007', verifyUrl: 'https://example.test/verify/GTACPR-2026-000007' });
    expect(Buffer.isBuffer(pdf) && pdf.subarray(0, 4).toString()).toBe('%PDF');
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it('skips a student who has no usable email', async () => {
    mockQuery.mockResolvedValueOnce([[certRow({ email: 'not an email' })]]);
    await emailCertificates([11]);
    expect(mockSend).not.toHaveBeenCalled();
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('does not send twice when another run already claimed it', async () => {
    mockQuery.mockResolvedValueOnce([[certRow()]]).mockResolvedValueOnce([{ affectedRows: 0 }]);
    await emailCertificates([11]);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('releases the claim when the email fails, and never throws', async () => {
    mockQuery.mockResolvedValueOnce([[certRow()]]).mockResolvedValueOnce([{ affectedRows: 1 }]).mockResolvedValueOnce([{}]);
    mockSend.mockResolvedValueOnce(false);
    await expect(emailCertificates([11])).resolves.toBeUndefined();
    expect(String(mockQuery.mock.calls[2][0])).toContain('certificate_emailed_at = NULL');
  });

  it('keeps going after one student fails', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce([[certRow({ id: 12 })]]).mockResolvedValueOnce([{ affectedRows: 1 }]);
    mockSend.mockResolvedValueOnce(true);
    await emailCertificates([11, 12]);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });
});

const pageCount = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Type \/Page[^s]/g) ?? []).length;
const mini = (n: number) => ({
  certificate_number: `GTACPR-2026-${String(n).padStart(6, '0')}`, student_name: `Student ${n}`, course_name: 'CPR Basic',
  class_date: '2026-10-27', expires_on: '2028-10-27', instructor_name: null, verify_url: 'https://example.test/verify/x',
});

describe('class certificate sheet (six to a page)', () => {
  beforeEach(() => { mockQuery.mockReset(); mockSheet.mockReset(); });

  it('puts six certificates on a page', async () => {
    const six = await CertificatePDFService.generateCertificateSheetPDF([1, 2, 3, 4, 5, 6].map(mini));
    const seven = await CertificatePDFService.generateCertificateSheetPDF([1, 2, 3, 4, 5, 6, 7].map(mini));
    expect(six.subarray(0, 4).toString()).toBe('%PDF');
    expect(pageCount(six)).toBe(1);
    expect(pageCount(seven)).toBe(2);
  });

  const classIds = [[{ id: 11 }, { id: 12 }]];
  const queueClass = () => {
    mockQuery.mockResolvedValueOnce(classIds)
      .mockResolvedValueOnce([[certRow({ id: 11 })]]).mockResolvedValueOnce([[certRow({ id: 12, first_name: 'Ava' })]]);
  };

  it('emails the contact with the admins copied, once each, and drops bad addresses', async () => {
    queueClass();
    mockQuery
      .mockResolvedValueOnce([[{ name: 'Test Org', contact_email: 'Office@Example.com' }]])
      .mockResolvedValueOnce([[{ email: 'office@example.com' }, { email: 'boss@example.com' }, { email: 'bad address' }]]);
    mockSheet.mockResolvedValueOnce(true);

    expect(await emailClassCertificateSheet(8)).toBe(true);

    const [to, data, pdf, cc] = mockSheet.mock.calls[0];
    expect(to).toBe('Office@Example.com');
    expect(cc).toEqual(['boss@example.com']);
    expect(data).toMatchObject({ organizationName: 'Test Org', courseName: 'CPR Basic', classDate: '2026-10-27', count: 2 });
    expect(pageCount(pdf)).toBe(1);
  });

  it('falls back to an admin when the organization has no contact email', async () => {
    queueClass();
    mockQuery
      .mockResolvedValueOnce([[{ name: 'Test Org', contact_email: null }]])
      .mockResolvedValueOnce([[{ email: 'boss@example.com' }]]);
    mockSheet.mockResolvedValueOnce(true);
    await emailClassCertificateSheet(8);
    expect(mockSheet.mock.calls[0][0]).toBe('boss@example.com');
    expect(mockSheet.mock.calls[0][3]).toEqual([]);
  });

  it('sends nothing when nobody has a usable email, or no certificate was issued', async () => {
    queueClass();
    mockQuery.mockResolvedValueOnce([[{ name: 'Test Org', contact_email: '' }]]).mockResolvedValueOnce([[]]);
    expect(await emailClassCertificateSheet(8)).toBe(false);

    mockQuery.mockResolvedValueOnce([[]]);
    expect(await emailClassCertificateSheet(9)).toBe(false);
    expect(mockSheet).not.toHaveBeenCalled();
  });

  it('never throws when something fails', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'));
    await expect(emailClassCertificateSheet(8)).resolves.toBe(false);
  });
});

describe('class sheet download route', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    mockQuery.mockReset();
    auth.role = 'organization';
    auth.orgId = 5;
    app = Fastify();
    await app.register(certificateRoutes, { prefix: '/certificates' });
    await app.ready();
  });
  afterEach(async () => { await app.close(); });

  const queueClass = (orgId: number) => mockQuery
    .mockResolvedValueOnce([[{ id: 11 }]]).mockResolvedValueOnce([[certRow({ organization_id: orgId })]]);

  it('gives the organization its own class as a PDF', async () => {
    queueClass(5);
    const res = await app.inject({ method: 'GET', url: '/certificates/class/8/sheet' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toContain('Certificates-2026-10-27.pdf');
    expect(res.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
  });

  it("will not give an organization another school's class", async () => {
    queueClass(6);
    expect((await app.inject({ method: 'GET', url: '/certificates/class/8/sheet' })).statusCode).toBe(404);
  });

  it('lets staff download any class, and answers 404 when none were issued', async () => {
    auth.role = 'admin';
    auth.orgId = undefined;
    queueClass(6);
    expect((await app.inject({ method: 'GET', url: '/certificates/class/8/sheet' })).statusCode).toBe(200);
    mockQuery.mockResolvedValueOnce([[]]);
    expect((await app.inject({ method: 'GET', url: '/certificates/class/9/sheet' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/certificates/class/abc/sheet' })).statusCode).toBe(404);
  });
});
