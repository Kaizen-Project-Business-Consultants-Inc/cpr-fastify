import React, { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Typography,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Grid,
  Alert,
} from '@mui/material';
import { api, adminApi } from '../../../services/api';
import { useSnackbar } from '../../../contexts/SnackbarContext';
import { useVendorInvoiceUpdates } from '../../../hooks/useVendorInvoiceUpdates';
import useServerPagination from '../../../hooks/useServerPagination';
import useDebounce from '../../../hooks/useDebounce';
import StatCard from '../../gtacpr/StatCard';
import StatusChip from '../../gtacpr/StatusChip';
import DataTable, { DataTableRow } from '../../gtacpr/DataTable';
import SearchBar from '../../gtacpr/SearchBar';
import { GhostButton } from '../../gtacpr/Buttons';
import LinkButton from '../../gtacpr/LinkButton';
import { formatCurrency, formatDisplayDate } from '../../../utils/formatters';

interface PaidVendorInvoice {
  id: number;
  invoiceNumber: string;
  description: string;
  total: number | string;
  status: string;
  createdAt: string;
  invoiceDate: string;
  dueDate: string;
  vendorName: string;
  vendorEmail: string;
  vendorContact: string;
  vendorPaymentMethod: string;
  approvedByName: string;
  approvedByEmail: string;
  sentToAccountingAt: string;
  totalPaid: number | string;
  balanceDue: number | string;
  paidAt: string;
  adminNotes: string;
}

interface PaymentHistory {
  id: number;
  paymentDate: string;
  amount: number;
  paymentMethod: string;
  referenceNumber: string;
  notes: string;
  status: string;
  processedByName: string;
}

const sectionHeader = {
  fontSize: 13,
  fontWeight: 700,
  color: (theme: any) => theme.palette.text.secondary,
  textTransform: 'uppercase' as const,
  letterSpacing: '0.07em',
};

const dialogTitleStyle = {
  fontSize: 18,
  fontWeight: 700,
  color: (theme: any) => theme.palette.text.primary,
};

const mainTableColumns = [
  { key: 'invoice', label: 'Invoice #', width: '1.2fr' },
  { key: 'vendor', label: 'Vendor', width: '1.5fr' },
  { key: 'description', label: 'Description', width: '1.5fr' },
  { key: 'total', label: 'Total Amount', width: '1fr', align: 'right' as const },
  { key: 'paid', label: 'Paid Amount', width: '1fr', align: 'right' as const },
  { key: 'paidDate', label: 'Paid Date', width: '1fr' },
  { key: 'status', label: 'Status', width: '0.8fr' },
  { key: 'actions', label: 'Actions', width: '0.7fr', align: 'center' as const },
];

const paymentTableColumns = [
  { key: 'date', label: 'Date', width: '1fr' },
  { key: 'amount', label: 'Amount', width: '1fr', align: 'right' as const },
  { key: 'method', label: 'Method', width: '1fr' },
  { key: 'reference', label: 'Reference', width: '1fr' },
  { key: 'processedBy', label: 'Processed By', width: '1fr' },
  { key: 'status', label: 'Status', width: '0.8fr' },
];

const toNumber = (value: number | string | null | undefined) => {
  const n = typeof value === 'string' ? parseFloat(value) : value;
  return n == null || Number.isNaN(n) ? 0 : n;
};

interface PaidSummary {
  totalAmount: number;
  totalPaid: number;
  mostRecentPayment: string;
}

const emptySummary: PaidSummary = { totalAmount: 0, totalPaid: 0, mostRecentPayment: '' };

