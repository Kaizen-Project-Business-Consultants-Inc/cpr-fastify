import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Box,
  CircularProgress,
  Alert,
  Grid,
  Divider,
  TextField,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
} from '@mui/material';
import api, { getInvoiceDetails, postInvoiceToOrganization } from '../../services/api';
import { useConfirm } from '../gtacpr';
import { tokenService } from '../../services/tokenService';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { CheckCircle as PresentIcon, Cancel as AbsentIcon, People as PeopleIcon } from '@mui/icons-material';
import logger from '../../utils/logger';
import { getErrorMessage } from '../../utils/errorMessage';
import { formatDisplayDate } from '../../utils/dateUtils';
import { API_URL } from '../../config';
import ServiceDetailsTable from '../common/ServiceDetailsTable';
import PaymentHistoryTable from '../common/PaymentHistoryTable';

/**
 * GET /accounting/invoices/:id (InvoiceRepository.findByIdWithDetails). The
 * names are the SQL ones; DECIMALs arrive as strings, posted_to_org as 0/1.
 */
interface InvoiceData {
  id?: number;
  invoice_number?: string;
  invoice_date?: string;
  due_date?: string;
  amount?: number | string;
  base_cost?: number | string;
  tax_amount?: number | string;
  students_billed?: number;
  rate_per_student?: number | string;
  payment_status?: string;
  notes?: string | null;
  course_request_id?: number | null;
  course_type_name?: string | null;
  location?: string | null;
  date_completed?: string | null;
  organization_name?: string;
  contact_name?: string | null;
  contact_email?: string | null;
  address?: string | null;
  address_street?: string | null;
  address_city?: string | null;
  address_province?: string | null;
  address_postal_code?: string | null;
  approval_status?: string;
  approved_by_name?: string | null;
  approved_at?: string | null;
  posted_to_org?: boolean | number;
}

interface StudentRecord {
  id: number;
  firstName: string;
  lastName: string;
  email?: string;
  attended: boolean | number; // TINYINT: 0/1
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
}

