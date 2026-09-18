import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

// The dashboard reaches the network through instructorApi (via the real
// instructorService react-query hooks), so that is the only thing we mock.
const mockGetClassesActive = vi.fn();
const mockGetClassesToday = vi.fn();
const mockGetClassesCompleted = vi.fn();
const mockGetAvailability = vi.fn();

vi.mock('../../../../services/api', () => {
  const api = {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  };
  return {
    api,
    default: api,
    instructorApi: {
      getClassesActive: (...args: unknown[]) => mockGetClassesActive(...args),
      getClassesToday: (...args: unknown[]) => mockGetClassesToday(...args),
      getClassesCompleted: (...args: unknown[]) => mockGetClassesCompleted(...args),
      getAvailability: (...args: unknown[]) => mockGetAvailability(...args),
    },
    adminApi: {},
  };
});

// instructorService gates every query on a logged-in user.
vi.mock('../../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 42, username: 'jdoe', firstName: 'Jane', role: 'instructor' },
    isAuthenticated: true,
  }),
}));

vi.mock('../../../../services/errorHandler', () => ({
  handleError: vi.fn(),
  errorHandler: { handleError: vi.fn() },
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => mockNavigate };
});

import { INSTRUCTOR_QUERY_KEYS } from '../../../../services/instructorService';
import InstructorDashboard from '../../../instructor/InstructorDashboard';

const FUTURE = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
const PAST = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

const activeClasses = [
  { id: 101, coursename: 'CPR Level C Recertification', date: FUTURE, studentcount: 17 },
];
const todayClasses = [
  { id: 202, coursetype: 'Standard First Aid', location: 'Etobicoke Depot', date: new Date().toISOString(), studentcount: 8 },
];
const completedClasses = [
  { id: 303, coursename: 'BLS Provider Renewal', date: PAST, studentcount: 9 },
];
const availability = [{ date: '2026-10-01' }, { date: '2026-10-02' }, { date: '2026-10-03' }];

const renderDashboard = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // Seed the cache so the dashboard renders with data on its first pass. The component
  // defaults each query to a fresh `[]` while it is pending, which makes its effect deps
  // change on every render - a loading-phase render loop that never settles in jsdom.
  client.setQueryData(INSTRUCTOR_QUERY_KEYS.classes, activeClasses);
  client.setQueryData(INSTRUCTOR_QUERY_KEYS.classesToday, todayClasses);
  client.setQueryData(INSTRUCTOR_QUERY_KEYS.classesCompleted, completedClasses);
  client.setQueryData(INSTRUCTOR_QUERY_KEYS.availability, availability);
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/instructor/dashboard']}>
        <InstructorDashboard />
      </MemoryRouter>
    </QueryClientProvider>
  );
};

describe('InstructorDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetClassesActive.mockResolvedValue({ data: { success: true, data: activeClasses } });
    mockGetClassesToday.mockResolvedValue({ data: { success: true, data: todayClasses } });
    mockGetClassesCompleted.mockResolvedValue({ data: { success: true, data: completedClasses } });
    mockGetAvailability.mockResolvedValue({ data: { success: true, data: availability } });
  });

  it('renders the stat cards from the fetched classes and availability', async () => {
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('Total Students')).toBeInTheDocument();
    });

    // 17 students on the one active class, 3 available dates — both come from the mock.
    expect(screen.getByText('17')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('Total Classes')).toBeInTheDocument();
    expect(screen.getByText('Available Dates')).toBeInTheDocument();
    // "Today's Classes" is both a stat-card label and the list heading below it.
    expect(screen.getAllByText("Today's Classes")).toHaveLength(2);
  });

  it('lists the upcoming and completed classes by name', async () => {
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('CPR Level C Recertification')).toBeInTheDocument();
    });
    expect(screen.getByText('BLS Provider Renewal')).toBeInTheDocument();
    expect(screen.getByText('Completed')).toBeInTheDocument();
    // Neither of the empty-state placeholders should be on screen.
    expect(screen.queryByText('No upcoming classes scheduled.')).not.toBeInTheDocument();
    expect(screen.queryByText('No completed classes yet.')).not.toBeInTheDocument();
  });

  it("renders today's class from the today endpoint", async () => {
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText(/Standard First Aid - Etobicoke Depot/)).toBeInTheDocument();
    });
    expect(screen.getByText('8 Students')).toBeInTheDocument();
  });

  it('navigates to the classes list when an upcoming class View link is clicked', async () => {
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('CPR Level C Recertification')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('View'));
    expect(mockNavigate).toHaveBeenCalledWith('/instructor/classes');
  });

  it('refetches the active classes from instructorApi on mount', async () => {
    renderDashboard();

    // useInstructorClasses is staleTime 0 / refetchOnMount, so it always hits the API.
    await waitFor(() => {
      expect(mockGetClassesActive).toHaveBeenCalled();
    });
  });
});
