import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  TextField,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Alert,
  CircularProgress,
  Pagination
} from '@mui/material';
import { paymentRequestService, PaymentRequest, PaymentRequestStats, PaymentRequestFilters } from '../../services/paymentRequestService';
import StatCard from '../gtacpr/StatCard';
import StatusChip from '../gtacpr/StatusChip';
import DataTable, { DataTableRow } from '../gtacpr/DataTable';
import { PrimaryButton, GhostButton } from '../gtacpr/Buttons';
import LinkButton from '../gtacpr/LinkButton';
import { useSnackbar } from '../../contexts/SnackbarContext';
import { formatCurrency, formatCurrencyOrDash, formatDisplayDate } from '../../utils/formatters';

/* ── helpers ─────────────────────────────────────────────────── */

const statusToChipKind = (status: string): 'success' | 'active' | 'warning' | 'danger' | 'neutral' | 'pending' | 'brand' => {
  switch (status) {
    case 'pending': return 'warning';
    case 'approved': return 'success';
    case 'returned_to_hr': return 'active';
    case 'rejected': return 'danger';
    case 'completed': return 'active';
    default: return 'neutral';
  }
};

const sectionHeader = {
  fontSize: 13,
  fontWeight: 700,
  color: (theme: any) => theme.palette.text.secondary,
  textTransform: 'uppercase' as const,
  letterSpacing: '0.07em',
  mb: 1.5,
};

const detailSection = {
  p: 2,
  bgcolor: (theme: any) => theme.palette.background.default,
  borderRadius: '8px',
  border: (theme: any) => `1px solid ${theme.palette.divider}`,
};

const labelValue = (label: string, value: React.ReactNode) => (
  <Box sx={{ mb: 0.75 }}>
    <Typography component="span" sx={{ fontSize: 13, fontWeight: 600, color: (theme) => theme.palette.text.secondary }}>
      {label}:{' '}
    </Typography>
    <Typography component="span" sx={{ fontSize: 13, color: (theme) => theme.palette.text.primary }}>
      {value}
    </Typography>
  </Box>
);

/* ── Detail Dialog ───────────────────────────────────────────── */

interface PaymentRequestDetailDialogProps {
  open: boolean;
  request: PaymentRequest | null;
  onClose: () => void;
  onActionSuccess?: () => void;
}

