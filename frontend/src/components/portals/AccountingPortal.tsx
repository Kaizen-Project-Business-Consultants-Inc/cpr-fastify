import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography,
  CircularProgress
} from '@mui/material';
import DataTable, { DataTableRow } from '../gtacpr/DataTable';
import { PrimaryButton, GhostButton } from '../gtacpr/Buttons';
import ErrorBoundary from '../common/ErrorBoundary';
import { AdminShell, PortalNotFound, LinkButton } from '../gtacpr';
import { formatCurrency, formatDisplayDate as formatDate } from '../../utils/formatters';
import { useClientPagination } from '../../hooks/useClientPagination';
import AccountingDashboard from './accounting/AccountingDashboard';
import PaymentRequestsDashboard from '../accounting/PaymentRequestsDashboard';
import VendorInvoiceManagement from './accounting/VendorInvoiceManagement';
import PaidVendorInvoices from './accounting/PaidVendorInvoices';
import FinancialSummaryView from '../accounting/FinancialSummaryView';

import { Routes, Route, Navigate, useLocation } from 'react-router-dom';

import ReadyForBillingTable from '../tables/ReadyForBillingTable';
import AccountsReceivableTable from '../tables/AccountsReceivableTable';
import TransactionHistoryView from '../views/TransactionHistoryView';
import AgingReportView from '../views/AgingReportView';
import PaymentVerificationView from '../views/PaymentVerificationView';
import PaymentReversalView from '../views/PaymentReversalView';
import InvoiceDetailDialog from '../dialogs/InvoiceDetailDialog';
import RecordPaymentDialog from '../dialogs/RecordPaymentDialog';
import { getBillingQueue, createInvoice, getInvoices, getPendingApprovals, approveInvoice, rejectInvoice, getRejectedInvoices, resubmitInvoice } from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import { useSnackbar } from '../../contexts/SnackbarContext';

interface BillingQueueItem {
  id: number;
  course_type?: string;
  organization_name?: string;
  students_attended?: number;
  [key: string]: unknown;
}

interface Invoice {
  id: number;
  balancedue?: string | number;
  paymentstatus?: string;
  approval_status?: string;
  [key: string]: unknown;
}

