import React, { useEffect } from 'react';
import { Box, Typography, CircularProgress } from '@mui/material';
import api from '../../../services/api';
import { formatDateWithoutTimezone } from '../../../utils/dateUtils';
import DataTable, { DataTableRow } from '../../gtacpr/DataTable';
import useServerPagination from '../../../hooks/useServerPagination';

const columns = [
  { key: 'name', label: 'COURSE NAME', width: '1.2fr' },
  { key: 'org', label: 'ORGANIZATION', width: '1fr' },
  { key: 'scheduled', label: 'DATE SCHEDULED', width: '0.8fr' },
  { key: 'cancelled', label: 'CANCELLED DATE', width: '0.8fr' },
  { key: 'reason', label: 'REASON', width: '1.2fr' },
  { key: 'location', label: 'LOCATION', width: '0.8fr' },
  { key: 'students', label: 'STUDENTS', width: '0.5fr', align: 'right' as const },
];

interface CancelledCourse {
  id: number;
  courseTypeName: string;
  organizationName: string;
  scheduledDate: string;
  cancelledAt: string;
  cancellationReason: string;
  location: string;
  registeredStudents: number;
}

const CancelledCourses: React.FC = () => {
  // Server-side paging: `page`/`limit` opt the endpoint into a paginated
  // envelope. The screen has no filters of its own, so nothing has to be
  // narrowed client-side. If the endpoint answers without a `pagination`
  // block the hook treats the response as a single page holding every row,
  // which is exactly the previous behaviour.
  const grid = useServerPagination<CancelledCourse>({
    pageSize: 25,
    fetchFn: ({ page, limit }) =>
      api.get('/courses/cancelled', { params: { page, limit } }).then((r) => r.data),
  });

  useEffect(() => {
    grid.load(1);
    // `grid` is a new object every render; useServerPagination keeps `grid.load` itself
    // stable, which is the intended dep (see the hook's own usage example).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grid.load]);

  if (grid.loading && grid.items.length === 0) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}><CircularProgress size={24} /></Box>;
  }

  if (grid.error) {
    return <Typography sx={{ fontSize: 14, color: '#CC1F1F' }}>Error loading cancelled courses</Typography>;
  }

  const courses = grid.items;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {grid.totalCount === 0 ? (
        <Box sx={{ bgcolor: (theme) => theme.palette.background.paper, border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', p: 6, textAlign: 'center' }}>
          <Typography sx={{ fontSize: 14, fontWeight: 600, color: (theme) => theme.palette.text.secondary }}>No cancelled courses found</Typography>
        </Box>
      ) : (
        <DataTable
          columns={columns}
          shownCount={grid.shownCount}
          totalCount={grid.totalCount}
          page={grid.page}
          hasNextPage={grid.hasNextPage}
          onPrevPage={grid.onPrevPage}
          onNextPage={grid.onNextPage}
          loading={grid.loading}
          emptyMessage="No cancelled courses found"
        >
          {courses.map((course) => (
            <DataTableRow key={course.id} columns={columns}>
              <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: (theme) => theme.palette.text.primary }}>{course.courseTypeName}</Typography>
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{course.organizationName}</Typography>
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{formatDateWithoutTimezone(course.scheduledDate)}</Typography>
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{formatDateWithoutTimezone(course.cancelledAt)}</Typography>
              <Typography sx={{ fontSize: 12.5, color: (theme) => theme.palette.text.secondary }}>{course.cancellationReason}</Typography>
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{course.location}</Typography>
              <Typography sx={{ fontSize: 13, fontWeight: 600, color: (theme) => theme.palette.text.primary, textAlign: 'right' }}>{course.registeredStudents}</Typography>
            </DataTableRow>
          ))}
        </DataTable>
      )}
    </Box>
  );
};

export default CancelledCourses;
