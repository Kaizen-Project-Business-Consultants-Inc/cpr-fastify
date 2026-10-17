import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

// Mock the API modules
const mockGetAuditLogs = vi.fn();
const mockGetAuditLogStats = vi.fn();
const mockGet = vi.fn();

vi.mock('../../../services/api', () => ({
  sysAdminApi: {
    getAuditLogs: (...args: unknown[]) => mockGetAuditLogs(...args),
    getAuditLogStats: (...args: unknown[]) => mockGetAuditLogStats(...args),
  },
  default: { get: (...args: unknown[]) => mockGet(...args) },
}));

import AuditLogViewer from '../AuditLogViewer';

describe('AuditLogViewer', () => {
  const mockSnackbar = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: stats succeed, audit logs return empty
    mockGetAuditLogStats.mockResolvedValue({
      data: { totalEntries: 150, entriesToday: 12, uniqueUsers: 8 },
    });
    mockGetAuditLogs.mockResolvedValue({
      data: [],
      pagination: { page: 1, limit: 25, total: 0, pages: 0 },
    });
  });

  it('renders search bar placeholder', async () => {
    render(<AuditLogViewer onShowSnackbar={mockSnackbar} />);
    expect(screen.getByPlaceholderText('Search username, action, or details...')).toBeInTheDocument();
  });

  it('renders filter dropdowns', async () => {
    render(<AuditLogViewer onShowSnackbar={mockSnackbar} />);
    expect(screen.getByLabelText('Action')).toBeInTheDocument();
    expect(screen.getByLabelText('Entity Type')).toBeInTheDocument();
  });

  it('filters to all money activity from the Entity Type menu', async () => {
    render(<AuditLogViewer onShowSnackbar={mockSnackbar} />);
    fireEvent.mouseDown(screen.getByLabelText('Entity Type'));
    fireEvent.click(await screen.findByRole('option', { name: 'All money activity' }));

    await waitFor(() => {
      expect(mockGetAuditLogs).toHaveBeenLastCalledWith(expect.objectContaining({ entity_type: 'money' }));
    });
  });

  it('renders Export CSV button', async () => {
    render(<AuditLogViewer onShowSnackbar={mockSnackbar} />);
    expect(screen.getByText('Export CSV')).toBeInTheDocument();
  });

  it('shows stat cards when stats load', async () => {
    render(<AuditLogViewer onShowSnackbar={mockSnackbar} />);
    await waitFor(() => {
      expect(screen.getByText('Total Entries')).toBeInTheDocument();
      expect(screen.getByText('150')).toBeInTheDocument();
      expect(screen.getByText("Today's Entries")).toBeInTheDocument();
      expect(screen.getByText('12')).toBeInTheDocument();
      expect(screen.getByText('Unique Users')).toBeInTheDocument();
      expect(screen.getByText('8')).toBeInTheDocument();
    });
  });

  it('renders empty message when no entries', async () => {
    render(<AuditLogViewer onShowSnackbar={mockSnackbar} />);
    await waitFor(() => {
      expect(screen.getByText('No audit log entries found.')).toBeInTheDocument();
    });
  });

  it('calls getAuditLogs on mount', async () => {
    render(<AuditLogViewer onShowSnackbar={mockSnackbar} />);
    await waitFor(() => {
      expect(mockGetAuditLogs).toHaveBeenCalled();
    });
  });

  it('calls getAuditLogStats on mount', async () => {
    render(<AuditLogViewer onShowSnackbar={mockSnackbar} />);
    await waitFor(() => {
      expect(mockGetAuditLogStats).toHaveBeenCalled();
    });
  });

  it('handles stats API failure gracefully', async () => {
    mockGetAuditLogStats.mockRejectedValue(new Error('Network error'));
    render(<AuditLogViewer onShowSnackbar={mockSnackbar} />);
    // Should not crash; stats section simply won't render
    await waitFor(() => {
      expect(screen.queryByText('Total Entries')).not.toBeInTheDocument();
    });
  });

  it('renders date filter inputs', async () => {
    render(<AuditLogViewer onShowSnackbar={mockSnackbar} />);
    expect(screen.getByLabelText('From')).toBeInTheDocument();
    expect(screen.getByLabelText('To')).toBeInTheDocument();
  });
});
