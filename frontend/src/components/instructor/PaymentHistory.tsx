import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  Card,
  CardContent,
  CircularProgress,
  Alert,
  Button,
  Pagination,
} from '@mui/material';
import {
  Payment as PaymentIcon,
  Refresh as RefreshIcon,
  CheckCircle as PaidIcon,
  Schedule as PendingIcon,
  Cancel as RejectedIcon,
} from '@mui/icons-material';
import { timesheetService } from '../../services/timesheetService';

interface Payment {
  id: number;
  amount: number;
  status: 'pending' | 'approved' | 'paid' | 'rejected';
  payment_method?: string;
  processed_at?: string;
  notes?: string;
  created_at: string;
  week_start_date: string;
  total_hours: number;
  courses_taught: number;
}

const PaymentHistory: React.FC = () => {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 10,
    total: 0,
    pages: 0,
  });

  const loadPayments = async (page = 1) => {
    setLoading(true);
    setError(null);

    try {
      const response = await timesheetService.getMyPayments(page, pagination.limit);
      setPayments(response.payments || []);
      setPagination({
        page: response.pagination.page,
        limit: response.pagination.limit,
        total: response.pagination.total,
        pages: response.pagination.pages,
      });
    } catch (err: unknown) {
      const errObj = err as { response?: { data?: { message?: string } }; message?: string };
      setError(errObj.response?.data?.message || errObj.message || 'Failed to load payment history');
    } finally {
      setLoading(false);
    }
  };

  // Fetch on mount only (page changes are handled explicitly via handlePageChange).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadPayments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePageChange = (_event: React.ChangeEvent<unknown>, page: number) => {
    loadPayments(page);
  };

  const formatDate = (dateString: string) => {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  };

  const getStatusChip = (status: string) => {
    switch (status) {
      case 'paid':
        return <Chip icon={<PaidIcon />} label="Paid" color="success" size="small" />;
      case 'approved':
        return <Chip icon={<PendingIcon />} label="Approved" color="primary" size="small" />;
      case 'pending':
        return <Chip icon={<PendingIcon />} label="Pending" color="warning" size="small" />;
      case 'rejected':
        return <Chip icon={<RejectedIcon />} label="Rejected" color="error" size="small" />;
      default:
        return <Chip label={status} size="small" />;
    }
  };

  const getStatusDescription = (status: string) => {
    switch (status) {
      case 'paid':
        return 'Payment has been processed';
      case 'approved':
        return 'Timesheet approved, payment pending';
      case 'pending':
        return 'Awaiting HR approval';
      case 'rejected':
        return 'Payment request rejected';
      default:
        return '';
    }
  };

  return (
    <Card>
      <CardContent>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            <PaymentIcon sx={{ mr: 1, color: 'primary.main' }} />
            <Typography variant="h6" component="h2">
              Payment History
            </Typography>
          </Box>
          <Button
            variant="outlined"
            size="small"
            startIcon={<RefreshIcon />}
            onClick={() => loadPayments(pagination.page)}
            disabled={loading}
          >
            Refresh
          </Button>
        </Box>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        ) : payments.length === 0 ? (
          <Alert severity="info">
            No payment history yet. Submit a timesheet and get it approved to see payments here.
          </Alert>
        ) : (
          <>
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Week Of</TableCell>
                    <TableCell align="center">Courses</TableCell>
                    <TableCell align="center">Hours</TableCell>
                    <TableCell align="right">Amount</TableCell>
                    <TableCell align="center">Status</TableCell>
                    <TableCell>Processed</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {payments.map((payment) => (
                    <TableRow key={payment.id} hover>
                      <TableCell>{formatDate(payment.week_start_date)}</TableCell>
                      <TableCell align="center">{payment.courses_taught}</TableCell>
                      <TableCell align="center">{payment.total_hours}</TableCell>
                      <TableCell align="right">
                        <Typography fontWeight="bold" color="primary">
                          {formatCurrency(payment.amount)}
                        </Typography>
                      </TableCell>
                      <TableCell align="center">
                        <Box>
                          {getStatusChip(payment.status)}
                          <Typography variant="caption" display="block" color="text.secondary">
                            {getStatusDescription(payment.status)}
                          </Typography>
                        </Box>
                      </TableCell>
                      <TableCell>
                        {payment.processed_at ? formatDate(payment.processed_at) : '-'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>

            {pagination.pages > 1 && (
              <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
                <Pagination
                  count={pagination.pages}
                  page={pagination.page}
                  onChange={handlePageChange}
                  color="primary"
                />
              </Box>
            )}

            <Box sx={{ mt: 2 }}>
              <Typography variant="caption" color="text.secondary">
                Payment Status Guide:
              </Typography>
              <Box sx={{ display: 'flex', gap: 2, mt: 1, flexWrap: 'wrap' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  {getStatusChip('pending')}
                  <Typography variant="caption">Timesheet submitted, awaiting HR</Typography>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  {getStatusChip('approved')}
                  <Typography variant="caption">HR approved, awaiting payment</Typography>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  {getStatusChip('paid')}
                  <Typography variant="caption">Payment processed</Typography>
                </Box>
              </Box>
            </Box>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default PaymentHistory;
