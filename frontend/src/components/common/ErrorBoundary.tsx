import React, { Component, ErrorInfo, ReactNode } from 'react';
import {
  Box,
  Typography,
  Button,
  Alert,
  AlertTitle,
  Container,
  Paper,
  Chip,
  Divider,
  LinearProgress,
  Collapse,
} from '@mui/material';
import {
  Refresh as RefreshIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  WifiOff as OfflineIcon,
  Warning as WarningIcon,
  Error as ErrorIcon,
} from '@mui/icons-material';
import logger from '../../utils/logger';
import analytics from '../../services/analytics';

/**
 * Enhanced error types for better categorization
 */
interface EnhancedError {
  type:
    | 'network'
    | 'chunk'
    | 'auth'
    | 'permission'
    | 'validation'
    | 'runtime'
    | 'unknown';
  severity: 'low' | 'medium' | 'high' | 'critical';
  userMessage: string;
  suggestion: string;
  isRetryable: boolean;
  retryCount?: number;
  maxRetries?: number;
}

/**
 * Props interface for the ErrorBoundary component
 */
interface ErrorBoundaryProps {
  /** Child components to be wrapped by the error boundary */
  children: ReactNode;
  /** Optional custom fallback UI to display when an error occurs */
  fallback?: ReactNode;
  /** Optional callback function called when an error is caught */
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  /** Maximum number of automatic retries */
  maxRetries?: number;
  /** Whether to show detailed error information */
  showDetails?: boolean;
  /** Context identifier for error tracking */
  context?: string;
}

/**
 * State interface for the ErrorBoundary component
 */
interface ErrorBoundaryState {
  /** Whether an error has been caught */
  hasError: boolean;
  /** The caught error object */
  error: Error | null;
  /** Additional error information from React */
  errorInfo: ErrorInfo | null;
  /** Enhanced error details */
  enhancedError: EnhancedError | null;
  /** Current retry count */
  retryCount: number;
  /** Whether currently retrying */
  isRetrying: boolean;
  /** Whether error details are expanded */
  showDetails: boolean;
  /** Network status */
  isOnline: boolean;
}

/**
 * Enhanced Error Boundary component with advanced error handling,
 * retry mechanisms, and user-friendly error messages.
 */
