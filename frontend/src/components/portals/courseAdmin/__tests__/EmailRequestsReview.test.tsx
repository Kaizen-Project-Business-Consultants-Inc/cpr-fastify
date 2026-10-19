import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';

const { mockGet, mockPost } = vi.hoisted(() => ({ mockGet: vi.fn(), mockPost: vi.fn() }));

vi.mock('../../../../services/api', () => ({ default: { get: mockGet, post: mockPost } }));

import EmailRequestsReview from '../EmailRequestsReview';

const pastDateEmail = {
  id: 5,
  from_address: 'orguser@cpr.com',
  subject: 'Course Request (past date)',
  body_text: 'Course: CPR Basic\nDate: 2026-09-01\nStudents: 5\nLocation: 400 University Ave',
  status: 'needs_review',
  matched_organization_id: 1,
  reject_reason: 'Date (2026-09-01) is today or in the past',
  extracted: {
    courseTypeText: 'CPR Basic', scheduledDate: '2026-09-01', location: '400 University Ave', registeredStudents: 5,
    matchedCourseType: { id: 1, name: 'CPR Basic', confidence: 1 },
  },
  created_at: '2026-10-19T17:21:52Z',
};

const unknownSender = {
  ...pastDateEmail, id: 6, from_address: 'stranger@example.com', status: 'unmatched_sender',
  matched_organization_id: null, reject_reason: null, extracted: null, subject: 'Hello',
};

describe('EmailRequestsReview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockImplementation(async (url: string) => {
      if (url === '/inbound-email/needs-review') return { data: { data: [pastDateEmail, unknownSender] } };
      if (url === '/course-types') return { data: { data: [{ id: 1, name: 'CPR Basic', is_active: 1 }, { id: 2, name: 'CPR Advanced', is_active: 1 }, { id: 3, name: 'Retired Course', is_active: 0 }] } };
      if (url === '/inbound-email/organizations') return { data: { data: [{ id: 1, name: 'Test Organization' }] } };
      throw new Error(`unexpected ${url}`);
    });
  });

  it('shows the real reason for each email', async () => {
    render(<EmailRequestsReview />);
    expect(await screen.findByText('Date (2026-09-01) is today or in the past')).toBeInTheDocument();
    expect(screen.getByText('Sender email isn\'t linked to an organization account')).toBeInTheDocument();
  });

  it('opens the full email', async () => {
    render(<EmailRequestsReview />);
    fireEvent.click(await screen.findByRole('button', { name: 'Read email 5' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Students: 5/)).toBeInTheDocument();
  });

  it('pre-fills the request from the email, lets staff fix the date, and creates it', async () => {
    mockPost.mockResolvedValue({ data: { message: 'Course request #40 created.' } });
    render(<EmailRequestsReview />);
    fireEvent.click(await screen.findByRole('button', { name: 'Create request from email 5' }));

    const dialog = await screen.findByRole('dialog');
    const date = await within(dialog).findByLabelText('Date');
    expect(date).toHaveValue('2026-09-01');
    expect(within(dialog).getByLabelText('Location')).toHaveValue('400 University Ave');
    expect(within(dialog).getByLabelText('Number of students')).toHaveValue(5);

    expect(within(dialog).getByText('This date has passed. Pick a date from today on.')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Create request' })).toBeDisabled();

    fireEvent.change(date, { target: { value: '2099-12-15' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create request' }));

    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/inbound-email/5/create-request', {
      organizationId: 1, courseTypeId: 1, scheduledDate: '2099-12-15', location: '400 University Ave', registeredStudents: 5,
    }));
    expect(await screen.findByText('Course request #40 created.')).toBeInTheDocument();
  });

  it('asks for the organization when the sender is unknown', async () => {
    render(<EmailRequestsReview />);
    fireEvent.click(await screen.findByRole('button', { name: 'Create request from email 6' }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText(/Pick the organization this request is for/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Create request' })).toBeDisabled();
  });

  it('shows the server\'s reason when the request is refused', async () => {
    mockPost.mockRejectedValue({ response: { data: { error: 'You already have a course request for this location on this date' } } });
    render(<EmailRequestsReview />);
    fireEvent.click(await screen.findByRole('button', { name: 'Create request from email 5' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(await within(dialog).findByLabelText('Date'), { target: { value: '2099-12-15' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create request' }));
    expect(await within(dialog).findByText(/already have a course request/)).toBeInTheDocument();
  });

  it('dismisses with a note', async () => {
    mockPost.mockResolvedValue({ data: {} });
    render(<EmailRequestsReview />);
    fireEvent.click(await screen.findByRole('button', { name: 'Dismiss email 6' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Note (optional)'), { target: { value: ' Spam ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/inbound-email/6/dismiss', { note: 'Spam' }));
    expect(await screen.findByText('Email dismissed.')).toBeInTheDocument();
  });

  it('only offers courses we still run', async () => {
    render(<EmailRequestsReview />);
    fireEvent.click(await screen.findByRole('button', { name: 'Create request from email 5' }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByLabelText('Date');
    fireEvent.mouseDown(within(dialog).getByLabelText('Course'));
    expect(await screen.findByRole('option', { name: 'CPR Advanced' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Retired Course' })).not.toBeInTheDocument();
  });
});
