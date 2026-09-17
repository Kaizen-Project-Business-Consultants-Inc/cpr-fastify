import React, { useState, useEffect } from 'react';
import {
  Box,
  Grid,
  Typography,
  Alert,
  CircularProgress,
  FormControl,
  Select,
  MenuItem,
  SelectChangeEvent,
} from '@mui/material';
import { fetchAccountingDashboardData, api } from '../../../services/api';
import { useNavigate } from 'react-router-dom';
import StatCard from '../../gtacpr/StatCard';
import { PrimaryButton, GhostButton } from '../../gtacpr/Buttons';

interface DashboardData {
  totalBilled: number;
  totalPaid: number;
  outstandingInvoices: {
    count: number;
    amount: number;
  };
  paymentsThisMonth: {
    count: number;
    amount: number;
  };
  completedCoursesThisMonth: number;
}

interface PendingAction {
  id: string;
  type: 'payment_verification' | 'invoice_approval' | 'recent_activity';
  title: string;
  description: string;
  count?: number;
  color: 'error' | 'warning' | 'success' | 'info';
  icon: React.ReactNode;
  route: string;
}

interface MetricCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ReactNode;
  color: 'primary' | 'secondary' | 'success' | 'warning' | 'error' | 'info';
}

const colorToDot: Record<string, string> = {
  success: '#16A34A',
  primary: '#2563EB',
  error: '#CC1F1F',
  warning: '#ED6C02',
  info: '#0891B2',
  secondary: '#7C3AED',
};

const MetricCard: React.FC<MetricCardProps> = ({ title, value, subtitle, color }) => {
  return (
    <StatCard
      label={title}
      value={value}
      sub={subtitle}
      dotColor={colorToDot[color] ?? '#2563EB'}
    />
  );
};

