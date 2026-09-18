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
import { PrimaryButton, GhostButton } from '../../gtacpr/Buttons';

/** Field names match backend/src/routes/vendors.ts updateProfileSchema. */
interface VendorProfileForm {
  vendor_name: string;
  contact_first_name: string;
  contact_last_name: string;
  phone: string;
  address_street: string;
  address_city: string;
  address_province: string;
  address_postal_code: string;
  vendor_type: string;
}

const EMPTY: VendorProfileForm = {
  vendor_name: '',
  contact_first_name: '',
  contact_last_name: '',
  phone: '',
  address_street: '',
  address_city: '',
  address_province: '',
  address_postal_code: '',
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
  vendor_name: str(row?.vendor_name ?? row?.name),
  contact_first_name: str(row?.contact_first_name),
  contact_last_name: str(row?.contact_last_name),
  phone: str(row?.phone ?? row?.contact_phone),
  address_street: str(row?.address_street),
  address_city: str(row?.address_city),
  address_province: str(row?.address_province),
  address_postal_code: str(row?.address_postal_code),
  vendor_type: str(row?.vendor_type),
});

const errorText = (err: unknown, fallback: string) => {
  const axiosErr = err as { response?: { data?: { error?: string; message?: string } } };
  return axiosErr.response?.data?.error || axiosErr.response?.data?.message || fallback;
};

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
      setError(errorText(err, 'Failed to load profile'));
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

  const nameValid = profile.vendor_name.trim().length > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving || !nameValid) return;
    setSaving(true);
    try {
      await api.put('/vendor/profile', {
        ...profile,
        vendor_name: profile.vendor_name.trim(),
      });
      showSuccess('Profile updated');
    } catch (err) {
      showError(errorText(err, 'Failed to update profile. Please try again.'));
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
                name="vendor_name"
                value={profile.vendor_name}
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
                  {VENDOR_TYPES.map(t => <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>)}
                </Select>
              </FormControl>
            </Grid>

            <Grid item xs={12}>
              <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.07em', mt: 1 }}>
                Contact Information
              </Typography>
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField fullWidth label="Contact First Name" name="contact_first_name" value={profile.contact_first_name} onChange={handleInputChange} />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField fullWidth label="Contact Last Name" name="contact_last_name" value={profile.contact_last_name} onChange={handleInputChange} />
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
              <TextField fullWidth label="Contact Phone" name="phone" type="tel" value={profile.phone} onChange={handleInputChange} />
            </Grid>

            <Grid item xs={12}>
              <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.07em', mt: 1 }}>
                Address
              </Typography>
            </Grid>
            <Grid item xs={12}>
              <TextField fullWidth label="Street" name="address_street" value={profile.address_street} onChange={handleInputChange} />
            </Grid>
            <Grid item xs={12} md={5}>
              <TextField fullWidth label="City" name="address_city" value={profile.address_city} onChange={handleInputChange} />
            </Grid>
            <Grid item xs={6} md={3}>
              <TextField fullWidth label="Province" name="address_province" value={profile.address_province} onChange={handleInputChange} />
            </Grid>
            <Grid item xs={6} md={4}>
              <TextField fullWidth label="Postal Code" name="address_postal_code" value={profile.address_postal_code} onChange={handleInputChange} />
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
