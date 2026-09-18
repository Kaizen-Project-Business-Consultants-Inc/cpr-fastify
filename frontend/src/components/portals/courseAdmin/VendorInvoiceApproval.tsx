import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Alert,
  CircularProgress,
  Grid,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
} from '@mui/material';
import { adminApi } from '../../../services/api';
import logger from '../../../utils/logger';
import { useVendorInvoiceUpdates } from '../../../hooks/useVendorInvoiceUpdates';
import StatCard from '../../gtacpr/StatCard';
import StatusChip from '../../gtacpr/StatusChip';
import DataTable, { DataTableRow } from '../../gtacpr/DataTable';
import { PrimaryButton, GhostButton } from '../../gtacpr/Buttons';
import LinkButton from '../../gtacpr/LinkButton';
import { formatCurrency, formatDisplayDate } from '../../../utils/formatters';

interface VendorInvoice {
  id: number;
  invoiceNumber: string;
  item?: string;
  company?: string;
  billingCompany?: string;
  quantity?: number | null;
  description: string;
  rate: number;
  amount: number;
  subtotal: number;
  hst: number;
  total: number;
  status: string;
  createdAt: string;
  dueDate?: string;
  paymentDate?: string;
  pdfFilename?: string;
  vendorName: string;
  vendorEmail: string;
  adminNotes?: string;
  approvedBy?: string;
  approvedAt?: string;
  rejectedBy?: string;
  rejectedAt?: string;
  rejectionReason?: string;
  totalPaid?: number | string;
  balanceDue?: number | string;
  approvedByName?: string;
  approvedByEmail?: string;
  sentToAccountingAt?: string;
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

const VendorInvoiceApproval: React.FC = () => {
  const [invoices, setInvoices] = useState<VendorInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedInvoice, setSelectedInvoice] = useState<VendorInvoice | null>(null);
  const [viewDialog, setViewDialog] = useState(false);
  const [approvalDialog, setApprovalDialog] = useState(false);
  const [action, setAction] = useState<'approve' | 'reject'>('approve');
  const [notes, setNotes] = useState('');
  const [modalNotes, setModalNotes] = useState('');
  const [processing, setProcessing] = useState(false);
  const [paymentHistory, setPaymentHistory] = useState<PaymentHistory[]>([]);
  const [statusFilter, setStatusFilter] = useState('pending');

  const fetchVendorInvoices = async () => {
    try {
      setLoading(true);
      const response = await adminApi.getVendorInvoices();
      setInvoices(response.data || []);
      setError(null);
    } catch (err: any) {
      logger.error('Error fetching vendor invoices:', err);
      setError('Failed to load vendor invoices');
    } finally {
      setLoading(false);
    }
  };

  const { isConnected } = useVendorInvoiceUpdates({
    onStatusUpdate: (update) => {
      logger.info(`Real-time status update: Invoice ${update.invoiceId} ${update.action}d by ${update.updatedBy}`);
    },
    onNotesUpdate: (update) => {
      logger.info(`Real-time notes update: Invoice ${update.invoiceId} notes updated by ${update.updatedBy}`);
    },
    onRefresh: fetchVendorInvoices
  });

  useEffect(() => {
    fetchVendorInvoices();
  }, []);

  const handleView = async (invoice: VendorInvoice) => {
    setSelectedInvoice(invoice);
    setModalNotes(invoice.adminNotes || '');

    try {
      const historyResponse = await adminApi.getAccountingVendorInvoiceDetails(invoice.id);
      if (historyResponse && historyResponse.data && historyResponse.data.payments) {
        setPaymentHistory(historyResponse.data.payments);
      } else {
        setPaymentHistory([]);
      }
    } catch (error: any) {
      console.error('Error fetching payment history:', error);
      setPaymentHistory([]);
    }

    setViewDialog(true);
  };

  const handleApprove = () => {
    setAction('approve');
    setNotes('');
    setApprovalDialog(true);
  };

  const handleReject = () => {
    setAction('reject');
    setNotes('');
    setApprovalDialog(true);
  };

