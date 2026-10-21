import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  CircularProgress,
  Alert,
  Tooltip,
  useTheme,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Snackbar,
} from '@mui/material';
import { PrimaryButton, GhostButton } from '../../gtacpr/Buttons';
import { format } from 'date-fns';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { DateCalendar } from '@mui/x-date-pickers/DateCalendar';
import { PickersDay, PickersDayProps } from '@mui/x-date-pickers/PickersDay';
import { useAuth } from '../../../contexts/AuthContext';
import { useInstructorClasses, useInstructorAvailability, useSaveAvailabilityBatch } from '../../../services/instructorService';
import type { AvailabilityBatchResult } from '../../../services/api';
import { useNavigate } from 'react-router-dom';
import { getErrorMessage } from '../../../utils/errorMessage';

interface AvailabilitySlot {
  id: number;
  date: string;
  status?: string;
}

interface ScheduledClassItem {
  course_id?: number;
  date: string;
  datescheduled?: string;
  organizationname?: string;
  organization_name?: string;
  location?: string;
  course_name?: string;
  course_type?: string;
  studentcount?: number;
  studentsattendance?: number;
  status?: string;
}

interface AvailabilityViewProps {
  availableDates?: (string | AvailabilitySlot)[];
  scheduledClasses?: ScheduledClassItem[];
  ontarioHolidays2024?: string[];
  isLoading?: boolean;
}

/** Days tapped but not saved yet: an open day is "add", an available day "remove". */
type PendingChanges = Record<string, 'add' | 'remove'>;

const CANCEL_LOCKOUT_MESSAGE =
  'Availability cannot be cancelled 5 days or less before the date. Contact your administrator if you need to cancel.';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

