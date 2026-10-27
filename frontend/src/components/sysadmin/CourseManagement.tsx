import React, { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Typography,
  TextField,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Grid,
  Card,
  FormControlLabel,
  Switch,
  Button,
} from '@mui/material';
import { Save as SaveIcon, Cancel as CancelIcon } from '@mui/icons-material';
import { sysAdminApi } from '../../services/api';
import logger from '../../utils/logger';
import StatusChip from '../gtacpr/StatusChip';
import { PrimaryButton } from '../gtacpr/Buttons';
import { useConfirm, LinkButton, SegmentedToggle } from '../gtacpr';
import { getErrorMessage } from '../../utils/errorMessage';
import type { Theme } from '@mui/material/styles';

// GET /sysadmin/courses: the class_types row plus isActive (true/false).
interface Course {
  id: string;
  name: string;
  description?: string | null;
  duration_minutes?: number;
  certification_validity_months?: number | null;
  isActive?: boolean;
  /** How many course requests / organization prices use this course type. */
  requestCount?: number;
  priceCount?: number;
}

const emptyForm = {
  name: '', description: '', durationHours: '', durationMinutes: '',
  validityPeriodMonths: '', isActive: true,
};

const CourseManagement = ({ onShowSnackbar }: { onShowSnackbar?: (message: string, severity?: 'success' | 'error') => void }) => {
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState<'active' | 'inactive'>('active');
  const { confirm, dialog: confirmDialog } = useConfirm();

  // Dialog state
  const [showDialog, setShowDialog] = useState(false);
  const [editingCourse, setEditingCourse] = useState<Course | null>(null);
  const [formData, setFormData] = useState(emptyForm);

  const loadCourses = useCallback(async () => {
    setLoading(true);
    try {
      const response = await sysAdminApi.getCourses();
      setCourses(response.data || []);
    } catch (err) {
      logger.error('Error loading courses:', err);
      onShowSnackbar?.('Failed to load courses', 'error');
    } finally {
      setLoading(false);
    }
  }, [onShowSnackbar]);

  // Mount-time fetch of the course catalog (external API sync, not state
  // derived from render data), so a direct setState inside is expected.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadCourses(); }, [loadCourses]);

  const handleAddNew = () => {
    setEditingCourse(null);
    setFormData(emptyForm);
    setShowDialog(true);
  };

  const handleEdit = (course: Course) => {
    setEditingCourse(course);
    const dMin = course.duration_minutes || 0;
    setFormData({
      name: course.name || '',
      description: course.description || '',
      durationHours: dMin ? Math.floor(dMin / 60).toString() : '',
      durationMinutes: dMin ? (dMin % 60).toString() : '',
      validityPeriodMonths: course.certification_validity_months ? course.certification_validity_months.toString() : '',
      isActive: course.isActive !== false,
    });
    setShowDialog(true);
  };

  /** Deactivating an existing course type hides it from scheduling; ask first. */
  const handleActiveSwitch = async (checked: boolean) => {
    if (!checked && editingCourse && editingCourse.isActive !== false) {
      const ok = await confirm({
        title: 'Deactivate course type?',
        message: `"${editingCourse.name}" will no longer be available for scheduling once you save. You can reactivate it later.`,
        confirmLabel: 'Deactivate',
        danger: true,
      });
      if (!ok) return;
    }
    setFormData(prev => ({ ...prev, isActive: checked }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) { onShowSnackbar?.('Course name is required', 'error'); return; }
    const hours = formData.durationHours ? parseInt(formData.durationHours) : 0;
    const mins = formData.durationMinutes ? parseInt(formData.durationMinutes) : 0;
    const totalMinutes = hours * 60 + mins;
    if (totalMinutes <= 0) { onShowSnackbar?.('Duration is required', 'error'); return; }
    if (saving) return;

    try {
      setSaving(true);
      // The server takes class_types' own column names.
      const submitData = {
        name: formData.name.trim(),
        description: formData.description,
        duration_minutes: totalMinutes,
        certification_validity_months: formData.validityPeriodMonths ? parseInt(formData.validityPeriodMonths) : null,
        is_active: formData.isActive,
      };
      if (editingCourse) {
        await sysAdminApi.updateCourse(Number(editingCourse.id), submitData);
        const wasActive = editingCourse.isActive !== false;
        if (wasActive && !formData.isActive) onShowSnackbar?.(`${submitData.name} moved to Inactive`, 'success');
        else if (!wasActive && formData.isActive) onShowSnackbar?.(`${submitData.name} is active again`, 'success');
        else onShowSnackbar?.('Course updated successfully', 'success');
      } else {
        await sysAdminApi.createCourse(submitData);
        onShowSnackbar?.('Course created successfully', 'success');
      }
      setShowDialog(false);
      loadCourses();
    } catch (err) {
      logger.error('Error saving course:', err);
      onShowSnackbar?.(getErrorMessage(err, 'Failed to save course'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleReactivate = async (course: Course) => {
    if (saving) return;
    const ok = await confirm({
      title: 'Reactivate course type?',
      message: `"${course.name}" will be available for scheduling again.`,
      confirmLabel: 'Reactivate',
    });
    if (!ok) return;
    try {
      setSaving(true);
      await sysAdminApi.updateCourse(Number(course.id), { is_active: true });
      onShowSnackbar?.(`${course.name} is active again`, 'success');
      setView('active');
      loadCourses();
    } catch (err) {
      logger.error('Error reactivating course:', err);
      onShowSnackbar?.(getErrorMessage(err, 'Failed to reactivate course'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (course: Course) => {
    if (saving) return;
    const ok = await confirm({
      title: 'Delete course type permanently?',
      message: `"${course.name}" has never been used, so it can be removed. This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      setSaving(true);
      const res = await sysAdminApi.deleteCourse(Number(course.id));
      // A request can arrive between loading the page and the click; the server then only keeps it as Inactive.
      if (res?.softDeleted) onShowSnackbar?.(`${course.name} was used meanwhile, so it was kept as Inactive`, 'success');
      else onShowSnackbar?.(`${course.name} deleted`, 'success');
      loadCourses();
    } catch (err) {
      logger.error('Error deleting course:', err);
      onShowSnackbar?.(getErrorMessage(err, 'Failed to delete course'), 'error');
    } finally {
      setSaving(false);
    }
  };

  /** Why a course type can or can't be deleted, in words. */
  const usageText = (course: Course) => {
    const requests = course.requestCount ?? 0;
    const prices = course.priceCount ?? 0;
    if (requests > 0) return `Used by ${requests} request${requests !== 1 ? 's' : ''}, so it is kept on record`;
    if (prices > 0) return `Has ${prices} price record${prices !== 1 ? 's' : ''}, so it is kept on record`;
    return 'Never used';
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const formatDuration = (dMin: number) => {
    if (!dMin) return '—';
    const h = Math.floor(dMin / 60);
    const m = dMin % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
  };

  const activeCourses = courses.filter(c => c.isActive !== false);
  const inactiveCourses = courses.filter(c => c.isActive === false);
  const shown = view === 'active' ? activeCourses : inactiveCourses;

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400 }}>
        <CircularProgress size={48} />
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Action buttons */}
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1.5, mt: -1 }}>
        <PrimaryButton onClick={handleAddNew}>+ New Course Type</PrimaryButton>
      </Box>

      {/* Course Catalog */}
      <Box>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
            COURSE CATALOG
          </Typography>
          <SegmentedToggle
            value={view}
            onChange={(v) => setView(v as 'active' | 'inactive')}
            options={[
              { value: 'active', label: `Active (${activeCourses.length})` },
              { value: 'inactive', label: `Inactive (${inactiveCourses.length})` },
            ]}
          />
        </Box>

        {shown.length === 0 && (
          <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary, py: 3 }}>
            {view === 'active' ? 'No active course types.' : 'No inactive course types.'}
          </Typography>
        )}

        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' }, gap: '16px' }}>
          {shown.map(course => {
            const dMin = course.duration_minutes || 0;
            const validityMonths = course.certification_validity_months;
            return (
              <Card
                key={course.id}
                sx={{
                  borderRadius: '10px',
                  border: (theme: Theme) => `1px solid ${theme.palette.divider}`,
                  boxShadow: '0 1px 3px rgba(0,0,0,.05)',
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                  opacity: course.isActive === false ? 0.6 : 1,
                }}
              >
                {/* Dark head */}
                <Box sx={{ bgcolor: (theme) => theme.palette.mode === 'dark' ? theme.palette.background.paper : '#111827', px: 2, pt: 2, pb: 1.75 }}>
                  <Typography sx={{ fontSize: 14.5, fontWeight: 700, color: (theme) => theme.palette.mode === 'dark' ? theme.palette.text.primary : '#fff' }}>
                    {course.name}
                  </Typography>
                  <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.mode === 'dark' ? theme.palette.text.secondary : 'rgba(255,255,255,.6)', mt: 0.25 }}>
                    {formatDuration(dMin)}
                  </Typography>
                </Box>

                {/* Body */}
                <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1.25, flex: 1 }}>
                  {/* Status badge */}
                  <Box sx={{ alignSelf: 'flex-start' }}>
                    {course.isActive !== false ? (
                      <StatusChip kind="active" label="Active" />
                    ) : (
                      <StatusChip kind="inactive" label="Inactive" />
                    )}
                  </Box>

                  {/* Key/value rows */}
                  {validityMonths && (
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                      <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.text.secondary }}>Validity</Typography>
                      <Typography sx={{ fontSize: 12, fontWeight: 600, color: (theme) => theme.palette.text.primary }}>{validityMonths} months</Typography>
                    </Box>
                  )}
                  {course.isActive === false && (
                    <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.text.secondary }}>
                      {usageText(course)}
                    </Typography>
                  )}
                  {course.isActive === false && (
                    <LinkButton
                      onClick={() => handleReactivate(course)}
                      aria-label={`Reactivate ${course.name}`}
                      sx={{
                        mt: 'auto',
                        display: 'block',
                        width: '100%',
                        textAlign: 'center',
                        py: 1,
                        border: (theme: Theme) => `1.5px solid ${theme.palette.divider}`,
                        borderRadius: '8px',
                        fontSize: 13,
                        fontWeight: 700,
                        '&:hover': { bgcolor: '#FFF0F0', textDecoration: 'none' },
                      }}
                    >
                      Reactivate
                    </LinkButton>
                  )}
                  {/* Edit button */}
                  <LinkButton
                    onClick={() => handleEdit(course)}
                    aria-label={`Edit ${course.name}`}
                    sx={{
                      mt: course.isActive === false ? 0 : 'auto',
                      display: 'block',
                      width: '100%',
                      textAlign: 'center',
                      py: 1,
                      border: (theme: Theme) => `1.5px solid ${theme.palette.divider}`,
                      borderRadius: '8px',
                      fontSize: 13,
                      fontWeight: 700,
                      '&:hover': { bgcolor: '#FFF0F0', textDecoration: 'none' },
                    }}
                  >
                    Edit Course Type
                  </LinkButton>
                  {course.isActive === false && (course.requestCount ?? 0) === 0 && (course.priceCount ?? 0) === 0 && (
                    <LinkButton
                      onClick={() => handleDelete(course)}
                      aria-label={`Delete ${course.name} permanently`}
                      sx={{ display: 'block', width: '100%', textAlign: 'center', py: 0.5, fontSize: 12, fontWeight: 700, color: 'error.main' }}
                    >
                      Delete permanently
                    </LinkButton>
                  )}
                </Box>
              </Card>
            );
          })}
        </Box>
      </Box>

      {/* Add/Edit Course Dialog — kept from original */}
      <Dialog open={showDialog} onClose={() => setShowDialog(false)} maxWidth="md" fullWidth>
        <DialogTitle>{editingCourse ? 'Edit Course' : 'Add New Course'}</DialogTitle>
        <DialogContent>
          <Box component="form" onSubmit={handleSubmit} sx={{ mt: 2 }}>
            <Grid container spacing={2}>
              <Grid item xs={12}>
                <TextField fullWidth required label="Course Name" name="name" value={formData.name} onChange={handleChange} />
              </Grid>
              <Grid item xs={12}>
                <TextField fullWidth multiline rows={3} label="Description" name="description" value={formData.description} onChange={handleChange} />
              </Grid>
              <Grid item xs={6} sm={3}>
                <TextField fullWidth type="number" label="Duration (Hours)" name="durationHours" value={formData.durationHours} onChange={handleChange} inputProps={{ min: 0 }} />
              </Grid>
              <Grid item xs={6} sm={3}>
                <TextField fullWidth type="number" label="Duration (Minutes)" name="durationMinutes" value={formData.durationMinutes} onChange={handleChange} inputProps={{ min: 0, max: 59 }} />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField fullWidth type="number" label="Validity Period (Months)" name="validityPeriodMonths" value={formData.validityPeriodMonths} onChange={handleChange} inputProps={{ min: 1 }} />
              </Grid>
              <Grid item xs={12}>
                <FormControlLabel
                  control={<Switch checked={formData.isActive} onChange={(e) => handleActiveSwitch(e.target.checked)} name="isActive" color="primary" inputProps={{ 'aria-label': 'Active course' }} />}
                  label="Active Course"
                />
              </Grid>
            </Grid>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowDialog(false)} startIcon={<CancelIcon />} disabled={saving}>Cancel</Button>
          <Button onClick={handleSubmit} variant="contained" startIcon={<SaveIcon />} disabled={saving}>
            {saving ? 'Saving…' : editingCourse ? 'Update Course' : 'Create Course'}
          </Button>
        </DialogActions>
      </Dialog>
      {confirmDialog}
    </Box>
  );
};

export default CourseManagement;
