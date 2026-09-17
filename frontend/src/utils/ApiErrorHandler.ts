// ===============================================
// Standardized API Error Handler
// ===============================================

import axios, { AxiosError } from 'axios';
import { 
  StandardError, 
  ErrorContext, 
  ErrorCategory, 
  ErrorSeverity,
  EnhancedError,
  ServiceError 
} from '../types/errors';
import { ERROR_CODES, ERROR_CODE_TO_STATUS, ERROR_MESSAGES } from '../constants/errorCodes';

export class ApiErrorHandler {
  /**
   * Main error handling method
   */
  static handleError(error: unknown, context: ErrorContext): StandardError {
    if (axios.isAxiosError(error)) {
      return this.handleAxiosError(error, context);
    }
    
    if (error instanceof Error) {
      return this.handleGenericError(error, context);
    }
    
    return this.handleUnknownError(error, context);
  }

  /**
   * Enhanced error handling with categorization
   */
  static handleEnhancedError(error: unknown, context: ErrorContext): EnhancedError {
    const standardError = this.handleError(error, context);
    return this.enhanceError(standardError);
  }

  /**
   * Handle Axios-specific errors
   */
  private static handleAxiosError(error: AxiosError, context: ErrorContext): StandardError {
    const statusCode = error.response?.status || 500;
    const serverError = error.response?.data as { error?: { code?: string; message?: string; details?: unknown; traceId?: string }; code?: string; message?: string; details?: unknown; traceId?: string } | undefined;
    
    // Extract error information from server response
    const code = serverError?.error?.code || 
                 serverError?.code || 
                 this.getErrorCodeByStatus(statusCode);
    
    const message = serverError?.error?.message || 
                    serverError?.message || 
                    error.message || 
                    'An unexpected error occurred';

    const details = serverError?.error?.details || 
                    serverError?.details || 
                    this.getErrorDetails(error);

    return {
      code,
      message,
      statusCode,
      details,
      context,
      timestamp: new Date().toISOString(),
      traceId: serverError?.error?.traceId || 
               serverError?.traceId || 
               this.generateTraceId()
    };
  }

  /**
   * Handle generic JavaScript errors
   */
  private static handleGenericError(error: Error, context: ErrorContext): StandardError {
    const code = this.categorizeGenericError(error);
    const statusCode = ERROR_CODE_TO_STATUS[code] || 500;

    return {
      code,
      message: error.message,
      statusCode,
      details: {
        name: error.name,
        stack: error.stack,
      },
      context,
      timestamp: new Date().toISOString(),
      traceId: this.generateTraceId()
    };
  }

  /**
   * Handle unknown error types
   */
  private static handleUnknownError(error: unknown, context: ErrorContext): StandardError {
    return {
      code: ERROR_CODES.UNEXPECTED_ERROR,
      message: 'An unexpected error occurred',
      statusCode: 500,
      details: {
        originalError: String(error),
        type: typeof error,
      },
      context,
      timestamp: new Date().toISOString(),
      traceId: this.generateTraceId()
    };
  }

  /**
   * Enhance standard error with additional metadata
   */
  private static enhanceError(standardError: StandardError): EnhancedError {
    const category = this.categorizeError(standardError);
    const severity = this.determineSeverity(standardError);
    const { userMessage, suggestion, isRetryable } = this.getUserFriendlyInfo(standardError);

    return {
      ...standardError,
      category,
      severity,
      userMessage,
      suggestion,
      isRetryable,
      maxRetries: this.getMaxRetries(standardError.code),
    };
  }

