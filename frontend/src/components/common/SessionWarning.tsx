import React, { useState, useEffect } from 'react';
import {
  Alert,
  AlertTitle,
  Button,
  Snackbar,
  Box,
  Typography,
  LinearProgress,
} from '@mui/material';
import {
  Refresh as RefreshIcon,
  Schedule as ScheduleIcon,
} from '@mui/icons-material';
import { useAuth } from '../../contexts/AuthContext';

interface SessionWarningProps {
  showAtMinutes?: number; // Show warning when this many minutes remain
}

/** How often we re-read the clock while the warning is on screen. */
const COUNTDOWN_TICK_MS = 30000;

/** The countdown only ever shows whole minutes, so a 30 s tick is plenty. */
const formatRemaining = (ms: number): string => {
  if (ms >= 60000) {
    const minutes = Math.ceil(ms / 60000);
    return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  }
  return 'less than a minute';
};

const SessionWarning: React.FC<SessionWarningProps> = ({
  showAtMinutes = 5,
}) => {
  const { sessionStatus, refreshSession } = useAuth();
  const [showWarning, setShowWarning] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [remainingMs, setRemainingMs] = useState(0);

  useEffect(() => {
    // This effect synchronizes local countdown state with the external wall-clock
    // deadline derived from sessionStatus (an auth-context value, not render-derived
    // data). The setState calls below run in response to sessionStatus changing or
    // the timer firing, not on every render, so this is the intended
    // "subscribe/sync with an external system" case the rule allows for.
    if (
      !sessionStatus?.hasToken ||
      sessionStatus.isExpired ||
      !sessionStatus.timeUntilExpiry
    ) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShowWarning(false);
      setRemainingMs(0);
      return () => {};
    }

    // Anchor to a wall-clock deadline once, then sleep until something actually changes:
    // one timeout until the warning is due, and only then a slow tick while it counts down.
    const deadline = Date.now() + sessionStatus.timeUntilExpiry;
    const warnAt = deadline - showAtMinutes * 60000;
    let timer: ReturnType<typeof setTimeout>;

    const tick = () => {
      const now = Date.now();
      const remaining = deadline - now;

      if (remaining <= 0) {
        setShowWarning(false);
        setRemainingMs(0);
        return;
      }

      if (now < warnAt) {
        // Nothing to display yet — no re-renders until the warning is due.
        setShowWarning(false);
        timer = setTimeout(tick, warnAt - now);
        return;
      }

      setShowWarning(true);
      setRemainingMs(remaining);
      timer = setTimeout(tick, Math.min(COUNTDOWN_TICK_MS, remaining));
    };

    tick();

    return () => clearTimeout(timer);
  }, [sessionStatus, showAtMinutes]);

  const handleRefresh = async () => {
    try {
      setRefreshing(true);
      await refreshSession();
      setShowWarning(false);
    } catch (error) {
      console.error('Failed to refresh session:', error);
    } finally {
      setRefreshing(false);
    }
  };

  const handleClose = () => {
    setShowWarning(false);
  };

  if (!showWarning) return null;

  const getProgressValue = () => {
    // Assuming 15-minute session (900 seconds)
    const totalSessionTime = 15 * 60 * 1000;
    return Math.max(0, Math.min(100, (remainingMs / totalSessionTime) * 100));
  };

  const getSeverity = () => {
    const minutesRemaining = Math.floor(remainingMs / 60000);

    if (minutesRemaining <= 1) return 'error';
    if (minutesRemaining <= 2) return 'warning';
    return 'info';
  };

  return (
    <Snackbar
      open={showWarning}
      anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      sx={{
        zIndex: 9999,
        // Full width (minus a gutter) on phones, natural width from the tablet breakpoint up.
        left: { xs: 8, sm: 'auto' },
        right: { xs: 8, sm: 'auto' },
      }}
    >
      <Alert
        severity={getSeverity()}
        icon={<ScheduleIcon />}
        action={
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              flexWrap: 'wrap',
            }}
          >
            <Button
              color="inherit"
              size="small"
              onClick={handleRefresh}
              disabled={refreshing}
              startIcon={<RefreshIcon />}
            >
              {refreshing ? 'Refreshing...' : 'Extend Session'}
            </Button>
            <Button color="inherit" size="small" onClick={handleClose}>
              Dismiss
            </Button>
          </Box>
        }
        sx={{
          width: { xs: '100%', sm: 'auto' },
          minWidth: { xs: 0, sm: 400 },
          maxWidth: '100%',
          '& .MuiAlert-message': {
            width: '100%',
          },
          '& .MuiAlert-action': {
            alignItems: 'flex-start',
          },
        }}
      >
        <AlertTitle>Session Expiring Soon</AlertTitle>

        <Box sx={{ mt: 1 }}>
          <Typography variant="body2" gutterBottom>
            Your session will expire in{' '}
            <strong>{formatRemaining(remainingMs)}</strong>.
          </Typography>

          <Box sx={{ mt: 1, mb: 1 }}>
            <LinearProgress
              variant="determinate"
              value={getProgressValue()}
              color={getSeverity()}
              sx={{ height: 6, borderRadius: 3 }}
            />
          </Box>

          <Typography variant="caption" color="textSecondary">
            Click &quot;Extend Session&quot; to continue working without
            interruption.
          </Typography>
        </Box>
      </Alert>
    </Snackbar>
  );
};

export default SessionWarning;
