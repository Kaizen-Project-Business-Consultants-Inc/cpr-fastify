import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Select,
  SelectChangeEvent,
  MenuItem,
  FormControl,
  InputLabel,
  Checkbox,
  Alert,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
} from '@mui/material';
import { useTodayClasses, useClassStudents, useMarkAttendance } from '../../../services/instructorService';
import { instructorApi } from '../../../services/api';
import { handleError } from '../../../services/errorHandler';
import DataTable, { DataTableRow } from '../../gtacpr/DataTable';
import StatusChip from '../../gtacpr/StatusChip';
import { PrimaryButton, GhostButton } from '../../gtacpr/Buttons';

const studentColumns = [
  { key: 'name', label: 'STUDENT NAME', width: '1.5fr' },
  { key: 'email', label: 'EMAIL', width: '1.5fr' },
  { key: 'present', label: 'PRESENT', width: '0.6fr', align: 'center' as const },
  { key: 'status', label: 'STATUS', width: '0.7fr' },
];

interface TodayClass {
  courseId: number;
  name: string;
  organizationName: string;
  startTime?: string;
  endTime?: string;
  location?: string;
}

interface AttendanceStudent {
  studentId: number;
  firstName: string;
  lastName: string;
  email?: string;
  attendance?: boolean;
  attendanceMarked?: boolean;
}

