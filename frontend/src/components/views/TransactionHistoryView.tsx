import React, { useState, useEffect, useCallback, useMemo } from 'react';
import logger from '../../utils/logger';
import {
  Box,
  Typography,
  CircularProgress,
  Alert,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
} from '@mui/material';
import * as api from '../../services/api';
import InvoiceHistoryTable from '../tables/InvoiceHistoryTable';
import InvoiceStatsDashboard from '../dashboard/InvoiceStatsDashboard';
import StatCard from '../gtacpr/StatCard';
import { GhostButton } from '../gtacpr/Buttons';
import useServerPagination from '../../hooks/useServerPagination';
import useDebounce from '../../hooks/useDebounce';
import { getErrorMessage } from '../../utils/errorMessage';

interface TransactionInvoice {
  invoiceId: number | string;
  invoiceNumber?: string;
  invoiceDate?: string;
  organizationId?: number;
  organizationName?: string;
  courseTypeName?: string;
  paymentStatus?: string;
  amount?: number | string;
  paidToDate?: number | string;
  balanceDue?: number | string;
  [key: string]: unknown;
}

interface OrganizationOption {
  id: number | string;
  name: string;
}

const PAGE_SIZE = 25;
/**
 * The summary figures below the table are financial totals over EVERY invoice,
 * not just the page on screen, so they are computed from a separate whole-set
 * fetch. `/accounting/invoices` caps `limit` at 200 (backend MAX_LIMIT), so the
 * whole-set fetch walks the pages instead of asking for one huge page.
 */
const SUMMARY_PAGE_SIZE = 200;
const SUMMARY_MAX_ROWS = 10000;

