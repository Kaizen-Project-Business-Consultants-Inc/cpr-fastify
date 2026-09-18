import React, { useState, useMemo } from 'react';
import {
  Box,
  Typography,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
} from '@mui/material';
import { CombinedScheduleItem } from '../../../types/instructor';
import { formatDisplayDate } from '../../../utils/dateUtils';
import { handleError } from '../../../services/errorHandler';
import DataTable, { DataTableRow } from '../../gtacpr/DataTable';
import StatusChip from '../../gtacpr/StatusChip';
import { GhostButton, PrimaryButton } from '../../gtacpr/Buttons';
import LinkButton from '../../gtacpr/LinkButton';
import { useSnackbar } from '../../../contexts/SnackbarContext';

interface MyClassesViewProps {
  combinedSchedule?: CombinedScheduleItem[];
  onCompleteClass: (item: CombinedScheduleItem) => void;
  onRemoveAvailability?: (date: string) => Promise<{ success: boolean; error?: string }>;
}

type SortField = 'date' | 'status' | null;
type SortDirection = 'asc' | 'desc';

const columns = [
  { key: 'date', label: 'DATE', width: '0.8fr' },
  { key: 'org', label: 'ORGANIZATION', width: '1fr' },
  { key: 'location', label: 'LOCATION', width: '0.8fr' },
  { key: 'courseNo', label: 'COURSE NO', width: '0.7fr' },
  { key: 'courseName', label: 'COURSE NAME', width: '1fr' },
  { key: 'studentsR', label: 'STUDENTS R', width: '0.6fr', align: 'right' as const },
  { key: 'studentsA', label: 'STUDENTS A', width: '0.6fr', align: 'right' as const },
  { key: 'notes', label: 'NOTES', width: '0.8fr' },
  { key: 'status', label: 'STATUS', width: '0.7fr' },
  { key: 'actions', label: '', width: '0.5fr', align: 'right' as const },
];

