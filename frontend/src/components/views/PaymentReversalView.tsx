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
  CircularProgress,
  Snackbar,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
} from '@mui/material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../services/api';
import DataTable, { DataTableRow } from '../gtacpr/DataTable';
import StatusChip from '../gtacpr/StatusChip';
import { PrimaryButton, GhostButton } from '../gtacpr/Buttons';

interface ReversalPayment {
  payment_id: number;
  invoice_number: string;
  organization_name: string;
  amount: number;
  payment_date: string;
  verified_by_accounting_at: string;
  status: string;
  payment_method: string;
  reference_number?: string;
  contact_email?: string;
  notes?: string;
}

const columns = [
  { key: 'id', label: 'PAYMENT ID', width: '0.5fr' },
  { key: 'invoice', label: 'INVOICE', width: '0.8fr' },
  { key: 'org', label: 'ORGANIZATION', width: '1fr' },
  { key: 'amount', label: 'AMOUNT', width: '0.7fr', align: 'right' as const },
  { key: 'payDate', label: 'PAYMENT DATE', width: '0.8fr' },
  { key: 'verified', label: 'VERIFIED AT', width: '0.8fr' },
  { key: 'remaining', label: 'TIME LEFT', width: '0.6fr' },
  { key: 'status', label: 'STATUS', width: '0.5fr' },
  { key: 'actions', label: '', width: '0.6fr', align: 'right' as const },
];

