import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Grid,
  Alert,
  CircularProgress,
  ButtonBase,
} from '@mui/material';
import { adminApi } from '../../../services/api';
import { useSnackbar } from '../../../contexts/SnackbarContext';
import { useVendorInvoiceUpdates } from '../../../hooks/useVendorInvoiceUpdates';
import DataTable, { DataTableRow } from '../../gtacpr/DataTable';
import StatusChip from '../../gtacpr/StatusChip';
import StatCard from '../../gtacpr/StatCard';
import { GhostButton } from '../../gtacpr/Buttons';
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

const columns = [
  { key: 'invoice', label: 'INVOICE #', width: '0.8fr' },
  { key: 'vendor', label: 'VENDOR', width: '1fr' },
  { key: 'description', label: 'DESCRIPTION', width: '1fr' },
  { key: 'total', label: 'TOTAL', width: '0.7fr', align: 'right' as const },
  { key: 'paid', label: 'PAID', width: '0.7fr', align: 'right' as const },
  { key: 'paidDate', label: 'PAID DATE', width: '0.8fr' },
  { key: 'status', label: 'STATUS', width: '0.5fr' },
  { key: 'actions', label: '', width: '0.4fr', align: 'right' as const },
];

const paymentHistoryColumns = [
  { key: 'date', label: 'DATE', width: '0.8fr' },
  { key: 'amount', label: 'AMOUNT', width: '0.7fr', align: 'right' as const },
  { key: 'method', label: 'METHOD', width: '0.7fr' },
  { key: 'reference', label: 'REFERENCE', width: '0.8fr' },
  { key: 'processedBy', label: 'PROCESSED BY', width: '0.8fr' },
  { key: 'status', label: 'STATUS', width: '0.5fr' },
];

