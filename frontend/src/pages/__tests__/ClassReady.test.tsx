import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const { mockPost } = vi.hoisted(() => ({ mockPost: vi.fn() }));
vi.mock('../../services/api', () => ({ api: { post: mockPost } }));

import ClassReady from '../ClassReady';

const page = (
  <MemoryRouter initialEntries={['/ready/12/abc']}>
    <Routes><Route path="/ready/:classId/:token" element={<ClassReady />} /></Routes>
  </MemoryRouter>
);

type Position = { coords: { latitude: number; longitude: number; accuracy: number } };
const fix = (accuracy: number): Position => ({ coords: { latitude: 43.8677, longitude: -79.2171, accuracy } });
const PAYLOAD = { data: { data: { courseName: 'CPR Advanced', date: '2026-10-28', startTime: '16:58' } } };

/** A phone's location service. Tests drive it after the page has asked, as a real phone does. */
function stubGeolocation() {
  const watches: Array<{ ok: (p: Position) => void; fail: (e: { code: number; PERMISSION_DENIED: number }) => void }> = [];
  const clearWatch = vi.fn();
  const watchPosition = vi.fn((ok, fail) => { watches.push({ ok, fail }); return watches.length; });
  Object.defineProperty(navigator, 'geolocation', { value: { watchPosition, clearWatch }, configurable: true });
  const latest = () => watches[watches.length - 1];
  return {
    clearWatch, watchPosition,
    reading: (accuracy: number) => act(() => latest().ok(fix(accuracy))),
    deny: () => act(() => latest().fail({ code: 1, PERMISSION_DENIED: 1 })),
  };
}

describe('ClassReady (public, behind the I\'m ready email button)', () => {
  beforeEach(() => { mockPost.mockReset(); });
  afterEach(() => { vi.useRealTimers(); });

  it('checks in as soon as the page opens, with no second button to tap', async () => {
    const geo = stubGeolocation();
    mockPost.mockResolvedValue(PAYLOAD);
    render(page);

    expect(screen.getByText('Finding your location…')).toBeInTheDocument();
    await geo.reading(9);

    expect(await screen.findByText(/You are marked as ready for CPR Advanced at 4:58 PM/)).toBeInTheDocument();
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockPost).toHaveBeenCalledWith('/class-reminders/ready', {
      classId: '12', token: 'abc', location: { lat: 43.8677, lng: -79.2171, accuracy: 9 },
    });
    expect(geo.clearWatch).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('under StrictMode (effects run twice) still sends exactly one check-in and leaves no listener behind', async () => {
    const geo = stubGeolocation();
    mockPost.mockResolvedValue(PAYLOAD);
    render(<React.StrictMode>{page}</React.StrictMode>);

    expect(geo.watchPosition).toHaveBeenCalledTimes(2);
    expect(geo.clearWatch).toHaveBeenCalledTimes(1); // the first, retired attempt
    await geo.reading(9);

    expect(await screen.findByText(/You are marked as ready/)).toBeInTheDocument();
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(geo.clearWatch).toHaveBeenCalledTimes(2);
  });

  it('says so when the person refuses location, sends nothing, stops listening, and offers Try again', async () => {
    const geo = stubGeolocation();
    render(page);
    await geo.deny();

    expect(await screen.findByText(/Location is blocked for this page/)).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
    expect(geo.clearWatch).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('a refusal after a poor reading still wins, and a late reading changes nothing', async () => {
    const geo = stubGeolocation();
    render(page);
    await geo.reading(400);
    await geo.deny();
    expect(await screen.findByText(/Location is blocked for this page/)).toBeInTheDocument();
    await geo.reading(5);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('shows the reason the server gives when the phone is too far away, and Try again sends a fresh check-in', async () => {
    const geo = stubGeolocation();
    mockPost
      .mockRejectedValueOnce({ response: { status: 422, data: { error: 'You are about 1.2 km from the venue. You can check in once you are within 300 m.' } } })
      .mockResolvedValueOnce(PAYLOAD);
    render(page);
    await geo.reading(12);

    expect(await screen.findByText(/about 1\.2 km from the venue/)).toBeInTheDocument();
    expect(mockPost.mock.calls[0][1]).toEqual({ classId: '12', token: 'abc', location: { lat: 43.8677, lng: -79.2171, accuracy: 12 } });

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(geo.watchPosition).toHaveBeenCalledTimes(2);
    await geo.reading(8);
    expect(await screen.findByText(/You are marked as ready/)).toBeInTheDocument();
    expect(mockPost).toHaveBeenCalledTimes(2);
  });

  it('keeps listening for a better reading, and sends the best one when the wait is over', async () => {
    vi.useFakeTimers();
    const geo = stubGeolocation();
    mockPost.mockResolvedValue(PAYLOAD);
    render(page);
    await geo.reading(400);
    await geo.reading(250);

    expect(mockPost).not.toHaveBeenCalled(); // not precise enough yet, still searching
    expect(screen.getByText('Finding your location…')).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(25_000));
    expect(mockPost).toHaveBeenCalledWith('/class-reminders/ready', expect.objectContaining({ location: expect.objectContaining({ accuracy: 250 }) }));
    expect(geo.clearWatch).toHaveBeenCalledTimes(1);
  });

  it('explains when no location arrives at all, and stops listening', async () => {
    vi.useFakeTimers();
    const geo = stubGeolocation();
    render(page);
    await act(() => vi.advanceTimersByTimeAsync(25_000));

    expect(screen.getByText(/We could not get your location/)).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
    expect(geo.clearWatch).toHaveBeenCalledTimes(1);
  });

  it('leaving the page while it is still looking stops the listener and the timer, and never checks in', async () => {
    vi.useFakeTimers();
    const geo = stubGeolocation();
    const view = render(page);
    await geo.reading(400); // a poor reading is waiting for something better
    view.unmount();

    expect(geo.clearWatch).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('says the link is not valid for a 404, with no Try again', async () => {
    const geo = stubGeolocation();
    mockPost.mockRejectedValue({ response: { status: 404 } });
    render(page);
    await geo.reading(9);

    expect(await screen.findByText(/This link is not valid/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('says so, with no Try again, on a device that cannot share a location', async () => {
    Object.defineProperty(navigator, 'geolocation', { value: undefined, configurable: true });
    // `'geolocation' in navigator` is still true for an own property, so remove it entirely
    delete (navigator as unknown as Record<string, unknown>).geolocation;
    render(page);

    expect(await screen.findByText(/cannot be used to check in/)).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });
});
