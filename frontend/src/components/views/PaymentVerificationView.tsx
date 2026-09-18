import React, { useState } from 'react';
import {
  Box,
  Typography,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Grid,
  Alert,
  Tooltip,
  CircularProgress,
  Snackbar,
  Divider,
} from '@mui/material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../services/api';
import ServiceDetailsTable from '../common/ServiceDetailsTable';
import PaymentHistoryTable from '../common/PaymentHistoryTable';
import { formatCurrency, formatCurrencyOrDash, formatDisplayDate } from '../../utils/formatters';
import LinkButton from '../gtacpr/LinkButton';
import DataTable, { DataTableRow } from '../gtacpr/DataTable';
import StatusChip from '../gtacpr/StatusChip';
import { PrimaryButton, GhostButton } from '../gtacpr/Buttons';

interface Payment {
  paymentId?: number;
  id?: number;
  organizationName?: string;
  organizationname?: string;
  invoiceNumber?: string;
  invoicenumber?: string;
  invoiceId?: number;
  courseRequestId?: number;
  amount?: number;
  paymentMethod?: string;
  referenceNumber?: string;
  paymentDate?: string;
  submittedByOrgAt?: string;
  status?: string;
  verifiedByAccountingAt?: string;
  notes?: string;
  location?: string;
  courseTypeName?: string;
  courseType?: string;
  name?: string;
  studentsAttended?: number;
  studentsattendance?: number;
  registeredStudents?: number;
  ratePerStudent?: number;
  baseCost?: number;
  taxAmount?: number;
  paymentstatus?: string;
  amountPaid?: number;
  balanceDue?: number;
  courseDate?: string;
  duedate?: string;
  [key: string]: unknown;
}

const PAYMENT_TABLE_COLUMNS = [
  { key: 'organization', label: 'Organization', width: '20%' },
  { key: 'invoice', label: 'Invoice #', width: '13%' },
  { key: 'amount', label: 'Payment Amount', width: '13%' },
  { key: 'method', label: 'Payment Method', width: '13%' },
  { key: 'reference', label: 'Reference #', width: '13%' },
  { key: 'submitted', label: 'Submitted Date', width: '13%' },
  { key: 'status', label: 'Status', width: '10%' },
  { key: 'actions', label: 'Actions', width: '5%', align: 'center' as const },
];

const ATTENDANCE_TABLE_COLUMNS = [
  { key: 'name', label: 'Name', width: '40%' },
  { key: 'email', label: 'Email', width: '40%' },
  { key: 'status', label: 'Status', width: '20%', align: 'center' as const },
];

