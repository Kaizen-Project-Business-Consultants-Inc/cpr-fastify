import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Grid,
  TextField,
  Switch,
} from '@mui/material';
import { sysAdminApi } from '../../services/api';
import api from '../../services/api';
import SearchBar from '../gtacpr/SearchBar';
import DataTable, { DataTableRow } from '../gtacpr/DataTable';
import UserAvatar from '../gtacpr/UserAvatar';
import StatusChip from '../gtacpr/StatusChip';
import { LinkButton } from '../gtacpr';
import { useDebounce } from '../../hooks/useDebounce';
import { useServerPagination } from '../../hooks/useServerPagination';
import { formatDisplayDate } from '../../utils/formatters';
import type { Theme } from '@mui/material/styles';

interface StudentManagementProps {
  onShowSnackbar: (message: string, severity: 'success' | 'error' | 'warning' | 'info') => void;
}

interface Student {
  id: number;
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  organization_name?: string;
  course_count?: number;
  last_course_date?: string;
  marketing_consent?: boolean;
  notes?: string;
  courses?: CourseHistoryEntry[];
}

interface CourseHistoryEntry {
  id: number;
  course_type_name?: string;
  organization_name?: string;
  instructor_name?: string;
  location?: string;
  completed_at?: string;
  certificate_expires_at?: string;
}

const columns = [
  { key: 'name', label: 'STUDENT', width: '1.5fr' },
  { key: 'email', label: 'EMAIL', width: '1.4fr' },
  { key: 'phone', label: 'PHONE', width: '0.9fr' },
  { key: 'org', label: 'ORGANIZATION', width: '1.2fr' },
  { key: 'courses', label: 'COURSES', width: '0.6fr', align: 'center' as const },
  { key: 'lastCourse', label: 'LAST COURSE', width: '0.9fr' },
  { key: 'marketing', label: 'MARKETING', width: '0.7fr', align: 'center' as const },
  { key: 'actions', label: '', width: '0.6fr', align: 'right' as const },
];

function getInitials(first?: string, last?: string): string {
  return `${(first || '')[0] || ''}${(last || '')[0] || ''}`.toUpperCase();
}

