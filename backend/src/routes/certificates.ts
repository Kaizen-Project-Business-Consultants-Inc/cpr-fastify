import { FastifyInstance } from 'fastify';
import { requireRole } from '../plugins/auth.js';
import { checkCertificate, generateClassSheet, loadCertificate } from '../services/CertificateService.js';
import { CertificatePDFService } from '../services/CertificatePDFService.js';

const STAFF_ROLES = ['admin', 'sysadmin', 'superadmin', 'courseadmin', 'accountant'];

export async function certificateRoutes(app: FastifyInstance) {
  // ===== Public: is this certificate genuine? =====
  // No sign-in, and rate-limited. It shows only the course, the dates and the
  // student's first name with a last initial.
  app.get('/verify/:number', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: {
      description: 'Check a certificate number. No authentication required.',
      tags: ['Certificates'],
    },
  }, async (request, reply) => {
    const { number } = request.params as { number: string };
    const result = await checkCertificate(number);
    if (!result) return reply.status(404).send({ error: 'Certificate not found' });
    return { success: true, data: result };
  });

  // ===== A whole class's certificates as one PDF, six to a page =====
  app.get('/class/:classId/sheet', {
    preHandler: [requireRole('organization', ...STAFF_ROLES)],
  }, async (request, reply) => {
    const { classId } = request.params as { classId: string };
    if (!/^\d+$/.test(classId)) return reply.status(404).send({ error: 'No certificates found for this class' });

    const sheet = await generateClassSheet(classId);
    // Same answer for "not yours" and "none issued"
    if (!sheet || (request.userRole === 'organization'
      && (!request.userOrgId || sheet.organization_id !== request.userOrgId))) {
      return reply.status(404).send({ error: 'No certificates found for this class' });
    }
    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="Certificates-${sheet.classDate}.pdf"`)
      .send(sheet.pdf);
  });

  // ===== A certificate as a PDF: the school it was issued through, or staff =====
  app.get('/:courseStudentId/pdf', {
    preHandler: [requireRole('organization', ...STAFF_ROLES)],
  }, async (request, reply) => {
    const { courseStudentId } = request.params as { courseStudentId: string };
    if (!/^\d+$/.test(courseStudentId)) return reply.status(404).send({ error: 'Certificate not found' });

    const certificate = await loadCertificate(courseStudentId);
    // Same answer for "not yours" and "does not exist"
    if (!certificate || (request.userRole === 'organization'
      && (!request.userOrgId || certificate.organization_id !== request.userOrgId))) {
      return reply.status(404).send({ error: 'Certificate not found' });
    }

    const pdf = await CertificatePDFService.generateCertificatePDF(certificate);
    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="Certificate-${certificate.certificate_number}.pdf"`)
      .send(pdf);
  });
}
