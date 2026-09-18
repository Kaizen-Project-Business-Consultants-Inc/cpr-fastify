import React, { useState, useEffect } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Box,
  Typography,
  Tooltip,
  Chip,
  IconButton,
  Collapse,
  CircularProgress,
} from '@mui/material';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import PreviewIcon from '@mui/icons-material/Preview';
import { formatCurrency, formatDisplayDate, applyTax } from '../../utils/formatters';
import { useSnackbar } from '../../contexts/SnackbarContext';
import PaymentHistoryTable from '../common/PaymentHistoryTable';
import { getInvoicePayments } from '../../services/api';
import { API_URL } from '../../config';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import PendingIcon from '@mui/icons-material/Pending';
import WarningIcon from '@mui/icons-material/Warning';
import ErrorIcon from '@mui/icons-material/Error';
import InfoIcon from '@mui/icons-material/Info';
import { getErrorMessage } from '../../utils/errorMessage';

interface HistoryInvoice {
  invoiceId: number | string;
  invoiceNumber?: string;
  invoiceDate?: string;
  dueDate?: string;
  organizationName?: string;
  courseTypeName?: string;
  location?: string;
  dateCompleted?: string;
  courseDate?: string;
  studentsBilled?: number;
  ratePerStudent?: number | string;
  paidToDate?: number | string;
  balanceDue?: number | string;
  paymentStatus?: string;
  status?: string;
  approvalStatus?: string;
  agingBucket?: string;
  postedToOrg?: boolean;
}