const PaymentVerificationView = () => {
  const [selectedPayment, setSelectedPayment] = useState<Payment | null>(null);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState('view'); // 'view' or 'action'
  const [verificationAction, setVerificationAction] = useState('approve'); // 'approve' or 'reject'
  const [verificationNotes, setVerificationNotes] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  // Which payment the successMessage refers to, so only that row shows the new status
  const [verifiedPaymentId, setVerifiedPaymentId] = useState<string | null>(null);

  // State for attendance data
  const [attendanceData, setAttendanceData] = useState<Array<{
    firstName: string;
    lastName: string;
    email: string;
    attended: boolean;
  }>>([]);
  const [loadingAttendance, setLoadingAttendance] = useState(false);

  // State for payment history
  const [paymentHistory, setPaymentHistory] = useState<any[]>([]);
  const [loadingPaymentHistory, setLoadingPaymentHistory] = useState(false);

  // State for invoice viewing
  const [invoiceDialogOpen, setInvoiceDialogOpen] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<Payment | null>(null);
  const [loadingInvoice, setLoadingInvoice] = useState(false);

  const queryClient = useQueryClient();

  // Fetch pending payment submissions
  const { data: paymentsData, isLoading, error } = useQuery({
    queryKey: ['pending-payment-verifications'],
    queryFn: async () => {
      const response = await api.get('/accounting/payment-verifications');

      // Filter to only show payments that are actually pending verification
      const pendingPayments = response.data.data.payments?.filter((payment: any) =>
        payment.status === 'pending_verification' ||
        payment.status === 'pending' ||
        !payment.verifiedByAccountingAt
      ) || [];


      return {
        ...response.data.data,
        payments: pendingPayments
      };
    },
  });

  // Load attendance data for a payment
  const loadAttendanceData = async (courseRequestId: number) => {
    if (!courseRequestId) return;

    setLoadingAttendance(true);
    try {
      const response = await api.get(`/courses/${courseRequestId}/students`);

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
    if (!invoiceId) return;

    setLoadingPaymentHistory(true);
    try {
      const response = await api.get(`/accounting/invoices/${invoiceId}/payments`);

      if (response.data && response.data.success && Array.isArray(response.data.data)) {
        setPaymentHistory(response.data.data);
      } else if (response.data && Array.isArray(response.data)) {
        setPaymentHistory(response.data);
      } else {
        console.warn('Unexpected payment history response format:', response.data);
        setPaymentHistory([]);
      }
    } catch (error: any) {
      console.error('Error loading payment history:', error);
      setPaymentHistory([]);
    } finally {
      setLoadingPaymentHistory(false);
    }
  };

  // Verify payment mutation
  const verifyPaymentMutation = useMutation({
    mutationFn: async ({ paymentId, action, notes }: { paymentId: string; action: string; notes: string }) => {
      const response = await api.post(
        `/accounting/payments/${paymentId}/verify`,
        {
          action,
          notes,
        }
      );
      return response.data;
    },
    onSuccess: (_data, variables) => {
      setVerifiedPaymentId(variables.paymentId);
      queryClient.invalidateQueries({ queryKey: ['pending-payment-verifications'] });
      queryClient.invalidateQueries({ queryKey: ['accounting-invoices'] });
      setVerificationNotes('');
      setSuccessMessage(`Payment ${verificationAction === 'approve' ? 'approved' : 'rejected'} successfully!`);
      setErrorMessage('');

      // Delay closing the dialog so user can see the success message
      setTimeout(() => {
        setPaymentDialogOpen(false);
      }, 2000);
    },
    onError: (error: unknown) => {
      console.error('🔍 [VERIFY PAYMENT] Error:', error);
      const errObj = error as { response?: { data?: { message?: string } } };
      setErrorMessage(errObj.response?.data?.message || 'Failed to verify payment. Please try again.');
      setSuccessMessage('');
    },
  });

  const handleViewPayment = (payment: Payment) => {
    setSelectedPayment(payment);
    setDialogMode('view');
    setPaymentDialogOpen(true);

    // Load attendance data for this payment's course
    if (payment.courseRequestId) {
      loadAttendanceData(payment.courseRequestId);
    }

    // Load payment history for this payment's invoice
    if (payment.invoiceId) {
      loadPaymentHistory(payment.invoiceId);
    }
  };

  const handleActionPayment = (payment: Payment, action: string) => {
    setSelectedPayment(payment);
    setVerificationAction(action);
    setDialogMode('action');
    setPaymentDialogOpen(true);

    // Load attendance data for this payment's course
    if (payment.courseRequestId) {
      loadAttendanceData(payment.courseRequestId);
    }
  };

  const handleVerificationSubmit = () => {

    if (!selectedPayment) {
      return;
    }


    const paymentId = selectedPayment.paymentId || selectedPayment.id;


    verifyPaymentMutation.mutate({
      paymentId: String(paymentId ?? ''),
      action: verificationAction,
      notes: verificationNotes,
    });
  };

  const handleCloseDialog = () => {
    setPaymentDialogOpen(false);
    setSelectedPayment(null);
    setVerificationNotes('');
    setDialogMode('view');
    setAttendanceData([]); // Clear attendance data when dialog closes
    setPaymentHistory([]); // Clear payment history when dialog closes
    setVerifiedPaymentId(null);
  };

  // Handle viewing invoice
  const handleViewInvoice = async (invoiceId: number) => {
    setLoadingInvoice(true);
    try {
      const response = await api.get(`/accounting/invoices/${invoiceId}`);
      setSelectedInvoice(response.data.data);
      setInvoiceDialogOpen(true);
    } catch (error: any) {
      console.error('Error loading invoice:', error);
    } finally {
      setLoadingInvoice(false);
    }
  };

  const handleCloseInvoiceDialog = () => {
    setInvoiceDialogOpen(false);
    setSelectedInvoice(null);
  };

  // Transform payment data into service details format
  const getServiceDetails = (payment: Payment | null) => {
    if (!payment) return [];

    // For now, create a single service detail from the payment
    // In the future, this could be expanded to show multiple courses
    // Only build a service line when the backend actually supplied the pricing breakdown.
    // We never estimate rate/tax from the payment amount.
    if (payment.ratePerStudent == null || payment.baseCost == null || payment.taxAmount == null) return [];
    return [{
      date: payment.paymentDate || payment.submittedByOrgAt || '',
      location: payment.location || 'N/A',
      course: payment.courseTypeName || payment.courseType || 'N/A',
      students: payment.studentsAttended || payment.registeredStudents || 0,
      ratePerStudent: Number(payment.ratePerStudent),
      baseCost: Number(payment.baseCost),
      tax: Number(payment.taxAmount),
      total: Number(payment.amount ?? 0),
    }];
  };

  // Check if payment can be verified (not already processed)
  const canVerifyPayment = (payment: Payment | null) => {
    if (!payment) return false;
    return !payment.verifiedByAccountingAt &&
           (payment.status === 'pending_verification' ||
            payment.status === 'pending' ||
            !payment.status);
  };

  // Get payment status for display as a StatusChip kind
  const getPaymentStatusKind = (payment: Payment | null): { kind: 'success' | 'warning' | 'danger' | 'neutral'; label: string } => {
    if (!payment) {
      return { kind: 'neutral', label: 'UNKNOWN' };
    }

    // If this payment was just verified in this session, show the updated status
    const thisId = String(payment.paymentId ?? payment.id ?? '');
    if (successMessage && verifiedPaymentId != null && thisId === verifiedPaymentId) {
      if (verificationAction === 'approve') {
        return { kind: 'success', label: 'VERIFIED' };
      } else if (verificationAction === 'reject') {
        return { kind: 'danger', label: 'REJECTED' };
      }
    }

    if (payment.verifiedByAccountingAt) {
      return { kind: 'success', label: 'VERIFIED' };
    }
    if (payment.status === 'rejected') {
      return { kind: 'danger', label: 'REJECTED' };
    }
    return { kind: 'warning', label: 'PENDING VERIFICATION' };
  };

  // Debug logging

  // Force a console log to see if component is rendering

  if (isLoading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">
          <Typography sx={{ fontSize: 14, fontWeight: 600, color: (theme) => theme.palette.text.primary }}>Error loading payment verifications</Typography>
          <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{error.message}</Typography>
        </Alert>
      </Box>
    );
  }

  const payments: Payment[] = paymentsData?.payments || [];

  return (
    <Box sx={{ p: 3 }}>
      {/* Page header */}
      <Typography sx={{ fontSize: 22, fontWeight: 700, color: (theme) => theme.palette.text.primary, mb: 0.5 }}>
        Payment Verification
      </Typography>
      <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary, mb: 3 }}>
        Review and verify payment submissions from organizations.
      </Typography>

      {/* Payments table */}
      <Box sx={{ border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', bgcolor: (theme) => theme.palette.background.paper, overflow: 'hidden' }}>
        {payments.length === 0 ? (
          <Box sx={{ py: 6, textAlign: 'center' }}>
            <Typography sx={{ fontSize: 15, fontWeight: 600, color: '#16A34A', mb: 0.5 }}>
              All Payments Verified!
            </Typography>
            <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
              There are no pending payment verifications at this time.
            </Typography>
          </Box>
        ) : (
          <DataTable
            columns={PAYMENT_TABLE_COLUMNS}
            shownCount={payments.length}
            totalCount={payments.length}
          >
            {payments.map((payment: Payment) => {
              if (!payment) return null;
              const statusInfo = getPaymentStatusKind(payment);
              return (
                <DataTableRow key={payment.paymentId} columns={PAYMENT_TABLE_COLUMNS}>
                  {/* Organization */}
                  <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: (theme) => theme.palette.text.primary }}>
                    {payment.organizationName}
                  </Typography>

                  {/* Invoice # */}
                  <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
                    {payment.invoiceNumber}
                  </Typography>

                  {/* Payment Amount */}
                  <Typography sx={{ fontSize: 13, fontFamily: 'monospace', color: (theme) => theme.palette.text.primary, fontWeight: 600 }}>
                    {formatCurrency(payment.amount)}
                  </Typography>

                  {/* Payment Method */}
                  <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
                    {payment.paymentMethod?.replace('_', ' ').toUpperCase()}
                  </Typography>

                  {/* Reference # */}
                  <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
                    {payment.referenceNumber || '-'}
                  </Typography>

                  {/* Submitted Date */}
                  <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
                    {formatDisplayDate(payment.submittedByOrgAt)}
                  </Typography>

                  {/* Status */}
                  <StatusChip kind={statusInfo.kind} label={statusInfo.label} />

                  {/* Actions */}
                  <Box sx={{ display: 'flex', justifyContent: 'center' }}>
                    <Tooltip title="View Payment Details">
                      <LinkButton onClick={() => handleViewPayment(payment)} aria-label="View payment details">View</LinkButton>
                    </Tooltip>
                  </Box>
                </DataTableRow>
              );
            }).filter(Boolean)}
          </DataTable>
        )}
      </Box>

      {/* Payment Detail / Action Dialog */}
      <Dialog open={paymentDialogOpen} onClose={handleCloseDialog} maxWidth="md" fullWidth>
        <DialogTitle sx={{ fontSize: 18, fontWeight: 700, color: (theme) => theme.palette.text.primary }}>
          {dialogMode === 'action'
            ? `${verificationAction === 'approve' ? 'Approve' : 'Reject'} Payment`
            : 'Payment Details'}
          {selectedPayment && (
            <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary, mt: 0.5 }}>
              {selectedPayment.organizationName} - {selectedPayment.invoiceNumber}
            </Typography>
          )}
        </DialogTitle>
        <DialogContent>
          {selectedPayment && (
            <Box sx={{ pt: 2 }}>
              {/* Service Details Table */}
              {getServiceDetails(selectedPayment).length > 0 ? (
                <ServiceDetailsTable
                  services={getServiceDetails(selectedPayment)}
                  showTotals={false}
                />
              ) : (
                <Box sx={{ border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '8px', p: 2 }}>
                  <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.primary, mb: 1 }}>
                    Service Details
                  </Typography>
                  <Grid container spacing={1}>
                    {[
                      ['Date', selectedPayment.paymentDate || selectedPayment.submittedByOrgAt ? formatDisplayDate(selectedPayment.paymentDate || selectedPayment.submittedByOrgAt) : '—'],
                      ['Course', selectedPayment.courseTypeName || selectedPayment.courseType || '—'],
                      ['Location', selectedPayment.location || '—'],
                      ['Students', selectedPayment.studentsAttended ?? selectedPayment.registeredStudents ?? '—'],
                      ['Rate / Student', formatCurrencyOrDash(selectedPayment.ratePerStudent)],
                      ['Subtotal', formatCurrencyOrDash(selectedPayment.baseCost)],
                      ['Tax', formatCurrencyOrDash(selectedPayment.taxAmount)],
                      ['Total', formatCurrencyOrDash(selectedPayment.amount)],
                    ].map(([label, value]) => (
                      <Grid item xs={6} sm={3} key={String(label)}>
                        <Typography sx={{ fontSize: 11, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</Typography>
                        <Typography sx={{ fontSize: 13, fontWeight: 600, color: (theme) => theme.palette.text.primary, fontFamily: 'monospace' }}>{value}</Typography>
                      </Grid>
                    ))}
                  </Grid>
                  <Typography sx={{ fontSize: 11, color: (theme) => theme.palette.text.secondary, mt: 1 }}>
                    Pricing breakdown is not available for this payment; only the amount submitted is shown.
                  </Typography>
                </Box>
              )}

              {/* Student Attendance Section */}
              <Divider sx={{ my: 2 }} />
              <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.07em', mb: 1 }}>
                Class Attendance
              </Typography>
              {loadingAttendance ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', p: 2 }}>
                  <CircularProgress size={24} />
                </Box>
              ) : attendanceData.length > 0 ? (
                <Box sx={{ mb: 2 }}>
                  <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary, mb: 1 }}>
                    Total Students: {attendanceData.length} &nbsp;|&nbsp;
                    Present: {attendanceData.filter(s => s.attended).length} &nbsp;|&nbsp;
                    Absent: {attendanceData.filter(s => !s.attended).length}
                  </Typography>
                  <Box sx={{ border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', overflow: 'hidden', mt: 1 }}>
                    <DataTable
                      columns={ATTENDANCE_TABLE_COLUMNS}
                      shownCount={attendanceData.length}
                      totalCount={attendanceData.length}
                    >
                      {attendanceData.map((student, index) => (
                        <DataTableRow key={index} columns={ATTENDANCE_TABLE_COLUMNS}>
                          {/* Name */}
                          <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.primary }}>
                            {student.firstName} {student.lastName}
                          </Typography>

                          {/* Email */}
                          <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
                            {student.email || 'N/A'}
                          </Typography>

                          {/* Status */}
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
                </Box>
              ) : (
                <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
                  No student attendance data available
                </Typography>
              )}

              {/* Payment Information */}
              <Divider sx={{ my: 2 }} />
              <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.07em', mb: 2 }}>
                Payment Information
              </Typography>
              <Grid container spacing={3}>
                <Grid item xs={12} sm={6}>
                  <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>Invoice Number</Typography>
                  <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: (theme) => theme.palette.text.primary }}>
                    {selectedPayment.invoiceNumber}
                  </Typography>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>Payment Amount</Typography>
                  <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: '#16A34A', fontFamily: 'monospace' }}>
                    {formatCurrency(selectedPayment.amount)}
                  </Typography>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>Payment Method</Typography>
                  <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: (theme) => theme.palette.text.primary }}>
                    {selectedPayment.paymentMethod?.replace('_', ' ').toUpperCase()}
                  </Typography>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>Reference Number</Typography>
                  <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: (theme) => theme.palette.text.primary }}>
                    {selectedPayment.referenceNumber || '-'}
                  </Typography>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>Payment Date</Typography>
                  <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: (theme) => theme.palette.text.primary }}>
                    {formatDisplayDate(selectedPayment.paymentDate)}
                  </Typography>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>Submitted Date</Typography>
                  <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: (theme) => theme.palette.text.primary }}>
                    {formatDisplayDate(selectedPayment.submittedByOrgAt)}
                  </Typography>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary, mb: 0.5 }}>Status</Typography>
                  <StatusChip
                    kind={getPaymentStatusKind(selectedPayment).kind}
                    label={getPaymentStatusKind(selectedPayment).label}
                  />
                </Grid>
                {selectedPayment.verifiedByAccountingAt && (
                  <Grid item xs={12} sm={6}>
                    <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>Verified By Accounting</Typography>
                    <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: (theme) => theme.palette.text.primary }}>
                      {formatDisplayDate(selectedPayment.verifiedByAccountingAt)}
                    </Typography>
                  </Grid>
                )}
                {selectedPayment.notes && (
                  <Grid item xs={12}>
                    <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>Organization Notes</Typography>
                    <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary, fontStyle: 'italic' }}>
                      {selectedPayment.notes}
                    </Typography>
                  </Grid>
                )}

                {/* Action-specific content */}
                {dialogMode === 'action' && (
                  <Grid item xs={12}>
                    <TextField
                      fullWidth
                      label="Verification Notes"
                      multiline
                      rows={3}
                      value={verificationNotes}
                      onChange={e => setVerificationNotes(e.target.value)}
                      placeholder={
                        verificationAction === 'approve'
                          ? 'Optional notes about the approval...'
                          : 'Required: Reason for rejection...'
                      }
                      required={verificationAction === 'reject'}
                    />
                  </Grid>
                )}
              </Grid>

              {dialogMode === 'action' && (
                <Alert
                  severity={verificationAction === 'approve' ? 'success' : 'warning'}
                  sx={{ mt: 2 }}
                >
                  {verificationAction === 'approve'
                    ? 'This payment will be marked as verified and the invoice status will be updated accordingly.'
                    : 'This payment will be rejected and the organization will be notified to resubmit.'}
                </Alert>
              )}

              {/* Payment History Section */}
              <Divider sx={{ my: 2 }} />
              <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.07em', mb: 1 }}>
                Payment History
              </Typography>

              <PaymentHistoryTable
                payments={paymentHistory}
                isLoading={loadingPaymentHistory}
                showVerificationDetails={true}
                onViewInvoice={handleViewInvoice}
              />

              {dialogMode === 'view' && (
                <Alert severity="info" sx={{ mt: 2 }}>
                  Review the payment details above. Use the action buttons below to approve or reject this payment.
                </Alert>
              )}

              {/* Success message in dialog */}
              {successMessage && (
                <Alert severity="success" sx={{ mt: 2 }}>
                  {successMessage}
                </Alert>
              )}

              {/* Error message in dialog */}
              {errorMessage && (
                <Alert severity="error" sx={{ mt: 2 }}>
                  {errorMessage}
                </Alert>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <GhostButton onClick={handleCloseDialog}>
            {dialogMode === 'view' ? 'Close' : 'Cancel'}
          </GhostButton>

          {/* Action buttons for view mode */}
          {dialogMode === 'view' && canVerifyPayment(selectedPayment) && (
            <>
              <GhostButton
                onClick={() => {
                  setVerificationAction('reject');
                  setDialogMode('action');
                }}
                disabled={verifyPaymentMutation.isPending}
                sx={{ color: '#CC1F1F', borderColor: '#CC1F1F', '&:hover': { borderColor: '#CC1F1F', bgcolor: '#FEF2F2' } }}
              >
                Reject Payment
              </GhostButton>
              <PrimaryButton
                onClick={() => {
                  // Directly approve without going to action mode (notes are optional for approval)
                  if (selectedPayment) {
                    const paymentId = selectedPayment.paymentId || selectedPayment.id;
                    verifyPaymentMutation.mutate({
                      paymentId: String(paymentId ?? ''),
                      action: 'approve',
                      notes: '',
                    });
                  }
                }}
                disabled={verifyPaymentMutation.isPending}
              >
                {verifyPaymentMutation.isPending ? 'Approving...' : 'Approve Payment'}
              </PrimaryButton>
            </>
          )}

          {/* Submit button for action mode */}
          {dialogMode === 'action' && (
            <PrimaryButton
              onClick={handleVerificationSubmit}
              disabled={
                verifyPaymentMutation.isPending ||
                (verificationAction === 'reject' && !verificationNotes.trim()) ||
                !!successMessage
              }
              sx={verificationAction === 'reject' ? { bgcolor: '#CC1F1F', '&:hover': { bgcolor: '#991B1B' } } : {}}
            >
              {verifyPaymentMutation.isPending
                ? 'Processing...'
                : successMessage
                  ? 'Completed!'
                  : verificationAction === 'approve'
                    ? 'Approve Payment'
                    : 'Reject Payment'}
            </PrimaryButton>
          )}
        </DialogActions>
      </Dialog>

      {/* Invoice Detail Dialog */}
      <Dialog open={invoiceDialogOpen} onClose={handleCloseInvoiceDialog} maxWidth="md" fullWidth>
        <DialogTitle sx={{ fontSize: 18, fontWeight: 700, color: (theme) => theme.palette.text.primary }}>
          Invoice Details
        </DialogTitle>
        <DialogContent>
          {loadingInvoice ? (
            <Box display="flex" justifyContent="center" p={3}>
              <CircularProgress />
            </Box>
          ) : selectedInvoice ? (
            <Box>
              <Grid container spacing={2}>
                <Grid item xs={12} sm={6}>
                  <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>Invoice Number</Typography>
                  <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: (theme) => theme.palette.text.primary }}>
                    {selectedInvoice.invoicenumber}
                  </Typography>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>Organization</Typography>
                  <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: (theme) => theme.palette.text.primary }}>
                    {selectedInvoice.organizationname}
                  </Typography>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>Course Type</Typography>
                  <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: (theme) => theme.palette.text.primary }}>
                    {selectedInvoice.name}
                  </Typography>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>Location</Typography>
                  <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: (theme) => theme.palette.text.primary }}>
                    {selectedInvoice.location}
                  </Typography>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>Course Date</Typography>
                  <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: (theme) => theme.palette.text.primary }}>
                    {selectedInvoice.courseDate ? formatDisplayDate(selectedInvoice.courseDate) : 'N/A'}
                  </Typography>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>Students Billed</Typography>
                  <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: (theme) => theme.palette.text.primary }}>
                    {selectedInvoice.studentsattendance}
                  </Typography>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>Total Amount</Typography>
                  <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: (theme) => theme.palette.text.primary, fontFamily: 'monospace' }}>
                    ${Number(selectedInvoice.amount || 0).toFixed(2)}
                  </Typography>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>Amount Paid</Typography>
                  <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: '#16A34A', fontFamily: 'monospace' }}>
                    ${Number(selectedInvoice.amountPaid || 0).toFixed(2)}
                  </Typography>
                </Grid>
                <Grid item xs={12}>
                  <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>Balance Due</Typography>
                  <Typography
                    sx={{
                      fontSize: 13.5,
                      fontWeight: 600,
                      fontFamily: 'monospace',
                      color: Number(selectedInvoice.balanceDue || 0) > 0 ? '#CC1F1F' : '#16A34A',
                    }}
                  >
                    ${Number(selectedInvoice.balanceDue || 0).toFixed(2)}
                  </Typography>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>Due Date</Typography>
                  <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: (theme) => theme.palette.text.primary }}>
                    {selectedInvoice.duedate ? formatDisplayDate(selectedInvoice.duedate) : 'N/A'}
                  </Typography>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary, mb: 0.5 }}>Status</Typography>
                  <StatusChip
                    kind={getPaymentStatusKind(selectedInvoice).kind}
                    label={String(selectedInvoice.paymentstatus || selectedInvoice.status || 'unknown').toUpperCase()}
                  />
                </Grid>
              </Grid>
            </Box>
          ) : (
            <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
              No invoice details available.
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <GhostButton onClick={handleCloseInvoiceDialog}>Close</GhostButton>
        </DialogActions>
      </Dialog>

      {/* Success Snackbar */}
      <Snackbar
        open={!!successMessage}
        autoHideDuration={6000}
        onClose={() => setSuccessMessage('')}
      >
        <Alert severity="success" onClose={() => setSuccessMessage('')}>
          {successMessage}
        </Alert>
      </Snackbar>

      {/* Error Snackbar */}
      <Snackbar
        open={!!errorMessage}
        autoHideDuration={6000}
        onClose={() => setErrorMessage('')}
      >
        <Alert severity="error" onClose={() => setErrorMessage('')}>
          {errorMessage}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default PaymentVerificationView;
