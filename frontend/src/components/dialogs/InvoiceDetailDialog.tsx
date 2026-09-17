import React, { useState, useEffect, useRef } from 'react';
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
  Tooltip,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
} from '@mui/material';
import api, { getInvoiceDetails, postInvoiceToOrganization, emailInvoice, updateInvoice } from '../../services/api';
import { tokenService } from '../../services/tokenService';
import EmailIcon from '@mui/icons-material/Email';
import PostAddIcon from '@mui/icons-material/PostAdd';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { CheckCircle as PresentIcon, Cancel as AbsentIcon, People as PeopleIcon } from '@mui/icons-material';
import logger from '../../utils/logger';
import { formatDisplayDate } from '../../utils/dateUtils';
import { API_URL } from '../../config';
import ServiceDetailsTable from '../common/ServiceDetailsTable';
import PaymentHistoryTable from '../common/PaymentHistoryTable';

// Helper function to format currency
const formatCurrency = (amount: number | string | null | undefined): string => {
  if (amount == null) return 'N/A';
  return `$${parseFloat(String(amount)).toFixed(2)}`;
};

interface InvoiceData {
  id?: number;
  amount?: number;
  duedate?: string;
  paymentstatus?: string;
  notes?: string;
  coursenumber?: string;
  invoicenumber?: string;
  organizationname?: string;
  organizationid?: number;
  invoicedate?: string;
  coursetype?: string;
  courseid?: number;
  location?: string;
  studentsattended?: number;
  registeredstudents?: number;
  paidtodate?: number;
  // Additional fields for display
  name?: string;
  datecompleted?: string;
  studentsattendance?: number;
  ratePerStudent?: number;
  addressstreet?: string;
  addresscity?: string;
  addressprovince?: string;
  addresspostalcode?: string;
  contactname?: string;
  contactemail?: string;
  approval_status?: string;
  approved_by_username?: string;
  approved_at?: string;
  posted_to_org?: boolean;
  emailsentat?: string;
  approvalStatus?: string;
  [key: string]: unknown;
}

