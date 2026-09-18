import React, { useState, useEffect } from 'react';
import * as api from '../../services/api';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Grid,
  Alert,
  CircularProgress,
  Typography,
  Divider,
  Box,
  List,
  ListItem,
  ListItemText,
  IconButton,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import { useConfirm } from '../gtacpr/ConfirmDialog';
import DeleteIcon from '@mui/icons-material/Delete';
// Phone Input Libraries
import PhoneInput from 'react-phone-number-input';
import 'react-phone-number-input/style.css'; // Import default styles
import { getErrorMessage } from '../../utils/errorMessage';

interface OrganizationLocation {
  id: number;
  name?: string;
  locationName?: string;
  address?: string;
  city?: string;
  province?: string;
}

interface Organization {
  id?: number;
  organizationId?: number;
  organizationName?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  addressStreet?: string;
  addressCity?: string;
  addressProvince?: string;
  addressPostalCode?: string;
  ceoName?: string;
  ceoPhone?: string;
  ceoEmail?: string;
}

// Initial empty state for a new organization
const initialOrgState = {
  organizationName: '',
  contactName: '',
  contactEmail: '',
  contactPhone: '', // Store as E.164
  addressStreet: '',
  addressCity: '',
  addressProvince: '',
  addressPostalCode: '',
  ceoName: '',
  ceoPhone: '', // Store as E.164
  ceoEmail: '',
};

interface OrganizationDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: () => void;
  organization: Organization | null;
}

