import React, { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  Alert,
  CircularProgress,
} from '@mui/material';
import api from '../../services/api';
import { useSnackbar } from '../../contexts/SnackbarContext';

export interface ChangePasswordDialogProps {
  open: boolean;
  onClose: () => void;
}

const MIN_LENGTH = 8;

interface FormState {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

const EMPTY: FormState = { currentPassword: '', newPassword: '', confirmPassword: '' };

/**
 * Change-password dialog shared by every portal. Calls POST /auth/change-password.
 */
const ChangePasswordDialog: React.FC<ChangePasswordDialogProps> = ({ open, onClose }) => {
  const { showSuccess } = useSnackbar();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [touched, setTouched] = useState<Partial<Record<keyof FormState, boolean>>>({});
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const errors: Partial<Record<keyof FormState, string>> = {};
  if (!form.currentPassword) errors.currentPassword = 'Enter your current password';
  if (form.newPassword.length < MIN_LENGTH) errors.newPassword = `Must be at least ${MIN_LENGTH} characters`;
  else if (form.newPassword === form.currentPassword) errors.newPassword = 'New password must differ from the current one';
  if (form.confirmPassword !== form.newPassword) errors.confirmPassword = 'Passwords do not match';
  const isValid = Object.keys(errors).length === 0;

  const set = (key: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
    setServerError(null);
  };
  const blur = (key: keyof FormState) => () => setTouched((t) => ({ ...t, [key]: true }));

  const reset = () => {
    setForm(EMPTY);
    setTouched({});
    setServerError(null);
  };

  const handleClose = () => {
    if (saving) return;
    reset();
    onClose();
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setTouched({ currentPassword: true, newPassword: true, confirmPassword: true });
    if (!isValid || saving) return;
    setSaving(true);
    setServerError(null);
    try {
      await api.post('/auth/change-password', {
        currentPassword: form.currentPassword,
        newPassword: form.newPassword,
      });
      showSuccess('Password changed');
      reset();
      onClose();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string; message?: string } }; message?: string };
      setServerError(
        axiosErr.response?.data?.error || axiosErr.response?.data?.message || axiosErr.message || 'Failed to change password'
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="xs" fullWidth aria-labelledby="change-password-title">
      <form onSubmit={handleSubmit} noValidate>
        <DialogTitle id="change-password-title" sx={{ fontSize: 16, fontWeight: 700 }}>
          Change password
        </DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '8px !important' }}>
          {serverError && <Alert severity="error">{serverError}</Alert>}
          <TextField
            label="Current password"
            type="password"
            autoComplete="current-password"
            value={form.currentPassword}
            onChange={set('currentPassword')}
            onBlur={blur('currentPassword')}
            error={!!touched.currentPassword && !!errors.currentPassword}
            helperText={touched.currentPassword ? errors.currentPassword : ' '}
            fullWidth
            autoFocus
            required
          />
          <TextField
            label="New password"
            type="password"
            autoComplete="new-password"
            value={form.newPassword}
            onChange={set('newPassword')}
            onBlur={blur('newPassword')}
            error={!!touched.newPassword && !!errors.newPassword}
            helperText={touched.newPassword && errors.newPassword ? errors.newPassword : `At least ${MIN_LENGTH} characters`}
            fullWidth
            required
          />
          <TextField
            label="Confirm new password"
            type="password"
            autoComplete="new-password"
            value={form.confirmPassword}
            onChange={set('confirmPassword')}
            onBlur={blur('confirmPassword')}
            error={!!touched.confirmPassword && !!errors.confirmPassword}
            helperText={touched.confirmPassword ? errors.confirmPassword : ' '}
            fullWidth
            required
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={handleClose} disabled={saving} color="inherit">
            Cancel
          </Button>
          <Button
            type="submit"
            variant="contained"
            disabled={saving || (!isValid && Object.keys(touched).length > 0)}
            startIcon={saving ? <CircularProgress size={16} color="inherit" /> : undefined}
          >
            {saving ? 'Saving…' : 'Change password'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
};

export default ChangePasswordDialog;
