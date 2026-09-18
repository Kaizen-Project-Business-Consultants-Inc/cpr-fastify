import React, { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Typography,
  MenuItem,
  Select,
  FormControl,
  InputLabel,
} from '@mui/material';
import type { SelectChangeEvent } from '@mui/material';
import { sysAdminApi } from '../../services/api';
import api from '../../services/api';
import StatCard from '../gtacpr/StatCard';
import StatusChip from '../gtacpr/StatusChip';
import DataTable, { DataTableRow } from '../gtacpr/DataTable';
import SearchBar from '../gtacpr/SearchBar';
import { GhostButton } from '../gtacpr/Buttons';
import { useDebounce } from '../../hooks/useDebounce';
import { useServerPagination } from '../../hooks/useServerPagination';

interface WSIBReportingProps {
  onShowSnackbar: (message: string, severity: 'success' | 'error' | 'warning' | 'info') => void;
}

interface TrainingRecord {
  first_name: string;
  last_name: string;
  email: string;
  organization_name: string | null;
  course_type_name: string;
  course_date: string | null;
  location: string | null;
  attended: boolean | number;
  certificate_number: string | null;
  certificate_issued_at: string | null;
  certificate_expires_at: string | null;
  compliance_status: 'valid' | 'expiring' | 'expired';
  instructor_name: string | null;
}

interface ComplianceSummary {
  total_trained: number;
  current_certs: number;
  expired_certs: number;
  expiring_30d: number;
  expiring_60d: number;
  expiring_90d: number;
  compliance_rate: number;
  trained_last_12mo: number;
  top_organizations: Array<{ organization_name: string; student_count: number }>;
}

interface OrgOption {
  id: number;
  name: string;
}

interface CourseTypeOption {
  id: number;
  name: string;
}

const columns = [
  { key: 'student', label: 'STUDENT', width: '1.4fr' },
  { key: 'organization', label: 'ORGANIZATION', width: '1.1fr' },
  { key: 'course', label: 'COURSE', width: '1.1fr' },
  { key: 'date', label: 'COMPLETION DATE', width: '0.9fr' },
  { key: 'cert', label: 'CERT #', width: '0.9fr' },
  { key: 'expires', label: 'CERT EXPIRES', width: '0.9fr' },
  { key: 'status', label: 'STATUS', width: '0.7fr', align: 'right' as const },
];

function getComplianceChip(status: string) {
  switch (status) {
    case 'valid':
      return <StatusChip kind="success" label="Valid" />;
    case 'expiring':
      return <StatusChip kind="warning" label="Expiring" />;
    case 'expired':
    default:
      return <StatusChip kind="danger" label="Expired" />;
  }
}

