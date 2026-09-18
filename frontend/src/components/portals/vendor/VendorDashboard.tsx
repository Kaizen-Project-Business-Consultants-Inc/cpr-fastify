import React, { useState, useEffect, useCallback } from 'react';
import { Box, Alert, CircularProgress } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { vendorApi } from '../../../services/api';
import StatCard from '../../gtacpr/StatCard';
import { PrimaryButton, GhostButton } from '../../gtacpr/Buttons';
import { formatCurrency } from '../../../utils/formatters';

interface DashboardStats {
  pendingInvoices: number;
  totalInvoices: number;
  totalPaid: number;
  averagePaymentTime: number;
}

const VendorDashboard: React.FC = () => {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const fetchDashboardStats = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await vendorApi.getDashboard();
      const data = response?.data ?? response;
      setStats({
        pendingInvoices: Number(data?.pendingInvoices ?? 0),
        totalInvoices: Number(data?.totalInvoices ?? 0),
        totalPaid: Number(data?.totalPaid ?? 0),
        averagePaymentTime: Number(data?.averagePaymentTime ?? 0),
      });
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      setError(axiosErr.response?.data?.error || 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchDashboardStats(); }, [fetchDashboardStats]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 160 }}>
          <CircularProgress size={40} aria-label="Loading dashboard" />
        </Box>
      ) : error || !stats ? (
        <Alert severity="error" action={<GhostButton onClick={fetchDashboardStats}>Retry</GhostButton>}>
          {error || 'Dashboard not available'}
        </Alert>
      ) : (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' }, gap: '16px' }}>
          <StatCard label="Pending Invoices" value={stats.pendingInvoices} sub="Awaiting review" dotColor="#ED6C02" />
          <StatCard label="Total Invoices" value={stats.totalInvoices} sub="All submissions" dotColor="#CC1F1F" />
          <StatCard label="Total Paid" value={formatCurrency(stats.totalPaid)} sub="Revenue received" dotColor="#16A34A" />
          <StatCard label="Avg Payment Days" value={stats.averagePaymentTime} sub="Processing time" dotColor="#4B5563" />
        </Box>
      )}

      {/* Quick actions */}
      <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
        <PrimaryButton onClick={() => navigate('/vendor/upload')}>Upload New Invoice</PrimaryButton>
        <GhostButton onClick={() => navigate('/vendor/history')}>View All Invoices</GhostButton>
        <GhostButton onClick={() => navigate('/vendor/profile')}>Update Profile</GhostButton>
      </Box>
    </Box>
  );
};

export default VendorDashboard;
