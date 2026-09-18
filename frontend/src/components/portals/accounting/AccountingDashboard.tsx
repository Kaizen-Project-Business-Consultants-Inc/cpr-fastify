import React, { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Grid,
  Typography,
  Alert,
  CircularProgress,
} from '@mui/material';
import { fetchAccountingDashboardData, api } from '../../../services/api';
import { useNavigate } from 'react-router-dom';
import StatCard from '../../gtacpr/StatCard';
import { PrimaryButton, GhostButton } from '../../gtacpr/Buttons';
import LinkButton from '../../gtacpr/LinkButton';
import { formatCurrency } from '../../../utils/formatters';

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

  /**
   * Counts only. Invoices pending approval come from the paginated endpoint with
   * limit=1 so we read `pagination.total` instead of downloading the whole list.
   * Refreshes on mount and on demand (no background polling).
   */
  const loadPendingActions = useCallback(async () => {
    try {
      setLoading(true);

      const [paymentsResponse, pendingInvoicesResponse] = await Promise.all([
        api.get('/accounting/payment-verifications'),
        api.get('/accounting/invoices/pending-approval', { params: { page: 1, limit: 1 } }),
      ]);

      const paymentsData = paymentsResponse.data;
      const pendingInvoicesData = pendingInvoicesResponse.data;

      const pendingPaymentsCount =
        paymentsData.data?.payments?.filter(
          (p: { status?: string; verifiedByAccountingAt?: string }) =>
            p.status === 'pending_verification' || !p.verifiedByAccountingAt
        ).length || 0;

      const pendingInvoicesCount: number =
        pendingInvoicesData?.pagination?.total ??
        (Array.isArray(pendingInvoicesData?.data) ? pendingInvoicesData.data.length : 0);

      setPendingActions([
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
      ]);
    } catch (error: unknown) {
      console.error('[PENDING ACTIONS] Error fetching pending actions:', error);
      setPendingActions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPendingActions();
  }, [loadPendingActions]);

  const handleActionClick = (route: string) => {
    navigate(route);
  };

  const handleRefresh = () => loadPendingActions();

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
          <LinkButton onClick={handleRefresh} aria-label="Refresh pending actions">Refresh</LinkButton>
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
        <LinkButton onClick={handleRefresh} aria-label="Refresh pending actions">Refresh</LinkButton>
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
    const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
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
       
    }, []);

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
            <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
              Billed, paid and outstanding totals are all-time; "this month" figures are for the current calendar month.
            </Typography>
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
                      ? `${formatCurrency(dashboardData.totalBilled)} total invoiced`
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
};

export default AccountingDashboard;
