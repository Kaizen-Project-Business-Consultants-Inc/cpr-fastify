import React, { useState, useEffect } from 'react';
import { Box, Typography, Alert, CircularProgress } from '@mui/material';
import { hrDashboardService, HRDashboardStats } from '../../services/hrDashboardService';
import StatCard from '../gtacpr/StatCard';
import { PrimaryButton, GhostButton } from '../gtacpr/Buttons';
import { getErrorMessage } from '../../utils/errorMessage';

interface HRDashboardProps {
  onViewChange?: (view: string) => void;
}

const HRDashboard: React.FC<HRDashboardProps> = ({ onViewChange }) => {
  const [stats, setStats] = useState<HRDashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' }, gap: '16px' }}>
        <StatCard label="Active Instructors" value={stats?.activeInstructors || 0} sub="Currently active" dotColor="#CC1F1F" />
        <StatCard label="Organizations" value={stats?.organizations || 0} sub="Registered" dotColor="#4B5563" />
        <StatCard label="Expiring Certs" value={stats?.expiringCertifications || 0} sub="Need attention" dotColor="#DC2626" />
      </Box>

      {/* Quick Actions */}
      <Box sx={{ border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', bgcolor: (theme) => theme.palette.background.paper, p: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Quick Actions</Typography>
          <GhostButton onClick={loadDashboardData}>Refresh</GhostButton>
        </Box>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <PrimaryButton onClick={() => onViewChange?.('personnel')}>Manage Personnel</PrimaryButton>
          <GhostButton onClick={() => onViewChange?.('payrates')}>Pay Rates</GhostButton>
          <GhostButton onClick={() => onViewChange?.('timesheet')}>Timesheets</GhostButton>
          <GhostButton onClick={() => onViewChange?.('reports')}>HR Reports</GhostButton>
        </Box>
      </Box>
    </Box>
  );
};

export default HRDashboard;
