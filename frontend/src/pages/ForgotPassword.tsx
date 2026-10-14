import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Button,
  Container,
  TextField,
  Typography,
  Paper,
  Alert,
  CircularProgress,
  Link,
} from '@mui/material';
import { ArrowBack as ArrowBackIcon } from '@mui/icons-material';
import { api } from '../services/api';


const ForgotPassword = () => {
  const [identifier, setIdentifier] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const value = identifier.trim();
    if (!value) {
      setError('Please enter your email address or username');
      return;
    }

    // Anything with an @ is treated as an email, everything else as a username
    const isEmail = value.includes('@');
    if (isEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      setError('Please enter a valid email address');
      return;
    }

    try {
      setError(null);
      setIsLoading(true);

      await api.post('/auth/forgot-password', isEmail ? { email: value } : { username: value });
      setIsSuccess(true);
    } catch (err) {
      const errObj = err as { response?: { status?: number; data?: { error?: string | { message?: string } } } };
      const data = errObj.response?.data?.error;
      const message = typeof data === 'object' ? data?.message : data;
      setError(
        errObj.response?.status === 429
          ? 'Too many attempts. Please wait a few minutes and try again.'
          : message && message !== 'Validation failed'
            ? message
            : 'We couldn’t send reset instructions. Please try again.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleBackToLogin = () => {
    navigate('/login');
  };

  return (
    <Container maxWidth='sm'>
      <Box
        sx={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          py: 4,
        }}
      >
        <Paper
          elevation={3}
          sx={{
            p: 4,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
          }}
        >
          <Typography component='h1' variant='h4' gutterBottom>
            CPR Training Portal
          </Typography>
          <Typography variant='h5' gutterBottom>
            Reset Password
          </Typography>

          {error && (
            <Alert severity='error' sx={{ width: '100%', mb: 2 }}>
              {error}
            </Alert>
          )}

          {isSuccess ? (
            <Box sx={{ width: '100%', textAlign: 'center' }}>
              <Alert severity='success' sx={{ mb: 3 }}>
                If an account matches, we’ve sent reset instructions to its email address.
              </Alert>
              <Typography variant='body1' paragraph>
                Please check your email for instructions on how to reset your
                password. If you don't receive the email within a few minutes,
                please check your spam folder.
              </Typography>
              <Button
                startIcon={<ArrowBackIcon />}
                onClick={handleBackToLogin}
                variant='outlined'
                sx={{ mt: 2 }}
              >
                Back to Login
              </Button>
            </Box>
          ) : (
            <>
              <Typography variant='body1' sx={{ mb: 3, textAlign: 'center' }}>
                Enter your email address or username and we'll send you
                instructions to reset your password.
              </Typography>

              <Box
                component='form'
                onSubmit={handleSubmit}
                sx={{ width: '100%' }}
              >
                <TextField
                  margin='normal'
                  required
                  fullWidth
                  id='identifier'
                  label='Email or username'
                  name='identifier'
                  autoComplete='username'
                  autoFocus
                  value={identifier}
                  onChange={e => setIdentifier(e.target.value)}
                  disabled={isLoading}
                  error={!!error && !identifier.trim()}
                />
                <Button
                  type='submit'
                  fullWidth
                  variant='contained'
                  sx={{ mt: 3, mb: 2, py: 1.5 }}
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <CircularProgress size={24} color='inherit' />
                  ) : (
                    'Send Reset Instructions'
                  )}
                </Button>
              </Box>

              <Box sx={{ mt: 2 }}>
                <Link
                  component='button'
                  variant='body2'
                  onClick={handleBackToLogin}
                  sx={{ display: 'flex', alignItems: 'center' }}
                >
                  <ArrowBackIcon sx={{ mr: 0.5 }} fontSize='small' />
                  Back to Login
                </Link>
              </Box>
            </>
          )}
        </Paper>

        <Typography
          variant='body2'
          color='text.secondary'
          align='center'
          sx={{ mt: 4 }}
        >
          Need help? Email <Link href='mailto:admin@kpbc.ca'>admin@kpbc.ca</Link>
        </Typography>
      </Box>
    </Container>
  );
};

export default ForgotPassword;
