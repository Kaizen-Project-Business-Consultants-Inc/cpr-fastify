import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Typography,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Grid,
} from '@mui/material';
import { formatDisplayDate, formatCurrency, applyTax, getHSTLabel } from '../../../../utils/formatters';
import { api } from '../../../../services/api';
import { useSnackbar } from '../../../../contexts/SnackbarContext';
import logger from '../../../../utils/logger';
import useServerPagination from '../../../../hooks/useServerPagination';
import useDebounce from '../../../../hooks/useDebounce';
import StatCard from '../../../gtacpr/StatCard';
import DataTable, { DataTableRow } from '../../../gtacpr/DataTable';
import StatusChip from '../../../gtacpr/StatusChip';
import LinkButton from '../../../gtacpr/LinkButton';
import { PrimaryButton, GhostButton } from '../../../gtacpr/Buttons';

interface Invoice {
  id: number;
  invoice_number: string;
  created_at: string;
  due_date: string;
  amount: number;
  status: string;
  payment_status?: string;
  students_billed: number;
  paid_date?: string;
  location: string;
  course_type_name: string;
  course_date: string;
  course_request_id: number;
  amount_paid: number;
  balance_due: number;
  rate_per_student?: number;
  base_cost?: number;
  tax_amount?: number;
}

interface PaidInvoicesSummary {
  total_paid_invoices: number;
  total_paid_amount: number;
  average_paid_amount: number;
  paid_last_30_days: number;
  amount_paid_last_30_days: number;
}

interface OrganizationPaidInvoicesProps {
  /**
   * Kept for compatibility with the portal: this screen loads its own page from
   * `/organization/paid-invoices`. A new array identity (the parent refetching
   * after a payment) refreshes the page on screen.
   */
  invoices?: Invoice[];
  paidInvoicesSummary: PaidInvoicesSummary | undefined;
}

const columns = [
  { key: 'invoice', label: 'INVOICE #', width: '0.8fr' },
  { key: 'course', label: 'COURSE', width: '1fr' },
  { key: 'date', label: 'COURSE DATE', width: '0.8fr' },
  { key: 'location', label: 'LOCATION', width: '0.8fr' },
  { key: 'students', label: 'STUDENTS', width: '0.5fr', align: 'right' as const },
  { key: 'total', label: 'TOTAL', width: '0.6fr', align: 'right' as const },
  { key: 'paid', label: 'AMOUNT PAID', width: '0.7fr', align: 'right' as const },
  { key: 'paidDate', label: 'PAID DATE', width: '0.7fr' },
  { key: 'status', label: 'STATUS', width: '0.6fr' },
  { key: 'actions', label: '', width: '0.5fr', align: 'right' as const },
];

type PaymentDateFilter = '' | 'last_30' | 'last_90' | 'last_year';

const DAY_MS = 24 * 60 * 60 * 1000;

const getStatusKind = (status: string): 'success' | 'danger' | 'warning' | 'active' | 'neutral' => {
  switch (status?.toLowerCase()) {
    case 'paid': return 'success';
    case 'overdue': return 'danger';
    case 'pending': return 'warning';
    case 'payment_submitted': return 'active';
    default: return 'neutral';
  }
};

/**
 * `/organization/paid-invoices` answers
 * `{ success, data: { invoices, pagination: { current_page, total_pages, total_records, per_page } } }`,
 * so unwrap the nested list and rename the pagination keys for the hook.
 */
interface PaidInvoicesApiEnvelope {
  data?: {
    invoices?: Invoice[];
    pagination?: { current_page?: number; per_page?: number; total_records?: number; total_pages?: number };
  } | Invoice[];
}

const toEnvelope = (body: PaidInvoicesApiEnvelope) => {
  const payload = body?.data;
  const rows: Invoice[] = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.invoices)
      ? payload.invoices
      : [];
  const p = Array.isArray(payload) ? undefined : payload?.pagination;
  if (!p) return { data: rows };
  const limit = Number(p.per_page) || rows.length || 25;
  const total = Number(p.total_records ?? 0);
  return {
    data: rows,
    pagination: {
      page: Number(p.current_page) || 1,
      limit,
      total,
      pages: Number(p.total_pages) || (limit > 0 ? Math.ceil(total / limit) : 0),
    },
  };
};

