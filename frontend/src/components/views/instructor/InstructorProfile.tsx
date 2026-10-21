import React, { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Typography,
  Grid,
  Card,
  Alert,
  TextField,
  CircularProgress,
} from '@mui/material';
import { useToast } from '../../../contexts/ToastContext';
import api from '../../../services/api';
import UserAvatar from '../../gtacpr/UserAvatar';
import StatusChip from '../../gtacpr/StatusChip';
import { PrimaryButton, GhostButton } from '../../gtacpr/Buttons';
import ChangePasswordDialog from '../../common/ChangePasswordDialog';
import { formatDisplayDate } from '../../../utils/formatters';

/** Shape of GET /instructor/profile (backend/src/routes/instructors.ts). */
interface InstructorProfileData {
  id: number;
  username: string;
  email: string;
  phone: string | null;
  first_name: string | null;
  last_name: string | null;
  role: string;
  created_at: string;
  total_classes: number;
  total_students: number;
}

// Email notification toggles were removed 2026-10-21: the instructor types
// (timesheet_submitted, timesheet_approved, payment_verified) were saved but no
// email path reads them, so the switches did nothing. course_status_change is
// only read for organization admins. Add a toggle back here when an instructor
// email actually checks its preference.

interface EditState {
  email: string;
  phone: string;
}

const cardSx = {
  border: (theme: { palette: { divider: string } }) => `1px solid ${theme.palette.divider}`,
  borderRadius: '10px',
  boxShadow: '0 1px 3px rgba(0,0,0,.05)',
  p: 3,
};

const sectionTitleSx = {
  fontSize: 13,
  fontWeight: 700,
  color: (theme: { palette: { text: { secondary: string } } }) => theme.palette.text.secondary,
  textTransform: 'uppercase' as const,
  letterSpacing: '0.07em',
};

const errorText = (err: unknown, fallback: string) => {
  const axiosErr = err as { response?: { data?: { error?: string; message?: string } } };
  return axiosErr.response?.data?.error || axiosErr.response?.data?.message || fallback;
};

