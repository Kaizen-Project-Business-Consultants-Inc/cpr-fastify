import React, { useState, useEffect, useCallback } from 'react';
import { Box, Typography, TextField, MenuItem, Dialog, DialogTitle, DialogContent, DialogActions, Button } from '@mui/material';
import { sysAdminApi } from '../../services/api';
import api from '../../services/api';
import StatCard from '../gtacpr/StatCard';
import DataTable, { DataTableRow } from '../gtacpr/DataTable';
import SearchBar from '../gtacpr/SearchBar';
import { useDebounce } from '../../hooks/useDebounce';
import { getTodayDate } from '../../utils/formatters';
import { GhostButton } from '../gtacpr/Buttons';
import { useServerPagination } from '../../hooks/useServerPagination';

interface AuditLogEntry {
  id: number;
  user_id: number | null;
  username: string | null;
  action: string;
  entity_type: string | null;
  entity_id: number | null;
  details: unknown;
  ip_address: string | null;
  created_at: string;
}

interface AuditLogViewerProps {
  onShowSnackbar: (message: string, severity: 'success' | 'error' | 'warning' | 'info') => void;
}

const ACTION_OPTIONS = [
  { value: '', label: 'All Actions' },
  { value: 'login', label: 'Login' },
  { value: 'login_failed', label: 'Login Failed' },
  { value: 'logout', label: 'Logout' },
  { value: 'change_password', label: 'Password Change' },
  { value: 'create_user', label: 'Create User' },
  { value: 'update_user', label: 'Update User' },
  { value: 'create_organization', label: 'Create Organization' },
  { value: 'update_organization', label: 'Update Organization' },
];

const ENTITY_TYPE_OPTIONS = [
  { value: '', label: 'All Entity Types' },
  { value: 'user', label: 'User' },
  { value: 'organization', label: 'Organization' },
  { value: 'invoice', label: 'Invoice' },
  { value: 'course', label: 'Course' },
];

const columns = [
  { key: 'created_at', label: 'TIMESTAMP', width: '1.3fr' },
  { key: 'username', label: 'USER', width: '1fr' },
  { key: 'action', label: 'ACTION', width: '1.1fr' },
  { key: 'entity_type', label: 'ENTITY TYPE', width: '0.9fr' },
  { key: 'entity_id', label: 'ENTITY ID', width: '0.7fr' },
  { key: 'ip_address', label: 'IP ADDRESS', width: '1fr' },
  { key: 'details', label: 'DETAILS', width: '1.2fr' },
];

function formatTimestamp(ts: string): string {
  if (!ts) return '--';
  const d = new Date(ts);
  return d.toLocaleString();
}

function truncateDetails(details: unknown): string {
  if (!details) return '--';
  try {
    const str = typeof details === 'string' ? details : JSON.stringify(details);
    return str.length > 80 ? str.slice(0, 77) + '...' : str;
  } catch {
    return '--';
  }
}

