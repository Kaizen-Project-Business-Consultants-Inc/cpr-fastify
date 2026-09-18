import React, { useMemo } from 'react';
import { Box, CircularProgress, Tooltip, Typography } from '@mui/material';
import { formatCurrency } from '../../utils/formatters';
import StatCard from '../gtacpr/StatCard';

interface Invoice {
  id: number;
  status: string;
  amount: number;
  createdAt?: string;
  approvalStatus?: string;
  approvedAt?: string;
  postedToOrgAt?: string;
  paymentStatus?: string;
  paidToDate?: number;
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
        (invoice.approvalStatus || '').toLowerCase()
      )
    ).length;

    const approvedToday = invoices.filter(invoice => {
      if (!invoice.approvedAt) return false;
      return new Date(invoice.approvedAt).toDateString() === today;
    }).length;

    const postedToday = invoices.filter(invoice => {
      if (!invoice.postedToOrgAt) return false;
      return new Date(invoice.postedToOrgAt).toDateString() === today;
    }).length;

    const totalOutstanding = invoices
      .filter(invoice => {
        const status = (invoice.paymentStatus || '').toLowerCase();
        return status !== 'paid' && status !== 'cancelled';
      })
      .reduce((sum, invoice) => {
        const amount = typeof invoice.amount === 'number' ? invoice.amount : parseFloat(String(invoice.amount)) || 0;
        const paid = typeof invoice.paidToDate === 'number' ? invoice.paidToDate : parseFloat(String(invoice.paidToDate)) || 0;
        return sum + (amount - paid);
      }, 0);

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