// Billing Ready View Component
const ReadyForBillingView: React.FC = () => {
  const [billingQueue, setBillingQueue] = useState<BillingQueueItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const { showSuccess, showError } = useSnackbar();

  React.useEffect(() => {
    const fetchBillingQueue = async () => {
      try {
        setIsLoading(true);
        setError('');
        const response = await getBillingQueue();
        setBillingQueue(response.data || []);
      } catch (error: any) {
        console.error('Error fetching billing queue:', error);
        setError('Failed to load billing queue. Please try again.');
      } finally {
        setIsLoading(false);
      }
    };

    fetchBillingQueue();
  }, []);

  const handleCreateInvoice = async (courseId: string | number) => {
    try {
      const response = await createInvoice(courseId as number);
      showSuccess(response.data.message || 'Invoice created successfully! The course has been removed from the billing queue and moved to the Organizational Receivables Queue.');
      const updatedQueue = await getBillingQueue();
      setBillingQueue(updatedQueue.data || []);
    } catch (error: unknown) {
      const axiosErr = error as { response?: { data?: { error?: { message?: string }; message?: string } }; message?: string };
      const errorMessage = axiosErr.response?.data?.error?.message ||
                          axiosErr.response?.data?.message ||
                          axiosErr.message ||
                          'Failed to create invoice. Please try again.';
      showError(`Invoice creation failed: ${errorMessage}`);
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <ReadyForBillingTable
        courses={billingQueue}
        onCreateInvoice={handleCreateInvoice}
        isLoading={isLoading}
        error={error}
      />
    </Box>
  );
};

// Accounts Receivable View Component
const AccountsReceivableView: React.FC = () => {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [showInvoiceDetailDialog, setShowInvoiceDetailDialog] = useState(false);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<number | null>(null);
  const [showRecordPaymentDialog, setShowRecordPaymentDialog] = useState(false);
  const [selectedInvoiceForPayment, setSelectedInvoiceForPayment] = useState<Invoice | null>(null);
  const { showSuccess, showError } = useSnackbar();
  const { paged: pagedAR, page: arPage, hasNextPage: arHasNext, onPrevPage: onARPrev, onNextPage: onARNext, shownCount: arShown, totalCount: arTotal } = useClientPagination(invoices, 25);

  const fetchInvoices = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      const data = await getInvoices();
      const arInvoices = (data || []).filter((invoice: Invoice) => {
        const balanceDue = parseFloat(String(invoice.balancedue || 0));
        const paymentStatus = invoice.paymentstatus?.toLowerCase();
        const approvalStatus = invoice.approval_status?.toLowerCase();
        return approvalStatus === 'approved' && balanceDue > 0 && paymentStatus !== 'paid';
      });
      setInvoices(arInvoices);
    } catch (err: unknown) {
      const errObj = err as { message?: string };
      setError(errObj.message || 'Failed to load invoices.');
      setInvoices([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetchInvoices();
  }, [fetchInvoices]);

  const handleRecordPaymentClick = (invoice: Invoice) => {
    setSelectedInvoiceForPayment(invoice);
    setShowRecordPaymentDialog(true);
  };

  const handleViewDetailsClick = (invoiceId: string | number) => {
    setSelectedInvoiceId(invoiceId as number);
    setShowInvoiceDetailDialog(true);
  };

  const handleInvoiceDetailDialogClose = () => {
    setShowInvoiceDetailDialog(false);
    setSelectedInvoiceId(null);
  };

  const handleInvoiceActionSuccess = (message: string) => {
    showSuccess(message);
    fetchInvoices();
  };

  const handleInvoiceActionError = (message: string) => {
    showError(message);
  };

  const handleRecordPaymentSuccess = (message: string) => {
    showSuccess(message);
    setShowRecordPaymentDialog(false);
    setSelectedInvoiceForPayment(null);
    fetchInvoices();
  };

  const handleRecordPaymentError = (message: string) => {
    showError(message);
  };

  const handleRecordPaymentDialogClose = () => {
    setShowRecordPaymentDialog(false);
    setSelectedInvoiceForPayment(null);
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <AccountsReceivableTable
        invoices={invoices}
        onRecordPaymentClick={handleRecordPaymentClick}
        onViewDetailsClick={handleViewDetailsClick}
      />

      <InvoiceDetailDialog
        open={showInvoiceDetailDialog}
        onClose={handleInvoiceDetailDialogClose}
        invoiceId={selectedInvoiceId}
        onActionSuccess={handleInvoiceActionSuccess}
        onActionError={handleInvoiceActionError}
        showPostToOrgButton={true}
      />

      <RecordPaymentDialog
        open={showRecordPaymentDialog}
        onClose={handleRecordPaymentDialogClose}
        invoice={selectedInvoiceForPayment}
        onSuccess={handleRecordPaymentSuccess}
        onError={handleRecordPaymentError}
      />
    </Box>
  );
};

// Pending Approvals View Component
const PAGE_SIZE = 25;

const PendingApprovalsView: React.FC = () => {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [showInvoiceDetailDialog, setShowInvoiceDetailDialog] = useState(false);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<number | null>(null);
  const { showSuccess, showError } = useSnackbar();

  const hasNextPage = page * PAGE_SIZE < totalCount;
  const onPrevPage = () => { const p = Math.max(1, page - 1); setPage(p); fetchPendingApprovals(p); };
  const onNextPage = () => { const p = page + 1; setPage(p); fetchPendingApprovals(p); };

  const fetchPendingApprovals = useCallback(async (p = 1) => {
    setIsLoading(true);
    setError('');
    try {
      const result = await getPendingApprovals({ page: p, limit: PAGE_SIZE });
      setInvoices(result.data || []);
      setTotalCount(result.pagination?.total ?? (result.data || []).length);
    } catch (err: unknown) {
      const errObj = err as { message?: string };
      setError(errObj.message || 'Failed to load pending approvals.');
      setInvoices([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPendingApprovals();
  }, [fetchPendingApprovals]);

  const handleApprove = async (invoiceId: number) => {
    try {
      const result = await approveInvoice(invoiceId);
      showSuccess(result.message || 'Invoice approved successfully');
      fetchPendingApprovals();
      handleInvoiceDetailDialogClose();
    } catch (err: unknown) {
      const errObj = err as { response?: { data?: { error?: { message?: string } } }; message?: string };
      showError(errObj.response?.data?.error?.message || errObj.message || 'Failed to approve invoice');
    }
  };

  const handleReject = async (invoiceId: number, reason: string) => {
    try {
      const result = await rejectInvoice(invoiceId, reason);
      showSuccess(result.message || 'Invoice rejected and sent back to accountant for review');
      fetchPendingApprovals();
      handleInvoiceDetailDialogClose();
    } catch (err: unknown) {
      const errObj = err as { response?: { data?: { error?: { message?: string } } }; message?: string };
      showError(errObj.response?.data?.error?.message || errObj.message || 'Failed to reject invoice');
    }
  };

  const handleReview = (invoiceId: number) => {
    setSelectedInvoiceId(invoiceId);
    setShowInvoiceDetailDialog(true);
  };

  const handleInvoiceDetailDialogClose = () => {
    setShowInvoiceDetailDialog(false);
    setSelectedInvoiceId(null);
  };

  const handleInvoiceActionSuccess = (message: string) => {
    showSuccess(message);
    fetchPendingApprovals();
    handleInvoiceDetailDialogClose();
  };

  const handleInvoiceActionError = (message: string) => {
    showError(message);
  };

  if (isLoading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="200px">
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Box>
        <Typography color="error">{error}</Typography>
      </Box>
    );
  }

  const pendingColumns = [
    { key: 'invoice', label: 'INVOICE #', width: '0.8fr' },
    { key: 'org', label: 'ORGANIZATION', width: '1fr' },
    { key: 'course', label: 'COURSE', width: '1fr' },
    { key: 'date', label: 'DATE', width: '0.7fr' },
    { key: 'amount', label: 'AMOUNT', width: '0.7fr', align: 'right' as const },
    { key: 'action', label: '', width: '0.5fr', align: 'right' as const },
  ];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {invoices.length === 0 ? (
        <Box sx={{ bgcolor: (theme) => theme.palette.background.paper, border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', p: 6, textAlign: 'center' }}>
          <Typography sx={{ fontSize: 14, fontWeight: 600, color: (theme) => theme.palette.text.secondary }}>No invoices pending approval</Typography>
        </Box>
      ) : (
        <DataTable columns={pendingColumns} shownCount={invoices.length} totalCount={totalCount} page={page - 1} onPrevPage={onPrevPage} onNextPage={onNextPage} hasNextPage={hasNextPage}>
          {invoices.map((invoice) => (
            <DataTableRow key={invoice.id} columns={pendingColumns}>
              <Typography sx={{ fontSize: 13, fontWeight: 600, color: (theme) => theme.palette.text.primary }}>{(invoice as Record<string, unknown>).invoice_number as string || '-'}</Typography>
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{(invoice as Record<string, unknown>).organization_name as string || '-'}</Typography>
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{(invoice as Record<string, unknown>).course_type_name as string || '-'}</Typography>
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{formatDate((invoice as Record<string, unknown>).invoice_date as string)}</Typography>
              <Typography sx={{ fontSize: 13, fontWeight: 600, color: (theme) => theme.palette.text.primary, fontFamily: 'monospace', textAlign: 'right' }}>
                {formatCurrency(parseFloat(String((invoice as Record<string, unknown>).base_cost || 0)) + parseFloat(String((invoice as Record<string, unknown>).tax_amount || 0)))}
              </Typography>
              <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                <LinkButton onClick={() => handleReview(invoice.id)}>Review</LinkButton>
              </Box>
            </DataTableRow>
          ))}
        </DataTable>
      )}

      <InvoiceDetailDialog
        open={showInvoiceDetailDialog}
        onClose={handleInvoiceDetailDialogClose}
        invoiceId={selectedInvoiceId}
        onActionSuccess={handleInvoiceActionSuccess}
        onActionError={handleInvoiceActionError}
        showPostToOrgButton={false}
        showApprovalActions={true}
        onApprove={handleApprove}
        onReject={handleReject}
      />
    </Box>
  );
};

// Rejected Invoices View Component
const RejectedInvoicesView: React.FC = () => {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [showInvoiceDetailDialog, setShowInvoiceDetailDialog] = useState(false);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<number | null>(null);
  const { showSuccess, showError } = useSnackbar();

  const hasNextPage = page * PAGE_SIZE < totalCount;
  const onPrevPage = () => { const p = Math.max(1, page - 1); setPage(p); fetchRejectedInvoices(p); };
  const onNextPage = () => { const p = page + 1; setPage(p); fetchRejectedInvoices(p); };

  const fetchRejectedInvoices = useCallback(async (p = 1) => {
    setIsLoading(true);
    setError('');
    try {
      const result = await getRejectedInvoices({ page: p, limit: PAGE_SIZE });
      setInvoices(result.data || []);
      setTotalCount(result.pagination?.total ?? (result.data || []).length);
    } catch (err: unknown) {
      const errObj = err as { message?: string };
      setError(errObj.message || 'Failed to load rejected invoices.');
      setInvoices([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRejectedInvoices();
  }, [fetchRejectedInvoices]);

  const handleViewDetails = (invoiceId: number) => {
    setSelectedInvoiceId(invoiceId);
    setShowInvoiceDetailDialog(true);
  };

  const handleResubmit = async (invoiceId: number) => {
    try {
      const result = await resubmitInvoice(invoiceId);
      showSuccess(result.message || 'Invoice resubmitted for approval');
      fetchRejectedInvoices();
    } catch (err: unknown) {
      const errObj = err as { response?: { data?: { error?: { message?: string } } }; message?: string };
      showError(errObj.response?.data?.error?.message || errObj.message || 'Failed to resubmit invoice');
    }
  };

  const handleInvoiceDetailDialogClose = () => {
    setShowInvoiceDetailDialog(false);
    setSelectedInvoiceId(null);
  };

  const handleInvoiceActionSuccess = (message: string) => {
    showSuccess(message);
    fetchRejectedInvoices();
    handleInvoiceDetailDialogClose();
  };

  const handleInvoiceActionError = (message: string) => {
    showError(message);
  };

  if (isLoading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="200px">
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Box>
        <Typography color="error">{error}</Typography>
      </Box>
    );
  }

  const rejectedColumns = [
    { key: 'invoice', label: 'INVOICE #', width: '0.7fr' },
    { key: 'org', label: 'ORGANIZATION', width: '0.9fr' },
    { key: 'course', label: 'COURSE', width: '0.8fr' },
    { key: 'amount', label: 'AMOUNT', width: '0.6fr', align: 'right' as const },
    { key: 'rejected', label: 'REJECTED', width: '0.7fr' },
    { key: 'reason', label: 'REASON', width: '1fr' },
    { key: 'actions', label: '', width: '0.8fr', align: 'right' as const },
  ];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {invoices.length === 0 ? (
        <Box sx={{ bgcolor: (theme) => theme.palette.background.paper, border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', p: 6, textAlign: 'center' }}>
          <Typography sx={{ fontSize: 14, fontWeight: 600, color: (theme) => theme.palette.text.secondary }}>No rejected invoices</Typography>
        </Box>
      ) : (
        <DataTable columns={rejectedColumns} shownCount={invoices.length} totalCount={totalCount} page={page - 1} onPrevPage={onPrevPage} onNextPage={onNextPage} hasNextPage={hasNextPage}>
          {invoices.map((invoice) => (
            <DataTableRow key={invoice.id} columns={rejectedColumns}>
              <Typography sx={{ fontSize: 13, fontWeight: 600, color: (theme) => theme.palette.text.primary }}>{(invoice as Record<string, unknown>).invoiceNumber as string || '-'}</Typography>
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{(invoice as Record<string, unknown>).organizationName as string || '-'}</Typography>
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{(invoice as Record<string, unknown>).courseTypeName as string || '-'}</Typography>
              <Typography sx={{ fontSize: 13, fontWeight: 600, color: (theme) => theme.palette.text.primary, fontFamily: 'monospace', textAlign: 'right' }}>
                {formatCurrency(parseFloat(String((invoice as Record<string, unknown>).baseCost || 0)) + parseFloat(String((invoice as Record<string, unknown>).taxAmount || 0)))}
              </Typography>
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{formatDate((invoice as Record<string, unknown>).rejectedAt as string)}</Typography>
              <Typography sx={{ fontSize: 12, color: '#CC1F1F', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={(invoice as Record<string, unknown>).rejectionReason as string}>
                {(invoice as Record<string, unknown>).rejectionReason as string || '-'}
              </Typography>
              <Box sx={{ display: 'flex', gap: 1.5, justifyContent: 'flex-end' }}>
                <LinkButton onClick={() => handleViewDetails(invoice.id)}>View</LinkButton>
                <LinkButton onClick={() => handleResubmit(invoice.id)} sx={{ color: '#16A34A' }}>Resubmit</LinkButton>
              </Box>
            </DataTableRow>
          ))}
        </DataTable>
      )}

      <InvoiceDetailDialog
        open={showInvoiceDetailDialog}
        onClose={handleInvoiceDetailDialogClose}
        invoiceId={selectedInvoiceId}
        onActionSuccess={handleInvoiceActionSuccess}
        onActionError={handleInvoiceActionError}
        showPostToOrgButton={false}
      />
    </Box>
  );
};

const pageConfig: Record<string, { eyebrow: string; title: string }> = {
  dashboard: { eyebrow: 'Overview', title: 'Financial Dashboard' },
  aging: { eyebrow: 'Financial', title: 'Aging Report' },
  'financial-summary': { eyebrow: 'Financial', title: 'Financial Summary' },
  billing: { eyebrow: 'Billing', title: 'Ready for Billing' },
  'pending-approvals': { eyebrow: 'Billing', title: 'Pending Approvals' },
  'rejected-invoices': { eyebrow: 'Billing', title: 'Rejected Invoices' },
  receivables: { eyebrow: 'Billing', title: 'Organization Receivables' },
  history: { eyebrow: 'Billing', title: 'Invoice History' },
  'payment-requests': { eyebrow: 'Payments', title: 'Instructor Payment Requests' },
  verification: { eyebrow: 'Payments', title: 'Payment Verification' },
  reversal: { eyebrow: 'Payments', title: 'Payment Reversal' },
  'vendor-invoices': { eyebrow: 'Vendors', title: 'Vendor Invoices' },
  'paid-vendor-invoices': { eyebrow: 'Vendors', title: 'Paid Vendor Invoices' },
};

const navItems = [
  { label: 'Financial Dashboard', path: '/accounting/dashboard' },
  { label: 'Aging Report', path: '/accounting/aging' },
  { label: 'Financial Summary', path: '/accounting/financial-summary' },
  { label: 'Ready for Billing', path: '/accounting/billing' },
  { label: 'Pending Approvals', path: '/accounting/pending-approvals' },
  { label: 'Rejected Invoices', path: '/accounting/rejected-invoices' },
  { label: 'Organization Receivables', path: '/accounting/receivables' },
  { label: 'Invoice History', path: '/accounting/history' },
  { label: 'Instructor Payments', path: '/accounting/payment-requests' },
  { label: 'Payment Verification', path: '/accounting/verification' },
  { label: 'Payment Reversal', path: '/accounting/reversal' },
  { label: 'Vendor Invoices', path: '/accounting/vendor-invoices' },
  { label: 'Paid Vendor Invoices', path: '/accounting/paid-vendor-invoices' },
];

const AccountingPortal: React.FC = () => {
  const { user, loading } = useAuth();
  const location = useLocation();
  const currentPath = location.pathname.split('/').pop() || 'dashboard';
  const config = pageConfig[currentPath] || { eyebrow: 'Accounting', title: 'Accounting Portal' };

  const handleError = (error: Error, errorInfo: React.ErrorInfo) => {
    console.error('[AccountingPortal] Error caught by boundary:', error, errorInfo);
  };

  // Role-based access control - redirect non-accounting users
  if (user && user.role === 'vendor') {
    return <Navigate to="/vendor/dashboard" replace />;
  }

  if (user && !['accountant', 'admin'].includes(user.role)) {
    const roleRoutes: Record<string, string> = {
      instructor: '/instructor/dashboard',
      organization: '/organization/dashboard',
      superadmin: '/superadmin/dashboard',
      sysadmin: '/sysadmin/dashboard',
      hr: '/hr',
      vendor: '/vendor/dashboard',
    };
    const targetRoute = roleRoutes[user.role] || '/vendor/dashboard';
    return <Navigate to={targetRoute} replace />;
  }

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="60vh">
        <CircularProgress />
      </Box>
    );
  }

  return (
    <ErrorBoundary context="accounting_portal" onError={handleError}>
      <AdminShell
        eyebrow={config.eyebrow}
        title={config.title}
        portalName="Accounting"
        basePath="/accounting/dashboard"
        navItems={navItems}
      >
        <Routes>
          <Route path="dashboard" element={<AccountingDashboard />} />
          <Route path="aging" element={<AgingReportView />} />
          <Route path="financial-summary" element={<FinancialSummaryView />} />
          <Route path="billing" element={<ReadyForBillingView />} />
          <Route path="pending-approvals" element={<PendingApprovalsView />} />
          <Route path="rejected-invoices" element={<RejectedInvoicesView />} />
          <Route path="receivables" element={<AccountsReceivableView />} />
          <Route path="history" element={<TransactionHistoryView />} />
          <Route path="payment-requests" element={<PaymentRequestsDashboard />} />
          <Route path="verification" element={<PaymentVerificationView />} />
          <Route path="reversal" element={<PaymentReversalView />} />
          <Route path="vendor-invoices" element={<VendorInvoiceManagement />} />
          <Route path="paid-vendor-invoices" element={<PaidVendorInvoices />} />
          <Route path="" element={<Navigate to="dashboard" replace />} />
          <Route path="*" element={<PortalNotFound homePath="/accounting/dashboard" />} />
        </Routes>
      </AdminShell>
    </ErrorBoundary>
  );
};

export default AccountingPortal;
