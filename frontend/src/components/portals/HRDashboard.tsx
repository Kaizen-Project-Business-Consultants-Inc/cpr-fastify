import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Alert,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  ButtonBase,
} from '@mui/material';
import { hrDashboardService, HRDashboardStats, ProfileChange, RecentChange as ServiceRecentChange } from '../../services/hrDashboardService';
import StatCard from '../gtacpr/StatCard';
import StatusChip from '../gtacpr/StatusChip';
import DataTable, { DataTableRow } from '../gtacpr/DataTable';
import { PrimaryButton, GhostButton } from '../gtacpr/Buttons';
import { getErrorMessage } from '../../utils/errorMessage';

interface HRDashboardProps {
  onViewChange?: (view: string) => void;
}

interface RecentChange extends ServiceRecentChange {
  username?: string;
  fieldName?: string;
  status?: string;
}

const getStatusKind = (status: string) => {
  switch (status) {
    case 'approved': return 'success' as const;
    case 'rejected': return 'danger' as const;
    case 'pending': return 'warning' as const;
    default: return 'neutral' as const;
  }
};

const getFieldDisplayName = (fieldName: string) => {
  const fieldMap: Record<string, string> = {
    email: 'Email Address',
    phone: 'Phone Number',
    username: 'Username',
    organization_id: 'Organization',
    role: 'Role',
  };
  return fieldMap[fieldName] || fieldName;
};

const approvalColumns = [
  { key: 'user', label: 'USER', width: '1.2fr' },
  { key: 'type', label: 'CHANGE TYPE', width: '0.8fr' },
  { key: 'field', label: 'FIELD', width: '0.8fr' },
  { key: 'value', label: 'NEW VALUE', width: '1fr' },
  { key: 'status', label: 'STATUS', width: '0.7fr' },
  { key: 'date', label: 'DATE', width: '0.8fr' },
  { key: 'actions', label: '', width: '0.8fr', align: 'right' as const },
];