function OrganizationDialog({ open, onClose, onSave, organization }: OrganizationDialogProps) {
  const [orgData, setOrgData] = useState(initialOrgState);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | boolean>>({}); // State for field-specific errors
  const { confirm, dialog: confirmDialog } = useConfirm();
  const isEditMode = Boolean(organization?.id || organization?.organizationId);

  // Locations state
  const [locations, setLocations] = useState<OrganizationLocation[]>([]);
  const [locationsLoading, setLocationsLoading] = useState(false);
  const [showAddLocation, setShowAddLocation] = useState(false);
  const [newLocationName, setNewLocationName] = useState('');

  useEffect(() => {
    // Populate form if editing, otherwise reset
    if (isEditMode && organization) {
      // Map incoming data to state (backend returns camelCase via keysToCamel)
      setOrgData({
        organizationName: organization.organizationName || '',
        contactName: organization.contactName || '',
        contactEmail: organization.contactEmail || '',
        contactPhone: organization.contactPhone || '', // Already E.164 from DB
        addressStreet: organization.addressStreet || '',
        addressCity: organization.addressCity || '',
        addressProvince: organization.addressProvince || '',
        addressPostalCode: organization.addressPostalCode || '',
        ceoName: organization.ceoName || '',
        ceoPhone: organization.ceoPhone || '', // Already E.164 from DB
        ceoEmail: organization.ceoEmail || '',
      });
    } else {
      setOrgData(initialOrgState);
    }
    setError(''); // Clear general error
    setFieldErrors({}); // Clear field errors when dialog opens/org changes
    setLocations([]);
    setShowAddLocation(false);
    setNewLocationName('');
  }, [organization, isEditMode, open]);

  // Fetch locations when editing
  useEffect(() => {
    const fetchLocations = async () => {
      const orgId = organization?.id || organization?.organizationId;
      if (!isEditMode || !orgId || !open) return;

      setLocationsLoading(true);
      try {
        const data = await api.getOrganizationLocations(orgId);
        setLocations(data || []);
      } catch (err) {
        console.error('Failed to load locations:', err);
      } finally {
        setLocationsLoading(false);
      }
    };
    fetchLocations();
  }, [organization, isEditMode, open]);

  const handleAddLocation = async () => {
    const orgId = organization?.id || organization?.organizationId;
    if (!orgId || !newLocationName.trim()) return;

    try {
      await api.createOrganizationLocation(orgId, { locationName: newLocationName });
      const data = await api.getOrganizationLocations(orgId);
      setLocations(data || []);
      setNewLocationName('');
      setShowAddLocation(false);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to add location'));
    }
  };

  const handleDeleteLocation = async (locationId: number) => {
    const orgId = organization?.id || organization?.organizationId;
    if (!orgId) return;
    const loc = locations.find((l) => l.id === locationId);
    const ok = await confirm({
      title: 'Delete location?',
      message: `${loc?.name || 'This location'} will be removed from ${orgData.organizationName || 'this organization'}. This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;

    try {
      await api.deleteOrganizationLocation(orgId, locationId);
      const data = await api.getOrganizationLocations(orgId);
      setLocations(data || []);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to delete location'));
    }
  };

  // Handles both TextField changes and PhoneInput changes
  const handleChange = (name: string, value: string) => {
    setOrgData(prevData => ({
      ...prevData,
      [name]: value,
    }));
    // Clear specific field error on change
    if (fieldErrors[name]) {
      setFieldErrors(prev => ({ ...prev, [name]: false }));
    }
    // Clear general error message when user starts typing
    if (error) {
      setError('');
    }
  };

  const handleSave = async () => {
    setError('');
    setFieldErrors({});
    const newFieldErrors: Record<string, string> = {};

    // Client-side validation
    if (!orgData.organizationName)
      newFieldErrors.organizationName = 'Organization Name required';
    if (!orgData.contactName)
      newFieldErrors.contactName = 'Contact Name required';
    if (!orgData.contactEmail)
      newFieldErrors.contactEmail = 'Contact Email required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(orgData.contactEmail))
      newFieldErrors.contactEmail = 'Enter a valid email address';
    if (orgData.ceoEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(orgData.ceoEmail))
      newFieldErrors.ceoEmail = 'Enter a valid email address';
    if (!orgData.contactPhone)
      newFieldErrors.contactPhone = 'Contact Phone required';

    if (Object.keys(newFieldErrors).length > 0) {
      setError('Please fix highlighted field(s).');
      setFieldErrors(newFieldErrors);
      return;
    }

    setLoading(true);
    try {
      if (isEditMode) {
        const orgId = organization?.id ?? organization?.organizationId;
        if (orgId === undefined) throw new Error('Missing organization id');
        await api.updateOrganization(orgId, orgData);
      } else {
        await api.addOrganization(orgData);
      }
      onSave();
      onClose();
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to save organization'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
    <Dialog open={open} onClose={onClose} maxWidth='md' fullWidth>
      <DialogTitle>
        {isEditMode ? 'Edit Organization' : 'Add New Organization'}
      </DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity='error' sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <Grid container spacing={2} sx={{ mt: 1 }}>
          {/* Organization Details */}
          <Grid xs={12} sm={12}>
            <TextField
              name='organizationName'
              label='Organization Name *'
              value={orgData.organizationName}
              onChange={e => handleChange('organizationName', e.target.value)}
              fullWidth
              required
              error={Boolean(fieldErrors.organizationName)}
              helperText={fieldErrors.organizationName || ''}
            />
          </Grid>
          {/* Address */}
          <Grid xs={12}>
            <TextField
              name='addressStreet'
              label='Street Address'
              value={orgData.addressStreet}
              onChange={e => handleChange('addressStreet', e.target.value)}
              fullWidth
            />
          </Grid>
          <Grid xs={12} sm={4}>
            <TextField
              name='addressCity'
              label='City'
              value={orgData.addressCity}
              onChange={e => handleChange('addressCity', e.target.value)}
              fullWidth
            />
          </Grid>
          <Grid xs={12} sm={4}>
            <TextField
              name='addressProvince'
              label='Province'
              value={orgData.addressProvince}
              onChange={e => handleChange('addressProvince', e.target.value)}
              fullWidth
            />
          </Grid>
          <Grid xs={12} sm={4}>
            <TextField
              name='addressPostalCode'
              label='Postal Code'
              value={orgData.addressPostalCode}
              onChange={e =>
                handleChange('addressPostalCode', e.target.value)
              }
              fullWidth
            />
          </Grid>
          {/* Contact Person */}
          <Grid xs={12} sm={6}>
            <TextField
              name='contactName'
              label='Contact Name *'
              value={orgData.contactName}
              onChange={e => handleChange('contactName', e.target.value)}
              fullWidth
              error={Boolean(fieldErrors.contactName)}
              helperText={fieldErrors.contactName || ''}
            />
          </Grid>
          <Grid xs={12} sm={6}>
            <PhoneInput
              placeholder='Enter contact phone'
              value={orgData.contactPhone}
              onChange={value => handleChange('contactPhone', value || '')}
              defaultCountry='CA'
              international
              countryCallingCodeEditable={false}
              limitMaxLength
              style={{ marginBottom: '0px' }}
              className={fieldErrors.contactPhone ? 'phone-input-error' : ''}
            />
            {fieldErrors.contactPhone && (
              <Typography color='error' variant='caption'>
                {fieldErrors.contactPhone}
              </Typography>
            )}
          </Grid>
          <Grid xs={12} sm={12}>
            <TextField
              name='contactEmail'
              label='Contact Email *'
              value={orgData.contactEmail}
              type='email'
              onChange={e => handleChange('contactEmail', e.target.value)}
              fullWidth
              error={Boolean(fieldErrors.contactEmail)}
              helperText={fieldErrors.contactEmail || ''}
            />
          </Grid>
          {/* CEO Details */}
          <Grid xs={12} sm={6}>
            <TextField
              name='ceoName'
              label='CEO Name'
              value={orgData.ceoName}
              onChange={e => handleChange('ceoName', e.target.value)}
              fullWidth
            />
          </Grid>
          <Grid xs={12} sm={6}>
            <PhoneInput
              placeholder='Enter CEO phone'
              value={orgData.ceoPhone}
              onChange={value => handleChange('ceoPhone', value || '')}
              defaultCountry='CA'
              international
              countryCallingCodeEditable={false}
              limitMaxLength
              style={{ marginBottom: '0px' }}
              className={fieldErrors.ceoPhone ? 'phone-input-error' : ''}
            />
            {fieldErrors.ceoPhone && (
              <Typography color='error' variant='caption'>
                {fieldErrors.ceoPhone}
              </Typography>
            )}
          </Grid>
          <Grid xs={12} sm={12}>
            <TextField
              name='ceoEmail'
              label='CEO Email'
              value={orgData.ceoEmail}
              type='email'
              onChange={e => handleChange('ceoEmail', e.target.value)}
              fullWidth
              error={Boolean(fieldErrors.ceoEmail)}
              helperText={fieldErrors.ceoEmail || ''}
            />
          </Grid>
        </Grid>

        {/* Locations Section - only when editing */}
        {isEditMode && (
          <Box sx={{ mt: 3 }}>
            <Divider />
            <Typography variant='h6' sx={{ mt: 2, mb: 1 }}>
              Locations ({locations.length})
            </Typography>

            {locationsLoading ? (
              <CircularProgress size={20} />
            ) : (
              <>
                <List dense>
                  {locations.map((loc) => (
                    <ListItem
                      key={loc.id}
                      secondaryAction={
                        <IconButton edge='end' size='small' aria-label={`Delete location ${loc.name}`} onClick={() => handleDeleteLocation(loc.id)}>
                          <DeleteIcon fontSize='small' />
                        </IconButton>
                      }
                    >
                      <ListItemText
                        primary={loc.locationName}
                        secondary={[loc.address, loc.city, loc.province].filter(Boolean).join(', ') || 'No address'}
                      />
                    </ListItem>
                  ))}
                </List>

                {showAddLocation ? (
                  <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
                    <TextField
                      size='small'
                      label='Location Name'
                      value={newLocationName}
                      onChange={(e) => setNewLocationName(e.target.value)}
                      sx={{ flex: 1 }}
                    />
                    <Button size='small' variant='contained' onClick={handleAddLocation}>
                      Add
                    </Button>
                    <Button size='small' onClick={() => setShowAddLocation(false)}>
                      Cancel
                    </Button>
                  </Box>
                ) : (
                  <Button size='small' startIcon={<AddIcon />} onClick={() => setShowAddLocation(true)}>
                    Add Location
                  </Button>
                )}
              </>
            )}
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ p: '16px 24px' }}>
        <Button onClick={onClose} disabled={loading}>
          Cancel
        </Button>
        <Button onClick={handleSave} variant='contained' disabled={loading}>
          {loading ? (
            <CircularProgress size={24} />
          ) : isEditMode ? (
            'Save Changes'
          ) : (
            'Add Organization'
          )}
        </Button>
      </DialogActions>
    </Dialog>
    {confirmDialog}
    </>
  );
}

export default OrganizationDialog;