const AvailabilityView: React.FC<AvailabilityViewProps> = ({
  availableDates: propAvailableDates = [],
  scheduledClasses: propScheduledClasses = [],
  ontarioHolidays2024 = [],
  isLoading = false,
}) => {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const theme = useTheme();
  const [currentDate, setCurrentDate] = useState<Date>(new Date());
  const holidays = ontarioHolidays2024;

  // Fetch data using service hooks
  const { data: rawFetchedClasses, isLoading: classesLoading } = useInstructorClasses();
  const { data: rawFetchedAvailability, isLoading: availabilityLoading } = useInstructorAvailability();
  const saveBatchMutation = useSaveAvailabilityBatch();

  // Type cast the fetched data
  const fetchedClasses = (Array.isArray(rawFetchedClasses) ? rawFetchedClasses : []) as ScheduledClassItem[];
  const fetchedAvailability = (Array.isArray(rawFetchedAvailability) ? rawFetchedAvailability : []) as AvailabilitySlot[];

  // Use fetched data if no props provided, otherwise use props
  const scheduledClasses = (propScheduledClasses && propScheduledClasses.length > 0) ? propScheduledClasses : fetchedClasses;

  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingChanges>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [skipped, setSkipped] = useState<AvailabilityBatchResult['skipped']>([]);
  const [successMessage, setSuccessMessage] = useState<string>('');
  const [saving, setSaving] = useState(false);

  // Ensure availableDates is always an array and extract dates
  // Use fetched availability if no props provided
  const availabilitySource = (propAvailableDates && propAvailableDates.length > 0) ? propAvailableDates : fetchedAvailability;

  const availableDates = React.useMemo(() => {
    return (Array.isArray(availabilitySource) ? availabilitySource : [])
      .map(item => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object' && 'date' in item) {
          // Handle both YYYY-MM-DD and ISO date formats
          const dateStr = item.date;
          return dateStr.includes('T') ? dateStr.split('T')[0] : dateStr;
        }
        return null;
      })
      .filter((date): date is string => date !== null);
  }, [availabilitySource]);

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }
  }, [isAuthenticated, navigate]);

  const toAdd = Object.keys(pending).filter(d => pending[d] === 'add').sort();
  const toRemove = Object.keys(pending).filter(d => pending[d] === 'remove').sort();
  const pendingCount = toAdd.length + toRemove.length;
  // "3 days to add, 1 to remove" / "1 day to remove"
  const pendingText = [
    toAdd.length > 0 ? `${plural(toAdd.length, 'day')} to add` : '',
    toRemove.length > 0
      ? `${toAdd.length > 0 ? toRemove.length : plural(toRemove.length, 'day')} to remove`
      : '',
  ].filter(Boolean).join(', ');

  /** Tap a day: put it in (or take it out of) the pending selection. */
  const toggleDay = (dateStr: string, isAvailable: boolean) => {
    if (!isAuthenticated) return;
    setError(null);
    setPending(prev => {
      const next = { ...prev };
      if (next[dateStr]) delete next[dateStr];
      else next[dateStr] = isAvailable ? 'remove' : 'add';
      return next;
    });
  };

  const handleConfirmationClose = () => {
    if (saving) return;
    setConfirmOpen(false);
  };

  const handleConfirmationConfirm = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      // One request for every selected day; the server skips (with a reason)
      // any day it can't change and saves the rest together.
      const result = await saveBatchMutation.mutateAsync({ add: toAdd, remove: toRemove });
      const done = [
        result.added.length > 0 ? `${plural(result.added.length, 'day')} added` : '',
        result.removed.length > 0 ? `${plural(result.removed.length, 'day')} removed` : '',
      ].filter(Boolean).join(', ');
      setSkipped(result.skipped);
      setSuccessMessage(done ? `Availability saved: ${done}` : '');
      setPending({});
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to update availability'));
    } finally {
      setSaving(false);
      setConfirmOpen(false);
    }
  };

  const CustomDay = (props: PickersDayProps<Date>) => {
    const { day, ...other } = props;
    const dateStr = format(day, 'yyyy-MM-dd');
    const todayStr = format(new Date(), 'yyyy-MM-dd');
    const isToday = dateStr === todayStr;

    const isAvailable = availableDates.some(d => {
      if (!d) return false;
      const dStr = typeof d === 'string' ? d.slice(0, 10) : '';
      return dStr.length === 10 && !isNaN(new Date(dStr).getTime()) && dStr === dateStr;
    });

    const isScheduled = scheduledClasses.some(c => {
      // Check multiple possible date field names from backend
      const classDate = c.date || c.datescheduled;
      return classDate === dateStr;
    });

    const isHoliday = holidays.includes(dateStr);
    const isPastDate = day < new Date(new Date().setHours(0, 0, 0, 0));

    // An instructor cannot cancel availability 5 days or less before an
    // upcoming date. Excludes negative diffDays (already past) so the
    // tooltip correctly falls through to the isPastDate branch below
    // instead of claiming a long-gone date is "5 days or less" away.
    const today = new Date();
    const diffTime = day.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    const isWithinCancelLockout = diffDays >= 0 && diffDays <= 5;
    const pendingAction = pending[dateStr];

    // Color logic with priority: Scheduled > Available > Today > Past > Default
    let backgroundColor, hoverColor, tooltipTitle, textColor;
    let borderStyle = 'none';
    let opacity = 1;
    let cursor = 'pointer';

    if (pendingAction === 'add') {
      // Picked, not saved yet: light green with a dashed green ring
      backgroundColor = theme.palette.success.light;
      hoverColor = theme.palette.success.main;
      textColor = 'white';
      borderStyle = `2px dashed ${theme.palette.success.dark}`;
      tooltipTitle = 'To add - Click to undo';
    } else if (pendingAction === 'remove') {
      // Picked for removal, not saved yet: light red with a dashed red ring
      backgroundColor = theme.palette.error.light;
      hoverColor = theme.palette.error.main;
      textColor = 'white';
      borderStyle = `2px dashed ${theme.palette.error.dark}`;
      tooltipTitle = 'To remove - Click to undo';
    } else if (isScheduled) {
      // Blue = Scheduled Classes
      backgroundColor = theme.palette.primary.main;
      hoverColor = theme.palette.primary.dark;
      textColor = 'white';
      cursor = 'not-allowed';
      const classInfo = scheduledClasses.find(
        c => (c.date || c.datescheduled) === dateStr
      );
      tooltipTitle = `Scheduled: ${classInfo?.organizationname || 'Class'}`;
    } else if (isAvailable) {
      // Green = Available
      backgroundColor = theme.palette.success.main;
      hoverColor = theme.palette.success.dark;
      textColor = 'white';
      tooltipTitle = isWithinCancelLockout
        ? 'Cannot cancel availability 5 days or less before the date'
        : isPastDate
        ? 'Cannot unmark past availability'
        : 'Available - Click to select for removal';
    } else if (isPastDate) {
      // Grey out past dates
      backgroundColor = theme.palette.grey[300];
      hoverColor = theme.palette.grey[300];
      textColor = theme.palette.grey[500];
      opacity = 0.6;
      cursor = 'not-allowed';
      tooltipTitle = 'Past date - Cannot mark availability';
    } else if (isToday) {
      // Yellow circle for today
      backgroundColor = '#FFC107'; // Yellow/Amber
      hoverColor = '#FFB300';
      textColor = '#000';
      tooltipTitle = 'Today - Click to select';
    } else {
      // All other dates use default styling
      backgroundColor = 'inherit';
      hoverColor = theme.palette.action.hover;
      textColor = 'inherit';

      if (isHoliday) {
        tooltipTitle = 'Holiday';
      } else {
        tooltipTitle = 'Click to select';
      }
    }

    // Add yellow border for today regardless of other styling
    if (isToday && !isPastDate && !pendingAction) {
      borderStyle = '3px solid #FFC107';
    }

    return (
      <Tooltip title={tooltipTitle} arrow>
        <span style={{ display: 'inline-block' }}>
          <PickersDay
            {...other}
            day={day}
            disabled={isPastDate && !isAvailable && !isScheduled}
            onClick={() => {
              // Block clicks on past dates
              if (isPastDate) {
                if (isAvailable) {
                  setError('Cannot unmark past availability');
                }
                return;
              }
              // A day with a class can't be changed here
              if (isScheduled) {
                setError('You have a class on this day, so it can\'t be changed here. Contact your administrator.');
                return;
              }
              if (isAvailable && isWithinCancelLockout) {
                setError(CANCEL_LOCKOUT_MESSAGE);
                return;
              }
              toggleDay(dateStr, isAvailable);
            }}
            sx={{
              backgroundColor: `${backgroundColor}!important`,
              color: `${textColor}!important`,
              cursor: cursor,
              opacity: opacity,
              border: borderStyle,
              '&:hover': {
                backgroundColor: `${hoverColor}!important`,
              },
              '&.Mui-disabled': {
                backgroundColor: `${backgroundColor}!important`,
                color: `${textColor}!important`,
                opacity: opacity,
              },
            }}
          />
        </span>
      </Tooltip>
    );
  };

  // Combine loading states
  const combinedLoading = isLoading || classesLoading || availabilityLoading;

  if (combinedLoading) {
    return (
      <Box
        display='flex'
        justifyContent='center'
        alignItems='center'
        minHeight='400px'
      >
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <Box sx={{ border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', bgcolor: (theme) => theme.palette.background.paper, boxShadow: '0 1px 3px rgba(0,0,0,.05)', p: 3 }}>
        <Box sx={{ mb: 3 }}>
          <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.07em', mb: 1 }}>
            Manage Your Availability
          </Typography>
          <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
            Tap the days you want to change, then press Save changes. An open day will be added; a day you are already available will be removed.
          </Typography>
        </Box>

        {error && (
          <Alert severity='error' sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {skipped.length > 0 && (
          <Alert severity='warning' sx={{ mb: 2 }} onClose={() => setSkipped([])}>
            {plural(skipped.length, 'day')} could not be changed:
            <Box component='ul' sx={{ m: 0, pl: 2.5 }}>
              {skipped.map(item => (
                <li key={item.date}>
                  <strong>{item.date}</strong>: {item.reason}
                </li>
              ))}
            </Box>
          </Alert>
        )}

        {pendingCount > 0 && (
          <Box
            role='region'
            aria-label='Selected days'
            sx={{
              display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1.5, mb: 2, p: 1.5,
              border: `1px solid ${theme.palette.divider}`, borderRadius: '10px',
              bgcolor: theme.palette.action.hover,
            }}
          >
            <Typography variant='body2' sx={{ flex: '1 1 auto', fontWeight: 600 }}>
              {pendingText}
            </Typography>
            <GhostButton onClick={() => setPending({})} disabled={saving}>Clear</GhostButton>
            <PrimaryButton onClick={() => setConfirmOpen(true)} disabled={saving}>Save changes</PrimaryButton>
          </Box>
        )}

        <Box
          sx={{
            display: 'flex',
            flexDirection: { xs: 'column', md: 'row' },
            gap: 3,
          }}
        >
          <Box sx={{ flex: '1 1 auto' }}>
            <LocalizationProvider dateAdapter={AdapterDateFns}>
              <DateCalendar
                value={currentDate}
                onMonthChange={date => date && setCurrentDate(date)}
                slots={{
                  day: CustomDay,
                }}
              />
            </LocalizationProvider>
          </Box>
          <Box sx={{ flex: '0 0 auto', width: { xs: '100%', md: '300px' } }}>
            <Box sx={{ border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', p: 2 }}>
              <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.07em', mb: 1.5 }}>
                Legend
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Box
                    sx={{
                      width: 20,
                      height: 20,
                      borderRadius: '50%',
                      backgroundColor: '#FFC107',
                      border: '2px solid #FFB300',
                    }}
                  />
                  <Typography variant='body2'>Today</Typography>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Box
                    sx={{
                      width: 20,
                      height: 20,
                      borderRadius: '50%',
                      backgroundColor: theme.palette.success.main,
                    }}
                  />
                  <Typography variant='body2'>Available</Typography>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Box
                    sx={{
                      width: 20,
                      height: 20,
                      borderRadius: '50%',
                      backgroundColor: theme.palette.success.light,
                      border: `2px dashed ${theme.palette.success.dark}`,
                    }}
                  />
                  <Typography variant='body2'>Selected to add</Typography>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Box
                    sx={{
                      width: 20,
                      height: 20,
                      borderRadius: '50%',
                      backgroundColor: theme.palette.error.light,
                      border: `2px dashed ${theme.palette.error.dark}`,
                    }}
                  />
                  <Typography variant='body2'>Selected to remove</Typography>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Box
                    sx={{
                      width: 20,
                      height: 20,
                      borderRadius: '50%',
                      backgroundColor: theme.palette.primary.main,
                    }}
                  />
                  <Typography variant='body2'>Scheduled Classes</Typography>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Box
                    sx={{
                      width: 20,
                      height: 20,
                      borderRadius: '50%',
                      backgroundColor: theme.palette.grey[300],
                      opacity: 0.6,
                    }}
                  />
                  <Typography variant='body2'>Past (unavailable)</Typography>
                </Box>
                <Box
                  sx={{
                    mt: 1,
                    pt: 1,
                    borderTop: `1px solid ${theme.palette.divider}`,
                  }}
                >
                  <Typography variant='caption' color='text.secondary'>
                    Tap future dates to select them, then Save changes
                  </Typography>
                </Box>
              </Box>
            </Box>

            {/* Additional Info Panel */}
            <Box sx={{ border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', p: 2, mt: 2 }}>
              <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.07em', mb: 1.5 }}>
                Quick Stats
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <Typography variant='body2'>
                  Available Days: <strong>{availableDates.length}</strong>
                </Typography>
                <Typography variant='body2'>
                  Scheduled Classes: <strong>{scheduledClasses.length}</strong>
                </Typography>
              </Box>
            </Box>
          </Box>
        </Box>
      </Box>

      {/* Confirmation Dialog */}
      <Dialog
        open={confirmOpen}
        onClose={handleConfirmationClose}
        aria-labelledby='confirmation-dialog-title'
        aria-describedby='confirmation-dialog-description'
      >
        <DialogTitle id='confirmation-dialog-title'>Save Availability Changes</DialogTitle>
        <DialogContent>
          <DialogContentText id='confirmation-dialog-description' component='div'>
            {toAdd.length > 0 && (
              <Box sx={{ mb: 1 }}>
                <strong>Mark as available:</strong> {toAdd.join(', ')}
              </Box>
            )}
            {toRemove.length > 0 && (
              <Box>
                <strong>Remove availability:</strong> {toRemove.join(', ')}
              </Box>
            )}
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <GhostButton onClick={handleConfirmationClose} disabled={saving}>Cancel</GhostButton>
          <PrimaryButton onClick={handleConfirmationConfirm} disabled={saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </PrimaryButton>
        </DialogActions>
      </Dialog>

      {/* Success Snackbar */}
      <Snackbar
        open={!!successMessage}
        autoHideDuration={6000}
        onClose={() => setSuccessMessage('')}
        message={successMessage}
      />
    </Box>
  );
};

export default AvailabilityView;
