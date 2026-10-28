import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Alert, Box, Button, CircularProgress, Container, Paper, TextField, Typography } from '@mui/material';
import { api } from '../services/api';

interface CertificateCheck {
  number: string;
  studentName: string;
  courseName: string;
  issuedOn: string;
  expiresOn: string | null;
  status: 'valid' | 'expired';
}

/** "2026-10-27" → "October 27, 2026", read as a calendar day so no time zone can shift it. */
const longDate = (day: string) => {
  const d = new Date(`${day}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? day : d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
};

/** Public page: anyone with a certificate number can check it. No sign-in. */
const VerifyCertificate: React.FC = () => {
  const { number: urlNumber } = useParams<{ number?: string }>();
  const navigate = useNavigate();
  const [input, setInput] = useState(urlNumber ?? '');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CertificateCheck | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // Looks the number in the address up (external API sync), so setState here is expected.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setResult(null);
    setMessage(null);
    if (!urlNumber) return;
    let cancelled = false;
    setInput(urlNumber);
    setLoading(true);
    (async () => {
      try {
        const res = await api.get(`/certificates/verify/${encodeURIComponent(urlNumber)}`);
        if (!cancelled) setResult(res.data.data);
      } catch (err) {
        if (cancelled) return;
        setMessage((err as { response?: { status?: number } })?.response?.status === 404
          ? 'No certificate was found with that number. Check the number and try again.'
          : 'We could not check this right now. Please try again in a moment.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [urlNumber]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const n = input.trim();
    if (n) navigate(`/verify/${encodeURIComponent(n)}`);
  };

  return (
    <Container maxWidth="sm" sx={{ py: 6 }}>
      <Paper elevation={2} sx={{ p: { xs: 3, md: 4 } }}>
        <Typography variant="h4" component="h1" gutterBottom>Check a certificate</Typography>
        <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
          Enter the certificate number printed on a GTA CPR Training Services certificate, for example GTACPR-2026-000123.
        </Typography>

        <Box component="form" onSubmit={submit} sx={{ display: 'flex', gap: 1.5, mb: 3 }}>
          <TextField
            fullWidth size="small" label="Certificate number" value={input}
            onChange={(e) => setInput(e.target.value)}
            inputProps={{ autoCapitalize: 'characters' }}
          />
          <Button type="submit" variant="contained" disabled={!input.trim() || loading}>Check</Button>
        </Box>

        {loading && <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}><CircularProgress size={28} /></Box>}
        {message && <Alert severity="warning">{message}</Alert>}
        {result && (
          <Alert severity={result.status === 'valid' ? 'success' : 'error'} sx={{ alignItems: 'flex-start' }}>
            <Typography sx={{ fontWeight: 700, mb: 1 }}>
              {result.status === 'valid' ? 'This certificate is valid' : 'This certificate has expired'}
            </Typography>
            <Typography variant="body2">Certificate number: {result.number}</Typography>
            <Typography variant="body2">Issued to: {result.studentName}</Typography>
            <Typography variant="body2">Course: {result.courseName}</Typography>
            <Typography variant="body2">Completed: {longDate(result.issuedOn)}</Typography>
            {result.expiresOn && (
              <Typography variant="body2">
                {result.status === 'valid' ? 'Valid until' : 'Expired on'}: {longDate(result.expiresOn)}
              </Typography>
            )}
          </Alert>
        )}
      </Paper>
    </Container>
  );
};

export default VerifyCertificate;