const OrganizationPaidInvoices: React.FC<OrganizationPaidInvoicesProps> = ({
  invoices,
  paidInvoicesSummary,
}) => {
  const { showError } = useSnackbar();
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [courseTypeFilter, setCourseTypeFilter] = useState('');
  const [paymentDateFilter, setPaymentDateFilter] = useState<PaymentDateFilter>('');

  const debouncedSearch = useDebounce(searchTerm, 300);

  const grid = useServerPagination<Invoice>({
    pageSize: 25,
    fetchFn: ({ page, limit }) =>
      api.get('/organization/paid-invoices', { params: { page, limit } }).then((r) => toEnvelope(r.data)),
    onError: (err) => {
      logger.error('Error loading paid invoices:', err);
      showError('Failed to load paid invoices');
    },
  });

  const { load: gridLoad, reload: gridReload } = grid;

  useEffect(() => {
    gridLoad(1);
  }, [gridLoad]);

  // The parent invalidates its paid-invoice query after a payment; a new array
  // identity is the signal to re-fetch the page on screen.
  const didMount = useRef(false);
  useEffect(() => {
    if (!didMount.current) { didMount.current = true; return; }
    gridReload();
  }, [invoices, gridReload]);

  const safeInvoices = grid.items;

  // Course types come from the loaded page, never a hard-coded list
  const courseTypes = useMemo(
    () => Array.from(new Set(safeInvoices.map((i) => i.course_type_name).filter(Boolean))).sort(),
    [safeInvoices]
  );

  // `/organization/paid-invoices` takes page/limit and sort only — no search,
  // course-type or paid-date parameter — so these narrow the loaded page.
  const filteredInvoices = useMemo(() => {
    const term = debouncedSearch.trim().toLowerCase();
    // Date.now() is impure during render, but this filter needs "now" fresh on
    // every recompute (a stale/frozen value would silently exclude invoices
    // that age out of the last_30/last_90/last_year window as time passes).
    // eslint-disable-next-line react-hooks/purity -- intentional: filter must reflect the current time, not a frozen one
    const now = Date.now();
    const windowDays: Record<Exclude<PaymentDateFilter, ''>, number> = { last_30: 30, last_90: 90, last_year: 365 };

    return safeInvoices.filter((invoice) => {
      const matchesSearch =
        !term ||
        [invoice.invoice_number, invoice.course_type_name, invoice.location]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(term));

      const matchesCourseType = !courseTypeFilter || invoice.course_type_name === courseTypeFilter;

      let matchesPaymentDate = true;
      if (paymentDateFilter) {
        const paidAt = invoice.paid_date ? new Date(invoice.paid_date).getTime() : NaN;
        matchesPaymentDate = !Number.isNaN(paidAt) && now - paidAt <= windowDays[paymentDateFilter] * DAY_MS;
      }

      return matchesSearch && matchesCourseType && matchesPaymentDate;
    });
  }, [safeInvoices, debouncedSearch, courseTypeFilter, paymentDateFilter]);

  const handleInvoiceClick = (invoice: Invoice) => { setSelectedInvoice(invoice); setDialogOpen(true); };
  const handleDialogClose = () => { setDialogOpen(false); setSelectedInvoice(null); };

  const handleDownloadPDF = async (invoice: Invoice) => {
    try {
      const response = await api.get(`/invoices/${invoice.id}/pdf`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `Invoice-${invoice.invoice_number || invoice.id}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error: unknown) {
      logger.error('Error downloading PDF:', error);
      showError('Failed to download invoice PDF');
    }
  };

  const paymentBreakdown = (invoice: Invoice) => {
    const base = invoice.base_cost ?? (invoice.rate_per_student ? invoice.rate_per_student * invoice.students_billed : null);
    if (base == null) return { base: null, tax: null };
    const tax = invoice.tax_amount ?? applyTax(base).tax;
    return { base, tax };
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' }, gap: 2 }}>
        <StatCard label="Total Paid Invoices" value={paidInvoicesSummary?.total_paid_invoices || 0} dotColor="#16A34A" />
        <StatCard label="Total Amount Paid" value={formatCurrency(paidInvoicesSummary?.total_paid_amount)} dotColor="#16A34A" />
        <StatCard label="Average Invoice" value={formatCurrency(paidInvoicesSummary?.average_paid_amount)} />
        <StatCard label="Paid Last 30 Days" value={paidInvoicesSummary?.paid_last_30_days || 0} />
      </Box>

      {/* Filters */}
      <Box sx={{ border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', bgcolor: (theme) => theme.palette.background.paper, p: 3 }}>
        <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.07em', mb: 2 }}>
          Filter this page ({filteredInvoices.length} of {safeInvoices.length} shown · {grid.totalCount} paid invoices)
        </Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' }, gap: 2 }}>
          <TextField
            fullWidth
            label="Search this page"
            size="small"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            inputProps={{ 'aria-label': 'Search paid invoices' }}
          />
          <FormControl fullWidth size="small">
            <InputLabel id="paid-course-type-label">Course Type</InputLabel>
            <Select
              labelId="paid-course-type-label"
              label="Course Type"
              value={courseTypeFilter}
              onChange={(e) => setCourseTypeFilter(e.target.value)}
            >
              <MenuItem value="">All Types</MenuItem>
              {courseTypes.map((type) => <MenuItem key={type} value={type}>{type}</MenuItem>)}
            </Select>
          </FormControl>
          <FormControl fullWidth size="small">
            <InputLabel id="paid-payment-date-label">Payment Date</InputLabel>
            <Select
              labelId="paid-payment-date-label"
              label="Payment Date"
              value={paymentDateFilter}
              onChange={(e) => setPaymentDateFilter(e.target.value as PaymentDateFilter)}
            >
              <MenuItem value="">All Dates</MenuItem>
              <MenuItem value="last_30">Last 30 Days</MenuItem>
              <MenuItem value="last_90">Last 90 Days</MenuItem>
              <MenuItem value="last_year">Last Year</MenuItem>
            </Select>
          </FormControl>
        </Box>
        <Typography sx={{ mt: 1.5, fontSize: 12, color: (theme) => theme.palette.text.secondary }}>
          Search and filters apply to the paid invoices on this page. The totals above cover every paid invoice.
        </Typography>
      </Box>

      {/* Table */}
      <DataTable
        columns={columns}
        shownCount={filteredInvoices.length}
        totalCount={grid.totalCount}
        page={grid.page}
        hasNextPage={grid.hasNextPage}
        onPrevPage={grid.onPrevPage}
        onNextPage={grid.onNextPage}
        loading={grid.loading}
        emptyMessage={safeInvoices.length === 0 ? 'No paid invoices found' : 'No paid invoices on this page match your filters'}
      >
        {filteredInvoices.map((invoice) => (
          <DataTableRow key={invoice.id} columns={columns}>
            <LinkButton onClick={() => handleInvoiceClick(invoice)} aria-label={`View invoice ${invoice.invoice_number}`} sx={{ fontSize: 13 }}>
              {invoice.invoice_number}
            </LinkButton>
            <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{invoice.course_type_name}</Typography>
            <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{formatDisplayDate(invoice.course_date)}</Typography>
            <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{invoice.location}</Typography>
            <Typography sx={{ fontSize: 13, fontWeight: 600, color: (theme) => theme.palette.text.primary, textAlign: 'right' }}>{invoice.students_billed}</Typography>
            <Typography sx={{ fontSize: 13, fontWeight: 600, color: (theme) => theme.palette.text.primary, fontFamily: 'monospace', textAlign: 'right' }}>{formatCurrency(invoice.amount)}</Typography>
            <Typography sx={{ fontSize: 13, fontWeight: 600, color: '#16A34A', fontFamily: 'monospace', textAlign: 'right' }}>{formatCurrency(invoice.amount_paid)}</Typography>
            <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{formatDisplayDate(invoice.paid_date, 'N/A')}</Typography>
            <StatusChip kind={getStatusKind(invoice.payment_status || invoice.status)} label={invoice.payment_status || invoice.status} />
            <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
              <LinkButton onClick={() => handleDownloadPDF(invoice)} aria-label={`Download PDF for invoice ${invoice.invoice_number}`}>PDF</LinkButton>
            </Box>
          </DataTableRow>
        ))}
      </DataTable>

      {/* Invoice Detail Dialog */}
      <Dialog open={dialogOpen} onClose={handleDialogClose} maxWidth="md" fullWidth aria-labelledby="paid-invoice-dialog-title">
        <DialogTitle id="paid-invoice-dialog-title" sx={{ fontSize: 18, fontWeight: 700, color: (theme) => theme.palette.text.primary }}>
          Paid Invoice — {selectedInvoice?.invoice_number}
        </DialogTitle>
        <DialogContent>
          {selectedInvoice && (() => {
            const { base, tax } = paymentBreakdown(selectedInvoice);
            return (
              <Box sx={{ pt: 1 }}>
                <Grid container spacing={3}>
                  <Grid item xs={12} md={6}>
                    <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.07em', mb: 1 }}>Invoice Information</Typography>
                    {[
                      ['Invoice Number', selectedInvoice.invoice_number],
                      ['Created Date', formatDisplayDate(selectedInvoice.created_at)],
                      ['Due Date', formatDisplayDate(selectedInvoice.due_date)],
                      ['Paid Date', formatDisplayDate(selectedInvoice.paid_date, 'N/A')],
                    ].map(([l, v]) => (
                      <Box key={String(l)} sx={{ mb: 1.5 }}>
                        <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.text.secondary }}>{l}</Typography>
                        <Typography sx={{ fontSize: 13, fontWeight: 600, color: (theme) => theme.palette.text.primary }}>{v}</Typography>
                      </Box>
                    ))}
                  </Grid>
                  <Grid item xs={12} md={6}>
                    <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.07em', mb: 1 }}>Course Information</Typography>
                    {[
                      ['Course Type', selectedInvoice.course_type_name],
                      ['Course Date', formatDisplayDate(selectedInvoice.course_date)],
                      ['Location', selectedInvoice.location],
                      ['Students Billed', String(selectedInvoice.students_billed)],
                    ].map(([l, v]) => (
                      <Box key={String(l)} sx={{ mb: 1.5 }}>
                        <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.text.secondary }}>{l}</Typography>
                        <Typography sx={{ fontSize: 13, fontWeight: 600, color: (theme) => theme.palette.text.primary }}>{v}</Typography>
                      </Box>
                    ))}
                  </Grid>
                  <Grid item xs={12}>
                    <Box sx={{ borderTop: (theme) => `1px solid ${theme.palette.divider}`, pt: 2 }}>
                      <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.07em', mb: 1 }}>Payment Details</Typography>
                      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(5, 1fr)' }, gap: 2 }}>
                        {[
                          ['Base Cost', base == null ? 'N/A' : formatCurrency(base)],
                          [getHSTLabel(), tax == null ? 'N/A' : formatCurrency(tax)],
                          ['Total', formatCurrency(selectedInvoice.amount)],
                          ['Amount Paid', formatCurrency(selectedInvoice.amount_paid)],
                          ['Balance Due', formatCurrency(selectedInvoice.balance_due)],
                        ].map(([l, v]) => (
                          <Box key={String(l)}>
                            <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.text.secondary }}>{l}</Typography>
                            <Typography sx={{ fontSize: 16, fontWeight: 700, color: (theme) => theme.palette.text.primary, fontFamily: 'monospace' }}>{v}</Typography>
                          </Box>
                        ))}
                      </Box>
                    </Box>
                  </Grid>
                </Grid>
              </Box>
            );
          })()}
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <GhostButton onClick={handleDialogClose}>Close</GhostButton>
          <PrimaryButton onClick={() => selectedInvoice && handleDownloadPDF(selectedInvoice)}>Download PDF</PrimaryButton>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default OrganizationPaidInvoices;