  /**
   * Get error code based on HTTP status
   */
  private static getErrorCodeByStatus(status: number): string {
    switch (status) {
      case 400:
        return ERROR_CODES.VALIDATION_ERROR;
      case 401:
        return ERROR_CODES.AUTH_TOKEN_INVALID;
      case 403:
        return ERROR_CODES.ACCESS_FORBIDDEN;
      case 404:
        return ERROR_CODES.RESOURCE_NOT_FOUND;
      case 409:
        return ERROR_CODES.RESOURCE_CONFLICT;
      case 429:
        return ERROR_CODES.RATE_LIMIT_EXCEEDED;
      case 500:
        return ERROR_CODES.INTERNAL_SERVER_ERROR;
      case 502:
        return ERROR_CODES.EXTERNAL_SERVICE_ERROR;
      case 503:
        return ERROR_CODES.SERVICE_UNAVAILABLE;
      case 504:
        return ERROR_CODES.EXTERNAL_SERVICE_TIMEOUT;
      default:
        return ERROR_CODES.UNEXPECTED_ERROR;
    }
  }

  /**
   * Categorize generic JavaScript errors
   */
  private static categorizeGenericError(error: Error): string {
    const message = error.message.toLowerCase();
    const name = error.name.toLowerCase();

    // Network-related errors
    if (message.includes('network') || 
        message.includes('fetch') || 
        message.includes('connection') ||
        name.includes('networkerror')) {
      return ERROR_CODES.NETWORK_ERROR;
    }

    // Timeout errors
    if (message.includes('timeout') || name.includes('timeout')) {
      return ERROR_CODES.CONNECTION_TIMEOUT;
    }

    // Reference errors (usually coding issues)
    if (name.includes('reference') || 
        message.includes('is not defined') ||
        message.includes('undefined')) {
      return ERROR_CODES.UNEXPECTED_ERROR;
    }

    // Type errors
    if (name.includes('type') || 
        message.includes('cannot read property') ||
        message.includes('is not a function')) {
      return ERROR_CODES.UNEXPECTED_ERROR;
    }

    // Default to unexpected error
    return ERROR_CODES.UNEXPECTED_ERROR;
  }

  /**
   * Categorize error by type
   */
  private static categorizeError(error: StandardError): ErrorCategory {
    const code = error.code;

    if (code.includes('VALIDATION') || code.includes('INVALID')) {
      return ErrorCategory.VALIDATION;
    }
    
    if (code.includes('AUTH')) {
      return ErrorCategory.AUTHENTICATION;
    }
    
    if (code.includes('ACCESS') || code.includes('PERMISSION') || code.includes('FORBIDDEN')) {
      return ErrorCategory.AUTHORIZATION;
    }
    
    if (code.includes('DATABASE') || code.includes('CONSTRAINT')) {
      return ErrorCategory.DATABASE;
    }
    
    if (code.includes('NETWORK') || code.includes('CONNECTION')) {
      return ErrorCategory.NETWORK;
    }
    
    if (code.includes('EXTERNAL_SERVICE') || code.includes('EMAIL_SERVICE')) {
      return ErrorCategory.EXTERNAL_SERVICE;
    }
    
    if (code.includes('CONFLICT') || 
        code.includes('DUPLICATE') || 
        code.includes('SCHEDULE') ||
        code.includes('BUSINESS_RULE')) {
      return ErrorCategory.BUSINESS_LOGIC;
    }

    return ErrorCategory.SYSTEM;
  }

  /**
   * Determine error severity
   */
  private static determineSeverity(error: StandardError): ErrorSeverity {
    const { statusCode, code } = error;

    // Critical errors that require immediate attention
    if (statusCode >= 500 || 
        code.includes('DATABASE') || 
        code.includes('CONFIGURATION')) {
      return ErrorSeverity.CRITICAL;
    }

    // High priority errors affecting functionality
    if (statusCode === 403 || 
        statusCode === 404 ||
        code.includes('AUTH') ||
        code.includes('PAYMENT')) {
      return ErrorSeverity.HIGH;
    }

    // Medium priority errors that can be handled gracefully
    if (statusCode === 400 || 
        statusCode === 409 ||
        code.includes('VALIDATION') ||
        code.includes('CONFLICT')) {
      return ErrorSeverity.MEDIUM;
    }

    // Low priority errors (informational)
    return ErrorSeverity.LOW;
  }