const StudentManagement = ({ onShowSnackbar }: StudentManagementProps) => {
  const [searchTerm, setSearchTerm] = useState('');
  const debouncedSearch = useDebounce(searchTerm, 300);
  const [saving, setSaving] = useState(false);

  // Search is server-side: `/sysadmin/students` takes `q` (min 2 chars) and
  // matches across the whole directory. On the search path the endpoint
  // answers with every match and no `pagination` block — the hook treats that
  // as a single page, which is the behaviour this screen already had.
  const grid = useServerPagination<Student>({
    pageSize: 25,
    fetchFn: ({ page, limit }) => {
      const q = debouncedSearch.trim();
      return api
        .get('/sysadmin/students', {
          params: { page, limit, q: q.length >= 2 ? q : undefined },
        })
        .then(r => r.data);
    },
    onError: () => onShowSnackbar('Failed to load students', 'error'),
  });
  const students = grid.items;

  // Detail dialog
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [courseHistory, setCourseHistory] = useState<CourseHistoryEntry[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  // Edit dialog
  const [editOpen, setEditOpen] = useState(false);
  const [editData, setEditData] = useState({ first_name: '', last_name: '', phone: '', notes: '' });
  const [editId, setEditId] = useState<number | null>(null);

  const loadStudents = grid.load;
  useEffect(() => { loadStudents(1); }, [loadStudents, debouncedSearch]);

  // Snapshot "now" once per mount (via the useState lazy initializer,
  // which runs a single time) rather than calling Date.now() directly in
  // render, which the purity rule flags as non-deterministic; the
  // certificate countdown below only needs to be accurate to the day.
  const [now] = useState(() => Date.now());

  const handleViewStudent = async (student: Student) => {
    setDetailOpen(true);
    setDetailLoading(true);
    setSelectedStudent(student);
    setCourseHistory([]);
    try {
      const response = await sysAdminApi.getStudent(student.id);
      setSelectedStudent(response.data);
      setCourseHistory(response.data.courses || []);
    } catch {
      onShowSnackbar('Failed to load student details', 'error');
    } finally {
      setDetailLoading(false);
    }
  };

  const handleEditOpen = (student: Student) => {
    setEditId(student.id);
    setEditData({
      first_name: student.first_name || '',
      last_name: student.last_name || '',
      phone: student.phone || '',
      notes: student.notes || '',
    });
    setEditOpen(true);
  };

  const handleEditSave = async () => {
    if (!editId || saving) return;
    try {
      setSaving(true);
      await sysAdminApi.updateStudent(editId, editData);
      onShowSnackbar('Student updated', 'success');
      setEditOpen(false);
      grid.reload();
    } catch {
      onShowSnackbar('Failed to update student', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleConsentToggle = async (student: Student) => {
    const newConsent = !student.marketing_consent;
    try {
      await sysAdminApi.updateStudentConsent(student.id, newConsent);
      onShowSnackbar(`Marketing consent ${newConsent ? 'granted' : 'revoked'}`, 'success');
      grid.reload();
    } catch {
      onShowSnackbar('Failed to update consent', 'error');
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Search + count */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <Box sx={{ flex: 1, maxWidth: 420 }}>
          <SearchBar
            placeholder="Search students by name or email..."
            value={searchTerm}
            onChange={setSearchTerm}
          />
        </Box>
        <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.text.secondary }}>
          {grid.totalCount} student{grid.totalCount !== 1 ? 's' : ''}
        </Typography>
      </Box>

      {/* Table */}
      <DataTable
        columns={columns}
        shownCount={grid.shownCount}
        totalCount={grid.totalCount}
        page={grid.page}
        onPrevPage={grid.onPrevPage}
        onNextPage={grid.onNextPage}
        hasNextPage={grid.hasNextPage}
        loading={grid.loading}
        emptyMessage={searchTerm ? 'No students match your search.' : 'No students found.'}
      >
        {students.map((student) => (
            <DataTableRow key={student.id} columns={columns}>
              {/* STUDENT */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                <UserAvatar initials={getInitials(student.first_name, student.last_name)} />
                <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: (theme) => theme.palette.text.primary }}>
                  {student.last_name}, {student.first_name}
                </Typography>
              </Box>
              {/* EMAIL */}
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
                {student.email}
              </Typography>
              {/* PHONE */}
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
                {student.phone || '—'}
              </Typography>
              {/* ORGANIZATION */}
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
                {student.organization_name || '—'}
              </Typography>
              {/* COURSES */}
              <Typography sx={{ fontSize: 13, fontWeight: 600, color: (theme) => theme.palette.text.primary, textAlign: 'center' }}>
                {student.course_count || 0}
              </Typography>
              {/* LAST COURSE */}
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
                {formatDisplayDate(student.last_course_date)}
              </Typography>
              {/* MARKETING */}
              <Box sx={{ display: 'flex', justifyContent: 'center' }}>
                <Switch
                  size="small"
                  checked={!!student.marketing_consent}
                  onChange={() => handleConsentToggle(student)}
                  inputProps={{ 'aria-label': `Marketing consent for ${student.first_name || ''} ${student.last_name || ''}`.trim() }}
                  sx={{
                    '& .MuiSwitch-switchBase.Mui-checked': { color: '#16A34A' },
                    '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { backgroundColor: '#16A34A' },
                  }}
                />
              </Box>
              {/* ACTIONS */}
              <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'flex-end' }}>
                <LinkButton onClick={() => handleViewStudent(student)}>View</LinkButton>
                <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.divider }}>|</Typography>
                <LinkButton onClick={() => handleEditOpen(student)}>Edit</LinkButton>
              </Box>
          </DataTableRow>
        ))}
      </DataTable>

      {/* Detail Dialog — Course History */}
      <Dialog open={detailOpen} onClose={() => setDetailOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>
          {selectedStudent ? `${selectedStudent.first_name} ${selectedStudent.last_name}` : 'Student'} — Course History
        </DialogTitle>
        <DialogContent>
          {detailLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress />
            </Box>
          ) : courseHistory.length === 0 ? (
            <Typography sx={{ color: (theme) => theme.palette.text.secondary, py: 4, textAlign: 'center', fontSize: 14 }}>
              No course history found.
            </Typography>
          ) : (
            <Box sx={{ mt: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
              {courseHistory.map((course: CourseHistoryEntry) => {
                let chipKind: 'active' | 'warning' | 'danger' | 'neutral' = 'neutral';
                let chipLabel = '—';
                if (course.certificate_expires_at) {
                  const daysLeft = Math.ceil((new Date(course.certificate_expires_at).getTime() - now) / 86400000);
                  if (daysLeft < 0) { chipKind = 'danger'; chipLabel = 'Expired'; }
                  else if (daysLeft <= 90) { chipKind = 'warning'; chipLabel = `${daysLeft}d left`; }
                  else { chipKind = 'active'; chipLabel = 'Active'; }
                }
                return (
                  <Box
                    key={course.id}
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: '1.5fr 1fr 1fr 0.8fr 0.8fr 0.8fr',
                      alignItems: 'center',
                      p: '10px 14px',
                      borderRadius: '8px',
                      border: (theme: Theme) => `1px solid ${theme.palette.divider}`,
                      gap: 1,
                    }}
                  >
                    <Typography sx={{ fontSize: 13, fontWeight: 600, color: (theme) => theme.palette.text.primary }}>{course.course_type_name}</Typography>
                    <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.text.secondary }}>{course.organization_name}</Typography>
                    <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.text.secondary }}>{course.instructor_name || '—'}</Typography>
                    <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.text.secondary }}>{course.location || '—'}</Typography>
                    <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.text.secondary }}>
                      {formatDisplayDate(course.completed_at)}
                    </Typography>
                    <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <StatusChip kind={chipKind} label={chipLabel} />
                    </Box>
                  </Box>
                );
              })}
            </Box>
          )}
          {selectedStudent && (
            <Box sx={{ mt: 2, p: 2, bgcolor: (theme) => theme.palette.background.default, borderRadius: '8px' }}>
              <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.text.secondary }}>
                <strong>Email:</strong> {selectedStudent.email} &nbsp;|&nbsp;
                <strong>Phone:</strong> {selectedStudent.phone || '—'} &nbsp;|&nbsp;
                <strong>Marketing consent:</strong> {selectedStudent.marketing_consent ? 'Yes' : 'No'}
                {selectedStudent.notes && (
                  <> &nbsp;|&nbsp; <strong>Notes:</strong> {selectedStudent.notes}</>
                )}
              </Typography>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDetailOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={editOpen} onClose={() => setEditOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Edit Student</DialogTitle>
        <DialogContent>
          <Box sx={{ mt: 2 }}>
            <Grid container spacing={2}>
              <Grid item xs={12} sm={6}>
                <TextField fullWidth label="First Name" value={editData.first_name} onChange={(e) => setEditData({ ...editData, first_name: e.target.value })} />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField fullWidth label="Last Name" value={editData.last_name} onChange={(e) => setEditData({ ...editData, last_name: e.target.value })} />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField fullWidth label="Phone" value={editData.phone} onChange={(e) => setEditData({ ...editData, phone: e.target.value })} />
              </Grid>
              <Grid item xs={12}>
                <TextField fullWidth label="Notes" value={editData.notes} onChange={(e) => setEditData({ ...editData, notes: e.target.value })} multiline rows={2} />
              </Grid>
            </Grid>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditOpen(false)} disabled={saving}>Cancel</Button>
          <Button onClick={handleEditSave} variant="contained" disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default StudentManagement;
