import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockGet = vi.fn();
vi.mock('../../../../services/api', () => ({
  api: { get: (...args: unknown[]) => mockGet(...args) },
  default: { get: (...args: unknown[]) => mockGet(...args) },
}));
vi.mock('../../../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 6, organizationId: 3, role: 'organization' }, logout: vi.fn() }),
}));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));

const portalProps = vi.fn();
vi.mock('../OrganizationPortal', () => ({
  default: (props: { courses: unknown[] }) => {
    portalProps(props);
    return <div>portal</div>;
  },
}));

import OrganizationPortalContainer from '../OrganizationPortalContainer';

/** A row as GET /organization/courses sends it. */
const course = (id: number) => ({
  id, organization_id: 3, status: 'confirmed', courseTypeName: 'CPR Level C',
  scheduledDate: '2026-11-15T00:00:00.000Z', registeredStudents: 10,
});

describe('OrganizationPortalContainer', () => {
  beforeEach(() => vi.clearAllMocks());

  it('loads every page of courses so the Dashboard totals see them all', async () => {
    mockGet.mockImplementation((url: string, config?: { params?: { page?: number } }) => {
      if (url === '/organization/courses') {
        const page = config?.params?.page ?? 1;
        const rows = page === 1
          ? Array.from({ length: 100 }, (_, i) => course(i + 1))
          : Array.from({ length: 50 }, (_, i) => course(i + 101));
        return Promise.resolve({ data: { success: true, data: rows, pagination: { page, limit: 100, total: 150 } } });
      }
      return Promise.resolve({ data: { success: true, data: url.includes('invoices') && !url.includes('summary') ? { invoices: [] } : [] } });
    });

    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <OrganizationPortalContainer />
      </QueryClientProvider>
    );

    await waitFor(() => expect(portalProps).toHaveBeenCalled());
    const courseCalls = mockGet.mock.calls.filter(([url]) => url === '/organization/courses');
    expect(courseCalls).toHaveLength(2);
    expect(courseCalls.map(([, config]) => [config.params.page, config.params.limit])).toEqual([[1, 100], [2, 100]]);
    const { courses } = portalProps.mock.calls.at(-1)![0];
    expect(courses).toHaveLength(150);
    expect((courses as Array<{ id: number }>).at(-1)!.id).toBe(150);
  });
});
