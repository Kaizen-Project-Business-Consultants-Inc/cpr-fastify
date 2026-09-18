import React, { useState } from 'react';
import {
  Box,
  Typography,
  Grid,
  Card,
  CardContent,
  TextField,
  Button,
  Divider,
  CircularProgress,
  Alert,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
} from '@mui/material';
import {
  TrendingUp as IncomeIcon,
  TrendingDown as ExpenseIcon,
  AccountBalance as BalanceIcon,
  Refresh as RefreshIcon,
  Download as DownloadIcon,
} from '@mui/icons-material';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  LineChart,
  Line,
} from 'recharts';
import api from '../../services/api';
import SegmentedToggle from '../gtacpr/SegmentedToggle';
import { formatCurrency, formatDisplayDate } from '../../utils/formatters';

interface MoneyInTransaction {
  id: number;
  date: string;
  organization_name: string;
  invoice_number: string;
  payment_method: string;
  reference_number: string;
  amount: number;
  status: string;
}

interface MoneyOutTransaction {
  id: number;
  date: string;
  category: 'vendor' | 'instructor';
  payee_name: string;
  invoice_number?: string;
  description?: string;
  reference_number?: string;
  amount: number;
}

interface FinancialSummary {
  period: {
    start_date: string;
    end_date: string;
  };
  money_in: {
    organization_payments: { amount: number; count: number };
    total: number;
    transactions: MoneyInTransaction[];
  };
  money_out: {
    vendor_payments: { amount: number; count: number };
    instructor_payments: { amount: number; count: number };
    total: number;
    transactions: MoneyOutTransaction[];
  };
  net_cash_flow: number;
  monthly_breakdown: Array<{
    month: string;
    month_label: string;
    money_in: number;
    money_out: number;
  }>;
}

type RawRow = Record<string, unknown>;

const num = (v: unknown): number => {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown): string => (v == null ? '' : String(v));
const dateKey = (v: unknown): string => str(v).slice(0, 10); // YYYY-MM-DD, no UTC shift
const round2 = (n: number) => Math.round(n * 100) / 100;
const monthLabel = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-CA', { month: 'short', year: 'numeric' });
};

/** Pull the row array out of the two list endpoints regardless of pagination wrapper. */
const extractRows = (payload: unknown): RawRow[] => {
  const d = (payload as { data?: unknown } | undefined)?.data;
  if (Array.isArray(d)) return d as RawRow[];
  const inner = d as { invoices?: unknown; data?: unknown } | undefined;
  if (Array.isArray(inner?.invoices)) return inner!.invoices as RawRow[];
  if (Array.isArray(inner?.data)) return inner!.data as RawRow[];
  return [];
};

/**
 * There is no /accounting/financial-summary endpoint. Build the summary on the client from
 * the invoice list (money in = verified payments applied to invoices) and the vendor invoice
 * list (money out = processed vendor payments). Instructor payouts are not tracked here.
 */
export const buildFinancialSummary = (
  invoices: RawRow[],
  vendorInvoices: RawRow[],
  startDate: string,
  endDate: string
): FinancialSummary => {
  const inRange = (d: string) => !!d && d >= startDate && d <= endDate;

  const moneyIn: MoneyInTransaction[] = invoices
    .filter((i) => num(i.amount_paid ?? i.amountPaid) > 0)
    .map((i) => ({
      id: num(i.id),
      date: dateKey(i.paid_date ?? i.paidDate ?? i.invoice_date ?? i.invoiceDate),
      organization_name: str(i.organization_name ?? i.organizationName),
      invoice_number: str(i.invoice_number ?? i.invoiceNumber),
      payment_method: '—',
      reference_number: '—',
      amount: num(i.amount_paid ?? i.amountPaid),
      status: str(i.payment_status ?? i.paymentStatus ?? i.status),
    }))
    .filter((t) => inRange(t.date))
    .sort((a, b) => b.date.localeCompare(a.date));

  const moneyOut: MoneyOutTransaction[] = vendorInvoices
    .filter((v) => num(v.total_paid ?? v.totalPaid) > 0)
    .map((v) => ({
      id: num(v.id),
      date: dateKey(v.paid_at ?? v.paidAt ?? v.paid_date ?? v.payment_date ?? v.updated_at ?? v.invoice_date ?? v.invoiceDate),
      category: 'vendor' as const,
      payee_name: str(v.vendor_name ?? v.vendorName),
      invoice_number: str(v.invoice_number ?? v.invoiceNumber),
      description: str(v.description),
      reference_number: '—',
      amount: num(v.total_paid ?? v.totalPaid),
    }))
    .filter((t) => inRange(t.date))
    .sort((a, b) => b.date.localeCompare(a.date));

  const sum = (xs: { amount: number }[]) => round2(xs.reduce((a, x) => a + x.amount, 0));
  const months = new Map<string, { money_in: number; money_out: number }>();
  const bump = (d: string, k: 'money_in' | 'money_out', amt: number) => {
    const ym = d.slice(0, 7);
    const e = months.get(ym) ?? { money_in: 0, money_out: 0 };
    e[k] += amt;
    months.set(ym, e);
  };
  moneyIn.forEach((t) => bump(t.date, 'money_in', t.amount));
  moneyOut.forEach((t) => bump(t.date, 'money_out', t.amount));

  const totalIn = sum(moneyIn);
  const totalOut = sum(moneyOut);
  return {
    period: { start_date: startDate, end_date: endDate },
    money_in: {
      organization_payments: { amount: totalIn, count: moneyIn.length },
      total: totalIn,
      transactions: moneyIn,
    },
    money_out: {
      vendor_payments: { amount: totalOut, count: moneyOut.length },
      instructor_payments: { amount: 0, count: 0 },
      total: totalOut,
      transactions: moneyOut,
    },
    net_cash_flow: round2(totalIn - totalOut),
    monthly_breakdown: [...months.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, v]) => ({
        month,
        month_label: monthLabel(month),
        money_in: round2(v.money_in),
        money_out: round2(v.money_out),
      })),
  };
};

