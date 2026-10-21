import React, { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Typography,
  Card,
  TextField,
  Grid,
  Alert,
  CircularProgress,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
} from '@mui/material';
import api from '../../../services/api';
import { useSnackbar } from '../../../contexts/SnackbarContext';
import { getErrorMessage } from '../../../utils/errorMessage';
import { PrimaryButton, GhostButton } from '../../gtacpr/Buttons';

/**
 * Field names are the real `vendors` columns (see backend/src/routes/vendors.ts
 * updateProfileSchema), which the staff vendor screens read too. The table has
 * one contact name and one free-text address, not split fields.
 */
interface VendorProfileForm {
  name: string;
  contact_name: string;
  contact_phone: string;
  address: string;
  vendor_type: string;
}

const EMPTY: VendorProfileForm = {
  name: '',
  contact_name: '',
  contact_phone: '',
  address: '',
  vendor_type: '',
};

const VENDOR_TYPES = [
  { value: 'supplier', label: 'Supplier' },
  { value: 'serviceProvider', label: 'Service Provider' },
  { value: 'consultant', label: 'Consultant' },
  { value: 'contractor', label: 'Contractor' },
  { value: 'other', label: 'Other' },
];

const str = (v: unknown) => (v == null ? '' : String(v));

/** GET /vendor/profile returns the raw vendors row; map it onto the editable form. */
const toForm = (row: Record<string, unknown> | null | undefined): VendorProfileForm => ({
  name: str(row?.name),
  contact_name: str(row?.contact_name),
  contact_phone: str(row?.contact_phone),
  address: str(row?.address),
  vendor_type: str(row?.vendor_type),
});

const VendorProfile: React.FC = () => {
  const { showSuccess, showError } = useSnackbar();
  const [profile, setProfile] = useState<VendorProfileForm>(EMPTY);
  const [contactEmail, setContactEmail] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchProfile = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get('/vendor/profile');
      const row = res.data?.data ?? res.data;
      setProfile(toForm(row));
      setContactEmail(str(row?.contact_email));
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to load profile'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchProfile(); }, [fetchProfile]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setProfile(prev => ({ ...prev, [name]: value }));
  };

  const handleSelectChange = (e: { target: { name: string; value: string } }) => {
    const { name, value } = e.target;
    setProfile(prev => ({ ...prev, [name]: value }));
  };

  const nameValid = profile.name.trim().length > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving || !nameValid) return;
    setSaving(true);
    try {
      await api.put('/vendor/profile', {
        ...profile,
        name: profile.name.trim(),
      });
      showSuccess('Profile updated');
    } catch (err) {
      showError(getErrorMessage(err, 'Failed to update profile. Please try again.'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400 }}>
        <CircularProgress size={48} aria-label="Loading profile" />
      </Box>
    );
  }

  if (error) {
    return (
      <Alert severity="error" action={<GhostButton onClick={fetchProfile}>Retry</GhostButton>}>
        {error}
      </Alert>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '24px', maxWidth: 800 }}>
      <Card sx={{ border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', boxShadow: '0 1px 3px rgba(0,0,0,.05)', p: 3 }}>
        <form onSubmit={handleSubmit} noValidate>
          <Grid container spacing={3}>
            <Grid item xs={12}>
              <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                Company Information
              </Typography>
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="Company Name"
                name="name"
                value={profile.name}
                onChange={handleInputChange}
                required
                error={!nameValid}
                helperText={!nameValid ? 'Company name is required' : ' '}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <FormControl fullWidth>
                <InputLabel id="vendor-type-label">Vendor Type</InputLabel>
                <Select labelId="vendor-type-label" name="vendor_type" value={profile.vendor_type} onChange={handleSelectChange} label="Vendor Type">
                  {/* Staff can set any vendor_type; keep a value outside the list selectable. */}
                  {profile.vendor_type && !VENDOR_TYPES.some(t => t.value === profile.vendor_type) && (
                    <MenuItem value={profile.vendor_type}>{profile.vendor_type}</MenuItem>
                  )}
                  {VENDOR_TYPES.map(t => <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>)}
                </Select>
              </FormControl>
            </Grid>

            <Grid item xs={12}>
              <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.07em', mt: 1 }}>
                Contact Information
              </Typography>
            </Grid>
            <Grid item xs={12}>
              <TextField fullWidth label="Contact Name" name="contact_name" value={profile.contact_name} onChange={handleInputChange} inputProps={{ maxLength: 255 }} />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="Contact Email"
                value={contactEmail}
                disabled
                helperText="Your login email identifies this vendor account and cannot be changed here"
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField fullWidth label="Contact Phone" name="contact_phone" type="tel" value={profile.contact_phone} onChange={handleInputChange} inputProps={{ maxLength: 20 }} />
            </Grid>

            <Grid item xs={12}>
              <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.07em', mt: 1 }}>
                Address
              </Typography>
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                multiline
                minRows={2}
                label="Address"
                name="address"
                value={profile.address}
                onChange={handleInputChange}
                placeholder="Street, city, province, postal code"
              />
            </Grid>

            <Grid item xs={12}>
              <PrimaryButton type="submit" disabled={saving || !nameValid}>
                {saving ? 'Saving…' : 'Save Profile'}
              </PrimaryButton>
            </Grid>
          </Grid>
        </form>
      </Card>
    </Box>
  );
};

export default VendorProfile;
