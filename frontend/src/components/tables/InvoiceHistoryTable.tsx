import React, { useState } from 'react';
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
import { formatCurrency, formatDisplayDate } from '../../utils/formatters';
import { useSnackbar } from '../../contexts/SnackbarContext';
import PaymentHistoryTable from '../common/PaymentHistoryTable';
import api, { getInvoicePayments } from '../../services/api';
import { downloadBlob } from '../../utils/download';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import PendingIcon from '@mui/icons-material/Pending';
import WarningIcon from '@mui/icons-material/Warning';
import ErrorIcon from '@mui/icons-material/Error';
import InfoIcon from '@mui/icons-material/Info';
import { getErrorMessage } from '../../utils/errorMessage';

/**
 * A row as GET /accounting/invoices sends it (InvoiceRepository.findAllWithDetails).
 * There is no case conversion: these are the SQL names. DECIMALs arrive as
 * strings and posted_to_org as 0/1.
 */
export interface HistoryInvoice {
  id: number;
  invoice_number?: string;
  invoice_date?: string;
  due_date?: string;
  organization_id?: number;
  organization_name?: string;
  course_type_name?: string | null;
  location?: string | null;
  date_completed?: string | null;
  students_billed?: number;
  rate_per_student?: number | string;
  base_cost?: number | string;
  tax_amount?: number | string;
  amount?: number | string;
  amount_paid?: number | string;
  balance_due?: number | string;
  payment_status?: string;
  status?: string;
  approval_status?: string;
  approved_at?: string | null;
  aging_bucket?: string;
  posted_to_org?: boolean | number;
  posted_to_org_at?: string | null;
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
}: {
  invoices?: HistoryInvoice[];
}) => {
  const [expandedRowId, setExpandedRowId] = useState<number | string | null>(null); // State to track expanded row
  const { showError } = useSnackbar();

  const handleExpandClick = (invoiceId: number | string) => {
    setExpandedRowId(expandedRowId === invoiceId ? null : invoiceId); // Toggle expansion
  };

  // Both endpoints need the Bearer token, which only the shared api client
  // adds; a plain window.open or fetch got 401. So fetch the file as a blob
  // and open or save a local copy of it.
  const handlePreview = async (invoiceId: number | string) => {
    // Open the window first (inside the click) so popup blockers allow it.
    const win = window.open('', '_blank', 'width=800,height=1000,scrollbars=yes');
    try {
      const response = await api.get(`/accounting/invoices/${invoiceId}/preview`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([response.data], { type: 'text/html' }));
      if (win) win.location.href = url;
      else window.open(url, '_blank');
      setTimeout(() => window.URL.revokeObjectURL(url), 60000);
    } catch (error) {
      win?.close();
      showError(`Failed to preview invoice: ${getErrorMessage(error)}`);
    }
  };

  const handleDownloadPDF = async (invoiceId: number | string, invoiceNumber: string | undefined) => {
    try {
      const response = await api.get(`/accounting/invoices/${invoiceId}/pdf`, { responseType: 'blob' });
      downloadBlob(response.data, `Invoice-${invoiceNumber ?? invoiceId}.pdf`);
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
            <React.Fragment key={invoice.id}>
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
                    onClick={() => handleExpandClick(invoice.id)}
                  >
                    {expandedRowId === invoice.id ? (
                      <KeyboardArrowUpIcon />
                    ) : (
                      <KeyboardArrowDownIcon />
                    )}
                  </IconButton>
                </TableCell>
                <TableCell>
                  <strong>
                    {invoice.invoice_number}
                  </strong>
                </TableCell>
              <TableCell>
                {formatDisplayDate(invoice.invoice_date)}
              </TableCell>
              <TableCell>
                {formatDisplayDate(invoice.due_date)}
              </TableCell>
              <TableCell>
                {invoice.organization_name || '-'}
              </TableCell>
              <TableCell>
                {invoice.course_type_name || '-'}
              </TableCell>
              <TableCell>{invoice.location || '-'}</TableCell>
              <TableCell>
                {formatDisplayDate(invoice.date_completed)}
              </TableCell>
              <TableCell align='center'>
                {invoice.students_billed || '-'}
              </TableCell>
              <TableCell align='right'>
                {invoice.rate_per_student ?
                  <strong>{formatCurrency(invoice.rate_per_student)}</strong> :
                  <Typography variant="body2" color="error.main" fontSize="small">
                    Pricing not configured
                  </Typography>
                }
              </TableCell>
              {/* The invoice's own stored figures, not a recalculation. */}
              <TableCell align='right'>
                <strong>{formatCurrency(invoice.base_cost || 0)}</strong>
              </TableCell>
              <TableCell align='right'>
                <strong>{formatCurrency(invoice.tax_amount || 0)}</strong>
              </TableCell>
              <TableCell align='right'>
                <strong>{formatCurrency(invoice.amount || 0)}</strong>
              </TableCell>
              <TableCell align='right'>
                {formatCurrency(invoice.amount_paid || 0)}
              </TableCell>
              <TableCell align='right'>
                <strong>
                  {formatCurrency(invoice.balance_due || 0)}
                </strong>
              </TableCell>
              <TableCell align='center'>
                <Chip
                  icon={getStatusIcon(invoice.payment_status || invoice.status)}
                  label={invoice.payment_status || invoice.status || 'Unknown'}
                  color={getStatusChipColor(invoice.payment_status || invoice.status)}
                  size='small'
                />
              </TableCell>
              <TableCell align='center'>
                <Chip
                  icon={getApprovalStatusIcon(invoice.approval_status)}
                  label={invoice.approval_status || 'Unknown'}
                  color={getApprovalStatusChipColor(invoice.approval_status)}
                  size='small'
                />
              </TableCell>
              <TableCell>
                {invoice.aging_bucket || '-'}
              </TableCell>
              <TableCell align='center'>
                <Chip
                  label={invoice.posted_to_org ? 'Yes' : 'No'}
                  color={invoice.posted_to_org ? 'success' : 'default'}
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
                      aria-label={`Preview invoice ${invoice.invoice_number}`}
                      size='small'
                      onClick={() => handlePreview(invoice.id)}
                      color='primary'
                    >
                      <PreviewIcon fontSize='small' />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title='Download PDF'>
                    <IconButton
                      aria-label={`Download PDF for invoice ${invoice.invoice_number}`}
                      size='small'
                      onClick={() =>
                        handleDownloadPDF(invoice.id, invoice.invoice_number)
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
                  in={expandedRowId === invoice.id}
                  timeout='auto'
                  unmountOnExit
                >
                                  {/* Render PaymentDetails component only when expanded */}
                {expandedRowId === invoice.id && (
                  <PaymentDetails
                    invoiceId={invoice.id}
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
