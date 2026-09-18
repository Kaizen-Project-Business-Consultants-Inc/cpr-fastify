import React, { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Typography,
  Grid,
  Card,
  Alert,
  TextField,
  Switch,
  FormControlLabel,
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

/** One row of GET /notifications/preferences. */
interface NotificationPreference {
  notification_type: string;
  email_enabled: boolean | number;
  push_enabled: boolean | number;
  sound_enabled: boolean | number;
}

/** Notification types the instructor cares about (must match backend validNotificationTypes). */
const INSTRUCTOR_NOTIFICATION_TYPES: { type: string; label: string; description: string }[] = [
  { type: 'timesheet_submitted', label: 'Timesheet submitted', description: 'Confirmation when a timesheet is received' },
  { type: 'timesheet_approved', label: 'Timesheet approved', description: 'When HR approves one of your timesheets' },
  { type: 'payment_verified', label: 'Payment verified', description: 'When a payment to you has been verified' },
];

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

  const [preferences, setPreferences] = useState<Record<string, boolean>>({});
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const [prefSaving, setPrefSaving] = useState<string | null>(null);

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

  const loadPreferences = useCallback(async () => {
    try {
      const res = await api.get('/notifications/preferences');
      const rows: NotificationPreference[] = res.data?.data ?? res.data ?? [];
      const next: Record<string, boolean> = {};
      INSTRUCTOR_NOTIFICATION_TYPES.forEach(({ type }) => {
        const row = rows.find((r) => r.notification_type === type);
        // No row yet means the backend default (enabled).
        next[type] = row ? Boolean(row.email_enabled) : true;
      });
      setPreferences(next);
    } catch {
      // Preferences are secondary; leave the section in its "unavailable" state.
      setPreferences({});
    } finally {
      setPrefsLoaded(true);
    }
  }, []);

  // Data fetch on mount — the standard fetch-on-mount pattern, not state derived
  // from render.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadProfile();
    loadPreferences();
  }, [loadProfile, loadPreferences]);

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

  const handlePreferenceToggle = async (type: string) => {
    if (prefSaving) return;
    const next = !preferences[type];
    setPrefSaving(type);
    try {
      await api.put(`/notifications/preferences/${type}`, { email_enabled: next });
      setPreferences((p) => ({ ...p, [type]: next }));
    } catch (err) {
      toastError(errorText(err, 'Failed to update notification preference'));
    } finally {
      setPrefSaving(null);
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

        {/* Notification Settings */}
        <Grid item xs={12} md={6}>
          <Card sx={cardSx}>
            <Typography sx={{ ...sectionTitleSx, mb: 2 }}>Email Notifications</Typography>
            {!prefsLoaded ? (
              <CircularProgress size={20} aria-label="Loading notification preferences" />
            ) : Object.keys(preferences).length === 0 ? (
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
                Notification preferences are not available right now.
              </Typography>
            ) : (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {INSTRUCTOR_NOTIFICATION_TYPES.map(({ type, label, description }) => (
                  <Box key={type} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2 }}>
                    <Box>
                      <Typography sx={{ fontSize: 13, fontWeight: 600, color: (theme) => theme.palette.text.primary }}>{label}</Typography>
                      <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.text.secondary }}>{description}</Typography>
                    </Box>
                    <FormControlLabel
                      sx={{ m: 0 }}
                      label=""
                      control={
                        <Switch
                          checked={!!preferences[type]}
                          disabled={prefSaving === type}
                          onChange={() => handlePreferenceToggle(type)}
                          inputProps={{ 'aria-label': `${label} email notifications` }}
                        />
                      }
                    />
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
