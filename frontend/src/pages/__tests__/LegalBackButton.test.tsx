import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route, Link } from 'react-router-dom';
import LegalBackButton from '../LegalBackButton';

const app = (
  <Routes>
    <Route path="/" element={<div>Home</div>} />
    <Route path="/hr" element={<Link to="/privacy">Privacy</Link>} />
    <Route path="/privacy" element={<LegalBackButton />} />
  </Routes>
);

describe('LegalBackButton', () => {
  it('goes back to the page the visitor came from', () => {
    render(<MemoryRouter initialEntries={['/hr']}>{app}</MemoryRouter>);
    fireEvent.click(screen.getByText('Privacy'));
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('Privacy')).toBeInTheDocument(); // back on /hr
  });

  it('goes to the home route when the page was opened directly', () => {
    render(<MemoryRouter initialEntries={['/privacy']}>{app}</MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('Home')).toBeInTheDocument();
  });
});
