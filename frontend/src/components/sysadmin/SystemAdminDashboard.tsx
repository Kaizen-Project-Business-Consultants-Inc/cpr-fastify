import React, { useState, useEffect, useCallback } from 'react';
import { Box, Typography, CircularProgress, Alert } from '@mui/material';
import { sysAdminApi } from '../../services/api';
import logger from '../../utils/logger';
import StatCard from '../gtacpr/StatCard';
import StatusChip from '../gtacpr/StatusChip';
import DataTable, { DataTableRow } from '../gtacpr/DataTable';
import RoleChip from '../gtacpr/RoleChip';
import DateRangeFilter from '../gtacpr/DateRangeFilter';
import { getErrorMessage } from '../../utils/errorMessage';

interface DashboardSummary {
  totalUsers?: number;
  totalOrganizations?: number;
  totalCourses?: number;
  totalVendors?: number;
  usersThisYear?: number;
  usersLastYear?: number;
  orgsThisYear?: number;
  orgsLastYear?: number;
  coursesThisYear?: number;
  coursesLastYear?: number;
}

interface RecentUser {
  username: string;
  role: string;
  createdAt: string;
}

interface RecentCourse {
  name: string;
  courseCode?: string;
  createdAt: string;
}

interface DashboardData {
  summary?: DashboardSummary;
  recentActivity?: {
    users?: RecentUser[];
    courses?: RecentCourse[];
  };
}

const userColumns = [
  { key: 'user', label: 'USERNAME', width: '1.2fr' },
  { key: 'role', label: 'ROLE', width: '0.8fr' },
  { key: 'date', label: 'CREATED', width: '1fr', align: 'right' as const },
];

const courseColumns = [
  { key: 'name', label: 'COURSE', width: '1.5fr' },
  { key: 'code', label: 'CODE', width: '0.8fr' },
  { key: 'date', label: 'CREATED', width: '1fr', align: 'right' as const },
];