function formatAction(action: string): string {
  return action.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

const AuditLogViewer = ({ onShowSnackbar }: AuditLogViewerProps) => {
  const [searchTerm, setSearchTerm] = useState('');
  const debouncedSearch = useDebounce(searchTerm, 300);
  const [actionFilter, setActionFilter] = useState('');
  const [entityTypeFilter, setEntityTypeFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [stats, setStats] = useState<{ totalEntries: number; entriesToday: number; uniqueUsers: number } | null>(null);
  const [detailEntry, setDetailEntry] = useState<AuditLogEntry | null>(null);

  const fetchFn = useCallback(async ({ page, limit }: { page: number; limit: number }) => {
    const params: Record<string, string | number> = { page, limit };
    if (debouncedSearch.trim().length >= 2) params.search = debouncedSearch.trim();
    if (actionFilter) params.action = actionFilter;
    if (entityTypeFilter) params.entity_type = entityTypeFilter;
    if (fromDate) params.from = fromDate;
    if (toDate) params.to = toDate;
    const response = await sysAdminApi.getAuditLogs(params as any);
    return { data: response.data, pagination: response.pagination };
  }, [debouncedSearch, actionFilter, entityTypeFilter, fromDate, toDate]);

  const { items, loading, page, totalCount, shownCount, hasNextPage, onPrevPage, onNextPage, load } = useServerPagination({
    fetchFn,
    pageSize: 25,
  });

  const loadStats = async () => {
    try {
      const response = await sysAdminApi.getAuditLogStats();
      setStats(response.data);
    } catch {
      // Stats are optional
    }
  };

  useEffect(() => { loadStats(); }, []);
  useEffect(() => { load(1); }, [debouncedSearch, actionFilter, entityTypeFilter, fromDate, toDate]);

  const handleExportCSV = async () => {
    try {
      const params: Record<string, string> = {};
      if (searchTerm.trim().length >= 2) params.search = searchTerm.trim();
      if (actionFilter) params.action = actionFilter;
      if (entityTypeFilter) params.entity_type = entityTypeFilter;
      if (fromDate) params.from = fromDate;
      if (toDate) params.to = toDate;
      const response = await api.get('/sysadmin/audit-logs/export/csv', {
        params,
        responseType: 'blob',
      });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit-logs-${getTodayDate()}.csv`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch {
      onShowSnackbar('Failed to export audit logs', 'error');
    }
  };

  const selectSx = {
    minWidth: 160,
    '& .MuiOutlinedInput-root': { borderRadius: '8px', fontSize: '13px' },
    '& .MuiInputLabel-root': { fontSize: '13px' },
  };

  const dateSx = {
    width: 160,
    '& .MuiOutlinedInput-root': { borderRadius: '8px', fontSize: '13px' },
    '& .MuiInputLabel-root': { fontSize: '13px' },
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Stat cards */}
      {stats && (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' }, gap: '16px' }}>
          <StatCard label="Total Entries" value={stats.totalEntries} sub="All-time audit records" />
          <StatCard label="Today's Entries" value={stats.entriesToday} sub="Activity today" dotColor="#16A34A" />
          <StatCard label="Unique Users" value={stats.uniqueUsers} sub="Distinct users tracked" dotColor="#3B82F6" />
        </Box>
      )}

      {/* Search bar */}
      <Box sx={{ maxWidth: 400 }}>
        <SearchBar placeholder="Search username, action, or details..." value={searchTerm} onChange={setSearchTerm} />
      </Box>

      {/* Filters row */}
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
        <TextField
          select
          label="Action"
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
          size="small"
          sx={selectSx}
        >
          {ACTION_OPTIONS.map(opt => (
            <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
          ))}
        </TextField>

        <TextField
          select
          label="Entity Type"
          value={entityTypeFilter}
          onChange={(e) => setEntityTypeFilter(e.target.value)}
          size="small"
          sx={selectSx}
        >
          {ENTITY_TYPE_OPTIONS.map(opt => (
            <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
          ))}
        </TextField>

        <TextField
          label="From"
          type="date"
          value={fromDate}
          onChange={(e) => setFromDate(e.target.value)}
          size="small"
          InputLabelProps={{ shrink: true }}
          sx={dateSx}
        />

        <TextField
          label="To"
          type="date"
          value={toDate}
          onChange={(e) => setToDate(e.target.value)}
          size="small"
          InputLabelProps={{ shrink: true }}
          sx={dateSx}
        />

        <Box sx={{ ml: 'auto' }}>
          <GhostButton onClick={handleExportCSV}>Export CSV</GhostButton>
        </Box>
      </Box>

      {/* Table */}
      <DataTable
        columns={columns}
        loading={loading}
        totalCount={totalCount}
        shownCount={shownCount}
        page={page}
        onPrevPage={onPrevPage}
        onNextPage={onNextPage}
        hasNextPage={hasNextPage}
        emptyMessage="No audit log entries found."
      >
        {items.map((entry: AuditLogEntry) => (
          <DataTableRow key={entry.id} columns={columns} onClick={() => setDetailEntry(entry)}>
            <Typography sx={{ fontSize: 12.5, color: (theme) => theme.palette.text.secondary, fontFamily: 'monospace' }}>
              {formatTimestamp(entry.created_at)}
            </Typography>
            <Typography sx={{ fontSize: 13, fontWeight: 500, color: (theme) => theme.palette.text.primary }}>
              {entry.username || entry.user_id || '--'}
            </Typography>
            <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.primary }}>
              {formatAction(entry.action)}
            </Typography>
            <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
              {entry.entity_type || '--'}
            </Typography>
            <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary, fontFamily: 'monospace' }}>
              {entry.entity_id ?? '--'}
            </Typography>
            <Typography sx={{ fontSize: 12.5, color: (theme) => theme.palette.text.secondary, fontFamily: 'monospace' }}>
              {entry.ip_address || '--'}
            </Typography>
            <Typography
              sx={{ fontSize: 12, color: (theme) => theme.palette.text.secondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              title={typeof entry.details === 'object' ? JSON.stringify(entry.details) : String(entry.details || '')}
            >
              {truncateDetails(entry.details)}
            </Typography>
          </DataTableRow>
        ))}
      </DataTable>

      {/* Detail Dialog */}
      <Dialog open={Boolean(detailEntry)} onClose={() => setDetailEntry(null)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Audit Log Detail</DialogTitle>
        <DialogContent>
          {detailEntry && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
                <Box>
                  <Typography sx={{ fontSize: 11, color: (theme) => theme.palette.text.secondary, mb: 0.25 }}>Timestamp</Typography>
                  <Typography sx={{ fontSize: 13, fontFamily: 'monospace' }}>{formatTimestamp(detailEntry.created_at)}</Typography>
                </Box>
                <Box>
                  <Typography sx={{ fontSize: 11, color: (theme) => theme.palette.text.secondary, mb: 0.25 }}>User</Typography>
                  <Typography sx={{ fontSize: 13 }}>{detailEntry.username || detailEntry.user_id || '--'}</Typography>
                </Box>
                <Box>
                  <Typography sx={{ fontSize: 11, color: (theme) => theme.palette.text.secondary, mb: 0.25 }}>Action</Typography>
                  <Typography sx={{ fontSize: 13 }}>{formatAction(detailEntry.action)}</Typography>
                </Box>
                <Box>
                  <Typography sx={{ fontSize: 11, color: (theme) => theme.palette.text.secondary, mb: 0.25 }}>Entity</Typography>
                  <Typography sx={{ fontSize: 13 }}>{detailEntry.entity_type || '--'} {detailEntry.entity_id != null ? `#${detailEntry.entity_id}` : ''}</Typography>
                </Box>
                <Box>
                  <Typography sx={{ fontSize: 11, color: (theme) => theme.palette.text.secondary, mb: 0.25 }}>IP Address</Typography>
                  <Typography sx={{ fontSize: 13, fontFamily: 'monospace' }}>{detailEntry.ip_address || '--'}</Typography>
                </Box>
              </Box>
              <Box>
                <Typography sx={{ fontSize: 11, color: (theme) => theme.palette.text.secondary, mb: 0.5 }}>Details (JSON)</Typography>
                <Box
                  sx={{
                    p: 1.5,
                    borderRadius: '8px',
                    bgcolor: (theme) => theme.palette.action.hover,
                    fontFamily: 'monospace',
                    fontSize: 12,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    maxHeight: 300,
                    overflow: 'auto',
                  }}
                >
                  {detailEntry.details
                    ? JSON.stringify(typeof detailEntry.details === 'string' ? JSON.parse(detailEntry.details) : detailEntry.details, null, 2)
                    : 'No details recorded'}
                </Box>
              </Box>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDetailEntry(null)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default AuditLogViewer;
