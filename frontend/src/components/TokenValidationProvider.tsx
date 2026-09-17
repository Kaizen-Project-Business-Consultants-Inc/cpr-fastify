import React, { useEffect, useState } from 'react';
import { Box, Alert, Button, Typography, Paper } from '@mui/material';
import { useAuth } from '../contexts/AuthContext';
import { tokenService } from '../services/tokenService';

interface TokenValidationProviderProps {
  children: React.ReactNode;
  showValidationUI?: boolean;
}

const TokenValidationProvider: React.FC<TokenValidationProviderProps> = ({
  children,
  showValidationUI = true
}) => {
  const { user, validateTokenOnPageLoad } = useAuth();
  const [validationState, setValidationState] = useState<{
    isValidating: boolean;
    isValid: boolean;
    error: string | null;
    lastValidated: Date | null;
  }>({
    isValidating: false,
    isValid: true,
    error: null,
    lastValidated: null
  });

  // Validate token on mount and when user changes - LESS AGGRESSIVE
  useEffect(() => {
    const performValidation = async () => {
      if (!user) return;

      // Don't validate if we're on login page (user might be in process of logging in)
      const currentPath = window.location.pathname;
      if (currentPath === '/login' || currentPath === '/logout') {
        setValidationState(prev => ({ ...prev, isValidating: false, error: null }));
        return;
      }

      // Don't validate if we already validated recently (within last 30 seconds)
      const now = new Date();
      const lastValidated = validationState.lastValidated;
      if (lastValidated && (now.getTime() - lastValidated.getTime()) < 30000) {
        return;
      }

      // Don't validate if there's no token (user might be logging out)
      const token = tokenService.getAccessToken();
      if (!token) {
        setValidationState(prev => ({ ...prev, isValidating: false, error: null }));
        return;
      }

      setValidationState(prev => ({ ...prev, isValidating: true, error: null }));

      try {
        const result = await validateTokenOnPageLoad();
        
        setValidationState({
          isValidating: false,
          isValid: result.isValid,
          error: result.error || null,
          lastValidated: new Date()
        });

        if (!result.isValid && result.requiresReauth) {
          tokenService.clearTokens();
          tokenService.clearSavedLocation();
          sessionStorage.removeItem('location_restoration_attempted');
        }
      } catch (err: any) {
        console.error('[TOKEN VALIDATION PROVIDER] Validation error:', err);
        setValidationState({
          isValidating: false,
          isValid: false,
          error: 'Token validation failed',
          lastValidated: new Date()
        });
      }
    };

    // Add a longer delay to allow for navigation to complete and reduce false positives
    const timeoutId = setTimeout(performValidation, 1000);
    return () => clearTimeout(timeoutId);
  }, [user, validateTokenOnPageLoad, validationState.lastValidated]);

  // Periodic validation (every 10 minutes instead of 5) - LESS FREQUENT
  useEffect(() => {
    if (!user) return () => {};

    const interval = setInterval(async () => {
      // Don't validate if there's no token (user might be logging out)
      const token = tokenService.getAccessToken();
      if (!token) {
        return;
      }

      const result = await validateTokenOnPageLoad();
      
      setValidationState(prev => ({
        ...prev,
        isValid: result.isValid,
        error: result.error || null,
        lastValidated: new Date()
      }));

      if (!result.isValid && result.requiresReauth) {
        tokenService.clearTokens();
        tokenService.clearSavedLocation();
        sessionStorage.removeItem('location_restoration_attempted');
      }
    }, 30 * 60 * 1000); // 30 minutes instead of 10

    return () => clearInterval(interval);
  }, [user, validateTokenOnPageLoad]);

  // Show validation error UI
  if (showValidationUI && validationState.error && !validationState.isValidating) {
    // Don't show error if we're on login page or if there's no token (normal logout)
    const currentPath = window.location.pathname;
    const token = tokenService.getAccessToken();
    
    if (currentPath === '/login' || currentPath === '/logout' || !token) {
      return null;
    }

    return (
      <Box
        display="flex"
        justifyContent="center"
        alignItems="center"
        minHeight="100vh"
        p={3}
        bgcolor="background.default"
      >
        <Paper
          elevation={3}
          sx={{
            p: 4,
            maxWidth: 600,
            textAlign: 'center'
          }}
        >
          <Typography variant="h5" color="error" gutterBottom>
            🔐 Authentication Issue Detected
          </Typography>
          
          <Alert severity="error" sx={{ mb: 3, textAlign: 'left' }}>
            <Typography variant="body1" gutterBottom>
              <strong>Problem:</strong> {validationState.error}
            </Typography>
            
            <Typography variant="body2" sx={{ mt: 1 }}>
              This typically happens when you have multiple browser tabs open with different user accounts.
              The system detected that your current token doesn't match the expected user for this page.
            </Typography>
          </Alert>

          <Box display="flex" flexDirection="column" gap={2}>
            <Button
              variant="contained"
              color="primary"
              size="large"
              onClick={() => {
                tokenService.clearTokens();
                window.location.href = '/login';
              }}
            >
              🔄 Log Out & Sign In Again
            </Button>
            
            <Button
              variant="outlined"
              size="small"
              onClick={() => {
                setValidationState(prev => ({ ...prev, error: null }));
                window.location.reload();
              }}
            >
              🔁 Try Again
            </Button>
          </Box>

          <Typography variant="caption" color="text.secondary" sx={{ mt: 3, display: 'block' }}>
            Last validated: {validationState.lastValidated?.toLocaleTimeString() || 'Never'}
          </Typography>
        </Paper>
      </Box>
    );
  }

  // Show loading during validation
  if (validationState.isValidating) {
    return (
      <Box
        display="flex"
        justifyContent="center"
        alignItems="center"
        minHeight="100vh"
      >
        <Box textAlign="center">
          <Typography variant="h6" gutterBottom>
            🔍 Validating Authentication...
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Checking your session and permissions
          </Typography>
        </Box>
      </Box>
    );
  }

  // Show children if validation passed or UI is disabled
  return <>{children}</>;
};

export default TokenValidationProvider; 