const HRDashboard: React.FC<HRDashboardProps> = ({ onViewChange }) => {
  const [stats, setStats] = useState<HRDashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedChange, setSelectedChange] = useState<ProfileChange | null>(null);
  const [approvalDialog, setApprovalDialog] = useState(false);
  const [approvalAction, setApprovalAction] = useState<'approve' | 'reject'>('approve');
  const [approvalComment, setApprovalComment] = useState('');
  const [processingApproval, setProcessingApproval] = useState(false);

  const loadDashboardData = async () => {
    try {
      setLoading(true);
      setError(null);
      const dashboardStats = await hrDashboardService.getDashboardStats();
      setStats(dashboardStats);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to load dashboard data'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadDashboardData(); }, []);

  const handleApproveChange = async () => {
    if (!selectedChange) return;
    try {
      setProcessingApproval(true);
      await hrDashboardService.approveChange(selectedChange.id, approvalAction, approvalComment);
      await loadDashboardData();
      setApprovalDialog(false);
      setSelectedChange(null);
      setApprovalComment('');
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to process approval'));
    } finally {
      setProcessingApproval(false);
    }
  };

  const openApprovalDialog = (change: ProfileChange, action: 'approve' | 'reject') => {
    setSelectedChange(change);
    setApprovalAction(action);
    setApprovalDialog(true);
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400 }}>
        <CircularProgress size={48} />
      </Box>
    );
  }

  if (error) {
    return (
      <Box>
        <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>
        <GhostButton onClick={loadDashboardData}>Retry</GhostButton>
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Stats */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' }, gap: '16px' }}>
        <StatCard label="Pending Approvals" value={stats?.pendingApprovals || 0} sub="Awaiting review" dotColor="#ED6C02" />
        <StatCard label="Active Instructors" value={stats?.activeInstructors || 0} sub="Currently active" dotColor="#CC1F1F" />
        <StatCard label="Organizations" value={stats?.organizations || 0} sub="Registered" dotColor="#4B5563" />
        <StatCard label="Expiring Certs" value={stats?.expiringCertifications || 0} sub="Need attention" dotColor="#DC2626" />
      </Box>

      {/* Quick Actions + Recent Activity */}
      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
        <Box sx={{ border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', bgcolor: (theme) => theme.palette.background.paper, p: 3 }}>
          <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.07em', mb: 2 }}>Quick Actions</Typography>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <PrimaryButton onClick={() => onViewChange?.('personnel')}>Manage Personnel</PrimaryButton>
            <GhostButton onClick={() => onViewChange?.('payrates')}>Pay Rates</GhostButton>
            <GhostButton onClick={() => onViewChange?.('timesheet')}>Timesheets</GhostButton>
            <GhostButton onClick={() => onViewChange?.('reports')}>HR Reports</GhostButton>
          </Box>
        </Box>

        <Box sx={{ border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', bgcolor: (theme) => theme.palette.background.paper, p: 3 }}>
          <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.07em', mb: 2 }}>Recent Activity</Typography>
          <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary, mb: 1 }}>{stats?.recentChanges?.length || 0} recent profile changes</Typography>
          {stats?.recentChanges?.slice(0, 3).map((change) => {
            const extChange = change as RecentChange;
            return (
              <Box key={change.id} sx={{ p: 1.5, bgcolor: (theme) => theme.palette.background.default, borderRadius: '8px', mb: 1 }}>
                <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.primary }}>
                  <strong>{extChange.username || `User ${change.userId}`}</strong> — {getFieldDisplayName(extChange.fieldName || change.changeType)} change
                </Typography>
                <Box sx={{ mt: 0.5 }}>
                  <StatusChip kind={getStatusKind(extChange.status || 'pending')} label={extChange.status || 'pending'} />
                </Box>
              </Box>
            );
          })}
        </Box>
      </Box>

      {/* Pending Approvals Table */}
      <Box sx={{ border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', bgcolor: (theme) => theme.palette.background.paper, p: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
            Pending Approvals ({stats?.pendingApprovalsList?.length || 0})
          </Typography>
          <GhostButton onClick={loadDashboardData}>Refresh</GhostButton>
        </Box>

        {(stats?.pendingApprovalsList?.length || 0) === 0 ? (
          <Box sx={{ textAlign: 'center', py: 4 }}>
            <Typography sx={{ fontSize: 14, fontWeight: 600, color: (theme) => theme.palette.text.secondary }}>No pending approvals</Typography>
          </Box>
        ) : (
          <DataTable columns={approvalColumns} shownCount={stats?.pendingApprovalsList?.length || 0} totalCount={stats?.pendingApprovalsList?.length || 0}>
            {stats?.pendingApprovalsList?.map((approval) => {
              const change = approval as unknown as ProfileChange;
              return (
                <DataTableRow key={change.id} columns={approvalColumns}>
                  <Box>
                    <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: (theme) => theme.palette.text.primary }}>{change.username}</Typography>
                    <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.text.secondary }}>{change.email}</Typography>
                  </Box>
                  <StatusChip kind="brand" label={change.changeType} />
                  <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{getFieldDisplayName(change.fieldName)}</Typography>
                  <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 150 }}>{change.newValue}</Typography>
                  <StatusChip kind={getStatusKind(change.status)} label={change.status} />
                  <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{new Date(change.createdAt).toLocaleDateString()}</Typography>
                  <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
                    <ButtonBase onClick={() => openApprovalDialog(change, 'approve')} sx={{ fontSize: 12, fontWeight: 600, color: '#16A34A', '&:hover': { textDecoration: 'underline' }, '&:focus-visible': { outline: '2px solid #16A34A', outlineOffset: '2px' } }}>Approve</ButtonBase>
                    <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.divider }}>|</Typography>
                    <ButtonBase onClick={() => openApprovalDialog(change, 'reject')} sx={{ fontSize: 12, fontWeight: 600, color: '#CC1F1F', '&:hover': { textDecoration: 'underline' }, '&:focus-visible': { outline: '2px solid #CC1F1F', outlineOffset: '2px' } }}>Reject</ButtonBase>
                  </Box>
                </DataTableRow>
              );
            })}
          </DataTable>
        )}
      </Box>

      {/* Approval Dialog */}
      <Dialog open={approvalDialog} onClose={() => setApprovalDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontSize: 18, fontWeight: 700, color: (theme) => theme.palette.text.primary }}>
          {approvalAction === 'approve' ? 'Approve' : 'Reject'} Profile Change
        </DialogTitle>
        <DialogContent>
          {selectedChange && (
            <Box sx={{ pt: 1 }}>
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary, mb: 1 }}>
                User: {selectedChange.username} ({selectedChange.email})
              </Typography>
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary, mb: 2 }}>
                Change: {getFieldDisplayName(selectedChange.fieldName)} → {selectedChange.newValue}
              </Typography>
              <TextField
                fullWidth
                multiline
                rows={3}
                label="Comment (optional)"
                value={approvalComment}
                onChange={(e) => setApprovalComment(e.target.value)}
              />
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <GhostButton onClick={() => setApprovalDialog(false)} disabled={processingApproval}>Cancel</GhostButton>
          <PrimaryButton onClick={handleApproveChange} disabled={processingApproval}>
            {processingApproval ? 'Processing...' : approvalAction === 'approve' ? 'Approve' : 'Reject'}
          </PrimaryButton>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default HRDashboard;
