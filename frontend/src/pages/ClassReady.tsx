import React, { useState } from 'react';
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

/** Why the phone could not give its position, in words for the instructor. */
type PositionResult = { position: { lat: number; lng: number; accuracy: number } } | { problem: string };

const LOCATION_HELP = 'Location is needed to check in. Allow location access for this page in your browser or phone settings, then tap the button again.';

function currentPosition(): Promise<PositionResult> {
  if (!('geolocation' in navigator)) return Promise.resolve({ problem: 'This device cannot share its location, so it cannot be used to check in. Please call the course admin.' });
  // Browsers start the geolocation timeout only after the permission question is answered,
  // so a question left unanswered would wait forever. Our own timer ends the wait.
  const lookup = new Promise<PositionResult>((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ position: { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy } }),
      () => resolve({ problem: LOCATION_HELP }),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
    );
  });
  return Promise.race([lookup, new Promise<PositionResult>((resolve) => setTimeout(() => resolve({ problem: LOCATION_HELP }), 15_000))]);
}

/**
 * Public page behind the "I'm ready" button in the instructor's reminder email.
 * The click is a button here, not automatic on load, so an email scanner that
 * opens the link cannot check the instructor in.
 */
const ClassReady: React.FC = () => {
  const { classId, token } = useParams<{ classId: string; token: string }>();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ReadyResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setLoading(true);
    setError(null);
    try {
      const found = await currentPosition();
      if ('problem' in found) {
        setError(found.problem);
        return;
      }
      const res = await api.post('/class-reminders/ready', { classId, token, location: found.position });
      setResult(res.data.data);
    } catch (err) {
      const response = (err as { response?: { status?: number; data?: { error?: string } } })?.response;
      setError(response?.status === 404
        ? 'This link is not valid. Please sign in to the instructor portal, or contact the course admin.'
        : response?.status === 422 && response.data?.error
          ? response.data.error
          : 'We could not confirm this right now. Please try again in a moment.');
    } finally {
      setLoading(false);
    }
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
            <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
              Tap the button once you are at the class and set up.
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              You must be at the venue to check in. Your phone will ask to share its location: please allow it. We only check how far you are from the class address and keep that distance, not your location.
            </Typography>
            {error && <Alert severity="warning" sx={{ mb: 2, textAlign: 'left' }}>{error}</Alert>}
            <Box>
              <Button variant="contained" size="large" onClick={confirm} disabled={loading}>
                {loading ? <CircularProgress size={22} color="inherit" /> : "I'm ready"}
              </Button>
            </Box>
          </>
        )}
      </Paper>
    </Container>
  );
};

export default ClassReady;
