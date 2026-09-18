import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { Box, Grid, Typography, LinearProgress } from '@mui/material';
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
} from 'recharts';
import { formatDisplayDate } from '../../../../utils/dateUtils';
import { useNavigate } from 'react-router-dom';
import StatCard from '../../../gtacpr/StatCard';
import DataTable, { DataTableRow } from '../../../gtacpr/DataTable';
import StatusChip from '../../../gtacpr/StatusChip';
import { GhostButton } from '../../../gtacpr/Buttons';
import DateRangeFilter from '../../../gtacpr/DateRangeFilter';
import { organizationApi } from '../../../../services/api';

interface OrganizationData {
  id: number;
  name: string;
  contact_email: string;
  contact_phone: string;
  address: string;
  total_courses: number;
  total_students: number;
  active_instructors: number;
}

interface Course {
  id: string | number;
  requestSubmittedDate: string;
  scheduledDate: string;
  courseTypeName: string;
  location: string;
  registeredStudents: number;
  status: string;
  instructor: string;
  notes?: string;
}

interface BillingSummary {
  total_invoices: number;
  pending_invoices: number;
  overdue_invoices: number;
  paid_invoices: number;
  payment_submitted: number;
  total_amount: number;
  pending_amount: number;
  overdue_amount: number;
  paid_amount: number;
  recent_invoices: { id: number; invoice_number: string; amount: number; status: string; due_date: string }[];
}

interface OrganizationDashboardProps {
  organizationData: OrganizationData | undefined;
  courses: Course[];
  archivedCourses?: Course[];
  billingSummary: BillingSummary | undefined;
}

const recentColumns = [
  { key: 'course', label: 'COURSE NAME', width: '1.2fr' },
  { key: 'submitted', label: 'DATE SUBMITTED', width: '0.8fr' },
  { key: 'location', label: 'LOCATION', width: '0.8fr' },
  { key: 'students', label: 'STUDENTS', width: '0.5fr', align: 'right' as const },
  { key: 'status', label: 'STATUS', width: '0.6fr' },
];

const getStatusKind = (status: string): 'success' | 'active' | 'danger' | 'warning' | 'pending' => {
  switch (status?.toLowerCase()) {
    case 'confirmed': case 'completed': return 'success';
    case 'cancelled': case 'past_due': return 'danger';
    default: return 'pending';
  }
};

