import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { api } from '../services/api';
import { useAuth } from './AuthContext';

export interface Notification {
  id: number;
  user_id: number;
  type: NotificationType;
  title: string;
  message: string;
  data: Record<string, unknown>;
  read_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export type NotificationType = 
  | 'payment_submitted'
  | 'timesheet_submitted'
  | 'invoice_status_change'
  | 'payment_verification_needed'
  | 'payment_verified'
  | 'timesheet_approved'
  | 'invoice_overdue'
  | 'system_alert';

interface NotificationContextType {
  notifications: Notification[];
  unreadCount: number;
  isLoading: boolean;
  error: string | null;
  fetchNotifications: () => Promise<void>;
  fetchUnreadCount: () => Promise<void>;
  markAsRead: (notificationId: number) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  deleteNotification: (notificationId: number) => Promise<void>;
  refreshNotifications: () => void;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export const useNotifications = () => {
  const context = useContext(NotificationContext);
  if (context === undefined) {
    throw new Error('useNotifications must be used within a NotificationProvider');
  }
  return context;
};

interface NotificationProviderProps {
  children: React.ReactNode;
}

export const NotificationProvider: React.FC<NotificationProviderProps> = ({ children }) => {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { isAuthenticated } = useAuth();

  // Track in-flight requests to prevent concurrent fetches
  const isFetchingNotifications = useRef(false);
  const isFetchingUnreadCount = useRef(false);

  // Track backoff for rate limiting
  const backoffDelay = useRef(0);
  const maxBackoff = 300000; // 5 minutes max backoff

  const fetchNotifications = useCallback(async () => {
    // Skip if not authenticated or already fetching
    if (!isAuthenticated || isFetchingNotifications.current) {
      return;
    }

    try {
      isFetchingNotifications.current = true;
      setIsLoading(true);
      setError(null);
      const response = await api.get('/notifications');
      if (response.data.success) {
        setNotifications(response.data.data);
        backoffDelay.current = 0; // Reset backoff on success
      }
    } catch (err: unknown) {
      console.error('Error fetching notifications:', err);
      const axiosErr = err as { response?: { status?: number; data?: { message?: string } } };
      // Handle rate limiting
      if (axiosErr.response?.status === 429) {
        backoffDelay.current = Math.min(backoffDelay.current * 2 || 60000, maxBackoff);
      } else {
        setError(axiosErr.response?.data?.message || 'Failed to fetch notifications');
      }
    } finally {
      setIsLoading(false);
      isFetchingNotifications.current = false;
    }
  }, [isAuthenticated]);

  const fetchUnreadCount = useCallback(async () => {
    // Skip if not authenticated, already fetching, or in backoff period
    if (!isAuthenticated || isFetchingUnreadCount.current) {
      return;
    }

    try {
      isFetchingUnreadCount.current = true;
      const response = await api.get('/notifications/unread-count');
      if (response.data.success) {
        setUnreadCount(response.data.data.count);
        backoffDelay.current = 0; // Reset backoff on success
      }
    } catch (err: unknown) {
      console.error('Error fetching unread count:', err);
      const axiosErr = err as { response?: { status?: number } };
      // Handle rate limiting with exponential backoff
      if (axiosErr.response?.status === 429) {
        backoffDelay.current = Math.min(backoffDelay.current * 2 || 60000, maxBackoff);
      }
    } finally {
      isFetchingUnreadCount.current = false;
    }
  }, [isAuthenticated]);

  const markAsRead = useCallback(async (notificationId: number) => {
    try {
      const response = await api.post(`/notifications/${notificationId}/read`);
      if (response.data.success) {
        // Update local state
        setNotifications(prev => 
          prev.map(notification => 
            notification.id === notificationId 
              ? { ...notification, read_at: new Date() }
              : notification
          )
        );
        // Refresh unread count
        await fetchUnreadCount();
      }
    } catch (err: unknown) {
      console.error('Error marking notification as read:', err);
      const axiosErr = err as { response?: { data?: { message?: string } } };
      setError(axiosErr.response?.data?.message || 'Failed to mark notification as read');
    }
  }, [fetchUnreadCount]);

  const markAllAsRead = useCallback(async () => {
    try {
      const response = await api.post('/notifications/mark-all-read');
      if (response.data.success) {
        // Update local state
        setNotifications(prev => 
          prev.map(notification => ({ ...notification, read_at: new Date() }))
        );
        setUnreadCount(0);
      }
    } catch (err: unknown) {
      console.error('Error marking all notifications as read:', err);
      const axiosErr = err as { response?: { data?: { message?: string } } };
      setError(axiosErr.response?.data?.message || 'Failed to mark all notifications as read');
    }
  }, []);

  const deleteNotification = useCallback(async (notificationId: number) => {
    try {
      const response = await api.delete(`/notifications/${notificationId}`);
      if (response.data.success) {
        // Remove from local state
        setNotifications(prev => prev.filter(n => n.id !== notificationId));
        // Refresh unread count
        await fetchUnreadCount();
      }
    } catch (err: unknown) {
      console.error('Error deleting notification:', err);
      const axiosErr = err as { response?: { data?: { message?: string } } };
      setError(axiosErr.response?.data?.message || 'Failed to delete notification');
    }
  }, [fetchUnreadCount]);

  const refreshNotifications = useCallback(() => {
    fetchNotifications();
    fetchUnreadCount();
  }, [fetchNotifications, fetchUnreadCount]);

  // Initial load - only when authenticated
  useEffect(() => {
    if (isAuthenticated) {
      // Network fetch synchronizing with the backend on auth change, not derived state.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      fetchNotifications();
      fetchUnreadCount();
    } else {
      // Reset state when logged out
      setNotifications([]);
      setUnreadCount(0);
      backoffDelay.current = 0;
    }
  }, [isAuthenticated, fetchNotifications, fetchUnreadCount]);

  // Set up polling for real-time updates (every 60 seconds, respects backoff)
  useEffect(() => {
    if (!isAuthenticated) {
      return () => {};
    }

    let timeoutId: ReturnType<typeof setTimeout>;
    let isVisible = !document.hidden;

    const poll = () => {
      // Only poll if tab is visible and not in backoff
      if (isVisible && backoffDelay.current === 0) {
        fetchUnreadCount();
      }

      // Schedule next poll (use backoff delay if rate limited, otherwise 60 seconds)
      const nextDelay = backoffDelay.current > 0 ? backoffDelay.current : 60000;
      timeoutId = setTimeout(poll, nextDelay);
    };

    // Handle visibility changes to pause/resume polling
    const handleVisibilityChange = () => {
      isVisible = !document.hidden;
      if (isVisible && backoffDelay.current === 0) {
        // Tab became visible, fetch immediately if not rate limited
        fetchUnreadCount();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Start polling
    timeoutId = setTimeout(poll, 60000);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isAuthenticated, fetchUnreadCount]);

  // Memoised: without this every consumer re-rendered on each poll tick.
  // All the functions above are useCallback-stable, so this only changes with real state.
  const value = useMemo<NotificationContextType>(() => ({
    notifications,
    unreadCount,
    isLoading,
    error,
    fetchNotifications,
    fetchUnreadCount,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    refreshNotifications,
  }), [
    notifications,
    unreadCount,
    isLoading,
    error,
    fetchNotifications,
    fetchUnreadCount,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    refreshNotifications,
  ]);

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
}; 