import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../config/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { geocodeVenue } from '../services/GeocodeService.js';

describe('geocodeVenue', () => {
  const fetchMock = vi.fn();
  beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); });
  afterEach(() => vi.unstubAllGlobals());
  const reply = (body: unknown, ok = true) => fetchMock.mockResolvedValue({ ok, json: async () => body });

  it('returns the point for a street address', async () => {
    reply([{ lat: '43.85', lon: '-79.33', address: { house_number: '100', road: 'Main St' } }]);
    expect(await geocodeVenue('100 Main St, Markham')).toEqual({ lat: 43.85, lng: -79.33 });
    expect(fetchMock.mock.calls[0][1].headers['User-Agent']).toContain('GTACPR');
    expect(fetchMock.mock.calls[0][0]).toContain('q=100%20Main%20St%2C%20Markham');
    expect(fetchMock.mock.calls[0][0]).toMatch(/^https:\/\/nominatim\.openstreetmap\.org\/search\?/);
  });
  it('cannot be made to add parameters through the address', async () => {
    reply([]);
    await geocodeVenue('x&format=xml&limit=50#');
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url.match(/limit=/g)).toHaveLength(1);
    expect(url).toContain('q=x%26format%3Dxml%26limit%3D50%23');
  });
  it('ignores a result that is only a city', async () => {
    reply([{ lat: '43.85', lon: '-79.33', address: { city: 'Markham' } }]);
    expect(await geocodeVenue('markham')).toBeNull();
  });
  it('returns null for nothing found, an empty address, an error reply or a network failure', async () => {
    reply([]);
    expect(await geocodeVenue('nowhere')).toBeNull();
    expect(await geocodeVenue('   ')).toBeNull();
    reply({}, false);
    expect(await geocodeVenue('100 Main St')).toBeNull();
    fetchMock.mockRejectedValue(new Error('down'));
    expect(await geocodeVenue('100 Main St')).toBeNull();
  });
});
