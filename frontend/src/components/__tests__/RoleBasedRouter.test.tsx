import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const { authState } = vi.hoisted(() => ({
  authState: { user: null as null | { role: string }, loading: false, checkAuth: () => {} },
}));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => authState }));
vi.mock('../../services/tokenService', () => ({ tokenService: { getAccessToken: () => null } }));

import RoleBasedRouter from '../RoleBasedRouter';

const app = (
  <MemoryRouter initialEntries={['/']}>
    <Routes>
      <Route path="/" element={<RoleBasedRouter />} />
      <Route path="/login" element={<div>Login page</div>} />
      <Route path="/hr" element={<div>HR portal</div>} />
    </Routes>
  </MemoryRouter>
);

describe('RoleBasedRouter', () => {
  it('sends a signed-out visitor to the login page', async () => {
    authState.user = null;
    render(app);
    expect(await screen.findByText('Login page')).toBeInTheDocument();
  });

  it('sends a signed-in user to their own portal', async () => {
    authState.user = { role: 'hr' };
    render(app);
    expect(await screen.findByText('HR portal')).toBeInTheDocument();
  });
});