const AttendanceView = ({ onAttendanceUpdate }: { onAttendanceUpdate?: () => void }) => {
  const [selectedClass, setSelectedClass] = useState<TodayClass | null>(null);
  const [students, setStudents] = useState<AttendanceStudent[]>([]);
  const [error, setError] = useState('');
  const [addStudentDialog, setAddStudentDialog] = useState(false);
  const [newStudent, setNewStudent] = useState({ firstName: '', lastName: '', email: '' });

  const { data: todaysClasses = [] as TodayClass[], isLoading: loading, error: classesError } = useTodayClasses();
  const { data: classStudents = [] as AttendanceStudent[], isLoading: studentsLoading } = useClassStudents(selectedClass?.courseId as number);
  const markAttendanceMutation = useMarkAttendance();

  // Seeds the locally-editable roster from the query result whenever the selected
  // class (and therefore the fetched roster) changes; students are then mutated
  // locally for optimistic UI updates independent of the query cache.
  useEffect(() => {
    if (classStudents && selectedClass) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStudents(classStudents as AttendanceStudent[]);
    }
  }, [classStudents, selectedClass]);

  useEffect(() => {
    if (classesError) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setError('Failed to load today\'s classes');
    }
  }, [classesError]);

  const handleClassChange = (event: SelectChangeEvent<number | string>) => {
    const classId = event.target.value;
    const selected = (todaysClasses as TodayClass[]).find((c) => c.courseId === classId);
    setSelectedClass(selected ?? null);
  };

  const handleAttendanceChange = async (studentId: number, attended: boolean) => {
    if (!selectedClass) return;
    try {
      setStudents(prev => prev.map(student =>
        student.studentId === studentId ? { ...student, attendance: attended, attendanceMarked: true } : student
      ));
      await markAttendanceMutation.mutateAsync({
        courseId: selectedClass.courseId,
        students: students.map(student => ({
          studentId: student.studentId,
          attended: student.studentId === studentId ? attended : !!student.attendance,
        })),
      });
      if (onAttendanceUpdate) onAttendanceUpdate();
    } catch (error) {
      handleError(error, { component: 'AttendanceView', action: 'update attendance' });
      setError('Failed to update attendance');
    }
  };

  const handleAddStudent = async () => {
    if (!selectedClass || !newStudent.firstName || !newStudent.lastName) {
      setError('Please fill in at least first and last name');
      return;
    }
    try {
      const response = await instructorApi.addStudent(selectedClass.courseId, newStudent);
      setStudents(prev => [...prev, response.data]);
      setNewStudent({ firstName: '', lastName: '', email: '' });
      setAddStudentDialog(false);
      setError('');
      if (onAttendanceUpdate) onAttendanceUpdate();
    } catch (error) {
      handleError(error, { component: 'AttendanceView', action: 'add student' });
      setError('Failed to add student');
    }
  };

  const formatTime = (timeString?: string) => {
    if (!timeString) return '';
    return timeString.slice(0, 5);
  };

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
                {(todaysClasses as TodayClass[]).map((course) => (
                  <MenuItem key={course.courseId} value={course.courseId}>
                    <Box>
                      <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: (theme) => theme.palette.text.primary }}>{course.name} - {course.organizationName}</Typography>
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
                <PrimaryButton onClick={() => setAddStudentDialog(true)}>+ Add Student</PrimaryButton>
              </Box>

              {/* Class Info */}
              <Box sx={{ mb: 2, p: 2, bgcolor: (theme) => theme.palette.background.default, borderRadius: '8px' }}>
                <Typography sx={{ fontSize: 14, fontWeight: 600, color: (theme) => theme.palette.text.primary, mb: 1 }}>{selectedClass.name} - {selectedClass.organizationName}</Typography>
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <StatusChip kind="neutral" label={`${formatTime(selectedClass.startTime)} - ${formatTime(selectedClass.endTime)}`} />
                  <StatusChip kind="neutral" label={`${students.length} Students`} />
                  <StatusChip kind="neutral" label={selectedClass.location || '—'} />
                </Box>
              </Box>

              {/* Students Table */}
              {studentsLoading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}><CircularProgress size={24} /></Box>
              ) : students.length === 0 ? (
                <Box sx={{ textAlign: 'center', py: 4 }}>
                  <Typography sx={{ fontSize: 14, fontWeight: 600, color: (theme) => theme.palette.text.secondary }}>No Students Registered</Typography>
                  <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary, mt: 0.5 }}>Add students to this class to mark attendance</Typography>
                </Box>
              ) : (
                <DataTable columns={studentColumns} shownCount={students.length} totalCount={students.length}>
                  {students.map(student => (
                    <DataTableRow key={student.studentId} columns={studentColumns}>
                      <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: (theme) => theme.palette.text.primary }}>{student.firstName} {student.lastName}</Typography>
                      <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{student.email || '—'}</Typography>
                      <Box sx={{ display: 'flex', justifyContent: 'center' }}>
                        <Checkbox
                          checked={student.attendance || false}
                          onChange={e => handleAttendanceChange(student.studentId, e.target.checked)}
                          sx={{ '&.Mui-checked': { color: '#CC1F1F' } }}
                        />
                      </Box>
                      <StatusChip
                        kind={student.attendanceMarked ? (student.attendance ? 'success' : 'danger') : 'neutral'}
                        label={student.attendanceMarked ? (student.attendance ? 'Present' : 'Absent') : 'Not Marked'}
                      />
                    </DataTableRow>
                  ))}
                </DataTable>
              )}
            </Box>
          )}
        </>
      )}

      {/* Add Student Dialog */}
      <Dialog open={addStudentDialog} onClose={() => setAddStudentDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontSize: 18, fontWeight: 700, color: (theme) => theme.palette.text.primary }}>Add Student to Class</DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 1 }}>
            <TextField fullWidth label="First Name" value={newStudent.firstName} onChange={e => setNewStudent(prev => ({ ...prev, firstName: e.target.value }))} margin="normal" required />
            <TextField fullWidth label="Last Name" value={newStudent.lastName} onChange={e => setNewStudent(prev => ({ ...prev, lastName: e.target.value }))} margin="normal" required />
            <TextField fullWidth label="Email (Optional)" value={newStudent.email} onChange={e => setNewStudent(prev => ({ ...prev, email: e.target.value }))} margin="normal" type="email" />
          </Box>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <GhostButton onClick={() => setAddStudentDialog(false)}>Cancel</GhostButton>
          <PrimaryButton onClick={handleAddStudent}>Add Student</PrimaryButton>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default AttendanceView;