const PaymentRequestDetailDialog: React.FC<PaymentRequestDetailDialogProps> = ({
  open,
  request,
  onClose,
  onActionSuccess
}) => {
  const [action, setAction] = useState<'approve' | 'return_to_hr'>('approve');
  const [paymentMethod, setPaymentMethod] = useState('direct_deposit');
  const [notes, setNotes] = useState('');
  const [processing, setProcessing] = useState(false);
  const { showSuccess, showError } = useSnackbar();

  const handleClose = () => {
    onClose();
    setAction('approve');
    setPaymentMethod('direct_deposit');
    setNotes('');
    setProcessing(false);
  };

  const handleProcessPayment = async () => {
    if (!request) return;

    if (action === 'return_to_hr' && !notes.trim()) {
      showError('Notes are required when returning to HR.');
      return;
    }

    setProcessing(true);
    try {
      await paymentRequestService.processPaymentRequest(request.id, {
        action,
        payment_method: action === 'approve' ? paymentMethod : undefined,
        notes: notes.trim()
      });

      showSuccess(action === 'approve' ? 'Payment request approved' : 'Payment request returned to HR');
      if (onActionSuccess) {
        onActionSuccess();
      }
      handleClose();
    } catch (error: unknown) {
      console.error('Error processing payment request:', error);
      showError('Failed to process payment request. Please try again.');
    } finally {
      setProcessing(false);
    }
  };

  if (!request) return null;

  // Never invent pay rates: show what HR sent, or a dash.
  const baseAmount: number | undefined =
    request.baseAmount ??
    (request.totalHours != null && request.hourlyRate != null ? request.totalHours * request.hourlyRate : undefined);
  const bonusAmount: number | undefined =
    request.bonusAmount ??
    (request.coursesTaught != null && request.courseBonus != null ? request.coursesTaught * request.courseBonus : undefined);
  const totalAmount: number | undefined =
    request.amount ?? (baseAmount != null && bonusAmount != null ? baseAmount + bonusAmount : undefined);
  const mono = { fontFamily: 'monospace' } as const;

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="lg" fullWidth>
      <DialogTitle sx={{ pb: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography sx={{ fontSize: 18, fontWeight: 700, color: (theme) => theme.palette.text.primary }}>
            Payment Request Details
          </Typography>
          <StatusChip
            kind={statusToChipKind(request.status)}
            label={request.status.toUpperCase()}
          />
        </Box>
      </DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '16px', mt: 1 }}>

          {/* Row: Instructor + Payment */}
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
            <Box sx={detailSection}>
              <Typography sx={sectionHeader}>Instructor Information</Typography>
              {labelValue('Name', request.instructorName)}
              {labelValue('Email', request.instructorEmail)}
              {labelValue('ID', request.instructorId)}
            </Box>

            <Box sx={detailSection}>
              <Typography sx={sectionHeader}>Payment Information</Typography>
              <Typography sx={{ fontSize: 22, fontWeight: 700, color: '#16A34A', fontFamily: 'monospace', mb: 0.5 }}>
                {formatCurrencyOrDash(totalAmount)}
              </Typography>
              {labelValue('Payment Date', formatDisplayDate(request.paymentDate))}
              {labelValue('Payment Method', request.paymentMethod?.replace('_', ' ').toUpperCase())}
            </Box>
          </Box>

          {/* Row: Timesheet + Breakdown */}
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
            <Box sx={detailSection}>
              <Typography sx={sectionHeader}>Timesheet Information</Typography>
              {labelValue('Week Starting', formatDisplayDate(request.weekStartDate))}
              {labelValue('Total Hours', request.totalHours != null ? `${request.totalHours} hours` : '—')}
              {labelValue('Courses Taught', request.coursesTaught != null ? `${request.coursesTaught} courses` : '—')}
              {request.timesheetComment && labelValue('HR Comment', request.timesheetComment)}
            </Box>

            <Box sx={detailSection}>
              <Typography sx={sectionHeader}>Payment Breakdown</Typography>
              {labelValue('Hourly Rate', <Box component="span" sx={mono}>{request.hourlyRate != null ? `${formatCurrency(request.hourlyRate)}/hr` : '—'}</Box>)}
              {labelValue('Course Bonus', <Box component="span" sx={mono}>{request.courseBonus != null ? `${formatCurrency(request.courseBonus)}/course` : '—'}</Box>)}
              {labelValue('Base Amount', <Box component="span" sx={mono}>
                {formatCurrencyOrDash(baseAmount)}
                {request.totalHours != null && request.hourlyRate != null ? ` (${request.totalHours}h x ${formatCurrency(request.hourlyRate)})` : ''}
              </Box>)}
              {labelValue('Bonus Amount', <Box component="span" sx={mono}>
                {formatCurrencyOrDash(bonusAmount)}
                {request.coursesTaught != null && request.courseBonus != null ? ` (${request.coursesTaught} courses x ${formatCurrency(request.courseBonus)})` : ''}
              </Box>)}
              <Typography sx={{ fontSize: 16, fontWeight: 700, color: '#16A34A', fontFamily: 'monospace', mt: 1 }}>
                Total: {formatCurrencyOrDash(totalAmount)}
              </Typography>
              {request.tierName && labelValue('Pay Tier', request.tierName)}
            </Box>
          </Box>

          {/* Classes Covered */}
          {request.classDetails && request.classDetails.length > 0 && (
            <Box sx={detailSection}>
              <Typography sx={sectionHeader}>Classes Covered</Typography>
              <Box sx={{ maxHeight: 200, overflow: 'auto' }}>
                {request.classDetails.map((classDetail, index) => (
                  <Box key={index} sx={{ mb: 1, p: 1.5, bgcolor: (theme) => theme.palette.background.paper, borderRadius: '6px', border: (theme) => `1px solid ${theme.palette.divider}` }}>
                    <Typography sx={{ fontSize: 13, fontWeight: 600, color: (theme) => theme.palette.text.primary }}>
                      {classDetail.course_name}
                    </Typography>
                    <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.text.secondary }}>
                      Hours: {classDetail.hours} | Date: {formatDisplayDate(classDetail.date)}
                      {classDetail.location && ` | Location: ${classDetail.location}`}
                    </Typography>
                  </Box>
                ))}
              </Box>
            </Box>
          )}

          {/* Request Information */}
          <Box sx={detailSection}>
            <Typography sx={sectionHeader}>Request Information</Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
              <Box>
                {labelValue('Created', new Date(request.createdAt).toLocaleString())}
                {labelValue('Updated', new Date(request.updatedAt).toLocaleString())}
              </Box>
              <Box>
                {labelValue('Timesheet ID', request.timesheetId)}
                {labelValue('Request ID', request.id)}
              </Box>
            </Box>
            {request.notes && (
              <Box sx={{ mt: 1 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 600, color: (theme) => theme.palette.text.secondary, mb: 0.5 }}>Notes:</Typography>
                <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.primary, bgcolor: (theme) => theme.palette.background.paper, p: 1.5, borderRadius: '6px', border: (theme) => `1px solid ${theme.palette.divider}` }}>
                  {request.notes}
                </Typography>
              </Box>
            )}
          </Box>

          {/* Process Payment -- only for pending */}
          {request.status === 'pending' && (
            <Box sx={{ ...detailSection, bgcolor: (theme) => theme.palette.background.default }}>
              <Typography sx={sectionHeader}>Process Payment Request</Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: action === 'approve' ? '1fr 1fr' : '1fr', gap: 2, mb: 2 }}>
                <FormControl fullWidth size="small">
                  <InputLabel>Action</InputLabel>
                  <Select
                    value={action}
                    onChange={(e) => setAction(e.target.value as 'approve' | 'return_to_hr')}
                    label="Action"
                  >
                    <MenuItem value="approve">Approve Payment</MenuItem>
                    <MenuItem value="return_to_hr">Return to HR</MenuItem>
                  </Select>
                </FormControl>
                {action === 'approve' && (
                  <FormControl fullWidth size="small">
                    <InputLabel>Payment Method</InputLabel>
                    <Select
                      value={paymentMethod}
                      onChange={(e) => setPaymentMethod(e.target.value)}
                      label="Payment Method"
                    >
                      <MenuItem value="direct_deposit">Direct Deposit</MenuItem>
                      <MenuItem value="bank_transfer">Bank Transfer</MenuItem>
                      <MenuItem value="check">Check</MenuItem>
                      <MenuItem value="cash">Cash</MenuItem>
                      <MenuItem value="credit_card">Credit Card</MenuItem>
                      <MenuItem value="other">Other</MenuItem>
                    </Select>
                  </FormControl>
                )}
              </Box>
              <TextField
                fullWidth
                multiline
                rows={3}
                size="small"
                label={action === 'approve' ? 'Notes (Optional)' : 'Notes (Required)'}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={
                  action === 'approve'
                    ? 'Add optional notes about this approval...'
                    : 'Required: Explain why this payment request is being returned to HR...'
                }
                required={action === 'return_to_hr'}
              />
            </Box>
          )}
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <GhostButton onClick={handleClose} disabled={processing}>
          Cancel
        </GhostButton>
        {request.status === 'pending' && (
          <PrimaryButton
            onClick={handleProcessPayment}
            disabled={processing || (action === 'return_to_hr' && !notes.trim())}
            sx={action === 'approve'
              ? { bgcolor: '#16A34A', '&:hover': { bgcolor: '#15803D' } }
              : { bgcolor: '#ED6C02', '&:hover': { bgcolor: '#C55A02' } }
            }
          >
            {processing
              ? <><CircularProgress size={16} sx={{ color: '#fff', mr: 1 }} /> Processing...</>
              : action === 'approve'
                ? 'Approve Payment'
                : 'Return to HR'
            }
          </PrimaryButton>
        )}
      </DialogActions>
    </Dialog>
  );
};

