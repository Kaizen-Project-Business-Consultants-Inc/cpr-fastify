import React, { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Typography,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Alert,
  CircularProgress,
  Tabs,
  Tab,
  Grid,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
} from '@mui/material';
import { Close as CloseIcon } from '@mui/icons-material';
import api, { vendorApi } from '../../../services/api';
import { useVendorInvoiceUpdates } from '../../../hooks/useVendorInvoiceUpdates';
import useServerPagination from '../../../hooks/useServerPagination';
import useDebounce from '../../../hooks/useDebounce';
import StatCard from '../../gtacpr/StatCard';
import SearchBar from '../../gtacpr/SearchBar';
import DataTable, { DataTableRow } from '../../gtacpr/DataTable';
import StatusChip from '../../gtacpr/StatusChip';
import { GhostButton, PrimaryButton } from '../../gtacpr/Buttons';
import LinkButton from '../../gtacpr/LinkButton';
import { useConfirm } from '../../gtacpr/ConfirmDialog';
import { useSnackbar } from '../../../contexts/SnackbarContext';
import { formatCurrency, formatDisplayDate } from '../../../utils/formatters';

interface Invoice {
  id: number;
  invoiceNumber: string;
  item?: string;
  company?: string;
  billingCompany?: string;
  quantity?: number | null;
  description: string;
  rate: number;
  amount: number;
  subtotal: number;
  hst: number;
  total: number;
  status: string;
  createdAt: string;
  dueDate?: string;
  paymentDate?: string;
  pdfFilename?: string;
  vendorName?: string;
  vendorEmail?: string;
  vendorContact?: string;
  totalPaid?: number | string;
  balanceDue?: number | string;
  adminNotes?: string;
  approvedByName?: string;
  approvedByEmail?: string;
  sentToAccountingAt?: string;
  paidAt?: string;
  bankName?: string;
}

interface PaymentHistory {
  id: number;
  amount: number;
  paymentDate: string;
  paymentMethod: string;
  referenceNumber: string;
  notes: string;
  status: string;
  processedAt: string;
  processedByName: string;
}

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

type StatusKind = 'warning' | 'pending' | 'success' | 'active' | 'danger' | 'neutral' | 'brand' | 'inactive';

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;
  return (
    <div role="tabpanel" hidden={value !== index} id={`invoice-tabpanel-${index}`} aria-labelledby={`invoice-tab-${index}`} {...other}>
      {value === index && <Box sx={{ py: 3 }}>{children}</Box>}
    </div>
  );
}

const tableColumns = [
  { key: 'date', label: 'DATE', width: '0.7fr' },
  { key: 'company', label: 'BILLING COMPANY', width: '1fr' },
  { key: 'invoice', label: 'INVOICE #', width: '0.8fr' },
  { key: 'qty', label: 'QTY', width: '0.4fr', align: 'right' as const },
  { key: 'item', label: 'ITEM', width: '0.7fr' },
  { key: 'description', label: 'DESCRIPTION', width: '1.2fr' },
  { key: 'rate', label: 'RATE', width: '0.7fr', align: 'right' as const },
  { key: 'amount', label: 'AMOUNT', width: '0.7fr', align: 'right' as const },
  { key: 'subtotal', label: 'SUBTOTAL', width: '0.7fr', align: 'right' as const },
  { key: 'hst', label: 'HST', width: '0.6fr', align: 'right' as const },
  { key: 'total', label: 'TOTAL', width: '0.7fr', align: 'right' as const },
  { key: 'status', label: 'STATUS', width: '0.8fr' },
  { key: 'due', label: 'DUE DATE', width: '0.7fr' },
  { key: 'actions', label: '', width: '0.6fr', align: 'right' as const },
];

/** Coerce a value the API may send as a string (or omit) into a number. */
const toNumber = (value: unknown): number => {
  if (typeof value === 'string') return parseFloat(value) || 0;
  if (typeof value === 'number') return value;
  return 0;
};

