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
  SelectChangeEvent,
  MenuItem,
  Pagination,
  Alert,
  CircularProgress,
  Tabs,
  Tab,
  Grid,
  ButtonBase,
} from '@mui/material';
import { payrollService, PayrollPayment, PayrollStats, PayrollFilters, PayrollCalculation } from '../../services/payrollService';
import StatCard from '../gtacpr/StatCard';
import StatusChip from '../gtacpr/StatusChip';
import DataTable, { DataTableRow } from '../gtacpr/DataTable';
import { PrimaryButton, GhostButton } from '../gtacpr/Buttons';

const getStatusKind = (status: string) => {
  switch (status) {
    case 'completed': return 'success' as const;
    case 'rejected': return 'danger' as const;
    case 'pending': return 'warning' as const;
    default: return 'neutral' as const;
  }
};

const paymentColumns = [
  { key: 'instructor', label: 'INSTRUCTOR', width: '1.3fr' },
  { key: 'amount', label: 'AMOUNT', width: '0.7fr', align: 'right' as const },
  { key: 'date', label: 'PAYMENT DATE', width: '0.8fr' },
  { key: 'method', label: 'METHOD', width: '0.7fr' },
  { key: 'status', label: 'STATUS', width: '0.7fr' },
  { key: 'created', label: 'CREATED', width: '0.8fr' },
  { key: 'actions', label: '', width: '0.4fr', align: 'right' as const },
];

// Payment Details Dialog
const PaymentDetailsDialog: React.FC<{
  open: boolean;
  payment: PayrollPayment | null;
  onClose: () => void;
  onProcess: (paymentId: number, action: 'approve' | 'reject', transactionId?: string, notes?: string) => void;
}> = ({ open, payment, onClose, onProcess }) => {
  const [action, setAction] = useState<'approve' | 'reject'>('approve');
  const [transactionId, setTransactionId] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!payment) return;
    setLoading(true);
    try {
      await onProcess(payment.id, action, transactionId || undefined, notes || undefined);
      onClose();
      setTransactionId(''); setNotes(''); setAction('approve');
    } finally { setLoading(false); }
  };

  const handleClose = () => { onClose(); setTransactionId(''); setNotes(''); setAction('approve'); };

  if (!payment) return null;

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ fontSize: 18, fontWeight: 700, color: (theme) => theme.palette.text.primary }}>Payment Details — {payment.instructorName}</DialogTitle>
      <DialogContent>
        <Box sx={{ pt: 1 }}>
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, mb: 2 }}>
            {[
              ['Instructor', `${payment.instructorName} (${payment.instructorEmail})`],
              ['Payment Date', new Date(payment.paymentDate).toLocaleDateString()],
              ['Amount', `$${Number(payment.amount || 0).toFixed(2)}`],
              ['Payment Method', payment.paymentMethod],
              ['Notes', payment.notes || 'No notes provided'],
            ].map(([label, value]) => (
              <Box key={String(label)}>
                <Typography sx={{ fontSize: 12, fontWeight: 600, color: (theme) => theme.palette.text.secondary }}>{label}</Typography>
                <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.primary }}>{value}</Typography>
              </Box>
            ))}
            <Box>
              <Typography sx={{ fontSize: 12, fontWeight: 600, color: (theme) => theme.palette.text.secondary }}>Status</Typography>
              <StatusChip kind={getStatusKind(payment.status)} label={payment.status.toUpperCase()} />
            </Box>
          </Box>
          {payment.transactionId && (
            <Box sx={{ mb: 1 }}><Typography sx={{ fontSize: 12, fontWeight: 600, color: (theme) => theme.palette.text.secondary }}>Transaction ID</Typography><Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.primary }}>{payment.transactionId}</Typography></Box>
          )}
          {payment.hrNotes && (
            <Box sx={{ mb: 1 }}><Typography sx={{ fontSize: 12, fontWeight: 600, color: (theme) => theme.palette.text.secondary }}>HR Notes</Typography><Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.primary }}>{payment.hrNotes}</Typography></Box>
          )}
          {payment.status === 'pending' && (
            <Box sx={{ mt: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <FormControl fullWidth>
                <InputLabel>Action</InputLabel>
                <Select value={action} onChange={(e: SelectChangeEvent) => setAction(e.target.value as 'approve' | 'reject')} label="Action">
                  <MenuItem value="approve">Approve</MenuItem>
                  <MenuItem value="reject">Reject</MenuItem>
                </Select>
              </FormControl>
              <TextField fullWidth label="Transaction ID (Optional)" value={transactionId} onChange={(e) => setTransactionId(e.target.value)} />
              <TextField fullWidth multiline rows={3} label="Notes (Optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Box>
          )}
        </Box>
      </DialogContent>
      <DialogActions sx={{ p: 2 }}>
        <GhostButton onClick={handleClose}>Cancel</GhostButton>
        {payment.status === 'pending' && (
          <PrimaryButton onClick={handleSubmit} disabled={loading}>
            {loading ? 'Processing...' : action === 'approve' ? 'Approve' : 'Reject'}
          </PrimaryButton>
        )}
      </DialogActions>
    </Dialog>
  );
};

