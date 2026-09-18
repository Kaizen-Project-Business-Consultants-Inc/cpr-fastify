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
import { useInstructorClasses, useInstructorAvailability, useAddAvailability, useRemoveAvailability } from '../../../services/instructorService';
import { useNavigate } from 'react-router-dom';
import { handleError } from '../../../services/errorHandler';

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
  onAddAvailability?: (
    date: string
  ) => Promise<{ success: boolean; error?: string } | void>;
  onRemoveAvailability?: (
    date: string
  ) => Promise<{ success: boolean; error?: string } | void>;
  ontarioHolidays2024?: string[];
  isLoading?: boolean;
}

interface ConfirmationState {
  open: boolean;
  date: string;
  action: 'add' | 'remove';
  isAvailable: boolean;
}

const AvailabilityView: React.FC<AvailabilityViewProps> = ({
  availableDates: propAvailableDates = [],
  scheduledClasses: propScheduledClasses = [],
  onAddAvailability,
  onRemoveAvailability,
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
  const addAvailabilityMutation = useAddAvailability();
  const removeAvailabilityMutation = useRemoveAvailability();

  // Type cast the fetched data
  const fetchedClasses = (Array.isArray(rawFetchedClasses) ? rawFetchedClasses : []) as ScheduledClassItem[];
  const fetchedAvailability = (Array.isArray(rawFetchedAvailability) ? rawFetchedAvailability : []) as AvailabilitySlot[];

  // Use fetched data if no props provided, otherwise use props
  const scheduledClasses = (propScheduledClasses && propScheduledClasses.length > 0) ? propScheduledClasses : fetchedClasses;

  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<ConfirmationState>({
    open: false,
    date: '',
    action: 'add',
    isAvailable: false,
  });
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

  const handleDateClick = async (date: Date | null) => {
    if (!date || !isAuthenticated) {
      return;
    }

    const dateStr = format(date, 'yyyy-MM-dd');
    const isAvailable = availableDates.some(d => {
      if (!d) return false;
      const dStr = typeof d === 'string' ? d.slice(0, 10) : '';
      return dStr.length === 10 && !isNaN(new Date(dStr).getTime()) && dStr === dateStr;
    });

    // An instructor cannot cancel availability 5 days or less before the date.
    const today = new Date();
    const diffTime = date.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (isAvailable && diffDays <= 5) {
      setError('Availability cannot be cancelled 5 days or less before the date. Contact your administrator if you need to cancel.');
      return;
    }

    // Show confirmation dialog
    setConfirmation({
      open: true,
      date: dateStr,
      action: isAvailable ? 'remove' : 'add',
      isAvailable,
    });
  };

  const handleConfirmationClose = () => {
    if (saving) return;
    setConfirmation(prev => ({ ...prev, open: false }));
  };

  const handleConfirmationConfirm = async () => {
    if (saving) return;
    setSaving(true);
    try {
      if (confirmation.action === 'add') {
        // Use prop callback if provided, otherwise use mutation hook
        if (onAddAvailability) {
          await onAddAvailability(confirmation.date);
        } else {
          await addAvailabilityMutation.mutateAsync(confirmation.date);
        }
        setSuccessMessage('Availability added successfully');
      } else {
        // Use prop callback if provided, otherwise use mutation hook
        if (onRemoveAvailability) {
          await onRemoveAvailability(confirmation.date);
        } else {
          await removeAvailabilityMutation.mutateAsync(confirmation.date);
        }
        setSuccessMessage('Availability removed successfully');
      }
    } catch (err: unknown) {
      handleError(err, { component: 'AvailabilityView', action: 'update availability' });
      setError(err instanceof Error ? err.message : 'Failed to update availability');
    } finally {
      setSaving(false);
      setConfirmation(prev => ({ ...prev, open: false }));
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

    // An instructor cannot cancel availability 5 days or less before the date.
    const today = new Date();
    const diffTime = day.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    const isWithinCancelLockout = diffDays <= 5;

    // Color logic with priority: Scheduled > Available > Today > Past > Default
    let backgroundColor, hoverColor, tooltipTitle, textColor;
    let borderStyle = 'none';
    let opacity = 1;
    let cursor = 'pointer';

    if (isScheduled) {
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
        : 'Available - Click to remove';
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
      tooltipTitle = 'Today - Click to mark as available';
    } else {
      // All other dates use default styling
      backgroundColor = 'inherit';
      hoverColor = theme.palette.action.hover;
      textColor = 'inherit';

      if (isHoliday) {
        tooltipTitle = 'Holiday';
      } else {
        tooltipTitle = 'Click to mark as available';
      }
    }

    // Add yellow border for today regardless of other styling
    if (isToday && !isPastDate) {
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
              if (isAvailable && isWithinCancelLockout) {
                setError('Availability cannot be cancelled 5 days or less before the date. Contact your administrator if you need to cancel.');
                return;
              }
              handleDateClick(day);
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
            Click on dates to mark them as available or unavailable for teaching.
          </Typography>
        </Box>

        {error && (
          <Alert severity='error' sx={{ mb: 2 }}>
            {error}
          </Alert>
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
                    Click on future dates to toggle availability
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
        open={confirmation.open}
        onClose={handleConfirmationClose}
        aria-labelledby='confirmation-dialog-title'
        aria-describedby='confirmation-dialog-description'
      >
        <DialogTitle id='confirmation-dialog-title'>
          {confirmation.action === 'add'
            ? 'Add Availability'
            : 'Remove Availability'}
        </DialogTitle>
        <DialogContent>
          <DialogContentText id='confirmation-dialog-description'>
            {confirmation.action === 'add'
              ? `Are you sure you want to mark ${confirmation.date} as available for teaching?`
              : `Are you sure you want to remove your availability for ${confirmation.date}?`}
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <GhostButton onClick={handleConfirmationClose} disabled={saving}>Cancel</GhostButton>
          <PrimaryButton onClick={handleConfirmationConfirm} disabled={saving}>
            {saving ? 'Saving…' : confirmation.action === 'add' ? 'Add Availability' : 'Remove Availability'}
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
