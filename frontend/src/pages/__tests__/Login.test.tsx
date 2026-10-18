import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mockLogin = vi.fn();
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ login: mockLogin }),
}));

import Login from '../Login';

describe('Login', () => {
  afterEach(() => vi.restoreAllMocks());

  it('shows the server message on a failed login without logging the password', async () => {
    const consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map(m => vi.spyOn(console, m).mockImplementation(() => {}));
    // An axios error carries the request body, password included.
    mockLogin.mockRejectedValueOnce({
      config: { data: JSON.stringify({ username: 'admin', password: 'S3cret-pw!' }) },
      response: { status: 401, data: { error: 'Invalid username or password' } },
    });

    render(<MemoryRouter><Login /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText(/username/i), { target: { value: 'admin' } });
    fireEvent.change(screen.getByLabelText(/password/i, { selector: 'input' }), { target: { value: 'S3cret-pw!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    expect(await screen.findByText('Invalid username or password')).toBeInTheDocument();
    await waitFor(() => expect(mockLogin).toHaveBeenCalledWith('admin', 'S3cret-pw!'));
    const logged = consoleSpies.flatMap(spy => spy.mock.calls).map(args => JSON.stringify(args)).join(' ');
    expect(logged).not.toContain('S3cret-pw!');
  });

  it('offers new organizations a pre-filled course request email', () => {
    render(<MemoryRouter><Login /></MemoryRouter>);
    const href = screen.getByRole('link', { name: 'Request a course' }).getAttribute('href') ?? '';
    expect(href.startsWith('mailto:admin@kpbc.ca?subject=Course%20request&body=')).toBe(true);
    expect(decodeURIComponent(href.split('body=')[1])).toContain('Number of students:\r\nLocation:');
  });
});
