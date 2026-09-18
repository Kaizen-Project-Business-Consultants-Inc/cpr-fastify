import React, { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Typography,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Grid,
  Alert,
  CircularProgress,
  Tooltip
} from '@mui/material';
import DataTable, { DataTableRow } from '../../gtacpr/DataTable';
import StatusChip from '../../gtacpr/StatusChip';
import StatCard from '../../gtacpr/StatCard';
import SearchBar from '../../gtacpr/SearchBar';
import { PrimaryButton, GhostButton } from '../../gtacpr/Buttons';
import { LinkButton, useConfirm } from '../../gtacpr';
import { formatCurrency, formatDisplayDate, getTodayDate } from '../../../utils/formatters';
import { api, adminApi } from '../../../services/api';
import { useSnackbar } from '../../../contexts/SnackbarContext';
import { useVendorInvoiceUpdates } from '../../../hooks/useVendorInvoiceUpdates';
import useServerPagination from '../../../hooks/useServerPagination';
import useDebounce from '../../../hooks/useDebounce';

interface VendorInvoice {
  id: number;
  invoiceNumber: string;
  item?: string;
  company?: string;
  billingCompany?: string;
  quantity?: number | null;
  description: string;
  rate: number;
  amount: number | string;
  subtotal: number | string;
  hst: number | string;
  total: number | string;
  status: string;
  createdAt: string;
  invoiceDate: string;
  dueDate: string;
  vendorName: string;
  vendorEmail: string;
  vendorContact: string;
  vendorPaymentMethod: string;
  bankName: string;
  accountNumber: string;
  routingNumber: string;
  approvedByName: string;
  approvedByEmail: string;
  sentToAccountingAt: string;
  totalPaid?: number | string;
  balanceDue?: number | string;
  paymentStatus: string;
  adminNotes: string;
  rejectionReason?: string;
}

interface PaymentData {
  amount: string;
  paymentDate: string;
  paymentMethod: string;
  referenceNumber: string;
  notes: string;
  [key: string]: unknown;
}

interface PaymentHistory {
  id: number;
  amount: number;
  paymentDate: string;
  paymentMethod: string;
  referenceNumber: string;
  notes: string;
  status: string;
  processedAt: string;
  processedByName: string;
}

const TABLE_COLUMNS = [
  { key: 'date', label: 'Date', width: '90px' },
  { key: 'billingCompany', label: 'Billing Company', width: '140px' },
  { key: 'invoiceNumber', label: 'Invoice #', width: '110px' },
  { key: 'quantity', label: 'Qty', width: '50px', align: 'right' as const },
  { key: 'item', label: 'Item', width: '110px' },
  { key: 'description', label: 'Description', width: '200px' },
  { key: 'rate', label: 'Rate', width: '90px', align: 'right' as const },
  { key: 'amount', label: 'Amount', width: '110px', align: 'right' as const },
  { key: 'subtotal', label: 'Subtotal', width: '110px', align: 'right' as const },
  { key: 'hst', label: 'HST', width: '90px', align: 'right' as const },
  { key: 'total', label: 'Total', width: '110px', align: 'right' as const },
  { key: 'status', label: 'Status', width: '130px' },
  { key: 'dueDate', label: 'Due Date', width: '90px' },
  { key: 'actions', label: 'Actions', width: '80px', align: 'center' as const },
];

const PAYMENT_HISTORY_COLUMNS = [
  { key: 'date', label: 'Date', width: '100px' },
  { key: 'amount', label: 'Amount', width: '110px' },
  { key: 'method', label: 'Method', width: '130px' },
  { key: 'reference', label: 'Reference', width: '130px' },
  { key: 'processedBy', label: 'Processed By', width: '140px' },
  { key: 'status', label: 'Status', width: '100px' },
];

const getStatusKind = (status: string): 'success' | 'active' | 'warning' | 'danger' | 'neutral' | 'inactive' | 'brand' | 'pending' => {
  switch (status) {
    case 'pending_submission': return 'neutral';
    case 'submitted_to_admin': return 'warning';
    case 'submitted_to_accounting': return 'active';
    case 'rejected_by_admin': return 'danger';
    case 'rejected_by_accountant': return 'danger';
    case 'paid': return 'success';
    default: return 'neutral';
  }
};

