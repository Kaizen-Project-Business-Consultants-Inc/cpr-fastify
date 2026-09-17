/* eslint-disable no-console */
const isDevelopment = import.meta.env.DEV;

// Log suppression configuration
const LOG_CONFIG = {
  suppressAll: false,
  suppressApiLogs: true,  // Suppress API request/response logs
  suppressDebugLogs: true, // Suppress debug logs
  suppressDeepTrace: false, // Enable deep trace logs
  suppressInfoLogs: true,  // Suppress info logs
  allowedDomains: ['nswma.gov.jm'],
};

// Check if message should be suppressed
const shouldSuppress = (message: string) => {
  if (LOG_CONFIG.suppressAll) return true;
  
  if (LOG_CONFIG.suppressApiLogs && (
    message.includes('[API]') || 
    message.includes('📤') || 
    message.includes('📥')
  )) return true;
  
  if (LOG_CONFIG.suppressDebugLogs && (
    message.includes('[DEBUG]') ||
    message.includes('availableDates') ||
    message.includes('combinedSchedule')
  )) return true;
  
  if (LOG_CONFIG.suppressDeepTrace && message.includes('[DEEP TRACE]')) return true;
  
  if (LOG_CONFIG.suppressInfoLogs && message.includes('[INFO]')) return true;
  
  return false;
};

const logger = {
  debug: (...args: any[]) => {
    if (isDevelopment && !shouldSuppress(args.join(' '))) {
      console.debug('[DEBUG]', ...args);
    }
  },

  info: (...args: any[]) => {
    if (isDevelopment && !shouldSuppress(args.join(' '))) {
      console.info('[INFO]', ...args);
    }
  },

  warn: (...args: any[]) => {
    if (!shouldSuppress(args.join(' '))) {
      console.warn('[WARN]', ...args);
    }
  },

  error: (...args: any[]) => {
    if (!shouldSuppress(args.join(' '))) {
      console.error('[ERROR]', ...args);
    }
  },

  // Format error objects for better logging
  formatError: (error: any) => {
    if (error.response) {
      // The request was made and the server responded with a status code
      // that falls out of the range of 2xx
      return {
        status: error.response.status,
        data: error.response.data,
        headers: error.response.headers,
      };
    } else if (error.request) {
      // The request was made but no response was received
      return {
        request: error.request,
      };
    } else {
      // Something happened in setting up the request that triggered an Error
      return {
        message: error.message,
      };
    }
  },

  // Configure logging behavior
  configure: (config: Partial<typeof LOG_CONFIG>) => {
    Object.assign(LOG_CONFIG, config);
  },

  // Get current logging configuration
  getConfig: () => ({ ...LOG_CONFIG }),
};

export default logger;
