import React, { useState, useEffect, useRef } from 'react';
import {
  Box,
  Typography,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Alert,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Snackbar,
  ButtonBase,
} from '@mui/material';
import { useLocation } from 'react-router-dom';
import { instructorApi, collegesApi } from '../../../services/api';
import { handleError } from '../../../services/errorHandler';
import { useRefreshInstructorData } from '../../../services/instructorService';
import DataTable, { DataTableRow } from '../../gtacpr/DataTable';
import StatusChip from '../../gtacpr/StatusChip';
import { PrimaryButton, GhostButton } from '../../gtacpr/Buttons';
import { currentPosition } from '../../../utils/currentPosition';
import { readySummary } from '../../../utils/readySummary';

interface Student {
  studentid: string;
  firstname: string;
  lastname: string;
  email?: string;
  attendance: boolean;
  attendanceMarked: boolean;
}

interface ClassData {
  courseId: number;
  name: string;
  organizationname: string;
  location: string;
  startTime: string;
  endTime: string;
  maxStudents: number;
  currentStudents: number;
  studentcount: number;
  studentsattendance: number;
  date: string;
  /** When they checked in as ready, and how far from the venue they were. */
  instructorReadyAt?: string | null;
  instructorReadyDistanceM?: number | null;
}

const studentColumns = [
  { key: 'name', label: 'STUDENT NAME', width: '1.5fr' },
  { key: 'email', label: 'EMAIL', width: '1.5fr' },
  { key: 'attendance', label: 'ATTENDANCE', width: '1.2fr', align: 'center' as const },
  { key: 'status', label: 'STATUS', width: '0.7fr' },
];

