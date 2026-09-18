import React, { useState } from 'react';
import {
  Box,
  CircularProgress,
  Alert,
} from '@mui/material';
import {
  Dashboard as DashboardIcon,
  Receipt as BillingIcon,
  Person as ProfileIcon,
  Analytics as AnalyticsIcon,
  Event as EventIcon,
  School as CoursesIconAlt,
  Archive as ArchiveIcon,
  AttachMoney as PricingIcon,
  CheckCircle as CheckCircleIcon,
} from '@mui/icons-material';
import { useQueryClient } from '@tanstack/react-query';
import OrganizationLayout from './OrganizationLayout';
import OrganizationDashboard from './views/OrganizationDashboard';
import OrganizationCourses from './views/OrganizationCourses';
import OrganizationBilling from './views/OrganizationBilling';
import OrganizationProfile from './views/OrganizationProfile';
import OrganizationAnalytics from './views/OrganizationAnalytics';
import ScheduleCourseForm from '../../forms/ScheduleCourseForm';
import CSVUploadDialog from '../../dialogs/CSVUploadDialog';
import OrganizationArchive from './views/OrganizationArchive';
import OrganizationPricing from './views/OrganizationPricing';
import OrganizationPaidInvoices from './views/OrganizationPaidInvoices';
import { Routes, Route, Navigate } from 'react-router-dom';
import { PortalNotFound } from '../../gtacpr';

// TypeScript interfaces - flexible to accommodate different data shapes
interface User {
  id: number;
  username: string;
  role: string;
  organizationId?: number;
  organizationName?: string;
  [key: string]: unknown;
}

interface OrganizationData {
  id: number;
  name: string;
  contact_email?: string;
  contact_phone?: string;
  address?: string;
  total_courses?: number;
  total_students?: number;
  active_instructors?: number;
  [key: string]: unknown;
}

interface Course {
  id: string | number;
  requestSubmittedDate?: string;
  dateRequested?: string;
  scheduledDate?: string;
  courseTypeName?: string;
  location?: string;
  registeredStudents?: number;
  status?: string;
  instructor?: string;
  notes?: string;
  [key: string]: unknown;
}

interface Invoice {
  id: number;
  invoiceNumber?: string;
  invoice_number?: string;
  createdAt?: string;
  created_at?: string;
  dueDate?: string;
  due_date?: string;
  amount?: number;
  status?: string;
  studentsBilled?: number;
  students_billed?: number;
  paidDate?: string;
  location?: string;
  courseTypeName?: string;
  courseDate?: string;
  courseRequestId?: number;
  amountPaid?: number;
  balanceDue?: number;
  [key: string]: unknown;
}

interface BillingSummary {
  total_invoices?: number;
  pending_invoices?: number;
  overdue_invoices?: number;
  paid_invoices?: number;
  payment_submitted?: number;
  total_amount?: number;
  pending_amount?: number;
  overdue_amount?: number;
  paid_amount?: number;
  recent_invoices?: Invoice[];
  [key: string]: unknown;
}

interface PaidInvoicesSummary {
  total_paid?: number;
  total_amount?: number;
  invoices_count?: number;
  total_paid_invoices?: number;
  total_paid_amount?: number;
  average_paid_amount?: number;
  paid_last_30_days?: number;
  amount_paid_last_30_days?: number;
  [key: string]: unknown;
}

interface OrganizationPortalProps {
  user: User | null;
  organizationData: OrganizationData | undefined;
  courses: Course[];
  archivedCourses: Course[];
  invoices: Invoice[];
  paidInvoices: Invoice[];
  paidInvoicesSummary: PaidInvoicesSummary | undefined;
  billingSummary: BillingSummary | undefined;
  loading: boolean;
  error: string | null;
  onLogout: () => void;
}

const drawerWidth = 240;

