import { emitToast } from './toastBridge';
import logger from '../utils/logger';

export interface AppError {
  code: string;
  message: string;
  statusCode?: number;
  details?: Record<string, unknown>;
  userMessage?: string;
  isRetryable?: boolean;
}

export interface ErrorContext {
  component?: string;
  action?: string;
  endpoint?: string;
  userId?: string;
}

// Centralized error handling service
export class ErrorHandler {
  private static instance: ErrorHandler;

  static getInstance(): ErrorHandler {
    if (!ErrorHandler.instance) {
      ErrorHandler.instance = new ErrorHandler();
    }
    return ErrorHandler.instance;
  }

  // Parse and standardize errors from different sources
  parseError(error: unknown, _context?: ErrorContext): AppError {
    const err = error as Record<string, unknown>;
    // Handle axios errors
    const response = err.response as Record<string, unknown> | undefined;
    if (response) {
      const data = response.data as Record<string, unknown> | undefined;
      const errorInfo = data?.error as Record<string, unknown> | undefined;
      return {
        code: (errorInfo?.code as string) || 'API_ERROR',
        message: (errorInfo?.message as string) || (err.message as string) || 'API Error',
        statusCode: response.status as number,
        details: data as Record<string, unknown>,
        userMessage: this.getUserFriendlyMessage(response.status as number, errorInfo?.code as string),
        isRetryable: this.isRetryableError(response.status as number)
      };
    }

    // Handle network errors
    if (err.request) {
      return {
        code: 'NETWORK_ERROR',
        message: 'Network request failed',
        userMessage: 'Unable to connect to server. Please check your internet connection.',
        isRetryable: true
      };
    }

    // Handle React Query errors
    if (err.code) {
      return {
        code: err.code as string,
        message: err.message as string,
        userMessage: (err.userMessage as string) || this.getUserFriendlyMessage(undefined, err.code as string),
        isRetryable: (err.isRetryable as boolean) || false
      };
    }

    // Handle generic errors
    return {
      code: 'UNKNOWN_ERROR',
      message: (err.message as string) || 'An unexpected error occurred',
      userMessage: 'Something went wrong. Please try again.',
      isRetryable: false
    };
  }

  // Get user-friendly error messages
  private getUserFriendlyMessage(statusCode?: number, errorCode?: string): string {
    if (errorCode) {
      switch (errorCode) {
        case 'AUTH_1001':
          return 'Your session has expired. Please log in again.';
        case 'AUTH_1002':
          return 'Invalid credentials. Please check your username and password.';
        case 'AUTH_1003':
          return 'Invalid authentication token. Please log in again.';
        case 'AUTH_1004':
          return 'You do not have permission to perform this action.';
        case 'AUTH_1005':
          return 'Authentication required. Please log in.';
        case 'VALIDATION_ERROR':
          return 'Please check your input and try again.';
        case 'NOT_FOUND':
          return 'The requested resource was not found.';
        case 'NETWORK_ERROR':
          return 'Unable to connect to server. Please check your internet connection.';
        default:
          break;
      }
    }

    if (statusCode) {
      switch (statusCode) {
        case 400:
          return 'Invalid request. Please check your input.';
        case 401:
          return 'Please log in to continue.';
        case 403:
          return 'You do not have permission to perform this action.';
        case 404:
          return 'The requested resource was not found.';
        case 409:
          return 'This resource already exists.';
        case 422:
          return 'Please check your input and try again.';
        case 429:
          return 'Too many requests. Please wait a moment and try again.';
        case 500:
          return 'Server error. Please try again later.';
        case 502:
        case 503:
        case 504:
          return 'Service temporarily unavailable. Please try again later.';
        default:
          return 'Something went wrong. Please try again.';
      }
    }

    return 'Something went wrong. Please try again.';
  }

  // Determine if an error is retryable
  private isRetryableError(statusCode?: number): boolean {
    if (!statusCode) return false;
    
    // Retry on server errors and rate limiting
    return statusCode >= 500 || statusCode === 429;
  }

  // Handle errors with consistent user feedback
  handleError(error: unknown, context?: ErrorContext, options?: {
    showToast?: boolean;
    showConsole?: boolean;
    redirectToLogin?: boolean;
  }): AppError {
    const parsedError = this.parseError(error, context);
    const {
      showToast = true,
      showConsole = true,
      redirectToLogin = false
    } = options || {};

    // Log error for debugging
    if (showConsole) {
      logger.error('Error occurred:', {
        error: parsedError,
        context,
        originalError: error
      });
    }

    // Show user-friendly toast
    if (showToast) {
      this.showErrorToast(parsedError);
    }

    // Handle authentication errors
    if (parsedError.statusCode === 401 || parsedError.code === 'AUTH_1001' || parsedError.code === 'AUTH_1003') {
      if (redirectToLogin) {
        this.redirectToLogin();
      }
    }

    return parsedError;
  }

  // Show error toast with consistent styling
  showErrorToast(error: AppError): void {
    emitToast('error', error.userMessage || error.message, { duration: 5000 });
  }

  // Show success toast
  showSuccessToast(message: string): void {
    emitToast('success', message, { duration: 3000 });
  }

  // Show warning toast
  showWarningToast(message: string): void {
    emitToast('warning', message, { duration: 4000 });
  }

  // Show info toast
  showInfoToast(message: string): void {
    emitToast('info', message, { duration: 4000 });
  }

  // Redirect to login page
  private redirectToLogin(): void {
    sessionStorage.clear();
    window.location.href = '/login';
  }

  // Create a React Query error handler
  createQueryErrorHandler(context?: ErrorContext) {
    return (error: unknown) => {
      return this.handleError(error, context, {
        showToast: true,
        showConsole: true,
        redirectToLogin: true
      });
    };
  }

  // Create a mutation error handler
  createMutationErrorHandler(context?: ErrorContext) {
    return (error: unknown) => {
      return this.handleError(error, context, {
        showToast: true,
        showConsole: true,
        redirectToLogin: true
      });
    };
  }
}

// Export singleton instance
export const errorHandler = ErrorHandler.getInstance();

// Export convenience functions
export const handleError = (error: unknown, context?: ErrorContext, options?: Record<string, unknown>) =>
  errorHandler.handleError(error, context, options as { showToast?: boolean; showConsole?: boolean; redirectToLogin?: boolean });

export const showSuccessToast = (message: string) => 
  errorHandler.showSuccessToast(message);

export const showErrorToast = (message: string) => 
  errorHandler.showErrorToast({ code: 'CUSTOM_ERROR', message, userMessage: message });

export const showWarningToast = (message: string) => 
  errorHandler.showWarningToast(message);

export const showInfoToast = (message: string) => 
  errorHandler.showInfoToast(message); 