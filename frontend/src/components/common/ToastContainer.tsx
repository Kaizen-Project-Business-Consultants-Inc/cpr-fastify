import React, { useState, useEffect } from 'react';
import {
  Box,
  Alert,
  AlertTitle,
  IconButton,
  Button,
  LinearProgress,
  Slide,
  Fade,
  CircularProgress,
  Typography,
} from '@mui/material';
import {
  Close as CloseIcon,
  CheckCircle as SuccessIcon,
  Error as ErrorIcon,
  Warning as WarningIcon,
  Info as InfoIcon,
} from '@mui/icons-material';
import { useToast, Toast, ToastPosition } from '../../contexts/ToastContext';

interface ToastItemProps {
  toast: Toast;
  onDismiss: (id: string) => void;
}

const ToastItem: React.FC<ToastItemProps> = ({ toast, onDismiss }) => {
  const [progress, setProgress] = useState(100);
  const [isVisible, setIsVisible] = useState(true);

  // Calculate progress for auto-dismissing toasts
  useEffect(() => {
    if (toast.duration && toast.duration > 0 && toast.showProgress) {
      const startTime = Date.now();
      const interval = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const remaining = Math.max(0, toast.duration! - elapsed);
        const progressValue = (remaining / toast.duration!) * 100;

        setProgress(progressValue);

        if (remaining <= 0) {
          clearInterval(interval);
        }
      }, 50);

      return () => clearInterval(interval);
    }
    return () => {};
  }, [toast.duration, toast.showProgress]);

  // Handle dismiss with animation
  const handleDismiss = () => {
    setIsVisible(false);
    setTimeout(() => {
      onDismiss(toast.id);
    }, 300); // Match animation duration
  };

  // Get appropriate severity for Alert component
  const getSeverity = (): 'success' | 'error' | 'warning' | 'info' => {
    switch (toast.type) {
      case 'success':
        return 'success';
      case 'error':
        return 'error';
      case 'warning':
        return 'warning';
      case 'loading':
      case 'info':
      default:
        return 'info';
    }
  };

  // Get appropriate icon
  const getIcon = () => {
    switch (toast.type) {
      case 'success':
        return <SuccessIcon />;
      case 'error':
        return <ErrorIcon />;
      case 'warning':
        return <WarningIcon />;
      case 'loading':
        return <CircularProgress size={20} />;
      case 'info':
      default:
        return <InfoIcon />;
    }
  };

  // Get priority styling
  const getPriorityStyles = () => {
    switch (toast.priority) {
      case 'critical':
        return {
          border: '2px solid',
          borderColor: 'error.main',
          boxShadow: '0 0 10px rgba(244, 67, 54, 0.3)',
        };
      case 'high':
        return {
          border: '1px solid',
          borderColor: 'warning.main',
        };
      default:
        return {};
    }
  };

  return (
    <Slide direction='left' in={isVisible} timeout={300}>
      <Box sx={{ mb: 1 }}>
        <Alert
          severity={getSeverity()}
          icon={getIcon()}
          sx={{
            minWidth: 300,
            maxWidth: 500,
            ...getPriorityStyles(),
            '& .MuiAlert-message': {
              width: '100%',
            },
          }}
          action={
            toast.dismissible && (
              <IconButton
                size='small'
                onClick={handleDismiss}
                sx={{ color: 'inherit' }}
              >
                <CloseIcon fontSize='small' />
              </IconButton>
            )
          }
        >
          {toast.title && (
            <AlertTitle>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                {toast.title}
                {toast.priority === 'critical' && (
                  <Typography
                    variant='caption'
                    sx={{
                      bgcolor: 'error.main',
                      color: 'error.contrastText',
                      px: 1,
                      borderRadius: 1,
                      fontSize: '0.7rem',
                    }}
                  >
                    CRITICAL
                  </Typography>
                )}
              </Box>
            </AlertTitle>
          )}

          <Typography variant='body2'>{toast.message}</Typography>

          {/* Actions */}
          {toast.actions && toast.actions.length > 0 && (
            <Box sx={{ mt: 1, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              {toast.actions.map((action, index) => (
                <Button
                  key={index}
                  size='small'
                  variant={action.variant || 'outlined'}
                  color={action.color || 'primary'}
                  onClick={action.onClick}
                >
                  {action.label}
                </Button>
              ))}
            </Box>
          )}

          {/* Progress bar for auto-dismissing toasts */}
          {toast.duration && toast.duration > 0 && toast.showProgress && (
            <Box sx={{ mt: 1 }}>
              <LinearProgress
                variant='determinate'
                value={progress}
                sx={{
                  height: 3,
                  borderRadius: 1,
                  backgroundColor: 'rgba(255, 255, 255, 0.3)',
                  '& .MuiLinearProgress-bar': {
                    borderRadius: 1,
                  },
                }}
              />
            </Box>
          )}
        </Alert>
      </Box>
    </Slide>
  );
};

interface ToastContainerProps {
  position?: ToastPosition;
}

const ToastContainer: React.FC<ToastContainerProps> = ({ position }) => {
  const { toasts, dismissToast, position: contextPosition } = useToast();
  const finalPosition = position || contextPosition;

  // Get positioning styles
  const getPositionStyles = () => {
    const base = {
      position: 'fixed' as const,
      zIndex: 9999,
      pointerEvents: 'none' as const,
      '& > *': {
        pointerEvents: 'auto' as const,
      },
    };

    switch (finalPosition) {
      case 'top-left':
        return { ...base, top: 16, left: 16 };
      case 'top-center':
        return { ...base, top: 16, left: '50%', transform: 'translateX(-50%)' };
      case 'top-right':
        return { ...base, top: 16, right: 16 };
      case 'bottom-left':
        return { ...base, bottom: 16, left: 16 };
      case 'bottom-center':
        return {
          ...base,
          bottom: 16,
          left: '50%',
          transform: 'translateX(-50%)',
        };
      case 'bottom-right':
        return { ...base, bottom: 16, right: 16 };
      default:
        return { ...base, top: 16, right: 16 };
    }
  };

  if (toasts.length === 0) {
    return null;
  }

  return (
    <Box sx={getPositionStyles()}>
      {toasts.map((toast, index) => (
        <Fade
          key={toast.id}
          in={true}
          timeout={300}
          style={{ transitionDelay: `${index * 100}ms` }}
        >
          <div>
            <ToastItem toast={toast} onDismiss={dismissToast} />
          </div>
        </Fade>
      ))}
    </Box>
  );
};

export default ToastContainer;
