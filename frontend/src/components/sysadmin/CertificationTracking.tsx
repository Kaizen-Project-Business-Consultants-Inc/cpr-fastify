import React, { useState, useEffect, useCallback } from 'react';
import { Box, CircularProgress, Typography } from '@mui/material';
import { sysAdminApi } from '../../services/api';
import api from '../../services/api';
import StatCard from '../gtacpr/StatCard';
import StatusChip from '../gtacpr/StatusChip';
import UserAvatar from '../gtacpr/UserAvatar';
import DataTable, { DataTableRow } from '../gtacpr/DataTable';
import SegmentedToggle from '../gtacpr/SegmentedToggle';
import { GhostButton } from '../gtacpr/Buttons';
import { useServerPagination } from '../../hooks/useServerPagination';
import type { Theme } from '@mui/material/styles';

interface CertificationTrackingProps {
  onShowSnackbar: (message: string, severity: 'success' | 'error' | 'warning' | 'info') => void;
}

interface CertificationStats {
  active_certs?: number;
  expiring_30d?: number;
  expiring_90d?: number;
  expired?: number;
}

interface CertificationRow {
  student_id: number | string;
  certificate_issued_at?: string;
  first_name?: string;
  last_name?: string;
  organization_name?: string;
  course_type_name?: string;
  certificate_number?: string;
  certificate_expires_at?: string;
  days_until_expiry?: number;
  days_expired?: number;
}

const windowOptions = [
  { value: '30', label: '30d' },
  { value: '60', label: '60d' },
  { value: '90', label: '90d' },
  { value: '180', label: '180d' },
];

const columns = [
  { key: 'student', label: 'STUDENT', width: '1.6fr' },
  { key: 'course', label: 'COURSE', width: '1.7fr' },
  { key: 'cert', label: 'CERT #', width: '1fr' },
  { key: 'expires', label: 'EXPIRES', width: '1fr' },
  { key: 'status', label: 'STATUS', width: '1fr', align: 'right' as const },
];

function getInitials(first?: string, last?: string): string {
  return `${(first || '')[0] || ''}${(last || '')[0] || ''}`.toUpperCase();
}

function getStatusChip(view: string, daysValue: number) {
  if (view === 'expired' || daysValue < 0) return <StatusChip kind="brand" label="Expired" />;
  if (daysValue <= 30) return <StatusChip kind="brand" label="Critical" />;
  if (daysValue <= 90) return <StatusChip kind="danger" label="Expiring" />;
  return <StatusChip kind="active" label="Active" />;
}