const InvoiceDetailDialog = ({
  open,
  onClose,
  invoiceId,
  onActionSuccess,
  onActionError,
  showPostToOrgButton = true, // Shows Post to Organization for an approved invoice that isn't posted yet
  showApprovalActions = false, // New prop to show Approve/Reject buttons for pending approvals
  onApprove,
  onReject,
}: {
  open: boolean;
  onClose: () => void;
  invoiceId: number | null;
  onActionSuccess?: (message: string) => void;
  onActionError?: (message: string) => void;
  showPostToOrgButton?: boolean;
  showApprovalActions?: boolean;
  onApprove?: (invoiceId: number) => Promise<void>;
  onReject?: (invoiceId: number, reason: string) => Promise<void>;
}) => {
  const [invoice, setInvoice] = useState<InvoiceData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const { confirm, dialog: confirmDialog } = useConfirm();
  
  // Payment request processing state

  const [paymentNotes, setPaymentNotes] = useState('');
  const [processingPayment, setProcessingPayment] = useState(false);

  // Student list state
  const [students, setStudents] = useState<StudentRecord[]>([]);
  const [loadingStudents, setLoadingStudents] = useState(false);

  // Payment history state
  const [paymentHistory, setPaymentHistory] = useState<Payment[]>([]);
  const [loadingPaymentHistory, setLoadingPaymentHistory] = useState(false);

  // Approval action state
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');
  const [isApproving, setIsApproving] = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);

  // Transform invoice data into service details format
  const getServiceDetails = (invoiceData: InvoiceData | null) => {
    if (!invoiceData) return [];

    // The invoice's own stored figures, so this matches the PDF and the list.
    return [{
      date: invoiceData.date_completed || '',
      location: invoiceData.location || '',
      course: `${invoiceData.course_type_name || 'Course'} (#${invoiceData.course_request_id ?? '-'})`,
      students: Number(invoiceData.students_billed) || 0,
      ratePerStudent: Number(invoiceData.rate_per_student) || 0,
      baseCost: Number(invoiceData.base_cost) || 0,
      tax: Number(invoiceData.tax_amount) || 0,
      total: Number(invoiceData.amount) || 0,
    }];
  };

  // Fetch student attendance data for a specific course
  const fetchStudents = async (courseId: string | number) => {
    if (!courseId) {
      console.error('No course ID provided for fetching students');
      setStudents([]);
      return;
    }

    setLoadingStudents(true);
    try {
      const response = await api.get(`/courses/${courseId}/students`);
      setStudents(response.data.data || []);
    } catch (error) {
      console.error('[InvoiceDetailDialog] Error fetching students:', error);
      setStudents([]);
    } finally {
      setLoadingStudents(false);
    }
  };

  // Fetch payment history for an invoice
  const fetchPaymentHistory = async (invId: number) => {
    if (!invId) {
      console.error('No invoice ID provided for fetching payment history');
      setPaymentHistory([]);
      return;
    }

    setLoadingPaymentHistory(true);
    try {
      const response = await api.get(`/accounting/invoices/${invId}/payments`);

      if (response.data && response.data.success && Array.isArray(response.data.data)) {
        setPaymentHistory(response.data.data);
      } else {
        console.warn('Unexpected payment history response format:', response.data);
        setPaymentHistory([]);
      }
    } catch (error) {
      console.error('Error fetching payment history:', error);
      setPaymentHistory([]);
    } finally {
      setLoadingPaymentHistory(false);
    }
  };

  // Reset rejection form state when dialog closes
  useEffect(() => {
    if (!open) {
      setShowRejectForm(false);
      setRejectionReason('');
    }
  }, [open]);

  // Handle approve action
  const handleApproveClick = async () => {
    if (!invoiceId || !onApprove) return;
    setIsApproving(true);
    try {
      await onApprove(invoiceId);
    } finally {
      setIsApproving(false);
    }
  };

  // Handle reject action
  const handleRejectClick = async () => {
    if (!invoiceId || !onReject) return;
    if (!rejectionReason.trim()) {
      if (onActionError) onActionError('Please enter a reason for rejection');
      return;
    }
    setIsRejecting(true);
    try {
      await onReject(invoiceId, rejectionReason.trim());
    } finally {
      setIsRejecting(false);
    }
  };

  useEffect(() => {
    if (open && invoiceId) {
      const fetchInvoiceDetails = async () => {
        // Check if user is authenticated before making API call
        const token = tokenService.getAccessToken();
        if (!token) {
          setError('Please log in to view invoice details. Redirecting to login...');
          setTimeout(() => {
            window.location.href = '/login';
          }, 2000);
          return;
        }

        setIsLoading(true);
        setError('');
        setInvoice(null);
        logger.info(`Fetching invoice details for ID: ${invoiceId}`);
        try {
          const data = await getInvoiceDetails(invoiceId) as InvoiceData;
          logger.info(`Invoice details fetched successfully: ${invoiceId}`);
          setInvoice(data);

          // Fetch students for this course
          if (data.course_request_id) {
            fetchStudents(data.course_request_id);
          }
        
        // Fetch payment history
        fetchPaymentHistory(invoiceId);
        } catch (err: unknown) {
          logger.error('Failed to fetch invoice details:', err);

          // Handle authentication errors specifically
          const errObj = err as { response?: { status?: number } };
          if (errObj.response?.status === 401) {
            setError('Please log in to view invoice details. Redirecting to login...');
            // Redirect to login after a short delay
            setTimeout(() => {
              window.location.href = '/login';
            }, 2000);
          } else {
            setError(getErrorMessage(err, 'Failed to load invoice details'));
          }
        } finally {
          setIsLoading(false);
        }
      };
      fetchInvoiceDetails();
    } else {
      // Clear student data when dialog closes
      setStudents([]);
      setLoadingStudents(false);
    }
  }, [open, invoiceId]);

  const handleDownload = async () => {
    if (!invoice?.id) {
      logger.error('No invoice ID available for download');
      return;
    }

    try {
      logger.info(`[PDF Download] Starting download for invoice ${invoice.id}`);

      // Get the auth token from tokenService (secure in-memory storage)
      const token = tokenService.getAccessToken();
      
      const response = await fetch(
        `${API_URL}/accounting/invoices/${invoice.id}/pdf`,
        {
          method: 'GET',
          credentials: 'include',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      logger.info(`[PDF Download] Response status: ${response.status}`);

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(`[PDF Download] Error response:`, errorText);
        throw new Error(
          `HTTP error! status: ${response.status} - ${errorText}`
        );
      }

      // Check if the response is actually a PDF
      const contentType = response.headers.get('content-type');
      logger.info(`[PDF Download] Content-Type: ${contentType}`);

      if (!contentType || !contentType.includes('application/pdf')) {
        logger.error('Response is not a PDF:', contentType);
        const text = await response.text();
        logger.error('Response body:', text);
        throw new Error('Server did not return a PDF file');
      }

      // Get the PDF blob
      const blob = await response.blob();
      logger.info(
        `[PDF Download] Blob created, size: ${blob.size} bytes, type: ${blob.type}`
      );

      // Verify the blob size
      if (blob.size === 0) {
        throw new Error('PDF file is empty');
      }

      // Create download link
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `Invoice-${invoice.invoice_number}.pdf`;
      link.style.display = 'none';

      // Add to DOM, click, and remove
      document.body.appendChild(link);
      link.click();

      // Clean up after a short delay
      setTimeout(() => {
        if (document.body.contains(link)) {
          document.body.removeChild(link);
        }
        window.URL.revokeObjectURL(url);
        logger.info('[PDF Download] Cleanup completed');
      }, 1000);

      logger.info('[PDF Download] Download initiated successfully');
    } catch (error: unknown) {
      logger.error('[PDF Download] Error:', error);
      if (onActionError) onActionError(`Failed to download PDF: ${getErrorMessage(error)}`);
    }
  };

  // An invoice approved from Pending Approvals is approved but not yet
  // posted, so the organization can't see it until it is posted here.
  const handlePostToOrg = async () => {
    if (!invoice?.id || processingPayment) return;
    const ok = await confirm({
      title: 'Post this invoice to the organization?',
      message: `Invoice ${invoice.invoice_number || ''} will be posted to the portal of ${invoice.organization_name || 'the organization'}, where their users can see and pay it, and its billing contact is emailed. This cannot be undone.`,
      confirmLabel: 'Post Invoice',
      danger: true,
    });
    if (!ok) return;

    setProcessingPayment(true);
    try {
      await postInvoiceToOrganization(invoice.id);
      if (onActionSuccess) onActionSuccess('Invoice posted to the organization portal');
      onClose();
    } catch (err: unknown) {
      logger.error('Error posting invoice to organization:', err);
      if (onActionError) onActionError(getErrorMessage(err, 'Failed to post invoice to organization'));
    } finally {
      setProcessingPayment(false);
    }
  };

  const handleProcessPayment = async () => {
    if (!invoice?.id || processingPayment) return;

    const ok = await confirm({
      title: 'Approve and post this invoice?',
      message: `Invoice ${invoice.invoice_number || ''} for ${invoice.organization_name || 'this organization'} will be approved and posted to the organization portal, where their users can see and pay it, and its billing contact is emailed. These steps cannot be undone.`,
      confirmLabel: 'Approve & Post',
      danger: true,
    });
    if (!ok) return;

    setProcessingPayment(true);
    try {
      logger.info(`Processing invoice approval, posting, and email for invoice ${invoice.id}`);
      
      // Step 1: Approve the invoice
      const approveResponse = await api.put(`/accounting/invoices/${invoice.id}/approval`, {
        approvalStatus: 'approved',
        notes: paymentNotes || `Invoice approved by accounting`
      });
      
      if (!approveResponse.data.success) {
        throw new Error(approveResponse.data.message || `Failed to approve invoice`);
      }
      
      // Step 2: Post to the organization portal (the server emails the billing contact)
      logger.info(`Posting invoice ${invoice.id} to organization`);
      const postResponse = await postInvoiceToOrganization(invoice.id);
      
      if (!postResponse.success) {
        throw new Error(postResponse.message || `Failed to post invoice to organization`);
      }
      
      const message = `Invoice approved and posted to the organization portal`;
      
      // Refresh the invoice data to show updated status
      const updatedInvoice = await getInvoiceDetails(invoice.id) as InvoiceData;
      setInvoice(updatedInvoice);

      if (onActionSuccess) onActionSuccess(message);
      onClose();
    } catch (err: unknown) {
      logger.error(`Error processing invoice approval and posting:`, err);
      if (onActionError) onActionError(getErrorMessage(err, `Failed to approve and post invoice`));
    } finally {
      setProcessingPayment(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth='md' fullWidth>
      <DialogTitle>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="h6">
            Invoice Details {invoice ? `(#${invoice.invoice_number})` : ''}
          </Typography>
        </Box>
      </DialogTitle>
      <DialogContent dividers>
        {isLoading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
            <CircularProgress />
          </Box>
        )}
        {error && <Alert severity='error'>{error}</Alert>}
        {invoice && !isLoading && (
          <Box sx={{ p: 1 }}>
            {/* Container for Header Info */}
            <Grid container spacing={2}>
              {/* Header Info - Remove 'item' prop */}
              <Grid xs={6} md={3}>
                <Typography variant='body2'>
                  <strong>Invoice #:</strong> {invoice.invoice_number}
                </Typography>
              </Grid>
              <Grid xs={6} md={3}>
                <Typography variant='body2'>
                  <strong>Invoice Date:</strong>{' '}
                  {invoice.invoice_date ? formatDisplayDate(invoice.invoice_date) : ''}
                </Typography>
              </Grid>
              <Grid xs={6} md={3}>
                <Typography variant='body2'>
                  <strong>Due Date:</strong> {invoice.due_date ? formatDisplayDate(invoice.due_date) : ''}
                </Typography>
              </Grid>
              <Grid xs={6} md={3}>
                <Typography variant='body2'>
                  <strong>Status:</strong> {invoice.payment_status}
                </Typography>
              </Grid>
            </Grid>
            <Divider sx={{ my: 2 }} />
            {/* Organization Info */}
            <Typography variant='subtitle1' gutterBottom>
              Bill To:
            </Typography>
            <Typography variant='body1'>{invoice.organization_name}</Typography>
            {invoice.address_street ? (
              <Typography variant='body2'>{invoice.address_street}</Typography>
            ) : invoice.address ? (
              <Typography variant='body2'>{invoice.address}</Typography>
            ) : null}
            {invoice.address_city && (
              <Typography variant='body2'>{`${invoice.address_city}, ${invoice.address_province || ''} ${invoice.address_postal_code || ''}`}</Typography>
            )}
            {invoice.contact_name && (
              <Typography variant='body2'>
                Attn: {invoice.contact_name}
              </Typography>
            )}
            {invoice.contact_email && (
              <Typography variant='body2'>
                Email: {invoice.contact_email}
              </Typography>
            )}
            <Divider sx={{ my: 2 }} />
            {/* Service Details Table */}
            <ServiceDetailsTable 
              services={getServiceDetails(invoice)}
              showTotals={false}
            />
            
            {/* Student Attendance Section */}
            <Divider sx={{ my: 2 }} />
            <Typography variant='subtitle1' gutterBottom sx={{ mt: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <PeopleIcon color="primary" />
                Student Attendance List
              </Box>
            </Typography>
            
            {loadingStudents ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
                <CircularProgress />
              </Box>
            ) : students.length > 0 ? (
              <>
                <Box sx={{ mb: 2 }}>
                  <Typography variant="body2" color="textSecondary">
                    Present: {students.filter(s => s.attended).length} | 
                    Absent: {students.filter(s => !s.attended).length} | 
                    Total: {students.length}
                  </Typography>
                </Box>
                <TableContainer component={Paper} sx={{ mb: 2 }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Student Name</TableCell>
                        <TableCell>Email</TableCell>
                        <TableCell align="center">Attendance Status</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {students.map((student) => (
                        <TableRow key={student.id}>
                          <TableCell>
                            <Typography variant="body2" fontWeight="medium">
                              {student.firstName} {student.lastName}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2" color="textSecondary">
                              {student.email || 'No email'}
                            </Typography>
                          </TableCell>
                          <TableCell align="center">
                            {student.attended ? (
                              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5 }}>
                                <PresentIcon color="success" fontSize="small" />
                                <Typography variant="body2" color="success.main">
                                  Present
                                </Typography>
                              </Box>
                            ) : (
                              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5 }}>
                                <AbsentIcon color="error" fontSize="small" />
                                <Typography variant="body2" color="error.main">
                                  Absent
                                </Typography>
                              </Box>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </>
            ) : (
              <Alert severity="info">
                No student attendance data available for this course.
              </Alert>
            )}
            
            {/* Payment History Section */}
            <Divider sx={{ my: 2 }} />
            <Typography variant='subtitle1' gutterBottom sx={{ mt: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography variant="h6" component="span">💰</Typography>
                Payment History
              </Box>
            </Typography>
            
            <PaymentHistoryTable
              payments={paymentHistory}
              isLoading={loadingPaymentHistory}
              showVerificationDetails={true}
              onViewInvoice={() => {}} // Already showing invoice details in this dialog
            />
            
            {/* Invoice Approval Section */}
            <Divider sx={{ my: 2 }} />
            <Typography variant='subtitle1' gutterBottom sx={{ mt: 2 }}>
              Invoice Approval:
            </Typography>
            
            {/* Show approval information if already approved */}
            {invoice?.approval_status === 'approved' && (
              <Box sx={{ mb: 2 }}>
                <Alert severity="success" sx={{ mb: 2 }}>
                  <Typography variant="body2">
                    <strong>Approved by:</strong> {invoice.approved_by_name || 'Unknown'} 
                    {invoice.approved_at && (
                      <span> on {formatDisplayDate(invoice.approved_at)}</span>
                    )}
                  </Typography>
                </Alert>
                {invoice.notes && (
                  <Typography variant="body2" sx={{ mt: 1, p: 2, bgcolor: 'grey.50', borderRadius: 1 }}>
                    <strong>Approval Notes:</strong><br />
                    {invoice.notes}
                  </Typography>
                )}
              </Box>
            )}
            
            {/* Show message when approval is not available */}
            {!['pending approval', 'pending_approval', 'pending', 'draft', 'new'].includes((invoice?.approval_status || '').toLowerCase()) && invoice?.approval_status !== 'approved' && (
              <Alert severity="info" sx={{ mb: 2 }}>
                {`This invoice has status "${invoice?.approval_status || 'unknown'}" and cannot be approved.`}
              </Alert>
            )}
            
            {/* Show approval controls only when available */}
            {['pending approval', 'pending_approval', 'pending', 'draft', 'new'].includes((invoice?.approval_status || '').toLowerCase()) && (
              <>
                <Typography variant='body2' color='text.secondary' sx={{ mb: 2 }}>
                  {showApprovalActions
                    ? "(Approving does not post the invoice yet. Post it from Organization Receivables; posting emails the organization's billing contact.)"
                    : "(Approve & Post puts the invoice in the organization's portal and emails its billing contact.)"}
                </Typography>
                <Grid container spacing={2} sx={{ mt: 1 }}>
                  <Grid xs={12} sm={6}>
                    <TextField
                      label="Notes (Optional)"
                      fullWidth
                      multiline
                      rows={2}
                      value={paymentNotes}
                      onChange={(e) => setPaymentNotes(e.target.value)}
                      disabled={processingPayment}
                    />
                  </Grid>
                </Grid>
                

              </>
            )}
            
          </Box>
        )}
      </DialogContent>
            <DialogActions sx={{ flexDirection: 'column', alignItems: 'stretch', gap: 2, p: 2 }}>

        {/* Approval Actions Section - Only show when showApprovalActions is true */}
        {showApprovalActions && (
          <Box sx={{ width: '100%', borderBottom: 1, borderColor: 'divider', pb: 2 }}>
            {!showRejectForm ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', gap: 2 }}>
                <Button
                  variant='contained'
                  color='success'
                  onClick={handleApproveClick}
                  disabled={isApproving || isRejecting}
                  startIcon={
                    isApproving
                      ? <CircularProgress size={20} color='inherit' />
                      : <CheckCircleIcon />
                  }
                  sx={{ minWidth: 150 }}
                >
                  {isApproving ? 'Approving...' : 'Approve Invoice'}
                </Button>
                <Button
                  variant='outlined'
                  color='error'
                  onClick={() => setShowRejectForm(true)}
                  disabled={isApproving || isRejecting}
                  sx={{ minWidth: 150 }}
                >
                  Reject Invoice
                </Button>
              </Box>
            ) : (
              <Box sx={{ width: '100%' }}>
                <Typography variant="subtitle2" color="error" gutterBottom>
                  Rejection Reason (required):
                </Typography>
                <TextField
                  fullWidth
                  multiline
                  rows={3}
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  placeholder="Please provide a detailed reason for rejecting this invoice..."
                  disabled={isRejecting}
                  sx={{ mb: 2 }}
                />
                <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 2 }}>
                  <Button
                    variant='outlined'
                    color='inherit'
                    onClick={() => {
                      setShowRejectForm(false);
                      setRejectionReason('');
                    }}
                    disabled={isRejecting}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant='contained'
                    color='error'
                    onClick={handleRejectClick}
                    disabled={isRejecting || !rejectionReason.trim()}
                    startIcon={
                      isRejecting ? <CircularProgress size={20} color='inherit' /> : null
                    }
                  >
                    {isRejecting ? 'Rejecting...' : 'Confirm Rejection'}
                  </Button>
                </Box>
              </Box>
            )}
          </Box>
        )}

        {/* Regular action buttons */}
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, width: '100%' }}>

        {/* Approve & Post Invoice Button - Only show when approval is available and NOT in approval mode */}
        {!showApprovalActions && ['pending approval', 'pending_approval', 'pending', 'draft', 'new'].includes((invoice?.approval_status || '').toLowerCase()) && (
          <Button
            variant='contained'
            color='success'
            onClick={handleProcessPayment}
            disabled={processingPayment}
            startIcon={
              processingPayment
                ? <CircularProgress size={20} color='inherit' />
                : <CheckCircleIcon />
            }
          >
            {processingPayment
              ? 'Processing...'
              : 'Approve & Post Invoice'}
          </Button>
        )}

        {showPostToOrgButton && invoice?.approval_status === 'approved' && !invoice.posted_to_org && (
          <Button
            variant='contained'
            color='primary'
            onClick={handlePostToOrg}
            disabled={processingPayment}
            startIcon={processingPayment ? <CircularProgress size={20} color='inherit' /> : undefined}
          >
            {processingPayment ? 'Posting...' : 'Post to Organization'}
          </Button>
        )}

        <Button onClick={handleDownload} color='info' variant='outlined'>
          Download PDF
        </Button>

        <Button onClick={onClose} color='inherit'>
          Close
        </Button>
        </Box>
      </DialogActions>
      {confirmDialog}
    </Dialog>
  );
};

export default InvoiceDetailDialog;
