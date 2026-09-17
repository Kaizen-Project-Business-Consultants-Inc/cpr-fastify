import React, { useState, useRef } from 'react';
import {
  Box,
  Typography,
  Grid,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  FormHelperText,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Alert,
  Snackbar,
  Divider,
  CircularProgress,
  Tooltip,
} from '@mui/material';
import { formatDisplayDate } from '../../../../utils/dateUtils';
import { api } from '../../../../services/api';
import PaymentHistoryTable from '../../../common/PaymentHistoryTable';
import ServiceDetailsTable from '../../../common/ServiceDetailsTable';
import DataTable, { DataTableRow } from '../../../gtacpr/DataTable';
import StatusChip from '../../../gtacpr/StatusChip';
import StatCard from '../../../gtacpr/StatCard';
import { PrimaryButton, GhostButton } from '../../../gtacpr/Buttons';

// TypeScript interfaces
interface Invoice {
  id: number;
  invoice_number: string;
  created_at: string;
  invoice_date?: string;
  due_date: string;
  amount: number;
  status: string;
  payment_status?: string;
  students_billed: number;
  paid_date?: string;
  location: string;
  course_type_name: string;
  course_date: string;
  course_request_id: number;
  amount_paid: number;
  balance_due: number;
  rate_per_student?: number;
  base_cost?: number;
  tax_amount?: number;
  payments?: Payment[];
}

