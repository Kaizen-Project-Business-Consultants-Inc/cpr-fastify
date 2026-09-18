import React, { useState, useEffect, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../../contexts/AuthContext';
import { useNavigate, useLocation } from 'react-router-dom';
import { api } from '../../../services/api';
import logger from '../../../utils/logger';
import analytics from '../../../services/analytics';
import ErrorBoundary from '../../common/ErrorBoundary';
import OrganizationPortal from './OrganizationPortal';
import { CircularProgress, Alert, Box } from '@mui/material';

// TypeScript interfaces
interface OrganizationData {
  id: number;
  name: string;
  contact_email: string;
  contact_phone: string;
  address: string;
  total_courses: number;
  total_students: number;
  active_instructors: number;
}

interface Course {
  id: string | number;
  requestSubmittedDate: string;
  scheduledDate: string;
  courseTypeName: string;
  location: string;
  registeredStudents: number;
  status: string;
  instructor: string;
  notes?: string;
}

interface Invoice {
  id: number;
  invoiceNumber: string;
  createdAt: string;
  dueDate: string;
  amount: number;
  status: string;
  studentsBilled: number;
  paidDate?: string;
  location: string;
  courseTypeName: string;
  courseDate: string;
  courseRequestId: number;
  amountPaid: number;
  balanceDue: number;
}

interface BillingSummary {
  total_invoices: number;
  pending_invoices: number;
  overdue_invoices: number;
  paid_invoices: number;
  payment_submitted: number;
  total_amount: number;
  pending_amount: number;
  overdue_amount: number;
  paid_amount: number;
  recent_invoices: Invoice[];
}

const OrganizationPortalContainer: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  
  // Navigation state
  const [currentView, setCurrentView] = useState('dashboard');
  
  // Error handling
  const [error, setError] = useState<string | null>(null);

  // Analytics tracking
  useEffect(() => {
    if (user) {
      analytics.setUser(user.id || user.username, {
        role: user.role,
        portal: 'organization',
        organizationId: user.organizationId,
        organizationName: user.organizationName,
      });
    }
  }, [user]);

  useEffect(() => {
    analytics.trackPageView(`organization_${currentView}`, {
      portal: 'organization',
      view: currentView,
      organizationId: user?.organizationId,
    });
  }, [currentView, user?.organizationId]);

  // Error handler for error boundaries
  const handleError = useCallback((error: Error, errorInfo: React.ErrorInfo) => {
    logger.error('Organization Portal Error:', error, errorInfo);
    analytics.trackError(error, 'organization_portal', {
      componentStack: errorInfo.componentStack,
      view: currentView,
      organizationId: user?.organizationId,
    });
    setError(error.message);
  }, [currentView, user?.organizationId]);

  // Data fetching with React Query
  const { data: organizationData, isLoading: orgLoading } = useQuery({
    queryKey: ['organization-data', user?.organizationId],
    queryFn: async () => {
      const response = await api.get('/organization/profile', {
        params: { _t: Date.now() }
      });
      // The API wraps the record as { success, data }; unwrap so views get the organization itself
      return response.data?.data ?? response.data;
    },
    enabled: !!user?.organizationId,
  });

  const { data: courses, isLoading: coursesLoading } = useQuery({
    queryKey: ['organization-courses', user?.organizationId],
    queryFn: async () => {
      const response = await api.get('/organization/courses', {
        params: { _t: Date.now() }
      });
      return Array.isArray(response.data.data) ? response.data.data : [];
    },
    enabled: !!user?.organizationId,
  });

  const { data: archivedCourses, isLoading: archivedLoading } = useQuery({
    queryKey: ['organization-archived-courses', user?.organizationId],
    queryFn: async () => {
      const response = await api.get('/organization/archive', {
        params: { _t: Date.now() }
      });
      return Array.isArray(response.data.data) ? response.data.data : [];
    },
    enabled: !!user?.organizationId,
  });

  const { data: billingSummary, isLoading: billingLoading } = useQuery({
    queryKey: ['organization-billing-summary', user?.organizationId],
    queryFn: async () => {
      const response = await api.get('/organization/billing-summary', {
        params: { _t: Date.now() }
      });
      return response.data.data;
    },
    enabled: !!user?.organizationId,
  });

  const { data: invoices, isLoading: invoicesLoading } = useQuery({
    queryKey: ['organization-invoices', user?.organizationId],
    queryFn: async () => {
      const response = await api.get('/organization/invoices', {
        params: { _t: Date.now() }
      });
      const data = response.data.data;
      // Return invoices array (backend now returns 'id' directly)
      if (data && Array.isArray(data.invoices)) {
        return data.invoices;
      }
      return [];
    },
    enabled: !!user?.organizationId,
  });

  const { data: paidInvoices, isLoading: paidInvoicesLoading } = useQuery({
    queryKey: ['organization-paid-invoices', user?.organizationId],
    queryFn: async () => {
      const response = await api.get('/organization/paid-invoices', {
        params: { _t: Date.now() }
      });
      const data = response.data.data;
      // Return invoices array (backend now returns 'id' directly)
      if (data && Array.isArray(data.invoices)) {
        return data.invoices;
      }
      return [];
    },
    enabled: !!user?.organizationId,
  });

  const { data: paidInvoicesSummary, isLoading: paidInvoicesSummaryLoading } = useQuery({
    queryKey: ['organization-paid-invoices-summary', user?.organizationId],
    queryFn: async () => {
      const response = await api.get('/organization/paid-invoices-summary', {
        params: { _t: Date.now() }
      });
      return response.data.data;
    },
    enabled: !!user?.organizationId,
  });

  // Handle view changes
  const handleViewChange = useCallback((view: string) => {
    setCurrentView(view);
    analytics.trackOrganizationAction('navigation', {
      from: currentView,
      to: view,
      organizationId: user?.organizationId,
    });
  }, [currentView, user?.organizationId]);

  // Handle logout
  const handleLogout = useCallback(() => {
    const firstName = user?.username || 'Org User';
    const logoutMessage = `Good Bye ${firstName}, Have a Pleasant Day!`;
    
    analytics.trackOrganizationAction('logout', {
      organizationId: user?.organizationId,
    });

    setTimeout(() => {
      logout();
      navigate('/');
    }, 1500);
  }, [user, logout, navigate]);

  // Loading state
  const isLoading = orgLoading || coursesLoading || billingLoading || invoicesLoading || archivedLoading || paidInvoicesLoading || paidInvoicesSummaryLoading;

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      </Box>
    );
  }

  return (
    <ErrorBoundary onError={handleError}>
              <OrganizationPortal
          user={user as never}
          organizationData={organizationData}
          courses={courses || []}
          archivedCourses={archivedCourses || []}
          invoices={invoices || []}
          paidInvoices={paidInvoices || []}
          paidInvoicesSummary={paidInvoicesSummary}
          billingSummary={billingSummary}
          loading={isLoading}
          error={error}
          onLogout={handleLogout}
        />
    </ErrorBoundary>
  );
};

export default OrganizationPortalContainer; 