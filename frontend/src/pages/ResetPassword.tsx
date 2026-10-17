import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Box,
  Button,
  Container,
  Typography,
  Paper,
  Alert,
  CircularProgress,
} from '@mui/material';
import { api } from '../services/api';
import PasswordField from '../components/common/PasswordField';


const ResetPassword = () => {
  const [searchParams] = useSearchParams();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const navigate = useNavigate();
  const token = searchParams.get('token');

  useEffect(() => {
    if (!token) {
      navigate('/forgot-password');
    }
  }, [token, navigate]);

  const validatePassword = (password: string): string | null => {
    if (password.length < 8) {
      return 'Password must be at least 8 characters long';
    }
    return null;
  };

  // Live hints, shown once the user has typed something.
  const tooShort = password.length > 0 && password.length < 8;
  const mismatch = confirmPassword.length > 0 && confirmPassword !== password;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate passwords
    const passwordError = validatePassword(password);
    if (passwordError) {
      setError(passwordError);
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (!token) {
      setError('Invalid reset token');
      return;
    }

    try {
      setError(null);
      setIsLoading(true);

      await api.post('/auth/reset-password', {
        token,
        newPassword: password,
      });

      setIsSuccess(true);

      // Redirect to login after 3 seconds
      setTimeout(() => {
        navigate('/login');
      }, 3000);
    } catch (err: unknown) {
      const errObj = err as { response?: { data?: { error?: string; details?: { field: string }[] } } };
      const data = errObj.response?.data;
      // The server's "Validation failed" means a bad or expired link (token) or a too-short password.
      if (data?.details?.some(d => d.field === 'token')) {
        setError('This reset link is invalid or has expired. Please request a new one.');
      } else if (data?.details?.some(d => d.field === 'newPassword')) {
        setError('Password must be at least 8 characters long');
      } else if (data?.error && data.error !== 'Validation failed') {
        setError(data.error);
      } else {
        setError('We couldn’t reset your password. Please request a new reset link and try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  if (!token) {
    return null; // Will redirect in useEffect
  }

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
            Reset Your Password
          </Typography>

          {error && (
            <Alert severity='error' sx={{ width: '100%', mb: 2 }}>
              {error}
            </Alert>
          )}

          {isSuccess ? (
            <Box sx={{ width: '100%', textAlign: 'center' }}>
              <Alert severity='success' sx={{ mb: 3 }}>
                Your password has been successfully reset!
              </Alert>
              <Typography variant='body1'>
                You will be redirected to the login page in a few seconds...
              </Typography>
            </Box>
          ) : (
            <Box
              component='form'
              onSubmit={handleSubmit}
              sx={{ width: '100%' }}
            >
              <Typography variant='body2' sx={{ mb: 3 }}>
                Enter your new password. It must be at least 8 characters long.
              </Typography>

              <PasswordField
                margin='normal'
                required
                fullWidth
                name='password'
                label='New Password'
                id='password'
                autoComplete='new-password'
                value={password}
                onChange={e => { setPassword(e.target.value); setError(null); }}
                disabled={isLoading}
                error={tooShort}
                helperText={tooShort ? 'Must be at least 8 characters' : ' '}
              />
              <PasswordField
                margin='normal'
                required
                fullWidth
                name='confirmPassword'
                label='Confirm New Password'
                id='confirmPassword'
                autoComplete='new-password'
                value={confirmPassword}
                onChange={e => { setConfirmPassword(e.target.value); setError(null); }}
                disabled={isLoading}
                error={mismatch}
                helperText={mismatch ? 'Passwords do not match' : confirmPassword ? 'Passwords match' : ' '}
                FormHelperTextProps={{ sx: { color: !mismatch && confirmPassword ? 'success.main' : undefined } }}
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
                  'Reset Password'
                )}
              </Button>
            </Box>
          )}
        </Paper>
      </Box>
    </Container>
  );
};

export default ResetPassword;
