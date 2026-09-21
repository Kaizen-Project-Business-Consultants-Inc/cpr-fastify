import React, { useEffect, useState } from 'react';
import { Box, Typography, CircularProgress, Chip } from '@mui/material';
import api from '../../../services/api';
import DataTable, { DataTableRow } from '../../gtacpr/DataTable';

const columns = [
  { key: 'received', label: 'RECEIVED', width: '0.8fr' },
  { key: 'from', label: 'FROM', width: '1.1fr' },
  { key: 'subject', label: 'SUBJECT', width: '1.2fr' },
  { key: 'status', label: 'STATUS', width: '0.9fr' },
  { key: 'guess', label: 'BEST GUESS', width: '1.5fr' },
  { key: 'reason', label: 'WHY IT WASN\'T CREATED', width: '1.5fr' },
];

interface Extracted {
  courseTypeText?: string | null;
  scheduledDate?: string | null;
  location?: string | null;
  registeredStudents?: number | null;
}

interface InboundEmailRow {
  id: number;
  from_address: string;
  subject: string | null;
  status: 'unmatched_sender' | 'needs_review';
  extracted: Extracted | null;
  reject_reason: string | null;
  created_at: string;
}

const STATUS_LABEL: Record<string, string> = {
  unmatched_sender: 'Unrecognized sender',
  needs_review: 'Needs review',
};

const EmailRequestsReview: React.FC = () => {
  const [rows, setRows] = useState<InboundEmailRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.get('/inbound-email/needs-review')
      .then((r) => { if (!cancelled) setRows(r.data.data ?? []); })
      .catch(() => { if (!cancelled) setError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}><CircularProgress size={24} /></Box>;
  }
  if (error) {
    return <Typography sx={{ fontSize: 14, color: '#CC1F1F' }}>Error loading email requests</Typography>;
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
        Course-request emails that didn&apos;t create a request automatically — either the sender
        wasn&apos;t recognized, or a required detail (course, date, location, or student count)
        couldn&apos;t be confidently read. Follow up with the client directly.
      </Typography>
      {rows.length === 0 ? (
        <Box sx={{ bgcolor: (theme) => theme.palette.background.paper, border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', p: 6, textAlign: 'center' }}>
          <Typography sx={{ fontSize: 14, fontWeight: 600, color: (theme) => theme.palette.text.secondary }}>Nothing needs review</Typography>
        </Box>
      ) : (
        <DataTable columns={columns} shownCount={rows.length} totalCount={rows.length}>
          {rows.map((row) => {
            const guess = row.extracted
              ? [row.extracted.courseTypeText, row.extracted.scheduledDate, row.extracted.location,
                  row.extracted.registeredStudents != null ? `${row.extracted.registeredStudents} students` : null]
                  .filter(Boolean).join(' · ')
              : '-';
            return (
              <DataTableRow key={row.id} columns={columns}>
                <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
                  {new Date(row.created_at).toLocaleString()}
                </Typography>
                <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{row.from_address}</Typography>
                <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{row.subject || '-'}</Typography>
                <Chip
                  label={STATUS_LABEL[row.status] ?? row.status}
                  size="small"
                  color={row.status === 'unmatched_sender' ? 'warning' : 'default'}
                  variant="outlined"
                />
                <Typography sx={{ fontSize: 12.5, color: (theme) => theme.palette.text.secondary }}>{guess || '-'}</Typography>
                <Typography sx={{ fontSize: 12.5, color: (theme) => theme.palette.text.secondary }}>
                  {row.status === 'unmatched_sender' ? 'Sender email isn\'t linked to an organization account' : (row.reject_reason || '-')}
                </Typography>
              </DataTableRow>
            );
          })}
        </DataTable>
      )}
    </Box>
  );
};

export default EmailRequestsReview;