const PaidVendorInvoices: React.FC = () => {
  const [selectedInvoice, setSelectedInvoice] = useState<PaidVendorInvoice | null>(null);
  const [viewDialog, setViewDialog] = useState(false);
  const [paymentHistory, setPaymentHistory] = useState<PaymentHistory[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [summary, setSummary] = useState<PaidSummary>(emptySummary);
  const { showError } = useSnackbar();

  const debouncedSearch = useDebounce(searchTerm, 300);
  const searchParam = debouncedSearch.trim();

  // `GET /admin/vendor-invoices` filters and counts `status=paid` server-side,
  // and matches `search` against the invoice number or the vendor name, so the
  // page on screen really is page N of the paid invoices.
  const grid = useServerPagination<PaidVendorInvoice>({
    pageSize: 25,
    fetchFn: ({ page, limit }) =>
      api
        .get('/admin/vendor-invoices', {
          params: { status: 'paid', page, limit, ...(searchParam ? { search: searchParam } : {}) },
        })
        .then((r) => r.data),
    onError: (err) => {
      console.error('Error fetching paid vendor invoices:', err);
      showError('Failed to load paid vendor invoices');
    },
  });

  /**
   * Money totals for the summary cards. The endpoint exposes no aggregate, so
   * this is the same `status=paid` (+ search) query with NO `page`/`limit` —
   * which still returns every matching row — rather than a sum over the 25 rows
   * currently visible.
   */
  const loadSummary = useCallback(async () => {
    try {
      const response = await api.get('/admin/vendor-invoices', {
        params: { status: 'paid', ...(searchParam ? { search: searchParam } : {}) },
      });
      const rows: PaidVendorInvoice[] = response.data?.data ?? [];
      setSummary({
        totalAmount: rows.reduce((sum, inv) => sum + toNumber(inv.total), 0),
        totalPaid: rows.reduce((sum, inv) => sum + toNumber(inv.totalPaid), 0),
        mostRecentPayment: rows.reduce((latest: string, inv) => {
          const candidate = inv.paidAt || inv.createdAt;
          if (!candidate) return latest;
          return !latest || new Date(candidate) > new Date(latest) ? candidate : latest;
        }, ''),
      });
    } catch (err: unknown) {
      console.error('Error loading paid vendor invoice totals:', err);
      setSummary(emptySummary);
    }
  }, [searchParam]);

  const refresh = useCallback(() => {
    grid.load(1);
    loadSummary();
  }, [grid.load, loadSummary]);

  // Real-time updates
  const { isConnected } = useVendorInvoiceUpdates({
    onStatusUpdate: (update) => {
      // Refresh if an invoice becomes paid
      if (update.newStatus === 'paid') {
        refresh();
      }
    },
    onNotesUpdate: () => {},
    onRefresh: refresh
  });

  useEffect(() => {
    refresh();
  }, [refresh]);

  const invoices = grid.items;

  const handleView = async (invoice: PaidVendorInvoice) => {
    setSelectedInvoice(invoice);

    // Fetch payment history for this invoice
    try {
      const response = await adminApi.getAccountingVendorInvoiceDetails(invoice.id);
      if (response.success && response.data.payments) {
        setPaymentHistory(response.data.payments);
      } else {
        setPaymentHistory([]);
      }
    } catch (error: any) {
      console.error('Error fetching payment history:', error);
      setPaymentHistory([]);
    }

    setViewDialog(true);
  };

  const handleCloseDialog = () => {
    setViewDialog(false);
    setSelectedInvoice(null);
    setPaymentHistory([]);
  };

  const formatDate = (dateString: string) => formatDisplayDate(dateString, 'N/A');

  /** Outstanding balance: total minus what has actually been paid (never assumed to be zero). */
  const balanceDueOf = (inv: PaidVendorInvoice) => {
    const total = Number(inv.total) || 0;
    const paid = Number(inv.totalPaid) || 0;
    return Math.max(0, Math.round((total - paid) * 100) / 100);
  };

  const getStatusKind = (status: string): 'success' | 'neutral' => {
    switch (status) {
      case 'paid':
        return 'success';
      default:
        return 'neutral';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'paid':
        return 'Paid';
      default:
        return status.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    }
  };

  if (grid.error) {
    return (
      <Alert severity="error" sx={{ mb: 2 }}>
        Failed to load paid vendor invoices. Please try again.
      </Alert>
    );
  }

  return (
    <Box>
      <Box sx={{ mb: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography sx={{ fontSize: 24, fontWeight: 800, color: (theme) => theme.palette.text.primary }}>
          Paid Vendor Invoices
        </Typography>
        <StatusChip
          kind={isConnected ? 'success' : 'danger'}
          label={isConnected ? 'Live Updates' : 'Offline'}
        />
      </Box>

      {/* Summary Cards */}
      <Box sx={{ mb: 3 }}>
        <Typography sx={{ ...sectionHeader, mb: 1.5 }}>
          Summary
        </Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' }, gap: 2 }}>
          <StatCard
            label="Total Paid Invoices"
            value={grid.totalCount}
            dotColor="#15803D"
          />
          <StatCard
            label="Total Amount Paid"
            value={formatCurrency(summary.totalAmount)}
            dotColor="#15803D"
          />
          <StatCard
            label="Total Payments Processed"
            value={formatCurrency(summary.totalPaid)}
          />
          <StatCard
            label="Most Recent Payment"
            value={summary.mostRecentPayment ? formatDate(summary.mostRecentPayment) : 'N/A'}
          />
        </Box>
      </Box>

      {/* Search — runs on the server against invoice number and vendor name */}
      <Box sx={{ mb: 3 }}>
        <SearchBar
          placeholder="Search paid vendor invoices by invoice # or vendor"
          value={searchTerm}
          onChange={setSearchTerm}
        />
        <Typography sx={{ mt: 1, fontSize: 12, color: (theme) => theme.palette.text.secondary }}>
          The search covers every paid vendor invoice, not just this page. The summary above reflects the same set.
        </Typography>
      </Box>

      {/* Paid Invoices Table */}
      <DataTable
        columns={mainTableColumns}
        shownCount={grid.shownCount}
        totalCount={grid.totalCount}
        page={grid.page}
        hasNextPage={grid.hasNextPage}
        onPrevPage={grid.onPrevPage}
        onNextPage={grid.onNextPage}
        loading={grid.loading}
        emptyMessage="No paid invoices found. Paid vendor invoices will appear here once they are fully processed."
      >
        {invoices.map((invoice) => (
            <DataTableRow key={invoice.id} columns={mainTableColumns} onClick={() => handleView(invoice)}>
              <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.primary }}>
                {invoice.invoiceNumber}
              </Typography>
              <Box>
                <Typography sx={{ fontSize: 13, fontWeight: 600, color: (theme) => theme.palette.text.primary }}>
                  {invoice.vendorName}
                </Typography>
                <Typography sx={{ fontSize: 11.5, color: (theme) => theme.palette.text.secondary }}>
                  {invoice.vendorEmail}
                </Typography>
              </Box>
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {invoice.description}
              </Typography>
              <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.primary, textAlign: 'right' }}>
                {formatCurrency(invoice.total)}
              </Typography>
              <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#15803D', textAlign: 'right' }}>
                {formatCurrency(invoice.totalPaid || invoice.total)}
              </Typography>
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
                {formatDate(invoice.paidAt || invoice.sentToAccountingAt)}
              </Typography>
              <Box>
                <StatusChip
                  kind={getStatusKind(invoice.status)}
                  label={getStatusLabel(invoice.status)}
                />
              </Box>
              <Box sx={{ textAlign: 'center' }}>
                <LinkButton
                  aria-label={`View invoice ${invoice.invoiceNumber}`}
                  onClick={(e: React.MouseEvent) => { e.stopPropagation(); handleView(invoice); }}
                >
                  View
                </LinkButton>
              </Box>
            </DataTableRow>
        ))}
      </DataTable>

      {/* Invoice Detail Dialog */}
      <Dialog
        open={viewDialog}
        onClose={handleCloseDialog}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          <Box display="flex" alignItems="center" justifyContent="space-between">
            <Typography sx={dialogTitleStyle}>
              Paid Invoice Details - {selectedInvoice?.invoiceNumber}
            </Typography>
            <StatusChip kind="success" label="PAID" />
          </Box>
        </DialogTitle>
        <DialogContent dividers>
          {selectedInvoice && (
            <Box>
              {/* Vendor Information */}
              <Box sx={{ border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', p: 3, mb: 3 }}>
                <Typography sx={{ ...sectionHeader, mb: 2 }}>
                  Vendor Information
                </Typography>
                <Grid container spacing={2}>
                  <Grid item xs={12} md={6}>
                    <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary, mb: 1 }}>
                      <strong>Vendor:</strong> {selectedInvoice.vendorName}
                    </Typography>
                    <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary, mb: 1 }}>
                      <strong>Email:</strong> {selectedInvoice.vendorEmail}
                    </Typography>
                  </Grid>
                  <Grid item xs={12} md={6}>
                    <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary, mb: 1 }}>
                      <strong>Payment Method:</strong> {selectedInvoice.vendorPaymentMethod?.replace('_', ' ').toUpperCase() || 'CHECK'}
                    </Typography>
                  </Grid>
                </Grid>
              </Box>

              {/* Payment Summary */}
              <Box sx={{ border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', p: 3, mb: 3 }}>
                <Typography sx={{ ...sectionHeader, mb: 2 }}>
                  Payment Summary
                </Typography>
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' }, gap: 2, mb: 2 }}>
                  <StatCard
                    label="Total Invoice Amount"
                    value={formatCurrency(selectedInvoice.total)}
                  />
                  <StatCard
                    label="Amount Paid"
                    value={formatCurrency(selectedInvoice.totalPaid || selectedInvoice.total)}
                    dotColor="#15803D"
                  />
                  <StatCard
                    label="Balance Due"
                    value={formatCurrency(balanceDueOf(selectedInvoice))}
                    dotColor={balanceDueOf(selectedInvoice) > 0 ? '#B45309' : '#15803D'}
                  />
                </Box>
                <Box sx={{ textAlign: 'center', mt: 1 }}>
                  {balanceDueOf(selectedInvoice) > 0 ? (
                    <StatusChip kind="warning" label="Marked paid, but recorded payments do not cover the full total" />
                  ) : (
                    <StatusChip kind="success" label="Payment Complete: This invoice has been fully paid" />
                  )}
                </Box>
              </Box>

              {/* Invoice Details */}
              <Box sx={{ border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', p: 3, mb: 3 }}>
                <Typography sx={{ ...sectionHeader, mb: 2 }}>
                  Invoice Details
                </Typography>
                <Grid container spacing={2}>
                  <Grid item xs={12} md={6}>
                    <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary, mb: 1 }}>
                      <strong>Description:</strong> {selectedInvoice.description}
                    </Typography>
                    <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary, mb: 1 }}>
                      <strong>Invoice Date:</strong> {formatDate(selectedInvoice.invoiceDate)}
                    </Typography>
                  </Grid>
                  <Grid item xs={12} md={6}>
                    <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary, mb: 1 }}>
                      <strong>Due Date:</strong> {formatDate(selectedInvoice.dueDate)}
                    </Typography>
                    <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary, mb: 1 }}>
                      <strong>Created:</strong> {formatDate(selectedInvoice.createdAt)}
                    </Typography>
                  </Grid>
                </Grid>
              </Box>

              {/* Payment Information */}
              <Box sx={{ border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', p: 3, mb: 3 }}>
                <Typography sx={{ ...sectionHeader, mb: 2 }}>
                  Payment Information
                </Typography>
                <Grid container spacing={2}>
                  <Grid item xs={12} md={6}>
                    <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary, mb: 1 }}>
                      <strong>Approved By:</strong> {selectedInvoice.approvedByName || '—'}
                    </Typography>
                    <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary, mb: 1 }}>
                      <strong>Paid Date:</strong> {formatDate(selectedInvoice.paidAt || selectedInvoice.sentToAccountingAt)}
                    </Typography>
                  </Grid>
                  <Grid item xs={12} md={6}>
                    <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary, mb: 1 }}>
                      <strong>Admin Notes:</strong> {selectedInvoice.adminNotes || 'No notes provided'}
                    </Typography>
                  </Grid>
                </Grid>
              </Box>

              {/* Payment History */}
              <Box sx={{ border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', p: 3 }}>
                <Typography sx={{ ...sectionHeader, mb: 2 }}>
                  Payment History
                </Typography>

                {paymentHistory.length === 0 ? (
                  <Alert severity="info">
                    <Typography sx={{ fontSize: 13 }}>
                      Payment history details are not available for this invoice.
                    </Typography>
                  </Alert>
                ) : (
                  <DataTable columns={paymentTableColumns}>
                    {paymentHistory.map((payment) => (
                      <DataTableRow key={payment.id} columns={paymentTableColumns}>
                        <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
                          {formatDate(payment.paymentDate)}
                        </Typography>
                        <Typography sx={{ fontSize: 13, fontWeight: 600, color: (theme) => theme.palette.text.primary, textAlign: 'right' }}>
                          {formatCurrency(payment.amount)}
                        </Typography>
                        <Box>
                          <StatusChip
                            kind="neutral"
                            label={payment.paymentMethod.replace('_', ' ').toUpperCase()}
                          />
                        </Box>
                        <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
                          {payment.referenceNumber || '-'}
                        </Typography>
                        <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
                          {payment.processedByName || 'Unknown'}
                        </Typography>
                        <Box>
                          <StatusChip
                            kind={payment.status === 'processed' ? 'success' : 'warning'}
                            label={payment.status.toUpperCase()}
                          />
                        </Box>
                      </DataTableRow>
                    ))}
                  </DataTable>
                )}
              </Box>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <GhostButton onClick={handleCloseDialog}>
            Close
          </GhostButton>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default PaidVendorInvoices;