/** Escape one CSV cell: quote, double inner quotes, neutralise formula-leading characters. */
export const csvCell = (value: unknown): string => {
  let s = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};

interface GroupedInvoice {
  invoice_number: string;
  organization_name: string;
  total_payments: number;
  payment_count: number;
  last_payment_date: string;
}

const FinancialSummaryView: React.FC = () => {
  const currentYear = new Date().getFullYear();
  const [startDate, setStartDate] = useState(`${currentYear}-01-01`);
  const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);
  const [viewMode, setViewMode] = useState<'summary' | 'detailed'>('summary');

  const {
    data: summary,
    isLoading,
    error,
    refetch,
  } = useQuery<FinancialSummary>({
    queryKey: ['financial-summary', startDate, endDate],
    queryFn: async () => {
      const [invoicesRes, vendorRes] = await Promise.all([
        api.get('/accounting/invoices', { params: { page: 1, limit: 500 } }),
        api.get('/accounting/vendor-invoices'),
      ]);
      return buildFinancialSummary(extractRows(invoicesRes.data), extractRows(vendorRes.data), startDate, endDate);
    },
  });

  // Group transactions by invoice for summary view
  const groupedInvoices: GroupedInvoice[] = React.useMemo(() => {
    if (!summary?.money_in.transactions) return [];

    const grouped = summary.money_in.transactions.reduce((acc, txn) => {
      const key = txn.invoice_number;
      if (!acc[key]) {
        acc[key] = {
          invoice_number: txn.invoice_number,
          organization_name: txn.organization_name,
          total_payments: 0,
          payment_count: 0,
          last_payment_date: txn.date,
        };
      }
      acc[key].total_payments += txn.amount;
      acc[key].payment_count += 1;
      if (new Date(txn.date) > new Date(acc[key].last_payment_date)) {
        acc[key].last_payment_date = txn.date;
      }
      return acc;
    }, {} as Record<string, GroupedInvoice>);

    return Object.values(grouped).sort((a, b) =>
      new Date(b.last_payment_date).getTime() - new Date(a.last_payment_date).getTime()
    );
  }, [summary?.money_in.transactions]);

  const handleExportCSV = () => {
    if (!summary) return;

    const csvContent = [
      ['Financial Summary Report'],
      [`Period: ${summary.period.start_date} to ${summary.period.end_date}`],
      [''],
      ['SUMMARY'],
      ['Money In', formatCurrency(summary.money_in.total)],
      ['Money Out', formatCurrency(summary.money_out.total)],
      ['Net Cash Flow', formatCurrency(summary.net_cash_flow)],
      [''],
      ['MONEY IN BREAKDOWN'],
      ['Organization Payments', formatCurrency(summary.money_in.organization_payments.amount), `${summary.money_in.organization_payments.count} transactions`],
      [''],
      ['MONEY OUT BREAKDOWN'],
      ['Vendor Payments', formatCurrency(summary.money_out.vendor_payments.amount), `${summary.money_out.vendor_payments.count} transactions`],
      ['Instructor Payments', formatCurrency(summary.money_out.instructor_payments.amount), `${summary.money_out.instructor_payments.count} transactions`],
      [''],
      ['MONTHLY BREAKDOWN'],
      ['Month', 'Money In', 'Money Out', 'Net'],
      ...summary.monthly_breakdown.map(m => [
        m.month_label,
        formatCurrency(m.money_in),
        formatCurrency(m.money_out),
        formatCurrency(m.money_in - m.money_out),
      ]),
      [''],
      ['MONEY IN TRANSACTIONS'],
      ['Date', 'Organization', 'Invoice #', 'Payment Method', 'Reference #', 'Amount'],
      ...(summary.money_in.transactions || []).map(txn => [
        formatDisplayDate(txn.date),
        txn.organization_name,
        txn.invoice_number,
        txn.payment_method || '',
        txn.reference_number || '',
        formatCurrency(txn.amount),
      ]),
      [''],
      ['MONEY OUT TRANSACTIONS'],
      ['Date', 'Category', 'Payee', 'Reference/Description', 'Amount'],
      ...(summary.money_out.transactions || []).map(txn => [
        formatDisplayDate(txn.date),
        txn.category === 'vendor' ? 'Vendor' : 'Instructor',
        txn.payee_name,
        txn.invoice_number || txn.reference_number || txn.description || '',
        formatCurrency(txn.amount),
      ]),
    ].map(row => row.map(csvCell).join(',')).join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `financial-summary-${startDate}-to-${endDate}.csv`;
    link.click();
  };

  if (isLoading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Alert severity="error">
        Failed to load financial summary. Please try again.
      </Alert>
    );
  }

  const chartData = summary?.monthly_breakdown.map(m => ({
    ...m,
    net: m.money_in - m.money_out,
  })) || [];

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Box>
          <Typography variant="h4" gutterBottom>
            Financial Summary
          </Typography>
          <Typography variant="body2" color="textSecondary">
            Money In / Money Out Overview
          </Typography>
        </Box>
        <Box display="flex" gap={2} alignItems="center">
          <TextField
            label="Start Date"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            InputLabelProps={{ shrink: true }}
            size="small"
          />
          <TextField
            label="End Date"
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            InputLabelProps={{ shrink: true }}
            size="small"
          />
          <Button
            variant="outlined"
            startIcon={<RefreshIcon />}
            onClick={() => refetch()}
          >
            Refresh
          </Button>
          <Button
            variant="outlined"
            startIcon={<DownloadIcon />}
            onClick={handleExportCSV}
          >
            Export CSV
          </Button>
        </Box>
      </Box>

      <Alert severity="info" sx={{ mb: 3 }}>
        Computed from invoice and vendor-invoice records: money in is verified payments applied to
        organization invoices, money out is processed vendor payments. Instructor payouts and
        per-payment method/reference details are not available in this view.
      </Alert>

      {summary && (
        <>
          {/* Summary Cards */}
          <Grid container spacing={3} mb={4}>
            {/* Money In Card */}
            <Grid item xs={12} md={4}>
              <Card sx={{ height: '100%', borderLeft: '4px solid #4caf50' }}>
                <CardContent>
                  <Box display="flex" alignItems="center" mb={2}>
                    <IncomeIcon sx={{ color: '#4caf50', mr: 1 }} />
                    <Typography variant="h6" color="textSecondary">
                      Money In
                    </Typography>
                  </Box>
                  <Typography variant="h4" sx={{ color: '#4caf50', mb: 2 }}>
                    {formatCurrency(summary.money_in.total)}
                  </Typography>
                  <Divider sx={{ my: 1 }} />
                  <Box>
                    <Box display="flex" justifyContent="space-between" mb={0.5}>
                      <Typography variant="body2" color="textSecondary">
                        Organization Payments
                      </Typography>
                      <Typography variant="body2">
                        {formatCurrency(summary.money_in.organization_payments.amount)}
                      </Typography>
                    </Box>
                    <Typography variant="caption" color="textSecondary">
                      {summary.money_in.organization_payments.count} transactions
                    </Typography>
                  </Box>
                </CardContent>
              </Card>
            </Grid>

            {/* Money Out Card */}
            <Grid item xs={12} md={4}>
              <Card sx={{ height: '100%', borderLeft: '4px solid #f44336' }}>
                <CardContent>
                  <Box display="flex" alignItems="center" mb={2}>
                    <ExpenseIcon sx={{ color: '#f44336', mr: 1 }} />
                    <Typography variant="h6" color="textSecondary">
                      Money Out
                    </Typography>
                  </Box>
                  <Typography variant="h4" sx={{ color: '#f44336', mb: 2 }}>
                    {formatCurrency(summary.money_out.total)}
                  </Typography>
                  <Divider sx={{ my: 1 }} />
                  <Box>
                    <Box display="flex" justifyContent="space-between" mb={0.5}>
                      <Typography variant="body2" color="textSecondary">
                        Vendor Payments
                      </Typography>
                      <Typography variant="body2">
                        {formatCurrency(summary.money_out.vendor_payments.amount)}
                      </Typography>
                    </Box>
                    <Typography variant="caption" color="textSecondary" display="block" mb={1}>
                      {summary.money_out.vendor_payments.count} transactions
                    </Typography>
                    <Box display="flex" justifyContent="space-between" mb={0.5}>
                      <Typography variant="body2" color="textSecondary">
                        Instructor Payments
                      </Typography>
                      <Typography variant="body2">
                        {formatCurrency(summary.money_out.instructor_payments.amount)}
                      </Typography>
                    </Box>
                    <Typography variant="caption" color="textSecondary">
                      {summary.money_out.instructor_payments.count} transactions
                    </Typography>
                  </Box>
                </CardContent>
              </Card>
            </Grid>

            {/* Net Cash Flow Card */}
            <Grid item xs={12} md={4}>
              <Card
                sx={{
                  height: '100%',
                  borderLeft: `4px solid ${summary.net_cash_flow >= 0 ? '#2196f3' : '#ff9800'}`,
                }}
              >
                <CardContent>
                  <Box display="flex" alignItems="center" mb={2}>
                    <BalanceIcon
                      sx={{ color: summary.net_cash_flow >= 0 ? '#2196f3' : '#ff9800', mr: 1 }}
                    />
                    <Typography variant="h6" color="textSecondary">
                      Net Cash Flow
                    </Typography>
                  </Box>
                  <Typography
                    variant="h4"
                    sx={{ color: summary.net_cash_flow >= 0 ? '#2196f3' : '#ff9800', mb: 2 }}
                  >
                    {formatCurrency(summary.net_cash_flow)}
                  </Typography>
                  <Divider sx={{ my: 1 }} />
                  <Typography variant="body2" color="textSecondary">
                    {summary.net_cash_flow >= 0
                      ? 'Positive cash flow - more money coming in than going out'
                      : 'Negative cash flow - more money going out than coming in'}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
          </Grid>

          {/* Monthly Chart */}
          <Paper sx={{ p: 3, mb: 4 }}>
            <Typography variant="h6" gutterBottom>
              Monthly Cash Flow
            </Typography>
            <ResponsiveContainer width="100%" height={400}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month_label" />
                <YAxis tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`} />
                <Tooltip
                  formatter={(value: number) => formatCurrency(value)}
                  labelFormatter={(label) => `Month: ${label}`}
                />
                <Legend />
                <Bar dataKey="money_in" name="Money In" fill="#4caf50" />
                <Bar dataKey="money_out" name="Money Out" fill="#f44336" />
              </BarChart>
            </ResponsiveContainer>
          </Paper>

          {/* Net Cash Flow Trend */}
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              Net Cash Flow Trend
            </Typography>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month_label" />
                <YAxis tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`} />
                <Tooltip
                  formatter={(value: number) => formatCurrency(value)}
                  labelFormatter={(label) => `Month: ${label}`}
                />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="net"
                  name="Net Cash Flow"
                  stroke="#2196f3"
                  strokeWidth={2}
                  dot={{ fill: '#2196f3' }}
                />
              </LineChart>
            </ResponsiveContainer>
          </Paper>

          {/* Money In Transactions Table */}
          <Paper sx={{ p: 3, mt: 4 }}>
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
              <Box display="flex" alignItems="center" gap={1}>
                <IncomeIcon sx={{ color: '#4caf50' }} />
                <Typography variant="h6">
                  Money In Transactions
                </Typography>
              </Box>
              <Box display="flex" alignItems="center" gap={2}>
                <SegmentedToggle
                  value={viewMode}
                  options={[
                    { value: 'summary', label: 'Summary' },
                    { value: 'detailed', label: 'Detailed' },
                  ]}
                  onChange={(v) => setViewMode(v as 'summary' | 'detailed')}
                />
                <Typography variant="h6" sx={{ color: '#4caf50' }}>
                  Total: {formatCurrency(summary.money_in.total)}
                </Typography>
              </Box>
            </Box>
            <TableContainer>
              <Table size="small">
                {viewMode === 'summary' ? (
                  <>
                    <TableHead>
                      <TableRow sx={{ backgroundColor: 'rgba(76, 175, 80, 0.1)' }}>
                        <TableCell>Invoice #</TableCell>
                        <TableCell>Organization</TableCell>
                        <TableCell align="center">Payments</TableCell>
                        <TableCell>Last Payment</TableCell>
                        <TableCell align="right">Total Received</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {groupedInvoices.length > 0 ? (
                        groupedInvoices.map((inv) => (
                          <TableRow key={inv.invoice_number} hover>
                            <TableCell>{inv.invoice_number}</TableCell>
                            <TableCell>{inv.organization_name}</TableCell>
                            <TableCell align="center">
                              <Chip
                                label={`${inv.payment_count} payment${inv.payment_count > 1 ? 's' : ''}`}
                                size="small"
                                variant="outlined"
                                color={inv.payment_count > 1 ? 'primary' : 'default'}
                              />
                            </TableCell>
                            <TableCell>
                              {formatDisplayDate(inv.last_payment_date)}
                            </TableCell>
                            <TableCell align="right" sx={{ color: '#4caf50', fontWeight: 'medium' }}>
                              {formatCurrency(inv.total_payments)}
                            </TableCell>
                          </TableRow>
                        ))
                      ) : (
                        <TableRow>
                          <TableCell colSpan={5} align="center" sx={{ py: 4 }}>
                            <Typography color="textSecondary">
                              No money in transactions for this period
                            </Typography>
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </>
                ) : (
                  <>
                    <TableHead>
                      <TableRow sx={{ backgroundColor: 'rgba(76, 175, 80, 0.1)' }}>
                        <TableCell>Date</TableCell>
                        <TableCell>Organization</TableCell>
                        <TableCell>Invoice #</TableCell>
                        <TableCell>Payment Method</TableCell>
                        <TableCell>Reference #</TableCell>
                        <TableCell align="right">Amount</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {summary.money_in.transactions?.length > 0 ? (
                        summary.money_in.transactions.map((txn) => (
                          <TableRow key={txn.id} hover>
                            <TableCell>
                              {formatDisplayDate(txn.date)}
                            </TableCell>
                            <TableCell>{txn.organization_name}</TableCell>
                            <TableCell>{txn.invoice_number}</TableCell>
                            <TableCell>
                              <Chip
                                label={txn.payment_method?.replace('_', ' ').toUpperCase() || 'N/A'}
                                size="small"
                                variant="outlined"
                              />
                            </TableCell>
                            <TableCell>{txn.reference_number || '-'}</TableCell>
                            <TableCell align="right" sx={{ color: '#4caf50', fontWeight: 'medium' }}>
                              {formatCurrency(txn.amount)}
                            </TableCell>
                          </TableRow>
                        ))
                      ) : (
                        <TableRow>
                          <TableCell colSpan={6} align="center" sx={{ py: 4 }}>
                            <Typography color="textSecondary">
                              No money in transactions for this period
                            </Typography>
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </>
                )}
              </Table>
            </TableContainer>
          </Paper>

          {/* Money Out Transactions Table */}
          <Paper sx={{ p: 3, mt: 4 }}>
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
              <Box display="flex" alignItems="center" gap={1}>
                <ExpenseIcon sx={{ color: '#f44336' }} />
                <Typography variant="h6">
                  Money Out Transactions
                </Typography>
              </Box>
              <Typography variant="h6" sx={{ color: '#f44336' }}>
                Total: {formatCurrency(summary.money_out.total)}
              </Typography>
            </Box>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ backgroundColor: 'rgba(244, 67, 54, 0.1)' }}>
                    <TableCell>Date</TableCell>
                    <TableCell>Category</TableCell>
                    <TableCell>Payee</TableCell>
                    <TableCell>Reference / Description</TableCell>
                    <TableCell align="right">Amount</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {summary.money_out.transactions?.length > 0 ? (
                    summary.money_out.transactions.map((txn) => (
                      <TableRow key={`${txn.category}-${txn.id}`} hover>
                        <TableCell>
                          {formatDisplayDate(txn.date)}
                        </TableCell>
                        <TableCell>
                          <Chip
                            label={txn.category === 'vendor' ? 'Vendor' : 'Instructor'}
                            size="small"
                            color={txn.category === 'vendor' ? 'primary' : 'secondary'}
                          />
                        </TableCell>
                        <TableCell>{txn.payee_name}</TableCell>
                        <TableCell>
                          {txn.invoice_number || txn.reference_number || txn.description || '-'}
                        </TableCell>
                        <TableCell align="right" sx={{ color: '#f44336', fontWeight: 'medium' }}>
                          {formatCurrency(txn.amount)}
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={5} align="center" sx={{ py: 4 }}>
                        <Typography color="textSecondary">
                          No money out transactions for this period
                        </Typography>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        </>
      )}
    </Box>
  );
};

export default FinancialSummaryView;