  /**
   * Get user-friendly error information
   */
  private static getUserFriendlyInfo(error: StandardError): {
    userMessage: string;
    suggestion: string;
    isRetryable: boolean;
  } {
    const code = error.code;
    const userMessage = ERROR_MESSAGES[code] || 'An unexpected error occurred';

    // Determine if error is retryable and provide suggestions
    const retryableCodes: string[] = [
      ERROR_CODES.NETWORK_ERROR,
      ERROR_CODES.CONNECTION_TIMEOUT,
      ERROR_CODES.SERVICE_UNAVAILABLE,
      ERROR_CODES.EXTERNAL_SERVICE_TIMEOUT,
      ERROR_CODES.RATE_LIMIT_EXCEEDED,
    ];

    const isRetryable = retryableCodes.includes(code);

    // eslint-disable-next-line no-useless-assignment
    let suggestion = '';
    if (code.includes('NETWORK') || code.includes('CONNECTION')) {
      suggestion = 'Please check your internet connection and try again';
    } else if (code.includes('AUTH')) {
      suggestion = 'Please log in again to continue';
    } else if (code.includes('VALIDATION')) {
      suggestion = 'Please check your input and correct any errors';
    } else if (code.includes('PERMISSION') || code.includes('FORBIDDEN')) {
      suggestion = 'Contact your administrator for access to this resource';
    } else if (code.includes('NOT_FOUND')) {
      suggestion = 'The requested item may have been removed or is temporarily unavailable';
    } else if (code.includes('RATE_LIMIT')) {
      suggestion = 'Please wait a moment before trying again';
    } else if (isRetryable) {
      suggestion = 'Please try again in a few moments';
    } else {
      suggestion = 'If this problem persists, please contact support';
    }

    return { userMessage, suggestion, isRetryable };
  }

  /**
   * Get maximum retry attempts for error type
   */
  private static getMaxRetries(code: string): number {
    const highRetryErrors: string[] = [ERROR_CODES.NETWORK_ERROR, ERROR_CODES.CONNECTION_TIMEOUT];
    const mediumRetryErrors: string[] = [ERROR_CODES.SERVICE_UNAVAILABLE, ERROR_CODES.EXTERNAL_SERVICE_TIMEOUT];
    const lowRetryErrors: string[] = [ERROR_CODES.RATE_LIMIT_EXCEEDED];

    if (highRetryErrors.includes(code)) return 3;
    if (mediumRetryErrors.includes(code)) return 2;
    if (lowRetryErrors.includes(code)) return 1;
    
    return 0; // No retries for other errors
  }

  /**
   * Extract additional error details from Axios error
   */
  private static getErrorDetails(error: AxiosError): Record<string, unknown> {
    return {
      url: error.config?.url,
      method: error.config?.method,
      status: error.response?.status,
      statusText: error.response?.statusText,
      headers: error.response?.headers,
      requestHeaders: error.config?.headers,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Generate unique trace ID for error tracking
   */
  private static generateTraceId(): string {
    return `trace_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Create a ServiceError from unknown error
   */
  static createServiceError(error: unknown, context: ErrorContext): ServiceError {
    const standardError = this.handleError(error, context);
    return new ServiceError(standardError);
  }

  /**
   * Check if error is retryable
   */
  static isRetryableError(error: StandardError): boolean {
    const retryableCodes: string[] = [
      ERROR_CODES.NETWORK_ERROR,
      ERROR_CODES.CONNECTION_TIMEOUT,
      ERROR_CODES.SERVICE_UNAVAILABLE,
      ERROR_CODES.EXTERNAL_SERVICE_TIMEOUT,
      ERROR_CODES.RATE_LIMIT_EXCEEDED,
    ];

    return retryableCodes.includes(error.code) || error.statusCode >= 500;
  }

  /**
   * Get retry delay in milliseconds
   */
  static getRetryDelay(attempt: number): number {
    // Exponential backoff: 1s, 2s, 4s, max 10s
    return Math.min(1000 * Math.pow(2, attempt - 1), 10000);
  }
}

export default ApiErrorHandler; 