const OrganizationDashboard: React.FC<OrganizationDashboardProps> = ({
  courses,
  archivedCourses = [],
  billingSummary,
}) => {
  const navigate = useNavigate();
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [yoyData, setYoyData] = useState<{
    coursesThisYear: number; coursesLastYear: number;
    studentsThisYear: number; studentsLastYear: number;
    revenueThisYear: number; revenueLastYear: number;
  } | null>(null);

  useEffect(() => {
    organizationApi.getDashboard().then((res: { data?: Record<string, number> }) => {
      const d = res?.data;
      if (d) setYoyData({
        coursesThisYear: d.coursesThisYear ?? 0,
        coursesLastYear: d.coursesLastYear ?? 0,
        studentsThisYear: d.studentsThisYear ?? 0,
        studentsLastYear: d.studentsLastYear ?? 0,
        revenueThisYear: d.revenueThisYear ?? 0,
        revenueLastYear: d.revenueLastYear ?? 0,
      });
    }).catch(() => { /* silently ignore */ });
  }, []);

  const getYoyLabel = (current: number, previous: number): { text: string; color: string } => {
    if (previous === 0) return current > 0 ? { text: 'New this year', color: '#16A34A' } : { text: '', color: '' };
    const pct = ((current - previous) / previous * 100).toFixed(0);
    const num = Number(pct);
    if (num > 0) return { text: `+${pct}% vs last year`, color: '#16A34A' };
    if (num < 0) return { text: `${pct}% vs last year`, color: '#CC1F1F' };
    return { text: '0% vs last year', color: '#6B7280' };
  };

  const handleDateChange = (from: string, to: string) => {
    setDateFrom(from);
    setDateTo(to);
  };

  const filterByDate = useCallback((items: Course[]) => {
    if (!dateFrom && !dateTo) return items;
    return items.filter((c) => {
      const d = c.scheduledDate || c.requestSubmittedDate;
      if (!d) return true;
      const dateStr = d.slice(0, 10);
      if (dateFrom && dateStr < dateFrom) return false;
      if (dateTo && dateStr > dateTo) return false;
      return true;
    });
  }, [dateFrom, dateTo]);

  const filteredCourses = useMemo(() => filterByDate(courses || []), [courses, filterByDate]);
  const filteredArchived = useMemo(() => filterByDate(archivedCourses || []), [archivedCourses, filterByDate]);

  const allCourses = [...filteredCourses, ...filteredArchived];
  const totalStudents = allCourses.reduce((sum, course) => sum + Number(course?.registeredStudents || 0), 0);
  const recentCourses = filteredCourses.slice(0, 5);

  const invoiceStatusData = [
    { name: 'Paid', value: billingSummary?.paid_invoices || 0, color: '#16A34A' },
    { name: 'Pending', value: billingSummary?.pending_invoices || 0, color: '#ED6C02' },
    { name: 'Overdue', value: billingSummary?.overdue_invoices || 0, color: '#CC1F1F' },
    { name: 'Submitted', value: billingSummary?.payment_submitted || 0, color: '#3B82F6' },
  ];

  const filteredInvoiceData = invoiceStatusData.filter(item => item.value > 0);
  const hasInvoiceData = filteredInvoiceData.length > 0;
  const displayInvoiceData = hasInvoiceData ? filteredInvoiceData : [{ name: 'No Invoices', value: 1, color: '#9CA3AF' }];

  const courseStatusData = filteredCourses.reduce((acc, course) => {
    const status = course.status?.toLowerCase() || 'pending';
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const courseStatusChartData = Object.entries(courseStatusData).map(([status, count]) => ({
    name: status.charAt(0).toUpperCase() + status.slice(1),
    value: count,
  }));

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <DateRangeFilter from={dateFrom} to={dateTo} onChange={handleDateChange} />

      {/* Stats */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(3, 1fr)', md: 'repeat(6, 1fr)' }, gap: 2 }}>
        <StatCard label="Total Courses" value={allCourses.length}
          sub={yoyData ? getYoyLabel(yoyData.coursesThisYear, yoyData.coursesLastYear).text : undefined}
          subColor={yoyData ? getYoyLabel(yoyData.coursesThisYear, yoyData.coursesLastYear).color : undefined} />
        <StatCard label="Total Students" value={totalStudents}
          sub={yoyData ? getYoyLabel(yoyData.studentsThisYear, yoyData.studentsLastYear).text : undefined}
          subColor={yoyData ? getYoyLabel(yoyData.studentsThisYear, yoyData.studentsLastYear).color : undefined} />
        <StatCard label="Pending Invoices" value={Number(billingSummary?.pending_invoices || 0)} dotColor="#ED6C02" />
        <StatCard label="Total Billed" value={`$${Number(billingSummary?.total_amount || 0).toFixed(2)}`}
          sub={yoyData ? getYoyLabel(yoyData.revenueThisYear, yoyData.revenueLastYear).text : undefined}
          subColor={yoyData ? getYoyLabel(yoyData.revenueThisYear, yoyData.revenueLastYear).color : undefined} />
        <StatCard label="Total Paid" value={`$${Number(billingSummary?.paid_amount || 0).toFixed(2)}`} dotColor="#16A34A" />
        <StatCard label="Balance Due" value={`$${Number((billingSummary?.total_amount || 0) - (billingSummary?.paid_amount || 0)).toFixed(2)}`} dotColor="#CC1F1F" />
      </Box>

      {/* Charts */}
      <Grid container spacing={3}>
        <Grid item xs={12} md={6}>
          <Box sx={{ border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', bgcolor: (theme) => theme.palette.background.paper, p: 3, height: 380 }}>
            <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.07em', mb: 2 }}>
              Invoice Status Distribution
            </Typography>
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  data={displayInvoiceData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent, value }) => hasInvoiceData ? `${name}: ${value} (${(percent * 100).toFixed(0)}%)` : name}
                  outerRadius={100}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {displayInvoiceData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <RechartsTooltip />
              </PieChart>
            </ResponsiveContainer>
            {hasInvoiceData && (
              <Box sx={{ display: 'flex', justifyContent: 'center', gap: 2, mt: 1 }}>
                {displayInvoiceData.map((entry) => (
                  <Box key={entry.name} sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                    <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: entry.color }} />
                    <Typography sx={{ fontSize: 11, color: (theme) => theme.palette.text.secondary }}>{entry.name}: {entry.value}</Typography>
                  </Box>
                ))}
              </Box>
            )}
          </Box>
        </Grid>

        <Grid item xs={12} md={6}>
          <Box sx={{ border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', bgcolor: (theme) => theme.palette.background.paper, p: 3, height: 380 }}>
            <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.07em', mb: 2 }}>
              Course Activity Overview
            </Typography>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={courseStatusChartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <RechartsTooltip />
                <Bar dataKey="value" fill="#CC1F1F" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Box>
        </Grid>
      </Grid>

      {/* Recent Courses + Billing Summary */}
      <Grid container spacing={3}>
        <Grid item xs={12} md={8}>
          {recentCourses.length === 0 ? (
            <Box sx={{ bgcolor: (theme) => theme.palette.background.paper, border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', p: 6, textAlign: 'center' }}>
              <Typography sx={{ fontSize: 14, fontWeight: 600, color: (theme) => theme.palette.text.secondary }}>No courses found</Typography>
            </Box>
          ) : (
            <DataTable columns={recentColumns} shownCount={recentCourses.length} totalCount={filteredCourses.length}>
              {recentCourses.map((course) => (
                <DataTableRow key={course.id} columns={recentColumns}>
                  <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: (theme) => theme.palette.text.primary }}>{course.courseTypeName}</Typography>
                  <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{formatDisplayDate(course.requestSubmittedDate)}</Typography>
                  <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{course.location}</Typography>
                  <Typography sx={{ fontSize: 13, fontWeight: 600, color: (theme) => theme.palette.text.primary, textAlign: 'right' }}>{course.registeredStudents}</Typography>
                  <StatusChip kind={getStatusKind(course.status)} label={course.status} />
                </DataTableRow>
              ))}
            </DataTable>
          )}
        </Grid>

        <Grid item xs={12} md={4}>
          <Box sx={{ border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', bgcolor: (theme) => theme.palette.background.paper, p: 3 }}>
            <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.07em', mb: 2 }}>
              Billing Summary
            </Typography>

            {[
              { label: 'Total Invoices', value: billingSummary?.total_invoices || 0, color: 'text.primary', pct: 100 },
              { label: 'Pending Amount', value: `$${Number(billingSummary?.pending_amount || 0).toFixed(2)}`, color: '#ED6C02', pct: billingSummary?.total_amount ? (billingSummary.pending_amount / billingSummary.total_amount) * 100 : 0 },
              { label: 'Overdue Amount', value: `$${Number(billingSummary?.overdue_amount || 0).toFixed(2)}`, color: '#CC1F1F', pct: billingSummary?.total_amount ? (billingSummary.overdue_amount / billingSummary.total_amount) * 100 : 0 },
              { label: 'Paid Amount', value: `$${Number(billingSummary?.paid_amount || 0).toFixed(2)}`, color: '#16A34A', pct: billingSummary?.total_amount ? (billingSummary.paid_amount / billingSummary.total_amount) * 100 : 0 },
            ].map(({ label, value, color, pct }) => (
              <Box key={label} sx={{ mb: 2 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                  <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.text.secondary }}>{label}</Typography>
                  <Typography sx={{ fontSize: 14, fontWeight: 700, color }}>{value}</Typography>
                </Box>
                <LinearProgress
                  variant="determinate"
                  value={pct}
                  sx={{ height: 4, borderRadius: 2, bgcolor: (theme) => theme.palette.divider, '& .MuiLinearProgress-bar': { bgcolor: color, borderRadius: 2 } }}
                />
              </Box>
            ))}

            <Box sx={{ borderTop: (theme) => `1px solid ${theme.palette.divider}`, pt: 2, mt: 2 }}>
              <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.text.secondary, mb: 1 }}>Quick Actions</Typography>
              <Box sx={{ display: 'flex', gap: 1 }}>
                <GhostButton onClick={() => navigate('/organization/billing')} sx={{ fontSize: 12 }}>View Invoices</GhostButton>
                <GhostButton onClick={() => navigate('/organization/billing')} sx={{ fontSize: 12 }}>Submit Payment</GhostButton>
              </Box>
            </Box>
          </Box>
        </Grid>
      </Grid>
    </Box>
  );
};

export default OrganizationDashboard;