// Mirrors the (unexported) Payment shape expected by PaymentHistoryTable
interface HistoryPayment {
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

// Helper functions (copied from AccountsReceivableTable - consider moving to utils)
const getStatusChipColor = (status: string | undefined) => {
  switch (status?.toLowerCase()) {
    case 'paid':
      return 'success';
    case 'pending':
      return 'warning';
    case 'overdue':
      return 'error';
    default:
      return 'default';
  }
};

const getStatusIcon = (status: string | undefined) => {
  switch (status?.toLowerCase()) {
    case 'paid':
      return <CheckCircleIcon fontSize="small" />;
    case 'pending':
      return <PendingIcon fontSize="small" />;
    case 'overdue':
      return <WarningIcon fontSize="small" />;
    default:
      return <InfoIcon fontSize="small" />;
  }
};

const getApprovalStatusChipColor = (status: string | undefined) => {
  switch (status?.toLowerCase()) {
    case 'approved':
      return 'success';
    case 'pending':
    case 'pending approval':
    case 'pending_approval':
      return 'warning';
    case 'rejected':
      return 'error';
    case 'draft':
    case 'new':
      return 'info';
    default:
      return 'default';
  }
};

const getApprovalStatusIcon = (status: string | undefined) => {
  switch (status?.toLowerCase()) {
    case 'approved':
      return <CheckCircleIcon fontSize="small" />;
    case 'pending':
    case 'pending approval':
    case 'pending_approval':
      return <PendingIcon fontSize="small" />;
    case 'rejected':
      return <ErrorIcon fontSize="small" />;
    case 'draft':
    case 'new':
      return <InfoIcon fontSize="small" />;
    default:
      return <InfoIcon fontSize="small" />;
  }
};

// Component to display within the expanded row
const PaymentDetails = ({
  invoiceId,
  onViewInvoice,
}: {
  invoiceId: number | string;
  onViewInvoice: (invoiceId: number | string) => void;
}) => {
  const [payments, setPayments] = useState<HistoryPayment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  React.useEffect(() => {
    const loadPayments = async () => {
      setIsLoading(true);
      setError('');
      try {
        const response = await getInvoicePayments(Number(invoiceId));

        // Ensure we have an array of payments
        let paymentsData: HistoryPayment[] = [];
        if (response && (response as { data?: HistoryPayment[] }).data) {
          // If response has data property, use that
          const data = (response as { data?: HistoryPayment[] }).data;
          paymentsData = Array.isArray(data) ? data : [];
        } else if (Array.isArray(response)) {
          // If response is directly an array
          paymentsData = response;
        } else {
          // If response is not an array, log and use empty array
          console.warn('Unexpected payments response format:', response);
          paymentsData = [];
        }

        setPayments(paymentsData);
      } catch (err) {
        console.error('Error loading payments:', err);
        setError(getErrorMessage(err, 'Could not load payment details.'));
        setPayments([]);
      } finally {
        setIsLoading(false);
      }
    };
    loadPayments();
  }, [invoiceId]);

  if (isLoading) return <CircularProgress size={20} sx={{ m: 1 }} />;
  if (error)
    return (
      <Typography color='error' sx={{ m: 1 }}>
        {error}
      </Typography>
    );
  if (!payments || payments.length === 0)
    return (
      <Typography sx={{ m: 1, fontStyle: 'italic' }}>
        No payments recorded for this invoice.
      </Typography>
    );

  // Use the reusable PaymentHistoryTable component
  return (
    <Box sx={{ margin: 1 }}>
      <Typography variant='subtitle2' gutterBottom component='div'>
        Payment History
      </Typography>
      <PaymentHistoryTable 
        payments={payments}
        isLoading={isLoading}
        showVerificationDetails={false}
        onViewInvoice={onViewInvoice}
      />
    </Box>
  );
};

const InvoiceHistoryTable = ({
  invoices = [],
  onRefresh,
}: {
  invoices?: HistoryInvoice[];
  onRefresh?: () => void;
}) => {
  const [expandedRowId, setExpandedRowId] = useState<number | string | null>(null); // State to track expanded row
  const { showError } = useSnackbar();

  // Auto-refresh every 30 seconds
  useEffect(() => {
    if (!onRefresh) return () => {};
    
    const interval = setInterval(() => {
      onRefresh();
    }, 30000); // 30 seconds
    
    return () => clearInterval(interval);
  }, [onRefresh]);

  const handleExpandClick = (invoiceId: number | string) => {
    setExpandedRowId(expandedRowId === invoiceId ? null : invoiceId); // Toggle expansion
  };

  const handlePreview = (invoiceId: number | string) => {
    const previewUrl = `${API_URL}/accounting/invoices/${invoiceId}/preview`;
    window.open(previewUrl, '_blank', 'width=800,height=1000,scrollbars=yes');
  };

  const handleDownloadPDF = async (invoiceId: number | string, invoiceNumber: string | undefined) => {
    try {


      const response = await fetch(
        `${API_URL}/accounting/invoices/${invoiceId}/pdf`,
        {
          method: 'GET',
          credentials: 'include',
        }
      );


      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[PDF Download] Error response:`, errorText);
        throw new Error(
          `HTTP error! status: ${response.status} - ${errorText}`
        );
      }

      // Check if the response is actually a PDF
      const contentType = response.headers.get('content-type');

      if (!contentType || !contentType.includes('application/pdf')) {
        console.error('Response is not a PDF:', contentType);
        const text = await response.text();
        console.error('Response body:', text);
        throw new Error('Server did not return a PDF file');
      }

      // Get the PDF blob
      const blob = await response.blob();

      // Verify the blob size
      if (blob.size === 0) {
        throw new Error('PDF file is empty');
      }

      // Try different download approaches
      // IE/Edge legacy support - msSaveOrOpenBlob doesn't exist on modern browsers
      const nav = window.navigator as Navigator & { msSaveOrOpenBlob?: (blob: Blob, filename: string) => boolean };
      if (nav.msSaveOrOpenBlob) {
        // For IE/Edge
        nav.msSaveOrOpenBlob(blob, `Invoice-${invoiceNumber}.pdf`);
      } else {
        // For modern browsers - try multiple methods
        const url = window.URL.createObjectURL(blob);

        // Method 1: Try programmatic download
        try {
          const link = document.createElement('a');
          link.href = url;
          link.download = `Invoice-${invoiceNumber}.pdf`;
          link.style.display = 'none';

          // Add to DOM, click, and remove
          document.body.appendChild(link);

          // Try to trigger download
          link.click();

          // Also try dispatching a click event as fallback
          const clickEvent = new MouseEvent('click', {
            view: window,
            bubbles: true,
            cancelable: true,
          });
          link.dispatchEvent(clickEvent);


          // Clean up after a short delay
          setTimeout(() => {
            if (document.body.contains(link)) {
              document.body.removeChild(link);
            }
            window.URL.revokeObjectURL(url);
          }, 1000);
        } catch (downloadError) {
          console.error(
            '[PDF Download] Programmatic download failed:',
            downloadError
          );

          // Method 2: Fallback - open in new tab
          const newWindow = window.open(url, '_blank');
          if (newWindow) {
            // Clean up after user has time to save
            setTimeout(() => {
              window.URL.revokeObjectURL(url);
            }, 10000);
          } else {
            console.error(
              '[PDF Download] Failed to open new tab - popup blocked?'
            );
            showError(
              'Download blocked by browser. Please check your popup blocker settings or try right-clicking the download button and selecting "Save link as..."'
            );
          }
        }
      }

    } catch (error) {
      console.error('[PDF Download] Error:', error);
      showError(`Failed to download PDF: ${getErrorMessage(error)}`);
    }
  };

  if (!invoices || invoices.length === 0) {
    return (
      <Typography sx={{ mt: 2, fontStyle: 'italic' }}>
        No matching invoices found.
      </Typography>
    );
  }

  // Optional: Add Sorting if needed

  return (
    <TableContainer component={Paper} sx={{ mt: 2 }}>
      <Table stickyHeader size='small' aria-label='invoice history table'>
        <TableHead>
          <TableRow>
            <TableCell sx={{ width: '10px', fontWeight: 'bold' }} />
            {/* Empty cell for expand button */}
            <TableCell sx={{ fontWeight: 'bold' }}>Invoice #</TableCell>
            <TableCell sx={{ fontWeight: 'bold' }}>Invoice Date</TableCell>
            <TableCell sx={{ fontWeight: 'bold' }}>Due Date</TableCell>
            <TableCell sx={{ fontWeight: 'bold' }}>Organization</TableCell>
            <TableCell sx={{ fontWeight: 'bold' }}>Course Name</TableCell>
            <TableCell sx={{ fontWeight: 'bold' }}>Location</TableCell>
            <TableCell sx={{ fontWeight: 'bold' }}>Course Date</TableCell>
            <TableCell align='center' sx={{ fontWeight: 'bold' }}>
              Students
            </TableCell>
            <TableCell align='right' sx={{ fontWeight: 'bold' }}>
              Rate/Student
            </TableCell>
            <TableCell align='right' sx={{ fontWeight: 'bold' }}>
              Base Price
            </TableCell>
            <TableCell align='right' sx={{ fontWeight: 'bold' }}>
              HST
            </TableCell>
            <TableCell align='right' sx={{ fontWeight: 'bold' }}>
              Total
            </TableCell>
            <TableCell align='right' sx={{ fontWeight: 'bold' }}>
              Paid
            </TableCell>
            <TableCell align='right' sx={{ fontWeight: 'bold' }}>
              Balance
            </TableCell>
            <TableCell align='center' sx={{ fontWeight: 'bold' }}>
              Status
            </TableCell>
            <TableCell align='center' sx={{ fontWeight: 'bold' }}>
              Approval Status
            </TableCell>
            <TableCell sx={{ fontWeight: 'bold' }}>Aging</TableCell>
            <TableCell align='center' sx={{ fontWeight: 'bold' }}>
              Posted
            </TableCell>
            <TableCell align='center' sx={{ fontWeight: 'bold' }}>
              Actions
            </TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {invoices.map((invoice, index) => (
            <React.Fragment key={invoice.invoiceId || index}>
              <TableRow
                hover
                sx={{
                  '& > *': { borderBottom: 'unset' },
                  backgroundColor: (theme) => (index % 2 !== 0 ? theme.palette.action.hover : 'inherit'),
                }}
              >
                <TableCell>
                  {/* Expand/Collapse Button */}
                  <IconButton
                    aria-label='expand row'
                    size='small'
                    onClick={() => handleExpandClick(invoice.invoiceId)}
                  >
                    {expandedRowId === invoice.invoiceId ? (
                      <KeyboardArrowUpIcon />
                    ) : (
                      <KeyboardArrowDownIcon />
                    )}
                  </IconButton>
                </TableCell>
                <TableCell>
                  <strong>
                    {invoice.invoiceNumber}
                  </strong>
                </TableCell>
              <TableCell>
                {formatDisplayDate(invoice.invoiceDate)}
              </TableCell>
              <TableCell>
                {formatDisplayDate(invoice.dueDate)}
              </TableCell>
              <TableCell>
                {invoice.organizationName || '-'}
              </TableCell>
              <TableCell>
                {invoice.courseTypeName || '-'}
              </TableCell>
              <TableCell>{invoice.location || '-'}</TableCell>
              <TableCell>
                {formatDisplayDate(invoice.dateCompleted || invoice.courseDate)}
              </TableCell>
              <TableCell align='center'>
                {invoice.studentsBilled || '-'}
              </TableCell>
              <TableCell align='right'>
                {invoice.ratePerStudent ?
                  <strong>{formatCurrency(invoice.ratePerStudent)}</strong> :
                  <Typography variant="body2" color="error.main" fontSize="small">
                    Pricing not configured
                  </Typography>
                }
              </TableCell>
              <TableCell align='right'>
                {invoice.ratePerStudent && invoice.studentsBilled ?
                  <strong>{formatCurrency(applyTax(Number(invoice.ratePerStudent) * Number(invoice.studentsBilled)).subtotal)}</strong> :
                  <Typography variant="body2" color="error.main" fontSize="small">
                    N/A
                  </Typography>
                }
              </TableCell>
              <TableCell align='right'>
                {invoice.ratePerStudent && invoice.studentsBilled ?
                  <strong>{formatCurrency(applyTax(Number(invoice.ratePerStudent) * Number(invoice.studentsBilled)).tax)}</strong> :
                  <Typography variant="body2" color="error.main" fontSize="small">
                    N/A
                  </Typography>
                }
              </TableCell>
              <TableCell align='right'>
                {invoice.ratePerStudent && invoice.studentsBilled ?
                  <strong>{formatCurrency(applyTax(Number(invoice.ratePerStudent) * Number(invoice.studentsBilled)).total)}</strong> :
                  <Typography variant="body2" color="error.main" fontSize="small">
                    N/A
                  </Typography>
                }
              </TableCell>
              <TableCell align='right'>
                {formatCurrency(invoice.paidToDate || 0)}
              </TableCell>
              <TableCell align='right'>
                <strong>
                  {formatCurrency(invoice.balanceDue || 0)}
                </strong>
              </TableCell>
              <TableCell align='center'>
                <Chip
                  icon={getStatusIcon(invoice.paymentStatus || invoice.status)}
                  label={invoice.paymentStatus || invoice.status || 'Unknown'}
                  color={getStatusChipColor(invoice.paymentStatus || invoice.status)}
                  size='small'
                />
              </TableCell>
              <TableCell align='center'>
                <Chip
                  icon={getApprovalStatusIcon(invoice.approvalStatus)}
                  label={invoice.approvalStatus || 'Unknown'}
                  color={getApprovalStatusChipColor(invoice.approvalStatus)}
                  size='small'
                />
              </TableCell>
              <TableCell>
                {invoice.agingBucket || '-'}
              </TableCell>
              <TableCell align='center'>
                <Chip
                  label={invoice.postedToOrg ? 'Yes' : 'No'}
                  color={invoice.postedToOrg ? 'success' : 'default'}
                  size='small'
                  variant='outlined'
                />
              </TableCell>
              <TableCell align='center'>
                <Box
                  sx={{
                    display: 'flex',
                    gap: 0.5,
                    flexWrap: 'wrap',
                    justifyContent: 'center',
                  }}
                >
                  <Tooltip title='Preview Invoice'>
                    <IconButton
                      aria-label={`Preview invoice ${invoice.invoiceNumber}`}
                      size='small'
                      onClick={() => handlePreview(invoice.invoiceId)}
                      color='primary'
                    >
                      <PreviewIcon fontSize='small' />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title='Download PDF'>
                    <IconButton
                      aria-label={`Download PDF for invoice ${invoice.invoiceNumber}`}
                      size='small'
                      onClick={() =>
                        handleDownloadPDF(invoice.invoiceId, invoice.invoiceNumber)
                      }
                      color='secondary'
                    >
                      <PictureAsPdfIcon fontSize='small' />
                    </IconButton>
                  </Tooltip>
                </Box>
              </TableCell>
            </TableRow>
            {/* Expanded Row for Payment Details */}
            <TableRow>
              <TableCell
                style={{ paddingBottom: 0, paddingTop: 0 }}
                colSpan={20}
              >
                {/* Adjust colSpan based on total columns */}
                <Collapse
                  in={expandedRowId === invoice.invoiceId}
                  timeout='auto'
                  unmountOnExit
                >
                                  {/* Render PaymentDetails component only when expanded */}
                {expandedRowId === invoice.invoiceId && (
                  <PaymentDetails
                    invoiceId={invoice.invoiceId}
                    onViewInvoice={handlePreview}
                  />
                )}
                </Collapse>
              </TableCell>
            </TableRow>
            </React.Fragment>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
};

export default InvoiceHistoryTable;
