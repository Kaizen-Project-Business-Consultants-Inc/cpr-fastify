import React, { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Typography,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Alert,
  CircularProgress,
  Pagination,
  TextField,
  FormControl,
  InputLabel,
  Select,
  SelectChangeEvent,
  MenuItem,
  Grid,
  ButtonBase,
} from '@mui/material';
import { hrService } from '../../services/hrService';
import StatCard from '../gtacpr/StatCard';
import StatusChip from '../gtacpr/StatusChip';
import DataTable, { DataTableRow } from '../gtacpr/DataTable';
import { PrimaryButton, GhostButton } from '../gtacpr/Buttons';
import { useConfirm } from '../gtacpr/ConfirmDialog';
import { useSnackbar } from '../../contexts/SnackbarContext';
import { getErrorMessage } from '../../utils/errorMessage';

interface ReturnedPaymentRequest {
  id: number;
  instructorId: number;
  instructorName: string;
  instructorEmail: string;
  amount: number;
  weekStartDate: string;
  totalHours: number;
  coursesTaught: number;
  hourlyRate: number;
  courseBonus: number;
  baseAmount: number;
  bonusAmount: number;
  tierName: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

const requestColumns = [
  { key: 'id', label: 'ID', width: '0.3fr' },
  { key: 'instructor', label: 'INSTRUCTOR', width: '1.2fr' },
  { key: 'amount', label: 'AMOUNT', width: '0.7fr', align: 'right' as const },
  { key: 'week', label: 'WEEK STARTING', width: '0.8fr' },
  { key: 'hours', label: 'HOURS / COURSES', width: '0.8fr' },
  { key: 'returned', label: 'RETURNED DATE', width: '0.8fr' },
  { key: 'actions', label: '', width: '0.5fr', align: 'right' as const },
];

// Detail Dialog
const ReturnedPaymentRequestDetailDialog: React.FC<{
  open: boolean;
  request: ReturnedPaymentRequest | null;
  onClose: () => void;
  onActionSuccess?: () => void;
}> = ({ open, request, onClose, onActionSuccess }) => {
  const [action, setAction] = useState<'override_approve' | 'final_reject'>('override_approve');
  const [notes, setNotes] = useState('');
  const [processing, setProcessing] = useState(false);
  const { showSuccess, showError } = useSnackbar();
  const { confirm, dialog: confirmDialog } = useConfirm();

  const handleClose = () => { onClose(); setAction('override_approve'); setNotes(''); };

  const handleProcessRequest = async () => {
    if (!request || !notes.trim()) {
      showError('Notes are required when processing a returned payment request.');
      return;
    }

    const amount = `$${Number(request.amount).toFixed(2)}`;
    const week = new Date(request.weekStartDate).toLocaleDateString();
    const ok = await confirm(
      action === 'override_approve'
        ? {
            title: 'Override accounting and approve payment?',
            message: `This overrides the accountant's decision and approves the ${amount} payment to ${request.instructorName} for the week starting ${week}. The payment will proceed.`,
            confirmLabel: 'Override & Approve',
          }
        : {
            title: 'Issue final rejection?',
            message: `This permanently rejects the ${amount} payment request from ${request.instructorName} for the week starting ${week}. This is the final decision and cannot be undone.`,
            confirmLabel: 'Final Rejection',
            danger: true,
          }
    );
    if (!ok) return;

    setProcessing(true);
    try {
      await hrService.processReturnedPaymentRequest(request.id, action, notes.trim());
      showSuccess(
        action === 'override_approve'
          ? `Payment of ${amount} to ${request.instructorName} approved`
          : `Payment request from ${request.instructorName} finally rejected`
      );
      if (onActionSuccess) onActionSuccess();
      handleClose();
    } catch (err: unknown) {
      showError(getErrorMessage(err, 'Failed to process payment request. Please try again.'));
    } finally {
      setProcessing(false);
    }
  };

  if (!request) return null;

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="lg" fullWidth>
      {confirmDialog}
      <DialogTitle sx={{ fontSize: 18, fontWeight: 700, color: (theme) => theme.palette.text.primary, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        Review Returned Payment Request
        <StatusChip kind="warning" label="RETURNED TO HR" />
      </DialogTitle>
      <DialogContent>
        <Box sx={{ pt: 1 }}>
          <Grid container spacing={2}>
            {/* Instructor Information */}
            <Grid item xs={12} md={6}>
              <Box sx={{ border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', p: 3 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.07em', mb: 1 }}>Instructor Information</Typography>
                {[['Name', request.instructorName], ['Email', request.instructorEmail], ['ID', request.instructorId]].map(([l, v]) => (
                  <Box key={String(l)} sx={{ display: 'flex', py: 0.5 }}>
                    <Typography sx={{ fontSize: 13, fontWeight: 600, color: (theme) => theme.palette.text.secondary, width: 60 }}>{l}</Typography>
                    <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.primary }}>{v}</Typography>
                  </Box>
                ))}
              </Box>
            </Grid>

            {/* Payment Information */}
            <Grid item xs={12} md={6}>
              <Box sx={{ border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', p: 3 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.07em', mb: 1 }}>Payment Information</Typography>
                <Typography sx={{ fontSize: 24, fontWeight: 700, fontFamily: 'monospace', color: '#16A34A', mb: 1 }}>${Number(request.amount).toFixed(2)}</Typography>
                {[['Week Starting', new Date(request.weekStartDate).toLocaleDateString()], ['Hours', `${request.totalHours}h`], ['Courses', request.coursesTaught]].map(([l, v]) => (
                  <Box key={String(l)} sx={{ display: 'flex', py: 0.25 }}>
                    <Typography sx={{ fontSize: 13, fontWeight: 600, color: (theme) => theme.palette.text.secondary, width: 100 }}>{l}</Typography>
                    <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.primary }}>{v}</Typography>
                  </Box>
                ))}
              </Box>
            </Grid>

            {/* Payment Breakdown */}
            <Grid item xs={12} md={6}>
              <Box sx={{ border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', p: 3 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.07em', mb: 1 }}>Payment Breakdown</Typography>
                {[
                  ['Hourly Rate', `$${request.hourlyRate}/hr`],
                  ['Course Bonus', `$${request.courseBonus}/course`],
                  ['Base Amount', `$${Number(request.baseAmount).toFixed(2)}`],
                  ['Bonus Amount', `$${Number(request.bonusAmount).toFixed(2)}`],
                  ['Pay Tier', request.tierName],
                ].map(([l, v]) => (
                  <Box key={String(l)} sx={{ display: 'flex', py: 0.25 }}>
                    <Typography sx={{ fontSize: 13, fontWeight: 600, color: (theme) => theme.palette.text.secondary, width: 110 }}>{l}</Typography>
                    <Typography sx={{ fontSize: 13, fontFamily: 'monospace', color: (theme) => theme.palette.text.primary }}>{v}</Typography>
                  </Box>
                ))}
              </Box>
            </Grid>

            {/* Accountant Notes */}
            <Grid item xs={12} md={6}>
              <Box sx={{ border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', p: 3, bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(245, 158, 11, 0.1)' : '#FFFBEB' }}>
                <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.mode === 'dark' ? '#FBBF24' : '#92400E', textTransform: 'uppercase', letterSpacing: '0.07em', mb: 1 }}>Accountant Notes</Typography>
                <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.primary, p: 1, bgcolor: (theme) => theme.palette.background.paper, borderRadius: '6px' }}>{request.notes || 'No notes provided'}</Typography>
              </Box>
            </Grid>

            {/* HR Decision */}
            <Grid item xs={12}>
              <Box sx={{ border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', p: 3, bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(37, 99, 235, 0.1)' : '#F0F9FF' }}>
                <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.mode === 'dark' ? '#60A5FA' : '#1E40AF', textTransform: 'uppercase', letterSpacing: '0.07em', mb: 2 }}>HR Decision Required</Typography>
                <Grid container spacing={2}>
                  <Grid item xs={12} md={6}>
                    <FormControl fullWidth>
                      <InputLabel>Action</InputLabel>
                      <Select value={action} onChange={(e: SelectChangeEvent) => setAction(e.target.value as 'override_approve' | 'final_reject')} label="Action">
                        <MenuItem value="override_approve">Override & Approve</MenuItem>
                        <MenuItem value="final_reject">Final Rejection</MenuItem>
                      </Select>
                    </FormControl>
                  </Grid>
                  <Grid item xs={12}>
                    <TextField fullWidth multiline rows={4} label="HR Decision Notes (Required)" value={notes} onChange={(e) => setNotes(e.target.value)}
                      placeholder={action === 'override_approve' ? "Explain why you are overriding the accountant's decision..." : 'Explain why you are confirming the final rejection...'} required />
                  </Grid>
                </Grid>
              </Box>
            </Grid>
          </Grid>
        </Box>
      </DialogContent>
      <DialogActions sx={{ p: 2 }}>
        <GhostButton onClick={handleClose} disabled={processing}>Cancel</GhostButton>
        <PrimaryButton onClick={handleProcessRequest} disabled={processing || !notes.trim()}>
          {processing ? 'Processing...' : action === 'override_approve' ? 'Override & Approve' : 'Final Rejection'}
        </PrimaryButton>
      </DialogActions>
    </Dialog>
  );
};

