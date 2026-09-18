import React, { useState, useEffect, useMemo } from 'react';
import {
  Box,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
  Alert,
  MenuItem,
  Tooltip,
  FormControlLabel,
  Switch,
  FormControl,
  InputLabel,
  Select,
  Grid,
  CircularProgress,
} from '@mui/material';
import { api } from '../../../services/api';
import InstructorDashboard from './InstructorDashboard';
import AdminViewStudentsDialog from '../../dialogs/AdminViewStudentsDialog';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRealtime } from '../../../contexts/RealtimeContext';
import { formatDisplayDate } from '../../../utils/dateUtils';
import DataTable, { DataTableRow } from '../../gtacpr/DataTable';
import StatusChip from '../../gtacpr/StatusChip';
import { PrimaryButton, GhostButton } from '../../gtacpr/Buttons';
import UserAvatar from '../../gtacpr/UserAvatar';
import LinkButton from '../../gtacpr/LinkButton';
import { useConfirm } from '../../gtacpr/ConfirmDialog';
import { useSnackbar } from '../../../contexts/SnackbarContext';


interface Instructor {
  id: number;
  instructorName: string;
  username: string;
  email: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  availabilityDate?: string;
  availabilityStatus?: string;
  assignmentStatus?: string;
  assignedOrganization?: string;
  assignedLocation?: string;
  assignedCourseType?: string;
  notes?: string;
  availability?: {
    day: string;
    startTime: string;
    endTime: string;
  }[];
}

interface AvailableInstructor {
  id: number;
  instructorName: string;
  email: string;
  firstName?: string;
  lastName?: string;
  availabilityStatus?: string;
}

interface FormData {
  username: string;
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone: string;
}

type FormErrors = Partial<Record<keyof FormData, string>>;

const EMPTY_FORM: FormData = { username: '', email: '', password: '', firstName: '', lastName: '', phone: '' };

const validateInstructorForm = (data: FormData, isEdit: boolean): FormErrors => {
  const errors: FormErrors = {};
  const username = data.username.trim();
  if (!username) errors.username = 'Username is required';
  else if (username.length < 3) errors.username = 'Username must be at least 3 characters';
  else if (!/^[a-zA-Z0-9_.@-]+$/.test(username)) errors.username = 'Letters, numbers, . _ @ - only';
  const email = data.email.trim();
  if (!email) errors.email = 'Email is required';
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = 'Enter a valid email address';
  if (!isEdit && !data.password) errors.password = 'Password is required';
  else if (data.password && data.password.length < 8) errors.password = 'Password must be at least 8 characters';
  if (!data.firstName.trim()) errors.firstName = 'First name is required';
  if (!data.lastName.trim()) errors.lastName = 'Last name is required';
  return errors;
};

const TableLoading: React.FC = () => (
  <Box sx={{ py: 4, display: 'flex', justifyContent: 'center' }} role="status" aria-label="Loading">
    <CircularProgress size={28} />
  </Box>
);

const TableEmpty: React.FC<{ message: string }> = ({ message }) => (
  <Box sx={{ py: 3, textAlign: 'center' }}>
    <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{message}</Typography>
  </Box>
);

interface AvailabilityFormData {
  day: string;
  startTime: string;
  endTime: string;
}

interface Course {
  id: number;
  courseType?: string;
  courseTypeName?: string;
  organizationName?: string;
  location?: string;
  scheduledDate?: string;
  confirmedDate?: string;
  confirmedStartTime?: string;
  confirmedEndTime?: string;
  requestSubmittedDate?: string;
  registeredStudents?: number;
  studentsAttended?: number;
  notes?: string;
  instructorId?: number;
  instructorName?: string;
  status?: string;
  readyForBilling?: boolean;
  [key: string]: unknown;
}

interface ScheduleItem {
  type: 'class' | 'availability';
  displayDate: string;
  status: string;
  key: string;
  organizationname?: string;
  location?: string;
  name?: string;
  studentsregistered?: number;
  notes?: string;
  originalData?: Record<string, unknown>;
}

const instructorAvailabilityColumns = [
  { key: 'name', label: 'Instructor Name', width: '1.2fr' },
  { key: 'date', label: 'Date Available/Scheduled', width: '1fr' },
  { key: 'org', label: 'Organization', width: '1fr' },
  { key: 'location', label: 'Location', width: '1fr' },
  { key: 'course', label: 'Course Name', width: '1fr' },
  { key: 'notes', label: 'Notes', width: '1fr' },
  { key: 'status', label: 'Status', width: '0.8fr' },
  { key: 'actions', label: 'Actions', width: '1fr' },
];

const pendingColumns = [
  { key: 'submitted', label: 'Date Submitted', width: '1fr' },
  { key: 'preferred', label: 'Preferred Date', width: '1fr' },
  { key: 'org', label: 'Organization', width: '1fr' },
  { key: 'location', label: 'Location', width: '1fr' },
  { key: 'course', label: 'Course Name', width: '1fr' },
  { key: 'students', label: 'Students Registered', width: '0.8fr' },
  { key: 'notes', label: 'Notes', width: '1fr' },
  { key: 'actions', label: 'Actions', width: '1fr' },
];

const confirmedColumns = [
  { key: 'submitted', label: 'Date Submitted', width: '0.8fr' },
  { key: 'scheduled', label: 'Date Scheduled', width: '0.8fr' },
  { key: 'confirmed', label: 'Date Confirmed', width: '0.9fr' },
  { key: 'org', label: 'Organization', width: '1fr' },
  { key: 'location', label: 'Location', width: '1fr' },
  { key: 'course', label: 'Course Name', width: '1fr' },
  { key: 'registered', label: 'Students Registered', width: '0.7fr' },
  { key: 'attended', label: 'Students Attended', width: '0.7fr' },
  { key: 'notes', label: 'Notes', width: '1fr' },
  { key: 'instructor', label: 'Instructor', width: '1fr' },
  { key: 'status', label: 'Status', width: '0.7fr' },
  { key: 'actions', label: 'Actions', width: '0.8fr' },
];

const completedColumns = [
  { key: 'submitted', label: 'Date Submitted', width: '0.8fr' },
  { key: 'scheduled', label: 'Date Scheduled', width: '0.9fr' },
  { key: 'org', label: 'Organization', width: '1fr' },
  { key: 'location', label: 'Location', width: '1fr' },
  { key: 'course', label: 'Course Name', width: '1fr' },
  { key: 'registered', label: 'Students Registered', width: '0.7fr' },
  { key: 'attended', label: 'Students Attended', width: '0.7fr' },
  { key: 'notes', label: 'Notes', width: '1fr' },
  { key: 'instructor', label: 'Instructor', width: '1fr' },
  { key: 'status', label: 'Status', width: '0.7fr' },
  { key: 'actions', label: 'Actions', width: '1fr' },
];

const scheduleColumns = [
  { key: 'date', label: 'Date', width: '1fr' },
  { key: 'type', label: 'Type', width: '0.8fr' },
  { key: 'status', label: 'Status', width: '0.8fr' },
  { key: 'location', label: 'Location', width: '1fr' },
  { key: 'org', label: 'Organization', width: '1fr' },
  { key: 'name', label: 'Course Name', width: '1fr' },
  { key: 'students', label: 'Students', width: '0.7fr' },
  { key: 'notes', label: 'Notes', width: '1fr' },
];

