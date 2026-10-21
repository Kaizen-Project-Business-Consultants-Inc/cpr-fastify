import { adminApi, emailTemplateApi, vendorApi } from '../api';

const { http } = vi.hoisted(() => ({
  http: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    interceptors: {
      request: { use: vi.fn() },
      response: { use: vi.fn() },
    },
  },
}));

vi.mock('axios', () => ({
  default: {
    create: () => http,
  },
}));

describe('Vendor API Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exports vendorApi with expected methods', () => {
    expect(typeof vendorApi.getDashboard).toBe('function');
    expect(typeof vendorApi.getProfile).toBe('function');
    expect(typeof vendorApi.updateProfile).toBe('function');
    expect(typeof vendorApi.getInvoices).toBe('function');
    expect(typeof vendorApi.uploadInvoice).toBe('function');
    expect(typeof vendorApi.downloadInvoice).toBe('function');
  });

  // There is no /admin/vendor-invoices/:id/download; the PDF route is the vendor
  // one, which lets staff download any invoice.
  it('Course Admin downloads a vendor invoice from the route that exists', async () => {
    http.get.mockResolvedValue({ data: new Blob() });
    await adminApi.downloadVendorInvoice(5);
    expect(http.get).toHaveBeenCalledWith('/vendor/invoices/5/download', { responseType: 'blob' });
  });

  // The server's testSendSchema only takes `to`.
  it('sends an email-template test to { to }', async () => {
    http.post.mockResolvedValue({ data: { success: true } });
    await emailTemplateApi.sendTest(1, 'a@b.com');
    expect(http.post).toHaveBeenCalledWith('/email-templates/1/test-send', { to: 'a@b.com' });
  });
});
