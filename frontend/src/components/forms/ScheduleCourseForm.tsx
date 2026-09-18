import React, { useState, useEffect } from 'react';
import {
  Box,
  TextField,
  Button,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  CircularProgress,
  Typography,
  Alert,
  Grid,
  Paper,
} from '@mui/material';
import * as api from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import logger from '../../utils/logger';
import { getTodayDate, toLocalDateString } from '../../utils/formatters';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { PickersDay, PickersDayProps } from '@mui/x-date-pickers/PickersDay';
import { AxiosResponse } from 'axios';
import { format } from 'date-fns';

interface CourseType {
  id: number;
  name: string;
  description?: string;
  duration_minutes?: number;
}

interface FormData {
  scheduledDate: Date | null;
  location: string;
  courseTypeId: number;
  registeredStudents: string;
  notes: string;
  time?: string;
  instructorId?: number;
}

interface ApiResponse {
  success: boolean;
  error?: string;
  message?: string;
  course?: { id: number; scheduled_date: string; course_type_id: number };
}

interface ScheduleCourseFormProps {
  onCourseScheduled: () => void;
}

// Custom day component for the DatePicker
const CustomDay = (props: PickersDayProps<Date>) => {
  const { day, ...other } = props;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const isToday = format(day, 'yyyy-MM-dd') === format(today, 'yyyy-MM-dd');
  const isPastDate = day < today;

  return (
    <PickersDay
      {...other}
      day={day}
      disabled={isPastDate}
      sx={{
        ...(isToday && {
          backgroundColor: '#FFC107 !important',
          color: '#000 !important',
          border: '2px solid #FFB300 !important',
          '&:hover': {
            backgroundColor: '#FFB300 !important',
          },
        }),
        ...(isPastDate && {
          backgroundColor: '#e0e0e0 !important',
          color: '#9e9e9e !important',
          opacity: 0.5,
        }),
      }}
    />
  );
};