const OrganizationPortal: React.FC<OrganizationPortalProps> = ({
  user,
  organizationData,
  courses,
  archivedCourses,
  invoices,
  paidInvoices,
  paidInvoicesSummary,
  billingSummary,
  loading,
  error,
  // currentView,
  // onViewChange,
  onLogout,
}) => {
  const queryClient = useQueryClient();
  
  // State for CSV upload dialog
  const [csvDialogOpen, setCsvDialogOpen] = useState(false);
  const [selectedCourseId, setSelectedCourseId] = useState<string | number | null>(null);
  // State for success message
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Navigation items
  const navigationItems = [
    { id: 'dashboard', label: 'Dashboard', icon: <DashboardIcon /> },
    { id: 'courses', label: 'My Courses', icon: <CoursesIconAlt /> },
    { id: 'archive', label: 'Archive', icon: <ArchiveIcon /> },
    { id: 'schedule', label: 'Schedule a Course', icon: <EventIcon /> },
    { id: 'billing', label: 'Bills Payable', icon: <BillingIcon /> },
    { id: 'paid-invoices', label: 'Paid Invoices', icon: <CheckCircleIcon /> },
    { id: 'pricing', label: 'Pricing', icon: <PricingIcon /> },
    { id: 'profile', label: 'Profile', icon: <ProfileIcon /> },
    { id: 'analytics', label: 'Analytics', icon: <AnalyticsIcon /> },
  ];

  // Handle course scheduled
  const handleCourseScheduled = () => {
    // Show success message
    setSuccessMessage('Course scheduled successfully! Your course request has been submitted.');
    
    // Refresh courses data using React Query instead of page reload
    queryClient.invalidateQueries({ queryKey: ['organization-courses', user?.organizationId] });
    queryClient.invalidateQueries({ queryKey: ['organization-data', user?.organizationId] });
    
    // Clear success message after 5 seconds
    setTimeout(() => {
      setSuccessMessage(null);
    }, 5000);
    
    // Switch to courses view to show the updated list
    // onViewChange('courses'); // This line is removed as per the edit hint
  };

  // Handle view students click
  const handleViewStudentsClick = (_courseId: string | number) => {
    // TODO: Implement view students functionality
    // This could open a dialog or navigate to a student list view
  };

  // Handle upload students click
  const handleUploadStudentsClick = (courseId: string | number) => {
    setSelectedCourseId(courseId);
    setCsvDialogOpen(true);
  };

  // Handle CSV upload success - accepts UploadResult from CSVUploadDialog
  const handleCSVUploadSuccess = (_data: { fileName: string; content: string; parsed: unknown; response: unknown }) => {

    // Refresh the courses data to show updated student count
    queryClient.invalidateQueries({ queryKey: ['organization-courses', user?.organizationId] });

    setCsvDialogOpen(false);
    setSelectedCourseId(null);
  };

  // Handle header refresh — invalidate all org queries
  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['organization-data', user?.organizationId] });
    queryClient.invalidateQueries({ queryKey: ['organization-courses', user?.organizationId] });
    queryClient.invalidateQueries({ queryKey: ['organization-archived-courses', user?.organizationId] });
    queryClient.invalidateQueries({ queryKey: ['organization-billing-summary', user?.organizationId] });
    queryClient.invalidateQueries({ queryKey: ['organization-invoices', user?.organizationId] });
    queryClient.invalidateQueries({ queryKey: ['organization-paid-invoices', user?.organizationId] });
    queryClient.invalidateQueries({ queryKey: ['organization-paid-invoices-summary', user?.organizationId] });
  };

  // Handle payment success - refresh all invoice-related data
  const handlePaymentSuccess = () => {
    // Refresh all invoice-related queries
    queryClient.invalidateQueries({ queryKey: ['organization-invoices', user?.organizationId] });
    queryClient.invalidateQueries({ queryKey: ['organization-billing-summary', user?.organizationId] });
    queryClient.invalidateQueries({ queryKey: ['organization-paid-invoices', user?.organizationId] });
    queryClient.invalidateQueries({ queryKey: ['organization-paid-invoices-summary', user?.organizationId] });
  };


  return (
    <>
      <OrganizationLayout
        user={user}
        onLogout={onLogout}
        onRefresh={handleRefresh}
        navigationItems={navigationItems}
        drawerWidth={drawerWidth}
      >
        <Box sx={{ flexGrow: 1, p: 3 }}>
          {/* Success Message */}
          {successMessage && (
            <Alert 
              severity="success" 
              sx={{ mb: 3 }}
              onClose={() => setSuccessMessage(null)}
            >
              {successMessage}
            </Alert>
          )}

          {/* Route-based rendering - use type assertions to handle interface differences across components */}
          <Routes>
            <Route path="dashboard" element={
              loading ? <CircularProgress /> :
              error ? <Alert severity="error">{error}</Alert> :
              <OrganizationDashboard organizationData={organizationData as never} courses={courses as never} archivedCourses={archivedCourses as never} billingSummary={billingSummary as never} />
            } />
            <Route path="courses" element={
              loading ? <CircularProgress /> :
              error ? <Alert severity="error">{error}</Alert> :
              <OrganizationCourses courses={courses as never} onViewStudentsClick={handleViewStudentsClick} onUploadStudentsClick={handleUploadStudentsClick} />
            } />
            <Route path="archive" element={
              loading ? <CircularProgress /> :
              error ? <Alert severity="error">{error}</Alert> :
              <OrganizationArchive courses={archivedCourses as never} onViewStudentsClick={handleViewStudentsClick} />
            } />
            <Route path="schedule" element={<ScheduleCourseForm onCourseScheduled={handleCourseScheduled} />} />
            <Route path="billing" element={
              loading ? <CircularProgress /> :
              error ? <Alert severity="error">{error}</Alert> :
              <OrganizationBilling invoices={invoices as never} billingSummary={billingSummary as never} organizationData={organizationData as never} onPaymentSuccess={handlePaymentSuccess} />
            } />
            <Route path="paid-invoices" element={
              loading ? <CircularProgress /> :
              error ? <Alert severity="error">{error}</Alert> :
              <OrganizationPaidInvoices invoices={paidInvoices as never} paidInvoicesSummary={paidInvoicesSummary as never} />
            } />
            <Route path="profile" element={<OrganizationProfile organizationData={organizationData as never} />} />
            <Route path="pricing" element={<OrganizationPricing organizationId={user?.organizationId || 0} />} />
            <Route path="analytics" element={<OrganizationAnalytics courses={courses as never} archivedCourses={archivedCourses as never} invoices={invoices as never} billingSummary={billingSummary as never} organizationData={organizationData as never} />} />
            <Route path="" element={<Navigate to="dashboard" replace />} />
            <Route path="*" element={<PortalNotFound homePath="/organization/dashboard" />} />
          </Routes>
        </Box>
      </OrganizationLayout>

      <CSVUploadDialog
        open={csvDialogOpen}
        onClose={() => {
          setCsvDialogOpen(false);
          setSelectedCourseId(null);
        }}
        onUploadSuccess={handleCSVUploadSuccess}
        title={`Upload Students for Course ${selectedCourseId}`}
        description="Select a CSV file containing student information (first_name, last_name, email)"
        courseRequestId={selectedCourseId ? Number(selectedCourseId) : undefined}
        organizationId={user?.organizationId}
      />
    </>
  );
};

export default OrganizationPortal; 