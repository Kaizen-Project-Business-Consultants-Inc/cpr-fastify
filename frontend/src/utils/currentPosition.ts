/**
 * Asking the phone where it is, for the "I'm ready" check-in (the email page and the signed-in
 * Class Attendance screen both use it). The server decides whether the position is at the venue.
 */

export type Reading = { lat: number; lng: number; accuracy: number };
/** The phone's position, or why it could not give one (`final`: trying again cannot help). */
export type PositionResult = { position: Reading } | { problem: string; final?: boolean };

const DENIED = 'Location is blocked for this page. Allow location for this site in your browser or phone settings, then try again.';
const NO_FIX = 'We could not get your location. Turn on GPS (precise location), move outside if you can, then try again.';
const UNSUPPORTED = 'This device cannot share its location, so it cannot be used to check in. Please call the course admin.';

/** A reading this precise is used straight away; otherwise we keep listening for a better one. */
const GOOD_ENOUGH_M = 100;
/** The longest we wait for a GPS fix (the first fix on a phone can take a while). */
const WAIT_MS = 25_000;

/**
 * Listens for the phone's position. `cancel` stops everything (the location listener and the
 * wait timer) and settles the promise with null, for when the person leaves the page.
 */
export function currentPosition(): { promise: Promise<PositionResult | null>; cancel: () => void } {
  if (!('geolocation' in navigator)) {
    return { promise: Promise.resolve({ problem: UNSUPPORTED, final: true }), cancel: () => {} };
  }
  let cancel: () => void = () => {};
  const promise = new Promise<PositionResult | null>((resolve) => {
    let best: Reading | null = null;
    let done = false;
    // Our own timer ends the wait: browsers only start theirs after the permission question is answered
    const timer = setTimeout(() => finish(best ? { position: best } : { problem: NO_FIX }), WAIT_MS);
    const watchId = navigator.geolocation.watchPosition(
      (p) => {
        const reading = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy };
        if (!best || reading.accuracy < best.accuracy) best = reading;
        if (reading.accuracy <= GOOD_ENOUGH_M) finish({ position: reading });
      },
      (err) => {
        // Only a "no" ends it at once; other errors can clear while the GPS warms up
        if (err.code === err.PERMISSION_DENIED) finish({ problem: DENIED });
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 },
    );
    function finish(result: PositionResult | null) {
      if (done) return;
      done = true;
      navigator.geolocation.clearWatch(watchId);
      clearTimeout(timer);
      resolve(result);
    }
    cancel = () => finish(null);
  });
  return { promise, cancel: () => cancel() };
}