  const handleApprovalSubmit = async () => {
    if (!selectedInvoice) return;

    try {
      setProcessing(true);
      await adminApi.approveVendorInvoice(selectedInvoice.id, action, notes);
      await fetchVendorInvoices();
      setApprovalDialog(false);
      setViewDialog(false);
      setSelectedInvoice(null);
      setNotes('');
      logger.info(`Vendor invoice ${action}d successfully`);
    } catch (err: any) {
      logger.error(`Error ${action}ing vendor invoice:`, err);
      setError(`Failed to ${action} invoice`);
    } finally {
      setProcessing(false);
    }
  };

  const handleDownload = async (invoice: VendorInvoice) => {
    try {
      const response = await adminApi.downloadVendorInvoice(invoice.id);
      const blob = new Blob([response.data], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `invoice-${invoice.invoiceNumber}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      logger.error('Error downloading invoice:', err);
      setError('Failed to download invoice');
    }
  };

  const handleSaveNotes = async () => {
    if (!selectedInvoice) return;

    try {
      setProcessing(true);
      await adminApi.updateVendorInvoiceNotes(selectedInvoice.id, modalNotes);
      setSelectedInvoice({
        ...selectedInvoice,
        adminNotes: modalNotes
      });
      await fetchVendorInvoices();
      logger.info('Notes saved successfully');
    } catch (err: any) {
      logger.error('Error saving notes:', err);
      setError('Failed to save notes');
    } finally {
      setProcessing(false);
    }
  };

  const getStatusKind = (status: string): 'success' | 'active' | 'warning' | 'danger' | 'neutral' | 'inactive' | 'brand' | 'pending' => {
    switch (status) {
      case 'pending_submission':
        return 'neutral';
      case 'submitted_to_admin':
        return 'warning';
      case 'submitted_to_accounting':
        return 'active';
      case 'rejected_by_admin':
        return 'danger';
      case 'rejected_by_accountant':
        return 'danger';
      case 'paid':
        return 'success';
      default:
        return 'neutral';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'pending_submission':
        return 'Pending Submission';
      case 'submitted_to_admin':
        return 'Submitted to Admin';
      case 'submitted_to_accounting':
        return 'Submitted to Accounting';
      case 'rejected_by_admin':
        return 'Rejected by Admin';
      case 'rejected_by_accountant':
        return 'Rejected by Accountant';
      case 'paid':
        return 'Paid';
      default:
        return status.replace('_', ' ').toUpperCase();
    }
  };

  const formatDate = (dateString: string) => formatDisplayDate(dateString);

  const filteredInvoices = invoices.filter(invoice => {
    if (statusFilter === 'all') return true;
    if (statusFilter === 'pending') return invoice.status !== 'paid';
    return invoice.status === statusFilter;
  });

  const stats = {
    pending_submission: invoices.filter(i => i.status === 'pending_submission').length,
    submitted_to_admin: invoices.filter(i => i.status === 'submitted_to_admin').length,
    submitted_to_accounting: invoices.filter(i => i.status === 'submitted_to_accounting').length,
    rejected: invoices.filter(i => i.status === 'rejected_by_admin' || i.status === 'rejected_by_accountant').length,
    paid: invoices.filter(i => i.status === 'paid').length,
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400 }}>
        <CircularProgress />
      </Box>
    );
  }

  const invoiceTableColumns = [
    { key: 'date', label: 'Date', width: '1fr' },
    { key: 'billingCompany', label: 'Billing Company', width: '1.5fr' },
    { key: 'invoiceNumber', label: 'Invoice #', width: '1fr' },
    { key: 'quantity', label: 'Qty', width: '0.7fr', align: 'right' as const },
    { key: 'item', label: 'Item', width: '1fr' },
    { key: 'description', label: 'Description', width: '2fr' },
    { key: 'rate', label: 'Rate', width: '1fr', align: 'right' as const },
    { key: 'amount', label: 'Amount', width: '1fr', align: 'right' as const },
    { key: 'subtotal', label: 'Subtotal', width: '1fr', align: 'right' as const },
    { key: 'hst', label: 'HST', width: '0.8fr', align: 'right' as const },
    { key: 'total', label: 'Total', width: '1fr', align: 'right' as const },
    { key: 'status', label: 'Status', width: '1.2fr' },
    { key: 'dueDate', label: 'Due Date', width: '1fr' },
    { key: 'actions', label: 'Actions', width: '1fr', align: 'center' as const },
  ];

  const paymentTableColumns = [
    { key: 'date', label: 'Date', width: '1fr' },
    { key: 'amount', label: 'Amount', width: '1fr' },
    { key: 'method', label: 'Method', width: '1fr' },
    { key: 'reference', label: 'Reference', width: '1fr' },
    { key: 'processedBy', label: 'Processed By', width: '1fr' },
    { key: 'status', label: 'Status', width: '1fr' },
  ];

  return (
    <Box>
      <Box sx={{ mb: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography sx={{ fontSize: 22, fontWeight: 700, color: (theme) => theme.palette.text.primary }}>
          Vendor Invoice Approval
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <StatusChip
            kind={isConnected ? 'success' : 'danger'}
            label={isConnected ? 'Live Updates' : 'Offline'}
          />
          <GhostButton onClick={fetchVendorInvoices} disabled={loading}>
            Refresh
          </GhostButton>
        </Box>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(3, 1fr)', md: 'repeat(5, 1fr)' }, gap: 2, mb: 3 }}>
        <StatCard label="Pending Submission" value={stats.pending_submission} dotColor="#9CA3AF" />
        <StatCard label="Submitted to Admin" value={stats.submitted_to_admin} dotColor="#F59E0B" />
        <StatCard label="Submitted to Accounting" value={stats.submitted_to_accounting} dotColor="#3B82F6" />
        <StatCard label="Rejected" value={stats.rejected} dotColor="#EF4444" />
        <StatCard label="Paid" value={stats.paid} dotColor="#10B981" />
      </Box>

      <Box sx={{ mb: 2, border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', bgcolor: (theme) => theme.palette.background.paper, p: 2 }}>
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
            <MenuItem value="paid">Paid</MenuItem>
          </Select>
        </FormControl>
      </Box>

      <Box sx={{ border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', bgcolor: (theme) => theme.palette.background.paper, p: 3, overflowX: 'auto' }}>
        <DataTable columns={invoiceTableColumns} shownCount={filteredInvoices.length} totalCount={invoices.length}>
          {filteredInvoices.map((invoice) => (
            <DataTableRow key={invoice.id} columns={invoiceTableColumns}>
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
                {formatDisplayDate(invoice.createdAt)}
              </Typography>
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
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
              <Box sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={invoice.description}>
                <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{invoice.description}</Typography>
              </Box>
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary, textAlign: 'right', fontFamily: 'monospace' }}>
                {invoice.rate && !isNaN(invoice.rate) && invoice.rate > 0
                  ? formatCurrency(invoice.rate)
                  : '-'}
              </Typography>
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary, textAlign: 'right', fontFamily: 'monospace' }}>
                {invoice.amount && !isNaN(Number(invoice.amount))
                  ? formatCurrency(invoice.amount)
                  : (invoice.total && !isNaN(Number(invoice.total))
                    ? formatCurrency(invoice.total)
                    : '-')}
              </Typography>
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary, textAlign: 'right', fontFamily: 'monospace' }}>
                {invoice.subtotal && !isNaN(invoice.subtotal) && invoice.subtotal > 0
                  ? formatCurrency(invoice.subtotal)
                  : '-'}
              </Typography>
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary, textAlign: 'right', fontFamily: 'monospace' }}>
                {invoice.hst && !isNaN(invoice.hst) && invoice.hst > 0
                  ? formatCurrency(invoice.hst)
                  : '-'}
              </Typography>
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary, textAlign: 'right', fontFamily: 'monospace' }}>
                {invoice.total && !isNaN(invoice.total) && invoice.total > 0
                  ? formatCurrency(invoice.total)
                  : '-'}
              </Typography>
              <StatusChip kind={getStatusKind(invoice.status)} label={getStatusLabel(invoice.status)} />
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
                {invoice.dueDate ? formatDisplayDate(invoice.dueDate) : '-'}
              </Typography>
              <Box sx={{ display: 'flex', gap: 1.5, justifyContent: 'center' }}>
                <LinkButton aria-label={`View invoice ${invoice.invoiceNumber}`} onClick={() => handleView(invoice)}>
                  View
                </LinkButton>
                <LinkButton aria-label={`Download invoice ${invoice.invoiceNumber}`} onClick={() => handleDownload(invoice)}>
                  Download
                </LinkButton>
              </Box>
            </DataTableRow>
          ))}
        </DataTable>
      </Box>

      {filteredInvoices.length === 0 && (
        <Box sx={{ textAlign: 'center', py: 4 }}>
          <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
            No invoices found matching the current filter.
          </Typography>
        </Box>
      )}

      {/* View Invoice Dialog */}
      <Dialog open={viewDialog} onClose={() => setViewDialog(false)} maxWidth="md" fullWidth sx={{ '& .MuiDialog-paper': { maxHeight: '90vh' } }}>
        <DialogTitle>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography sx={{ fontSize: 18, fontWeight: 700, color: (theme) => theme.palette.text.primary }}>
              Invoice Details - #{selectedInvoice?.invoiceNumber}
            </Typography>
            {selectedInvoice && (
              <StatusChip
                kind={getStatusKind(selectedInvoice.status)}
                label={selectedInvoice.status.replace('_', ' ').toUpperCase()}
              />
            )}
          </Box>
        </DialogTitle>
        <DialogContent>
          {selectedInvoice && (
            <Box>
              {/* Vendor & Payment Summary */}
              <Box sx={{ border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', bgcolor: (theme) => theme.palette.background.paper, p: 3, mb: 3 }}>
                <Grid container spacing={3}>
                  <Grid item xs={12} md={6}>
                    <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.07em', mb: 1.5 }}>
                      Vendor Information
                    </Typography>
                    <Box sx={{ pl: 2 }}>
                      <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: (theme) => theme.palette.text.primary, mb: 1 }}>
                        {selectedInvoice.vendorName}
                      </Typography>
                      <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary, mb: 1 }}>
                        {selectedInvoice.vendorEmail}
                      </Typography>
                    </Box>
                  </Grid>
                  <Grid item xs={12} md={6}>
                    <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.07em', mb: 1.5 }}>
                      Payment Summary
                    </Typography>
                    <Box sx={{ pl: 2 }}>
                      <Typography sx={{ fontSize: 20, fontWeight: 700, color: '#CC1F1F', mb: 1, fontFamily: 'monospace' }}>
                        {formatCurrency(Number(selectedInvoice.total) > 0 ? selectedInvoice.total : selectedInvoice.amount)}
                      </Typography>
                      {selectedInvoice.totalPaid && (
                        <Typography sx={{ fontSize: 13, color: '#16A34A', mb: 1 }}>
                          Paid: {formatCurrency(selectedInvoice.totalPaid)}
                        </Typography>
                      )}
                      {selectedInvoice.balanceDue && (
                        <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#ED6C02' }}>
                          Balance: {formatCurrency(selectedInvoice.balanceDue)}
                        </Typography>
                      )}
                      <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.text.secondary, mt: 1 }}>
                        Invoice #{selectedInvoice.invoiceNumber}
                      </Typography>
                    </Box>
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
                    <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.text.secondary, mb: 0.5 }}>
                      Description
                    </Typography>
                    <Box sx={{ p: 2, backgroundColor: (theme) => theme.palette.background.default, borderRadius: '8px', border: (theme) => `1px solid ${theme.palette.divider}` }}>
                      <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
                        {selectedInvoice.description}
                      </Typography>
                    </Box>
                  </Grid>
                  <Grid item xs={12} md={6}>
                    <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.text.secondary, mb: 0.5 }}>
                      Submission Date
                    </Typography>
                    <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: (theme) => theme.palette.text.primary }}>
                      {formatDate(selectedInvoice.createdAt)}
                    </Typography>
                  </Grid>
                  {selectedInvoice.dueDate && (
                    <Grid item xs={12} md={6}>
                      <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.text.secondary, mb: 0.5 }}>
                        Due Date
                      </Typography>
                      <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: (theme) => theme.palette.text.primary }}>
                        {formatDate(selectedInvoice.dueDate)}
                      </Typography>
                    </Grid>
                  )}
                </Grid>
              </Box>

              {/* Payment Details */}
              <Box sx={{ border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', bgcolor: (theme) => theme.palette.background.paper, p: 3, mb: 3 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.07em', mb: 2 }}>
                  Payment Details
                </Typography>
                <Grid container spacing={3}>
                  <Grid item xs={12} md={4}>
                    <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.text.secondary, mb: 0.5 }}>
                      Total Invoice Amount
                    </Typography>
                    <Typography sx={{ fontSize: 18, fontWeight: 700, color: '#CC1F1F', fontFamily: 'monospace' }}>
                      {formatCurrency(parseFloat(selectedInvoice.total?.toString() || '0') || 0)}
                    </Typography>
                  </Grid>
                  <Grid item xs={12} md={4}>
                    <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.text.secondary, mb: 0.5 }}>
                      Amount Paid
                    </Typography>
                    <Typography sx={{ fontSize: 18, fontWeight: 700, color: '#16A34A', fontFamily: 'monospace' }}>
                      {selectedInvoice.totalPaid && parseFloat(selectedInvoice.totalPaid.toString()) > 0
                        ? formatCurrency(parseFloat(selectedInvoice.totalPaid.toString()))
                        : formatCurrency(parseFloat(selectedInvoice.total?.toString() || '0'))}
                    </Typography>
                  </Grid>
                  <Grid item xs={12} md={4}>
                    <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.text.secondary, mb: 0.5 }}>
                      Balance Due
                    </Typography>
                    <Typography sx={{ fontSize: 18, fontWeight: 700, color: '#ED6C02', fontFamily: 'monospace' }}>
                      {formatCurrency(parseFloat(selectedInvoice.balanceDue?.toString() || '0'))}
                    </Typography>
                  </Grid>
                </Grid>
                {selectedInvoice.status === 'paid' && (
                  <Box sx={{ mt: 3 }}>
                    <Alert severity="success">
                      <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
                        <strong>Payment Complete:</strong> This invoice has been fully paid.
                      </Typography>
                    </Alert>
                  </Box>
                )}
              </Box>

              {/* Processing Information */}
              <Box sx={{ border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', bgcolor: (theme) => theme.palette.background.paper, p: 3, mb: 3 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.07em', mb: 2 }}>
                  Processing Information
                </Typography>
                <Grid container spacing={3}>
                  <Grid item xs={12} md={6}>
                    <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.text.secondary, mb: 0.5 }}>
                      Current Status
                    </Typography>
                    <StatusChip
                      kind={getStatusKind(selectedInvoice.status)}
                      label={selectedInvoice.status.replace('_', ' ').toUpperCase()}
                    />
                  </Grid>
                  {selectedInvoice.approvedBy && (
                    <Grid item xs={12} md={6}>
                      <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.text.secondary, mb: 0.5 }}>
                        Approved By
                      </Typography>
                      <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: (theme) => theme.palette.text.primary }}>
                        {selectedInvoice.approvedBy}
                      </Typography>
                    </Grid>
                  )}
                  {selectedInvoice.rejectedBy && (
                    <Grid item xs={12} md={6}>
                      <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.text.secondary, mb: 0.5 }}>
                        Rejected By
                      </Typography>
                      <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: (theme) => theme.palette.text.primary }}>
                        {selectedInvoice.rejectedBy}
                      </Typography>
                    </Grid>
                  )}
                </Grid>
              </Box>

              {/* Admin Notes */}
              <Box sx={{ border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', bgcolor: (theme) => theme.palette.background.paper, p: 3, mb: 3 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                  <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                    Admin Notes
                  </Typography>
                  <PrimaryButton size="small" onClick={handleSaveNotes} disabled={processing}>
                    {processing ? 'Saving...' : 'Save Notes'}
                  </PrimaryButton>
                </Box>
                <TextField
                  fullWidth
                  multiline
                  rows={4}
                  value={modalNotes}
                  onChange={(e) => setModalNotes(e.target.value)}
                  placeholder="Enter admin notes here..."
                  variant="outlined"
                  sx={{
                    backgroundColor: (theme) => theme.palette.background.default,
                    '& .MuiOutlinedInput-root': {
                      '& fieldset': {
                        borderColor: (theme) => theme.palette.divider,
                      },
                    }
                  }}
                />
              </Box>

              {/* Payment History */}
              <Box sx={{ border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', bgcolor: (theme) => theme.palette.background.paper, p: 3, mb: 3 }}>
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
                  <Box sx={{ mt: 1 }}>
                    <DataTable columns={paymentTableColumns} shownCount={paymentHistory.length} totalCount={paymentHistory.length}>
                      {paymentHistory.map((payment) => (
                        <DataTableRow key={payment.id} columns={paymentTableColumns}>
                          <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
                            {formatDisplayDate(payment.paymentDate)}
                          </Typography>
                          <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary, fontFamily: 'monospace' }}>
                            {formatCurrency(payment.amount)}
                          </Typography>
                          <StatusChip kind="active" label={payment.paymentMethod.replace('_', ' ').toUpperCase()} />
                          <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
                            {payment.referenceNumber || '-'}
                          </Typography>
                          <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
                            {payment.processedByName || 'Unknown'}
                          </Typography>
                          <StatusChip
                            kind={payment.status === 'processed' ? 'success' : 'warning'}
                            label={payment.status.toUpperCase()}
                          />
                        </DataTableRow>
                      ))}
                    </DataTable>
                  </Box>
                )}
              </Box>

              {/* Available Actions */}
              <Box sx={{ border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', bgcolor: (theme) => theme.palette.background.paper, p: 3 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.07em', mb: 2 }}>
                  Available Actions
                </Typography>
                <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', minHeight: 60 }}>
                  {selectedInvoice.pdfFilename && (
                    <GhostButton onClick={() => handleDownload(selectedInvoice)} sx={{ minWidth: 150 }}>
                      Download PDF
                    </GhostButton>
                  )}
                  {selectedInvoice.status === 'submitted_to_admin' && (
                    <>
                      <PrimaryButton
                        onClick={handleApprove}
                        sx={{ minWidth: 150, height: 48, backgroundColor: '#16A34A', '&:hover': { backgroundColor: '#15803D' } }}
                      >
                        Submit to Accounting
                      </PrimaryButton>
                      <PrimaryButton
                        onClick={handleReject}
                        sx={{ minWidth: 150, height: 48, backgroundColor: '#CC1F1F', '&:hover': { backgroundColor: '#B91C1C' } }}
                      >
                        Reject Invoice
                      </PrimaryButton>
                    </>
                  )}
                  {selectedInvoice.status !== 'submitted_to_admin' && (
                    <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary, fontStyle: 'italic', alignSelf: 'center' }}>
                      This invoice has already been processed and cannot be modified.
                    </Typography>
                  )}
                </Box>
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

      {/* Approval Dialog */}
      <Dialog open={approvalDialog} onClose={() => setApprovalDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>
          <Typography sx={{ fontSize: 18, fontWeight: 700, color: (theme) => theme.palette.text.primary }}>
            {action === 'approve' ? 'Approve Invoice' : 'Reject Invoice'}
          </Typography>
        </DialogTitle>
        <DialogContent>
          {selectedInvoice && (
            <Box sx={{ mb: 2 }}>
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
                Invoice #{selectedInvoice.invoiceNumber} from {selectedInvoice.vendorName}
              </Typography>
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
                Amount: {formatCurrency(selectedInvoice.amount)}
              </Typography>
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
                Description: {selectedInvoice.description}
              </Typography>
            </Box>
          )}
          <TextField
            fullWidth
            multiline
            rows={4}
            label={`${action === 'approve' ? 'Approval' : 'Rejection'} Notes`}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={`Enter ${action === 'approve' ? 'approval' : 'rejection'} notes...`}
            required={action === 'reject'}
          />
        </DialogContent>
        <DialogActions>
          <GhostButton onClick={() => setApprovalDialog(false)} disabled={processing}>
            Cancel
          </GhostButton>
          <PrimaryButton
            onClick={handleApprovalSubmit}
            disabled={processing || (action === 'reject' && !notes.trim())}
            sx={action === 'approve'
              ? { backgroundColor: '#16A34A', '&:hover': { backgroundColor: '#15803D' } }
              : { backgroundColor: '#CC1F1F', '&:hover': { backgroundColor: '#B91C1C' } }
            }
          >
            {processing ? 'Processing...' : `${action === 'approve' ? 'Approve' : 'Reject'} Invoice`}
          </PrimaryButton>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default VendorInvoiceApproval;
