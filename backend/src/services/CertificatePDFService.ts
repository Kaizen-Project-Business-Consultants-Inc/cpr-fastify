import PDFDocument from 'pdfkit';

export interface CertificatePDFData {
  certificate_number: string;
  student_name: string;
  course_name: string;
  /** Calendar days, YYYY-MM-DD. */
  class_date: string;
  expires_on: string | null;
  instructor_name: string | null;
  verify_url: string;
}

const NAVY = '#12203b';
const RED = '#c62828';
const GRAY = '#666666';

/** "2026-10-27" → "October 27, 2026". Calendar days are formatted in UTC so the server's zone cannot shift them. */
function longDate(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return day;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

/** Builds certificate PDFs: one full certificate, or a sheet of small copies for filing. */
export class CertificatePDFService {
  /**
   * One landscape A4 page. The look is a placeholder until the owner's template
   * arrives; swapping it only means changing this file.
   */
  static async generateCertificatePDF(c: CertificatePDFData): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 0 });
        const chunks: Buffer[] = [];
        doc.on('data', (chunk) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        const W = doc.page.width;
        const H = doc.page.height;

        doc.rect(24, 24, W - 48, H - 48).lineWidth(3).strokeColor(NAVY).stroke();
        doc.rect(34, 34, W - 68, H - 68).lineWidth(1).strokeColor(RED).stroke();

        doc.font('Helvetica-Bold').fontSize(14).fillColor(RED)
          .text('GTA CPR TRAINING SERVICES', 0, 70, { align: 'center', characterSpacing: 2 });

        doc.font('Helvetica-Bold').fontSize(38).fillColor(NAVY)
          .text('Certificate of Completion', 0, 100, { align: 'center' });

        doc.font('Helvetica').fontSize(13).fillColor(GRAY)
          .text('This certifies that', 0, 170, { align: 'center' });

        doc.font('Helvetica-Bold').fontSize(34).fillColor('#000000')
          .text(c.student_name, 60, 198, { align: 'center', width: W - 120 });
        const nameBottom = doc.y;
        doc.moveTo(W / 2 - 170, nameBottom + 4).lineTo(W / 2 + 170, nameBottom + 4)
          .lineWidth(1).strokeColor(GRAY).stroke();

        doc.font('Helvetica').fontSize(13).fillColor(GRAY)
          .text('has successfully completed', 0, nameBottom + 18, { align: 'center' });

        doc.font('Helvetica-Bold').fontSize(24).fillColor(NAVY)
          .text(c.course_name, 60, nameBottom + 42, { align: 'center', width: W - 120 });
        const courseBottom = doc.y;

        const dates = c.expires_on
          ? `Completed ${longDate(c.class_date)}   |   Valid until ${longDate(c.expires_on)}`
          : `Completed ${longDate(c.class_date)}`;
        doc.font('Helvetica').fontSize(13).fillColor('#000000')
          .text(dates, 0, courseBottom + 14, { align: 'center' });

        const footY = H - 120;
        doc.font('Helvetica').fontSize(10).fillColor(GRAY);
        if (c.instructor_name) doc.text(`Instructor: ${c.instructor_name}`, 70, footY, { width: 300 });
        doc.text(`Certificate No. ${c.certificate_number}`, 70, footY + 16, { width: 300 });
        doc.text('Verify this certificate at', W - 370, footY, { width: 300, align: 'right' });
        doc.fillColor(NAVY).text(c.verify_url, W - 370, footY + 16, { width: 300, align: 'right' });

        doc.end();
      } catch (error) { reject(error); }
    });
  }

  /**
   * A record copy of a class's certificates, six to a page (two across, three
   * down) on A4 portrait, for filing or printing. Each is a small version of the
   * full certificate with the same number, so it can be checked the same way.
   */
  static async generateCertificateSheetPDF(certificates: CertificatePDFData[]): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ size: 'A4', layout: 'portrait', margin: 0 });
        const chunks: Buffer[] = [];
        doc.on('data', (chunk) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        const COLS = 2;
        const PER_PAGE = 6;
        const MARGIN = 28;
        const GAP = 14;
        const cellW = (doc.page.width - MARGIN * 2 - GAP) / COLS;
        const cellH = (doc.page.height - MARGIN * 2 - GAP * 2) / (PER_PAGE / COLS);

        certificates.forEach((c, i) => {
          if (i > 0 && i % PER_PAGE === 0) doc.addPage();
          const slot = i % PER_PAGE;
          const x = MARGIN + (slot % COLS) * (cellW + GAP);
          const y = MARGIN + Math.floor(slot / COLS) * (cellH + GAP);
          CertificatePDFService.drawMini(doc, c, x, y, cellW, cellH);
        });
        if (certificates.length === 0) doc.text('No certificates', MARGIN, MARGIN);

        doc.end();
      } catch (error) { reject(error); }
    });
  }

  /** Draws one small certificate inside the box at (x, y) of size w by h on the sheet. */
  private static drawMini(doc: PDFKit.PDFDocument, c: CertificatePDFData, x: number, y: number, w: number, h: number): void {
    const pad = 12;
    const inner = w - pad * 2;
    doc.rect(x, y, w, h).lineWidth(1.5).strokeColor(NAVY).stroke();
    doc.rect(x + 4, y + 4, w - 8, h - 8).lineWidth(0.5).strokeColor(RED).stroke();

    doc.font('Helvetica-Bold').fontSize(7).fillColor(RED)
      .text('GTA CPR TRAINING SERVICES', x + pad, y + 16, { width: inner, align: 'center', characterSpacing: 1 });
    doc.font('Helvetica-Bold').fontSize(13).fillColor(NAVY)
      .text('Certificate of Completion', x + pad, y + 30, { width: inner, align: 'center' });

    doc.font('Helvetica').fontSize(8).fillColor(GRAY)
      .text('This certifies that', x + pad, y + 58, { width: inner, align: 'center' });
    doc.font('Helvetica-Bold').fontSize(15).fillColor('#000000')
      .text(c.student_name, x + pad, y + 71, { width: inner, align: 'center', height: 36, ellipsis: true });
    doc.font('Helvetica').fontSize(8).fillColor(GRAY)
      .text('has successfully completed', x + pad, y + 110, { width: inner, align: 'center' });
    doc.font('Helvetica-Bold').fontSize(11).fillColor(NAVY)
      .text(c.course_name, x + pad, y + 123, { width: inner, align: 'center', height: 28, ellipsis: true });

    const dates = c.expires_on
      ? `Completed ${longDate(c.class_date)}  |  Valid until ${longDate(c.expires_on)}`
      : `Completed ${longDate(c.class_date)}`;
    doc.font('Helvetica').fontSize(7.5).fillColor('#000000')
      .text(dates, x + pad, y + 156, { width: inner, align: 'center' });

    doc.font('Helvetica').fontSize(7).fillColor(GRAY)
      .text(`Certificate No. ${c.certificate_number}`, x + pad, y + h - 38, { width: inner, align: 'center' });
    doc.fontSize(6.5).fillColor(NAVY)
      .text(c.verify_url, x + pad, y + h - 27, { width: inner, align: 'center', link: c.verify_url });
  }
}