const toIntOrNull = (value: unknown): number | null => {
  if (typeof value === 'string') return parseInt(value, 10) || null;
  if (typeof value === 'number') return value;
  return null;
};

/** Normalise the numeric columns the API returns as strings. */
const processInvoices = (raw: Record<string, unknown>[]): Invoice[] =>
  raw.map((invoice) => ({
    ...invoice,
    rate: toNumber(invoice.rate),
    amount: toNumber(invoice.amount),
    subtotal: toNumber(invoice.subtotal),
    hst: toNumber(invoice.hst),
    total: toNumber(invoice.total),
    quantity: toIntOrNull(invoice.quantity),
  })) as Invoice[];

/**
 * Tab -> the single status GET /vendor/invoices can filter on server-side.
 * Tab 4 ("All") needs no status. Tab 5 ("Non-Paid") is `status != 'paid'`,
 * which the endpoint cannot express, so that one exclusion stays client-side
 * and is called out in the UI.
 */
const TAB_STATUS: Record<number, string | undefined> = {
  0: 'pending_submission',
  1: 'submitted_to_admin',
  2: 'submitted_to_accounting',
  3: 'paid',
  4: undefined,
  5: undefined,
};

const InvoiceHistory: React.FC = () => {
  // Full, unpaged list — used ONLY for the summary cards and the tab counts so
  // those stay grand totals rather than per-page totals. Sent with no
  // page/limit, which is how the endpoint opts out of pagination.
  const [allInvoices, setAllInvoices] = useState<Invoice[]>([]);
  const [statsLoading, setStatsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [tabValue, setTabValue] = useState(5);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [paymentHistory, setPaymentHistory] = useState<PaymentHistory[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const { confirm, dialog: confirmDialog } = useConfirm();
  const { showSuccess, showError } = useSnackbar();

  const debouncedSearch = useDebounce(search, 300);

  // The Status select and the tab both narrow by status; when they disagree the
  // old client-side AND produced an empty list, so keep that.
  const tabStatus = TAB_STATUS[tabValue];
  const conflictingStatus = !!statusFilter && !!tabStatus && statusFilter !== tabStatus;
  const serverStatus = statusFilter || tabStatus;

  const grid = useServerPagination<Invoice>({
    pageSize: 25,
    fetchFn: ({ page, limit }) =>
      api
        .get('/vendor/invoices', {
          params: {
            page,
            limit,
            status: serverStatus || undefined,
            search: debouncedSearch || undefined,
          },
        })
        .then((r) => {
          const body = r.data;
          const rows = Array.isArray(body) ? body : body?.data ?? [];
          return Array.isArray(body)
            ? processInvoices(rows)
            : { ...body, data: processInvoices(rows) };
        }),
    onError: (err) => {
      console.error('Error fetching invoices:', err);
      setError('Failed to fetch invoices');
    },
  });

  /** Full list behind the summary cards and tab counts (never paged). */
  const fetchAllInvoices = useCallback(async () => {
    try {
      setStatsLoading(true);
      setError(null);
      const response = await vendorApi.getInvoices();
      const rawInvoices: Record<string, unknown>[] = Array.isArray(response)
        ? response
        : Array.isArray(response?.data)
          ? response.data
          : [];
      setAllInvoices(processInvoices(rawInvoices));
    } catch (err: unknown) {
      console.error('Error fetching invoices:', err);
      setError('Failed to fetch invoices');
      setAllInvoices([]);
    } finally {
      setStatsLoading(false);
    }
  }, []);

  /** After a mutation: refresh the totals and re-fetch the page on screen. */
  const refreshAll = useCallback(() => {
    fetchAllInvoices();
    grid.reload();
    // `grid` is a new object every render; useServerPagination keeps `grid.reload` itself
    // stable, which is the intended dep (see the hook's own usage example).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchAllInvoices, grid.reload]);

  useEffect(() => {
    // tabValue's initial state is already 5 ("All"), so this is a no-op on mount; kept
    // only to reset the tab if this effect ever gains real mount-time dependencies.
    fetchAllInvoices();
    // Intentionally mount-only: loads the summary totals once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    grid.load(1);
    // `grid` is a new object every render; useServerPagination keeps `grid.load` itself
    // stable, which is the intended dep (see the hook's own usage example).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grid.load, serverStatus, debouncedSearch]);

  const { isConnected } = useVendorInvoiceUpdates({
    onStatusUpdate: () => {},
    onNotesUpdate: () => {},
    onRefresh: refreshAll,
  });

  if (statsLoading && grid.items.length === 0) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400 }}>
        <CircularProgress size={48} />
      </Box>
    );
  }

  const getStatusKind = (status: string): StatusKind => {
    switch (status) {
      case 'pending_submission': return 'neutral';
      case 'submitted_to_admin': return 'warning';
      case 'submitted_to_accounting': return 'pending';
      case 'rejected_by_admin': return 'danger';
      case 'rejected_by_accountant': return 'danger';
      case 'paid': return 'success';
      default: return 'neutral';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'pending_submission': return 'Pending';
      case 'submitted_to_admin': return 'To Admin';
      case 'submitted_to_accounting': return 'To Accounting';
      case 'rejected_by_admin': return 'Rejected (Admin)';
      case 'rejected_by_accountant': return 'Rejected (Acct)';
      case 'paid': return 'Paid';
      default: return status.replace(/_/g, ' ');
    }
  };

  const formatDate = (date: string) => formatDisplayDate(date);

  const handleDownload = async (invoiceId: number, invoiceNumber: string) => {
    try {
      const blob = await vendorApi.downloadInvoice(invoiceId);
      if (blob.size === 0) throw new Error('Invoice file is empty');
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `invoice-${invoiceNumber}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch {
      showError('Failed to download invoice');
    }
  };

  const handleView = async (invoiceId: number) => {
    try {
      const response = await vendorApi.getInvoiceDetailsWithPayments(invoiceId);
      setSelectedInvoice(response.data || response);
      if (response.data && response.data.payments) {
        setPaymentHistory(response.data.payments);
      } else {
        setPaymentHistory([]);
      }
      setViewDialogOpen(true);
    } catch {
      showError('Failed to load invoice details');
    }
  };

  const handleCloseViewDialog = () => { setViewDialogOpen(false); setSelectedInvoice(null); };

  const handleSubmitToAdmin = async (invoice: Invoice) => {
    if (submitting) return;
    const ok = await confirm({
      title: 'Submit to admin?',
      message: `Invoice ${invoice.invoiceNumber} (${formatCurrency(invoice.total)}) will be sent to admin for review. You will not be able to edit it afterwards.`,
      confirmLabel: 'Submit to Admin',
    });
    if (!ok) return;
    setSubmitting(true);
    try {
      await vendorApi.submitToAdmin(invoice.id);
      showSuccess(`Invoice ${invoice.invoiceNumber} submitted to admin`);
      handleCloseViewDialog();
      refreshAll();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      showError(axiosErr.response?.data?.error || 'Failed to submit invoice to admin');
    } finally {
      setSubmitting(false);
    }
  };

  const handleTabChange = (_event: React.SyntheticEvent, newValue: number) => { setTabValue(newValue); };

  // Search and status are applied by the server (GET /vendor/invoices accepts
  // `search` and `status`), so the page that comes back is already narrowed.
  // The only thing left client-side is the "Non-Paid" tab's `status != 'paid'`
  // exclusion, which the endpoint cannot express — it therefore applies to the
  // rows on the current page, and the tab says so.
  const visibleInvoices = conflictingStatus
    ? []
    : tabValue === 5
      ? grid.items.filter(i => i.status !== 'paid')
      : grid.items;

  // Summary stats and tab counts come from the full, unpaged list so they stay
  // grand totals and never shrink to the current page.
  const sumByStatus = (statuses: string[]) =>
    allInvoices.filter(i => statuses.includes(i.status)).reduce((sum, i) => sum + ((i.total && !isNaN(i.total) && i.total > 0) ? i.total : 0), 0);
  const countByStatus = (statuses: string[]) => allInvoices.filter(i => statuses.includes(i.status)).length;

  const renderInvoiceTable = () => (
    <>
      {tabValue === 5 && (
        <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.text.secondary, mb: 1 }}>
          This list is paged. &ldquo;Non-Paid&rdquo; hides paid invoices from the page currently loaded —
          use the Paid tab or the Status filter for a server-side search across every invoice.
        </Typography>
      )}
      <DataTable
        columns={tableColumns}
        shownCount={visibleInvoices.length}
        totalCount={grid.totalCount}
        page={grid.page}
        hasNextPage={grid.hasNextPage}
        onPrevPage={grid.onPrevPage}
        onNextPage={grid.onNextPage}
        loading={grid.loading}
        emptyMessage="No invoices found for this view."
      >
        {visibleInvoices.map(invoice => (
          <DataTableRow key={invoice.id} columns={tableColumns}>
            <Typography sx={{ fontSize: 12.5, color: (theme) => theme.palette.text.secondary }}>{formatDate(invoice.createdAt)}</Typography>
            <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{invoice.billingCompany || invoice.company || '—'}</Typography>
            <Typography sx={{ fontSize: 13, fontWeight: 600, color: (theme) => theme.palette.text.primary, fontFamily: 'monospace' }}>{invoice.invoiceNumber}</Typography>
            <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary, textAlign: 'right' }}>{invoice.quantity || '—'}</Typography>
            <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{invoice.item || '—'}</Typography>
            <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={invoice.description}>{invoice.description}</Typography>
            <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary, fontFamily: 'monospace', textAlign: 'right' }}>
              {invoice.rate > 0 ? formatCurrency(invoice.rate) : '—'}
            </Typography>
            <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary, fontFamily: 'monospace', textAlign: 'right' }}>
              {invoice.amount > 0 ? formatCurrency(invoice.amount) : (invoice.total > 0 ? formatCurrency(invoice.total) : '—')}
            </Typography>
            <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary, fontFamily: 'monospace', textAlign: 'right' }}>
              {invoice.subtotal > 0 ? formatCurrency(invoice.subtotal) : '—'}
            </Typography>
            <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary, fontFamily: 'monospace', textAlign: 'right' }}>
              {invoice.hst > 0 ? formatCurrency(invoice.hst) : '—'}
            </Typography>
            <Typography sx={{ fontSize: 14, fontWeight: 700, color: (theme) => theme.palette.text.primary, fontFamily: 'monospace', textAlign: 'right' }}>
              {invoice.total > 0 ? formatCurrency(invoice.total) : '—'}
            </Typography>
            <StatusChip kind={getStatusKind(invoice.status)} label={getStatusLabel(invoice.status)} />
            <Typography sx={{ fontSize: 12.5, color: (theme) => theme.palette.text.secondary }}>{invoice.dueDate ? formatDate(invoice.dueDate) : '—'}</Typography>
            <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'flex-end' }}>
              <LinkButton onClick={() => handleView(invoice.id)} aria-label={`View invoice ${invoice.invoiceNumber}`}>View</LinkButton>
              <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.divider }} aria-hidden>|</Typography>
              <LinkButton tone="neutral" onClick={() => handleDownload(invoice.id, invoice.invoiceNumber)} aria-label={`Download PDF for invoice ${invoice.invoiceNumber}`}>PDF</LinkButton>
            </Box>
          </DataTableRow>
        ))}
      </DataTable>
    </>
  );

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Connection indicator */}
      <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
        <StatusChip kind={isConnected ? 'active' : 'danger'} label={isConnected ? 'Live Updates' : 'Offline'} />
      </Box>

      {/* Workflow Steps */}
      <Box sx={{ border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', p: 3, bgcolor: (theme) => theme.palette.background.default }}>
        <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.07em', mb: 2 }}>Invoice Workflow</Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
          {[
            { step: 1, label: 'You Upload', sub: 'Pending Submission', color: '#9CA3AF' },
            { step: 2, label: 'You Submit', sub: 'Submitted to Admin', color: '#ED6C02' },
            { step: 3, label: 'Admin Reviews', sub: 'Submitted to Accounting', color: '#CC1F1F' },
            { step: 4, label: 'Accounting Pays', sub: 'Paid', color: '#16A34A' },
          ].map((s, i) => (
            <React.Fragment key={s.step}>
              {i > 0 && <Typography sx={{ color: (theme) => theme.palette.text.secondary, fontSize: 18 }}>→</Typography>}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                <Box sx={{ width: 36, height: 36, borderRadius: '50%', bgcolor: s.color, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 14 }}>{s.step}</Box>
                <Box>
                  <Typography sx={{ fontSize: 13, fontWeight: 600, color: (theme) => theme.palette.text.primary }}>{s.label}</Typography>
                  <Typography sx={{ fontSize: 11, color: (theme) => theme.palette.text.secondary }}>{s.sub}</Typography>
                </Box>
              </Box>
            </React.Fragment>
          ))}
        </Box>
      </Box>

      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

      {/* Summary Statistics */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(3, 1fr)', md: 'repeat(6, 1fr)' }, gap: '16px' }}>
        <StatCard label="Pending" value={countByStatus(['pending_submission'])} sub={formatCurrency(sumByStatus(['pending_submission']))} dotColor="#9CA3AF" />
        <StatCard label="To Admin" value={countByStatus(['submitted_to_admin'])} sub={formatCurrency(sumByStatus(['submitted_to_admin']))} dotColor="#ED6C02" />
        <StatCard label="To Accounting" value={countByStatus(['submitted_to_accounting'])} sub={formatCurrency(sumByStatus(['submitted_to_accounting']))} dotColor="#4B5563" />
        <StatCard label="Rejected" value={countByStatus(['rejected_by_admin', 'rejected_by_accountant'])} sub={formatCurrency(sumByStatus(['rejected_by_admin', 'rejected_by_accountant']))} dotColor="#CC1F1F" />
        <StatCard label="Paid" value={countByStatus(['paid'])} sub={formatCurrency(sumByStatus(['paid']))} dotColor="#16A34A" />
        <StatCard label="Total" value={allInvoices.length} sub={formatCurrency(sumByStatus(allInvoices.map(i => i.status)))} dotColor="#111827" />
      </Box>

      {/* Search and Filter */}
      <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
        <Box sx={{ flex: 1 }}>
          <SearchBar value={search} onChange={setSearch} placeholder="Search by invoice #, company, item, or description..." />
        </Box>
        <FormControl sx={{ minWidth: 200 }} size="small">
          <InputLabel>Status</InputLabel>
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} label="Status">
            <MenuItem value="">All Statuses</MenuItem>
            <MenuItem value="pending_submission">Pending Submission</MenuItem>
            <MenuItem value="submitted_to_admin">Submitted to Admin</MenuItem>
            <MenuItem value="submitted_to_accounting">Submitted to Accounting</MenuItem>
            <MenuItem value="rejected_by_admin">Rejected by Admin</MenuItem>
            <MenuItem value="rejected_by_accountant">Rejected by Accountant</MenuItem>
            <MenuItem value="paid">Paid</MenuItem>
          </Select>
        </FormControl>
        <GhostButton onClick={() => { setSearch(''); setStatusFilter(''); }}>Clear Filters</GhostButton>
      </Box>

      {/* Tabs */}
      <Box sx={{ borderBottom: 1, borderColor: (theme) => theme.palette.divider }}>
        <Tabs
          value={tabValue}
          onChange={handleTabChange}
          sx={{
            '& .MuiTab-root': { textTransform: 'none', fontSize: 13, fontWeight: 600, color: (theme) => theme.palette.text.secondary, minHeight: 42 },
            '& .Mui-selected': { color: '#CC1F1F !important' },
            '& .MuiTabs-indicator': { backgroundColor: '#CC1F1F' },
          }}
        >
          <Tab label={`Pending (${countByStatus(['pending_submission'])})`} />
          <Tab label={`To Admin (${countByStatus(['submitted_to_admin'])})`} />
          <Tab label={`To Accounting (${countByStatus(['submitted_to_accounting'])})`} />
          <Tab label={`Paid (${countByStatus(['paid'])})`} />
          <Tab label={`All (${allInvoices.length})`} />
          <Tab label={`Non-Paid (${allInvoices.filter(i => i.status !== 'paid').length})`} />
        </Tabs>
      </Box>

      {/* Tab Panels */}
      {[0, 1, 2, 3, 4, 5].map(idx => (
        <TabPanel key={idx} value={tabValue} index={idx}>
          {idx === 0 && (
            <Alert severity="info" sx={{ mb: 2 }}>
              <strong>Pending Submission:</strong> These invoices have been uploaded but not yet submitted to admin. Review them and click "Submit to Admin" when ready.
            </Alert>
          )}
          {idx === 1 && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              <strong>Submitted:</strong> These invoices have been submitted to admin for review. They are currently being processed.
            </Alert>
          )}
          {idx === 2 && (
            <Alert severity="info" sx={{ mb: 2 }}>
              <strong>Submitted to Accounting:</strong> These invoices have been approved by admin and are now with accounting for payment processing.
            </Alert>
          )}
          {idx === 3 && (
            <Alert severity="success" sx={{ mb: 2 }}>
              <strong>Invoices Paid:</strong> These invoices have been fully paid by accounting. The payment process is complete.
            </Alert>
          )}
          {idx === 4 && (
            <Alert severity="info" sx={{ mb: 2 }}>
              <strong>All Invoices:</strong> Complete view of all invoices across all statuses.
            </Alert>
          )}
          {idx === 5 && (
            <Alert severity="info" sx={{ mb: 2 }}>
              <strong>Pending Invoices:</strong> All invoices that are not yet fully paid, including pending, submitted, and rejected invoices.
            </Alert>
          )}
          {renderInvoiceTable()}
        </TabPanel>
      ))}

      {/* Invoice Detail Dialog */}
      <Dialog open={viewDialogOpen} onClose={handleCloseViewDialog} maxWidth="md" fullWidth sx={{ '& .MuiDialog-paper': { maxHeight: '90vh' } }}>
        <DialogTitle>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography sx={{ fontSize: 18, fontWeight: 700, color: (theme) => theme.palette.text.primary }}>
              Invoice #{selectedInvoice?.invoiceNumber}
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              {selectedInvoice && <StatusChip kind={getStatusKind(selectedInvoice.status)} label={getStatusLabel(selectedInvoice.status)} />}
              <IconButton onClick={handleCloseViewDialog} size="small" aria-label="Close invoice details"><CloseIcon /></IconButton>
            </Box>
          </Box>
        </DialogTitle>
        <DialogContent>
          {selectedInvoice && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, mt: 1 }}>
              {/* Invoice & Payment Summary */}
              <Box sx={{ border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', p: 3, bgcolor: (theme) => theme.palette.background.default }}>
                <Grid container spacing={3}>
                  <Grid item xs={12} md={6}>
                    <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.07em', mb: 1 }}>Invoice Information</Typography>
                    <Typography sx={{ fontSize: 14, fontWeight: 600, color: (theme) => theme.palette.text.primary, mb: 0.5 }}>Invoice #{selectedInvoice.invoiceNumber}</Typography>
                    <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary, mb: 0.5 }}>{selectedInvoice.billingCompany || selectedInvoice.company || '—'}</Typography>
                    <Typography sx={{ fontSize: 12.5, color: (theme) => theme.palette.text.secondary, mb: 0.5 }}>Created: {formatDate(selectedInvoice.createdAt)}</Typography>
                    {selectedInvoice.dueDate && <Typography sx={{ fontSize: 12.5, color: (theme) => theme.palette.text.secondary }}>Due: {formatDate(selectedInvoice.dueDate)}</Typography>}
                  </Grid>
                  <Grid item xs={12} md={6}>
                    <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.07em', mb: 1 }}>Payment Summary</Typography>
                    <Typography sx={{ fontSize: 20, fontWeight: 700, color: (theme) => theme.palette.text.primary, fontFamily: 'monospace', mb: 0.5 }}>
                      {formatCurrency(parseFloat(selectedInvoice.total?.toString() || '0') || 0)}
                    </Typography>
                    <Typography sx={{ fontSize: 13, color: '#16A34A', mb: 0.5 }}>
                      Paid: {formatCurrency(parseFloat(selectedInvoice.totalPaid?.toString() || '0'))}
                    </Typography>
                    <Typography sx={{ fontSize: 13, fontWeight: 600, color: '#ED6C02' }}>
                      Balance: {formatCurrency(parseFloat(selectedInvoice.balanceDue?.toString() || '0'))}
                    </Typography>
                  </Grid>
                </Grid>
              </Box>

              {/* Description */}
              <Box sx={{ border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', p: 3 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.07em', mb: 1 }}>Description</Typography>
                <Typography sx={{ fontSize: 14, color: (theme) => theme.palette.text.primary, p: 2, bgcolor: (theme) => theme.palette.background.default, borderRadius: 1 }}>{selectedInvoice.description}</Typography>
              </Box>

              {/* Approval Info */}
              <Box sx={{ border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', p: 3 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.07em', mb: 2 }}>Approval Information</Typography>
                <Grid container spacing={2}>
                  <Grid item xs={6}>
                    <Typography sx={{ fontSize: 11, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase' }}>Approved By</Typography>
                    <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.primary, mt: 0.5 }}>{selectedInvoice.approvedByName || '—'}</Typography>
                  </Grid>
                  <Grid item xs={6}>
                    <Typography sx={{ fontSize: 11, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase' }}>
                      {selectedInvoice.status === 'paid' ? 'Paid Date' : 'Sent to Accounting'}
                    </Typography>
                    <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.primary, mt: 0.5 }}>
                      {selectedInvoice.status === 'paid' && selectedInvoice.paidAt
                        ? formatDate(selectedInvoice.paidAt)
                        : selectedInvoice.sentToAccountingAt
                          ? formatDate(selectedInvoice.sentToAccountingAt)
                          : '—'}
                    </Typography>
                  </Grid>
                  {selectedInvoice.adminNotes && (
                    <Grid item xs={12}>
                      <Typography sx={{ fontSize: 11, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase' }}>Admin Notes</Typography>
                      <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.primary, mt: 0.5, p: 2, bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(245, 158, 11, 0.1)' : '#FEF3C7', borderRadius: 1 }}>{selectedInvoice.adminNotes}</Typography>
                    </Grid>
                  )}
                </Grid>
              </Box>

              {/* Payment Details */}
              <Box sx={{ border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', p: 3 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.07em', mb: 2 }}>Payment Details</Typography>
                <Grid container spacing={2}>
                  <Grid item xs={4}>
                    <Typography sx={{ fontSize: 11, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase' }}>Total Invoice</Typography>
                    <Typography sx={{ fontSize: 18, fontWeight: 700, color: (theme) => theme.palette.text.primary, fontFamily: 'monospace' }}>
                      {formatCurrency(parseFloat(selectedInvoice.total?.toString() || '0') || 0)}
                    </Typography>
                  </Grid>
                  <Grid item xs={4}>
                    <Typography sx={{ fontSize: 11, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase' }}>Amount Paid</Typography>
                    <Typography sx={{ fontSize: 18, fontWeight: 700, color: '#16A34A', fontFamily: 'monospace' }}>
                      {formatCurrency(parseFloat(selectedInvoice.totalPaid?.toString() || '0'))}
                    </Typography>
                  </Grid>
                  <Grid item xs={4}>
                    <Typography sx={{ fontSize: 11, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase' }}>Balance Due</Typography>
                    <Typography sx={{ fontSize: 18, fontWeight: 700, color: '#ED6C02', fontFamily: 'monospace' }}>
                      {formatCurrency(parseFloat(selectedInvoice.balanceDue?.toString() || '0'))}
                    </Typography>
                  </Grid>
                </Grid>

                {selectedInvoice.status === 'paid' && (
                  <Alert severity="success" sx={{ mt: 2 }}>
                    <strong>Payment Complete:</strong> This invoice has been fully paid.
                  </Alert>
                )}

                {/* Payment History Table */}
                {paymentHistory.length > 0 && (
                  <Box sx={{ mt: 3 }}>
                    <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.07em', mb: 2 }}>Payment History</Typography>
                    <DataTable
                      columns={[
                        { key: 'date', label: 'DATE', width: '1fr' },
                        { key: 'amount', label: 'AMOUNT', width: '1fr', align: 'right' as const },
                        { key: 'method', label: 'METHOD', width: '1fr' },
                        { key: 'ref', label: 'REFERENCE', width: '1fr' },
                        { key: 'by', label: 'PROCESSED BY', width: '1fr' },
                        { key: 'status', label: 'STATUS', width: '0.7fr' },
                      ]}
                      shownCount={paymentHistory.length}
                      totalCount={paymentHistory.length}
                    >
                      {paymentHistory.map(payment => (
                        <DataTableRow
                          key={payment.id}
                          columns={[
                            { key: 'date', label: 'DATE', width: '1fr' },
                            { key: 'amount', label: 'AMOUNT', width: '1fr', align: 'right' as const },
                            { key: 'method', label: 'METHOD', width: '1fr' },
                            { key: 'ref', label: 'REFERENCE', width: '1fr' },
                            { key: 'by', label: 'PROCESSED BY', width: '1fr' },
                            { key: 'status', label: 'STATUS', width: '0.7fr' },
                          ]}
                        >
                          <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.primary }}>{formatDate(payment.paymentDate)}</Typography>
                          <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.primary, fontFamily: 'monospace', textAlign: 'right' }}>{formatCurrency(payment.amount)}</Typography>
                          <Typography sx={{ fontSize: 12.5, color: (theme) => theme.palette.text.secondary }}>{payment.paymentMethod.replace(/_/g, ' ').toUpperCase()}</Typography>
                          <Typography sx={{ fontSize: 12.5, color: (theme) => theme.palette.text.secondary }}>{payment.referenceNumber || '—'}</Typography>
                          <Typography sx={{ fontSize: 12.5, color: (theme) => theme.palette.text.secondary }}>{payment.processedByName || 'Unknown'}</Typography>
                          <StatusChip kind={payment.status === 'processed' ? 'success' : 'warning'} label={payment.status} />
                        </DataTableRow>
                      ))}
                    </DataTable>
                  </Box>
                )}
              </Box>
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <GhostButton onClick={handleCloseViewDialog}>Close</GhostButton>
          {selectedInvoice && (
            <>
              <GhostButton onClick={() => handleDownload(selectedInvoice.id, selectedInvoice.invoiceNumber)}>Download PDF</GhostButton>
              {selectedInvoice.status === 'pending_submission' && (
                <PrimaryButton onClick={() => handleSubmitToAdmin(selectedInvoice)} disabled={submitting}>
                  {submitting ? 'Submitting…' : 'Submit to Admin'}
                </PrimaryButton>
              )}
            </>
          )}
        </DialogActions>
      </Dialog>

      {confirmDialog}
    </Box>
  );
}

export default InvoiceHistory;