const PaidVendorInvoices: React.FC = () => {
  const [invoices, setInvoices] = useState<PaidVendorInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedInvoice, setSelectedInvoice] = useState<PaidVendorInvoice | null>(null);
  const [viewDialog, setViewDialog] = useState(false);
  const [paymentHistory, setPaymentHistory] = useState<PaymentHistory[]>([]);
  const { showSuccess, showError } = useSnackbar();

  const fetchPaidInvoices = async () => {
    try {
      setLoading(true);
      setError('');
      const response = await adminApi.getAccountingVendorInvoices();
      const paidInvoices = (response.data || []).filter((invoice: { status: string }) =>
        invoice.status === 'paid'
      );
      setInvoices(paidInvoices);
    } catch (error: unknown) {
      console.error('Error fetching paid vendor invoices:', error);
      setError('Failed to load paid vendor invoices. Please try again.');
      showError('Failed to load paid vendor invoices');
    } finally {
      setLoading(false);
    }
  };

  const { isConnected } = useVendorInvoiceUpdates({
    onStatusUpdate: (update) => {
      if (update.newStatus === 'paid') {
        fetchPaidInvoices();
      }
    },
    onNotesUpdate: () => {},
    onRefresh: fetchPaidInvoices
  });

  useEffect(() => {
    fetchPaidInvoices();
  }, []);

  const handleView = async (invoice: PaidVendorInvoice) => {
    setSelectedInvoice(invoice);
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

  const toNumber = (v: number | string | null | undefined) => {
    const n = typeof v === 'string' ? parseFloat(v) : v;
    return n == null || Number.isNaN(n) ? 0 : n;
  };
  /** total - totalPaid, never below zero (overpayments show as $0.00 due). */
  const balanceDue = (inv: { total: number | string; totalPaid: number | string }) =>
    Math.max(0, Math.round((toNumber(inv.total) - toNumber(inv.totalPaid)) * 100) / 100);
  const formatDate = (dateString: string) => formatDisplayDate(dateString, 'N/A');

  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}><CircularProgress size={24} /></Box>;

  if (error) return <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <StatusChip kind={isConnected ? 'success' : 'danger'} label={isConnected ? 'Live Updates' : 'Offline'} />
      </Box>

      {/* Summary Cards */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' }, gap: 2 }}>
        <StatCard label="Total Paid Invoices" value={invoices.length} dotColor="#16A34A" />
        <StatCard label="Total Amount Paid" value={formatCurrency(invoices.reduce((sum, inv) => {
          const total = typeof inv.total === 'number' ? inv.total : parseFloat(inv.total) || 0;
          return sum + total;
        }, 0))} dotColor="#16A34A" />
        <StatCard label="Total Payments Processed" value={formatCurrency(invoices.reduce((sum, inv) => {
          const totalPaid = Number(inv.totalPaid) || 0;
          return sum + (isNaN(totalPaid) ? 0 : totalPaid);
        }, 0))} dotColor="#0891B2" />
        <StatCard label="Most Recent Payment" value={invoices.length > 0 ? formatDate(invoices[0].paidAt || invoices[0].createdAt) : 'N/A'} dotColor="#2563EB" />
      </Box>

      {/* Invoices Table */}
      {invoices.length === 0 ? (
        <Box sx={{ bgcolor: (theme) => theme.palette.background.paper, border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', p: 6, textAlign: 'center' }}>
          <Typography sx={{ fontSize: 14, fontWeight: 600, color: (theme) => theme.palette.text.secondary, mb: 0.5 }}>No Paid Invoices Found</Typography>
          <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.text.secondary }}>Paid vendor invoices will appear here once they are fully processed.</Typography>
        </Box>
      ) : (
        <DataTable columns={columns} shownCount={invoices.length} totalCount={invoices.length}>
          {invoices.map((invoice) => (
            <DataTableRow key={invoice.id} columns={columns}>
              <Typography sx={{ fontSize: 13, fontWeight: 600, color: (theme) => theme.palette.text.primary }}>{invoice.invoiceNumber}</Typography>
              <Box>
                <Typography sx={{ fontSize: 13, fontWeight: 600, color: (theme) => theme.palette.text.primary }}>{invoice.vendorName}</Typography>
                <Typography sx={{ fontSize: 11, color: (theme) => theme.palette.text.secondary }}>{invoice.vendorEmail}</Typography>
              </Box>
              <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.text.secondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{invoice.description}</Typography>
              <Typography sx={{ fontSize: 13, fontWeight: 600, color: (theme) => theme.palette.text.primary, fontFamily: 'monospace', textAlign: 'right' }}>{formatCurrency(invoice.total)}</Typography>
              <Typography sx={{ fontSize: 13, fontWeight: 600, color: '#16A34A', fontFamily: 'monospace', textAlign: 'right' }}>{formatCurrency(toNumber(invoice.totalPaid))}</Typography>
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{formatDate(invoice.paidAt || invoice.sentToAccountingAt)}</Typography>
              <StatusChip kind="success" label="Paid" />
              <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                <ButtonBase aria-label={`View invoice ${invoice.invoiceNumber}`} onClick={() => handleView(invoice)} sx={{ fontSize: 12, fontWeight: 600, color: '#CC1F1F', '&:hover': { textDecoration: 'underline' }, '&:focus-visible': { outline: '2px solid #CC1F1F', outlineOffset: '2px' } }}>View</ButtonBase>
              </Box>
            </DataTableRow>
          ))}
        </DataTable>
      )}

      {/* Invoice Detail Dialog */}
      <Dialog open={viewDialog} onClose={handleCloseDialog} maxWidth="md" fullWidth>
        <DialogTitle sx={{ fontSize: 18, fontWeight: 700, color: (theme) => theme.palette.text.primary, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>Paid Invoice — {selectedInvoice?.invoiceNumber}</span>
          <StatusChip kind="success" label="FULLY PAID" />
        </DialogTitle>
        <DialogContent>
          {selectedInvoice && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, pt: 1 }}>
              {/* Vendor Information */}
              <Box>
                <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.07em', mb: 1 }}>Vendor Information</Typography>
                <Box sx={{ p: 2, bgcolor: (theme) => theme.palette.background.default, borderRadius: '8px', border: (theme) => `1px solid ${theme.palette.divider}` }}>
                  <Grid container spacing={2}>
                    <Grid item xs={12} md={6}>
                      {[['Vendor', selectedInvoice.vendorName], ['Email', selectedInvoice.vendorEmail]].map(([l, v]) => (
                        <Box key={String(l)} sx={{ display: 'flex', py: 0.5 }}>
                          <Typography sx={{ fontSize: 12, fontWeight: 600, color: (theme) => theme.palette.text.secondary, width: 120 }}>{l}</Typography>
                          <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.text.primary }}>{v}</Typography>
                        </Box>
                      ))}
                    </Grid>
                    <Grid item xs={12} md={6}>
                      <Box sx={{ display: 'flex', py: 0.5 }}>
                        <Typography sx={{ fontSize: 12, fontWeight: 600, color: (theme) => theme.palette.text.secondary, width: 120 }}>Payment Method</Typography>
                        <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.text.primary }}>{selectedInvoice.vendorPaymentMethod?.replace('_', ' ').toUpperCase() || 'CHECK'}</Typography>
                      </Box>
                    </Grid>
                  </Grid>
                </Box>
              </Box>

              {/* Payment Summary */}
              <Box>
                <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.07em', mb: 1 }}>Payment Summary</Typography>
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' }, gap: 2 }}>
                  <StatCard label="Total Invoice Amount" value={formatCurrency(selectedInvoice.total)} dotColor="#2563EB" />
                  <StatCard label="Amount Paid" value={formatCurrency(toNumber(selectedInvoice.totalPaid))} dotColor="#16A34A" />
                  <StatCard label="Balance Due" value={formatCurrency(balanceDue(selectedInvoice))} dotColor={balanceDue(selectedInvoice) > 0 ? '#ED6C02' : '#16A34A'} />
                </Box>
                <Box sx={{ p: 1.5, bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(22, 163, 74, 0.1)' : '#F0FDF4', borderRadius: '8px', border: (theme) => `1px solid ${theme.palette.mode === 'dark' ? 'rgba(22, 163, 74, 0.3)' : '#BBF7D0'}`, mt: 2, textAlign: 'center' }}>
                  <Typography sx={{ fontSize: 13, fontWeight: 600, color: '#16A34A' }}>Payment Complete: This invoice has been fully paid</Typography>
                </Box>
              </Box>

              {/* Invoice Details */}
              <Box>
                <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.07em', mb: 1 }}>Invoice Details</Typography>
                <Box sx={{ p: 2, bgcolor: (theme) => theme.palette.background.default, borderRadius: '8px', border: (theme) => `1px solid ${theme.palette.divider}` }}>
                  <Grid container spacing={2}>
                    <Grid item xs={12} md={6}>
                      {[['Description', selectedInvoice.description], ['Invoice Date', formatDate(selectedInvoice.invoiceDate)]].map(([l, v]) => (
                        <Box key={String(l)} sx={{ display: 'flex', py: 0.5 }}>
                          <Typography sx={{ fontSize: 12, fontWeight: 600, color: (theme) => theme.palette.text.secondary, width: 120 }}>{l}</Typography>
                          <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.text.primary }}>{v}</Typography>
                        </Box>
                      ))}
                    </Grid>
                    <Grid item xs={12} md={6}>
                      {[['Due Date', formatDate(selectedInvoice.dueDate)], ['Created', formatDate(selectedInvoice.createdAt)]].map(([l, v]) => (
                        <Box key={String(l)} sx={{ display: 'flex', py: 0.5 }}>
                          <Typography sx={{ fontSize: 12, fontWeight: 600, color: (theme) => theme.palette.text.secondary, width: 120 }}>{l}</Typography>
                          <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.text.primary }}>{v}</Typography>
                        </Box>
                      ))}
                    </Grid>
                  </Grid>
                </Box>
              </Box>

              {/* Payment Information */}
              <Box>
                <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.07em', mb: 1 }}>Payment Information</Typography>
                <Box sx={{ p: 2, bgcolor: (theme) => theme.palette.background.default, borderRadius: '8px', border: (theme) => `1px solid ${theme.palette.divider}` }}>
                  <Grid container spacing={2}>
                    <Grid item xs={12} md={6}>
                      {[['Approved By', selectedInvoice.approvedByName || 'Admin User'], ['Paid Date', formatDate(selectedInvoice.paidAt || selectedInvoice.sentToAccountingAt)]].map(([l, v]) => (
                        <Box key={String(l)} sx={{ display: 'flex', py: 0.5 }}>
                          <Typography sx={{ fontSize: 12, fontWeight: 600, color: (theme) => theme.palette.text.secondary, width: 120 }}>{l}</Typography>
                          <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.text.primary }}>{v}</Typography>
                        </Box>
                      ))}
                    </Grid>
                    <Grid item xs={12} md={6}>
                      <Box sx={{ display: 'flex', py: 0.5 }}>
                        <Typography sx={{ fontSize: 12, fontWeight: 600, color: (theme) => theme.palette.text.secondary, width: 120 }}>Admin Notes</Typography>
                        <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.text.primary }}>{selectedInvoice.adminNotes || 'No notes provided'}</Typography>
                      </Box>
                    </Grid>
                  </Grid>
                </Box>
              </Box>

              {/* Payment History */}
              <Box>
                <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.07em', mb: 1 }}>Payment History</Typography>
                {paymentHistory.length === 0 ? (
                  <Alert severity="info">
                    <Typography sx={{ fontSize: 12 }}>Payment history details are not available for this invoice.</Typography>
                  </Alert>
                ) : (
                  <DataTable columns={paymentHistoryColumns} shownCount={paymentHistory.length} totalCount={paymentHistory.length}>
                    {paymentHistory.map((payment) => (
                      <DataTableRow key={payment.id} columns={paymentHistoryColumns}>
                        <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{formatDate(payment.paymentDate)}</Typography>
                        <Typography sx={{ fontSize: 13, fontWeight: 600, color: (theme) => theme.palette.text.primary, fontFamily: 'monospace', textAlign: 'right' }}>{formatCurrency(payment.amount)}</Typography>
                        <StatusChip kind="brand" label={payment.paymentMethod.replace('_', ' ').toUpperCase()} />
                        <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{payment.referenceNumber || '-'}</Typography>
                        <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{payment.processedByName || 'Unknown'}</Typography>
                        <StatusChip kind={payment.status === 'processed' ? 'success' : 'warning'} label={payment.status.toUpperCase()} />
                      </DataTableRow>
                    ))}
                  </DataTable>
                )}
              </Box>
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <GhostButton onClick={handleCloseDialog}>Close</GhostButton>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default PaidVendorInvoices;
