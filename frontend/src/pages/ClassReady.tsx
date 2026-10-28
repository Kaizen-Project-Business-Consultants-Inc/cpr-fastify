import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Alert, Box, Button, CircularProgress, Container, Paper, Typography } from '@mui/material';
import { api } from '../services/api';

interface ReadyResult {
  courseName: string;
  date: string;
  startTime: string;
}

/** "09:30" → "9:30 AM" */
const clock = (value: string) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(value);
  if (!m) return value;
  const h = Number(m[1]);
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
};

type Reading = { lat: number; lng: number; accuracy: number };
/** The phone's position, or why it could not give one (`final`: trying again cannot help). */
type PositionResult = { position: Reading } | { problem: string; final?: boolean };

const DENIED = 'Location is blocked for this page. Allow location for this site in your browser or phone settings, then tap "Try again".';
const NO_FIX = 'We could not get your location. Turn on GPS (precise location), move outside if you can, then tap "Try again".';
const UNSUPPORTED = 'This device cannot share its location, so it cannot be used to check in. Please call the course admin.';

/** A reading this precise is used straight away; otherwise we keep listening for a better one. */
const GOOD_ENOUGH_M = 100;
/** The longest we wait for a GPS fix (the first fix on a phone can take a while). */
const WAIT_MS = 25_000;

/**
 * Listens for the phone's position. `cancel` stops everything (the location listener and the
 * wait timer) and settles the promise with null, for when the person leaves the page.
 */
function currentPosition(): { promise: Promise<PositionResult | null>; cancel: () => void } {
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

/**
 * Public page behind the "I'm ready" button in the instructor's reminder email.
 * Opening it checks the instructor in: it asks the phone for its location and sends it.
 * An email scanner that opens the link cannot check anyone in, because it cannot share a
 * location. The server accepts the check-in only when the phone is at the venue.
 */
const ClassReady: React.FC = () => {
  const { classId, token } = useParams<{ classId: string; token: string }>();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ReadyResult | null>(null);
  const [error, setError] = useState<{ message: string; canRetry: boolean } | null>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  // Which attempt is current, and how to stop its location wait. Leaving the page or trying
  // again retires the old attempt so it can neither keep the GPS on nor send a check-in.
  const attempt = useRef(0);
  const stopWaiting = useRef<() => void>(() => {});

  const checkIn = useCallback(async () => {
    const mine = ++attempt.current;
    stopWaiting.current();
    setLoading(true);
    setError(null);
    try {
      const lookup = currentPosition();
      stopWaiting.current = lookup.cancel;
      const found = await lookup.promise;
      if (mine !== attempt.current || !found) return; // left the page, or started over
      if ('problem' in found) {
        setError({ message: found.problem, canRetry: !found.final });
        return;
      }
      const res = await api.post('/class-reminders/ready', { classId, token, location: found.position });
      if (mine === attempt.current) setResult(res.data.data);
    } catch (err) {
      if (mine !== attempt.current) return;
      const response = (err as { response?: { status?: number; data?: { error?: string } } })?.response;
      if (response?.status === 404) {
        setError({ message: 'This link is not valid. Please sign in to the instructor portal, or contact the course admin.', canRetry: false });
      } else {
        setError({
          message: response?.status === 422 && response.data?.error
            ? response.data.error
            : 'We could not confirm this right now. Please try again in a moment.',
          canRetry: true,
        });
      }
    } finally {
      if (mine === attempt.current) setLoading(false);
    }
  }, [classId, token]);

  // Starts the check-in when the page opens (the phone's own permission question follows),
  // and retires it if the page is left first. Starting it sets state (external system sync), and the
  // cleanup deliberately reads the refs' latest values, so both lint rules are switched off here.
  /* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
  useEffect(() => {
    void checkIn();
    return () => {
      attempt.current++;
      stopWaiting.current();
    };
  }, [checkIn]);
  /* eslint-enable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */

  const tryAgain = () => {
    // The button disappears while checking, so move focus to the status line for keyboard and screen-reader users
    statusRef.current?.focus();
    void checkIn();
  };

  return (
    <Container maxWidth="sm" sx={{ py: 6 }}>
      <Paper elevation={2} sx={{ p: { xs: 3, md: 4 }, textAlign: 'center' }}>
        <Typography variant="h4" component="h1" gutterBottom>Ready for your class?</Typography>
        {result ? (
          <Alert severity="success" sx={{ textAlign: 'left' }}>
            Thank you. You are marked as ready for {result.courseName} at {clock(result.startTime)}.
          </Alert>
        ) : (
          <>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              You must be at the venue to check in. Please allow location when your phone asks. We only check how far you are from the class address and keep that distance, not your location.
            </Typography>
            <Box ref={statusRef} tabIndex={-1} role="status" aria-live="polite" sx={{ outline: 'none', mb: loading ? 2 : 0 }}>
              {loading && (
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.5, py: 1 }}>
                  <CircularProgress size={22} />
                  <Typography>Finding your location…</Typography>
                </Box>
              )}
            </Box>
            {error && <Alert severity="warning" sx={{ mb: 2, textAlign: 'left' }}>{error.message}</Alert>}
            {!loading && error?.canRetry && (
              <Box>
                <Button variant="contained" size="large" onClick={tryAgain}>Try again</Button>
              </Box>
            )}
          </>
        )}
      </Paper>
    </Container>
  );
};

export default ClassReady;