const ReturnedPaymentRequests: React.FC = () => {
  const [requests, setRequests] = useState<ReturnedPaymentRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedRequest, setSelectedRequest] = useState<ReturnedPaymentRequest | null>(null);
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [pagination, setPagination] = useState({ page: 1, limit: 10, total: 0, pages: 0 });

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await hrService.getReturnedPaymentRequests({ page: pagination.page, limit: pagination.limit }) as {
        requests: ReturnedPaymentRequest[];
        pagination: { page: number; limit: number; total: number; pages: number };
      };
      setRequests(data.requests);
      setPagination(data.pagination);
    } catch {
      setError('Failed to load returned payment requests');
    } finally {
      setLoading(false);
    }
  }, [pagination.page, pagination.limit]);

  // Data fetch on mount / whenever the page changes — the standard fetch-on-mount
  // pattern, not state derived from render.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadData(); }, [loadData]);

  if (loading && requests.length === 0) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400 }}><CircularProgress size={48} /></Box>;
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>Review payment requests returned by accounting for HR decision</Typography>
        <GhostButton onClick={loadData} disabled={loading}>Refresh</GhostButton>
      </Box>

      {/* Stats */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' }, gap: '16px' }}>
        <StatCard label="Returned Requests" value={requests.length} sub="Awaiting HR review" dotColor="#ED6C02" />
      </Box>

      {/* Table */}
      <Box sx={{ border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', bgcolor: (theme) => theme.palette.background.paper, p: 3 }}>
        {requests.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 4 }}>
            <Typography sx={{ fontSize: 16, fontWeight: 600, color: (theme) => theme.palette.text.secondary }}>No Returned Payment Requests</Typography>
            <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary, mt: 0.5 }}>All payment requests have been processed or are still pending</Typography>
          </Box>
        ) : (
          <>
            <DataTable columns={requestColumns} shownCount={requests.length} totalCount={pagination.total}>
              {requests.map((request) => (
                <DataTableRow key={request.id} columns={requestColumns}>
                  <Typography sx={{ fontSize: 13, fontFamily: 'monospace', color: (theme) => theme.palette.text.secondary }}>{request.id}</Typography>
                  <Box>
                    <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: (theme) => theme.palette.text.primary }}>{request.instructorName}</Typography>
                    <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.text.secondary }}>ID: {request.instructorId}</Typography>
                  </Box>
                  <Typography sx={{ fontSize: 13, fontWeight: 600, fontFamily: 'monospace', color: (theme) => theme.palette.text.primary, textAlign: 'right' }}>${Number(request.amount).toFixed(2)}</Typography>
                  <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{new Date(request.weekStartDate).toLocaleDateString()}</Typography>
                  <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{request.totalHours}h / {request.coursesTaught} courses</Typography>
                  <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{new Date(request.updatedAt).toLocaleDateString()}</Typography>
                  <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <ButtonBase onClick={() => { setSelectedRequest(request); setDetailDialogOpen(true); }} sx={{ fontSize: 12, fontWeight: 600, color: '#CC1F1F', '&:hover': { textDecoration: 'underline' }, '&:focus-visible': { outline: '2px solid #CC1F1F', outlineOffset: '2px' } }}>Review</ButtonBase>
                  </Box>
                </DataTableRow>
              ))}
            </DataTable>

            {pagination.pages > 1 && (
              <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
                <Pagination count={pagination.pages} page={pagination.page} onChange={(_, p) => setPagination({ ...pagination, page: p })} />
              </Box>
            )}
          </>
        )}
      </Box>

      <ReturnedPaymentRequestDetailDialog open={detailDialogOpen} request={selectedRequest} onClose={() => setDetailDialogOpen(false)} onActionSuccess={loadData} />
    </Box>
  );
};

export default ReturnedPaymentRequests;