const PaymentReversalView = () => {
  const [selectedPayment, setSelectedPayment] = useState<ReversalPayment | null>(null);
  const [reversalDialogOpen, setReversalDialogOpen] = useState(false);
  const [viewDetailsDialogOpen, setViewDetailsDialogOpen] = useState(false);
  const [reversalReason, setReversalReason] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [filterStatus, setFilterStatus] = useState('verified');
  const queryClient = useQueryClient();

  const { data: paymentsData, isLoading, refetch } = useQuery<{ payments: ReversalPayment[] }>({
    queryKey: ['verified-payments-for-reversal', filterStatus],
    queryFn: async () => {
      const response = await api.get('/accounting/verified-payments', { params: { status: filterStatus } });
      return response.data.data;
    },
  });

  const reversePaymentMutation = useMutation({
    mutationFn: async ({ paymentId, reason }: { paymentId: number; reason: string }) => {
      const response = await api.post(`/accounting/payments/${paymentId}/reverse`, { reason });
      return response.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['verified-payments-for-reversal'] });
      queryClient.invalidateQueries({ queryKey: ['accounting-invoices'] });
      setReversalDialogOpen(false);
      setReversalReason('');
      setSuccessMessage(`Payment reversed successfully! Amount: $${data.data.reversedAmount}`);
      setErrorMessage('');
    },
    onError: (error: Error & { response?: { data?: { message?: string } } }) => {
      setErrorMessage(error.response?.data?.message || 'Failed to reverse payment.');
      setSuccessMessage('');
    },
  });

  const formatCurrency = (amount: number | undefined | null) => new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(amount || 0);
  const formatDate = (dateString: string | undefined | null) => dateString ? new Date(dateString).toLocaleDateString() : '-';
  const formatDateTime = (dateString: string | undefined | null) => dateString ? new Date(dateString).toLocaleString() : '-';

  // Date.now() is impure to call during render, but these are pure display
  // helpers invoked from JSX on every render; the "48h window" is inherently
  // time-dependent, so we accept the react-hooks/purity warning here rather
  // than restructure into a ticking interval (which would change behaviour).
  const canReversePayment = (payment: ReversalPayment) => {
    if (payment.status !== 'verified') return false;
    // eslint-disable-next-line react-hooks/purity -- see comment above
    const hours = (Date.now() - new Date(payment.verified_by_accounting_at).getTime()) / (1000 * 60 * 60);
    return hours <= 48;
  };

  const getTimeRemaining = (payment: ReversalPayment) => {
    // eslint-disable-next-line react-hooks/purity -- see comment above canReversePayment
    const hours = Math.max(0, 48 - (Date.now() - new Date(payment.verified_by_accounting_at).getTime()) / (1000 * 60 * 60));
    if (hours <= 0) return 'Expired';
    if (hours < 1) return `${Math.round(hours * 60)} min`;
    if (hours < 24) return `${Math.round(hours)} hrs`;
    return `${Math.floor(hours / 24)} days`;
  };

  if (isLoading) return <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}><CircularProgress size={24} /></Box>;

  const payments = paymentsData?.payments || [];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Filter */}
      <Box sx={{ border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', bgcolor: (theme) => theme.palette.background.paper, p: 3 }}>
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
          <FormControl sx={{ minWidth: 200 }} size="small">
            <InputLabel>Status</InputLabel>
            <Select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} label="Status">
              <MenuItem value="verified">Verified Payments</MenuItem>
              <MenuItem value="reversed">Reversed Payments</MenuItem>
              <MenuItem value="all">All Payments</MenuItem>
            </Select>
          </FormControl>
          <GhostButton onClick={() => refetch()}>Refresh</GhostButton>
        </Box>
      </Box>

      {/* Table */}
      {payments.length === 0 ? (
        <Box sx={{ bgcolor: (theme) => theme.palette.background.paper, border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', p: 6, textAlign: 'center' }}>
          <Typography sx={{ fontSize: 14, fontWeight: 600, color: (theme) => theme.palette.text.secondary }}>No payments found matching the current filter.</Typography>
        </Box>
      ) : (
        <DataTable columns={columns} shownCount={payments.length} totalCount={payments.length}>
          {payments.map((payment: ReversalPayment) => (
            <DataTableRow key={payment.payment_id} columns={columns}>
              <Typography sx={{ fontSize: 13, fontWeight: 600, color: (theme) => theme.palette.text.primary }}>{payment.payment_id}</Typography>
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{payment.invoice_number}</Typography>
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{payment.organization_name}</Typography>
              <Typography sx={{ fontSize: 13, fontWeight: 600, color: (theme) => theme.palette.text.primary, fontFamily: 'monospace', textAlign: 'right' }}>{formatCurrency(payment.amount)}</Typography>
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{formatDate(payment.payment_date)}</Typography>
              <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.text.secondary }}>{formatDateTime(payment.verified_by_accounting_at)}</Typography>
              <StatusChip kind={canReversePayment(payment) ? 'success' : 'danger'} label={getTimeRemaining(payment)} />
              <StatusChip kind={payment.status === 'verified' ? 'success' : 'neutral'} label={payment.status} />
              <Box sx={{ display: 'flex', gap: 1.5, justifyContent: 'flex-end' }}>
                <Box onClick={() => { setSelectedPayment(payment); setViewDetailsDialogOpen(true); }} sx={{ fontSize: 12, fontWeight: 600, color: '#CC1F1F', cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}>View</Box>
                {canReversePayment(payment) && (
                  <Box onClick={() => { setSelectedPayment(payment); setReversalDialogOpen(true); }} sx={{ fontSize: 12, fontWeight: 600, color: '#ED6C02', cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}>Reverse</Box>
                )}
              </Box>
            </DataTableRow>
          ))}
        </DataTable>
      )}

      {/* Reversal Dialog */}
      <Dialog open={reversalDialogOpen} onClose={() => setReversalDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontSize: 18, fontWeight: 700, color: (theme) => theme.palette.text.primary }}>Reverse Payment — {selectedPayment?.invoice_number}</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>This action will reverse the payment and recalculate the invoice balance. This cannot be undone.</Alert>
          <Box sx={{ p: 2, bgcolor: (theme) => theme.palette.background.default, borderRadius: '8px', border: (theme) => `1px solid ${theme.palette.divider}`, mb: 2 }}>
            {[['Payment ID', selectedPayment?.payment_id], ['Amount', formatCurrency(selectedPayment?.amount)], ['Payment Date', formatDate(selectedPayment?.payment_date)], ['Method', selectedPayment?.payment_method], ['Reference', selectedPayment?.reference_number || 'N/A']].map(([l, v]) => (
              <Box key={String(l)} sx={{ display: 'flex', py: 0.5 }}>
                <Typography sx={{ fontSize: 12, fontWeight: 600, color: (theme) => theme.palette.text.secondary, width: 110 }}>{l}</Typography>
                <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.text.primary }}>{v}</Typography>
              </Box>
            ))}
          </Box>
          <TextField fullWidth label="Reason for Reversal" multiline rows={4} value={reversalReason} onChange={(e) => setReversalReason(e.target.value)} placeholder="Please provide a detailed reason..." required />
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <GhostButton onClick={() => setReversalDialogOpen(false)}>Cancel</GhostButton>
          <PrimaryButton onClick={() => { if (selectedPayment && reversalReason.trim()) reversePaymentMutation.mutate({ paymentId: selectedPayment.payment_id, reason: reversalReason.trim() }); }} disabled={!reversalReason.trim() || reversePaymentMutation.isPending}>
            {reversePaymentMutation.isPending ? 'Reversing...' : 'Reverse Payment'}
          </PrimaryButton>
        </DialogActions>
      </Dialog>

      {/* Details Dialog */}
      <Dialog open={viewDetailsDialogOpen} onClose={() => setViewDetailsDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ fontSize: 18, fontWeight: 700, color: (theme) => theme.palette.text.primary }}>Payment Details — {selectedPayment?.invoice_number}</DialogTitle>
        <DialogContent>
          {selectedPayment && (
            <Grid container spacing={3} sx={{ pt: 1 }}>
              <Grid item xs={12} md={6}>
                <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.07em', mb: 1 }}>Payment Information</Typography>
                <Box sx={{ p: 2, bgcolor: (theme) => theme.palette.background.default, borderRadius: '8px', border: (theme) => `1px solid ${theme.palette.divider}` }}>
                  {[['Payment ID', selectedPayment.payment_id], ['Amount', formatCurrency(selectedPayment.amount)], ['Payment Date', formatDate(selectedPayment.payment_date)], ['Method', selectedPayment.payment_method], ['Reference', selectedPayment.reference_number || 'N/A'], ['Status', selectedPayment.status], ['Verified At', formatDateTime(selectedPayment.verified_by_accounting_at)]].map(([l, v]) => (
                    <Box key={String(l)} sx={{ display: 'flex', py: 0.5 }}>
                      <Typography sx={{ fontSize: 12, fontWeight: 600, color: (theme) => theme.palette.text.secondary, width: 110 }}>{l}</Typography>
                      <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.text.primary }}>{v}</Typography>
                    </Box>
                  ))}
                </Box>
              </Grid>
              <Grid item xs={12} md={6}>
                <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.07em', mb: 1 }}>Invoice Information</Typography>
                <Box sx={{ p: 2, bgcolor: (theme) => theme.palette.background.default, borderRadius: '8px', border: (theme) => `1px solid ${theme.palette.divider}` }}>
                  {[['Invoice Number', selectedPayment.invoice_number], ['Organization', selectedPayment.organization_name], ['Contact Email', selectedPayment.contact_email]].map(([l, v]) => (
                    <Box key={String(l)} sx={{ display: 'flex', py: 0.5 }}>
                      <Typography sx={{ fontSize: 12, fontWeight: 600, color: (theme) => theme.palette.text.secondary, width: 110 }}>{l}</Typography>
                      <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.text.primary }}>{v}</Typography>
                    </Box>
                  ))}
                </Box>
              </Grid>
              {selectedPayment.notes && (
                <Grid item xs={12}>
                  <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.07em', mb: 1 }}>Notes</Typography>
                  <Box sx={{ p: 2, bgcolor: (theme) => theme.palette.background.default, borderRadius: '8px', border: (theme) => `1px solid ${theme.palette.divider}` }}>
                    <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{selectedPayment.notes}</Typography>
                  </Box>
                </Grid>
              )}
            </Grid>
          )}
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <GhostButton onClick={() => setViewDetailsDialogOpen(false)}>Close</GhostButton>
        </DialogActions>
      </Dialog>

      <Snackbar open={!!successMessage} autoHideDuration={6000} onClose={() => setSuccessMessage('')}>
        <Alert severity="success" onClose={() => setSuccessMessage('')}>{successMessage}</Alert>
      </Snackbar>
      <Snackbar open={!!errorMessage} autoHideDuration={6000} onClose={() => setErrorMessage('')}>
        <Alert severity="error" onClose={() => setErrorMessage('')}>{errorMessage}</Alert>
      </Snackbar>
    </Box>
  );
};

export default PaymentReversalView;