const MyClassesView: React.FC<MyClassesViewProps> = ({
  combinedSchedule = [],
  onCompleteClass: _onCompleteClass,
  onRemoveAvailability,
}) => {
  // No column-header sort UI is wired up yet; sortedSchedule below is therefore always
  // a pass-through of combinedSchedule. The setters are kept (unused for now) so a future
  // sort-header click handler can flip them without re-plumbing this state.
  const [sortField, _setSortField] = useState<SortField>(null);
  const [sortDirection, _setSortDirection] = useState<SortDirection>('asc');
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; date: string }>({ open: false, date: '' });
  const [removing, setRemoving] = useState(false);
  const { showSuccess, showError } = useSnackbar();

  /** The API needs YYYY-MM-DD; displayDate is already formatted for humans. */
  const rawDateOf = (item: CombinedScheduleItem): string => {
    const original = item.originalData as { date?: string } | undefined;
    if (original?.date) return String(original.date).slice(0, 10);
    return item.displayDate;
  };

  const sortedSchedule = useMemo(() => {
    if (!sortField) return combinedSchedule;
    return [...combinedSchedule].sort((a, b) => {
      let aValue: Date | string;
      let bValue: Date | string;
      if (sortField === 'date') {
        aValue = new Date(a.displayDate);
        bValue = new Date(b.displayDate);
      } else if (sortField === 'status') {
        aValue = a.status?.toLowerCase() || '';
        bValue = b.status?.toLowerCase() || '';
      } else {
        return 0;
      }
      if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [combinedSchedule, sortField, sortDirection]);

  const handleDeleteClick = (date: string) => { setDeleteDialog({ open: true, date }); };

  const handleDeleteConfirm = async () => {
    if (!onRemoveAvailability || removing) return;
    setRemoving(true);
    try {
      const result = await onRemoveAvailability(deleteDialog.date);
      if (result && result.success === false) {
        showError(result.error || 'Failed to remove availability');
      } else {
        showSuccess(`Availability removed for ${formatDisplayDate(deleteDialog.date)}`);
        setDeleteDialog({ open: false, date: '' });
      }
    } catch (error) {
      handleError(error, { component: 'MyClassesView', action: 'remove availability' });
      showError(error instanceof Error ? error.message : 'Failed to remove availability');
    } finally {
      setRemoving(false);
    }
  };

  const handleDeleteCancel = () => { if (!removing) setDeleteDialog({ open: false, date: '' }); };

  const isDateTooClose = (date: string) => {
    const today = new Date();
    const targetDate = new Date(date);
    const diffDays = Math.ceil((targetDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    return diffDays < 11;
  };

  return (
    <>
      {sortedSchedule.length === 0 ? (
        <Box sx={{ bgcolor: (theme) => theme.palette.background.paper, border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', p: 6, textAlign: 'center' }}>
          <Typography sx={{ color: (theme) => theme.palette.text.secondary, fontSize: 14 }}>No schedule items found.</Typography>
        </Box>
      ) : (
        <DataTable columns={columns} shownCount={sortedSchedule.length} totalCount={combinedSchedule.length}>
          {sortedSchedule.map((item, index) => (
            <DataTableRow key={`${item.type}-${item.courseId || item.originalData?.id || index}`} columns={columns}>
              <Typography sx={{ fontSize: 13, fontWeight: 600, color: (theme) => theme.palette.text.primary }}>{item.displayDate}</Typography>
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{item.type === 'class' ? item.organizationName : ''}</Typography>
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{item.type === 'class' ? item.location : ''}</Typography>
              <Typography sx={{ fontSize: 12.5, fontFamily: 'monospace', color: (theme) => theme.palette.text.secondary }}>{item.type === 'class' ? item.courseNumber : ''}</Typography>
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{item.type === 'class' ? item.courseTypeName : ''}</Typography>
              <Typography sx={{ fontSize: 13, fontWeight: 600, color: (theme) => theme.palette.text.primary, textAlign: 'right' }}>{item.type === 'class' ? item.studentsRegistered : ''}</Typography>
              <Typography sx={{ fontSize: 13, fontWeight: 600, color: (theme) => theme.palette.text.primary, textAlign: 'right' }}>{item.type === 'class' ? item.studentsAttendance : ''}</Typography>
              <Typography sx={{ fontSize: 12.5, color: (theme) => theme.palette.text.secondary }}>{item.type === 'class' ? item.notes : ''}</Typography>
              {item.type === 'class' ? (
                <StatusChip kind={item.status === 'completed' ? 'success' : 'active'} label={item.status || 'Scheduled'} />
              ) : (
                <StatusChip kind="success" label="Available" />
              )}
              <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                {item.type === 'availability' && onRemoveAvailability && (
                  <LinkButton tone="danger" onClick={() => handleDeleteClick(rawDateOf(item))} aria-label={`Remove availability for ${item.displayDate}`}>Remove</LinkButton>
                )}
              </Box>
            </DataTableRow>
          ))}
        </DataTable>
      )}

      <Dialog open={deleteDialog.open} onClose={handleDeleteCancel}>
        <DialogTitle sx={{ fontSize: 18, fontWeight: 700, color: (theme) => theme.palette.text.primary }}>Remove Availability</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ fontSize: 14, color: (theme) => theme.palette.text.secondary }}>
            Are you sure you want to remove your availability for {formatDisplayDate(deleteDialog.date)}?
            {isDateTooClose(deleteDialog.date) && ' This date is less than 11 days away and cannot be modified.'}
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <GhostButton onClick={handleDeleteCancel} disabled={removing}>Cancel</GhostButton>
          <PrimaryButton onClick={handleDeleteConfirm} disabled={removing || isDateTooClose(deleteDialog.date)}>
            {removing ? 'Removing…' : 'Remove'}
          </PrimaryButton>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default MyClassesView;
