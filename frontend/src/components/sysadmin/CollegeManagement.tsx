import React, { useCallback, useEffect, useState } from 'react';
import {
  Box,
  Typography,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  Alert,
} from '@mui/material';
import { collegesApi } from '../../services/api';
import DataTable, { DataTableRow } from '../gtacpr/DataTable';
import StatusChip from '../gtacpr/StatusChip';
import { PrimaryButton } from '../gtacpr/Buttons';
import { useConfirm, LinkButton } from '../gtacpr';
import { getErrorMessage } from '../../utils/errorMessage';

interface College {
  id: number;
  name: string;
  is_active: number | boolean;
}

interface CollegeManagementProps {
  onShowSnackbar: (message: string, severity: 'success' | 'error' | 'warning' | 'info') => void;
}

const columns = [
  { key: 'name', label: 'COLLEGE / SCHOOL', width: '2fr' },
  { key: 'status', label: 'STATUS', width: '0.7fr' },
  { key: 'actions', label: '', width: '1.3fr', align: 'right' as const },
];

/**
 * The list instructors pick from when a student comes from another school
 * (Class Attendance → Add Student). Students keep a copy of the name, so
 * renaming or deleting a college never changes past records.
 */
const CollegeManagement: React.FC<CollegeManagementProps> = ({ onShowSnackbar }) => {
  const [colleges, setColleges] = useState<College[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState<College | 'new' | null>(null);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const { confirm, dialog: confirmDialog } = useConfirm();

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await collegesApi.getAllAdmin();
      setColleges(response.data?.data ?? []);
    } catch (err) {
      setLoadError(getErrorMessage(err, 'Failed to load colleges'));
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch-on-mount: setState happens after the await, the standard data-loading effect.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const openEditor = (college: College | 'new') => {
    setEditing(college);
    setName(college === 'new' ? '' : college.name);
    setFormError(null);
  };

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed || !editing) return;
    setSaving(true);
    setFormError(null);
    try {
      if (editing === 'new') {
        await collegesApi.create(trimmed);
        onShowSnackbar(`${trimmed} added`, 'success');
      } else {
        await collegesApi.update(editing.id, { name: trimmed });
        onShowSnackbar('College renamed', 'success');
      }
      setEditing(null);
      load();
    } catch (err) {
      setFormError(getErrorMessage(err, 'Failed to save the college'));
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (college: College) => {
    const active = !!college.is_active;
    try {
      await collegesApi.update(college.id, { isActive: !active });
      onShowSnackbar(active ? `${college.name} hidden from the list` : `${college.name} shown in the list again`, 'success');
      load();
    } catch (err) {
      onShowSnackbar(getErrorMessage(err, 'Failed to update the college'), 'error');
    }
  };

  const handleDelete = async (college: College) => {
    const ok = await confirm({
      title: 'Delete this college?',
      message: `${college.name} will be removed from the list. Students already recorded with it keep it. To stop offering it but keep it on file, use Hide instead.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await collegesApi.delete(college.id);
      onShowSnackbar(`${college.name} deleted`, 'success');
      load();
    } catch (err) {
      onShowSnackbar(getErrorMessage(err, 'Failed to delete the college'), 'error');
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
        <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary, flex: 1, minWidth: 240 }}>
          Instructors pick from this list when a student comes from another college or school.
          Hidden colleges stay on file but aren&rsquo;t offered.
        </Typography>
        <PrimaryButton onClick={() => openEditor('new')}>+ Add College</PrimaryButton>
      </Box>

      {loadError && <Alert severity="error">{loadError}</Alert>}

      <DataTable
        columns={columns}
        loading={loading}
        shownCount={colleges.length}
        totalCount={colleges.length}
        emptyMessage="No colleges yet. Add the first one."
      >
        {colleges.map((college) => {
          const active = !!college.is_active;
          return (
            <DataTableRow key={college.id} columns={columns}>
              <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: (theme) => theme.palette.text.primary }}>{college.name}</Typography>
              <StatusChip kind={active ? 'active' : 'inactive'} label={active ? 'Shown' : 'Hidden'} />
              <Box sx={{ display: 'flex', gap: 1.5, justifyContent: 'flex-end' }}>
                <LinkButton onClick={() => openEditor(college)} aria-label={`Rename ${college.name}`}>Rename</LinkButton>
                <LinkButton tone="neutral" onClick={() => toggleActive(college)} aria-label={`${active ? 'Hide' : 'Show'} ${college.name}`}>
                  {active ? 'Hide' : 'Show'}
                </LinkButton>
                <LinkButton tone="danger" onClick={() => handleDelete(college)} aria-label={`Delete ${college.name}`}>Delete</LinkButton>
              </Box>
            </DataTableRow>
          );
        })}
      </DataTable>

      <Dialog open={editing !== null} onClose={() => !saving && setEditing(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>{editing === 'new' ? 'Add a college' : 'Rename college'}</DialogTitle>
        <DialogContent>
          {formError && <Alert severity="error" sx={{ mb: 2 }}>{formError}</Alert>}
          <TextField
            id="college-name"
            label="College or school name"
            fullWidth
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
            disabled={saving}
            inputProps={{ maxLength: 200 }}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditing(null)} disabled={saving}>Cancel</Button>
          <Button variant="contained" onClick={handleSave} disabled={saving || !name.trim()}>
            {saving ? 'Saving…' : editing === 'new' ? 'Add' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>
      {confirmDialog}
    </Box>
  );
};

export default CollegeManagement;