interface Payment {
  id: number;
  invoiceId: number;
  amount?: number;
  amountPaid?: number;
  paymentDate: string;
  paymentMethod: string;
  referenceNumber?: string;
  notes?: string;
  status: string;
  createdAt: string;
  submittedByOrgAt?: string;
  verifiedByAccountingAt?: string;
  // Legacy snake_case aliases for backward compatibility
  invoice_id?: number;
  amount_paid?: number;
  payment_date?: string;
  payment_method?: string;
  reference_number?: string;
  created_at?: string;
  submitted_by_org_at?: string;
  verified_by_accounting_at?: string;
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

interface OrganizationBillingProps {
  invoices: Invoice[];
  billingSummary: BillingSummary | undefined;
  onPaymentSuccess?: () => void;
}

const invoiceColumns = [
  { key: 'invoice_number', label: 'Invoice #', width: '0.9fr' },
  { key: 'course_type_name', label: 'Course Name', width: '1fr' },
  { key: 'course_date', label: 'Course Date', width: '0.9fr' },
  { key: 'location', label: 'Location', width: '1fr' },
  { key: 'students_billed', label: 'Students', width: '0.6fr', align: 'center' as const },
  { key: 'base_cost', label: 'Base Cost', width: '0.7fr', align: 'right' as const },
  { key: 'tax_amount', label: 'Tax (HST)', width: '0.7fr', align: 'right' as const },
  { key: 'amount', label: 'Total', width: '0.7fr', align: 'right' as const },
  { key: 'amount_paid', label: 'Amount Paid', width: '0.7fr', align: 'right' as const },
  { key: 'balance_due', label: 'Balance Due', width: '0.7fr', align: 'right' as const },
  { key: 'due_date', label: 'Due Date', width: '0.8fr' },
  { key: 'status', label: 'Status', width: '0.8fr', align: 'center' as const },
  { key: 'pending', label: 'Pending', width: '0.7fr', align: 'center' as const },
  { key: 'actions', label: 'Actions', width: '0.8fr', align: 'right' as const },
];

const attendanceColumns = [
  { key: 'name', label: 'Name', width: '1fr' },
  { key: 'email', label: 'Email', width: '1.2fr' },
  { key: 'status', label: 'Status', width: '0.6fr', align: 'center' as const },
];

const OrganizationBilling: React.FC<OrganizationBillingProps> = ({
  invoices,
  billingSummary,
  onPaymentSuccess,
}) => {
  // State for invoice detail dialog
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  // State for payment submission
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [paymentForm, setPaymentForm] = useState({
    amount: '',
    payment_method: '',
    reference_number: '',
    payment_date: new Date().toISOString().split('T')[0],
    notes: '',
  });
  const [submittingPayment, setSubmittingPayment] = useState(false);
  const [paymentSuccess, setPaymentSuccess] = useState(false);
  const [paymentSuccessMessage, setPaymentSuccessMessage] = useState<string>('');
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [showPaymentConfirmation, setShowPaymentConfirmation] = useState(false);

  // State for real-time balance calculation
  const [balanceCalculation, setBalanceCalculation] = useState<{
    current_outstanding_balance: number;
    remaining_balance_after_payment: number;
    is_valid_payment: boolean;
    is_overpayment: boolean;
    is_full_payment: boolean;
    can_submit_payment: boolean;
  } | null>(null);
  const [calculatingBalance, setCalculatingBalance] = useState(false);

  // State for marking invoice as paid
  const [markingAsPaid, setMarkingAsPaid] = useState<number | null>(null);
  const [markAsPaidSuccess, setMarkAsPaidSuccess] = useState(false);
  const [markAsPaidError, setMarkAsPaidError] = useState<string | null>(null);

  // State for payment history
  const [paymentHistory, setPaymentHistory] = useState<Payment[]>([]);
  const [loadingPaymentHistory, setLoadingPaymentHistory] = useState(false);

  // State for attendance data
  const [attendanceData, setAttendanceData] = useState<Array<{
    first_name: string;
    last_name: string;
    email: string;
    attended: boolean;
  }>>([]);
  const [loadingAttendance, setLoadingAttendance] = useState(false);

  // State for CSV export
  const [exportError, setExportError] = useState<string | null>(null);

  const handleExportCSV = async () => {
    try {
      setExportError(null);
      const response = await api.get('/organization/invoices/export/csv', { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `invoices-${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch { setExportError('Failed to export invoices'); }
  };

  // Ref to prevent multiple submissions
  const isSubmittingRef = useRef(false);

  // Debounce timer for balance calculation
  const balanceCalculationTimer = useRef<NodeJS.Timeout | null>(null);

  // Ensure invoices is an array
  const safeInvoices = Array.isArray(invoices) ? invoices : [];

  // Get status kind for StatusChip
  const getStatusKind = (status: string): 'success' | 'active' | 'warning' | 'danger' | 'neutral' | 'inactive' | 'brand' | 'pending' => {
    switch (status?.toLowerCase()) {
      case 'paid':
        return 'success';
      case 'overdue':
        return 'danger';
      case 'pending':
        return 'warning';
      case 'payment_submitted':
        return 'pending';
      default:
        return 'neutral';
    }
  };

  // Check if invoice is overdue
  const isOverdue = (dueDate: string) => {
    const today = new Date();
    const due = new Date(dueDate);
    return today > due;
  };

  // Load attendance data for an invoice
  const loadAttendanceData = async (courseRequestId: number) => {
    setLoadingAttendance(true);
    try {
      const response = await api.get(`/courses/org/students/${courseRequestId}`);

      if (response.data && response.data.data) {
        const students = Array.isArray(response.data.data) ? response.data.data : [];
        setAttendanceData(students);
      } else {
        setAttendanceData([]);
      }
    } catch (error: any) {
      console.error('Error loading attendance data:', error);
      setAttendanceData([]);
    } finally {
      setLoadingAttendance(false);
    }
  };

  // Load payment history for an invoice
  const loadPaymentHistory = async (invoiceId: number) => {
    setLoadingPaymentHistory(true);
    try {
      const response = await api.get(`/organization/invoices/${invoiceId}/payments`);

      // Handle different response structures
      let paymentsData = [];
      if (response.data && response.data.data) {
        paymentsData = Array.isArray(response.data.data) ? response.data.data : [];
      } else if (response.data && Array.isArray(response.data)) {
        paymentsData = response.data;
      } else if (Array.isArray(response.data)) {
        paymentsData = response.data;
      } else {
        console.warn('Unexpected payment history response format:', response);
        paymentsData = [];
      }


      // Filter out invalid payments and remove duplicates
      const validPayments = paymentsData.filter((payment: any) => {
        return payment &&
               payment.id &&
               (payment.amount_paid || payment.amount) &&
               payment.payment_date;
      });

      // Remove duplicates based on payment ID and ensure valid data
      const uniquePayments = validPayments
        .filter((payment: any, index: any, self: any) =>
          index === self.findIndex((p: any) => p.id === payment.id)
        )
        .map((payment: any) => ({
          ...payment,
          amount_paid: Number(payment.amount_paid || payment.amount || 0),
          payment_date: payment.payment_date || payment.created_at,
          payment_method: payment.payment_method || 'Not specified',
          status: payment.status || 'pending_verification'
        }));

      setPaymentHistory(uniquePayments);
    } catch (error: any) {
      console.error('Error loading payment history:', error);
      setPaymentHistory([]);
    } finally {
      setLoadingPaymentHistory(false);
    }
  };

  // Handle invoice click with payment history
  const handleInvoiceClick = async (invoice: Invoice) => {

    setSelectedInvoice(invoice);
    setDialogOpen(true);
    // Clear previous payment history and load new one
    setPaymentHistory([]);
    await loadPaymentHistory(invoice.id);

    // Load attendance data for this invoice's course
    if (invoice.course_request_id) {
      await loadAttendanceData(invoice.course_request_id);
    }
  };

  // Handle dialog close
  const handleDialogClose = () => {
    setDialogOpen(false);
    setSelectedInvoice(null);
    setPaymentHistory([]); // Clear payment history when dialog closes
  };

  // Handle mark invoice as paid
  const handleMarkAsPaid = async (invoiceId: number) => {
    setMarkingAsPaid(invoiceId);
    setMarkAsPaidError(null);

    try {
      const response = await api.post(`/organization/invoices/${invoiceId}/mark-as-paid`);

      if (response.data.success) {
        setMarkAsPaidSuccess(true);
        // Refresh invoice list using React Query instead of page reload
        if (onPaymentSuccess) {
          onPaymentSuccess();
        }
        // Close any open dialogs
        handleDialogClose();
      }
    } catch (error: unknown) {
      console.error('Error marking invoice as paid:', error);
      const errObj = error as { response?: { data?: { message?: string } } };
      setMarkAsPaidError(errObj.response?.data?.message || 'Failed to mark invoice as paid');
    } finally {
      setMarkingAsPaid(null);
    }
  };

  // Handle payment submission with proper race condition prevention
  const handlePaymentSubmit = async () => {
    // CRITICAL: Set ref FIRST to prevent race condition from rapid clicks
    if (isSubmittingRef.current) {
      return;
    }
    isSubmittingRef.current = true;

    // Now check other conditions
    if (!selectedInvoice || submittingPayment) {
      isSubmittingRef.current = false;
      return;
    }

    // Validate required fields
    if (!paymentForm.payment_method || paymentForm.payment_method.trim() === '') {
      setPaymentError('Payment Method is required. Please select a payment method.');
      isSubmittingRef.current = false;
      return;
    }

    if (!paymentForm.amount || parseFloat(paymentForm.amount) <= 0) {
      setPaymentError('Valid payment amount is required. Please enter an amount greater than $0.00.');
      isSubmittingRef.current = false;
      return;
    }

    setSubmittingPayment(true);
    setPaymentError(null);

    try {
      const paymentData = {
        amount: parseFloat(paymentForm.amount),
        payment_method: paymentForm.payment_method,
        reference_number: paymentForm.reference_number,
        payment_date: paymentForm.payment_date,
        notes: paymentForm.notes,
      };

      const response = await api.post(`/organization/invoices/${selectedInvoice.id}/payment-submission`, paymentData);

      if (response.data.success) {
        const responseData = response.data.data;
        const message = responseData?.is_full_payment
          ? 'Full payment submitted successfully! Awaiting verification.'
          : `Partial payment of $${parseFloat(paymentForm.amount).toFixed(2)} submitted. Remaining balance: $${responseData?.remaining_balance?.toFixed(2) || '0.00'}`;

        setPaymentSuccessMessage(message);
        setPaymentSuccess(true);
        handlePaymentDialogClose();

        // Refresh invoice list to update status and balance
        if (onPaymentSuccess) {
          onPaymentSuccess();
        }

        // Refresh payment history for the current invoice
        await loadPaymentHistory(selectedInvoice.id);

        // Close invoice dialog after user can read message
        setTimeout(() => {
          handleDialogClose();
        }, 3000);
      }
    } catch (error: unknown) {
      console.error('Payment submission error:', error);

      // Extract meaningful error message from response
      const err = error as { response?: { data?: { message?: string }; status?: number } };
      let errorMessage = 'Payment submission failed. Please try again.';

      if (err.response?.status === 409) {
        errorMessage = err.response?.data?.message || 'Duplicate payment detected. Please wait or refresh the page.';
      } else if (err.response?.data?.message) {
        errorMessage = err.response.data.message;
      }

      setPaymentError(errorMessage);
    } finally {
      setSubmittingPayment(false);
      isSubmittingRef.current = false;
    }
  };

  // Handle payment dialog open
  const handlePaymentDialogOpen = (invoice: Invoice) => {

    if (invoice) {

      // Set payment form data
      const formData = {
        amount: Number(invoice.balance_due || 0).toFixed(2),
        payment_method: '',
        reference_number: '',
        payment_date: new Date().toISOString().split('T')[0],
        notes: '',
      };

      setPaymentForm(formData);

      // Open payment dialog immediately
      setPaymentDialogOpen(true);

      // Check state immediately after

      // Check state after a micro delay
      setTimeout(() => {
      }, 0);

    }

  };

  // Handle payment dialog close
  const handlePaymentDialogClose = () => {
    setPaymentDialogOpen(false);
    setPaymentError(null);
    setPaymentSuccess(false);
    setPaymentSuccessMessage('');
    setBalanceCalculation(null);

    // Clear balance calculation timer
    if (balanceCalculationTimer.current) {
      clearTimeout(balanceCalculationTimer.current);
    }

    // Reset form
    setPaymentForm({
      amount: '',
      payment_method: '',
      reference_number: '',
      payment_date: new Date().toISOString().split('T')[0],
      notes: '',
    });
  };

  // Check if payment can be submitted
  const canSubmitPayment = (invoice: Invoice | null) => {

    if (!invoice) {
      return false;
    }

    const status = invoice.payment_status || invoice.status;
    const balanceDue = Number(invoice.balance_due || 0);


    const balanceCheck = balanceDue > 0;
    const statusCheck = status !== 'paid' && status !== 'payment_submitted';
    const olderInvoicesCheck = !hasOlderUnpaidInvoices(invoice);


    const result = balanceCheck && statusCheck && olderInvoicesCheck;

    return result;
  };

  // Real-time balance calculation
  const calculateBalance = async (invoiceId: number, paymentAmount: string) => {
    if (!paymentAmount || parseFloat(paymentAmount) <= 0) {
      setBalanceCalculation(null);
      return;
    }

    // Clear existing timer
    if (balanceCalculationTimer.current) {
      clearTimeout(balanceCalculationTimer.current);
    }

    // Set new timer for debounced calculation
    balanceCalculationTimer.current = setTimeout(async () => {
      try {
        setCalculatingBalance(true);
        const response = await api.get(`/invoices/${invoiceId}/calculate-balance`, { params: { amount: parseFloat(paymentAmount) } });

        if (response.data.success) {
          setBalanceCalculation(response.data.data);
        }
      } catch (error: any) {
        console.error('Error calculating balance:', error);
        setBalanceCalculation(null);
      } finally {
        setCalculatingBalance(false);
      }
    }, 300); // 300ms debounce
  };

  // Check if this is a partial payment
  const isPartialPayment = (amount: string) => {
    if (!selectedInvoice || !amount) return false;
    const paymentAmount = parseFloat(amount);
    const balanceDue = selectedInvoice.balance_due;
    return paymentAmount > 0 && paymentAmount < balanceDue;
  };

  // Get payment status message
  const getPaymentStatusMessage = (invoice: Invoice | null) => {
    if (!invoice) return '';

    const status = invoice.payment_status || invoice.status;

    switch (status) {
      case 'paid':
        return 'This invoice has been fully paid.';
      case 'payment_submitted':
        return 'Payment has been submitted and is pending verification by accounting.';
      case 'pending':
        return 'This invoice is pending payment.';
      case 'overdue':
        return 'This invoice is overdue and requires immediate attention.';
      default:
        return 'This invoice is ready for payment.';
    }
  };

  // Get payment status kind for StatusChip
  const getPaymentStatusKind = (status: string): 'success' | 'active' | 'warning' | 'danger' | 'neutral' | 'inactive' | 'brand' | 'pending' => {
    switch (status?.toLowerCase()) {
      case 'verified':
        return 'success';
      case 'pending_verification':
        return 'warning';
      case 'rejected':
        return 'danger';
      default:
        return 'neutral';
    }
  };

  // Format payment method for display
  const formatPaymentMethod = (method: string) => {
    if (!method) return '-';
    return method.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  // Check if there are older unpaid invoices that should be paid first
  const hasOlderUnpaidInvoices = (currentInvoice: Invoice | null) => {
    if (!currentInvoice || !safeInvoices || safeInvoices.length === 0) {
      return false;
    }

    // Try different date fields
    const currentInvoiceDate = new Date(currentInvoice.created_at || currentInvoice.invoice_date || currentInvoice.created_at);
    if (isNaN(currentInvoiceDate.getTime())) {
      // If we can't determine the date, don't block payment
      return false;
    }

    // Find older invoices with outstanding balance
    const olderUnpaidInvoices = safeInvoices.filter(invoice => {
      const invoiceDate = new Date(invoice.created_at || invoice.invoice_date || invoice.created_at);

      // Skip if date is invalid
      if (isNaN(invoiceDate.getTime())) {
        return false;
      }

      const balanceDue = Number(invoice.balance_due || 0);

      return invoiceDate < currentInvoiceDate &&
             balanceDue > 0 &&
             invoice.id !== currentInvoice.id;
    });

    return olderUnpaidInvoices.length > 0;
  };

  // Get the oldest unpaid invoice
  const getOldestUnpaidInvoice = () => {
    if (!safeInvoices || safeInvoices.length === 0) return null;

    const unpaidInvoices = safeInvoices.filter(invoice => {
      const balanceDue = Number(invoice.balance_due || 0);
      return balanceDue > 0;
    });

    if (unpaidInvoices.length === 0) return null;

    // Sort by creation date (oldest first)
    return unpaidInvoices.sort((a, b) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    )[0];
  };

  // Handle PDF download
  const handleDownloadPDF = async () => {
    if (!selectedInvoice) {
      console.error('No invoice selected for PDF download.');
      return;
    }

    try {
      const response = await api.get(`/invoices/${selectedInvoice.id}/pdf`, {
        responseType: 'blob', // Important for binary data
      });

      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `${selectedInvoice.invoice_number}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error: any) {
      console.error('Error downloading PDF:', error);
      setPaymentError('Failed to download PDF.');
    }
  };

  // Transform invoice data into service details format
  const getServiceDetails = (invoice: Invoice) => {
    if (!invoice) return [];

    return [{
      date: invoice.course_date,
      location: invoice.location,
      course: invoice.course_type_name,
      students: invoice.students_billed,
      ratePerStudent: invoice.rate_per_student || 9.00,
      baseCost: invoice.base_cost || (invoice.amount * 0.885),
      tax: invoice.tax_amount || (invoice.amount * 0.115),
      total: invoice.amount,
    }];
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography sx={{ fontSize: 22, fontWeight: 700, color: (theme) => theme.palette.text.primary }}>
          Bills Payable
        </Typography>
        <GhostButton onClick={handleExportCSV}>Export CSV</GhostButton>
      </Box>
      {exportError && <Alert severity="error" onClose={() => setExportError(null)} sx={{ mb: 2 }}>{exportError}</Alert>}

      {/* Billing Summary Stat Cards */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' }, gap: 2, mb: 4 }}>
        <StatCard
          label="Total Invoices"
          value={billingSummary?.total_invoices || 0}
          dotColor="#6366F1"
        />
        <StatCard
          label="Pending"
          value={billingSummary?.pending_invoices || 0}
          dotColor="#ED6C02"
        />
        <StatCard
          label="Overdue"
          value={billingSummary?.overdue_invoices || 0}
          dotColor="#CC1F1F"
        />
        <StatCard
          label="Paid"
          value={billingSummary?.paid_invoices || 0}
          dotColor="#16A34A"
        />
      </Box>

      {/* Invoices Table */}
      <Box sx={{ border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', bgcolor: (theme) => theme.palette.background.paper, p: 3 }}>
        <Box sx={{ display: 'flex', gap: 2, mb: 3, alignItems: 'center', flexWrap: 'wrap' }}>
          <Box sx={{ flex: '0 0 auto', minWidth: 220 }}>
            <TextField
              fullWidth
              label="Search invoices..."
              variant="outlined"
              size="small"
            />
          </Box>
          <Box sx={{ flex: '0 0 auto', minWidth: 160 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Status</InputLabel>
              <Select label="Status" defaultValue="">
                <MenuItem value="">All Statuses</MenuItem>
                <MenuItem value="pending">Pending</MenuItem>
                <MenuItem value="overdue">Overdue</MenuItem>
                <MenuItem value="paid">Paid</MenuItem>
                <MenuItem value="payment_submitted">Payment Submitted</MenuItem>
              </Select>
            </FormControl>
          </Box>
          <Box sx={{ flex: '0 0 auto', minWidth: 160 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Course Type</InputLabel>
              <Select label="Course Type" defaultValue="">
                <MenuItem value="">All Types</MenuItem>
                <MenuItem value="cpr">CPR</MenuItem>
                <MenuItem value="first_aid">First Aid</MenuItem>
                <MenuItem value="bls">BLS</MenuItem>
              </Select>
            </FormControl>
          </Box>
          <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.text.secondary, ml: 'auto' }}>
            {safeInvoices.length} invoices found
          </Typography>
        </Box>

        <DataTable
          columns={invoiceColumns}
          shownCount={safeInvoices.length}
          totalCount={safeInvoices.length}
        >
          {safeInvoices.length === 0 ? (
            <Box sx={{ p: 3, textAlign: 'center' }}>
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>No invoices found</Typography>
            </Box>
          ) : (
            safeInvoices.map((invoice) => {
              const oldestUnpaid = getOldestUnpaidInvoice();
              const isOldestUnpaid = oldestUnpaid?.id === invoice.id;
              const hasOlderUnpaid = hasOlderUnpaidInvoices(invoice);

              return (
                <DataTableRow key={invoice.id} columns={invoiceColumns}>
                  {/* Invoice # */}
                  <Typography sx={{ fontSize: 13, fontWeight: 600, color: (theme) => theme.palette.text.primary }}>
                    {invoice.invoice_number}
                  </Typography>

                  {/* Course Name */}
                  <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
                    {invoice.course_type_name}
                  </Typography>

                  {/* Course Date */}
                  <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
                    {formatDisplayDate(invoice.course_date)}
                  </Typography>

                  {/* Location */}
                  <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
                    {invoice.location}
                  </Typography>

                  {/* Students */}
                  <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary, textAlign: 'center' }}>
                    {invoice.students_billed}
                  </Typography>

                  {/* Base Cost */}
                  {invoice.base_cost ? (
                    <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary, textAlign: 'right', fontFamily: 'monospace' }}>
                      ${Number(invoice.base_cost).toFixed(2)}
                    </Typography>
                  ) : (
                    <Typography sx={{ fontSize: 12, color: '#CC1F1F', textAlign: 'right' }}>
                      Pricing not configured
                    </Typography>
                  )}

                  {/* Tax (HST) */}
                  {invoice.tax_amount ? (
                    <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary, textAlign: 'right', fontFamily: 'monospace' }}>
                      ${Number(invoice.tax_amount).toFixed(2)}
                    </Typography>
                  ) : (
                    <Typography sx={{ fontSize: 12, color: '#CC1F1F', textAlign: 'right' }}>
                      N/A
                    </Typography>
                  )}

                  {/* Total */}
                  {invoice.amount ? (
                    <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary, textAlign: 'right', fontFamily: 'monospace' }}>
                      ${Number(invoice.amount).toFixed(2)}
                    </Typography>
                  ) : (
                    <Typography sx={{ fontSize: 12, color: '#CC1F1F', textAlign: 'right' }}>
                      N/A
                    </Typography>
                  )}

                  {/* Amount Paid */}
                  <Typography sx={{
                    fontSize: 13,
                    color: invoice.amount_paid > 0 ? '#16A34A' : (theme) => theme.palette.text.secondary,
                    textAlign: 'right',
                    fontFamily: 'monospace',
                  }}>
                    ${Number(invoice.amount_paid || 0).toFixed(2)}
                  </Typography>

                  {/* Balance Due */}
                  <Typography sx={{
                    fontSize: 13,
                    color: invoice.balance_due > 0 ? '#CC1F1F' : '#16A34A',
                    textAlign: 'right',
                    fontFamily: 'monospace',
                    fontWeight: 600,
                  }}>
                    ${Number(invoice.balance_due || 0).toFixed(2)}
                  </Typography>

                  {/* Due Date */}
                  <Typography sx={{
                    fontSize: 13,
                    color: isOverdue(invoice.due_date) ? '#CC1F1F' : (theme) => theme.palette.text.secondary,
                  }}>
                    {formatDisplayDate(invoice.due_date)}
                  </Typography>

                  {/* Status */}
                  <Box sx={{ display: 'flex', justifyContent: 'center' }}>
                    <StatusChip
                      kind={getStatusKind(invoice.payment_status || invoice.status)}
                      label={invoice.payment_status || invoice.status}
                    />
                  </Box>

                  {/* Pending */}
                  <Box sx={{ display: 'flex', justifyContent: 'center' }}>
                    {(invoice.payment_status === 'payment_submitted' || invoice.status === 'payment_submitted') && (
                      <Tooltip title="Payment awaiting verification by accounting">
                        <Box>
                          <StatusChip kind="pending" label="Awaiting" />
                        </Box>
                      </Tooltip>
                    )}
                  </Box>

                  {/* Actions */}
                  <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                    <Box
                      onClick={() => handleInvoiceClick(invoice)}
                      sx={{ fontSize: 12, fontWeight: 600, color: '#CC1F1F', cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}
                    >
                      View
                    </Box>
                    {invoice.balance_due <= 0 && invoice.payment_status !== 'paid' && (
                      <Box
                        onClick={() => !markingAsPaid && handleMarkAsPaid(invoice.id)}
                        sx={{
                          fontSize: 12,
                          fontWeight: 600,
                          color: markingAsPaid === invoice.id ? (theme) => theme.palette.text.secondary : '#16A34A',
                          cursor: markingAsPaid === invoice.id ? 'not-allowed' : 'pointer',
                          '&:hover': { textDecoration: markingAsPaid === invoice.id ? 'none' : 'underline' },
                        }}
                      >
                        {markingAsPaid === invoice.id ? 'Marking...' : 'Mark Paid'}
                      </Box>
                    )}
                    {invoice.balance_due > 0 && invoice.payment_status !== 'paid' && !canSubmitPayment(invoice) && (
                      <Typography sx={{ fontSize: 12, color: '#ED6C02', fontWeight: 600 }}>
                        Pay Older First
                      </Typography>
                    )}
                  </Box>
                </DataTableRow>
              );
            })
          )}
        </DataTable>
      </Box>

      {/* Invoice Details Dialog */}
      <Dialog
        open={dialogOpen}
        onClose={handleDialogClose}
        maxWidth="md"
        fullWidth
        aria-labelledby="invoice-details-dialog-title"
        aria-describedby="invoice-details-dialog-description"
        disableEscapeKeyDown={submittingPayment}
      >
        <DialogTitle id="invoice-details-dialog-title">
          <Box display="flex" justifyContent="space-between" alignItems="center">
            <Typography sx={{ fontSize: 18, fontWeight: 700, color: (theme) => theme.palette.text.primary }}>
              Invoice Details - {selectedInvoice?.invoice_number}
            </Typography>
            <Box
              onClick={handleDialogClose}
              sx={{ fontSize: 12, fontWeight: 600, color: '#CC1F1F', cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}
            >
              Close
            </Box>
          </Box>
        </DialogTitle>
        <DialogContent id="invoice-details-dialog-description">
          {selectedInvoice && (
            <Box sx={{ p: 1 }}>
              {/* Container for Header Info */}
              <Grid container spacing={2}>
                <Grid xs={6} md={3}>
                  <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
                    <strong>Invoice #:</strong> {selectedInvoice.invoice_number}
                  </Typography>
                </Grid>
                <Grid xs={6} md={3}>
                  <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
                    <strong>Invoice Date:</strong>{' '}
                    {formatDisplayDate(selectedInvoice.created_at)}
                  </Typography>
                </Grid>
                <Grid xs={6} md={3}>
                  <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
                    <strong>Due Date:</strong> {formatDisplayDate(selectedInvoice.due_date)}
                  </Typography>
                </Grid>
                <Grid xs={6} md={3}>
                  <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
                    <strong>Status:</strong> {selectedInvoice.payment_status || selectedInvoice.status}
                  </Typography>
                </Grid>
              </Grid>
              <Divider sx={{ my: 2 }} />

              {/* Organization Info */}
              <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: (theme) => theme.palette.text.primary, mb: 0.5 }}>
                Bill To:
              </Typography>
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>Your Organization</Typography>
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>Organization Address</Typography>
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>Contact Information</Typography>

              <Divider sx={{ my: 2 }} />

              {/* Service Details Table */}
              <ServiceDetailsTable
                services={getServiceDetails(selectedInvoice)}
                showTotals={false}
              />

              {/* Class Attendance */}
              <Divider sx={{ my: 2 }} />
              <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: (theme) => theme.palette.text.primary, mb: 1 }}>
                Class Attendance:
              </Typography>
              {loadingAttendance ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', p: 2 }}>
                  <CircularProgress size={24} />
                </Box>
              ) : attendanceData.length > 0 ? (
                <Box sx={{ mb: 2 }}>
                  <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.text.secondary, mb: 1 }}>
                    Total Students: {attendanceData.length} | Present: {attendanceData.filter(s => s.attended).length} | Absent: {attendanceData.filter(s => !s.attended).length}
                  </Typography>
                  <DataTable
                    columns={attendanceColumns}
                    shownCount={attendanceData.length}
                    totalCount={attendanceData.length}
                  >
                    {attendanceData.map((student, index) => (
                      <DataTableRow key={index} columns={attendanceColumns}>
                        <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
                          {student.first_name} {student.last_name}
                        </Typography>
                        <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
                          {student.email || 'N/A'}
                        </Typography>
                        <Box sx={{ display: 'flex', justifyContent: 'center' }}>
                          <StatusChip
                            kind={student.attended ? 'success' : 'danger'}
                            label={student.attended ? 'Present' : 'Absent'}
                          />
                        </Box>
                      </DataTableRow>
                    ))}
                  </DataTable>
                </Box>
              ) : (
                <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
                  No attendance data available
                </Typography>
              )}

              {/* Payment Summary */}
              <Divider sx={{ my: 2 }} />
              <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: (theme) => theme.palette.text.primary, mb: 1 }}>
                Payment Summary:
              </Typography>
              {(() => {
                // Calculate verified and pending payments from payment history
                const verifiedPayments = paymentHistory.filter(p =>
                  p.status?.toLowerCase() === 'verified' ||
                  p.status?.toLowerCase() === 'approved'
                );
                const pendingPayments = paymentHistory.filter(p =>
                  p.status?.toLowerCase() === 'pending_verification' ||
                  p.status?.toLowerCase() === 'pending' ||
                  p.status?.toLowerCase() === 'submitted'
                );

                const verifiedTotal = verifiedPayments.reduce((sum, p) =>
                  sum + Number(p.amount_paid || p.amountPaid || p.amount || 0), 0
                );
                const pendingTotal = pendingPayments.reduce((sum, p) =>
                  sum + Number(p.amount_paid || p.amountPaid || p.amount || 0), 0
                );

                const invoiceTotal = Number(selectedInvoice.amount || 0);
                const balanceAfterVerified = invoiceTotal - verifiedTotal;
                const balanceAfterPending = balanceAfterVerified - pendingTotal;

                return (
                  <Box sx={{ bgcolor: (theme) => theme.palette.background.default, p: 2, borderRadius: '8px', border: (theme) => `1px solid ${theme.palette.divider}` }}>
                    {/* Invoice Total */}
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                      <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}><strong>Invoice Total:</strong></Typography>
                      <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary, fontFamily: 'monospace' }}>
                        ${invoiceTotal.toFixed(2)}
                      </Typography>
                    </Box>

                    {/* Verified Payments */}
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <Typography sx={{ fontSize: 13, color: '#16A34A' }}><strong>Verified Payments:</strong></Typography>
                      <Typography sx={{ fontSize: 13, color: '#16A34A', fontFamily: 'monospace' }}>
                        -${verifiedTotal.toFixed(2)}
                      </Typography>
                    </Box>
                    {verifiedPayments.length > 0 && (
                      <Box sx={{ pl: 2, mt: 0.5 }}>
                        {verifiedPayments.map((payment, idx) => (
                          <Typography key={idx} sx={{ fontSize: 11, color: (theme) => theme.palette.text.secondary }}>
                            {formatDisplayDate(payment.payment_date || payment.paymentDate)} - ${Number(payment.amount_paid || payment.amountPaid || payment.amount || 0).toFixed(2)} ({formatPaymentMethod(payment.payment_method || payment.paymentMethod || '')})
                          </Typography>
                        ))}
                      </Box>
                    )}

                    {/* Balance Due (after verified) */}
                    <Divider sx={{ my: 1 }} />
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography sx={{ fontSize: 13, fontWeight: 700, color: balanceAfterVerified > 0 ? '#CC1F1F' : '#16A34A' }}>
                        Balance Due:
                      </Typography>
                      <Typography sx={{ fontSize: 13, fontWeight: 700, color: balanceAfterVerified > 0 ? '#CC1F1F' : '#16A34A', fontFamily: 'monospace' }}>
                        ${balanceAfterVerified.toFixed(2)}
                      </Typography>
                    </Box>

                    {/* Pending Payments (if any) */}
                    {pendingPayments.length > 0 && (
                      <>
                        <Divider sx={{ my: 1 }} />
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <Typography sx={{ fontSize: 13, color: '#ED6C02' }}><strong>Pending Verification:</strong></Typography>
                          <Typography sx={{ fontSize: 13, color: '#ED6C02', fontFamily: 'monospace' }}>
                            -${pendingTotal.toFixed(2)}
                          </Typography>
                        </Box>
                        <Box sx={{ pl: 2, mt: 0.5 }}>
                          {pendingPayments.map((payment, idx) => (
                            <Box key={idx} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              <Typography sx={{ fontSize: 11, color: (theme) => theme.palette.text.secondary }}>
                                {formatDisplayDate(payment.payment_date || payment.paymentDate)} - ${Number(payment.amount_paid || payment.amountPaid || payment.amount || 0).toFixed(2)} ({formatPaymentMethod(payment.payment_method || payment.paymentMethod || '')}) -
                              </Typography>
                              <StatusChip kind="pending" label="Awaiting Verification" />
                            </Box>
                          ))}
                        </Box>

                        {/* Balance After Pending */}
                        <Divider sx={{ my: 1 }} />
                        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                          <Typography sx={{ fontSize: 13, color: '#6366F1' }}>
                            <strong>Balance After Verification:</strong>
                          </Typography>
                          <Typography sx={{ fontSize: 13, color: '#6366F1', fontFamily: 'monospace' }}>
                            ${balanceAfterPending.toFixed(2)}
                          </Typography>
                        </Box>
                        <Typography sx={{ fontSize: 11, color: (theme) => theme.palette.text.secondary }}>
                          (Once pending payments are verified by accounting)
                        </Typography>
                      </>
                    )}
                  </Box>
                );
              })()}

              {/* Warning for older unpaid invoices */}
              {selectedInvoice && hasOlderUnpaidInvoices(selectedInvoice) && (
                <>
                  <Divider sx={{ my: 2 }} />
                  <Alert severity="warning" sx={{ mb: 2 }}>
                    <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
                      <strong>Payment Order Warning:</strong> There are older unpaid invoices that should be paid first.
                      Please pay invoices in chronological order.
                    </Typography>
                  </Alert>
                </>
              )}

              {/* Payment History */}
              <Divider sx={{ my: 2 }} />
              <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: (theme) => theme.palette.text.primary, mb: 1 }}>
                Payment History:
              </Typography>
              <PaymentHistoryTable
                payments={paymentHistory}
                isLoading={loadingPaymentHistory}
                showVerificationDetails={true}
                onViewInvoice={() => {}} // Already showing invoice details in this dialog
              />
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          {selectedInvoice && canSubmitPayment(selectedInvoice) && (
            <PrimaryButton
              onClick={(e) => {

                // Force the function call with the invoice directly
                if (selectedInvoice) {
                  handlePaymentDialogOpen(selectedInvoice);
                }


                // Add a timeout to check state
                setTimeout(() => {
                }, 100);
              }}
              sx={{ mr: 'auto' }}
            >
              Submit Payment
            </PrimaryButton>
          )}

          {selectedInvoice && hasOlderUnpaidInvoices(selectedInvoice) && (
            <Alert severity="warning" sx={{ mr: 'auto', flex: 1 }}>
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
                Please pay older invoices first: {getOldestUnpaidInvoice()?.invoice_number}
              </Typography>
            </Alert>
          )}

          <GhostButton onClick={handleDownloadPDF}>
            Download PDF
          </GhostButton>

          <GhostButton onClick={handleDialogClose}>
            Close
          </GhostButton>
        </DialogActions>
      </Dialog>

      {/* Payment Submission Dialog */}
      <Dialog
        open={paymentDialogOpen}
        onClose={handlePaymentDialogClose}
        maxWidth="sm"
        fullWidth
        aria-labelledby="payment-dialog-title"
        aria-describedby="payment-dialog-description"
        disableEscapeKeyDown={submittingPayment}
      >
        <DialogTitle id="payment-dialog-title">
          <Typography sx={{ fontSize: 18, fontWeight: 700, color: (theme) => theme.palette.text.primary }}>
            Submit Payment - {selectedInvoice?.invoice_number}
          </Typography>
        </DialogTitle>
        <DialogContent id="payment-dialog-description">
          <Alert severity="info" sx={{ mb: 2 }}>
            Payment information will be submitted for verification by accounting.
            The invoice status will be updated once payment is verified.
          </Alert>

          {selectedInvoice && hasOlderUnpaidInvoices(selectedInvoice) && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
                <strong>Payment Order Warning:</strong> There are older unpaid invoices that should be paid first.
                Please pay invoice <strong>{getOldestUnpaidInvoice()?.invoice_number}</strong> before this one.
              </Typography>
            </Alert>
          )}

          {selectedInvoice && (
            <Box sx={{ mb: 2, p: 2, bgcolor: (theme) => theme.palette.background.default, borderRadius: '8px', border: (theme) => `1px solid ${theme.palette.divider}` }}>
              <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.text.secondary, mb: 1 }}>Invoice Details</Typography>
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
                Total Amount:{' '}
                {selectedInvoice.amount ? (
                  <Box component="span" sx={{ fontFamily: 'monospace' }}>
                    ${Number(selectedInvoice.amount).toFixed(2)}
                  </Box>
                ) : (
                  <Box component="span" sx={{ color: '#CC1F1F', fontSize: 12 }}>N/A</Box>
                )}
              </Typography>
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
                Amount Paid:{' '}
                <Box component="span" sx={{ fontFamily: 'monospace' }}>
                  ${Number(selectedInvoice.amount_paid || 0).toFixed(2)}
                </Box>
              </Typography>
              <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#CC1F1F' }}>
                Balance Due:{' '}
                <Box component="span" sx={{ fontFamily: 'monospace' }}>
                  ${Number(selectedInvoice.balance_due || 0).toFixed(2)}
                </Box>
              </Typography>
            </Box>
          )}

          <Grid container spacing={2}>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Payment Amount"
                type="text"
                value={paymentForm.amount}
                onChange={(e) => {
                  const value = e.target.value;
                  // Only allow numbers and decimal point
                  const numericValue = value.replace(/[^0-9.]/g, '');
                  // Ensure only one decimal point
                  const parts = numericValue.split('.');
                  const formattedValue = parts.length > 2
                    ? parts[0] + '.' + parts.slice(1).join('')
                    : parts.length === 2 && parts[1].length > 2
                    ? parts[0] + '.' + parts[1].substring(0, 2) // Limit to 2 decimal places
                    : numericValue;
                  setPaymentForm({ ...paymentForm, amount: formattedValue });

                  // Trigger real-time balance calculation
                  if (selectedInvoice) {
                    calculateBalance(selectedInvoice.id, formattedValue);
                  }
                }}
                InputProps={{
                  startAdornment: <Typography sx={{ fontSize: 13, mr: 1 }}>$</Typography>,
                  endAdornment: calculatingBalance ? <CircularProgress size={20} /> : null,
                }}
                placeholder="0.00"
                helperText={
                  balanceCalculation ? (
                    balanceCalculation.is_overpayment ? (
                      `Payment exceeds outstanding balance ($${balanceCalculation.current_outstanding_balance.toFixed(2)})`
                    ) : balanceCalculation.is_full_payment ? (
                      `This will complete the payment. Remaining balance: $${balanceCalculation.remaining_balance_after_payment.toFixed(2)}`
                    ) : (
                      `Partial payment. Remaining balance: $${balanceCalculation.remaining_balance_after_payment.toFixed(2)}`
                    )
                  ) : paymentForm.amount ? (
                    'Calculating balance...'
                  ) : ''
                }
                error={balanceCalculation ? balanceCalculation.is_overpayment : false}
                disabled={submittingPayment}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <FormControl fullWidth required>
                <InputLabel>Payment Method *</InputLabel>
                <Select
                  value={paymentForm.payment_method}
                  onChange={(e) => setPaymentForm({ ...paymentForm, payment_method: e.target.value })}
                  label="Payment Method *"
                  disabled={submittingPayment}
                  error={!paymentForm.payment_method && paymentError?.includes('Payment Method')}
                >
                  <MenuItem value="">Select Payment Method</MenuItem>
                  <MenuItem value="check">Check</MenuItem>
                  <MenuItem value="bank_transfer">Bank Transfer</MenuItem>
                  <MenuItem value="credit_card">Credit Card</MenuItem>
                  <MenuItem value="cash">Cash</MenuItem>
                  <MenuItem value="other">Other</MenuItem>
                </Select>
                {!paymentForm.payment_method && paymentError?.includes('Payment Method') && (
                  <FormHelperText error>Payment Method is required</FormHelperText>
                )}
              </FormControl>
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="Reference Number"
                value={paymentForm.reference_number}
                onChange={(e) => setPaymentForm({ ...paymentForm, reference_number: e.target.value })}
                placeholder="Check #, Transaction ID, etc."
                disabled={submittingPayment}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Payment Date"
                type="date"
                value={paymentForm.payment_date}
                onChange={(e) => setPaymentForm({ ...paymentForm, payment_date: e.target.value })}
                InputLabelProps={{ shrink: true }}
                disabled={submittingPayment}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Notes"
                multiline
                rows={3}
                value={paymentForm.notes}
                onChange={(e) => setPaymentForm({ ...paymentForm, notes: e.target.value })}
                placeholder="Additional payment details..."
                disabled={submittingPayment}
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <GhostButton
            onClick={handlePaymentDialogClose}
            disabled={submittingPayment}
          >
            Cancel
          </GhostButton>
          <PrimaryButton
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              // Call directly without setTimeout to prevent multiple submissions
              handlePaymentSubmit();
            }}
            disabled={
              submittingPayment ||
              !paymentForm.payment_method ||
              !paymentForm.amount ||
              parseFloat(paymentForm.amount || '0') <= 0 ||
              (balanceCalculation ? !balanceCalculation.can_submit_payment : false)
            }
            startIcon={submittingPayment ? <CircularProgress size={20} /> : undefined}
          >
            {submittingPayment ? 'Submitting...' : (selectedInvoice?.balance_due || 0) <= 0 ? 'Invoice Paid' : 'Submit Payment'}
          </PrimaryButton>
        </DialogActions>
      </Dialog>

      {/* Success/Error Messages */}
      <Snackbar
        open={paymentSuccess}
        autoHideDuration={5000}
        onClose={() => {
          setPaymentSuccess(false);
          setPaymentSuccessMessage('');
        }}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      >
        <Alert
          severity="success"
          onClose={() => {
            setPaymentSuccess(false);
            setPaymentSuccessMessage('');
          }}
          sx={{
            maxWidth: 500,
            whiteSpace: 'pre-line',
            fontSize: '1rem',
          }}
        >
          {paymentSuccessMessage || 'Payment submitted successfully! Awaiting verification.'}
        </Alert>
      </Snackbar>

      <Snackbar
        open={!!paymentError}
        autoHideDuration={6000}
        onClose={() => setPaymentError(null)}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      >
        <Alert severity="error" onClose={() => setPaymentError(null)} sx={{ maxWidth: 500 }}>
          {paymentError}
        </Alert>
      </Snackbar>

      {/* Mark as Paid Success/Error Messages */}
      <Snackbar
        open={markAsPaidSuccess}
        autoHideDuration={6000}
        onClose={() => setMarkAsPaidSuccess(false)}
      >
        <Alert severity="success" onClose={() => setMarkAsPaidSuccess(false)}>
          Invoice marked as paid successfully!
        </Alert>
      </Snackbar>

      <Snackbar
        open={!!markAsPaidError}
        autoHideDuration={6000}
        onClose={() => setMarkAsPaidError(null)}
      >
        <Alert severity="error" onClose={() => setMarkAsPaidError(null)}>
          {markAsPaidError}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default OrganizationBilling;