interface StudentRecord {
  id: number;
  firstName: string;
  lastName: string;
  email?: string;
  attended: boolean;
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
  showPostToOrgButton = true, // New prop to control Post to Org button visibility
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
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [isPostingToOrg, setIsPostingToOrg] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    amount: '',
    dueDate: '',
    status: '',
    notes: '',
  });
  
  // Payment request processing state

  const [paymentNotes, setPaymentNotes] = useState('');
  const [processingPayment, setProcessingPayment] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState('bank_transfer');
  
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

  // Ref to prevent multiple clicks
  const isPostingRef = useRef(false);

  // Transform invoice data into service details format
  const getServiceDetails = (invoiceData: InvoiceData | null) => {
    if (!invoiceData) return [];

    return [{
      date: invoiceData.datecompleted || '',
      location: invoiceData.location || '',
      course: `${invoiceData.name} (${invoiceData.coursenumber})`,
      students: invoiceData.studentsattendance || 0,
      ratePerStudent: invoiceData.ratePerStudent || 0,
      baseCost: invoiceData.ratePerStudent ? (invoiceData.ratePerStudent * (invoiceData.studentsattendance || 0)) : 0,
      tax: invoiceData.ratePerStudent ? (invoiceData.ratePerStudent * (invoiceData.studentsattendance || 0) * 0.13) : 0,
      total: invoiceData.ratePerStudent ? (invoiceData.ratePerStudent * (invoiceData.studentsattendance || 0) * 1.13) : 0,
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
    } catch (error: any) {
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
      } else if (response.data && Array.isArray(response.data)) {
        setPaymentHistory(response.data);
      } else if (response.data && response.data.payments && Array.isArray(response.data.payments)) {
        setPaymentHistory(response.data.payments);
      } else {
        console.warn('Unexpected payment history response format:', response.data);
        setPaymentHistory([]);
      }
    } catch (error: any) {
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
          setFormData({
            amount: data.amount != null ? String(data.amount) : '',
            dueDate: data.duedate || '',
            status: data.paymentstatus || '',
            notes: data.notes || '',
          });

          // Fetch students for this course
          if (data.coursenumber) {
            fetchStudents(data.coursenumber);
          }
        
        // Fetch payment history
        fetchPaymentHistory(invoiceId);
        } catch (err: unknown) {
          logger.error('Failed to fetch invoice details:', err);

          // Handle authentication errors specifically
          const errObj = err as { message?: string };
          if (errObj.message?.includes('No token provided') || errObj.message?.includes('Unauthorized')) {
            setError('Please log in to view invoice details. Redirecting to login...');
            // Redirect to login after a short delay
            setTimeout(() => {
              window.location.href = '/login';
            }, 2000);
          } else {
            setError(errObj.message || 'Failed to load invoice details');
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

  const handlePostToOrganization = async () => {
    if (!invoiceId || isPostingRef.current) return; // Prevent multiple clicks
    isPostingRef.current = true;
    logger.debug(
      `[InvoiceDetailDialog] Posting invoice to organization: ${invoiceId}, isPostingToOrg: ${isPostingRef.current}`
    );
    try {
      const response = await postInvoiceToOrganization(invoiceId);
      if (response && response.success) {
        const message = response.message || 'Invoice posted to organization and complete invoice PDF with attendance sent via email.';
        if (onActionSuccess) onActionSuccess(message);
        // Refresh invoice data to show updated status
        const updatedInvoice = await getInvoiceDetails(invoiceId) as InvoiceData;
        setInvoice(updatedInvoice);
      } else {
        const errorMsg = response?.message || 'Failed to post invoice to organization.';
        throw new Error(errorMsg);
      }
    } catch (err: unknown) {
      logger.error(`Error posting invoice to organization ${invoiceId}:`, err);
      const errObj = err as { message?: string };
      if (onActionError) onActionError(errObj?.message || 'Failed to post invoice to organization.');
    } finally {
      isPostingRef.current = false;
    }
  };

  const handleSendEmail = async () => {
    if (!invoiceId) return;
    setIsSendingEmail(true);
    logger.debug(
      `[InvoiceDetailDialog] Attempting to send email for Invoice ID: ${invoiceId}`
    );
    try {
      const response = await emailInvoice(invoiceId);
      if (response && response.success) {
        const message = response.message || 'Email queued successfully.';
        setPreviewUrl(response.previewUrl || null);
        if (onActionSuccess) onActionSuccess(message);
      } else {
        const errorMsg = response?.message || 'Failed to send email via API.';
        throw new Error(errorMsg);
      }
    } catch (err: unknown) {
      logger.error(`Error sending email for invoice ${invoiceId}:`, err);
      const errObj = err as { message?: string };
      if (onActionError) onActionError(errObj?.message || 'Failed to send email.');
    } finally {
      setIsSendingEmail(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      logger.info('Saving invoice details:', formData);
      const savedInvoice = await updateInvoice(invoiceId!, formData);
      logger.info('Invoice saved successfully:', savedInvoice);
      onClose();
    } catch (err: unknown) {
      logger.error('Failed to save invoice:', err);
      const errObj = err as { message?: string };
      setError(errObj.message || 'Failed to save invoice');
    } finally {
      setIsLoading(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value,
    }));
  };

  const handlePreview = () => {
    logger.info('Generating invoice preview for:', invoice?.id);
    // Add preview logic here
  };

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
      link.download = `Invoice-${invoice.invoicenumber}.pdf`;
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
      const errObj = error as { message?: string };
      if (onActionError) onActionError(`Failed to download PDF: ${errObj.message || 'Unknown error'}`);
    }
  };

  // Keyboard shortcuts handler
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!open) return;
      
      // Ctrl+Enter = Approve invoice
      if (event.ctrlKey && event.key === 'Enter') {
        event.preventDefault();
        const status = String(invoice?.approvalStatus || invoice?.approval_status || '').toLowerCase();
        if (['pending approval', 'pending_approval', 'pending', 'draft', 'new'].includes(status)) {
          handleProcessPayment();
        }
      }
      
      // Ctrl+D = Download PDF
      if (event.ctrlKey && event.key === 'd') {
        event.preventDefault();
        handleDownload();
      }
      
      // Escape = Close dialog
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, invoice?.approvalStatus]);

  const handleProcessPayment = async () => {
    if (!invoice?.id) return;
    
    setProcessingPayment(true);
    try {
      logger.info(`Processing invoice approval, posting, and email for invoice ${invoice.id}`);
      
      // Step 1: Approve the invoice
      const approveResponse = await api.put(`/accounting/invoices/${invoice.id}`, {
        approval_status: 'approved',
        notes: paymentNotes || `Invoice approved by accounting`
      });
      
      if (!approveResponse.data.success) {
        throw new Error(approveResponse.data.message || `Failed to approve invoice`);
      }
      
      // Step 2: Post to organization and send email
      logger.info(`Posting invoice ${invoice.id} to organization and sending email`);
      const postResponse = await postInvoiceToOrganization(invoice.id);
      
      if (!postResponse.success) {
        throw new Error(postResponse.message || `Failed to post invoice to organization`);
      }
      
      const message = `Invoice approved, posted to organization, and email sent successfully`;
      
      // Refresh the invoice data to show updated status
      const updatedInvoice = await getInvoiceDetails(invoice.id) as InvoiceData;
      setInvoice(updatedInvoice);

      if (onActionSuccess) onActionSuccess(message);
      onClose();
    } catch (err: unknown) {
      logger.error(`Error processing invoice approval, posting, and email:`, err);
      const errObj = err as { message?: string };
      if (onActionError) onActionError(errObj?.message || `Failed to approve, post, and email invoice`);
    } finally {
      setProcessingPayment(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth='md' fullWidth>
      <DialogTitle>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="h6">
            Invoice Details {invoice ? `(#${invoice.invoicenumber})` : ''}
          </Typography>
          <Tooltip title="Keyboard shortcuts: Ctrl+Enter (Approve), Ctrl+D (Download), Esc (Close)">
            <Typography variant="caption" color="text.secondary" sx={{ cursor: 'help' }}>
              ⌨️ Shortcuts
            </Typography>
          </Tooltip>
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
                  <strong>Invoice #:</strong> {invoice.invoicenumber}
                </Typography>
              </Grid>
              <Grid xs={6} md={3}>
                <Typography variant='body2'>
                  <strong>Invoice Date:</strong>{' '}
                  {invoice.invoicedate ? formatDisplayDate(invoice.invoicedate) : ''}
                </Typography>
              </Grid>
              <Grid xs={6} md={3}>
                <Typography variant='body2'>
                  <strong>Due Date:</strong> {invoice.duedate ? formatDisplayDate(invoice.duedate) : ''}
                </Typography>
              </Grid>
              <Grid xs={6} md={3}>
                <Typography variant='body2'>
                  <strong>Status:</strong> {invoice.paymentstatus}
                </Typography>
              </Grid>
            </Grid>
            <Divider sx={{ my: 2 }} />
            {/* Organization Info */}
            <Typography variant='subtitle1' gutterBottom>
              Bill To:
            </Typography>
            <Typography variant='body1'>{invoice.organizationname}</Typography>
            {invoice.addressstreet && (
              <Typography variant='body2'>{invoice.addressstreet}</Typography>
            )}
            {invoice.addresscity && (
              <Typography variant='body2'>{`${invoice.addresscity}, ${invoice.addressprovince || ''} ${invoice.addresspostalcode || ''}`}</Typography>
            )}
            {invoice.contactname && (
              <Typography variant='body2'>
                Attn: {invoice.contactname}
              </Typography>
            )}
            {invoice.contactemail && (
              <Typography variant='body2'>
                Email: {invoice.contactemail}
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
                    Absent: {students.filter(s => s.attended === false).length} | 
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
                    <strong>Approved by:</strong> {invoice.approved_by_username || 'Unknown'} 
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
                  (Approval will post the invoice to the organization portal and send notification email)
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
              : 'Approve Invoice & Send Email'}
          </Button>
        )}



        {/* Email Button - Only show if already posted */}
        {invoice?.contactemail && Boolean(invoice?.posted_to_org) && (
          <Button
            onClick={handleSendEmail}
            color='primary'
            variant='outlined'
            disabled={isLoading || isSendingEmail || !invoice || !invoice.contactemail}
            startIcon={
              isSendingEmail ? (
                <CircularProgress size={20} color='inherit' />
              ) : (
                <EmailIcon />
              )
            }
          >
            {isSendingEmail
              ? 'Sending...'
              : invoice?.emailsentat
                ? 'Resend Email'
                : 'Send Email'}
          </Button>
        )}

        {previewUrl && (
          <Button
            color='info'
            variant='outlined'
            href={previewUrl}
            target='_blank'
            rel='noopener noreferrer'
            sx={{ ml: 1 }}
          >
            View Email Preview
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
    </Dialog>
  );
};

export default InvoiceDetailDialog;
