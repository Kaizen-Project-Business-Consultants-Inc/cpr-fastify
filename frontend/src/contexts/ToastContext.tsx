import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  ReactNode,
} from 'react';
import logger from '../utils/logger';
import analytics from '../services/analytics';
import { registerToastHandler } from '../services/toastBridge';

// Toast types and priorities
export type ToastType = 'success' | 'error' | 'warning' | 'info' | 'loading';
export type ToastPriority = 'low' | 'normal' | 'high' | 'critical';
export type ToastPosition =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right';

// Toast action interface
export interface ToastAction {
  label: string;
  onClick: () => void;
  color?: 'primary' | 'secondary' | 'error' | 'warning' | 'info' | 'success';
  variant?: 'text' | 'outlined' | 'contained';
}

// Toast interface
export interface Toast {
  id: string;
  type: ToastType;
  title?: string;
  message: string;
  priority: ToastPriority;
  duration?: number; // in milliseconds, 0 = persistent
  actions?: ToastAction[];
  dismissible?: boolean;
  showProgress?: boolean;
  metadata?: Record<string, any>;
  timestamp: number;
  context?: string; // For analytics tracking
}

// Toast context interface
interface ToastContextType {
  // State
  toasts: Toast[];
  maxToasts: number;
  defaultDuration: number;
  position: ToastPosition;

  // Actions
  showToast: (toast: Omit<Toast, 'id' | 'timestamp'>) => string;
  dismissToast: (id: string) => void;
  dismissAll: () => void;
  updateToast: (id: string, updates: Partial<Toast>) => void;

  // Convenience methods
  success: (message: string, options?: Partial<Toast>) => string;
  error: (message: string, options?: Partial<Toast>) => string;
  warning: (message: string, options?: Partial<Toast>) => string;
  info: (message: string, options?: Partial<Toast>) => string;
  loading: (message: string, options?: Partial<Toast>) => string;

  // Configuration
  setPosition: (position: ToastPosition) => void;
  setMaxToasts: (max: number) => void;
  setDefaultDuration: (duration: number) => void;

  // Utilities
  clearExpired: () => void;
  getToastsByType: (type: ToastType) => Toast[];
  getToastsByPriority: (priority: ToastPriority) => Toast[];
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

interface ToastProviderProps {
  children: ReactNode;
  maxToasts?: number;
  defaultDuration?: number;
  position?: ToastPosition;
  enablePersistence?: boolean;
  enableAnalytics?: boolean;
}

export const ToastProvider: React.FC<ToastProviderProps> = ({
  children,
  maxToasts = 5,
  defaultDuration = 5000,
  position = 'top-right',
  enablePersistence = true,
  enableAnalytics = true,
}) => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [currentMaxToasts, setCurrentMaxToasts] = useState(maxToasts);
  const [currentDefaultDuration, setCurrentDefaultDuration] =
    useState(defaultDuration);
  const [currentPosition, setCurrentPosition] = useState(position);

