import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PasswordField from '../PasswordField';

describe('PasswordField', () => {
  it('hides the password until the eye button is clicked', () => {
    render(<PasswordField label='New Password' value='secret123' onChange={() => {}} />);
    const input = screen.getByLabelText('New Password');
    expect(input).toHaveAttribute('type', 'password');

    fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(input).toHaveAttribute('type', 'text');

    fireEvent.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(input).toHaveAttribute('type', 'password');
  });
});