// Calculate Payroll Dialog
const CalculatePayrollDialog: React.FC<{
  open: boolean;
  onClose: () => void;
  onCalculate: (instructorId: number, startDate: string, endDate: string, hourlyRate: number) => void;
}> = ({ open, onClose, onCalculate }) => {
  const [instructorId, setInstructorId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [hourlyRate, setHourlyRate] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!instructorId || !startDate || !endDate || !hourlyRate) return;
    setLoading(true);
    try {
      await onCalculate(parseInt(instructorId), startDate, endDate, parseFloat(hourlyRate));
      onClose();
      setInstructorId(''); setStartDate(''); setEndDate(''); setHourlyRate('');
    } finally { setLoading(false); }
  };

  const handleClose = () => { onClose(); setInstructorId(''); setStartDate(''); setEndDate(''); setHourlyRate(''); };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontSize: 18, fontWeight: 700, color: (theme) => theme.palette.text.primary }}>Calculate Payroll</DialogTitle>
      <DialogContent>
        <Grid container spacing={2} sx={{ mt: 0.5 }}>
          <Grid item xs={12}><TextField fullWidth label="Instructor ID" type="number" value={instructorId} onChange={(e) => setInstructorId(e.target.value)} required /></Grid>
          <Grid item xs={6}><TextField fullWidth label="Start Date" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} InputLabelProps={{ shrink: true }} required /></Grid>
          <Grid item xs={6}><TextField fullWidth label="End Date" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} InputLabelProps={{ shrink: true }} required /></Grid>
          <Grid item xs={12}><TextField fullWidth label="Hourly Rate ($)" type="number" value={hourlyRate} onChange={(e) => setHourlyRate(e.target.value)} inputProps={{ min: 0, step: 0.01 }} required /></Grid>
        </Grid>
      </DialogContent>
      <DialogActions sx={{ p: 2 }}>
        <GhostButton onClick={handleClose}>Cancel</GhostButton>
        <PrimaryButton onClick={handleSubmit} disabled={loading || !instructorId || !startDate || !endDate || !hourlyRate}>
          {loading ? 'Calculating...' : 'Calculate'}
        </PrimaryButton>
      </DialogActions>
    </Dialog>
  );
};