const SystemAdminDashboard = ({ onShowSnackbar }: { onShowSnackbar?: (message: string, severity?: 'success' | 'error') => void }) => {
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const loadDashboardData = useCallback(async (from?: string, to?: string) => {
    setLoading(true);
    try {
      const params: { from?: string; to?: string } = {};
      if (from) params.from = from;
      if (to) params.to = to;
      const response = await sysAdminApi.getDashboard(Object.keys(params).length > 0 ? params : undefined);
      setDashboardData(response.data);
      setError('');
    } catch (err) {
      logger.error('Error loading dashboard data:', err);
      setError(getErrorMessage(err, 'Failed to load dashboard data'));
      onShowSnackbar?.('Failed to load dashboard data', 'error');
    } finally {
      setLoading(false);
    }
  }, [onShowSnackbar]);

  // Mount-time fetch of the dashboard summary (external API sync, not state
  // derived from render data), so a direct setState inside is expected.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadDashboardData(); }, [loadDashboardData]);

  const handleDateChange = (from: string, to: string) => {
    setDateFrom(from);
    setDateTo(to);
    loadDashboardData(from, to);
  };

  const formatDate = (dateString?: string) => dateString ? new Date(dateString).toLocaleDateString() : '';

  if (loading && !dashboardData) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400 }}>
        <CircularProgress size={48} />
      </Box>
    );
  }

  if (error && !dashboardData) {
    return <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>;
  }

  const { summary, recentActivity } = dashboardData || {};
  const recentUsers = recentActivity?.users ?? [];
  const recentCourses = recentActivity?.courses ?? [];

  const getYoyLabel = (current: number, previous: number): { text: string; color: string } => {
    if (previous === 0) return current > 0 ? { text: 'New this year', color: '#16A34A' } : { text: '', color: '' };
    const pct = ((current - previous) / previous * 100).toFixed(0);
    const num = Number(pct);
    if (num > 0) return { text: `+${pct}% vs last year`, color: '#16A34A' };
    if (num < 0) return { text: `${pct}% vs last year`, color: '#CC1F1F' };
    return { text: '0% vs last year', color: '#6B7280' };
  };

  const usersYoy = getYoyLabel(summary?.usersThisYear ?? 0, summary?.usersLastYear ?? 0);
  const orgsYoy = getYoyLabel(summary?.orgsThisYear ?? 0, summary?.orgsLastYear ?? 0);
  const coursesYoy = getYoyLabel(summary?.coursesThisYear ?? 0, summary?.coursesLastYear ?? 0);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <DateRangeFilter from={dateFrom} to={dateTo} onChange={handleDateChange} />

      {/* KPI cards */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' }, gap: '16px' }}>
        <StatCard label="Total Users" value={summary?.totalUsers || 0} sub={usersYoy.text || 'All registered accounts'} subColor={usersYoy.text ? usersYoy.color : undefined} dotColor="#CC1F1F" />
        <StatCard label="Organizations" value={summary?.totalOrganizations || 0} sub={orgsYoy.text || 'Active organizations'} subColor={orgsYoy.text ? orgsYoy.color : undefined} dotColor="#16A34A" />
        <StatCard label="Course Types" value={summary?.totalCourses || 0} sub={coursesYoy.text || 'In course catalog'} subColor={coursesYoy.text ? coursesYoy.color : undefined} dotColor="#ED6C02" />
        <StatCard label="Active Vendors" value={summary?.totalVendors || 0} sub="Vendor partnerships" dotColor="#4B5563" />
      </Box>

      {/* Two-column recent activity */}
      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
        {/* Recent Users */}
        <Box>
          <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.07em', mb: 1.5 }}>
            Recent Users
          </Typography>
          {recentUsers.length > 0 ? (
            <DataTable columns={userColumns} shownCount={recentUsers.length} totalCount={recentUsers.length}>
              {recentUsers.map((user: RecentUser, i: number) => (
                <DataTableRow key={i} columns={userColumns}>
                  <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: (theme) => theme.palette.text.primary }}>{user.username}</Typography>
                  <RoleChip role={user.role} />
                  <Typography sx={{ fontSize: 12.5, color: (theme) => theme.palette.text.secondary, textAlign: 'right' }}>{formatDate(user.createdAt)}</Typography>
                </DataTableRow>
              ))}
            </DataTable>
          ) : (
            <Box sx={{ bgcolor: (theme) => theme.palette.background.paper, border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', p: 4, textAlign: 'center' }}>
              <Typography sx={{ color: (theme) => theme.palette.text.secondary, fontSize: 13 }}>No recent user activity</Typography>
            </Box>
          )}
        </Box>

        {/* Recent Courses */}
        <Box>
          <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.07em', mb: 1.5 }}>
            Recent Courses
          </Typography>
          {recentCourses.length > 0 ? (
            <DataTable columns={courseColumns} shownCount={recentCourses.length} totalCount={recentCourses.length}>
              {recentCourses.map((course: RecentCourse, i: number) => (
                <DataTableRow key={i} columns={courseColumns}>
                  <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: (theme) => theme.palette.text.primary }}>{course.name}</Typography>
                  <Typography sx={{ fontSize: 12, fontFamily: 'monospace', color: (theme) => theme.palette.text.secondary }}>{course.courseCode || '\u2014'}</Typography>
                  <Typography sx={{ fontSize: 12.5, color: (theme) => theme.palette.text.secondary, textAlign: 'right' }}>{formatDate(course.createdAt)}</Typography>
                </DataTableRow>
              ))}
            </DataTable>
          ) : (
            <Box sx={{ bgcolor: (theme) => theme.palette.background.paper, border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', p: 4, textAlign: 'center' }}>
              <Typography sx={{ color: (theme) => theme.palette.text.secondary, fontSize: 13 }}>No recent course activity</Typography>
            </Box>
          )}
        </Box>
      </Box>

      {/* System Status */}
      <Box sx={{ bgcolor: (theme) => theme.palette.background.paper, border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', p: '20px 24px' }}>
        <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.07em', mb: 2 }}>
          System Status
        </Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' }, gap: 2 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>Platform</Typography>
            <StatusChip kind="active" label="Operational" />
          </Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>Database</Typography>
            <StatusChip kind="active" label="Connected" />
          </Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>Last Backup</Typography>
            <Typography sx={{ fontSize: 13, fontWeight: 600, color: (theme) => theme.palette.text.primary }}>Today 02:00 AM</Typography>
          </Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>Version</Typography>
            <Typography sx={{ fontSize: 13, fontWeight: 600, color: (theme) => theme.palette.text.primary, fontFamily: 'monospace' }}>v1.0.0</Typography>
          </Box>
        </Box>
      </Box>
    </Box>
  );
};

export default SystemAdminDashboard;
