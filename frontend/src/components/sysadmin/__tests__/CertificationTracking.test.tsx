import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { render, screen } from '@testing-library/react';

const mockGet = vi.fn();
vi.mock('../../../services/api', () => ({
  sysAdminApi: { getCertificationStats: vi.fn().mockResolvedValue({ data: { data: null } }) },
  default: { get: (...args: unknown[]) => mockGet(...args) },
}));

import CertificationTracking from '../CertificationTracking';

// Certificates expire on the class day plus the validity period, stored as
// midnight and sent as UTC midnight. In Toronto that moment is the evening
// before, so the screen must show the calendar date as sent.
describe('CertificationTracking', () => {
  const originalTz = process.env.TZ;
  beforeAll(() => { process.env.TZ = 'America/Toronto'; });
  afterAll(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  it('shows the expiry day, not the evening before', async () => {
    mockGet.mockResolvedValue({
      data: {
        data: [{
          id: 1, first_name: 'Ava', last_name: 'Lee', organization_name: 'Test Organization',
          course_type_name: 'Basic First Aid', certificate_expires_at: '2028-10-21T00:00:00.000Z', days_until_expiry: 60,
        }],
        pagination: { page: 1, limit: 25, total: 1, pages: 1 },
      },
    });

    render(<CertificationTracking onShowSnackbar={vi.fn()} />);

    expect(await screen.findByText('Oct 21, 2028')).toBeInTheDocument();
    expect(screen.queryByText(/2028-10-20|10\/20\/2028|Oct 20/)).not.toBeInTheDocument();
  });
});