const TransactionHistoryView = () => {
  const [allInvoices, setAllInvoices] = useState<TransactionInvoice[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [organizations, setOrganizations] = useState<OrganizationOption[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState('');
  const [selectedMonth, setSelectedMonth] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('');

  const debouncedSearch = useDebounce(searchTerm, 300);

  // Server-paginated rows for the table.
  const grid = useServerPagination<TransactionInvoice>({
    pageSize: PAGE_SIZE,
    fetchFn: ({ page, limit }) => api.getInvoices({ page, limit }),
    onError: (err) => logger.error('Error loading invoice history:', err),
  });

  // Whole-set fetch that backs the summary figures (all pages, bounded).
  const fetchAllInvoices = useCallback(async () => {
    try {
      const first = await api.getInvoices({ page: 1, limit: SUMMARY_PAGE_SIZE });
      const rows: TransactionInvoice[] = [...(first?.data ?? [])];
      const pages = first?.pagination?.pages ?? 1;
      const maxPages = Math.min(pages, Math.ceil(SUMMARY_MAX_ROWS / SUMMARY_PAGE_SIZE));
      if (maxPages > 1) {
        const rest = await Promise.all(
          Array.from({ length: maxPages - 1 }, (_, i) =>
            api.getInvoices({ page: i + 2, limit: SUMMARY_PAGE_SIZE })
          )
        );
        rest.forEach((r) => rows.push(...(r?.data ?? [])));
      }
      setAllInvoices(rows);
    } catch (err) {
      logger.error('Error loading invoice totals:', getErrorMessage(err));
      setAllInvoices([]);
    }
  }, []);

  const fetchOrganizations = useCallback(async () => {
    try {
      const orgData = await api.getOrganizations();
      const orgs = orgData?.data || orgData || [];
      setOrganizations(Array.isArray(orgs) ? orgs : []);
    } catch (err) {
      logger.error('Error fetching organizations for filter:', getErrorMessage(err));
      setOrganizations([]);
    }
  }, []);

  // `grid` is a new object every render; `grid.load` is the stable piece of it
  // (see useServerPagination), so that's the correct dependency — adding the
  // whole `grid` object would re-fire this effect every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { grid.load(1); }, [grid.load]);
  // Genuine fetch-on-mount synchronization with the server (not state derived
  // from props/render data): the setState calls happen asynchronously, after
  // each function's own `await`, not synchronously in the effect body — this
  // is the standard data-fetching-effect pattern.
  // eslint-disable-next-line react-hooks/set-state-in-effect -- see comment above
  useEffect(() => { fetchAllInvoices(); fetchOrganizations(); }, [fetchAllInvoices, fetchOrganizations]);

  const handleRefresh = useCallback(() => {
    grid.reload();
    fetchAllInvoices();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- grid.reload is the stable piece of `grid`; see note above
  }, [grid.reload, fetchAllInvoices]);

  /**
   * `/accounting/invoices` accepts only `page`/`limit` — it has no search,
   * organization, month or status parameters — so these filters run in the
   * browser. They are applied to the whole set for the summary figures and to
   * the current page for the rows on screen (the panel says so).
   */
  const applyFilters = useCallback((list: TransactionInvoice[]) => {
    let result = [...list];
    if (debouncedSearch) {
      const lower = debouncedSearch.toLowerCase();
      result = result.filter(inv => inv.invoiceNumber?.toLowerCase().includes(lower) || inv.courseTypeName?.toLowerCase().includes(lower) || inv.organizationName?.toLowerCase().includes(lower));
    }
    if (selectedOrgId) result = result.filter(inv => inv.organizationId === parseInt(selectedOrgId));
    if (selectedMonth) {
      try {
        const start = new Date(selectedMonth + '-01T00:00:00');
        const nextMonth = new Date(start);
        nextMonth.setMonth(start.getMonth() + 1);
        result = result.filter(inv => { if (!inv.invoiceDate) return false; const d = new Date(inv.invoiceDate); return d >= start && d < nextMonth; });
      } catch (e) { logger.error('Error parsing month filter date'); }
    }
    if (selectedStatus) result = result.filter(inv => inv.paymentStatus?.toLowerCase() === selectedStatus.toLowerCase());
    return result;
  }, [debouncedSearch, selectedOrgId, selectedMonth, selectedStatus]);

  /** Rows shown in the table: the current server page, filtered. */
  const pageInvoices = useMemo(() => applyFilters(grid.items), [applyFilters, grid.items]);
  /** Every matching invoice, for the summary figures. */
  const summaryInvoices = useMemo(() => applyFilters(allInvoices), [applyFilters, allInvoices]);

  const handleClearFilters = () => { setSearchTerm(''); setSelectedOrgId(''); setSelectedMonth(''); setSelectedStatus(''); };

  const errorMessage = grid.error
    ? getErrorMessage(grid.error, 'Failed to load invoice history.')
    : '';

  const totalPages = grid.meta.pages || 1;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Filters */}
      <Box sx={{ border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', bgcolor: (theme) => theme.palette.background.paper, p: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
          <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Filters</Typography>
          <GhostButton onClick={handleClearFilters}>Clear Filters</GhostButton>
        </Box>
        <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.text.secondary, mb: 2 }}>
          Filters apply to the totals below (all invoices) and to the rows on the current page.
        </Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' }, gap: 2 }}>
          <TextField fullWidth label="Search Invoice/Course/Org" size="small" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
          <FormControl fullWidth size="small">
            <InputLabel>Organization</InputLabel>
            <Select value={selectedOrgId} label="Organization" onChange={e => setSelectedOrgId(e.target.value)}>
              <MenuItem value="">All Organizations</MenuItem>
              {Array.isArray(organizations) && organizations.sort((a, b) => a.name.localeCompare(b.name)).map(org => <MenuItem key={org.id} value={org.id}>{org.name}</MenuItem>)}
            </Select>
          </FormControl>
          <TextField fullWidth label="Month" type="month" size="small" InputLabelProps={{ shrink: true }} value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)} />
          <FormControl fullWidth size="small">
            <InputLabel>Status</InputLabel>
            <Select value={selectedStatus} label="Status" onChange={e => setSelectedStatus(e.target.value)}>
              <MenuItem value="">All Statuses</MenuItem>
              <MenuItem value="Pending">Pending</MenuItem>
              <MenuItem value="Paid">Paid</MenuItem>
              <MenuItem value="Overdue">Overdue</MenuItem>
            </Select>
          </FormControl>
        </Box>
      </Box>

      {/* Only the first load blanks the screen — later pages keep the previous rows visible. */}
      {grid.loading && grid.items.length === 0 ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}><CircularProgress size={24} /></Box>
      ) : errorMessage ? (
        <Alert severity="error">{errorMessage}</Alert>
      ) : (
        <>
          {/* InvoiceStatsDashboard's own Invoice type (id/status/amount required) predates
              this file's TransactionInvoice shape and isn't exported to type-check against
              directly; the /accounting/invoices rows it actually receives here satisfy it
              at runtime (unchanged from before this typing pass). */}
          <InvoiceStatsDashboard invoices={summaryInvoices as unknown as React.ComponentProps<typeof InvoiceStatsDashboard>['invoices']} loading={grid.loading} />
          <InvoiceHistoryTable invoices={pageInvoices} onRefresh={handleRefresh} />

          {/* Server-driven paging for the table above */}
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
            <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.text.secondary }} aria-live="polite">
              {`Page ${grid.meta.page} of ${totalPages} — showing ${pageInvoices.length} of ${grid.shownCount} on this page, ${grid.totalCount} invoices in total`}
            </Typography>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <GhostButton size="small" onClick={grid.onPrevPage} disabled={grid.loading || grid.page === 0}>Prev</GhostButton>
              <GhostButton size="small" onClick={grid.onNextPage} disabled={grid.loading || !grid.hasNextPage}>Next</GhostButton>
            </Box>
          </Box>

          {summaryInvoices.length > 0 && (
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' }, gap: 2 }}>
              <StatCard label="Total Invoices" value={summaryInvoices.length} sub="All invoices" />
              <StatCard label="Total Amount" value={`$${summaryInvoices.reduce((sum, inv) => sum + (Number(inv.amount) || 0), 0).toFixed(2)}`} sub="All invoices" />
              <StatCard label="Total Paid" value={`$${summaryInvoices.reduce((sum, inv) => sum + (Number(inv.paidToDate) || 0), 0).toFixed(2)}`} sub="All invoices" dotColor="#16A34A" />
              <StatCard label="Total Outstanding" value={`$${summaryInvoices.reduce((sum, inv) => sum + (Number(inv.balanceDue ?? inv.amount) || 0), 0).toFixed(2)}`} sub="All invoices" dotColor="#CC1F1F" />
            </Box>
          )}
        </>
      )}
    </Box>
  );
};

export default TransactionHistoryView;