class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  private retryTimer: NodeJS.Timeout | null = null;

  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      enhancedError: null,
      retryCount: 0,
      isRetrying: false,
      showDetails: false,
      isOnline: navigator.onLine,
    };
  }

  componentDidMount() {
    // Listen for network status changes
    window.addEventListener('online', this.handleOnline);
    window.addEventListener('offline', this.handleOffline);
  }

  componentWillUnmount() {
    // Cleanup
    window.removeEventListener('online', this.handleOnline);
    window.removeEventListener('offline', this.handleOffline);
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
    }
  }

  handleOnline = () => {
    this.setState({ isOnline: true });
    // Auto-retry if error was network-related
    if (this.state.enhancedError?.type === 'network' && this.state.hasError) {
      this.handleRetry();
    }
  };

  handleOffline = () => {
    this.setState({ isOnline: false });
  };

  /**
   * Categorizes and enhances error information
   */
  private categorizeError(error: Error, _errorInfo: ErrorInfo): EnhancedError {
    const errorMessage = error.message.toLowerCase();

    // Network-related errors
    if (
      errorMessage.includes('network') ||
      errorMessage.includes('fetch') ||
      errorMessage.includes('connection') ||
      !navigator.onLine
    ) {
      return {
        type: 'network',
        severity: 'medium',
        userMessage: 'Connection Problem',
        suggestion: 'Check your internet connection and try again',
        isRetryable: true,
        maxRetries: 3,
      };
    }

    // Chunk loading errors (common in React apps)
    if (
      errorMessage.includes('chunk') ||
      errorMessage.includes('loading') ||
      errorMessage.includes('import')
    ) {
      return {
        type: 'chunk',
        severity: 'medium',
        userMessage: 'Loading Error',
        suggestion: 'The application is updating. Please refresh the page',
        isRetryable: true,
        maxRetries: 2,
      };
    }

    // Authentication errors
    if (
      errorMessage.includes('auth') ||
      errorMessage.includes('token') ||
      errorMessage.includes('unauthorized')
    ) {
      return {
        type: 'auth',
        severity: 'high',
        userMessage: 'Authentication Error',
        suggestion: 'Please log in again to continue',
        isRetryable: false,
      };
    }

    // Permission errors
    if (
      errorMessage.includes('permission') ||
      errorMessage.includes('forbidden') ||
      errorMessage.includes('access denied')
    ) {
      return {
        type: 'permission',
        severity: 'high',
        userMessage: 'Access Denied',
        suggestion: "You don't have permission to access this feature",
        isRetryable: false,
      };
    }

    // Validation errors
    if (
      errorMessage.includes('validation') ||
      errorMessage.includes('invalid') ||
      errorMessage.includes('required')
    ) {
      return {
        type: 'validation',
        severity: 'low',
        userMessage: 'Invalid Data',
        suggestion: 'Please check your input and try again',
        isRetryable: true,
        maxRetries: 1,
      };
    }

    // Runtime errors
    if (
      errorMessage.includes('undefined') ||
      errorMessage.includes('null') ||
      errorMessage.includes('cannot read property')
    ) {
      return {
        type: 'runtime',
        severity: 'high',
        userMessage: 'Application Error',
        suggestion:
          'An unexpected error occurred. Please try refreshing the page',
        isRetryable: true,
        maxRetries: 2,
      };
    }

    // Default unknown error
    return {
      type: 'unknown',
      severity: 'critical',
      userMessage: 'Unexpected Error',
      suggestion:
        'Something went wrong. Please contact support if this continues',
      isRetryable: true,
      maxRetries: 1,
    };
  }

  /**
   * Gets appropriate icon for error type
   */
  private getErrorIcon(type: string) {
    switch (type) {
      case 'network':
        return <OfflineIcon />;
      case 'auth':
      case 'permission':
        return <WarningIcon />;
      default:
        return <ErrorIcon />;
    }
  }

  /**
   * Gets appropriate color for error severity
   */
  private getErrorColor(severity: string): 'error' | 'warning' | 'info' {
    switch (severity) {
      case 'low':
        return 'info';
      case 'medium':
        return 'warning';
      default:
        return 'error';
    }
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    const enhancedError = this.categorizeError(error, errorInfo);

    // Enhanced logging
    const errorDetails = {
      message: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
      type: enhancedError.type,
      severity: enhancedError.severity,
      context: this.props.context || 'unknown',
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
      url: window.location.href,
      isOnline: navigator.onLine,
    };

    logger.error('[ErrorBoundary] Component error caught:', errorDetails);

    // Update state with enhanced error info
    this.setState({
      error,
      errorInfo,
      enhancedError,
    });

    // Call custom error handler
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }

    // Track error in analytics
    logger.error('[ErrorBoundary] Analytics tracking:', {
      type: enhancedError.type,
      severity: enhancedError.severity,
      context: this.props.context || 'error_boundary',
      componentStack: errorInfo.componentStack,
      retryable: enhancedError.isRetryable,
    });

    // Auto-retry for certain error types
    if (
      enhancedError.isRetryable &&
      this.state.retryCount < (enhancedError.maxRetries || 1)
    ) {
      this.scheduleRetry();
    }
  }

  /**
   * Schedules an automatic retry with exponential backoff
   */
  private scheduleRetry = () => {
    const delay = Math.min(1000 * Math.pow(2, this.state.retryCount), 10000); // Max 10 seconds

    this.setState({ isRetrying: true });

    this.retryTimer = setTimeout(() => {
      this.handleRetry();
    }, delay);
  };

  /**
   * Handles manual or automatic retry
   */
  handleRetry = () => {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }

    this.setState(prevState => ({
      hasError: false,
      error: null as Error | null,
      errorInfo: null as ErrorInfo | null,
      enhancedError: null as EnhancedError | null,
      retryCount: prevState.retryCount + 1,
      isRetrying: false,
    }));

    // Track retry attempt
    analytics.trackInstructorAction('error_boundary_retry', {
      retryCount: this.state.retryCount + 1,
      errorType: this.state.enhancedError?.type,
    });
  };

  /**
   * Handles page reload
   */
  handleReload = () => {
    analytics.trackInstructorAction('error_boundary_reload', {
      errorType: this.state.enhancedError?.type,
    });
    window.location.reload();
  };

  /**
   * Toggles error details visibility
   */
  toggleDetails = () => {
    this.setState(prevState => ({
      showDetails: !prevState.showDetails,
    }));
  };

  render() {
    if (this.state.hasError && this.state.enhancedError) {
      // Custom fallback UI if provided
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const { enhancedError, isRetrying, showDetails, isOnline } = this.state;
      const canRetry =
        enhancedError.isRetryable &&
        this.state.retryCount < (enhancedError.maxRetries || 1);

      return (
        <Container maxWidth='md' sx={{ mt: 4 }}>
          <Paper elevation={3} sx={{ p: 4 }}>
            {/* Network status indicator */}
            {!isOnline && (
              <Alert severity='warning' sx={{ mb: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <OfflineIcon />
                  You're currently offline
                </Box>
              </Alert>
            )}

            {/* Main error alert */}
            <Alert
              severity={this.getErrorColor(enhancedError.severity)}
              sx={{ mb: 3 }}
            >
              <AlertTitle>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  {this.getErrorIcon(enhancedError.type)}
                  {enhancedError.userMessage}
                </Box>
              </AlertTitle>

              <Typography variant='body1' sx={{ mb: 2 }}>
                {enhancedError.suggestion}
              </Typography>

              {/* Error metadata */}
              <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
                <Chip
                  label={`Type: ${enhancedError.type}`}
                  size='small'
                  variant='outlined'
                />
                <Chip
                  label={`Severity: ${enhancedError.severity}`}
                  size='small'
                  variant='outlined'
                  color={this.getErrorColor(enhancedError.severity)}
                />
                {this.state.retryCount > 0 && (
                  <Chip
                    label={`Retries: ${this.state.retryCount}`}
                    size='small'
                    variant='outlined'
                  />
                )}
              </Box>

              {/* Retry progress */}
              {isRetrying && (
                <Box sx={{ mb: 2 }}>
                  <Typography variant='body2' sx={{ mb: 1 }}>
                    Retrying automatically...
                  </Typography>
                  <LinearProgress />
                </Box>
              )}
            </Alert>

            {/* Action buttons */}
            <Box
              sx={{ display: 'flex', gap: 2, justifyContent: 'center', mb: 3 }}
            >
              {canRetry && !isRetrying && (
                <Button
                  variant='contained'
                  color='primary'
                  startIcon={<RefreshIcon />}
                  onClick={this.handleRetry}
                >
                  Try Again
                </Button>
              )}

              <Button
                variant='outlined'
                color='secondary'
                onClick={this.handleReload}
              >
                Reload Page
              </Button>
            </Box>

            {/* Error details (development or when requested) */}
            {(import.meta.env.DEV || this.props.showDetails) &&
              this.state.error && (
                <>
                  <Divider sx={{ mb: 2 }} />
                  <Button
                    onClick={this.toggleDetails}
                    startIcon={
                      showDetails ? <ExpandLessIcon /> : <ExpandMoreIcon />
                    }
                    size='small'
                  >
                    {showDetails ? 'Hide' : 'Show'} Technical Details
                  </Button>

                  <Collapse in={showDetails}>
                    <Box
                      sx={{ mt: 2, p: 2, bgcolor: 'grey.100', borderRadius: 1 }}
                    >
                      <Typography
                        variant='subtitle2'
                        fontWeight='bold'
                        sx={{ mb: 1 }}
                      >
                        Error Details:
                      </Typography>
                      <Typography
                        variant='body2'
                        component='pre'
                        sx={{
                          fontSize: '0.75rem',
                          overflow: 'auto',
                          maxHeight: '200px',
                          mb: 2,
                        }}
                      >
                        {this.state.error.message}
                        {'\n\n'}
                        {this.state.error.stack}
                      </Typography>

                      {this.state.errorInfo && (
                        <>
                          <Typography
                            variant='subtitle2'
                            fontWeight='bold'
                            sx={{ mb: 1 }}
                          >
                            Component Stack:
                          </Typography>
                          <Typography
                            variant='body2'
                            component='pre'
                            sx={{
                              fontSize: '0.75rem',
                              overflow: 'auto',
                              maxHeight: '150px',
                            }}
                          >
                            {this.state.errorInfo.componentStack}
                          </Typography>
                        </>
                      )}
                    </Box>
                  </Collapse>
                </>
              )}
          </Paper>
        </Container>
      );
    }

    return this.props.children;
  }
}

export { ErrorBoundary };
export default ErrorBoundary;