/* ── Table columns ───────────────────────────────────────────── */

const columns = [
  { key: 'id',         label: 'ID',            width: '0.5fr' },
  { key: 'instructor', label: 'Instructor',    width: '1.4fr' },
  { key: 'amount',     label: 'Amount',        width: '0.8fr', align: 'right' as const },
  { key: 'week',       label: 'Week Starting', width: '0.9fr' },
  { key: 'hours',      label: 'Hours / Courses', width: '0.9fr' },
  { key: 'status',     label: 'Status',        width: '0.8fr' },
  { key: 'created',    label: 'Created',       width: '0.8fr' },
  { key: 'actions',    label: 'Actions',       width: '0.5fr', align: 'center' as const },
];

/* ── Main Dashboard ──────────────────────────────────────────── */

const PaymentRequestsDashboard: React.FC = () => {
  const [requests, setRequests] = useState<PaymentRequest[]>([]);
  const [stats, setStats] = useState<PaymentRequestStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedRequest, setSelectedRequest] = useState<PaymentRequest | null>(null);
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);

  const [filters, setFilters] = useState<PaymentRequestFilters>({
    page: 1,
    limit: 10,
    status: '',
    instructor_id: undefined
  });

  const [pagination, setPagination] = useState({
    page: 1,
    limit: 10,
    total: 0,
    pages: 0
  });

  const loadData = async () => {
    setLoading(true);
    setError(null);

    try {
      const [statsData, requestsData] = await Promise.all([
        paymentRequestService.getStats(),
        paymentRequestService.getPaymentRequests(filters)
      ]);

      setStats(statsData);
      setRequests(requestsData.requests);
      setPagination(requestsData.pagination);
    } catch (err: any) {
      setError('Failed to load payment requests data');
      console.error('Error loading payment requests:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [filters]);

  /* ── Loading state ── */
  if (loading && !stats) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
        <CircularProgress size={24} />
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

      {/* Page Header */}
      <Box>
        <Typography sx={{ fontSize: 22, fontWeight: 700, color: (theme) => theme.palette.text.primary, mb: 0.5 }}>
          Instructor Payment Requests
        </Typography>
        <Typography sx={{ fontSize: 14, color: (theme) => theme.palette.text.secondary }}>
          Review and process payment requests from HR for instructor compensation
        </Typography>
      </Box>

      {error && (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Statistics Cards */}
      {stats && (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' }, gap: 2 }}>
          <StatCard
            label="Pending Requests"
            value={stats.pending.count}
            dotColor="#ED6C02"
          />
          <StatCard
            label="Approved This Month"
            value={stats.approvedThisMonth.count}
            dotColor="#16A34A"
          />
          <StatCard
            label="Average Request"
            value={`$${stats.pending.amount > 0 ? (Number(stats.pending.amount) / stats.pending.count).toFixed(2) : '0.00'}`}
            dotColor="#4B5563"
          />
          <StatCard
            label="Rejected This Month"
            value={stats.rejectedThisMonth}
            dotColor="#CC1F1F"
          />
        </Box>
      )}

      {/* Filters */}
      <Box sx={{ border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', bgcolor: (theme) => theme.palette.background.paper, p: 3 }}>
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 2, alignItems: 'end' }}>
          <FormControl fullWidth size="small">
            <InputLabel>Status</InputLabel>
            <Select
              value={filters.status}
              onChange={(e) => setFilters({ ...filters, status: e.target.value, page: 1 })}
              label="Status"
            >
              <MenuItem value="">All Statuses</MenuItem>
              <MenuItem value="pending">Pending</MenuItem>
              <MenuItem value="approved">Approved</MenuItem>
              <MenuItem value="returned_to_hr">Returned to HR</MenuItem>
              <MenuItem value="rejected">Rejected</MenuItem>
              <MenuItem value="completed">Completed</MenuItem>
            </Select>
          </FormControl>

          <TextField
            fullWidth
            size="small"
            label="Instructor ID"
            type="number"
            value={filters.instructor_id || ''}
            onChange={(e) => setFilters({
              ...filters,
              instructor_id: e.target.value ? parseInt(e.target.value) : undefined,
              page: 1
            })}
          />

          <GhostButton onClick={loadData} disabled={loading}>
            Refresh
          </GhostButton>
        </Box>
      </Box>

      {/* Payment Requests Table */}
      <Box sx={{ border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', bgcolor: (theme) => theme.palette.background.paper }}>
        <DataTable columns={columns}>
          {loading && requests.length === 0 ? (
            <Box sx={{ py: 4, display: 'flex', justifyContent: 'center' }} role="status" aria-label="Loading">
              <CircularProgress size={24} />
            </Box>
          ) : requests.length === 0 ? (
            <Box sx={{ py: 4, textAlign: 'center' }}>
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
                No payment requests match the current filters
              </Typography>
            </Box>
          ) : (
          requests.map((request) => (
            <DataTableRow key={request.id} columns={columns}>
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.primary }}>{request.id}</Typography>
              <Box>
                <Typography sx={{ fontSize: 13, fontWeight: 600, color: (theme) => theme.palette.text.primary }}>
                  {request.instructorName}
                </Typography>
                <Typography sx={{ fontSize: 11, color: (theme) => theme.palette.text.secondary }}>
                  ID: {request.instructorId}
                </Typography>
              </Box>
              <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.primary, fontFamily: 'monospace' }}>
                {formatCurrency(request.amount)}
              </Typography>
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.primary }}>{request.weekStartDate}</Typography>
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.primary }}>
                {request.totalHours}h / {request.coursesTaught} courses
              </Typography>
              <StatusChip
                kind={statusToChipKind(request.status)}
                label={request.status.toUpperCase()}
              />
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.primary }}>
                {formatDisplayDate(request.createdAt)}
              </Typography>
              <LinkButton
                aria-label={`View payment request ${request.id}`}
                onClick={() => {
                  setSelectedRequest(request);
                  setDetailDialogOpen(true);
                }}
              >
                View
              </LinkButton>
            </DataTableRow>
          ))
          )}
        </DataTable>

        {/* Pagination */}
        {pagination.pages > 1 && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
            <Pagination
              count={pagination.pages}
              page={pagination.page}
              onChange={(_, page) => setFilters({ ...filters, page })}
              color="primary"
            />
          </Box>
        )}
      </Box>

      {/* Detail Dialog */}
      <PaymentRequestDetailDialog
        open={detailDialogOpen}
        request={selectedRequest}
        onClose={() => setDetailDialogOpen(false)}
        onActionSuccess={loadData}
      />
    </Box>
  );
};

export default PaymentRequestsDashboard;
