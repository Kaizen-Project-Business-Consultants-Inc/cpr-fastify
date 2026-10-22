import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import ServiceDetailsTable from '../ServiceDetailsTable';

// The invoice screens get the class day as a DATE, which the server sends as
// UTC midnight. Read as a moment in Toronto that is the evening before, so the
// table must use the calendar date as sent (UAT 2026-10-21).
describe('ServiceDetailsTable', () => {
  const originalTz = process.env.TZ;
  beforeAll(() => { process.env.TZ = 'America/Toronto'; });
  afterAll(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  it('shows the class day, not the evening before', () => {
    render(
      <ServiceDetailsTable
        services={[{
          date: '2026-10-21T00:00:00.000Z', location: 'Room 1', course: 'Basic First Aid',
          students: 1, ratePerStudent: 50, baseCost: 50, tax: 6.5, total: 56.5,
        }]}
      />,
    );
    expect(screen.getByText('Oct 21, 2026')).toBeInTheDocument();
    expect(screen.queryByText(/Oct 20/)).not.toBeInTheDocument();
  });
});