const getStatusLabel = (status: string) => {
  switch (status) {
    case 'pending_submission': return 'Pending Submission';
    case 'submitted_to_admin': return 'Submitted to Admin';
    case 'submitted_to_accounting': return 'Submitted to Accounting';
    case 'rejected_by_admin': return 'Rejected by Admin';
    case 'rejected_by_accountant': return 'Rejected by Accountant';
    case 'paid': return 'Paid';
    default: return status.replace('_', ' ').toUpperCase();
  }
};

const getPaymentStatusKind = (status: string): 'success' | 'active' | 'warning' | 'danger' | 'neutral' | 'inactive' | 'brand' | 'pending' => {
  switch (status) {
    case 'paid': return 'success';
    case 'partially_paid': return 'warning';
    case 'unpaid': return 'danger';
    default: return 'neutral';
  }
};

const formatDate = (date: string) => formatDisplayDate(date);

/** `'pending'` in the picker means "everything not yet paid" — the API's `unpaid`. */
const toStatusParam = (filter: string) =>
  filter === 'pending' ? 'unpaid' : filter === 'all' ? '' : filter;

interface InvoiceSummary {
  nonPaidCount: number;
  totalOutstanding: number;
  totalPaid: number;
  partiallyPaidCount: number;
}

const emptySummary: InvoiceSummary = {
  nonPaidCount: 0,
  totalOutstanding: 0,
  totalPaid: 0,
  partiallyPaidCount: 0,
};