const CertificationTracking = ({ onShowSnackbar }: CertificationTrackingProps) => {
  const [view, setView] = useState('expiring');
  const [days, setDays] = useState('90');
  const [stats, setStats] = useState<CertificationStats | null>(null);

  const fetchCerts = useCallback(async ({ page, limit }: { page: number; limit: number }) => {
    try {
      if (view === 'expiring') {
        const response = await api.get(`/sysadmin/certifications/expiring`, {
          params: { days, page, limit },
        });
        return { data: response.data.data || [], pagination: response.data.pagination };
      } else {
        const response = await api.get(`/sysadmin/certifications/expired`, {
          params: { page, limit },
        });
        return { data: response.data.data || [], pagination: response.data.pagination };
      }
    } catch {
      onShowSnackbar('Failed to load certifications', 'error');
      return { data: [], pagination: { page: 1, limit, total: 0, pages: 0 } };
    }
  }, [view, days, onShowSnackbar]);

  const {
    items: certs,
    loading,
    page: certPage,
    totalCount,
    shownCount,
    hasNextPage: certHasNext,
    onPrevPage: onCertPrev,
    onNextPage: onCertNext,
    load,
  } = useServerPagination({ pageSize: 25, fetchFn: fetchCerts });

  const loadStats = async () => {
    try {
      const response = await sysAdminApi.getCertificationStats();
      setStats(response.data);
    } catch {
      // Stats are optional
    }
  };

  const handleExportCSV = async () => {
    try {
      const response = await api.get('/sysadmin/certifications/expiring/export/csv', {
        params: { days },
        responseType: 'blob',
      });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `expiring-certifications-${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch {
      onShowSnackbar('Failed to export certifications', 'error');
    }
  };

  // Mount-time fetch of summary stat cards (external API sync, not state
  // derived from render data), so a direct setState inside is expected.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadStats(); }, []);
  useEffect(() => { load(1); }, [view, days, load]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Stat cards */}
      {stats && (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' }, gap: '16px' }}>
          <StatCard label="Active Certifications" value={stats.active_certs ?? 0} sub="Currently valid" dotColor="#16A34A" />
          <StatCard label="Expiring · 30 days" value={stats.expiring_30d ?? 0} sub="Renewal reminders due" dotColor="#CC1F1F" />
          <StatCard label="Expiring · 90 days" value={stats.expiring_90d ?? 0} sub="Within the quarter" dotColor="#ED6C02" />
          <StatCard label="Expired" value={stats.expired ?? 0} sub="Lapsed — needs re-cert" dotColor="#9CA3AF" />
        </Box>
      )}

      {/* Toggle + window filter */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <SegmentedToggle
          value={view}
          options={[
            { value: 'expiring', label: 'Expiring Soon' },
            { value: 'expired', label: 'Expired' },
          ]}
          onChange={setView}
        />
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {view === 'expiring' && (
            <>
              <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.text.secondary, fontWeight: 500 }}>Window:</Typography>
              {windowOptions.map(opt => (
                <Box
                  key={opt.value}
                  onClick={() => setDays(opt.value)}
                  sx={{
                    px: 1.5, py: 0.5,
                    borderRadius: '20px',
                    fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    border: '1px solid',
                    borderColor: days === opt.value ? 'rgba(204,31,31,.3)' : (theme: Theme) => theme.palette.divider,
                    bgcolor: days === opt.value ? '#FFF0F0' : (theme: Theme) => theme.palette.background.paper,
                    color: days === opt.value ? '#CC1F1F' : (theme: Theme) => theme.palette.text.secondary,
                  }}
                >
                  {opt.label}
                </Box>
              ))}
            </>
          )}
          <GhostButton onClick={handleExportCSV}>Export CSV</GhostButton>
        </Box>
      </Box>

      {/* Table */}
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      ) : certs.length === 0 ? (
        <Box sx={{ bgcolor: (theme) => theme.palette.background.paper, border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', p: 6, textAlign: 'center' }}>
          <Typography sx={{ color: (theme) => theme.palette.text.secondary, fontSize: 14 }}>
            {view === 'expiring'
              ? `No certifications expiring within ${days} days.`
              : 'No expired certifications found.'}
          </Typography>
        </Box>
      ) : (
        <DataTable columns={columns} shownCount={shownCount} totalCount={totalCount} page={certPage} onPrevPage={onCertPrev} onNextPage={onCertNext} hasNextPage={certHasNext}>
          {certs.map((cert: CertificationRow, i: number) => (
            <DataTableRow key={`${cert.student_id}-${cert.certificate_issued_at}-${i}`} columns={columns}>
              {/* STUDENT */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                <UserAvatar initials={getInitials(cert.first_name, cert.last_name)} />
                <Box>
                  <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: (theme) => theme.palette.text.primary }}>
                    {cert.first_name} {cert.last_name}
                  </Typography>
                  <Typography sx={{ fontSize: 11.5, color: (theme) => theme.palette.text.secondary }}>
                    {cert.organization_name || '—'}
                  </Typography>
                </Box>
              </Box>
              {/* COURSE */}
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
                {cert.course_type_name}
              </Typography>
              {/* CERT # */}
              <Typography sx={{ fontSize: 12.5, fontFamily: 'monospace', color: (theme) => theme.palette.text.secondary }}>
                {cert.certificate_number || '—'}
              </Typography>
              {/* EXPIRES */}
              <Typography sx={{ fontSize: 13, fontWeight: 500, color: (theme) => theme.palette.text.primary }}>
                {cert.certificate_expires_at
                  ? new Date(cert.certificate_expires_at).toLocaleDateString()
                  : '—'}
              </Typography>
              {/* STATUS */}
              <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                {getStatusChip(view, view === 'expiring' ? (cert.days_until_expiry ?? 0) : -(cert.days_expired ?? 0))}
              </Box>
            </DataTableRow>
          ))}
        </DataTable>
      )}
    </Box>
  );
};

export default CertificationTracking;
