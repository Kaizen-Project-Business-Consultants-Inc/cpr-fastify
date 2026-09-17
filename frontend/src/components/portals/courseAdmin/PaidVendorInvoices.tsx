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
} from '@mui/material';
import { adminApi } from '../../../services/api';
import { useSnackbar } from '../../../contexts/SnackbarContext';
import { useVendorInvoiceUpdates } from '../../../hooks/useVendorInvoiceUpdates';
import StatCard from '../../gtacpr/StatCard';
import StatusChip from '../../gtacpr/StatusChip';
import DataTable, { DataTableRow } from '../../gtacpr/DataTable';
import { GhostButton } from '../../gtacpr/Buttons';

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
      const response = await adminApi.getVendorInvoices();
      // Filter to only show paid invoices
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

  // Real-time updates
  const { isConnected } = useVendorInvoiceUpdates({
    onStatusUpdate: (update) => {
      // Refresh if an invoice becomes paid
      if (update.newStatus === 'paid') {
        fetchPaidInvoices();
      }
    },
    onNotesUpdate: (update) => {
    },
    onRefresh: fetchPaidInvoices
  });

  useEffect(() => {
    fetchPaidInvoices();
  }, []);

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

  const formatCurrency = (amount: number | string) => {
    const num = typeof amount === 'string' ? parseFloat(amount) : amount;
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(num || 0);
  };

  const formatDate = (dateString: string) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
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

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Alert severity="error" sx={{ mb: 2 }}>
        {error}
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
            value={invoices.length}
            dotColor="#15803D"
          />
          <StatCard
            label="Total Amount Paid"
            value={formatCurrency(invoices.reduce((sum, inv) => {
              const total = typeof inv.total === 'number' ? inv.total : parseFloat(inv.total) || 0;
              return sum + total;
            }, 0))}
            dotColor="#15803D"
          />
          <StatCard
            label="Total Payments Processed"
            value={formatCurrency(invoices.reduce((sum, inv) => {
              const totalPaid = Number(inv.totalPaid) || 0;
              return sum + (isNaN(totalPaid) ? 0 : totalPaid);
            }, 0))}
          />
          <StatCard
            label="Most Recent Payment"
            value={invoices.length > 0 ?
              formatDate(invoices[0].paidAt || invoices[0].createdAt) :
              'N/A'
            }
          />
        </Box>
      </Box>

      {/* Paid Invoices Table */}
      <DataTable
        columns={mainTableColumns}
        shownCount={invoices.length}
        totalCount={invoices.length}
      >
        {invoices.length === 0 ? (
          <Box sx={{ py: 6, textAlign: 'center' }}>
            <Typography sx={{ fontSize: 16, fontWeight: 600, color: (theme) => theme.palette.text.secondary, mb: 0.5 }}>
              No Paid Invoices Found
            </Typography>
            <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
              Paid vendor invoices will appear here once they are fully processed.
            </Typography>
          </Box>
        ) : (
          invoices.map((invoice) => (
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
                <Typography
                  component="span"
                  onClick={(e: React.MouseEvent) => { e.stopPropagation(); handleView(invoice); }}
                  sx={{ fontSize: 12, fontWeight: 600, color: '#CC1F1F', cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}
                >
                  View
                </Typography>
              </Box>
            </DataTableRow>
          ))
        )}
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
            <StatusChip kind="success" label="FULLY PAID" />
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
                    value="$0.00"
                    dotColor="#15803D"
                  />
                </Box>
                <Box sx={{ textAlign: 'center', mt: 1 }}>
                  <StatusChip kind="success" label="Payment Complete: This invoice has been fully paid" />
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
                      <strong>Approved By:</strong> {selectedInvoice.approvedByName || 'Admin User'}
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
