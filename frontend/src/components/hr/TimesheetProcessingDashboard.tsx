import React, { useState, useEffect, useCallback } from 'react';
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
  Pagination,
} from '@mui/material';
import { timesheetService, Timesheet, TimesheetStats, TimesheetFilters } from '../../services/timesheetService';
import TimesheetNotes from '../shared/TimesheetNotes';
import { format } from 'date-fns';
import StatCard from '../gtacpr/StatCard';
import StatusChip from '../gtacpr/StatusChip';
import DataTable, { DataTableRow } from '../gtacpr/DataTable';
import { PrimaryButton, GhostButton } from '../gtacpr/Buttons';

interface CourseDetail {
  date: string;
  startTime?: string;
  endTime?: string;
  organizationName?: string;
  location?: string;
  courseType: string;
  studentCount?: number;
  status?: string;
}

const getStatusKind = (status: string) => {
  switch (status) {
    case 'pending': return 'warning' as const;
    case 'approved': return 'success' as const;
    case 'rejected': return 'danger' as const;
    default: return 'neutral' as const;
  }
};

const timesheetColumns = [
  { key: 'instructor', label: 'INSTRUCTOR', width: '1.3fr' },
  { key: 'period', label: 'WEEK PERIOD', width: '1.2fr' },
  { key: 'hours', label: 'HOURS', width: '0.5fr', align: 'right' as const },
  { key: 'courses', label: 'COURSES', width: '0.5fr', align: 'right' as const },
  { key: 'status', label: 'STATUS', width: '0.7fr' },
  { key: 'submitted', label: 'SUBMITTED', width: '0.8fr' },
  { key: 'actions', label: '', width: '0.4fr', align: 'right' as const },
];

const courseDetailColumns = [
  { key: 'date', label: 'DATE', width: '1fr' },
  { key: 'time', label: 'TIME', width: '0.8fr' },
  { key: 'org', label: 'ORGANIZATION', width: '1fr' },
  { key: 'location', label: 'LOCATION', width: '0.8fr' },
  { key: 'type', label: 'COURSE TYPE', width: '0.8fr' },
  { key: 'students', label: 'STUDENTS', width: '0.5fr', align: 'right' as const },
  { key: 'status', label: 'STATUS', width: '0.6fr' },
];

const reminderColumns = [
  { key: 'instructor', label: 'INSTRUCTOR', width: '1fr' },
  { key: 'email', label: 'EMAIL', width: '1.2fr' },
  { key: 'courses', label: 'COMPLETED COURSES', width: '0.8fr', align: 'center' as const },
];