  // Generate unique toast ID
  const generateId = useCallback(() => {
    return `toast_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }, []);

  // Priority order for toast management
  const getPriorityOrder = (priority: ToastPriority): number => {
    switch (priority) {
      case 'critical':
        return 4;
      case 'high':
        return 3;
      case 'normal':
        return 2;
      case 'low':
        return 1;
      default:
        return 2;
    }
  };

  // Show a new toast
  const showToast = useCallback(
    (toastData: Omit<Toast, 'id' | 'timestamp'>): string => {
      const id = generateId();
      const timestamp = Date.now();

      // Set defaults first, then override with provided data
      const defaults = {
        priority: 'normal' as ToastPriority,
        duration: currentDefaultDuration,
        dismissible: true,
        showProgress: true,
      };

      const newToast: Toast = {
        id,
        timestamp,
        ...defaults,
        ...toastData,
      };

      setToasts(prevToasts => {
        let updatedToasts = [...prevToasts, newToast];

        // Sort by priority (highest first) and timestamp (newest first)
        updatedToasts.sort((a, b) => {
          const priorityDiff =
            getPriorityOrder(b.priority) - getPriorityOrder(a.priority);
          if (priorityDiff !== 0) return priorityDiff;
          return b.timestamp - a.timestamp;
        });

        // Remove excess toasts (keep highest priority ones)
        if (updatedToasts.length > currentMaxToasts) {
          const removedToasts = updatedToasts.slice(currentMaxToasts);
          updatedToasts = updatedToasts.slice(0, currentMaxToasts);

          // Log removed toasts
          removedToasts.forEach(toast => {
            logger.warn(
              `[ToastContext] Toast removed due to limit: ${toast.message}`
            );
          });
        }

        return updatedToasts;
      });

      // Auto-dismiss if duration is set
      if (newToast.duration && newToast.duration > 0) {
        setTimeout(() => {
          dismissToast(id);
        }, newToast.duration);
      }

      // Analytics tracking
      if (enableAnalytics) {
        analytics.trackInstructorAction('toast_shown', {
          type: newToast.type,
          priority: newToast.priority,
          context: newToast.context || 'unknown',
          hasActions: (newToast.actions?.length || 0) > 0,
          timestamp: new Date().toISOString(),
        });
      }

      logger.info(
        `[ToastContext] Toast shown: ${newToast.type} - ${newToast.message}`
      );
      return id;
    },
    [generateId, currentDefaultDuration, currentMaxToasts, enableAnalytics]
  );

  // Dismiss a specific toast
  const dismissToast = useCallback(
    (id: string) => {
      setToasts(prevToasts => {
        const toast = prevToasts.find(t => t.id === id);
        if (toast && enableAnalytics) {
          analytics.trackInstructorAction('toast_dismissed', {
            type: toast.type,
            priority: toast.priority,
            context: toast.context || 'unknown',
            duration: Date.now() - toast.timestamp,
            timestamp: new Date().toISOString(),
          });
        }

        return prevToasts.filter(toast => toast.id !== id);
      });
    },
    [enableAnalytics]
  );

  // Dismiss all toasts
  const dismissAll = useCallback(() => {
    if (enableAnalytics && toasts.length > 0) {
      analytics.trackInstructorAction('toast_dismiss_all', {
        count: toasts.length,
        timestamp: new Date().toISOString(),
      });
    }

    setToasts([]);
    logger.info('[ToastContext] All toasts dismissed');
  }, [toasts.length, enableAnalytics]);

  // Update an existing toast
  const updateToast = useCallback((id: string, updates: Partial<Toast>) => {
    setToasts(prevToasts =>
      prevToasts.map(toast =>
        toast.id === id ? { ...toast, ...updates } : toast
      )
    );
  }, []);

  // Convenience methods
  const success = useCallback(
    (message: string, options?: Partial<Toast>): string => {
      return showToast({
        type: 'success',
        message,
        priority: 'normal',
        duration: 4000,
        ...options,
      });
    },
    [showToast]
  );

  const error = useCallback(
    (message: string, options?: Partial<Toast>): string => {
      return showToast({
        type: 'error',
        message,
        priority: 'high',
        duration: 0, // Persistent by default for errors
        ...options,
      });
    },
    [showToast]
  );

  const warning = useCallback(
    (message: string, options?: Partial<Toast>): string => {
      return showToast({
        type: 'warning',
        message,
        priority: 'normal',
        duration: 6000,
        ...options,
      });
    },
    [showToast]
  );

  const info = useCallback(
    (message: string, options?: Partial<Toast>): string => {
      return showToast({
        type: 'info',
        message,
        priority: 'normal',
        duration: 5000,
        ...options,
      });
    },
    [showToast]
  );

  const loading = useCallback(
    (message: string, options?: Partial<Toast>): string => {
      return showToast({
        type: 'loading',
        message,
        priority: 'normal',
        duration: 0, // Persistent by default for loading
        dismissible: false,
        showProgress: false,
        ...options,
      });
    },
    [showToast]
  );

  // Configuration setters
  const setPosition = useCallback((newPosition: ToastPosition) => {
    setCurrentPosition(newPosition);
  }, []);

  const setMaxToasts = useCallback((max: number) => {
    setCurrentMaxToasts(max);
  }, []);

  const setDefaultDuration = useCallback((duration: number) => {
    setCurrentDefaultDuration(duration);
  }, []);

  // Utility functions
  const clearExpired = useCallback(() => {
    const now = Date.now();
    setToasts(prevToasts =>
      prevToasts.filter(toast => {
        if (toast.duration === 0) return true; // Persistent toasts
        return now - toast.timestamp < toast.duration!;
      })
    );
  }, []);

  const getToastsByType = useCallback(
    (type: ToastType): Toast[] => {
      return toasts.filter(toast => toast.type === type);
    },
    [toasts]
  );

  const getToastsByPriority = useCallback(
    (priority: ToastPriority): Toast[] => {
      return toasts.filter(toast => toast.priority === priority);
    },
    [toasts]
  );

  // Persistence - save toasts to localStorage
  useEffect(() => {
    if (enablePersistence) {
      try {
        const persistentToasts = toasts.filter(
          toast => toast.priority === 'critical' || toast.type === 'error'
        );
        localStorage.setItem('toastQueue', JSON.stringify(persistentToasts));
      } catch (error: any) {
        logger.error('[ToastContext] Failed to persist toasts:', error);
      }
    }
  }, [toasts, enablePersistence]);

  // Load persisted toasts on mount
  useEffect(() => {
    if (enablePersistence) {
      try {
        const saved = localStorage.getItem('toastQueue');
        if (saved) {
          const persistedToasts = JSON.parse(saved);
          // Only restore critical/error toasts that are less than 1 hour old
          const validToasts = persistedToasts.filter((toast: Toast) => {
            const age = Date.now() - toast.timestamp;
            return age < 60 * 60 * 1000; // 1 hour
          });

          if (validToasts.length > 0) {
            setToasts(validToasts);
            logger.info(
              `[ToastContext] Restored ${validToasts.length} persisted toasts`
            );
          }
        }
      } catch (error: any) {
        logger.error('[ToastContext] Failed to load persisted toasts:', error);
      }
    }
  }, [enablePersistence]);

  // Cleanup expired toasts periodically
  useEffect(() => {
    const interval = setInterval(clearExpired, 5000);
    return () => clearInterval(interval);
  }, [clearExpired]);

  const value: ToastContextType = {
    // State
    toasts,
    maxToasts: currentMaxToasts,
    defaultDuration: currentDefaultDuration,
    position: currentPosition,

    // Actions
    showToast,
    dismissToast,
    dismissAll,
    updateToast,

    // Convenience methods
    success,
    error,
    warning,
    info,
    loading,

    // Configuration
    setPosition,
    setMaxToasts,
    setDefaultDuration,

    // Utilities
    clearExpired,
    getToastsByType,
    getToastsByPriority,
  };

  // Expose showToast to non-React code (services/errorHandler.ts)
  useEffect(() => {
    registerToastHandler(showToast);
    return () => registerToastHandler(null);
  }, [showToast]);

  return (
    <ToastContext.Provider value={value}>{children}</ToastContext.Provider>
  );
};

// Custom hook to use toast context
export const useToast = (): ToastContextType => {
  const context = useContext(ToastContext);
  if (context === undefined) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};

export default ToastContext;