const ClassAttendanceView: React.FC = () => {
  const [todaysClasses, setTodaysClasses] = useState<ClassData[]>([]);
  const [selectedClass, setSelectedClass] = useState<ClassData | null>(null);
  const openClassId = (useLocation().state as { classId?: number } | null)?.classId;
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(false);
  const [studentsLoading, setStudentsLoading] = useState(false);
  const [error, setError] = useState('');
  const [addStudentDialog, setAddStudentDialog] = useState(false);
  const [completeDialog, setCompleteDialog] = useState(false);
  const [completing, setCompleting] = useState(false);
  // Which class is being checked in (one at a time), and how to stop its wait for a location
  const [checkInClassId, setCheckInClassId] = useState<number | null>(null);
  const stopLocation = useRef<() => void>(() => {});
  const mounted = useRef(true);
  const [addingStudent, setAddingStudent] = useState(false);
  const [markingStudentId, setMarkingStudentId] = useState<string | null>(null);
  const [newStudent, setNewStudent] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    college: '',
  });
  const [instructorComments, setInstructorComments] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [colleges, setColleges] = useState<{ id: number; name: string }[]>([]);
  // This screen calls the API directly, so the cached lists on My Schedule,
  // Dashboard and Archive must be told to reload after a change here.
  const refreshInstructorData = useRefreshInstructorData();

  const loadColleges = async () => {
    try {
      const response = await collegesApi.getAll();
      setColleges(response.data?.data || response.data || []);
    } catch {
      // silent fail for colleges dropdown
    }
  };

  const loadTodaysClasses = async () => {
    try {
      setLoading(true);
      const response = await instructorApi.getClassesToday();
      const classes = response.data?.data || response.data || [];
      setTodaysClasses(classes);
      // The class whose card was tapped on the dashboard, or the only class today
      const wanted = (classes as ClassData[]).find(c => c.courseId === openClassId);
      if (wanted) {
        setSelectedClass(wanted);
      } else if (classes && classes.length === 1) {
        setSelectedClass(classes[0]);
      }
      setError('');
    } catch (error: unknown) {
      handleError(error, { component: 'ClassAttendanceView', action: 'load today classes' });
      setError("Failed to load today's classes");
    } finally {
      setLoading(false);
    }
  };

  const loadStudents = async (classId: number) => {
    try {
      setStudentsLoading(true);
      const response = await instructorApi.getClassStudents(classId);
      const rows: Student[] = response.data?.data || response.data || [];
      // MariaDB sends the TINYINT flags as 0/1; as numbers they leaked into
      // aria-pressed ("1"/"0"), which is not a valid pressed state.
      setStudents(
        Array.isArray(rows)
          ? rows.map((s) => ({ ...s, attendance: Boolean(s.attendance), attendanceMarked: Boolean(s.attendanceMarked) }))
          : []
      );
      setError('');
    } catch (error: unknown) {
      handleError(error, { component: 'ClassAttendanceView', action: 'load students' });
      setError('Failed to load students for this class');
    } finally {
      setStudentsLoading(false);
    }
  };

  // Fetch on mount only.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadTodaysClasses();
    loadColleges();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- on mount only; openClassId never changes while mounted
  }, []);

  // Leaving the screen while it is still finding the location stops the GPS and the check-in.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      stopLocation.current();
    };
  }, []);

  // Fetch this class's roster whenever a different class is selected (not when its check-in status changes).
  const selectedClassId = selectedClass?.courseId;
  useEffect(() => {
    if (selectedClassId !== undefined) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadStudents(selectedClassId);
    }
  }, [selectedClassId]);

  const handleClassChange = (event: { target: { value: unknown } }) => {
    const classId = event.target.value as number;
    const selected = todaysClasses.find(c => c.courseId === classId);
    setSelectedClass(selected || null);
    setInstructorComments('');
  };

  const handleAttendanceChange = async (studentId: string, attended: boolean) => {
    if (!selectedClass || markingStudentId) return;
    setMarkingStudentId(studentId);
    try {
      await instructorApi.updateStudentAttendance(selectedClass.courseId, studentId, attended);
      await loadStudents(selectedClass.courseId);
    } catch (error: unknown) {
      handleError(error, { component: 'ClassAttendanceView', action: 'update attendance' });
      setError('Failed to update attendance');
    } finally {
      setMarkingStudentId(null);
    }
  };

  const handleAddStudent = async () => {
    if (!selectedClass || !newStudent.firstName || !newStudent.lastName || !newStudent.email || !newStudent.phone) {
      setError('Please fill in all required fields (First Name, Last Name, Email, Phone)');
      return;
    }
    if (addingStudent) return;
    setAddingStudent(true);
    try {
      const response = await instructorApi.addStudent(selectedClass.courseId, newStudent);
      setStudents(prev => [...prev, response.data?.data || response.data]);
      setNewStudent({ firstName: '', lastName: '', email: '', phone: '', college: '' });
      setAddStudentDialog(false);
      setError('');
      setSuccessMessage('Student added successfully!');
      refreshInstructorData();
    } catch (error: unknown) {
      const axiosErr = error as { response?: { data?: { error?: string } } };
      const errorMessage = axiosErr.response?.data?.error || 'Failed to add student';
      setError(errorMessage);
    } finally {
      setAddingStudent(false);
    }
  };

  /** "I'm ready": asks the phone for its location and checks in. The server accepts it only at the venue. */
  const handleCheckIn = async () => {
    if (!selectedClass || checkInClassId !== null) return;
    const { courseId: classId, name } = selectedClass;
    setCheckInClassId(classId);
    setError('');
    try {
      const lookup = currentPosition();
      stopLocation.current = lookup.cancel;
      const found = await lookup.promise;
      if (!found || !mounted.current) return; // the screen was left while waiting
      if ('problem' in found) {
        setError(found.problem);
        return;
      }
      const response = await instructorApi.markReady(classId, found.position);
      if (!mounted.current) return;
      // The time and distance the server recorded, not this device's clock
      const readyFields = {
        instructorReadyAt: response.data?.data?.readyAt ?? new Date().toISOString(),
        instructorReadyDistanceM: response.data?.data?.distanceMeters ?? null,
      };
      setTodaysClasses(prev => prev.map(c => (c.courseId === classId ? { ...c, ...readyFields } : c)));
      setSelectedClass(prev => (prev && prev.courseId === classId ? { ...prev, ...readyFields } : prev));
      setSuccessMessage(`You're checked in as ready for ${name}.`);
      refreshInstructorData(); // the dashboard cards show this too
    } catch (error: unknown) {
      if (!mounted.current) return;
      // 422 and 404 carry a plain explanation (too far, too early, location needed, class not found...)
      const axiosErr = error as { response?: { status?: number; data?: { error?: string } } };
      const status = axiosErr.response?.status;
      if ((status === 422 || status === 404) && axiosErr.response?.data?.error) {
        setError(axiosErr.response.data.error);
      } else {
        handleError(error, { component: 'ClassAttendanceView', action: 'check in' });
        setError('We could not check you in right now. Please try again in a moment.');
      }
    } finally {
      if (mounted.current) setCheckInClassId(null);
    }
  };

  const handleCompleteClass = async () => {
    if (!selectedClass) return;
    try {
      setCompleting(true);
      await instructorApi.completeClass(selectedClass.courseId, instructorComments);
      refreshInstructorData();
      setError('');
      setSuccessMessage('Class completed successfully! It has been moved to your archive.');
      await loadTodaysClasses();
      setSelectedClass(null);
      setStudents([]);
      setInstructorComments('');
      setCompleteDialog(false);
    } catch (error: unknown) {
      handleError(error, { component: 'ClassAttendanceView', action: 'complete class' });
      setError('Failed to complete class');
    } finally {
      setCompleting(false);
    }
  };

  const formatTime = (timeString: string) => {
    if (!timeString) return '';
    return timeString.slice(0, 5);
  };

  const getAttendanceStats = () => {
    const studentsArray = Array.isArray(students) ? students : [];
    const total = studentsArray.length;
    const marked = studentsArray.filter(s => s.attendanceMarked).length;
    const present = studentsArray.filter(s => s.attendance && s.attendanceMarked).length;
    const absent = studentsArray.filter(s => !s.attendance && s.attendanceMarked).length;
    const notMarked = total - marked;
    return { total, marked, present, absent, notMarked };
  };

  const stats = getAttendanceStats();
  const studentsArray = Array.isArray(students) ? students : [];

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400 }}>
        <CircularProgress size={48} />
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
      {successMessage && (
        <Snackbar open={!!successMessage} autoHideDuration={4000} onClose={() => setSuccessMessage('')} anchorOrigin={{ vertical: 'top', horizontal: 'center' }}>
          <Alert onClose={() => setSuccessMessage('')} severity="success" sx={{ width: '100%' }}>{successMessage}</Alert>
        </Snackbar>
      )}

      {todaysClasses.length === 0 ? (
        <Box sx={{ bgcolor: (theme) => theme.palette.background.paper, border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', p: 6, textAlign: 'center' }}>
          <Typography sx={{ fontSize: 16, fontWeight: 600, color: (theme) => theme.palette.text.secondary }}>No classes scheduled for today</Typography>
          <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary, mt: 1 }}>Check back on days when you have scheduled classes.</Typography>
        </Box>
      ) : (
        <>
          {/* Class Selection */}
          <Box sx={{ border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', bgcolor: (theme) => theme.palette.background.paper, p: 3 }}>
            <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.07em', mb: 2 }}>Select Class for Attendance</Typography>
            <FormControl fullWidth>
              <InputLabel>Today's Classes</InputLabel>
              <Select value={selectedClass?.courseId || ''} label="Today's Classes" onChange={handleClassChange}>
                {todaysClasses.map(course => (
                  <MenuItem key={course.courseId} value={course.courseId}>
                    <Box>
                      <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: (theme) => theme.palette.text.primary }}>{course.name} - {course.organizationname}</Typography>
                      <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.text.secondary }}>{formatTime(course.startTime)} - {formatTime(course.endTime)} | {course.location}</Typography>
                    </Box>
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>

          {/* Student Management */}
          {selectedClass && (
            <Box sx={{ border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', bgcolor: (theme) => theme.palette.background.paper, p: 3 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Student Attendance</Typography>
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <GhostButton onClick={() => setAddStudentDialog(true)}>+ Add Student</GhostButton>
                  <PrimaryButton onClick={() => setCompleteDialog(true)} disabled={stats.notMarked > 0}>Complete Class</PrimaryButton>
                </Box>
              </Box>

              {/* Check-in: "I'm ready" at the venue */}
              <Box sx={{ mb: 2, p: 2, bgcolor: (theme) => theme.palette.background.default, borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}>
                <Box>
                  <Typography sx={{ fontSize: 14, fontWeight: 600, color: (theme) => theme.palette.text.primary }}>
                    {selectedClass.instructorReadyAt ? 'Checked in' : 'Check in when you are at the class'}
                  </Typography>
                  <Typography sx={{ fontSize: 12.5, color: (theme) => theme.palette.text.secondary }} role="status" aria-live="polite">
                    {selectedClass.instructorReadyAt
                      ? readySummary({ instructor_ready_at: selectedClass.instructorReadyAt, instructor_ready_distance_m: selectedClass.instructorReadyDistanceM })
                      : checkInClassId === selectedClass.courseId
                        ? 'Finding your location…'
                        : 'Your phone will ask to share its location. It must be at the venue. Only the distance is kept.'}
                  </Typography>
                </Box>
                {!selectedClass.instructorReadyAt && (
                  <PrimaryButton onClick={handleCheckIn} disabled={checkInClassId !== null}>
                    {checkInClassId === selectedClass.courseId ? 'Checking in…' : "I'm ready"}
                  </PrimaryButton>
                )}
              </Box>

              {/* Class Info */}
              <Box sx={{ mb: 2, p: 2, bgcolor: (theme) => theme.palette.background.default, borderRadius: '8px' }}>
                <Typography sx={{ fontSize: 14, fontWeight: 600, color: (theme) => theme.palette.text.primary, mb: 1 }}>{selectedClass.name} - {selectedClass.organizationname}</Typography>
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                  <StatusChip kind="neutral" label={`${formatTime(selectedClass.startTime)} - ${formatTime(selectedClass.endTime)}`} />
                  <StatusChip kind="neutral" label={selectedClass.location} />
                  <StatusChip kind="neutral" label={`${stats.total} Students`} />
                  <StatusChip kind="success" label={`${stats.present} Present`} />
                  <StatusChip kind="danger" label={`${stats.absent} Absent`} />
                  {stats.notMarked > 0 && <StatusChip kind="warning" label={`${stats.notMarked} Not Marked`} />}
                </Box>
              </Box>

              {/* Students Table */}
              {studentsLoading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}><CircularProgress size={24} /></Box>
              ) : studentsArray.length === 0 ? (
                <Box sx={{ textAlign: 'center', py: 4 }}>
                  <Typography sx={{ fontSize: 14, fontWeight: 600, color: (theme) => theme.palette.text.secondary }}>No Students Registered</Typography>
                  <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary, mt: 0.5 }}>Add students to this class to mark attendance</Typography>
                </Box>
              ) : (
                <DataTable columns={studentColumns} shownCount={studentsArray.length} totalCount={studentsArray.length}>
                  {studentsArray.map(student => (
                    <DataTableRow key={student.studentid} columns={studentColumns}>
                      <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: (theme) => theme.palette.text.primary }}>{student.firstname} {student.lastname}</Typography>
                      <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{student.email || '—'}</Typography>
                      <Box sx={{ display: 'flex', justifyContent: 'center', gap: 1 }}>
                        <ButtonBase
                          onClick={() => handleAttendanceChange(student.studentid, true)}
                          disabled={markingStudentId !== null}
                          aria-pressed={student.attendanceMarked && student.attendance}
                          aria-label={`Mark ${student.firstname} ${student.lastname} present`}
                          sx={{
                            fontSize: 12, fontWeight: 600, px: 1.5, py: 0.5, borderRadius: '6px',
                            '&.Mui-disabled': { opacity: 0.6 },
                            bgcolor: student.attendanceMarked && student.attendance ? '#16A34A' : 'transparent',
                            color: student.attendanceMarked && student.attendance ? '#fff' : '#16A34A',
                            border: '1px solid #16A34A',
                            '&:hover': { bgcolor: student.attendanceMarked && student.attendance ? '#16A34A' : '#f0fdf4' },
                          }}
                        >
                          Present
                        </ButtonBase>
                        <ButtonBase
                          onClick={() => handleAttendanceChange(student.studentid, false)}
                          disabled={markingStudentId !== null}
                          aria-pressed={student.attendanceMarked && !student.attendance}
                          aria-label={`Mark ${student.firstname} ${student.lastname} absent`}
                          sx={{
                            fontSize: 12, fontWeight: 600, px: 1.5, py: 0.5, borderRadius: '6px',
                            '&.Mui-disabled': { opacity: 0.6 },
                            bgcolor: student.attendanceMarked && !student.attendance ? '#CC1F1F' : 'transparent',
                            color: student.attendanceMarked && !student.attendance ? '#fff' : '#CC1F1F',
                            border: '1px solid #CC1F1F',
                            '&:hover': { bgcolor: student.attendanceMarked && !student.attendance ? '#CC1F1F' : '#fef2f2' },
                          }}
                        >
                          Absent
                        </ButtonBase>
                      </Box>
                      <StatusChip
                        kind={student.attendanceMarked ? (student.attendance ? 'success' : 'danger') : 'neutral'}
                        label={student.attendanceMarked ? (student.attendance ? 'Present' : 'Absent') : 'Not Marked'}
                      />
                    </DataTableRow>
                  ))}
                </DataTable>
              )}

              {/* Instructor Comments */}
              <Box sx={{ mt: 3 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.07em', mb: 1 }}>Instructor Comments</Typography>
                <TextField
                  fullWidth
                  multiline
                  rows={3}
                  placeholder="Add any notes about today's class (optional)"
                  value={instructorComments}
                  onChange={(e) => setInstructorComments(e.target.value)}
                  helperText="Comments will be visible to administrators in completed courses"
                />
              </Box>
            </Box>
          )}
        </>
      )}

      {/* Add Student Dialog */}
      <Dialog open={addStudentDialog} onClose={() => setAddStudentDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontSize: 18, fontWeight: 700, color: (theme) => theme.palette.text.primary }}>Add Student to Class</DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 1 }}>
            <TextField autoFocus fullWidth label="First Name" value={newStudent.firstName} onChange={e => setNewStudent(prev => ({ ...prev, firstName: e.target.value }))} margin="normal" required />
            <TextField fullWidth label="Last Name" value={newStudent.lastName} onChange={e => setNewStudent(prev => ({ ...prev, lastName: e.target.value }))} margin="normal" required />
            <TextField fullWidth label="Email" value={newStudent.email} onChange={e => setNewStudent(prev => ({ ...prev, email: e.target.value }))} margin="normal" type="email" required />
            <TextField fullWidth label="Phone" value={newStudent.phone} onChange={e => setNewStudent(prev => ({ ...prev, phone: e.target.value }))} margin="normal" type="tel" required />
            <FormControl fullWidth margin="normal">
              <InputLabel>College/School (if from another institution)</InputLabel>
              <Select value={newStudent.college} label="College/School (if from another institution)" onChange={e => setNewStudent(prev => ({ ...prev, college: e.target.value }))}>
                <MenuItem value=""><em>Same organization</em></MenuItem>
                {colleges.map(college => (
                  <MenuItem key={college.id} value={college.name}>{college.name}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <GhostButton onClick={() => setAddStudentDialog(false)} disabled={addingStudent}>Cancel</GhostButton>
          <PrimaryButton onClick={handleAddStudent} disabled={addingStudent}>
            {addingStudent ? 'Adding…' : 'Add Student'}
          </PrimaryButton>
        </DialogActions>
      </Dialog>

      {/* Complete Class Dialog */}
      <Dialog open={completeDialog} onClose={() => setCompleteDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontSize: 18, fontWeight: 700, color: (theme) => theme.palette.text.primary }}>Complete Class</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 14, color: (theme) => theme.palette.text.secondary, mb: 2 }}>Are you sure you want to mark this class as completed?</Typography>

          <Box sx={{ p: 2, bgcolor: (theme) => theme.palette.background.default, borderRadius: '8px', border: (theme) => `1px solid ${theme.palette.divider}`, mb: 2 }}>
            <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.07em', mb: 1 }}>Class Details</Typography>
            {[
              ['Course', selectedClass?.name],
              ['Organization', selectedClass?.organizationname],
              ['Location', selectedClass?.location],
              ['Time', selectedClass ? `${formatTime(selectedClass.startTime)} - ${formatTime(selectedClass.endTime)}` : ''],
              ['Students Registered', stats.total],
              ['Students Present', stats.present],
              ['Students Absent', stats.absent],
            ].map(([label, value]) => (
              <Box key={String(label)} sx={{ display: 'flex', borderBottom: (theme) => `1px solid ${theme.palette.divider}`, py: 0.75 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 600, color: (theme) => theme.palette.text.secondary, width: 160 }}>{label}</Typography>
                <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.primary }}>{value}</Typography>
              </Box>
            ))}
          </Box>

          <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.07em', mb: 1 }}>Final Comments</Typography>
          <TextField
            autoFocus
            fullWidth
            multiline
            rows={3}
            placeholder="Add any final notes about this class (optional)"
            value={instructorComments}
            onChange={(e) => setInstructorComments(e.target.value)}
          />

          <Box sx={{ mt: 2, p: 2, bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(37, 99, 235, 0.1)' : '#EFF6FF', borderRadius: '8px', border: (theme) => `1px solid ${theme.palette.mode === 'dark' ? 'rgba(37, 99, 235, 0.3)' : '#BFDBFE'}` }}>
            <Typography sx={{ fontSize: 13, fontWeight: 600, color: (theme) => theme.palette.mode === 'dark' ? '#60A5FA' : '#1E40AF', mb: 0.5 }}>This action will:</Typography>
            <Box component="ul" sx={{ m: 0, pl: 2.5, '& li': { fontSize: 12.5, color: (theme) => theme.palette.mode === 'dark' ? '#60A5FA' : '#1E40AF', mb: 0.25 } }}>
              <li>Mark the class as completed</li>
              <li>Move it to your archive</li>
              <li>Update the organization and admin portals</li>
              <li>Lock the final attendance count</li>
            </Box>
          </Box>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <GhostButton onClick={() => setCompleteDialog(false)}>Cancel</GhostButton>
          <PrimaryButton onClick={handleCompleteClass} disabled={completing}>
            {completing ? 'Completing...' : 'Complete Class'}
          </PrimaryButton>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default ClassAttendanceView;
