import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import UpdateNotice from '../UpdateNotice';

const page = (hash: string) => `<html><script type="module" crossorigin src="/assets/index-${hash}.js"></script></html>`;

describe('UpdateNotice', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    document.head.innerHTML = '<script type="module" src="/assets/index-OLD.js"></script>';
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.head.innerHTML = '';
  });

  const tick = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60 * 1000); }); };

  it('stays quiet while the server still serves the same version', async () => {
    fetchMock.mockResolvedValue({ ok: true, text: async () => page('OLD') });
    render(<UpdateNotice />);
    await tick();
    expect(fetchMock).toHaveBeenCalled();
    expect(screen.queryByText(/new version is available/i)).toBeNull();
  });

  it('offers a refresh once the server serves a different version', async () => {
    fetchMock.mockResolvedValue({ ok: true, text: async () => page('NEW') });
    render(<UpdateNotice />);
    await tick();
    expect(screen.getByText(/new version is available/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
  });

  it('ignores a failed check', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    render(<UpdateNotice />);
    await tick();
    expect(screen.queryByText(/new version is available/i)).toBeNull();
  });

  it('does nothing on the dev server, where no hashed script is loaded', async () => {
    document.head.innerHTML = '<script type="module" src="/src/main.tsx"></script>';
    render(<UpdateNotice />);
    await tick();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
