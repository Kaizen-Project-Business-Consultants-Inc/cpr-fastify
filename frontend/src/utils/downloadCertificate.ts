import { api } from '../services/api';

function savePdf(blob: BlobPart, filename: string) {
  const url = window.URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  window.URL.revokeObjectURL(url);
}

/** Saves every certificate from a class as one PDF, six to a page. Returns false when it could not be fetched. */
export async function downloadClassCertificates(classId: number | string): Promise<boolean> {
  try {
    const response = await api.get(`/certificates/class/${classId}/sheet`, { responseType: 'blob' });
    savePdf(response.data, `Certificates-class-${classId}.pdf`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Saves a student's certificate PDF. `courseStudentId` is the roster row's own id
 * (not the student's). Returns false when the certificate could not be fetched.
 */
export async function downloadCertificate(courseStudentId: number | string, certificateNumber?: string | null): Promise<boolean> {
  try {
    const response = await api.get(`/certificates/${courseStudentId}/pdf`, { responseType: 'blob' });
    savePdf(response.data, `Certificate-${certificateNumber || courseStudentId}.pdf`);
    return true;
  } catch {
    return false;
  }
}
