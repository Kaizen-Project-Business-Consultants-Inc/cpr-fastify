import { payRateService } from '../payRateService';
import { toOrganizationBody } from '../../components/sysadmin/organizationBody';

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

// The pay-rate routes take snake_case; the HR screen's forms are camelCase.
describe('payRateService request bodies', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    http.post.mockResolvedValue({ data: { data: {} } });
    http.put.mockResolvedValue({ data: { data: {} } });
  });

  it('creates a tier with base_hourly_rate and course_bonus', async () => {
    await payRateService.createTier({ name: 'Senior', description: 'd', baseHourlyRate: 42.5, courseBonus: 60 });
    expect(http.post).toHaveBeenCalledWith('/pay-rates/tiers', {
      name: 'Senior', description: 'd', base_hourly_rate: 42.5, course_bonus: 60,
    });
  });

  it('updates a tier, including is_active', async () => {
    await payRateService.updateTier(3, { baseHourlyRate: 40, isActive: false });
    expect(http.put).toHaveBeenCalledWith('/pay-rates/tiers/3', expect.objectContaining({ base_hourly_rate: 40, is_active: false }));
  });

  it('sends a bulk update in snake_case', async () => {
    await payRateService.bulkUpdateRates({
      instructorIds: [4, 5], hourlyRate: 30, courseBonus: 50, tierId: 2, effectiveDate: '2026-11-01', notes: 'n', changeReason: 'raise',
    });
    expect(http.post).toHaveBeenCalledWith('/pay-rates/bulk-update', {
      instructor_ids: [4, 5], hourly_rate: 30, course_bonus: 50, tier_id: 2, effective_date: '2026-11-01', notes: 'n', change_reason: 'raise',
    });
  });
});

describe('toOrganizationBody', () => {
  it('maps the organization form to the organizations columns', () => {
    expect(toOrganizationBody({
      name: ' Acme ', contactPerson: 'Jo Park', contactPosition: 'Owner', contactEmail: ' jo@acme.com ',
      contactPhone: '555', address: '1 Main St', city: 'Toronto', province: 'ON', postalCode: 'M1M 1M1',
      country: 'Canada', organizationComments: 'VIP',
    })).toEqual({
      name: 'Acme', contact_name: 'Jo Park', contact_position: 'Owner', contact_email: 'jo@acme.com',
      contact_phone: '555', address: '1 Main St', address_city: 'Toronto', address_province: 'ON',
      address_postal_code: 'M1M 1M1', country: 'Canada', organization_comments: 'VIP',
    });
  });
});