const InstructorProfile: React.FC = () => {
  const { success, error: toastError } = useToast();

  const [profile, setProfile] = useState<InstructorProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState<EditState>({ email: '', phone: '' });
  const [saving, setSaving] = useState(false);

  const [passwordOpen, setPasswordOpen] = useState(false);
  const [downloadingData, setDownloadingData] = useState(false);

  const loadProfile = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await api.get('/instructor/profile');
      const data: InstructorProfileData = res.data?.data ?? res.data;
      setProfile(data);
    } catch (err) {
      setLoadError(errorText(err, 'Failed to load your profile'));
    } finally {
      setLoading(false);
    }
  }, []);

  // Data fetch on mount — the standard fetch-on-mount pattern, not state derived
  // from render.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadProfile();
  }, [loadProfile]);

  const displayName = profile
    ? [profile.first_name, profile.last_name].filter(Boolean).join(' ') || profile.username
    : '';

  const initials = (() => {
    if (!profile) return '';
    const first = profile.first_name?.charAt(0) || profile.username?.charAt(0) || '';
    const last = profile.last_name?.charAt(0) || '';
    return `${first}${last}`.toUpperCase();
  })();

  const handleEdit = () => {
    if (!profile) return;
    setEditData({ email: profile.email || '', phone: profile.phone || '' });
    setIsEditing(true);
  };

  const handleCancel = () => setIsEditing(false);

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(editData.email.trim());

  const handleSave = async () => {
    if (saving || !emailValid) return;
    setSaving(true);
    try {
      const res = await api.put('/instructor/profile', {
        email: editData.email.trim(),
        phone: editData.phone.trim(),
      });
      const updated = res.data?.data ?? {};
      setProfile((p) => (p ? { ...p, ...updated } : p));
      setIsEditing(false);
      success('Profile updated', { title: 'Profile Saved', context: 'profile_update' });
    } catch (err) {
      toastError(errorText(err, 'Failed to save profile'));
    } finally {
      setSaving(false);
    }
  };

  const handleDownloadMyData = async () => {
    setDownloadingData(true);
    try {
      const response = await api.get('/auth/my-data');
      const json = JSON.stringify(response.data?.data ?? response.data, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'my-data.json';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toastError(errorText(err, 'Failed to download data. Please try again.'));
    } finally {
      setDownloadingData(false);
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 300 }}>
        <CircularProgress size={40} aria-label="Loading profile" />
      </Box>
    );
  }

  if (loadError || !profile) {
    return (
      <Alert
        severity="error"
        action={<GhostButton onClick={loadProfile}>Retry</GhostButton>}
      >
        {loadError || 'Profile not available'}
      </Alert>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <Grid container spacing={3}>
        {/* Profile Overview Card */}
        <Grid item xs={12} md={4}>
          <Card sx={{ ...cardSx, textAlign: 'center' }}>
            <UserAvatar initials={initials} size={80} />
            <Typography sx={{ fontSize: 20, fontWeight: 700, color: (theme) => theme.palette.text.primary, mt: 2 }}>
              {displayName}
            </Typography>
            <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary, mb: 1 }}>CPR Instructor</Typography>
            <StatusChip kind="active" label="Active" />

            <Box sx={{ borderTop: (theme) => `1px solid ${theme.palette.divider}`, mt: 3, pt: 3, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
              <Box>
                <Typography sx={{ fontSize: 20, fontWeight: 700, color: '#CC1F1F' }}>{Number(profile.total_classes) || 0}</Typography>
                <Typography sx={{ fontSize: 11, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase' }}>Classes Taught</Typography>
              </Box>
              <Box>
                <Typography sx={{ fontSize: 20, fontWeight: 700, color: '#CC1F1F' }}>{Number(profile.total_students) || 0}</Typography>
                <Typography sx={{ fontSize: 11, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase' }}>Students Trained</Typography>
              </Box>
            </Box>
          </Card>
        </Grid>

        {/* Profile Details */}
        <Grid item xs={12} md={8}>
          <Card sx={cardSx}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
              <Typography sx={sectionTitleSx}>Profile Information</Typography>
              {!isEditing ? (
                <GhostButton onClick={handleEdit}>Edit Profile</GhostButton>
              ) : (
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <PrimaryButton onClick={handleSave} disabled={saving || !emailValid}>
                    {saving ? 'Saving…' : 'Save'}
                  </PrimaryButton>
                  <GhostButton onClick={handleCancel} disabled={saving}>Cancel</GhostButton>
                </Box>
              )}
            </Box>

            {isEditing ? (
              <Grid container spacing={2}>
                <Grid item xs={12} sm={6}>
                  <TextField fullWidth label="Username" value={profile.username} disabled helperText="Contact an administrator to change your name" />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth
                    label="Email"
                    type="email"
                    value={editData.email}
                    onChange={(e) => setEditData({ ...editData, email: e.target.value })}
                    error={!emailValid}
                    helperText={!emailValid ? 'Enter a valid email address' : ' '}
                    required
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth
                    label="Phone"
                    type="tel"
                    value={editData.phone}
                    onChange={(e) => setEditData({ ...editData, phone: e.target.value })}
                  />
                </Grid>
              </Grid>
            ) : (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {[
                  ['Full Name', displayName],
                  ['Username', profile.username],
                  ['Email', profile.email || '—'],
                  ['Phone', profile.phone || '—'],
                  ['Member Since', formatDisplayDate(profile.created_at)],
                ].map(([label, value]) => (
                  <Box key={label} sx={{ display: 'flex', borderBottom: (theme) => `1px solid ${theme.palette.divider}`, pb: 1.5 }}>
                    <Typography sx={{ fontSize: 13, fontWeight: 600, color: (theme) => theme.palette.text.secondary, width: 140 }}>{label}</Typography>
                    <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.primary }}>{value}</Typography>
                  </Box>
                ))}
              </Box>
            )}
          </Card>
        </Grid>

        {/* Security Settings */}
        <Grid item xs={12} md={6}>
          <Card sx={cardSx}>
            <Typography sx={{ ...sectionTitleSx, mb: 2 }}>Security &amp; Data</Typography>
            <Alert severity="info" sx={{ mb: 2 }}>
              Keep your account secure by updating your password regularly.
            </Alert>
            <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
              <GhostButton onClick={() => setPasswordOpen(true)}>Change Password</GhostButton>
              <GhostButton onClick={handleDownloadMyData} disabled={downloadingData}>
                {downloadingData ? 'Downloading…' : 'Download My Data'}
              </GhostButton>
            </Box>
          </Card>
        </Grid>
      </Grid>

      <ChangePasswordDialog open={passwordOpen} onClose={() => setPasswordOpen(false)} />
    </Box>
  );
};

export default InstructorProfile;
