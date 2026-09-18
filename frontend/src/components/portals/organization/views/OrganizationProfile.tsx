import React, { useState } from 'react';
import { Box, Typography, Grid, TextField } from '@mui/material';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../../../services/api';
import { useSnackbar } from '../../../../contexts/SnackbarContext';
import logger from '../../../../utils/logger';
import StatCard from '../../../gtacpr/StatCard';
import { PrimaryButton, GhostButton } from '../../../gtacpr/Buttons';

interface OrganizationData {
  id: number;
  name: string;
  contact_email?: string | null;
  contact_phone?: string | null;
  address?: string | null;
  total_courses?: number;
  total_students?: number;
  active_instructors?: number;
}

interface OrganizationProfileProps {
  organizationData: OrganizationData | undefined;
}

interface ProfileForm {
  name: string;
  contact_email: string;
  contact_phone: string;
  address: string;
}

type FormErrors = Partial<Record<keyof ProfileForm, string>>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Optional phone: digits, spaces, dashes, dots, parentheses, leading +; at least 7 digits.
const PHONE_RE = /^\+?[\d\s().-]{7,}$/;

const toForm = (org: OrganizationData | undefined): ProfileForm => ({
  name: org?.name || '',
  contact_email: org?.contact_email || '',
  contact_phone: org?.contact_phone || '',
  address: org?.address || '',
});

const validateProfile = (form: ProfileForm): FormErrors => {
  const errors: FormErrors = {};
  if (!form.name.trim()) errors.name = 'Organization name is required';
  else if (form.name.trim().length > 200) errors.name = 'Organization name must be 200 characters or fewer';
  if (form.contact_email.trim() && !EMAIL_RE.test(form.contact_email.trim())) errors.contact_email = 'Enter a valid email address';
  if (form.contact_phone.trim() && !PHONE_RE.test(form.contact_phone.trim())) errors.contact_phone = 'Enter a valid phone number';
  if (form.address.length > 500) errors.address = 'Address must be 500 characters or fewer';
  return errors;
};

const OrganizationProfile: React.FC<OrganizationProfileProps> = ({ organizationData }) => {
  const queryClient = useQueryClient();
  const { showSuccess, showError } = useSnackbar();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<ProfileForm>(() => toForm(organizationData));
  const [errors, setErrors] = useState<FormErrors>({});

  // While not editing, always show the latest fetched profile; while editing, show the draft.
  const form = editing ? draft : toForm(organizationData);
  const setForm = setDraft;

  const setField = (field: keyof ProfileForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const value = e.target.value;
    setForm((f) => ({ ...f, [field]: value }));
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const handleEdit = () => {
    setForm(toForm(organizationData));
    setErrors({});
    setEditing(true);
  };

  const handleCancel = () => {
    setForm(toForm(organizationData));
    setErrors({});
    setEditing(false);
  };

  const handleSave = async () => {
    const nextErrors = validateProfile(form);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setSaving(true);
    try {
      await api.put('/organization/profile', {
        name: form.name.trim(),
        address: form.address.trim(),
        contactPhone: form.contact_phone.trim(),
        contactEmail: form.contact_email.trim(),
      });
      await queryClient.invalidateQueries({ queryKey: ['organization-data'] });
      showSuccess('Organization profile updated');
      setEditing(false);
    } catch (error: unknown) {
      logger.error('Failed to update organization profile', error);
      const err = error as { response?: { data?: { message?: string; error?: { message?: string } } } };
      showError(err.response?.data?.error?.message || err.response?.data?.message || 'Failed to update organization profile');
    } finally {
      setSaving(false);
    }
  };

  const hasErrors = Object.values(errors).some(Boolean);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' }, gap: 2 }}>
        <StatCard label="Total Courses" value={organizationData?.total_courses || 0} />
        <StatCard label="Total Students" value={organizationData?.total_students || 0} />
        <StatCard label="Active Instructors" value={organizationData?.active_instructors || 0} dotColor="#16A34A" />
      </Box>

      <Grid container spacing={3}>
        <Grid item xs={12} md={8}>
          <Box
            component="form"
            noValidate
            onSubmit={(e: React.FormEvent) => { e.preventDefault(); if (editing && !saving) handleSave(); }}
            sx={{ border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', bgcolor: (theme) => theme.palette.background.paper, p: 3 }}
          >
            <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.07em', mb: 2 }}>
              Organization Information
            </Typography>
            <Grid container spacing={2}>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Organization Name"
                  name="name"
                  value={form.name}
                  onChange={setField('name')}
                  size="small"
                  required={editing}
                  InputProps={{ readOnly: !editing }}
                  disabled={saving}
                  error={!!errors.name}
                  helperText={errors.name}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Contact Email"
                  name="contact_email"
                  type="email"
                  value={form.contact_email}
                  onChange={setField('contact_email')}
                  size="small"
                  InputProps={{ readOnly: !editing }}
                  disabled={saving}
                  error={!!errors.contact_email}
                  helperText={errors.contact_email}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Contact Phone"
                  name="contact_phone"
                  type="tel"
                  value={form.contact_phone}
                  onChange={setField('contact_phone')}
                  size="small"
                  InputProps={{ readOnly: !editing }}
                  disabled={saving}
                  error={!!errors.contact_phone}
                  helperText={errors.contact_phone}
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Address"
                  name="address"
                  value={form.address}
                  onChange={setField('address')}
                  size="small"
                  multiline
                  rows={3}
                  InputProps={{ readOnly: !editing }}
                  disabled={saving}
                  error={!!errors.address}
                  helperText={errors.address}
                />
              </Grid>
            </Grid>
            <Box sx={{ mt: 3, display: 'flex', gap: 2 }}>
              {editing ? (
                <>
                  <PrimaryButton type="submit" disabled={saving || hasErrors}>
                    {saving ? 'Saving...' : 'Save Changes'}
                  </PrimaryButton>
                  <GhostButton type="button" onClick={handleCancel} disabled={saving}>Cancel</GhostButton>
                </>
              ) : (
                <PrimaryButton type="button" onClick={handleEdit} disabled={!organizationData}>Edit Profile</PrimaryButton>
              )}
            </Box>
          </Box>
        </Grid>

        <Grid item xs={12} md={4}>
          <Box sx={{ border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', bgcolor: (theme) => theme.palette.background.paper, p: 3 }}>
            <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.07em', mb: 2 }}>
              Contact Information
            </Typography>
            {[
              ['Email', organizationData?.contact_email || 'N/A'],
              ['Phone', organizationData?.contact_phone || 'N/A'],
              ['Address', organizationData?.address || 'N/A'],
            ].map(([label, value]) => (
              <Box key={String(label)} sx={{ mb: 2 }}>
                <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.text.secondary, mb: 0.25 }}>{label}</Typography>
                <Typography sx={{ fontSize: 13, fontWeight: 600, color: (theme) => theme.palette.text.primary, whiteSpace: 'pre-line' }}>{value}</Typography>
              </Box>
            ))}
          </Box>
        </Grid>
      </Grid>
    </Box>
  );
};

export default OrganizationProfile;
