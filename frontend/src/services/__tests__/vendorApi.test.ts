import { vendorApi } from '../api';

vi.mock('axios', () => ({
  default: {
    create: () => ({
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
      interceptors: {
        request: { use: vi.fn() },
        response: { use: vi.fn() },
      },
    }),
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
    expect(typeof vendorApi.getVendors).toBe('function');
  });
});