const PendingActionsSidebar: React.FC = () => {
  const navigate = useNavigate();
  const [pendingActions, setPendingActions] = useState<PendingAction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchPendingActions = async () => {
      try {
        setLoading(true);

        const [paymentsResponse, invoicesResponse] = await Promise.all([
          api.get('/accounting/payment-verifications'),
          api.get('/accounting/invoices'),
        ]);

        const paymentsData = paymentsResponse.data;
        const invoicesData = invoicesResponse.data;


        const pendingPaymentsCount =
          paymentsData.data?.payments?.filter(
            (p: { status?: string; verifiedByAccountingAt?: string }) =>
              p.status === 'pending_verification' || !p.verifiedByAccountingAt
          ).length || 0;

        const pendingInvoicesCount =
          invoicesData.data?.invoices?.filter((i: { approvalStatus?: string }) =>
            ['pending_approval', 'pending', 'draft'].includes(
              i.approvalStatus?.toLowerCase() || ''
            )
          ).length || 0;


        const realData: PendingAction[] = [
          {
            id: '1',
            type: 'payment_verification',
            title: 'Payments Pending Verification',
            description: 'Organization payments waiting for review',
            count: pendingPaymentsCount,
            color: 'error',
            icon: null,
            route: '/accounting/verification',
          },
          {
            id: '2',
            type: 'invoice_approval',
            title: 'Invoices Pending Approval',
            description: 'Invoices waiting for approval',
            count: pendingInvoicesCount,
            color: 'warning',
            icon: null,
            route: '/accounting/receivables',
          },
        ];

        setPendingActions(realData);
      } catch (error: any) {
        console.error('🔍 [PENDING ACTIONS] Error fetching pending actions:', error);
        setPendingActions([]);
      } finally {
        setLoading(false);
      }
    };

    fetchPendingActions();

    const interval = setInterval(fetchPendingActions, 120000);

    return () => clearInterval(interval);
  }, []);

  const handleActionClick = (route: string) => {
    navigate(route);
  };

  const handleRefresh = async () => {
    try {
      setLoading(true);

      const [paymentsResponse, invoicesResponse] = await Promise.all([
        api.get('/accounting/payment-verifications'),
        api.get('/accounting/invoices'),
      ]);

      const paymentsData = paymentsResponse.data;
      const invoicesData = invoicesResponse.data;


      const pendingPaymentsCount =
        paymentsData.data?.payments?.filter(
          (p: { status?: string; verifiedByAccountingAt?: string }) =>
            p.status === 'pending_verification' || !p.verifiedByAccountingAt
        ).length || 0;

      const pendingInvoicesCount =
        invoicesData.data?.invoices?.filter((i: { approvalStatus?: string }) =>
          ['pending_approval', 'pending', 'draft'].includes(
            i.approvalStatus?.toLowerCase() || ''
          )
        ).length || 0;


      const realData: PendingAction[] = [
        {
          id: '1',
          type: 'payment_verification',
          title: 'Payments Pending Verification',
          description: 'Organization payments waiting for review',
          count: pendingPaymentsCount,
          color: 'error',
          icon: null,
          route: '/accounting/verification',
        },
        {
          id: '2',
          type: 'invoice_approval',
          title: 'Invoices Pending Approval',
          description: 'Invoices waiting for approval',
          count: pendingInvoicesCount,
          color: 'warning',
          icon: null,
          route: '/accounting/receivables',
        },
      ];

      setPendingActions(realData);
    } catch (error: any) {
      console.error('🔍 [PENDING ACTIONS] Error refreshing pending actions:', error);
    } finally {
      setLoading(false);
    }
  };

  const actionDotColor: Record<string, string> = {
    error: '#CC1F1F',
    warning: '#ED6C02',
    success: '#16A34A',
    info: '#0891B2',
  };

  if (loading) {
    return (
      <Box sx={{ border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', bgcolor: (theme) => theme.palette.background.paper, p: 3, height: 'fit-content', minWidth: 280 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
          <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
            Pending Actions
          </Typography>
          <Box
            onClick={handleRefresh}
            sx={{ fontSize: 12, fontWeight: 600, color: '#CC1F1F', cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}
          >
            Refresh
          </Box>
        </Box>
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
          <CircularProgress size={24} />
        </Box>
      </Box>
    );
  }

  return (
    <Box sx={{ border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', bgcolor: (theme) => theme.palette.background.paper, p: 3, height: 'fit-content', minWidth: 280 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
          Pending Actions
        </Typography>
        <Box
          onClick={handleRefresh}
          sx={{ fontSize: 12, fontWeight: 600, color: '#CC1F1F', cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}
        >
          Refresh
        </Box>
      </Box>

      {pendingActions.length === 0 ? (
        <Box sx={{ textAlign: 'center', py: 3 }}>
          <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>No pending actions</Typography>
        </Box>
      ) : (
        <>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mb: 2 }}>
            {pendingActions.map((action) => (
              <Box
                key={action.id}
                onClick={() => handleActionClick(action.route)}
                sx={{
                  border: (theme) => `1px solid ${theme.palette.divider}`,
                  borderRadius: '8px',
                  p: 1.5,
                  cursor: 'pointer',
                  '&:hover': { bgcolor: (theme) => theme.palette.background.default },
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
                  <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: (theme) => theme.palette.text.primary }}>
                    {action.title}
                  </Typography>
                  {action.count !== undefined && (
                    <Box
                      sx={{
                        minWidth: 22,
                        height: 22,
                        borderRadius: '11px',
                        bgcolor: actionDotColor[action.color] ?? '#CC1F1F',
                        color: '#fff',
                        fontSize: 11,
                        fontWeight: 700,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        px: 0.75,
                      }}
                    >
                      {action.count}
                    </Box>
                  )}
                </Box>
                <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.text.secondary }}>{action.description}</Typography>
              </Box>
            ))}
          </Box>

          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <GhostButton fullWidth onClick={() => navigate('/accounting/verification')}>
              View All Actions
            </GhostButton>
            <PrimaryButton fullWidth onClick={() => navigate('/accounting/verification')}>
              Review Payments
            </PrimaryButton>
          </Box>
        </>
      )}
    </Box>
  );
};

const AccountingDashboard: React.FC = () => {

  try {
    const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selectedPeriod, setSelectedPeriod] = useState<string>('current_month');

    const getPeriodOptions = () => {
      const currentDate = new Date();
      const currentYear = currentDate.getFullYear();
      const currentMonth = currentDate.getMonth();

      const options = [
        {
          value: 'current_month',
          label: `${currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })} (Current Month)`,
        },
        {
          value: 'previous_month',
          label: `${new Date(currentYear, currentMonth - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })} (Previous Month)`,
        },
        {
          value: 'current_quarter',
          label: `Q${Math.floor(currentMonth / 3) + 1} ${currentYear} (Current Quarter)`,
        },
        {
          value: 'previous_quarter',
          label: `Q${Math.floor((currentMonth - 3) / 3) + 1} ${currentYear} (Previous Quarter)`,
        },
        { value: 'current_year', label: `${currentYear} (Current Year)` },
        { value: 'previous_year', label: `${currentYear - 1} (Previous Year)` },
        { value: 'last_30_days', label: 'Last 30 Days' },
        { value: 'last_90_days', label: 'Last 90 Days' },
        { value: 'last_12_months', label: 'Last 12 Months' },
      ];

      return options;
    };

    const handlePeriodChange = (event: SelectChangeEvent) => {
      setSelectedPeriod(event.target.value);
    };

    const fetchDashboardData = async () => {
      try {
        setLoading(true);
        const data = (await fetchAccountingDashboardData()) as unknown as DashboardData;
        setDashboardData(data);
        setError(null);
      } catch (err: any) {
        console.error('Error fetching dashboard data:', err);
        setError('Failed to fetch dashboard data');
      } finally {
        setLoading(false);
      }
    };

    useEffect(() => {
      fetchDashboardData();
    }, [selectedPeriod]);

    const formatCurrency = (amount: number) => {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
      }).format(amount);
    };

    const getCurrentPeriodLabel = () => {
      const options = getPeriodOptions();
      const selectedOption = options.find((option) => option.value === selectedPeriod);
      return selectedOption ? selectedOption.label.split(' (')[0] : 'Current Month';
    };

    if (loading) {
      return (
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400 }}>
          <CircularProgress size={60} />
        </Box>
      );
    }

    if (error) {
      return (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      );
    }

    if (!dashboardData) {
      return (
        <Alert severity="info" sx={{ mb: 2 }}>
          No dashboard data available
        </Alert>
      );
    }

    return (
      <Box sx={{ display: 'flex', gap: 3, flexDirection: { xs: 'column', lg: 'row' } }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          {/* Header */}
          <Box sx={{ mb: 3 }}>
            <Typography sx={{ fontSize: 18, fontWeight: 700, color: (theme) => theme.palette.text.primary, mb: 1 }}>
              Financial Overview
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <FormControl size="small" sx={{ minWidth: 250 }}>
                <Select
                  value={selectedPeriod}
                  onChange={handlePeriodChange}
                  displayEmpty
                  sx={{
                    fontSize: 13,
                    '& .MuiSelect-select': {
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1,
                    },
                  }}
                >
                  {getPeriodOptions().map((option) => (
                    <MenuItem key={option.value} value={option.value} sx={{ fontSize: 13 }}>
                      {option.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Box>
          </Box>

          {/* Stat Cards */}
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' }, gap: 2, mb: 4 }}>
            <MetricCard
              title="Total Billed"
              value={formatCurrency(dashboardData.totalBilled)}
              subtitle="Total amount invoiced to organizations"
              icon={null}
              color="success"
            />
            <MetricCard
              title="Total Paid"
              value={formatCurrency(dashboardData.totalPaid)}
              subtitle="Total payments received and verified"
              icon={null}
              color="primary"
            />
            <MetricCard
              title="Outstanding Amount"
              value={formatCurrency(dashboardData.outstandingInvoices.amount)}
              subtitle={`${dashboardData.outstandingInvoices.count} invoices pending`}
              icon={null}
              color="error"
            />
            <MetricCard
              title="Completed Courses"
              value={dashboardData.completedCoursesThisMonth}
              subtitle="Courses completed this month"
              icon={null}
              color="info"
            />
          </Box>

          {/* Quick Summary */}
          <Box sx={{ border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', bgcolor: (theme) => theme.palette.background.paper, p: 3 }}>
            <Typography
              sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.07em', mb: 2 }}
            >
              Quick Summary
            </Typography>
            <Grid container spacing={2}>
              <Grid item xs={12} md={6}>
                <Box sx={{ mb: 1.5 }}>
                  <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
                    <Box component="span" sx={{ fontSize: 13.5, fontWeight: 600, color: (theme) => theme.palette.text.primary }}>
                      Billing Status:{' '}
                    </Box>
                    {dashboardData.totalBilled > 0
                      ? `$${dashboardData.totalBilled.toLocaleString()} total invoiced`
                      : 'No invoices generated'}
                  </Typography>
                </Box>
                <Box sx={{ mb: 1.5 }}>
                  <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
                    <Box component="span" sx={{ fontSize: 13.5, fontWeight: 600, color: (theme) => theme.palette.text.primary }}>
                      Payment Status:{' '}
                    </Box>
                    {dashboardData.outstandingInvoices.count === 0
                      ? 'All invoices paid'
                      : `${dashboardData.outstandingInvoices.count} invoices pending payment`}
                  </Typography>
                </Box>
              </Grid>
              <Grid item xs={12} md={6}>
                <Box sx={{ mb: 1.5 }}>
                  <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
                    <Box component="span" sx={{ fontSize: 13.5, fontWeight: 600, color: (theme) => theme.palette.text.primary }}>
                      Collection Rate:{' '}
                    </Box>
                    {dashboardData.totalBilled > 0
                      ? `${((dashboardData.totalPaid / dashboardData.totalBilled) * 100).toFixed(1)}% collected`
                      : 'No billing data'}
                  </Typography>
                </Box>
                <Box sx={{ mb: 1.5 }}>
                  <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
                    <Box component="span" sx={{ fontSize: 13.5, fontWeight: 600, color: (theme) => theme.palette.text.primary }}>
                      Course Activity:{' '}
                    </Box>
                    {dashboardData.completedCoursesThisMonth} courses completed this month
                  </Typography>
                </Box>
              </Grid>
            </Grid>
          </Box>
        </Box>

        {/* Sidebar */}
        <Box
          sx={{
            width: { xs: '100%', lg: 320 },
            flexShrink: 0,
            order: { xs: -1, lg: 0 },
          }}
        >
          <PendingActionsSidebar />
        </Box>
      </Box>
    );
  } catch (error: any) {
    console.error('[AccountingDashboard] Error during render:', error);
    return (
      <Box sx={{ p: 3 }}>
        <Typography sx={{ fontSize: 18, fontWeight: 700, color: '#CC1F1F', mb: 1 }}>
          Error Loading Dashboard
        </Typography>
        <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>An error occurred while loading the dashboard.</Typography>
        <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.text.secondary, mt: 0.5 }}>
          Error: {error instanceof Error ? error.message : 'Unknown error'}
        </Typography>
      </Box>
    );
  }
};

export default AccountingDashboard;
