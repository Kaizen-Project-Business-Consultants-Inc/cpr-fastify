import React, { createContext, useContext, useEffect, useState, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { WS_URL } from '../config';

interface RealtimeContextType {
  isConnected: boolean;
  lastUpdate: Date | null;
}

const RealtimeContext = createContext<RealtimeContextType>({
  isConnected: false,
  lastUpdate: null,
});

export function useRealtime() {
  const context = useContext(RealtimeContext);
  if (context === undefined) {
    throw new Error('useRealtime must be used within a RealtimeProvider');
  }
  return context;
}

function invalidateCourseQueries(queryClient: ReturnType<typeof useQueryClient>, type?: string) {
  switch (type) {
    case 'course_completed':
      queryClient.invalidateQueries({ queryKey: ['confirmedCourses'] });
      queryClient.invalidateQueries({ queryKey: ['completedCourses'] });
      queryClient.invalidateQueries({ queryKey: ['classes'] });
      break;
    case 'course_cancelled':
      queryClient.invalidateQueries({ queryKey: ['pendingCourses'] });
      queryClient.invalidateQueries({ queryKey: ['confirmedCourses'] });
      break;
    case 'course_assigned':
    case 'course_rescheduled':
      queryClient.invalidateQueries({ queryKey: ['pendingCourses'] });
      queryClient.invalidateQueries({ queryKey: ['confirmedCourses'] });
      queryClient.invalidateQueries({ queryKey: ['instructors'] });
      queryClient.invalidateQueries({ queryKey: ['organization-courses'] });
      queryClient.invalidateQueries({ queryKey: ['organization-archived-courses'] });
      queryClient.invalidateQueries({ queryKey: ['instructor', 'classes'] });
      queryClient.invalidateQueries({ queryKey: ['instructor', 'classes', 'today'] });
      queryClient.invalidateQueries({ queryKey: ['instructor', 'classes', 'active'] });
      break;
    default:
      queryClient.invalidateQueries({ queryKey: ['pendingCourses'] });
      queryClient.invalidateQueries({ queryKey: ['confirmedCourses'] });
      queryClient.invalidateQueries({ queryKey: ['completedCourses'] });
  }
}

function invalidatePaymentQueries(queryClient: ReturnType<typeof useQueryClient>, type?: string) {
  switch (type) {
    case 'payment_verified':
    case 'payment_rejected':
      queryClient.invalidateQueries({ queryKey: ['organization-invoices'] });
      queryClient.invalidateQueries({ queryKey: ['organization-paid-invoices'] });
      queryClient.invalidateQueries({ queryKey: ['organization-paid-invoices-summary'] });
      queryClient.invalidateQueries({ queryKey: ['organization-billing-summary'] });
      queryClient.invalidateQueries({ queryKey: ['organization-payment-summary'] });
      queryClient.invalidateQueries({ queryKey: ['pending-payment-verifications'] });
      queryClient.invalidateQueries({ queryKey: ['accounting-invoices'] });
      break;
    default:
      queryClient.invalidateQueries({ queryKey: ['organization-invoices'] });
      queryClient.invalidateQueries({ queryKey: ['organization-billing-summary'] });
      queryClient.invalidateQueries({ queryKey: ['pending-payment-verifications'] });
  }
}

export const RealtimeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isConnected, setIsConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const queryClient = useQueryClient();

  // SSE-based real-time updates (WebSocket removed — Passenger can't maintain socket state)
  useEffect(() => {
    const eventSource = new EventSource(`${WS_URL}/api/v1/events`);

    eventSource.onopen = () => setIsConnected(true);

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      setLastUpdate(new Date());

      if (data.type === 'courseStatusChanged') {
        invalidateCourseQueries(queryClient, data.data?.type || data.type);
      } else if (data.type === 'paymentStatusChanged') {
        invalidatePaymentQueries(queryClient, data.data?.type || data.type);
      } else {
        queryClient.invalidateQueries({ queryKey: ['pendingCourses'] });
        queryClient.invalidateQueries({ queryKey: ['confirmedCourses'] });
      }
    };

    eventSource.onerror = () => {
      setIsConnected(false);
      eventSource.close();
    };

    return () => eventSource.close();
  }, [queryClient]);

  const value = useMemo(() => ({ isConnected, lastUpdate }), [isConnected, lastUpdate]);

  return (
    <RealtimeContext.Provider value={value}>
      {children}
    </RealtimeContext.Provider>
  );
};