const WSIBReporting = ({ onShowSnackbar }: WSIBReportingProps) => {
  const [summary, setSummary] = useState<ComplianceSummary | null>(null);

  // Filters — all four are honoured server-side by
  // `/sysadmin/wsib/training-history`, so they narrow the whole report.
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const [orgId, setOrgId] = useState('');
  const [courseTypeId, setCourseTypeId] = useState('');
  const [complianceStatus, setComplianceStatus] = useState('');

  const grid = useServerPagination<TrainingRecord>({
    pageSize: 25,
    fetchFn: ({ page, limit }) => {
      const params: {
        page: number; limit: number; search?: string;
        org_id?: number; course_type_id?: number; compliance_status?: string;
      } = { page, limit };
      if (debouncedSearch) params.search = debouncedSearch;
      if (orgId) params.org_id = Number(orgId);
      if (courseTypeId) params.course_type_id = Number(courseTypeId);
      if (complianceStatus) params.compliance_status = complianceStatus;
      return sysAdminApi.getWSIBTrainingHistory(params);
    },
    onError: () => onShowSnackbar('Failed to load training history', 'error'),
  });
  const records = grid.items;

  // Dropdown options
  const [organizations, setOrganizations] = useState<OrgOption[]>([]);
  const [courseTypes, setCourseTypes] = useState<CourseTypeOption[]>([]);

  // Load dropdown options
  useEffect(() => {
    const loadOptions = async () => {
      try {
        const [orgRes, courseRes] = await Promise.all([
          sysAdminApi.getOrganizations({ limit: 200 }),
          sysAdminApi.getCourses(),
        ]);
        setOrganizations((orgRes.data || []).map((o: { id: number; name: string }) => ({ id: o.id, name: o.name })));
        setCourseTypes((courseRes.data || []).map((c: { id: number; name: string }) => ({ id: c.id, name: c.name })));
      } catch {
        // Options are optional
      }
    };
    loadOptions();
  }, []);

  // Load summary
  const loadSummary = useCallback(async () => {
    try {
      const params: { org_id?: number } = {};
      if (orgId) params.org_id = Number(orgId);
      const res = await sysAdminApi.getWSIBComplianceSummary(params);
      setSummary(res.data);
    } catch {
      // Summary is optional
    }
  }, [orgId]);

  // Mount-time fetch of the compliance summary stat cards (external API
  // sync, not state derived from render data), so a direct setState inside
  // is expected.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadSummary(); }, [loadSummary]);

  // Any filter change resets to page 1; `load` has a stable identity.
  const loadHistory = grid.load;
  useEffect(() => {
    loadHistory(1);
  }, [loadHistory, debouncedSearch, orgId, courseTypeId, complianceStatus]);

  const handleExportCSV = async () => {
    try {
      const params: Record<string, string> = {};
      if (debouncedSearch) params.search = debouncedSearch;
      if (orgId) params.org_id = orgId;
      if (courseTypeId) params.course_type_id = courseTypeId;
      if (complianceStatus) params.compliance_status = complianceStatus;

      const response = await api.get('/sysadmin/wsib/export/csv', {
        params,
        responseType: 'blob',
      });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `wsib-compliance-${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch {
      onShowSnackbar('Failed to export training history', 'error');
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '\u2014';
    return new Date(dateStr).toLocaleDateString();
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Stat cards */}
      {summary && (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(5, 1fr)' }, gap: '16px' }}>
          <StatCard label="Total Trained" value={Number(summary.total_trained) || 0} sub="Students with training records" dotColor="#4B5563" />
          <StatCard label="Compliant" value={Number(summary.current_certs) || 0} sub="Valid certifications" dotColor="#16A34A" />
          <StatCard label="Expiring Soon" value={Number(summary.expiring_90d) || 0} sub="Within 90 days" dotColor="#ED6C02" />
          <StatCard label="Expired" value={Number(summary.expired_certs) || 0} sub="Lapsed certifications" dotColor="#CC1F1F" />
          <StatCard label="Compliance Rate" value={`${summary.compliance_rate ?? 0}%`} sub="Currently compliant" dotColor="#2563EB" />
        </Box>
      )}

      {/* Filter bar */}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'center' }}>
        <Box sx={{ flex: '1 1 200px', minWidth: 200 }}>
          <SearchBar
            value={search}
            onChange={setSearch}
            placeholder="Search by student name or email..."
          />
        </Box>
        <FormControl size="small" sx={{ minWidth: 160 }}>
          <InputLabel>Organization</InputLabel>
          <Select
            value={orgId}
            onChange={(e: SelectChangeEvent) => setOrgId(e.target.value)}
            label="Organization"
          >
            <MenuItem value="">All Organizations</MenuItem>
            {organizations.map(org => (
              <MenuItem key={org.id} value={String(org.id)}>{org.name}</MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 140 }}>
          <InputLabel>Course Type</InputLabel>
          <Select
            value={courseTypeId}
            onChange={(e: SelectChangeEvent) => setCourseTypeId(e.target.value)}
            label="Course Type"
          >
            <MenuItem value="">All Courses</MenuItem>
            {courseTypes.map(ct => (
              <MenuItem key={ct.id} value={String(ct.id)}>{ct.name}</MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 150 }}>
          <InputLabel>Compliance Status</InputLabel>
          <Select
            value={complianceStatus}
            onChange={(e: SelectChangeEvent) => setComplianceStatus(e.target.value)}
            label="Compliance Status"
          >
            <MenuItem value="">All Statuses</MenuItem>
            <MenuItem value="valid">Valid</MenuItem>
            <MenuItem value="expiring">Expiring</MenuItem>
            <MenuItem value="expired">Expired</MenuItem>
          </Select>
        </FormControl>
        <GhostButton onClick={handleExportCSV}>Export CSV</GhostButton>
      </Box>

      {/* Table */}
      <DataTable
        columns={columns}
        shownCount={grid.shownCount}
        totalCount={grid.totalCount}
        page={grid.page}
        onPrevPage={grid.onPrevPage}
        onNextPage={grid.onNextPage}
        hasNextPage={grid.hasNextPage}
        loading={grid.loading}
        emptyMessage="No training records found. Adjust your filters and try again."
      >
          {records.map((rec, i) => (
            <DataTableRow key={`${rec.email}-${rec.course_date}-${i}`} columns={columns}>
              {/* STUDENT */}
              <Box>
                <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: (theme) => theme.palette.text.primary }}>
                  {rec.first_name} {rec.last_name}
                </Typography>
                <Typography sx={{ fontSize: 11.5, color: (theme) => theme.palette.text.secondary }}>
                  {rec.email}
                </Typography>
              </Box>
              {/* ORGANIZATION */}
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
                {rec.organization_name || '\u2014'}
              </Typography>
              {/* COURSE */}
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
                {rec.course_type_name}
              </Typography>
              {/* COMPLETION DATE */}
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.primary }}>
                {formatDate(rec.course_date)}
              </Typography>
              {/* CERT # */}
              <Typography sx={{ fontSize: 12, fontFamily: 'monospace', color: (theme) => theme.palette.text.secondary }}>
                {rec.certificate_number || '\u2014'}
              </Typography>
              {/* CERT EXPIRES */}
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.primary }}>
                {formatDate(rec.certificate_expires_at)}
              </Typography>
              {/* STATUS */}
              <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                {getComplianceChip(rec.compliance_status)}
              </Box>
          </DataTableRow>
        ))}
      </DataTable>
    </Box>
  );
};

export default WSIBReporting;