const TimesheetProcessingDashboard: React.FC = () => {
  const [stats, setStats] = useState<TimesheetStats | null>(null);
  const [timesheets, setTimesheets] = useState<Timesheet[]>([]);
  const [loading, setLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(true);
  const [selectedTimesheet, setSelectedTimesheet] = useState<Timesheet | null>(null);
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [approvalDialogOpen, setApprovalDialogOpen] = useState(false);
  const [approvalAction, setApprovalAction] = useState<'approve' | 'reject'>('approve');
  const [approvalComment, setApprovalComment] = useState('');
  const [approvalLoading, setApprovalLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pagination, setPagination] = useState({ page: 1, limit: 10, total: 0, pages: 0 });
  const [filters, setFilters] = useState<TimesheetFilters>({ status: '', instructorId: '', month: '' });
  const [reminderDialogOpen, setReminderDialogOpen] = useState(false);
  const [pendingReminders, setPendingReminders] = useState<{
    weekStartDate: string;
    instructorsWithoutTimesheet: Array<{ id: number; username: string; email: string; completed_courses: number }>;
  } | null>(null);
  const [reminderLoading, setReminderLoading] = useState(false);
  const [sendingReminders, setSendingReminders] = useState(false);

  const loadStats = useCallback(async () => {
    try {
      setStatsLoading(true);
      const statsData = await timesheetService.getStats();
      setStats(statsData);
    } catch {
      setError('Failed to load timesheet statistics');
    } finally {
      setStatsLoading(false);
    }
  }, []);

  const loadTimesheets = useCallback(async () => {
    try {
      setLoading(true);
      const response = await timesheetService.getTimesheets({ ...filters, page: pagination.page, limit: pagination.limit });
      setTimesheets(response.timesheets);
      setPagination(prev => ({ ...prev, total: response.pagination.total, pages: response.pagination.pages }));
    } catch {
      setError('Failed to load timesheets');
    } finally {
      setLoading(false);
    }
  }, [filters, pagination.page, pagination.limit]);

  const handleApproval = async () => {
    if (!selectedTimesheet) return;
    try {
      setApprovalLoading(true);
      await timesheetService.approveTimesheet(selectedTimesheet.id, { action: approvalAction, comment: approvalComment });
      setSuccess(`Timesheet ${approvalAction}d successfully`);
      setApprovalDialogOpen(false);
      setSelectedTimesheet(null);
      setApprovalComment('');
      await Promise.all([loadStats(), loadTimesheets()]);
    } catch {
      setError(`Failed to ${approvalAction} timesheet`);
    } finally {
      setApprovalLoading(false);
    }
  };

  const handleFilterChange = (field: keyof TimesheetFilters, value: string) => {
    setFilters(prev => ({ ...prev, [field]: value }));
    setPagination(prev => ({ ...prev, page: 1 }));
  };

  const handleRefresh = async () => {
    setError(null);
    setSuccess(null);
    await Promise.all([loadStats(), loadTimesheets()]);
  };

  const openReminderDialog = async () => {
    setReminderDialogOpen(true);
    try {
      setReminderLoading(true);
      const data = await timesheetService.getPendingReminders();
      setPendingReminders(data);
    } catch {
      setError('Failed to load instructors pending timesheet submission');
    } finally {
      setReminderLoading(false);
    }
  };

  const handleSendReminders = async () => {
    if (!pendingReminders?.instructorsWithoutTimesheet.length) return;
    try {
      setSendingReminders(true);
      const instructorIds = pendingReminders.instructorsWithoutTimesheet.map(i => i.id);
      const result = await timesheetService.sendReminders(instructorIds);
      setSuccess(`Reminders sent to ${result.sentCount} instructor(s)`);
      setReminderDialogOpen(false);
    } catch {
      setError('Failed to send reminders');
    } finally {
      setSendingReminders(false);
    }
  };

  // Data fetch on mount / whenever the relevant filters or callback identity change —
  // the standard fetch-on-mount pattern, not state derived from render.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadStats(); }, [loadStats]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadTimesheets(); }, [loadTimesheets]);
  useEffect(() => {
    if (success) { const t = setTimeout(() => setSuccess(null), 5000); return () => clearTimeout(t); }
    return () => {};
  }, [success]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Header Actions */}
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
        <PrimaryButton onClick={openReminderDialog}>Send Reminders</PrimaryButton>
        <GhostButton onClick={handleRefresh} disabled={loading || statsLoading}>Refresh</GhostButton>
      </Box>

      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      {success && <Alert severity="success" onClose={() => setSuccess(null)}>{success}</Alert>}

      {/* Stats */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' }, gap: '16px' }}>
        <StatCard label="Pending Timesheets" value={statsLoading ? '...' : stats?.pendingTimesheets || 0} sub="Awaiting review" dotColor="#ED6C02" />
        <StatCard label="Approved This Month" value={statsLoading ? '...' : stats?.approvedThisMonth || 0} sub="Processed" dotColor="#16A34A" />
        <StatCard label="Total Hours" value={statsLoading ? '...' : stats?.totalHoursThisMonth || 0} sub="This month" dotColor="#4B5563" />
        <StatCard label="Instructors Pending" value={statsLoading ? '...' : stats?.instructorsWithPending || 0} sub="With submissions" dotColor="#CC1F1F" />
      </Box>

      {/* Filters */}
      <Box sx={{ border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', bgcolor: (theme) => theme.palette.background.paper, p: 3 }}>
        <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.07em', mb: 2 }}>Filters</Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' }, gap: 2 }}>
          <FormControl fullWidth>
            <InputLabel>Status</InputLabel>
            <Select value={filters.status} label="Status" onChange={(e) => handleFilterChange('status', e.target.value)}>
              <MenuItem value="">All Statuses</MenuItem>
              <MenuItem value="pending">Pending</MenuItem>
              <MenuItem value="approved">Approved</MenuItem>
              <MenuItem value="rejected">Rejected</MenuItem>
            </Select>
          </FormControl>
          <TextField fullWidth label="Instructor ID" value={filters.instructorId} onChange={(e) => handleFilterChange('instructorId', e.target.value)} placeholder="Filter by ID" />
          <TextField fullWidth label="Month" type="number" value={filters.month} onChange={(e) => handleFilterChange('month', e.target.value)} placeholder="1-12" inputProps={{ min: 1, max: 12 }} />
        </Box>
      </Box>

      {/* Timesheets Table */}
      <Box sx={{ border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', bgcolor: (theme) => theme.palette.background.paper, p: 3 }}>
        <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.07em', mb: 2 }}>
          Timesheets ({pagination.total} total)
        </Typography>

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}><CircularProgress size={24} /></Box>
        ) : (
          <>
            <DataTable columns={timesheetColumns} shownCount={timesheets.length} totalCount={pagination.total}>
              {timesheets.map((ts) => (
                <DataTableRow key={ts.id} columns={timesheetColumns}>
                  <Box>
                    <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: (theme) => theme.palette.text.primary }}>{ts.instructorName}</Typography>
                    <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.text.secondary }}>{ts.instructorEmail}</Typography>
                  </Box>
                  <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
                    {format(new Date(ts.weekStartDate), 'MMM dd, yyyy')} — {format(new Date(new Date(ts.weekStartDate).getTime() + 6 * 24 * 60 * 60 * 1000), 'MMM dd, yyyy')}
                  </Typography>
                  <Typography sx={{ fontSize: 13, fontWeight: 600, color: (theme) => theme.palette.text.primary, textAlign: 'right' }}>{ts.totalHours}</Typography>
                  <Typography sx={{ fontSize: 13, fontWeight: 600, color: (theme) => theme.palette.text.primary, textAlign: 'right' }}>{ts.coursesTaught}</Typography>
                  <StatusChip kind={getStatusKind(ts.status)} label={ts.status} />
                  <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{format(new Date(ts.createdAt), 'MMM dd, yyyy')}</Typography>
                  <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <Box onClick={() => { setSelectedTimesheet(ts); setDetailDialogOpen(true); }} sx={{ fontSize: 12, fontWeight: 600, color: '#CC1F1F', cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}>View</Box>
                  </Box>
                </DataTableRow>
              ))}
            </DataTable>

            {pagination.pages > 1 && (
              <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
                <Pagination count={pagination.pages} page={pagination.page} onChange={(_, p) => setPagination(prev => ({ ...prev, page: p }))} />
              </Box>
            )}
          </>
        )}
      </Box>

      {/* Timesheet Detail Dialog */}
      <Dialog open={detailDialogOpen} onClose={() => setDetailDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ fontSize: 18, fontWeight: 700, color: (theme) => theme.palette.text.primary, display: 'flex', alignItems: 'center', gap: 2 }}>
          Timesheet Details
          {selectedTimesheet && <StatusChip kind={getStatusKind(selectedTimesheet.status)} label={selectedTimesheet.status} />}
        </DialogTitle>
        <DialogContent>
          {selectedTimesheet && (
            <Box sx={{ pt: 1 }}>
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, mb: 2 }}>
                {[
                  ['Instructor', `${selectedTimesheet.instructorName} (${selectedTimesheet.instructorEmail})`],
                  ['Week Period', `${format(new Date(selectedTimesheet.weekStartDate), 'EEEE, MMMM dd, yyyy')} — ${format(new Date(new Date(selectedTimesheet.weekStartDate).getTime() + 6 * 24 * 60 * 60 * 1000), 'EEEE, MMMM dd, yyyy')}`],
                  ['Total Hours', selectedTimesheet.totalHours],
                  ['Courses Taught', selectedTimesheet.coursesTaught],
                  ['Submitted', format(new Date(selectedTimesheet.createdAt), 'MMM dd, yyyy HH:mm')],
                  ['Last Updated', format(new Date(selectedTimesheet.updatedAt), 'MMM dd, yyyy HH:mm')],
                ].map(([label, value]) => (
                  <Box key={String(label)}>
                    <Typography sx={{ fontSize: 12, fontWeight: 600, color: (theme) => theme.palette.text.secondary }}>{label}</Typography>
                    <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.primary }}>{value}</Typography>
                  </Box>
                ))}
              </Box>

              {selectedTimesheet.courseDetails && selectedTimesheet.courseDetails.length > 0 && (
                <Box sx={{ mb: 2 }}>
                  <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.07em', mb: 1 }}>Course Details</Typography>
                  <DataTable columns={courseDetailColumns} shownCount={selectedTimesheet.courseDetails.length} totalCount={selectedTimesheet.courseDetails.length}>
                    {selectedTimesheet.courseDetails.map((course: CourseDetail, index: number) => (
                      <DataTableRow key={index} columns={courseDetailColumns}>
                        <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{format(new Date(course.date), 'MMM dd, yyyy')}</Typography>
                        <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{course.startTime && course.endTime ? `${course.startTime} - ${course.endTime}` : 'TBD'}</Typography>
                        <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{course.organizationName || 'TBD'}</Typography>
                        <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{course.location || 'TBD'}</Typography>
                        <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{course.courseType}</Typography>
                        <Typography sx={{ fontSize: 13, fontWeight: 600, color: (theme) => theme.palette.text.primary, textAlign: 'right' }}>{course.studentCount ?? '—'}</Typography>
                        {course.status ? <StatusChip kind={course.status === 'completed' ? 'success' : 'active'} label={course.status} /> : <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>—</Typography>}
                      </DataTableRow>
                    ))}
                  </DataTable>
                </Box>
              )}

              <TimesheetNotes timesheetId={selectedTimesheet.id} onNotesChange={() => {}} />
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          {selectedTimesheet?.status === 'pending' && (
            <>
              <GhostButton onClick={() => { setDetailDialogOpen(false); setApprovalAction('approve'); setApprovalComment(''); setApprovalDialogOpen(true); }}>Approve</GhostButton>
              <GhostButton onClick={() => { setDetailDialogOpen(false); setApprovalAction('reject'); setApprovalComment(''); setApprovalDialogOpen(true); }}>Reject</GhostButton>
            </>
          )}
          <GhostButton onClick={() => setDetailDialogOpen(false)}>Close</GhostButton>
        </DialogActions>
      </Dialog>

      {/* Approval Dialog */}
      <Dialog open={approvalDialogOpen} onClose={() => setApprovalDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontSize: 18, fontWeight: 700, color: (theme) => theme.palette.text.primary }}>
          {approvalAction === 'approve' ? 'Approve' : 'Reject'} Timesheet
        </DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 1 }}>
            <Typography sx={{ fontSize: 14, color: (theme) => theme.palette.text.secondary, mb: 2 }}>
              Are you sure you want to {approvalAction} this timesheet?
            </Typography>
            <TextField fullWidth multiline rows={4} label="Comment (optional)" value={approvalComment} onChange={(e) => setApprovalComment(e.target.value)} />
          </Box>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <GhostButton onClick={() => setApprovalDialogOpen(false)} disabled={approvalLoading}>Cancel</GhostButton>
          <PrimaryButton onClick={handleApproval} disabled={approvalLoading}>
            {approvalLoading ? 'Processing...' : approvalAction === 'approve' ? 'Approve' : 'Reject'}
          </PrimaryButton>
        </DialogActions>
      </Dialog>

      {/* Reminder Dialog */}
      <Dialog open={reminderDialogOpen} onClose={() => setReminderDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ fontSize: 18, fontWeight: 700, color: (theme) => theme.palette.text.primary }}>Send Timesheet Reminders</DialogTitle>
        <DialogContent>
          {reminderLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress size={24} /></Box>
          ) : pendingReminders ? (
            <Box sx={{ pt: 1 }}>
              <Alert severity="info" sx={{ mb: 2 }}>
                Week of {pendingReminders.weekStartDate}: {pendingReminders.instructorsWithoutTimesheet.length} instructor(s) have not submitted timesheets.
              </Alert>
              {pendingReminders.instructorsWithoutTimesheet.length > 0 ? (
                <DataTable columns={reminderColumns} shownCount={pendingReminders.instructorsWithoutTimesheet.length} totalCount={pendingReminders.instructorsWithoutTimesheet.length}>
                  {pendingReminders.instructorsWithoutTimesheet.map((instructor) => (
                    <DataTableRow key={instructor.id} columns={reminderColumns}>
                      <Typography sx={{ fontSize: 13, fontWeight: 600, color: (theme) => theme.palette.text.primary }}>{instructor.username}</Typography>
                      <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{instructor.email}</Typography>
                      <Box sx={{ display: 'flex', justifyContent: 'center' }}>
                        <StatusChip kind={instructor.completed_courses > 0 ? 'active' : 'neutral'} label={String(instructor.completed_courses)} />
                      </Box>
                    </DataTableRow>
                  ))}
                </DataTable>
              ) : (
                <Alert severity="success">All instructors have submitted their timesheets for last week!</Alert>
              )}
            </Box>
          ) : (
            <Alert severity="error">Failed to load pending reminders.</Alert>
          )}
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <GhostButton onClick={() => setReminderDialogOpen(false)}>Close</GhostButton>
          <PrimaryButton onClick={handleSendReminders} disabled={sendingReminders || !pendingReminders?.instructorsWithoutTimesheet.length}>
            {sendingReminders ? 'Sending...' : `Send Reminders (${pendingReminders?.instructorsWithoutTimesheet.length || 0})`}
          </PrimaryButton>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default TimesheetProcessingDashboard;
