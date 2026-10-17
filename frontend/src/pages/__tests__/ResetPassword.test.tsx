import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mockPost = vi.fn();
vi.mock('../../services/api', () => ({
  api: { post: (...args: unknown[]) => mockPost(...args) },
}));

import ResetPassword from '../ResetPassword';

describe('ResetPassword', () => {
  afterEach(() => vi.restoreAllMocks());

  it('explains an expired link without logging the new password or the token', async () => {
    const consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map(m => vi.spyOn(console, m).mockImplementation(() => {}));
    // An axios error carries the request body: the new password and the reset token.
    mockPost.mockRejectedValueOnce({
      config: { data: JSON.stringify({ token: 'tok-123456', newPassword: 'N3w-Secret!' }) },
      response: { status: 400, data: { error: 'Validation failed', details: [{ field: 'token' }] } },
    });

    render(<MemoryRouter initialEntries={['/reset-password?token=tok-123456']}><ResetPassword /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText(/^new password/i, { selector: 'input' }), { target: { value: 'N3w-Secret!' } });
    fireEvent.change(screen.getByLabelText(/confirm new password/i, { selector: 'input' }), { target: { value: 'N3w-Secret!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reset Password' }));

    expect(await screen.findByText(/reset link is invalid or has expired/i)).toBeInTheDocument();
    const logged = consoleSpies.flatMap(spy => spy.mock.calls).map(args => JSON.stringify(args)).join(' ');
    expect(logged).not.toContain('N3w-Secret!');
    expect(logged).not.toContain('tok-123456');
  });
});