const getAssignmentStatusKind = (
  status: string | undefined
): 'success' | 'active' | 'warning' | 'neutral' | 'inactive' => {
  switch (status) {
    case 'Confirmed': return 'active';
    case 'Completed': return 'neutral';
    case 'Available': return 'success';
    default: return 'inactive';
  }
};

const InstructorManagement: React.FC = () => {
  const queryClient = useQueryClient();
  const { isConnected, lastUpdate } = useRealtime();
  const { showSuccess, showError } = useSnackbar();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [availableInstructors, setAvailableInstructors] = useState<AvailableInstructor[]>([]);
  const [open, setOpen] = useState(false);
  const [availabilityOpen, setAvailabilityOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [editScheduleOpen, setEditScheduleOpen] = useState(false);
  const [editingInstructor, setEditingInstructor] = useState<Instructor | null>(null);
  const [viewingInstructor, setViewingInstructor] = useState<Instructor | null>(null);
  const [selectedCourse, setSelectedCourse] = useState<Course | null>(null);
  const [courseToEdit, setCourseToEdit] = useState<Course | null>(null);
  const [availabilityData, setAvailabilityData] = useState<AvailabilityFormData[]>([]);
  const [instructorSchedule, setInstructorSchedule] = useState<ScheduleItem[]>([]);
  const [, setInstructorAvailability] = useState<Record<string, unknown>[]>([]);
  const [formData, setFormData] = useState<FormData>(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState<FormErrors>({});
  const [savingInstructor, setSavingInstructor] = useState(false);
  const [savingAvailability, setSavingAvailability] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [billingCourseId, setBillingCourseId] = useState<number | null>(null);
  const [assignmentData, setAssignmentData] = useState({
    instructorId: '',
    scheduledDate: '',
    startTime: '09:00',
    endTime: '12:00',
  });
  const [editScheduleData, setEditScheduleData] = useState({
    scheduledDate: '',
    startTime: '09:00',
    endTime: '12:00',
    instructorId: '',
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (error) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [error]);

  const [success, setSuccess] = useState<string | null>(null);

  const [viewStudentsOpen, setViewStudentsOpen] = useState(false);
  const [selectedCourseForStudents, setSelectedCourseForStudents] = useState<Course | null>(null);

  const [showCompleted, setShowCompleted] = useState(false);

  const [instructorFilter, setInstructorFilter] = useState('');
  const [organizationFilter, setOrganizationFilter] = useState('');
  const [dateFilter, setDateFilter] = useState<Date | null>(null);

  const { data: instructorsData = [], isLoading: instructorsLoading } = useQuery({
    queryKey: ['instructors'],
    queryFn: async () => {
      const response = await api.get('/instructors');
      return response.data.data;
    },
    refetchInterval: 60000,
  });

  const { data: pendingCoursesData = [], isLoading: pendingLoading } = useQuery({
    queryKey: ['pendingCourses'],
    queryFn: async () => {
      const response = await api.get('/courses/pending');
      return response.data.data;
    },
    refetchInterval: 60000,
  });

  const { data: confirmedCoursesData = [], isLoading: confirmedLoading } = useQuery({
    queryKey: ['confirmedCourses'],
    queryFn: async () => {
      const response = await api.get('/courses/confirmed');
      return response.data.data;
    },
    refetchInterval: 60000,
  });

  const { data: completedCoursesData = [], isLoading: completedLoading } = useQuery({
    queryKey: ['completedCourses'],
    queryFn: async () => {
      const response = await api.get('/courses/completed');
      return response.data.data;
    },
    refetchInterval: 60000,
  });

  const instructors: Instructor[] = instructorsData;
  const pendingCourses: Course[] = pendingCoursesData;
  const confirmedCourses: Course[] = confirmedCoursesData;
  const completedCourses: Course[] = completedCoursesData;

  const uniqueInstructors = useMemo(() => {
    const names = confirmedCourses
      .map((course) => course.instructorName)
      .filter((name): name is string => !!name && name !== 'Not Assigned');
    return [...new Set(names)].sort();
  }, [confirmedCourses]);

  const uniqueOrganizations = useMemo(() => {
    const organizations = confirmedCourses
      .map((course) => course.organizationName)
      .filter((name): name is string => !!name);
    return [...new Set(organizations)].sort();
  }, [confirmedCourses]);

  const filteredConfirmedCourses = useMemo(() => {
    return confirmedCourses.filter((course) => {
      if (instructorFilter && course.instructorName !== instructorFilter) return false;
      if (organizationFilter && course.organizationName !== organizationFilter) return false;
      if (dateFilter) {
        const courseDate = new Date(course.confirmedDate ?? '');
        const filterDate = new Date(dateFilter);
        if (courseDate.toDateString() !== filterDate.toDateString()) return false;
      }
      return true;
    });
  }, [confirmedCourses, instructorFilter, organizationFilter, dateFilter]);

  const clearFilters = () => {
    setInstructorFilter('');
    setOrganizationFilter('');
    setDateFilter(null);
  };

  const hasActiveFilters = instructorFilter || organizationFilter || dateFilter;

  const handleOpen = (instructor?: Instructor) => {
    if (instructor) {
      setEditingInstructor(instructor);
      const nameParts = (instructor.instructorName || '').trim().split(/\s+/);
      setFormData({
        username: instructor.username,
        email: instructor.email,
        password: '',
        firstName: instructor.firstName ?? nameParts[0] ?? '',
        lastName: instructor.lastName ?? nameParts.slice(1).join(' '),
        phone: instructor.phone ?? '',
      });
    } else {
      setEditingInstructor(null);
      setFormData(EMPTY_FORM);
    }
    setFormErrors({});
    setOpen(true);
  };

  const handleClose = () => {
    setOpen(false);
    setEditingInstructor(null);
  };

  const handleAvailabilityOpen = (instructor: Instructor) => {
    setEditingInstructor(instructor);
    setAvailabilityData(instructor.availability || []);
    setAvailabilityOpen(true);
  };

  const handleAvailabilityClose = () => {
    setAvailabilityOpen(false);
    setEditingInstructor(null);
    setAvailabilityData([]);
  };

  const handleScheduleOpen = async (instructor: Instructor) => {
    setViewingInstructor(instructor);
    setScheduleOpen(true);
    await fetchInstructorScheduleData(instructor.id);
  };

  const handleScheduleClose = () => {
    setScheduleOpen(false);
    setViewingInstructor(null);
    setInstructorSchedule([]);
    setInstructorAvailability([]);
  };

  const fetchInstructorScheduleData = async (instructorId: number) => {
    try {
      const [scheduleRes, availabilityRes] = await Promise.all([
        api.get(`/instructors/${instructorId}/schedule`),
        api.get(`/instructors/${instructorId}/availability`),
      ]);

      const scheduleData = (scheduleRes.data.data || []).map(
        (item: Record<string, unknown>): ScheduleItem => ({
          type: 'class',
          displayDate: item.date as string,
          status: item.status as string,
          key: `class-${item.id}`,
          organizationname: item.organization as string,
          location: item.location as string,
          name: item.type as string,
          studentsregistered: item.studentcount as number,
          notes: item.notes as string,
          originalData: item,
        })
      );

      const availData = (availabilityRes.data.data || []).map(
        (avail: Record<string, unknown>): ScheduleItem => ({
          type: 'availability',
          displayDate: avail.date as string,
          status: 'Available',
          key: `availability-${avail.date}`,
          originalData: avail,
        })
      );

      const combinedData = [...scheduleData, ...availData].sort((a, b) => {
        const dateA = new Date(a.displayDate + 'T00:00:00');
        const dateB = new Date(b.displayDate + 'T00:00:00');
        return dateA.getTime() - dateB.getTime();
      });

      setInstructorSchedule(combinedData);
      setInstructorAvailability(availabilityRes.data.data || []);
    } catch (err: unknown) {
      console.error('Error fetching instructor schedule:', err);
      setError('Failed to fetch instructor schedule data');
    }
  };

  const renderScheduleDialogContent = () => {
    if (!viewingInstructor) return null;

    return (
      <Box sx={{ mt: 2 }}>
        <Typography sx={{ fontSize: 15, fontWeight: 600, color: (theme) => theme.palette.text.primary, mb: 2 }}>
          Schedule for {viewingInstructor.instructorName}
        </Typography>
        <DataTable
          columns={scheduleColumns}
          shownCount={instructorSchedule.length}
          totalCount={instructorSchedule.length}
        >
          {instructorSchedule.length === 0 ? (
            <Box sx={{ py: 3, textAlign: 'center' }}>
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>No schedule items found</Typography>
            </Box>
          ) : (
            instructorSchedule.map((item) => (
              <DataTableRow key={item.key} columns={scheduleColumns}>
                <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{formatDisplayDate(item.displayDate)}</Typography>
                <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{item.type === 'class' ? 'Class' : 'Availability'}</Typography>
                <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{item.status}</Typography>
                <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{item.type === 'class' ? item.location : '-'}</Typography>
                <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{item.type === 'class' ? item.organizationname : '-'}</Typography>
                <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{item.type === 'class' ? item.name : '-'}</Typography>
                <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{item.type === 'class' ? item.studentsregistered : '-'}</Typography>
                <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{item.type === 'class' ? item.notes : '-'}</Typography>
              </DataTableRow>
            ))
          )}
        </DataTable>
      </Box>
    );
  };

  const handleAssignOpen = async (course: Course) => {
    setSelectedCourse(course);
    setAssignmentData({
      instructorId: '',
      scheduledDate: course.scheduledDate || '',
      startTime: '09:00',
      endTime: '12:00',
    });

    if (course.scheduledDate) {
      try {
        const dateOnly = course.scheduledDate.split('T')[0];
        const response = await api.get(`/instructors/available/${dateOnly}`);
        setAvailableInstructors(response.data.data);

        if (response.data.data.length === 0) {
          setError(
            `No instructors are available on ${formatDisplayDate(course.scheduledDate)}. Instructors must mark their availability for this date.`
          );
        }
      } catch (err: unknown) {
        console.error('Error fetching available instructors:', err);
        const axiosErr = err as {
          response?: { status?: number; data?: { error?: { message?: string } } };
          message?: string;
        };
        console.error('Error response:', axiosErr.response);
        console.error('Error status:', axiosErr.response?.status);
        console.error('Error data:', axiosErr.response?.data);

        if (axiosErr.response?.status === 401) {
          setError('Authentication error. Please log in again.');
        } else if (axiosErr.response?.status === 403) {
          setError('You do not have permission to view available instructors.');
        } else {
          setError(
            `Failed to fetch available instructors: ${axiosErr.response?.data?.error?.message || axiosErr.message}`
          );
        }
        setAvailableInstructors([]);
      }
    } else {
      setError('Course must have a scheduled date before assigning an instructor');
      setAvailableInstructors([]);
    }

    setAssignOpen(true);
  };

  const handleAssignClose = () => {
    setAssignOpen(false);
    setSelectedCourse(null);
  };

  const handleEditScheduleOpen = async (course: Course) => {
    setCourseToEdit(course);
    setEditScheduleData({
      scheduledDate: course.confirmedDate || '',
      startTime: course.confirmedStartTime || '09:00',
      endTime: course.confirmedEndTime || '12:00',
      instructorId: course.instructorId ? String(course.instructorId) : '',
    });

    if (course.confirmedDate) {
      try {
        const dateOnly = course.confirmedDate.split('T')[0];
        const response = await api.get(`/instructors/available/${dateOnly}`);
        const availableList = response.data.data;
        if (
          course.instructorId &&
          !availableList.find((i: AvailableInstructor) => i.id === course.instructorId)
        ) {
          availableList.unshift({
            id: course.instructorId,
            instructorName: course.instructorName,
            email: '',
            availabilityStatus: 'Currently Assigned',
          });
        }
        setAvailableInstructors(availableList);
      } catch (err: unknown) {
        console.error('Error fetching available instructors:', err);
        setAvailableInstructors([]);
      }
    }

    setEditScheduleOpen(true);
  };

  const handleEditScheduleClose = () => {
    setEditScheduleOpen(false);
    setCourseToEdit(null);
    setEditScheduleData({ scheduledDate: '', startTime: '09:00', endTime: '12:00', instructorId: '' });
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    setFormErrors(prev => (prev[name as keyof FormData] ? { ...prev, [name]: undefined } : prev));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errors = validateInstructorForm(formData, !!editingInstructor);
    setFormErrors(errors);
    if (Object.keys(errors).length > 0) return;

    const payload: Record<string, string> = {
      username: formData.username.trim(),
      email: formData.email.trim(),
      firstName: formData.firstName.trim(),
      lastName: formData.lastName.trim(),
    };
    if (formData.phone.trim()) payload.phone = formData.phone.trim();
    if (formData.password) payload.password = formData.password;

    setSavingInstructor(true);
    try {
      if (editingInstructor) {
        await api.put(`/instructors/${editingInstructor.id}`, payload);
        showSuccess('Instructor updated');
      } else {
        await api.post('/instructors', payload);
        showSuccess(`Instructor ${payload.firstName} ${payload.lastName} added`);
      }
      await queryClient.invalidateQueries({ queryKey: ['instructors'] });
      handleClose();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { status?: number; data?: { error?: { message?: string } | string; message?: string } } };
      const data = axiosErr.response?.data;
      const serverMessage =
        (typeof data?.error === 'object' ? data.error?.message : data?.error) || data?.message;
      if (axiosErr.response?.status === 409) {
        setFormErrors({ username: 'Username or email already in use', email: 'Username or email already in use' });
      }
      showError(serverMessage || 'Failed to save instructor');
    } finally {
      setSavingInstructor(false);
    }
  };

  const handleAvailabilitySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingInstructor) return;

    setSavingAvailability(true);
    try {
      await api.put(`/instructors/${editingInstructor.id}/availability`, {
        availability: availabilityData,
      });
      showSuccess('Availability updated');
      queryClient.invalidateQueries({ queryKey: ['instructors'] });
      handleAvailabilityClose();
    } catch {
      showError('Failed to update availability');
    } finally {
      setSavingAvailability(false);
    }
  };

  const handleDeactivate = async (instructor: Instructor) => {
    const ok = await confirm({
      title: 'Deactivate instructor?',
      message: `${instructor.instructorName} will no longer be able to log in or be assigned to courses. Existing course history is kept.`,
      confirmLabel: 'Deactivate',
      danger: true,
    });
    if (!ok) return;

    try {
      await api.delete(`/instructors/${instructor.id}`);
      showSuccess(`${instructor.instructorName} deactivated`);
      queryClient.invalidateQueries({ queryKey: ['instructors'] });
    } catch {
      showError('Failed to deactivate instructor');
    }
  };

  const handleDeleteAvailability = async (instructorId: number, date: string) => {
    const ok = await confirm({
      title: 'Remove availability?',
      message: `Remove availability for ${formatDisplayDate(date)}? Any unconfirmed classes on this date will also be removed.`,
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!ok) return;

    try {
      await api.delete(`/instructors/${instructorId}/availability/${date}`);
      showSuccess('Availability removed');
      queryClient.invalidateQueries({ queryKey: ['instructors'] });
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: { message?: string } } } };
      if (axiosErr.response?.data?.error?.message) {
        setError(axiosErr.response.data.error.message);
      } else {
        setError('Failed to remove availability');
      }
    }
  };

  const addAvailabilitySlot = () => {
    setAvailabilityData([...availabilityData, { day: '', startTime: '', endTime: '' }]);
  };

  const removeAvailabilitySlot = (index: number) => {
    setAvailabilityData(availabilityData.filter((_, i) => i !== index));
  };

  const updateAvailabilitySlot = (
    index: number,
    field: keyof AvailabilityFormData,
    value: string
  ) => {
    const newData = [...availabilityData];
    newData[index] = { ...newData[index], [field]: value };
    setAvailabilityData(newData);
  };

  const handleAssignInstructor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCourse || !assignmentData.instructorId) return;

    setAssigning(true);
    try {
      const response = await api.put(`/courses/${selectedCourse.id}/assign-instructor`, {
        instructorId: assignmentData.instructorId,
        startTime: assignmentData.startTime,
        endTime: assignmentData.endTime,
      });

      if (response.data.success) {
        const assignedInstructor = availableInstructors.find(
          (instructor) => instructor.id === parseInt(assignmentData.instructorId)
        );
        const instructorName = assignedInstructor?.instructorName || 'Instructor';

        const successMessage = `✅ Course successfully assigned to ${instructorName}!

📧 Email notifications have been sent to:
• ${instructorName} (${assignedInstructor?.email || 'instructor'})
• Organization contact

📅 Course Details:
• Date: ${selectedCourse.scheduledDate ? formatDisplayDate(selectedCourse.scheduledDate) : '-'}
• Time: ${assignmentData.startTime} - ${assignmentData.endTime}
• Location: ${selectedCourse.location}
• Students: ${selectedCourse.registeredStudents || 0}

The course status has been updated to "Confirmed" and moved to the confirmed courses list.`;

        setSuccess(successMessage);

        setTimeout(() => { setSuccess(null); }, 10000);

        queryClient.invalidateQueries({ queryKey: ['pendingCourses'] });
        queryClient.invalidateQueries({ queryKey: ['confirmedCourses'] });
        queryClient.invalidateQueries({ queryKey: ['completedCourses'] });
        queryClient.invalidateQueries({ queryKey: ['instructors'] });

        handleAssignClose();
      } else {
        setError('Failed to assign instructor: ' + (response.data.message || 'Unknown error'));
      }
    } catch (err: unknown) {
      console.error('Error assigning instructor:', err);
      const axiosErr = err as { response?: { data?: { error?: { message?: string } } } };
      setError(axiosErr.response?.data?.error?.message || 'Failed to assign instructor');
    } finally {
      setAssigning(false);
    }
  };

  const handleEditScheduleDateChange = async (newDate: string) => {
    setEditScheduleData(prev => ({ ...prev, scheduledDate: newDate }));

    if (newDate) {
      try {
        const dateOnly = newDate.split('T')[0];
        const response = await api.get(`/instructors/available/${dateOnly}`);
        const availableList = response.data.data;

        const currentInstructorAvailable = availableList.find(
          (i: AvailableInstructor) => i.id === Number(editScheduleData.instructorId)
        );

        if (!currentInstructorAvailable && editScheduleData.instructorId) {
          setEditScheduleData(prev => ({ ...prev, instructorId: '' }));
          setError(
            `Current instructor is not available on ${formatDisplayDate(newDate)}. Please select a different instructor.`
          );
        }

        setAvailableInstructors(availableList);
      } catch (err: unknown) {
        console.error('Error fetching available instructors:', err);
        setAvailableInstructors([]);
      }
    }
  };

  const handleEditScheduleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!courseToEdit) return;

    setSavingSchedule(true);
    try {
      await api.put(`/courses/${courseToEdit.id}/schedule`, {
        scheduledDate: editScheduleData.scheduledDate,
        startTime: editScheduleData.startTime,
        endTime: editScheduleData.endTime,
        instructorId: editScheduleData.instructorId,
      });
      setSuccess('Course schedule updated successfully!');

      queryClient.invalidateQueries({ queryKey: ['pendingCourses'] });
      queryClient.invalidateQueries({ queryKey: ['confirmedCourses'] });
      queryClient.invalidateQueries({ queryKey: ['completedCourses'] });
      queryClient.invalidateQueries({ queryKey: ['instructors'] });

      handleEditScheduleClose();
    } catch {
      setError('Failed to update course schedule');
    } finally {
      setSavingSchedule(false);
    }
  };

  const handleViewStudentsOpen = (course: Course) => {
    setSelectedCourseForStudents(course);
    setViewStudentsOpen(true);
  };

  const handleViewStudentsClose = () => {
    setViewStudentsOpen(false);
    setSelectedCourseForStudents(null);
  };

  const handleReadyForBilling = async (course: Course) => {
    const courseId = course.id;
    const ok = await confirm({
      title: 'Send course to billing?',
      message: `${course.courseTypeName || course.courseType || 'Course'} for ${course.organizationName || 'this organization'} will be marked ready for billing so Accounting can invoice it. This cannot be undone from this screen.`,
      confirmLabel: 'Send to Billing',
    });
    if (!ok) return;

    setBillingCourseId(courseId);
    try {

      const validationResponse = await api.get(`/courses/${courseId}/validate-billing`);

      const validationData = validationResponse.data.data;

      if (!validationData.isValid) {
        const errorMessage = validationData.validationErrors.join('\n• ');
        const fullErrorMessage = `Cannot send to billing:\n• ${errorMessage}`;
        setError(fullErrorMessage);
        return;
      }

      await api.put(`/courses/${courseId}/ready-for-billing`);
      showSuccess('Course sent to billing');
      queryClient.invalidateQueries({ queryKey: ['completedCourses'] });
    } catch (err: unknown) {
      console.error('❌ [BILLING] Error:', err);
      const axiosErr = err as { response?: { data?: { error?: { message?: string } } } };
      console.error('❌ [BILLING] Error response:', axiosErr.response?.data);

      if (axiosErr.response?.data?.error?.message) {
        const errorMessage = axiosErr.response.data.error.message;
        if (errorMessage.includes('Cannot send course to billing:')) {
          setError(errorMessage);
        } else {
          setError(`Failed to send course to billing: ${errorMessage}`);
        }
      } else {
        setError('Failed to send course to billing. Please try again.');
      }
    } finally {
      setBillingCourseId(null);
    }
  };

  const filteredInstructors = instructors.filter(instructor => {
    if (!instructor.availabilityDate || instructor.availabilityDate === 'No availability set') return false;
    if (!showCompleted && instructor.assignmentStatus === 'Completed') return false;
    return true;
  });

  return (
    <Box>
      {error && (
        <Alert
          severity="error"
          sx={{
            mb: 3,
            mt: 2,
            fontSize: '14px',
            backgroundColor: (theme) => theme.palette.mode === 'dark' ? 'rgba(224, 74, 74, 0.1)' : '#ffebee',
            '& .MuiAlert-message': { width: '100%' },
          }}
          onClose={() => setError(null)}
          action={
            <GhostButton size="small" onClick={() => setError(null)}>
              Dismiss
            </GhostButton>
          }
        >
          <div style={{ whiteSpace: 'pre-line', fontWeight: '500' }}>
            {error.split('Cannot send to billing:').map((part, index) =>
              index === 0 ? part : (
                <span key={index}>
                  <strong>Cannot send to billing:</strong>
                  {part}
                </span>
              )
            )}
          </div>
        </Alert>
      )}
      {success && (
        <Alert
          severity="success"
          sx={{
            mb: 2,
            '& .MuiAlert-message': { whiteSpace: 'pre-line', lineHeight: 1.6 },
          }}
          onClose={() => setSuccess(null)}
          action={
            <GhostButton size="small" onClick={() => setSuccess(null)}>
              Dismiss
            </GhostButton>
          }
        >
          {success}
        </Alert>
      )}
      {!isConnected && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Real-time updates are currently using polling. Last update: {lastUpdate?.toLocaleTimeString()}
        </Alert>
      )}

      <InstructorDashboard />

      {/* Pending Course Requests Section */}
      <Box sx={{ mb: 4 }}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1.5,
            mb: 2,
            p: 2,
            borderRadius: '8px',
            backgroundColor: '#ED6C02',
          }}
        >
          <Typography sx={{ fontWeight: 700, fontSize: 15, color: '#fff' }}>
            Pending Course Requests
          </Typography>
          <Box
            sx={{
              ml: 'auto',
              bgcolor: 'rgba(255,255,255,0.2)',
              borderRadius: '12px',
              px: 1.5,
              py: 0.25,
            }}
          >
            <Typography sx={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>
              {pendingCourses.length}
            </Typography>
          </Box>
        </Box>
        <DataTable
          columns={pendingColumns}
          shownCount={pendingCourses.length}
          totalCount={pendingCourses.length}
        >
          {pendingLoading ? (
            <TableLoading />
          ) : pendingCourses.length === 0 ? (
            <TableEmpty message="No pending course requests" />
          ) : (
          pendingCourses.map(course => (
            <DataTableRow key={course.id} columns={pendingColumns}>
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
                {course.requestSubmittedDate ? formatDisplayDate(course.requestSubmittedDate) : '-'}
              </Typography>
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
                {course.scheduledDate ? formatDisplayDate(course.scheduledDate) : '-'}
              </Typography>
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{course.organizationName}</Typography>
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{course.location}</Typography>
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
                {course.courseTypeName || course.courseType || '-'}
              </Typography>
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{course.registeredStudents || 0}</Typography>
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{course.notes}</Typography>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                <GhostButton size="small" onClick={() => handleAssignOpen(course)}>
                  Assign Instructor
                </GhostButton>
                <GhostButton size="small" onClick={() => handleViewStudentsOpen(course)}>
                  View Students
                </GhostButton>
              </Box>
            </DataTableRow>
          ))
          )}
        </DataTable>
      </Box>

      {/* Instructor Availability & Assignments Section */}
      <Box sx={{ mb: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography sx={{ fontSize: 16, fontWeight: 700, color: (theme) => theme.palette.text.primary }}>
          Instructor Availability &amp; Assignments
        </Typography>
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
          <FormControlLabel
            control={
              <Switch
                checked={showCompleted}
                onChange={e => setShowCompleted(e.target.checked)}
                color="primary"
              />
            }
            label={<Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>Show Completed</Typography>}
          />
          <GhostButton onClick={() => queryClient.invalidateQueries({ queryKey: ['instructors'] })}>
            Refresh Data
          </GhostButton>
          <PrimaryButton onClick={() => handleOpen()}>Add Instructor</PrimaryButton>
        </Box>
      </Box>

      <Box sx={{ mb: 4 }}>
        <DataTable
          columns={instructorAvailabilityColumns}
          shownCount={filteredInstructors.length}
          totalCount={filteredInstructors.length}
        >
          {instructorsLoading ? (
            <TableLoading />
          ) : filteredInstructors.length === 0 ? (
            <TableEmpty message="No instructor availability to show" />
          ) : (
          filteredInstructors.map((instructor, index) => (
            <DataTableRow
              key={`${instructor.id}-${instructor.availabilityDate}-${index}`}
              columns={instructorAvailabilityColumns}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <UserAvatar
                  initials={
                    instructor.instructorName
                      ? instructor.instructorName
                          .split(' ')
                          .map(n => n[0])
                          .join('')
                          .slice(0, 2)
                          .toUpperCase()
                      : '?'
                  }
                  size={32}
                />
                <Box>
                  <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: (theme) => theme.palette.text.primary }}>
                    {instructor.instructorName}
                  </Typography>
                  <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.text.secondary }}>{instructor.email}</Typography>
                </Box>
              </Box>
              <Box>
                {instructor.availabilityDate && instructor.availabilityDate !== 'No availability set' ? (
                  <StatusChip kind="success" label={formatDisplayDate(instructor.availabilityDate)} />
                ) : (
                  <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.text.secondary, fontStyle: 'italic' }}>
                    No availability set
                  </Typography>
                )}
              </Box>
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
                {instructor.assignedOrganization || '-'}
              </Typography>
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
                {instructor.assignedLocation || '-'}
              </Typography>
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
                {instructor.assignedCourseType || '-'}
              </Typography>
              <Typography
                sx={{
                  fontSize: 13,
                  color: (theme) => theme.palette.text.secondary,
                  maxWidth: 200,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {instructor.notes || '-'}
              </Typography>
              <StatusChip
                kind={getAssignmentStatusKind(instructor.assignmentStatus)}
                label={instructor.assignmentStatus || ''}
              />
              <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
                <LinkButton onClick={() => handleOpen(instructor)}>Edit</LinkButton>
                <LinkButton onClick={() => handleAvailabilityOpen(instructor)}>Availability</LinkButton>
                <LinkButton onClick={() => handleScheduleOpen(instructor)}>Schedule</LinkButton>
                {instructor.availabilityDate &&
                  instructor.availabilityDate !== 'No availability set' &&
                  instructor.assignmentStatus !== 'Completed' && (
                    <LinkButton onClick={() => handleDeleteAvailability(instructor.id, instructor.availabilityDate!)}>Remove Date</LinkButton>
                  )}
                <LinkButton tone="danger" onClick={() => handleDeactivate(instructor)}>Deactivate</LinkButton>
              </Box>
            </DataTableRow>
          ))
          )}
        </DataTable>
      </Box>

      {/* Confirmed Courses Section */}
      <Box sx={{ mb: 4 }}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1.5,
            mb: 2,
            p: 2,
            borderRadius: '8px',
            backgroundColor: '#0288D1',
          }}
        >
          <Typography sx={{ fontWeight: 700, fontSize: 15, color: '#fff' }}>
            Confirmed Courses
          </Typography>
          <Box
            sx={{
              ml: 'auto',
              bgcolor: 'rgba(255,255,255,0.2)',
              borderRadius: '12px',
              px: 1.5,
              py: 0.25,
            }}
          >
            <Typography sx={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>
              {filteredConfirmedCourses.length}
            </Typography>
          </Box>
        </Box>

        {/* Filters */}
        <Box sx={{ border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', bgcolor: (theme) => theme.palette.background.paper, p: 3, mb: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 2, gap: 1.5 }}>
            <Typography
              sx={{
                fontSize: 13,
                fontWeight: 700,
                color: (theme) => theme.palette.text.secondary,
                textTransform: 'uppercase',
                letterSpacing: '0.07em',
              }}
            >
              Filters
            </Typography>
            {hasActiveFilters && (
              <Box
                sx={{
                  bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(37, 99, 235, 0.1)' : '#EFF6FF',
                  border: (theme) => `1px solid ${theme.palette.mode === 'dark' ? 'rgba(37, 99, 235, 0.3)' : '#BFDBFE'}`,
                  borderRadius: '12px',
                  px: 1.5,
                  py: 0.25,
                }}
              >
                <Typography sx={{ fontSize: 12, fontWeight: 600, color: (theme) => theme.palette.mode === 'dark' ? '#60A5FA' : '#1D4ED8' }}>
                  {filteredConfirmedCourses.length} of {confirmedCourses.length} courses
                </Typography>
              </Box>
            )}
          </Box>
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} sm={6} md={3}>
              <FormControl fullWidth size="small">
                <InputLabel>Instructor</InputLabel>
                <Select
                  value={instructorFilter}
                  onChange={(e) => setInstructorFilter(e.target.value)}
                  label="Instructor"
                >
                  <MenuItem value="">All Instructors</MenuItem>
                  {uniqueInstructors.map((instructor) => (
                    <MenuItem key={instructor} value={instructor}>
                      {instructor}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <FormControl fullWidth size="small">
                <InputLabel>Organization</InputLabel>
                <Select
                  value={organizationFilter}
                  onChange={(e) => setOrganizationFilter(e.target.value)}
                  label="Organization"
                >
                  <MenuItem value="">All Organizations</MenuItem>
                  {uniqueOrganizations.map((organization) => (
                    <MenuItem key={organization} value={organization}>
                      {organization}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <TextField
                label="Date"
                type="date"
                value={dateFilter ? dateFilter.toISOString().slice(0, 10) : ''}
                onChange={(e) => setDateFilter(e.target.value ? new Date(e.target.value) : null)}
                InputLabelProps={{ shrink: true }}
                fullWidth
                size="small"
              />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <GhostButton size="small" onClick={clearFilters} disabled={!hasActiveFilters}>
                Clear Filters
              </GhostButton>
            </Grid>
          </Grid>
        </Box>

        <DataTable
          columns={confirmedColumns}
          shownCount={filteredConfirmedCourses.length}
          totalCount={confirmedCourses.length}
        >
          {confirmedLoading ? (
            <TableLoading />
          ) : filteredConfirmedCourses.length === 0 ? (
            <TableEmpty message={hasActiveFilters ? 'No confirmed courses match the filters' : 'No confirmed courses yet'} />
          ) : (
            filteredConfirmedCourses.map(course => (
              <DataTableRow key={course.id} columns={confirmedColumns}>
                <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
                  {course.requestSubmittedDate ? formatDisplayDate(course.requestSubmittedDate) : '-'}
                </Typography>
                <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
                  {course.scheduledDate ? formatDisplayDate(course.scheduledDate) : '-'}
                </Typography>
                <Box>
                  <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: (theme) => theme.palette.text.primary }}>
                    {course.confirmedDate ? formatDisplayDate(course.confirmedDate) : '-'}
                  </Typography>
                  {course.confirmedStartTime && course.confirmedEndTime && (
                    <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.text.secondary }}>
                      {course.confirmedStartTime.slice(0, 5)} -{' '}
                      {course.confirmedEndTime.slice(0, 5)}
                    </Typography>
                  )}
                </Box>
                <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{course.organizationName}</Typography>
                <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{course.location}</Typography>
                <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
                  {course.courseTypeName || course.courseType || '-'}
                </Typography>
                <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary, textAlign: 'center' }}>
                  {course.registeredStudents || 0}
                </Typography>
                <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary, textAlign: 'center' }}>
                  {course.studentsAttended || 0}
                </Typography>
                <Typography
                  sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis' }}
                >
                  {course.notes || '-'}
                </Typography>
                <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: (theme) => theme.palette.text.primary }}>
                  {course.instructorName || 'Not Assigned'}
                </Typography>
                <StatusChip kind="active" label={course.status || ''} />
                <Box sx={{ display: 'flex', gap: 1.5 }}>
                  <LinkButton onClick={() => handleViewStudentsOpen(course)}>View</LinkButton>
                  <LinkButton onClick={() => handleEditScheduleOpen(course)}>Edit</LinkButton>
                </Box>
              </DataTableRow>
            ))
          )}
        </DataTable>
      </Box>

      {/* Completed Courses Section */}
      <Box sx={{ mb: 4 }}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1.5,
            mb: 2,
            p: 2,
            borderRadius: '8px',
            backgroundColor: '#16A34A',
          }}
        >
          <Typography sx={{ fontWeight: 700, fontSize: 15, color: '#fff' }}>
            Completed Courses
          </Typography>
          <Box
            sx={{
              ml: 'auto',
              bgcolor: 'rgba(255,255,255,0.2)',
              borderRadius: '12px',
              px: 1.5,
              py: 0.25,
            }}
          >
            <Typography sx={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>
              {completedCourses.length}
            </Typography>
          </Box>
        </Box>
        <DataTable
          columns={completedColumns}
          shownCount={completedCourses.length}
          totalCount={completedCourses.length}
        >
          {completedLoading ? (
            <TableLoading />
          ) : completedCourses.length === 0 ? (
            <TableEmpty message="No completed courses yet" />
          ) : (
            completedCourses.map(course => (
              <DataTableRow key={course.id} columns={completedColumns}>
                <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
                  {course.requestSubmittedDate ? formatDisplayDate(course.requestSubmittedDate) : '-'}
                </Typography>
                <Box>
                  <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: (theme) => theme.palette.text.primary }}>
                    {course.confirmedDate ? formatDisplayDate(course.confirmedDate) : '-'}
                  </Typography>
                  {course.confirmedStartTime && course.confirmedEndTime && (
                    <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.text.secondary }}>
                      {course.confirmedStartTime.slice(0, 5)} -{' '}
                      {course.confirmedEndTime.slice(0, 5)}
                    </Typography>
                  )}
                </Box>
                <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{course.organizationName}</Typography>
                <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{course.location}</Typography>
                <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
                  {course.courseTypeName || course.courseType || '-'}
                </Typography>
                <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary, textAlign: 'center' }}>
                  {course.registeredStudents || 0}
                </Typography>
                <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary, textAlign: 'center' }}>
                  {course.studentsAttended || 0}
                </Typography>
                <Typography
                  sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis' }}
                >
                  {course.notes || '-'}
                </Typography>
                <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: (theme) => theme.palette.text.primary }}>
                  {course.instructorName || 'Not Assigned'}
                </Typography>
                <StatusChip
                  kind={course.status === 'invoiced' ? 'success' : 'neutral'}
                  label={course.status === 'invoiced' ? 'Invoiced' : 'Completed'}
                />
                <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
                  <LinkButton onClick={() => handleViewStudentsOpen(course)}>View Students</LinkButton>
                  <Tooltip
                    title={
                      course.readyForBilling
                        ? 'Course has been sent to billing'
                        : 'Click to send course to billing'
                    }
                    placement="top"
                  >
                    <span>
                      <PrimaryButton
                        size="small"
                        onClick={() => handleReadyForBilling(course)}
                        disabled={course.readyForBilling || billingCourseId === course.id}
                        sx={{ fontSize: 11 }}
                      >
                        {course.readyForBilling ? 'Sent to Billing' : 'Send to Billing'}
                      </PrimaryButton>
                    </span>
                  </Tooltip>
                </Box>
              </DataTableRow>
            ))
          )}
        </DataTable>
      </Box>

      {/* Instructor Form Dialog */}
      <Dialog open={open} onClose={savingInstructor ? undefined : handleClose} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontSize: 18, fontWeight: 700, color: (theme) => theme.palette.text.primary }}>
          {editingInstructor ? 'Edit Instructor' : 'Add Instructor'}
        </DialogTitle>
        <DialogContent>
          <Box component="form" id="instructor-form" onSubmit={handleSubmit} noValidate>
            <Grid container spacing={2} sx={{ mt: 0 }}>
              <Grid item xs={12} sm={6}>
                <TextField
                  autoFocus
                  name="firstName"
                  label="First name"
                  fullWidth
                  required
                  value={formData.firstName}
                  onChange={handleInputChange}
                  error={!!formErrors.firstName}
                  helperText={formErrors.firstName}
                  disabled={savingInstructor}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  name="lastName"
                  label="Last name"
                  fullWidth
                  required
                  value={formData.lastName}
                  onChange={handleInputChange}
                  error={!!formErrors.lastName}
                  helperText={formErrors.lastName}
                  disabled={savingInstructor}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  name="username"
                  label="Username"
                  fullWidth
                  required
                  autoComplete="off"
                  value={formData.username}
                  onChange={handleInputChange}
                  error={!!formErrors.username}
                  helperText={formErrors.username}
                  disabled={savingInstructor}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  name="email"
                  label="Email"
                  type="email"
                  fullWidth
                  required
                  value={formData.email}
                  onChange={handleInputChange}
                  error={!!formErrors.email}
                  helperText={formErrors.email}
                  disabled={savingInstructor}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  name="phone"
                  label="Phone"
                  type="tel"
                  fullWidth
                  value={formData.phone}
                  onChange={handleInputChange}
                  error={!!formErrors.phone}
                  helperText={formErrors.phone}
                  disabled={savingInstructor}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  name="password"
                  label={editingInstructor ? 'New password (optional)' : 'Password'}
                  type="password"
                  fullWidth
                  required={!editingInstructor}
                  autoComplete="new-password"
                  value={formData.password}
                  onChange={handleInputChange}
                  error={!!formErrors.password}
                  helperText={formErrors.password || 'At least 8 characters'}
                  disabled={savingInstructor}
                />
              </Grid>
            </Grid>
          </Box>
        </DialogContent>
        <DialogActions>
          <GhostButton onClick={handleClose} disabled={savingInstructor}>Cancel</GhostButton>
          <PrimaryButton type="submit" form="instructor-form" disabled={savingInstructor}>
            {savingInstructor ? 'Saving…' : editingInstructor ? 'Save Changes' : 'Add Instructor'}
          </PrimaryButton>
        </DialogActions>
      </Dialog>

      {/* Availability Dialog */}
      <Dialog open={availabilityOpen} onClose={handleAvailabilityClose} maxWidth="md" fullWidth>
        <DialogTitle sx={{ fontSize: 18, fontWeight: 700, color: (theme) => theme.palette.text.primary }}>
          Manage Instructor Availability
        </DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary, mb: 2 }}>
            Set availability slots for {editingInstructor?.instructorName}
          </Typography>

          {availabilityData.map((slot, index) => (
            <Box key={index} sx={{ mb: 2, display: 'flex', gap: 2, alignItems: 'flex-start' }}>
              <TextField
                select
                label="Day"
                value={slot.day}
                onChange={e => updateAvailabilitySlot(index, 'day', e.target.value)}
                sx={{ minWidth: 120 }}
                SelectProps={{ native: true }}
              >
                <option value=""></option>
                {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(
                  day => (
                    <option key={day} value={day}>
                      {day}
                    </option>
                  )
                )}
              </TextField>
              <TextField
                type="time"
                label="Start Time"
                value={slot.startTime}
                onChange={e => updateAvailabilitySlot(index, 'startTime', e.target.value)}
                InputLabelProps={{ shrink: true }}
              />
              <TextField
                type="time"
                label="End Time"
                value={slot.endTime}
                onChange={e => updateAvailabilitySlot(index, 'endTime', e.target.value)}
                InputLabelProps={{ shrink: true }}
              />
              <GhostButton
                onClick={() => removeAvailabilitySlot(index)}
                sx={{ color: '#CC1F1F', borderColor: '#CC1F1F' }}
              >
                Remove
              </GhostButton>
            </Box>
          ))}

          <GhostButton onClick={addAvailabilitySlot} sx={{ mt: 2 }}>
            Add Availability Slot
          </GhostButton>
        </DialogContent>
        <DialogActions>
          <GhostButton onClick={handleAvailabilityClose}>Cancel</GhostButton>
          <PrimaryButton onClick={handleAvailabilitySubmit} disabled={savingAvailability}>
            {savingAvailability ? 'Saving…' : 'Save Availability'}
          </PrimaryButton>
        </DialogActions>
      </Dialog>

      {/* Schedule View Dialog */}
      <Dialog open={scheduleOpen} onClose={handleScheduleClose} maxWidth="lg" fullWidth>
        <DialogTitle sx={{ fontSize: 18, fontWeight: 700, color: (theme) => theme.palette.text.primary }}>
          Instructor Schedule - {viewingInstructor?.instructorName}
        </DialogTitle>
        <DialogContent>{renderScheduleDialogContent()}</DialogContent>
        <DialogActions>
          <GhostButton onClick={handleScheduleClose}>Close</GhostButton>
        </DialogActions>
      </Dialog>

      {/* Assign Instructor Dialog */}
      <Dialog open={assignOpen} onClose={handleAssignClose} maxWidth="md" fullWidth>
        <DialogTitle sx={{ fontSize: 18, fontWeight: 700, color: (theme) => theme.palette.text.primary }}>
          Assign Instructor to Course
        </DialogTitle>
        <DialogContent>
          <Box
            sx={{ p: 2, bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(37, 99, 235, 0.1)' : '#EFF6FF', borderRadius: '8px', border: (theme) => `1px solid ${theme.palette.mode === 'dark' ? 'rgba(37, 99, 235, 0.3)' : '#BFDBFE'}`, mb: 2 }}
          >
            <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
              <strong>Course Name:</strong> {selectedCourse?.courseTypeName || selectedCourse?.courseType || '-'}
              <br />
              <strong>Organization:</strong> {selectedCourse?.organizationName}
              <br />
              <strong>Location:</strong> {selectedCourse?.location}
              <br />
              <strong>Students:</strong> {selectedCourse?.registeredStudents || 0}
              <br />
              <strong>Date Scheduled:</strong>{' '}
              {selectedCourse?.scheduledDate
                ? formatDisplayDate(selectedCourse.scheduledDate)
                : 'Not set'}
            </Typography>
          </Box>

          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {availableInstructors.length === 0 ? (
              <Alert severity="warning">
                No instructors are available for{' '}
                {selectedCourse?.scheduledDate
                  ? formatDisplayDate(selectedCourse.scheduledDate)
                  : 'this date'}
                .
                <br />
                Instructors must mark their availability in their portal before they can be assigned to
                courses.
              </Alert>
            ) : (
              <TextField
                select
                label="Available Instructors"
                value={assignmentData.instructorId}
                onChange={e =>
                  setAssignmentData(prev => ({ ...prev, instructorId: e.target.value }))
                }
                fullWidth
                required
                helperText={`${availableInstructors.length} instructor(s) available on ${selectedCourse?.scheduledDate ? formatDisplayDate(selectedCourse.scheduledDate) : '-'}`}
              >
                <MenuItem value="">Select an instructor</MenuItem>
                {availableInstructors.map(instructor => (
                  <MenuItem key={instructor.id} value={instructor.id}>
                    {instructor.instructorName} ({instructor.email})
                  </MenuItem>
                ))}
              </TextField>
            )}

            <TextField
              type="date"
              label="Date Scheduled"
              value={assignmentData.scheduledDate}
              fullWidth
              disabled
              InputLabelProps={{ shrink: true }}
              helperText="This is the date submitted by the organization"
            />

            <TextField
              type="time"
              label="Start Time"
              value={assignmentData.startTime}
              onChange={e => setAssignmentData(prev => ({ ...prev, startTime: e.target.value }))}
              fullWidth
              InputLabelProps={{ shrink: true }}
            />

            <TextField
              type="time"
              label="End Time"
              value={assignmentData.endTime}
              onChange={e => setAssignmentData(prev => ({ ...prev, endTime: e.target.value }))}
              fullWidth
              InputLabelProps={{ shrink: true }}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <GhostButton onClick={handleAssignClose}>Cancel</GhostButton>
          <PrimaryButton
            onClick={handleAssignInstructor}
            disabled={assigning || !assignmentData.instructorId || availableInstructors.length === 0}
          >
            {assigning ? 'Assigning…' : 'Assign Instructor & Confirm Course'}
          </PrimaryButton>
        </DialogActions>
      </Dialog>

      {/* Edit Schedule Dialog */}
      <Dialog open={editScheduleOpen} onClose={handleEditScheduleClose} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontSize: 18, fontWeight: 700, color: (theme) => theme.palette.text.primary }}>
          Edit Course Schedule
        </DialogTitle>
        <DialogContent>
          <Box
            sx={{ p: 2, bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(37, 99, 235, 0.1)' : '#EFF6FF', borderRadius: '8px', border: (theme) => `1px solid ${theme.palette.mode === 'dark' ? 'rgba(37, 99, 235, 0.3)' : '#BFDBFE'}`, mb: 2 }}
          >
            <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
              <strong>Course Name:</strong> {courseToEdit?.courseTypeName || courseToEdit?.courseType || '-'}
              <br />
              <strong>Organization:</strong> {courseToEdit?.organizationName}
              <br />
              <strong>Location:</strong> {courseToEdit?.location}
              <br />
              <strong>Students:</strong> {courseToEdit?.registeredStudents || 0}
            </Typography>
          </Box>

          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 2 }}>
            <TextField
              type="date"
              label="Date Scheduled"
              value={editScheduleData.scheduledDate}
              onChange={e => handleEditScheduleDateChange(e.target.value)}
              fullWidth
              required
              InputLabelProps={{ shrink: true }}
            />

            <TextField
              select
              label="Available Instructors"
              value={editScheduleData.instructorId}
              onChange={e =>
                setEditScheduleData(prev => ({ ...prev, instructorId: e.target.value }))
              }
              fullWidth
              helperText={
                availableInstructors.length > 0
                  ? `${availableInstructors.length} instructor(s) available`
                  : 'No instructors available for this date'
              }
            >
              <MenuItem value="">Select an instructor</MenuItem>
              {availableInstructors.map(instructor => (
                <MenuItem key={instructor.id} value={instructor.id}>
                  {instructor.instructorName}{' '}
                  {instructor.availabilityStatus === 'Currently Assigned'
                    ? '(Currently Assigned)'
                    : `(${instructor.email})`}
                </MenuItem>
              ))}
            </TextField>

            <TextField
              type="time"
              label="Start Time"
              value={editScheduleData.startTime}
              onChange={e =>
                setEditScheduleData(prev => ({ ...prev, startTime: e.target.value }))
              }
              fullWidth
              InputLabelProps={{ shrink: true }}
            />

            <TextField
              type="time"
              label="End Time"
              value={editScheduleData.endTime}
              onChange={e => setEditScheduleData(prev => ({ ...prev, endTime: e.target.value }))}
              fullWidth
              InputLabelProps={{ shrink: true }}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <GhostButton onClick={handleEditScheduleClose}>Cancel</GhostButton>
          <PrimaryButton
            onClick={handleEditScheduleSubmit}
            disabled={savingSchedule || !editScheduleData.scheduledDate}
          >
            {savingSchedule ? 'Saving…' : 'Update Schedule'}
          </PrimaryButton>
        </DialogActions>
      </Dialog>

      {/* View Students Dialog */}
      <AdminViewStudentsDialog
        open={viewStudentsOpen}
        onClose={handleViewStudentsClose}
        courseId={selectedCourseForStudents?.id || null}
        courseInfo={{
          courseType:
            selectedCourseForStudents?.courseTypeName || selectedCourseForStudents?.courseType,
          organizationName: selectedCourseForStudents?.organizationName,
          location: selectedCourseForStudents?.location,
        }}
      />

      {confirmDialog}
    </Box>
  );
};

export default InstructorManagement;