const VendorInvoiceManagement: React.FC = () => {
  const [error, setError] = useState('');
  const [selectedInvoice, setSelectedInvoice] = useState<VendorInvoice | null>(null);
  const [viewDialog, setViewDialog] = useState(false);
  const [processingPayment, setProcessingPayment] = useState(false);
  const [paymentHistory, setPaymentHistory] = useState<PaymentHistory[]>([]);
  const [paymentData, setPaymentData] = useState<PaymentData>({
    amount: '',
    paymentDate: getTodayDate(),
    paymentMethod: '',
    referenceNumber: '',
    notes: ''
  });
  const [statusFilter, setStatusFilter] = useState('pending');
  const [searchTerm, setSearchTerm] = useState('');
  const [summary, setSummary] = useState<InvoiceSummary>(emptySummary);
  const { showSuccess, showError } = useSnackbar();
  const { confirm, dialog: confirmDialog } = useConfirm();

  const debouncedSearch = useDebounce(searchTerm, 300);
  const searchParam = debouncedSearch.trim();
  const statusParam = toStatusParam(statusFilter);

  // Both the status picker and the search box run on the server: the endpoint
  // applies `status` and `search` to the data query AND the COUNT, so a page is
  // page N of the selected status, not "the matching rows of the first 25".
  const grid = useServerPagination<VendorInvoice>({
    pageSize: 25,
    fetchFn: ({ page, limit }) =>
      api
        .get('/accounting/vendor-invoices', {
          params: {
            page,
            limit,
            ...(statusParam ? { status: statusParam } : {}),
            ...(searchParam ? { search: searchParam } : {}),
          },
        })
        .then((r) => {
          setError('');
          return r.data;
        }),
    onError: (err: unknown) => {
      console.error('Error fetching vendor invoices:', err);
      setError('Failed to load vendor invoices. Please try again.');
      showError('Failed to load vendor invoices');
    },
  });

  /**
   * The four summary cards describe EVERY invoice, in every status — they are
   * deliberately independent of the status picker and of the page on screen, so
   * the summary is asked with no `status` and no `search`.
   *
   * All four come from that one aggregate. "Partially Paid" used to count rows
   * whose `paymentStatus` was 'partially_paid', but vendor invoices never carry
   * that field (only ORGANISATION invoices compute one), so the card always read
   * zero. The summary now derives it from the payments themselves: some money
   * received, but less than the invoice total.
   */
  const loadSummary = useCallback(async () => {
    try {
      const summaryResponse = await api.get('/accounting/vendor-invoices/summary');
      const data = summaryResponse.data?.data ?? {};
      const paidCount = Number(data.byStatus?.paid ?? 0);
      setSummary({
        nonPaidCount: Number(data.total ?? 0) - paidCount,
        totalOutstanding: Number(data.outstanding ?? 0),
        totalPaid: Number(data.totalPaid ?? 0),
        partiallyPaidCount: Number(data.partiallyPaid ?? 0),
      });
    } catch (err: unknown) {
      console.error('Error loading vendor invoice totals:', err);
      setSummary(emptySummary);
    }
  }, []);

  /** Re-fetch the page currently on screen plus the whole-set totals. */
  const reloadCurrentPage = useCallback(() => {
    grid.reload();
    loadSummary();
  }, [grid.reload, loadSummary]);

  // Real-time updates
  const { isConnected } = useVendorInvoiceUpdates({
    onStatusUpdate: () => {},
    onNotesUpdate: () => {},
    onRefresh: reloadCurrentPage
  });

  // Changing the status filter or the search restarts at page 1.
  useEffect(() => {
    grid.load(1);
  }, [grid.load, statusParam, searchParam]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  const invoices = grid.items;

  const handleView = async (invoice: VendorInvoice) => {
    setSelectedInvoice(invoice);
    setPaymentData({
      amount: Number(invoice.balanceDue || 0) > 0 ? String(invoice.balanceDue || 0) : '',
      paymentDate: getTodayDate(),
      paymentMethod: invoice.vendorPaymentMethod && ['check', 'direct_deposit', 'wire_transfer'].includes(invoice.vendorPaymentMethod)
        ? invoice.vendorPaymentMethod
        : 'check',
      referenceNumber: '',
      notes: ''
    });

    try {
      const response = await adminApi.getAccountingVendorInvoiceDetails(invoice.id);
      if (response.success && response.data.payments) {
        setPaymentHistory(response.data.payments);
      } else {
        setPaymentHistory([]);
      }
    } catch (error: unknown) {
      console.error('Error fetching payment history:', error);
      setPaymentHistory([]);
    }

    setViewDialog(true);
  };

  const handleProcessPayment = async () => {
    if (!selectedInvoice || !paymentData.amount || processingPayment) return;

    const vendorLabel = selectedInvoice.billingCompany || selectedInvoice.company || selectedInvoice.vendorName || 'this vendor';
    const ok = await confirm({
      title: 'Process this payment?',
      message: `Record a ${formatCurrency(paymentData.amount)} ${paymentData.paymentMethod.replace('_', ' ')} payment to ${vendorLabel} for invoice ${selectedInvoice.invoiceNumber}. This cannot be undone.`,
      confirmLabel: 'Process Payment',
      danger: true,
    });
    if (!ok) return;

    try {
      setProcessingPayment(true);
      const response = await adminApi.processVendorPayment(selectedInvoice.id, paymentData);

      showSuccess(response.message || 'Payment processed successfully');

      try {
        const historyResponse = await adminApi.getAccountingVendorInvoiceDetails(selectedInvoice.id);
        if (historyResponse.success && historyResponse.data.payments) {
          setPaymentHistory(historyResponse.data.payments);
        }
      } catch (error: unknown) {
        console.error('Error refreshing payment history:', error);
      }

      setViewDialog(false);
      setSelectedInvoice(null);
      reloadCurrentPage();
    } catch (error: unknown) {
      console.error('Error processing payment:', error);
      const errObj = error as { response?: { data?: { message?: string } } };
      showError(errObj.response?.data?.message || 'Failed to process payment');
    } finally {
      setProcessingPayment(false);
    }
  };

  if (error) {
    return (
      <Alert severity="error" sx={{ mb: 2 }}>
        {error}
      </Alert>
    );
  }

  return (
    <Box>
      {/* Header */}
      <Box sx={{ mb: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography sx={{ fontSize: 22, fontWeight: 700, color: (theme) => theme.palette.text.primary }}>
          Vendor Invoice Management
        </Typography>
        <StatusChip
          kind={isConnected ? 'success' : 'danger'}
          label={isConnected ? 'Live Updates' : 'Offline'}
        />
      </Box>

      {/* Summary Cards */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} md={3}>
          <StatCard
            label="Pending Invoices"
            value={summary.nonPaidCount}
            sub="Non-Paid"
            dotColor="#ED6C02"
          />
        </Grid>
        <Grid item xs={12} md={3}>
          <StatCard
            label="Total Outstanding"
            value={formatCurrency(summary.totalOutstanding)}
            sub="Balance due across all invoices"
            dotColor="#CC1F1F"
          />
        </Grid>
        <Grid item xs={12} md={3}>
          <StatCard
            label="Total Paid"
            value={formatCurrency(summary.totalPaid)}
            sub="Payments processed"
            dotColor="#16A34A"
          />
        </Grid>
        <Grid item xs={12} md={3}>
          <StatCard
            label="Partially Paid"
            value={summary.partiallyPaidCount}
            sub="Invoices with partial payment"
            dotColor="#2563EB"
          />
        </Grid>
      </Grid>

      {/* Status filter + search — both applied by the server */}
      <Box sx={{ mb: 2, display: 'flex', flexDirection: { xs: 'column', md: 'row' }, gap: 2, alignItems: { md: 'center' } }}>
        <FormControl sx={{ minWidth: 200 }}>
          <InputLabel>Filter by Status</InputLabel>
          <Select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            label="Filter by Status"
          >
            <MenuItem value="pending">Pending Invoices (Non-Paid)</MenuItem>
            <MenuItem value="all">All Invoices</MenuItem>
            <MenuItem value="pending_submission">Pending Submission</MenuItem>
            <MenuItem value="submitted_to_admin">Submitted to Admin</MenuItem>
            <MenuItem value="submitted_to_accounting">Submitted to Accounting</MenuItem>
            <MenuItem value="rejected_by_admin">Rejected by Admin</MenuItem>
            <MenuItem value="rejected_by_accountant">Rejected by Accountant</MenuItem>
            <MenuItem value="paid">Invoices Paid</MenuItem>
          </Select>
        </FormControl>
        <Box sx={{ flex: 1 }}>
          <SearchBar
            placeholder="Search vendor invoices by invoice # or vendor"
            value={searchTerm}
            onChange={setSearchTerm}
          />
        </Box>
      </Box>
      <Typography sx={{ mb: 2, fontSize: 12, color: (theme) => theme.palette.text.secondary }}>
        The status filter and search run across every vendor invoice, not just this page. The summary cards above
        always cover all invoices in every status.
      </Typography>

      {/* Invoices Table */}
      <DataTable
        columns={TABLE_COLUMNS}
        shownCount={grid.shownCount}
        totalCount={grid.totalCount}
        page={grid.page}
        hasNextPage={grid.hasNextPage}
        onPrevPage={grid.onPrevPage}
        onNextPage={grid.onNextPage}
        loading={grid.loading}
        emptyMessage="No invoices found matching the current filter."
      >
        {invoices.map((invoice) => (
          <DataTableRow key={invoice.id} columns={TABLE_COLUMNS}>
            <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
              {formatDisplayDate(invoice.createdAt || invoice.invoiceDate)}
            </Typography>
            <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: (theme) => theme.palette.text.primary }}>
              {invoice.billingCompany || invoice.company || invoice.vendorName || '-'}
            </Typography>
            <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
              {invoice.invoiceNumber}
            </Typography>
            <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary, textAlign: 'right' }}>
              {invoice.quantity || '-'}
            </Typography>
            <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
              {invoice.item || '-'}
            </Typography>
            <Tooltip title={invoice.description}>
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {invoice.description}
              </Typography>
            </Tooltip>
            <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary, fontFamily: 'monospace', textAlign: 'right' }}>
              {invoice.rate && !isNaN(invoice.rate) && invoice.rate > 0
                ? formatCurrency(invoice.rate)
                : '-'}
            </Typography>
            <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary, fontFamily: 'monospace', textAlign: 'right' }}>
              {invoice.amount && !isNaN(Number(invoice.amount))
                ? formatCurrency(invoice.amount)
                : invoice.total && !isNaN(Number(invoice.total))
                  ? formatCurrency(invoice.total)
                  : '-'}
            </Typography>
            <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary, fontFamily: 'monospace', textAlign: 'right' }}>
              {invoice.subtotal && !isNaN(Number(invoice.subtotal)) && Number(invoice.subtotal) > 0
                ? formatCurrency(invoice.subtotal)
                : '-'}
            </Typography>
            <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary, fontFamily: 'monospace', textAlign: 'right' }}>
              {invoice.hst && !isNaN(Number(invoice.hst)) && Number(invoice.hst) > 0
                ? formatCurrency(invoice.hst)
                : '-'}
            </Typography>
            <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: (theme) => theme.palette.text.primary, fontFamily: 'monospace', textAlign: 'right' }}>
              {invoice.total && !isNaN(Number(invoice.total)) && Number(invoice.total) > 0
                ? formatCurrency(invoice.total)
                : '-'}
            </Typography>
            <StatusChip kind={getStatusKind(invoice.status)} label={getStatusLabel(invoice.status)} />
            <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
              {formatDisplayDate(invoice.dueDate)}
            </Typography>
            <Box sx={{ textAlign: 'center' }}>
              <LinkButton
                onClick={() => handleView(invoice)}
                aria-label={`View invoice ${invoice.invoiceNumber}`}
              >
                View
              </LinkButton>
            </Box>
          </DataTableRow>
        ))}
      </DataTable>

      {/* View Invoice Dialog */}
      <Dialog open={viewDialog} onClose={() => setViewDialog(false)} maxWidth="md" fullWidth sx={{ '& .MuiDialog-paper': { maxHeight: '90vh' } }}>
        <DialogTitle>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography sx={{ fontSize: 18, fontWeight: 700, color: (theme) => theme.palette.text.primary }}>
              Invoice Details - #{selectedInvoice?.invoiceNumber}
            </Typography>
            {selectedInvoice && (
              <StatusChip
                kind={getPaymentStatusKind(selectedInvoice.paymentStatus || 'unknown')}
                label={(selectedInvoice.paymentStatus || 'unknown').replace('_', ' ').toUpperCase()}
              />
            )}
          </Box>
        </DialogTitle>
        <DialogContent>
          {selectedInvoice && (
            <Box>
              {/* Vendor + Payment Summary */}
              <Box sx={{ border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', bgcolor: (theme) => theme.palette.background.default, p: 3, mb: 3 }}>
                <Grid container spacing={3}>
                  <Grid item xs={12} md={6}>
                    <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.07em', mb: 1 }}>
                      Vendor Information
                    </Typography>
                    <Box sx={{ pl: 0 }}>
                      <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: (theme) => theme.palette.text.primary, mb: 0.5 }}>
                        {selectedInvoice.vendorName}
                      </Typography>
                      <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary, mb: 0.5 }}>
                        Contact: {selectedInvoice.vendorContact}
                      </Typography>
                      <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary, mb: 0.5 }}>
                        Email: {selectedInvoice.vendorEmail}
                      </Typography>
                      {selectedInvoice.bankName && (
                        <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
                          Bank: {selectedInvoice.bankName}
                        </Typography>
                      )}
                    </Box>
                  </Grid>
                  <Grid item xs={12} md={6}>
                    <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.07em', mb: 1 }}>
                      Payment Summary
                    </Typography>
                    <Typography sx={{ fontSize: 20, fontWeight: 700, color: (theme) => theme.palette.text.primary, fontFamily: 'monospace', mb: 0.5 }}>
                      {formatCurrency(parseFloat(selectedInvoice.total.toString()) || 0)}
                    </Typography>
                    <Typography sx={{ fontSize: 13, color: '#16A34A', mb: 0.5 }}>
                      Paid: {formatCurrency(parseFloat(selectedInvoice.totalPaid?.toString() || '0'))}
                    </Typography>
                    <Typography sx={{ fontSize: 13, fontWeight: 600, color: '#ED6C02' }}>
                      Balance: {formatCurrency(parseFloat(selectedInvoice.balanceDue?.toString() || '0'))}
                    </Typography>
                  </Grid>
                </Grid>
              </Box>

              {/* Invoice Details */}
              <Box sx={{ border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', bgcolor: (theme) => theme.palette.background.paper, p: 3, mb: 3 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.07em', mb: 2 }}>
                  Invoice Details
                </Typography>
                <Grid container spacing={3}>
                  <Grid item xs={12}>
                    <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.text.secondary, mb: 0.5 }}>Description</Typography>
                    <Box sx={{ p: 2, bgcolor: (theme) => theme.palette.divider, borderRadius: '6px' }}>
                      <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
                        {selectedInvoice.description}
                      </Typography>
                    </Box>
                  </Grid>
                  <Grid item xs={12} md={6}>
                    <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.text.secondary, mb: 0.5 }}>Invoice Date</Typography>
                    <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: (theme) => theme.palette.text.primary }}>
                      {formatDate(selectedInvoice.invoiceDate)}
                    </Typography>
                  </Grid>
                  {selectedInvoice.dueDate && (
                    <Grid item xs={12} md={6}>
                      <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.text.secondary, mb: 0.5 }}>Due Date</Typography>
                      <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: (theme) => theme.palette.text.primary }}>
                        {formatDate(selectedInvoice.dueDate)}
                      </Typography>
                    </Grid>
                  )}
                </Grid>
              </Box>

              {/* Approval Information */}
              <Box sx={{ border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', bgcolor: (theme) => theme.palette.background.default, p: 3, mb: 3 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.07em', mb: 2 }}>
                  Approval Information
                </Typography>
                <Grid container spacing={3}>
                  <Grid item xs={12} md={6}>
                    <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.text.secondary, mb: 0.5 }}>Approved By</Typography>
                    <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: (theme) => theme.palette.text.primary }}>
                      {selectedInvoice.approvedByName}
                    </Typography>
                  </Grid>
                  <Grid item xs={12} md={6}>
                    <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.text.secondary, mb: 0.5 }}>Sent to Accounting</Typography>
                    <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: (theme) => theme.palette.text.primary }}>
                      {formatDate(selectedInvoice.sentToAccountingAt)}
                    </Typography>
                  </Grid>
                  {selectedInvoice.adminNotes && (
                    <Grid item xs={12}>
                      <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.text.secondary, mb: 0.5 }}>Admin Notes</Typography>
                      <Box sx={{ p: 2, bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(245, 158, 11, 0.1)' : '#FFFBEB', borderRadius: '6px', border: (theme) => `1px solid ${theme.palette.mode === 'dark' ? 'rgba(245, 158, 11, 0.3)' : '#FDE68A'}` }}>
                        <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
                          {selectedInvoice.adminNotes}
                        </Typography>
                      </Box>
                    </Grid>
                  )}
                </Grid>
              </Box>

              {/* Payment History */}
              <Box sx={{ border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', bgcolor: (theme) => theme.palette.background.default, p: 3, mb: 3 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.07em', mb: 2 }}>
                  Payment History
                </Typography>
                {paymentHistory.length === 0 ? (
                  <Alert severity="info">
                    <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
                      No payments have been processed for this invoice yet.
                    </Typography>
                  </Alert>
                ) : (
                  <DataTable columns={PAYMENT_HISTORY_COLUMNS} shownCount={paymentHistory.length} totalCount={paymentHistory.length}>
                    {paymentHistory.map((payment) => (
                      <DataTableRow key={payment.id} columns={PAYMENT_HISTORY_COLUMNS}>
                        <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{formatDate(payment.paymentDate)}</Typography>
                        <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary, fontFamily: 'monospace' }}>{formatCurrency(payment.amount)}</Typography>
                        <StatusChip kind="brand" label={payment.paymentMethod.replace('_', ' ').toUpperCase()} />
                        <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{payment.referenceNumber || '-'}</Typography>
                        <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{payment.processedByName || 'Unknown'}</Typography>
                        <StatusChip
                          kind={payment.status === 'processed' ? 'success' : 'warning'}
                          label={payment.status.toUpperCase()}
                        />
                      </DataTableRow>
                    ))}
                  </DataTable>
                )}
              </Box>

              {/* Payment Processing */}
              <Box sx={{ border: (theme) => `2px solid ${theme.palette.divider}`, borderRadius: '10px', bgcolor: (theme) => theme.palette.background.default, p: 3 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.07em', mb: 2 }}>
                  Payment Processing
                </Typography>

                {parseFloat(selectedInvoice.balanceDue?.toString() || '0') > 0 ? (
                  <>
                    <Alert severity="info" sx={{ mb: 3 }}>
                      <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
                        <strong>Vendor:</strong> {selectedInvoice.vendorName}<br />
                        <strong>Balance Due:</strong> {formatCurrency(Number(selectedInvoice.balanceDue))}
                      </Typography>
                    </Alert>

                    <Grid container spacing={2}>
                      <Grid item xs={12}>
                        <TextField
                          fullWidth
                          label="Payment Amount"
                          type="number"
                          value={paymentData.amount}
                          onChange={(e) => setPaymentData({ ...paymentData, amount: e.target.value })}
                          inputProps={{ min: 0, max: Number(selectedInvoice.balanceDue), step: 0.01 }}
                          helperText={`Maximum: ${formatCurrency(Number(selectedInvoice.balanceDue))}`}
                        />
                      </Grid>
                      <Grid item xs={12}>
                        <TextField
                          fullWidth
                          label="Payment Date"
                          type="date"
                          value={paymentData.paymentDate}
                          onChange={(e) => setPaymentData({ ...paymentData, paymentDate: e.target.value })}
                          InputLabelProps={{ shrink: true }}
                        />
                      </Grid>
                      <Grid item xs={12}>
                        <FormControl fullWidth>
                          <InputLabel>Payment Method</InputLabel>
                          <Select
                            value={paymentData.paymentMethod}
                            onChange={(e) => setPaymentData({ ...paymentData, paymentMethod: e.target.value })}
                            label="Payment Method"
                          >
                            <MenuItem value="check">Check</MenuItem>
                            <MenuItem value="direct_deposit">Direct Deposit</MenuItem>
                            <MenuItem value="wire_transfer">Wire Transfer</MenuItem>
                          </Select>
                        </FormControl>
                      </Grid>
                      <Grid item xs={12}>
                        <TextField
                          fullWidth
                          label="Reference Number"
                          value={paymentData.referenceNumber}
                          onChange={(e) => setPaymentData({ ...paymentData, referenceNumber: e.target.value })}
                          placeholder="Check number, transaction ID, etc."
                        />
                      </Grid>
                      <Grid item xs={12}>
                        <TextField
                          fullWidth
                          label="Payment Notes"
                          multiline
                          rows={3}
                          value={paymentData.notes}
                          onChange={(e) => setPaymentData({ ...paymentData, notes: e.target.value })}
                          placeholder="Optional payment notes"
                        />
                      </Grid>
                    </Grid>

                    <Box sx={{ mt: 3, display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
                      <PrimaryButton
                        onClick={handleProcessPayment}
                        disabled={processingPayment || !paymentData.amount || parseFloat(paymentData.amount) <= 0}
                        sx={{ minWidth: 150, height: 48 }}
                      >
                        {processingPayment ? <><CircularProgress size={18} sx={{ mr: 1 }} />Processing...</> : 'Process Payment'}
                      </PrimaryButton>
                    </Box>
                  </>
                ) : (
                  <Alert severity="success">
                    <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
                      This invoice has been fully paid. No further action required.
                    </Typography>
                  </Alert>
                )}
              </Box>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <GhostButton onClick={() => setViewDialog(false)}>
            Close
          </GhostButton>
        </DialogActions>
      </Dialog>
      {confirmDialog}
    </Box>
  );
};

export default VendorInvoiceManagement;