const ScheduleCourseForm: React.FC<ScheduleCourseFormProps> = ({ onCourseScheduled }) => {
  const { user } = useAuth();
  const [formData, setFormData] = useState<FormData>({
    scheduledDate: null,
    location: '',
    courseTypeId: 0,
    registeredStudents: '',
    notes: '',
  });
  const [courseTypes, setCourseTypes] = useState<CourseType[]>([]);
  const [isLoadingTypes, setIsLoadingTypes] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Fetch course types when component mounts
    const fetchTypes = async () => {
      setIsLoadingTypes(true);
      try {
        const response = await api.organizationApi.getCourseTypes();
        setCourseTypes(response as CourseType[]);
      } catch (err: any) {
        logger.error('Error fetching course types:', err);
        setError('Failed to load course types');
      } finally {
        setIsLoadingTypes(false);
      }
    };
    fetchTypes();
  }, []);

  const handleChange = (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement> | any) => {
    const { name, value } = event.target;
    // Basic numeric validation for registeredStudents
    if (name === 'registeredStudents' && value && !/^[0-9]*$/.test(value)) {
      return;
    }
    setFormData(prevState => ({
      ...prevState,
      [name]: value,
    }));
    // Clear messages on change
    setError('');
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');

    if (!formData.scheduledDate || !formData.location || !formData.courseTypeId || !formData.registeredStudents) {
      setError('Please fill in all required fields');
      return;
    }

    if (isSubmitting) return;
    setIsSubmitting(true);

    try {
      // Local calendar date: toISOString() would shift evening Ontario dates to the next day (UTC)
      const formattedDate = toLocalDateString(formData.scheduledDate);
      const response = await api.organizationApi.requestCourse({
        scheduledDate: formattedDate,
        location: formData.location,
        courseTypeId: formData.courseTypeId,
        registeredStudents: parseInt(formData.registeredStudents, 10),
        notes: formData.notes || '',
        locationId: user?.locationId || null,
      });

      if (response.data.success) {
        setFormData({
          scheduledDate: null,
          location: '',
          courseTypeId: 0,
          registeredStudents: '',
          notes: '',
        });
        onCourseScheduled();
      } else {
        setError(response.data.message || 'Failed to submit course request');
      }
    } catch (err: unknown) {
      logger.error('Error submitting course request:', err);
      setError('Failed to submit course request. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Render loading state if user is not yet available
  logger.debug(
    '[ScheduleCourseForm] Checking user object before rendering:',
    user
  );
  if (!user) {
    logger.debug(
      `[ScheduleCourseForm] User not loaded yet. Showing loading spinner.`
    );
    return (
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          p: 3,
        }}
      >
        <CircularProgress size={24} sx={{ mr: 1 }} />
        <Typography>Loading organization info...</Typography>
      </Box>
    );
  }

  // Check if organization is properly configured
  if (!user.organizationName) {
    return (
      <Paper elevation={3} sx={{ p: { xs: 2, sm: 3 } }}>
        <Alert severity='error' sx={{ mb: 2 }}>
          <Typography variant='subtitle1' fontWeight='bold'>
            Organization Not Configured
          </Typography>
          <Typography variant='body2' sx={{ mt: 1 }}>
            Your account is not linked to an organization. Please contact your System Administrator to:
          </Typography>
          <Box component='ul' sx={{ mt: 1, mb: 0, pl: 2 }}>
            <li>Create an organization in the system</li>
            <li>Link your user account to the organization</li>
          </Box>
        </Alert>
      </Paper>
    );
  }

  const organizationDisplayName = user.organizationName;

  return (
    <Paper elevation={3} sx={{ p: { xs: 2, sm: 3 } }}>
      <Box component='form' onSubmit={handleSubmit} noValidate>
        <Typography variant='h6' gutterBottom mb={2}>
          Request a Course
        </Typography>

        {error && (
          <Alert severity='error' sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        <Grid container spacing={2.5}>
          {/* Organization (Read Only) */}
          <Grid item xs={12} sm={6}>
            <TextField
              label='Organization'
              value={organizationDisplayName}
              fullWidth
              disabled
              variant='filled'
              InputProps={{ readOnly: true }}
              helperText='Automatically assigned based on your account'
            />
          </Grid>
          {/* Location (Read Only) */}
          <Grid item xs={12} sm={6}>
            <TextField
              label='Your Location'
              value={user.locationName || 'Not assigned'}
              fullWidth
              disabled
              variant='filled'
              InputProps={{ readOnly: true }}
              helperText={user.locationName ? 'Your assigned location' : 'Contact admin to assign a location'}
              error={!user.locationName}
            />
          </Grid>
          {/* Date Submitted (Auto-generated) */}
          <Grid item xs={12} sm={6}>
            <TextField
              fullWidth
              label='Date Submitted'
              value={getTodayDate()}
              disabled
              variant='filled'
              InputProps={{ readOnly: true }}
              helperText="Automatically set to today's date when request is submitted"
            />
          </Grid>
          {/* Scheduled Course Date */}
          <Grid item xs={12} sm={6}>
            <LocalizationProvider dateAdapter={AdapterDateFns}>
              <DatePicker
                label="Scheduled Course Date"
                value={formData.scheduledDate}
                onChange={(newValue) => {
                  setFormData(prev => ({
                    ...prev,
                    scheduledDate: newValue
                  }));
                }}
                minDate={new Date()}
                slots={{
                  day: CustomDay
                }}
                slotProps={{
                  textField: {
                    fullWidth: true,
                    required: true,
                    helperText: 'Yellow = Today. Past dates are disabled.'
                  }
                }}
              />
            </LocalizationProvider>
          </Grid>
          {/* Course Name Dropdown */}
          <Grid item xs={12} sm={6}>
            <FormControl
              fullWidth
              required
              disabled={isLoadingTypes || isSubmitting}
            >
              <InputLabel id='courseTypeId-label'>Course Name</InputLabel>
              <Select
                labelId='courseTypeId-label'
                id='courseTypeId'
                value={formData.courseTypeId}
                label='Course Name'
                name='courseTypeId'
                onChange={handleChange}
              >
                {isLoadingTypes ? (
                  <MenuItem disabled value=''>
                    <CircularProgress size={20} sx={{ mr: 1 }} /> Loading
                    Types...
                  </MenuItem>
                ) : courseTypes.length > 0 ? (
                  courseTypes.map(type => (
                    <MenuItem key={type.id} value={type.id}>
                      {type.name}
                    </MenuItem>
                  ))
                ) : (
                  <MenuItem disabled value=''>
                    No courses available
                  </MenuItem>
                )}
              </Select>
            </FormControl>
          </Grid>
          {/* Location */}
          <Grid item xs={12} sm={6}>
            <TextField
              required
              fullWidth
              id='location'
              label='Location (Address/Room)'
              name='location'
              value={formData.location}
              onChange={handleChange}
              disabled={isSubmitting}
            />
          </Grid>
          {/* Students Registered */}
          <Grid item xs={12} sm={6}>
            <TextField
              required
              fullWidth
              id='registeredStudents'
              label='# Students Registered'
              name='registeredStudents'
              type='number'
              value={formData.registeredStudents}
              onChange={handleChange}
              InputProps={{ inputProps: { min: 0 } }}
              disabled={isSubmitting}
            />
          </Grid>
          {/* Notes */}
          <Grid item xs={12}>
            <TextField
              fullWidth
              id='notes'
              label='Notes / Special Instructions (Optional)'
              name='notes'
              value={formData.notes}
              onChange={handleChange}
              multiline
              rows={3}
              disabled={isSubmitting}
            />
          </Grid>
          {/* Submit Button */}
          <Grid item xs={12}>
            <Button
              type='submit'
              fullWidth
              variant='contained'
              sx={{ mt: 2 }}
              disabled={isSubmitting || isLoadingTypes}
            >
              {isSubmitting ? (
                <CircularProgress size={24} />
              ) : (
                'Request Course Schedule'
              )}
            </Button>
          </Grid>
        </Grid>
      </Box>
    </Paper>
  );
};

export default ScheduleCourseForm;