const PayrollManagement: React.FC = () => {
  const [payments, setPayments] = useState<PayrollPayment[]>([]);
  const [stats, setStats] = useState<PayrollStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPayment, setSelectedPayment] = useState<PayrollPayment | null>(null);
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);
  const [calculateDialogOpen, setCalculateDialogOpen] = useState(false);
  const [calculation, setCalculation] = useState<PayrollCalculation | null>(null);
  const [filters, setFilters] = useState<PayrollFilters>({ page: 1, limit: 10 });
  const [pagination, setPagination] = useState({ page: 1, limit: 10, total: 0, pages: 0 });
  const [activeTab, setActiveTab] = useState(0);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [paymentsData, statsData] = await Promise.all([payrollService.getPayments(filters), payrollService.getStats()]);
      setPayments(paymentsData.payments);
      setPagination(paymentsData.pagination);
      setStats(statsData);
    } catch {
      setError('Failed to load payroll data');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  // Data fetch on mount / whenever `filters` changes — the standard fetch-on-mount
  // pattern, not state derived from render.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadData(); }, [loadData]);

  const handleProcessPayment = async (paymentId: number, action: 'approve' | 'reject', transactionId?: string, notes?: string) => {
    await payrollService.processPayment(paymentId, { action, transaction_id: transactionId, notes });
    await loadData();
  };

  const handleCalculatePayroll = async (instructorId: number, startDate: string, endDate: string, hourlyRate: number) => {
    const result = await payrollService.calculatePayroll(instructorId, startDate, endDate, hourlyRate);
    setCalculation(result);
    setActiveTab(1);
  };

  if (loading && payments.length === 0) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400 }}><CircularProgress size={48} /></Box>;
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

      {/* Stats */}
      {stats && stats.totalPayrollThisMonth !== undefined && (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' }, gap: '16px' }}>
          <StatCard label="Total Payroll" value={`$${Number(stats.totalPayrollThisMonth || 0).toFixed(2)}`} sub="This month" dotColor="#CC1F1F" />
          <StatCard label="Pending Payments" value={stats.pendingPayments} sub="Awaiting processing" dotColor="#ED6C02" />
          <StatCard label="Instructors Pending" value={stats.instructorsWithPending} sub="With pending payments" dotColor="#4B5563" />
          <StatCard label="Avg Payment" value={`$${Number(stats.averagePayment || 0).toFixed(2)}`} sub="Per instructor" dotColor="#16A34A" />
        </Box>
      )}

      {/* Actions */}
      <Box sx={{ display: 'flex', gap: 1 }}>
        <PrimaryButton onClick={() => setCalculateDialogOpen(true)}>Calculate Payroll</PrimaryButton>
        <GhostButton onClick={loadData} disabled={loading}>Refresh</GhostButton>
      </Box>

      {/* Tabs */}
      <Box sx={{ border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', bgcolor: (theme) => theme.palette.background.paper }}>
        <Box sx={{ borderBottom: 1, borderColor: (theme) => theme.palette.divider, px: 3, pt: 1 }}>
          <Tabs value={activeTab} onChange={(_, v) => setActiveTab(v)} sx={{
            '& .MuiTab-root': { textTransform: 'none', fontSize: 13, fontWeight: 600, color: (theme) => theme.palette.text.secondary, minHeight: 42 },
            '& .Mui-selected': { color: '#CC1F1F !important' },
            '& .MuiTabs-indicator': { backgroundColor: '#CC1F1F' },
          }}>
            <Tab label="Payments" />
            <Tab label="Calculation" />
          </Tabs>
        </Box>

        {/* Payments Tab */}
        {activeTab === 0 && (
          <Box sx={{ p: 3 }}>
            {/* Filters */}
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' }, gap: 2, mb: 2 }}>
              <FormControl fullWidth size="small">
                <InputLabel>Status</InputLabel>
                <Select value={filters.status || ''} onChange={(e) => setFilters(prev => ({ ...prev, status: e.target.value, page: 1 }))} label="Status">
                  <MenuItem value="">All</MenuItem>
                  <MenuItem value="pending">Pending</MenuItem>
                  <MenuItem value="completed">Completed</MenuItem>
                  <MenuItem value="rejected">Rejected</MenuItem>
                </Select>
              </FormControl>
              <TextField fullWidth size="small" label="Instructor ID" value={filters.instructor_id || ''} onChange={(e) => setFilters(prev => ({ ...prev, instructor_id: e.target.value, page: 1 }))} />
              <TextField fullWidth size="small" label="Month" type="number" value={filters.month || ''} onChange={(e) => setFilters(prev => ({ ...prev, month: e.target.value, page: 1 }))} inputProps={{ min: 1, max: 12 }} />
            </Box>

            <DataTable columns={paymentColumns} shownCount={payments.length} totalCount={pagination.total}>
              {payments.map((payment) => (
                <DataTableRow key={payment.id} columns={paymentColumns}>
                  <Box>
                    <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: (theme) => theme.palette.text.primary }}>{payment.instructorName}</Typography>
                    <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.text.secondary }}>{payment.instructorEmail}</Typography>
                  </Box>
                  <Typography sx={{ fontSize: 13, fontWeight: 600, fontFamily: 'monospace', color: (theme) => theme.palette.text.primary, textAlign: 'right' }}>${Number(payment.amount || 0).toFixed(2)}</Typography>
                  <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{new Date(payment.paymentDate).toLocaleDateString()}</Typography>
                  <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{payment.paymentMethod}</Typography>
                  <StatusChip kind={getStatusKind(payment.status)} label={payment.status.toUpperCase()} />
                  <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{new Date(payment.createdAt).toLocaleDateString()}</Typography>
                  <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <ButtonBase onClick={() => { setSelectedPayment(payment); setDetailsDialogOpen(true); }} sx={{ fontSize: 12, fontWeight: 600, color: '#CC1F1F', '&:hover': { textDecoration: 'underline' }, '&:focus-visible': { outline: '2px solid #CC1F1F', outlineOffset: '2px' } }}>View</ButtonBase>
                  </Box>
                </DataTableRow>
              ))}
            </DataTable>

            {pagination.pages > 1 && (
              <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
                <Pagination count={pagination.pages} page={pagination.page} onChange={(_, p) => setFilters(prev => ({ ...prev, page: p }))} />
              </Box>
            )}
          </Box>
        )}

        {/* Calculation Tab */}
        {activeTab === 1 && calculation && (
          <Box sx={{ p: 3 }}>
            <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.07em', mb: 2 }}>Payroll Calculation</Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, mb: 3 }}>
              {[
                ['Instructor', `${calculation.instructor.username} (${calculation.instructor.email})`],
                ['Period', `${new Date(calculation.period.startDate).toLocaleDateString()} — ${new Date(calculation.period.endDate).toLocaleDateString()}`],
                ['Timesheets', `${calculation.timesheets.count} timesheets, ${calculation.timesheets.totalHours} hours, ${calculation.timesheets.totalCourses} courses`],
                ['Rates', `$${calculation.rates.hourlyRate}/hr + $${calculation.rates.courseBonus}/course`],
              ].map(([label, value]) => (
                <Box key={String(label)}>
                  <Typography sx={{ fontSize: 12, fontWeight: 600, color: (theme) => theme.palette.text.secondary }}>{label}</Typography>
                  <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.primary }}>{value}</Typography>
                </Box>
              ))}
            </Box>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' }, gap: '16px' }}>
              <StatCard label="Base Amount" value={`$${Number(calculation.calculation.baseAmount || 0).toFixed(2)}`} sub="Hours x Rate" dotColor="#4B5563" />
              <StatCard label="Course Bonus" value={`$${Number(calculation.calculation.courseBonus || 0).toFixed(2)}`} sub="Courses x Bonus" dotColor="#ED6C02" />
              <StatCard label="Total Amount" value={`$${Number(calculation.calculation.totalAmount || 0).toFixed(2)}`} sub="Total payable" dotColor="#CC1F1F" />
            </Box>
          </Box>
        )}
      </Box>

      <PaymentDetailsDialog open={detailsDialogOpen} payment={selectedPayment} onClose={() => setDetailsDialogOpen(false)} onProcess={handleProcessPayment} />
      <CalculatePayrollDialog open={calculateDialogOpen} onClose={() => setCalculateDialogOpen(false)} onCalculate={handleCalculatePayroll} />
    </Box>
  );
};

export default PayrollManagement;
