import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography,
  CircularProgress
} from '@mui/material';
import DataTable, { DataTableRow } from '../gtacpr/DataTable';
import ErrorBoundary from '../common/ErrorBoundary';
import { AdminShell, PortalNotFound, LinkButton } from '../gtacpr';
import { formatCurrency, formatDisplayDate as formatDate } from '../../utils/formatters';
import { getErrorMessage } from '../../utils/errorMessage';
import AccountingDashboard from './accounting/AccountingDashboard';
import PaymentRequestsDashboard from '../accounting/PaymentRequestsDashboard';
import VendorInvoiceManagement from './accounting/VendorInvoiceManagement';
import PaidVendorInvoices from './accounting/PaidVendorInvoices';
import FinancialSummaryView from '../accounting/FinancialSummaryView';

import { Routes, Route, Navigate, useLocation } from 'react-router-dom';

import ReadyForBillingTable, { type BillingCourse } from '../tables/ReadyForBillingTable';
import AccountsReceivableTable, { type ReceivableInvoice } from '../tables/AccountsReceivableTable';
import TransactionHistoryView from '../views/TransactionHistoryView';
import AgingReportView from '../views/AgingReportView';
import PaymentVerificationView from '../views/PaymentVerificationView';
import PaymentReversalView from '../views/PaymentReversalView';
import InvoiceDetailDialog from '../dialogs/InvoiceDetailDialog';
import RecordPaymentDialog, { type PaymentDialogInvoice } from '../dialogs/RecordPaymentDialog';
import { getBillingQueue, createInvoice, getInvoices, getPendingApprovals, approveInvoice, rejectInvoice, getRejectedInvoices, resubmitInvoice } from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import { useSnackbar } from '../../contexts/SnackbarContext';

// Row shapes rendered by a shared table are owned by that table; the portal
// reuses their exported types rather than keeping a second, drifting copy.
// The two views below render their rows inline, so they declare exactly the
// fields their own JSX reads. Note the endpoints differ in casing:
// /accounting/pending-approvals returns snake_case, /rejected returns camelCase.

interface PendingApprovalInvoice {
  id: number;
  invoice_number?: string;
  organization_name?: string;
  course_type_name?: string;
  invoice_date?: string;
  base_cost?: string | number;
  tax_amount?: string | number;
}

interface RejectedInvoice {
  id: number;
  invoiceNumber?: string;
  organizationName?: string;
  courseTypeName?: string;
  baseCost?: string | number;
  taxAmount?: string | number;
  rejectedAt?: string;
  rejectionReason?: string;
}

/**
 * `/accounting/invoices` always paginates (25 rows by default, `limit` capped at
 * 200 by the backend), so a caller that filters the whole set client-side has to
 * walk the pages. Calling `getInvoices()` with no arguments silently yields only
 * the first 25 invoices.
 */
const INVOICE_PAGE_SIZE = 200;
const INVOICE_MAX_ROWS = 10000;

const fetchAllInvoices = async (): Promise<ReceivableInvoice[]> => {
  const first = await getInvoices({ page: 1, limit: INVOICE_PAGE_SIZE });
  const rows: ReceivableInvoice[] = [...(first?.data ?? [])];
  const pages = first?.pagination?.pages ?? 1;
  const maxPages = Math.min(pages, Math.ceil(INVOICE_MAX_ROWS / INVOICE_PAGE_SIZE));
  if (maxPages > 1) {
    const rest = await Promise.all(
      Array.from({ length: maxPages - 1 }, (_, i) =>
        getInvoices({ page: i + 2, limit: INVOICE_PAGE_SIZE })
      )
    );
    rest.forEach((r) => rows.push(...(r?.data ?? [])));
  }
  return rows;
};

// Billing Ready View Component
const ReadyForBillingView: React.FC = () => {
  const [billingQueue, setBillingQueue] = useState<BillingCourse[]>([]);
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
      } catch (error: unknown) {
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
      const errorMessage = getErrorMessage(error, 'Failed to create invoice. Please try again.');
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
  const [invoices, setInvoices] = useState<ReceivableInvoice[]>([]);
  const [, setIsLoading] = useState(false);
  const [, setError] = useState('');
  const [showInvoiceDetailDialog, setShowInvoiceDetailDialog] = useState(false);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<number | null>(null);
  const [showRecordPaymentDialog, setShowRecordPaymentDialog] = useState(false);
  const [selectedInvoiceForPayment, setSelectedInvoiceForPayment] = useState<PaymentDialogInvoice | null>(null);
  const { showSuccess, showError } = useSnackbar();

  const fetchInvoices = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      const data = await fetchAllInvoices();
      const arInvoices = data.filter((invoice: ReceivableInvoice) => {
        const balanceDue = parseFloat(String(invoice.balancedue || 0));
        const paymentStatus = invoice.paymentstatus?.toLowerCase();
        const approvalStatus = invoice.approval_status?.toLowerCase();
        return approvalStatus === 'approved' && balanceDue > 0 && paymentStatus !== 'paid';
      });
      setInvoices(arInvoices);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to load invoices.'));
      setInvoices([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetchInvoices();
  }, [fetchInvoices]);

  const handleRecordPaymentClick = (invoice: ReceivableInvoice) => {
    // The dialog only reads these three fields; narrow to its own prop shape.
    setSelectedInvoiceForPayment({
      invoiceid: Number(invoice.invoiceid),
      invoicenumber: invoice.invoicenumber,
      amount: invoice.amount,
    });
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
  const [invoices, setInvoices] = useState<PendingApprovalInvoice[]>([]);
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
              <Typography sx={{ fontSize: 13, fontWeight: 600, color: (theme) => theme.palette.text.primary }}>{invoice.invoice_number || '-'}</Typography>
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{invoice.organization_name || '-'}</Typography>
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{invoice.course_type_name || '-'}</Typography>
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{formatDate(invoice.invoice_date)}</Typography>
              <Typography sx={{ fontSize: 13, fontWeight: 600, color: (theme) => theme.palette.text.primary, fontFamily: 'monospace', textAlign: 'right' }}>
                {formatCurrency(parseFloat(String(invoice.base_cost || 0)) + parseFloat(String(invoice.tax_amount || 0)))}
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
  const [invoices, setInvoices] = useState<RejectedInvoice[]>([]);
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
              <Typography sx={{ fontSize: 13, fontWeight: 600, color: (theme) => theme.palette.text.primary }}>{invoice.invoiceNumber || '-'}</Typography>
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{invoice.organizationName || '-'}</Typography>
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{invoice.courseTypeName || '-'}</Typography>
              <Typography sx={{ fontSize: 13, fontWeight: 600, color: (theme) => theme.palette.text.primary, fontFamily: 'monospace', textAlign: 'right' }}>
                {formatCurrency(parseFloat(String(invoice.baseCost || 0)) + parseFloat(String(invoice.taxAmount || 0)))}
              </Typography>
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{formatDate(invoice.rejectedAt)}</Typography>
              <Typography sx={{ fontSize: 12, color: '#CC1F1F', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={invoice.rejectionReason}>
                {invoice.rejectionReason || '-'}
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
