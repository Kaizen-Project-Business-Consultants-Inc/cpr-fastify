import React, { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
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
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
} from '@mui/material';
import {
  CheckCircle,
  Info,
  Lock,
  Person,
} from '@mui/icons-material';
import { useAuth } from '../contexts/AuthContext';
import PasswordField from '../components/common/PasswordField';

// Staging is a copy of the real site; say so on screen so nobody mistakes it for production.
const IS_STAGING = /stag/i.test(window.location.hostname);


const Login = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const { login } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);

    // Catch empty fields here instead of letting the server answer "Validation failed"
    if (!username.trim() || !password) {
      setError(null);
      setErrorCode(null);
      setSuggestions([]);
      return;
    }

    setIsLoading(true);
    // DO NOT clear error on submit - let it stay visible

    try {
      const trimmedUsername = username.trim();

      await login(trimmedUsername, password);
      // Only clear error on successful login
      setError(null);
      setErrorCode(null);
      setSuggestions([]);
    } catch (err: unknown) {
      const errObj = err as { response?: { data?: { error?: string | { message?: string; retryAfter?: string; code?: string }; code?: string; suggestions?: string[] }; status?: number } };

      const errorData = errObj.response?.data;
      let errorMessage = 'Failed to login. Please check your credentials.';

      if (typeof errorData?.error === 'object') {
        errorMessage = (errorData.error as { message?: string }).message ?? errorMessage;
        if ((errorData.error as { retryAfter?: string }).retryAfter) {
          errorMessage += ` Try again in ${(errorData.error as { retryAfter?: string }).retryAfter}.`;
        }
      } else if (typeof errorData?.error === 'string') {
        errorMessage = errorData.error;
      }

      setError(errorMessage);
      const errorObj = errorData?.error as { code?: string } | undefined;
      setErrorCode(errorData?.code || errorObj?.code || null);
      setSuggestions(errorData?.suggestions || []);
    } finally {
      setIsLoading(false);
    }
  };

  const getErrorIcon = () => {
    switch (errorCode) {
      case 'USER_NOT_FOUND':
        return <Person color="error" />;
      case 'INVALID_PASSWORD':
        return <Lock color="error" />;
      default:
        return <Info color="error" />;
    }
  };

  const clearError = () => {
    setError(null);
    setErrorCode(null);
    setSuggestions([]);
  };

  return (
    <Container component='main' maxWidth='xs'>
      <Box
        sx={{
          marginTop: 8,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        <Paper
          elevation={3}
          sx={{
            padding: 4,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            width: '100%',
          }}
        >
          {IS_STAGING && (
            <Alert severity='warning' sx={{ mb: 2, width: '100%' }}>
              <strong>Staging (test) site.</strong> Changes here are not real.
            </Alert>
          )}
          <Box component='img' src='/favicon.svg' alt='' sx={{ width: 48, height: 48, mb: 1.5 }} />
          <Typography component='h1' variant='h5' align='center' gutterBottom>
            CPR Training Portal
          </Typography>
          <Typography variant='body2' color='text.secondary' align='center' sx={{ mb: 1 }}>
            Book courses, track certifications and manage invoices.
          </Typography>

          {error && (
            <Alert
              severity='error'
              sx={{
                mb: 2,
                width: '100%',
                '& .MuiAlert-message': {
                  width: '100%'
                }
              }}
              icon={getErrorIcon()}
              onClose={clearError}
            >
              <Typography variant="body1" sx={{ mb: 1, fontWeight: 'bold' }}>
                {error}
              </Typography>
              {suggestions.length > 0 && (
                <List dense sx={{ py: 0, mt: 1 }}>
                  {suggestions.map((suggestion, index) => (
                    <ListItem key={index} sx={{ py: 0.5 }}>
                      <ListItemIcon sx={{ minWidth: 24 }}>
                        <CheckCircle fontSize="small" color="primary" />
                      </ListItemIcon>
                      <ListItemText
                        primary={suggestion}
                        primaryTypographyProps={{ variant: 'body2' }}
                      />
                    </ListItem>
                  ))}
                </List>
              )}
            </Alert>
          )}

          <Box component='form' onSubmit={handleSubmit} sx={{ mt: 1, width: '100%' }} noValidate>
            <TextField
              margin='normal'
              required
              fullWidth
              id='username'
              label='Username'
              name='username'
              autoComplete='username'
              autoFocus
              value={username}
              onChange={e => {
                setUsername(e.target.value);
                // DO NOT clear error when typing - keep it visible
              }}
              disabled={isLoading}
              error={submitted && !username.trim()}
              helperText={submitted && !username.trim() ? 'Enter your username' : ''}
              sx={{
                '& .MuiInputLabel-root': {
                  fontFamily: 'inherit',
                  fontSize: '1rem',
                  lineHeight: 1.5,
                  letterSpacing: 'normal'
                },
                '& .MuiInputBase-input': {
                  fontFamily: 'inherit',
                  fontSize: '1rem',
                  lineHeight: 1.5,
                  letterSpacing: 'normal'
                },
                '& .MuiFormHelperText-root': {
                  color: 'error.main',
                  fontSize: '0.75rem',
                  marginTop: '4px'
                }
              }}
            />
            <PasswordField
              margin='normal'
              required
              fullWidth
              name='password'
              label='Password'
              id='password'
              autoComplete='current-password'
              value={password}
              onChange={e => {
                setPassword(e.target.value);
                // DO NOT clear error when typing - keep it visible
              }}
              disabled={isLoading}
              error={submitted && !password}
              helperText={submitted && !password ? 'Enter your password' : ''}
              sx={{
                '& .MuiInputLabel-root': {
                  fontFamily: 'inherit',
                  fontSize: '1rem',
                  lineHeight: 1.5,
                  letterSpacing: 'normal'
                },
                '& .MuiInputBase-input': {
                  fontFamily: 'inherit',
                  fontSize: '1rem',
                  lineHeight: 1.5,
                  letterSpacing: 'normal',
                  '&[type="password"]': {
                    fontFamily: 'monospace',
                    letterSpacing: '0.125em'
                  }
                },
                '& .MuiFormHelperText-root': {
                  color: 'error.main',
                  fontSize: '0.75rem',
                  marginTop: '4px'
                },
                '& .MuiInputBase-root': {
                  backgroundColor: 'background.paper'
                }
              }}
            />
            <Button
              type='submit'
              fullWidth
              variant='contained'
              sx={{ mt: 3, mb: 2 }}
              disabled={isLoading}
            >
              {isLoading ? <CircularProgress size={24} /> : 'Sign In'}
            </Button>

            <Box sx={{ textAlign: 'center', mt: 2 }}>
              <Link
                component={RouterLink}
                to="/forgot-password"
                variant="body2"
                sx={{ display: 'inline-block', py: 1.25, px: 1 }}
              >
                Forgot password?
              </Link>
            </Box>
          </Box>
        </Paper>
      </Box>

      <Box sx={{ mt: 3, textAlign: 'center' }}>
        <Typography variant="caption" color="text.secondary">
          By using this service you agree to our{' '}
          <Link component={RouterLink} to="/terms" color="inherit">
            Terms of Service
          </Link>
          {' '}and{' '}
          <Link component={RouterLink} to="/privacy" color="inherit">
            Privacy Policy
          </Link>
        </Typography>
      </Box>
    </Container>
  );
};

export default Login;
