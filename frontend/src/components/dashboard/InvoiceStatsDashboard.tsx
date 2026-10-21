import React, { useMemo } from 'react';
import { Box, CircularProgress, Tooltip, Typography } from '@mui/material';
import { formatCurrency } from '../../utils/formatters';
import StatCard from '../gtacpr/StatCard';

// GET /accounting/invoices rows (snake_case, as the server sends them).
// DECIMALs arrive as strings.
interface Invoice {
  id: number;
  amount?: number | string;
  approval_status?: string;
  approved_at?: string | null;
  posted_to_org_at?: string | null;
  payment_status?: string;
  balance_due?: number | string;
}

interface InvoiceStatsDashboardProps {
  invoices?: Invoice[];
  loading?: boolean;
}

const InvoiceStatsDashboard: React.FC<InvoiceStatsDashboardProps> = ({
  invoices = [],
  loading = false,
}) => {
  const stats = useMemo(() => {
    const empty = {
      pendingApprovals: 0,
      approvedToday: 0,
      postedToday: 0,
      totalOutstanding: 0,
      lastUpdated: new Date().toLocaleTimeString(),
    };
    if (!invoices || invoices.length === 0) return empty;

    const today = new Date().toDateString();

    const pendingApprovals = invoices.filter(invoice =>
      ['pending approval', 'pending_approval', 'pending', 'draft', 'new'].includes(
        (invoice.approval_status || '').toLowerCase()
      )
    ).length;

    const approvedToday = invoices.filter(invoice => {
      if (!invoice.approved_at) return false;
      return new Date(invoice.approved_at).toDateString() === today;
    }).length;

    const postedToday = invoices.filter(invoice => {
      if (!invoice.posted_to_org_at) return false;
      return new Date(invoice.posted_to_org_at).toDateString() === today;
    }).length;

    const totalOutstanding = invoices
      .filter(invoice => {
        const status = (invoice.payment_status || '').toLowerCase();
        return status !== 'paid' && status !== 'cancelled';
      })
      // balance_due is the server's figure (verified payments only).
      .reduce((sum, invoice) => sum + (parseFloat(String(invoice.balance_due ?? 0)) || 0), 0);

    return {
      pendingApprovals,
      approvedToday,
      postedToday,
      totalOutstanding,
      lastUpdated: new Date().toLocaleTimeString(),
    };
  }, [invoices]);

  if (loading) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}><CircularProgress size={24} /></Box>;
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
          Invoice Statistics
        </Typography>
        <Typography sx={{ fontSize: 11, color: (theme) => theme.palette.text.secondary }}>Last updated: {stats.lastUpdated}</Typography>
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' }, gap: 2 }}>
        <Tooltip title="Invoices waiting for approval">
          <div><StatCard label="Pending Approvals" value={stats.pendingApprovals} dotColor="#ED6C02" /></div>
        </Tooltip>
        <Tooltip title="Invoices approved today">
          <div><StatCard label="Approved Today" value={stats.approvedToday} dotColor="#16A34A" /></div>
        </Tooltip>
        <Tooltip title="Invoices posted to organizations today">
          <div><StatCard label="Posted Today" value={stats.postedToday} dotColor="#0891B2" /></div>
        </Tooltip>
        <Tooltip title="Total outstanding invoice amounts">
          <div><StatCard label="Total Outstanding" value={formatCurrency(stats.totalOutstanding)} dotColor="#CC1F1F" /></div>
        </Tooltip>
      </Box>
    </Box>
  );
};

export default InvoiceStatsDashboard;
