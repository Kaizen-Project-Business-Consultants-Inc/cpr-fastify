import { logger } from '../config/logger.js';

export interface VenuePoint {
  lat: number;
  lng: number;
}

/**
 * Looks a class address up on OpenStreetMap's free Nominatim service (one lookup per
 * "I'm ready" tap, far under its 1-per-second limit). Returns null when the address is
 * not found, too general to check against (just a city name, no street), or the
 * service is down. Never throws.
 */
export async function geocodeVenue(address: string): Promise<VenuePoint | null> {
  const text = address.trim();
  if (!text) return null;
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&addressdetails=1&countrycodes=ca&q=${encodeURIComponent(text)}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'GTACPR-Training-Portal (admin@kpbc.ca)', Accept: 'application/json' },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const hits = (await res.json()) as Array<{ lat: string; lon: string; address?: Record<string, string> }>;
    const hit = hits[0];
    if (!hit) return null;
    // A bare "Markham" resolves to the middle of the city, which says nothing about the venue
    if (!hit.address?.house_number && !hit.address?.road) return null;
    const lat = Number(hit.lat), lng = Number(hit.lon);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  } catch (err) {
    logger.warn({ err }, 'Venue address lookup failed');
    return null;
  }
}
