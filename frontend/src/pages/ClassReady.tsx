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

/**
 * Public page behind the "I'm ready" button in the instructor's reminder email.
 * The click is a button here, not automatic on load, so an email scanner that
 * opens the link cannot mark the instructor ready.
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
      const res = await api.post('/class-reminders/ready', { classId, token });
      setResult(res.data.data);
    } catch (err) {
      setError((err as { response?: { status?: number } })?.response?.status === 404
        ? 'This link is not valid. Please sign in to the instructor portal, or contact the course admin.'
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
