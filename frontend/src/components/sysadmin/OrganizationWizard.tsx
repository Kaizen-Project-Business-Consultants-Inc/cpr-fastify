import React, { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Stepper,
  Step,
  StepLabel,
  TextField,
  Grid,
  MenuItem,
  Box,
  Alert,
  Typography,
} from '@mui/material';
import { sysAdminApi } from '../../services/api';
import { useConfirm } from '../gtacpr';
import { useSnackbar } from '../../contexts/SnackbarContext';

interface OrganizationWizardProps {
  open: boolean;
  onClose: () => void;
  onComplete: () => void;
}

const steps = ['Organization Details', 'Add Location'];

const OrganizationWizard: React.FC<OrganizationWizardProps> = ({
  open,
  onClose,
  onComplete,
}) => {
  const [activeStep, setActiveStep] = useState(0);
  const [error, setError] = useState('');
  const [createdOrgId, setCreatedOrgId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const { confirm, dialog: confirmDialog } = useConfirm();
  const { showInfo } = useSnackbar();

  // Organization form data
  const [orgData, setOrgData] = useState({
    name: '',
    contactPerson: '',
    contactPosition: 'Manager',
    contactEmail: '',
    contactPhone: '',
    address: '',
    city: '',
    province: '',
    postalCode: '',
    country: 'Canada',
    organizationComments: '',
  });

  // Location form data
  const [locationData, setLocationData] = useState({
    locationName: '',
    contactFirstName: '',
    contactLastName: '',
    contactEmail: '',
    contactPhone: '',
    address: '',
    city: '',
    province: '',
    postalCode: '',
  });

  const positions = ['Owner', 'Manager', 'Director', 'Administrator', 'Other'];

  const handleOrgChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setOrgData(prev => ({ ...prev, [name]: value }));
  };

  const handleLocationChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setLocationData(prev => ({ ...prev, [name]: value }));
  };

  const handleNext = async () => {
    if (saving) return;
    setError('');

    if (activeStep === 0) {
      // Validate and create organization
      if (!orgData.name.trim()) {
        setError('Organization name is required');
        return;
      }

      try {
        setSaving(true);
        const response = await sysAdminApi.createOrganization(orgData);
        setCreatedOrgId(response.data.id);

        // Pre-fill location with org contact info if available
        if (orgData.contactPerson) {
          const nameParts = orgData.contactPerson.trim().split(' ');
          setLocationData(prev => ({
            ...prev,
            contactFirstName: nameParts[0] || '',
            contactLastName: nameParts.slice(1).join(' ') || '',
            contactEmail: orgData.contactEmail || '',
            contactPhone: orgData.contactPhone || '',
            address: orgData.address || '',
            city: orgData.city || '',
            province: orgData.province || '',
            postalCode: orgData.postalCode || '',
          }));
        }

        setActiveStep(1);
      } catch (err: any) {
        setError(err.response?.data?.error?.message || 'Failed to create organization');
      } finally {
        setSaving(false);
      }
    } else if (activeStep === 1) {
      // Validate and create location
      if (!locationData.locationName.trim()) {
        setError('Location name is required');
        return;
      }

      if (!createdOrgId) {
        setError('Organization not created properly');
        return;
      }

      try {
        setSaving(true);
        await sysAdminApi.createOrganizationLocation(createdOrgId, locationData);
        handleComplete();
      } catch (err: any) {
        setError(err.response?.data?.message || 'Failed to create location');
      } finally {
        setSaving(false);
      }
    }
  };

  const handleComplete = () => {
    // Reset form
    setActiveStep(0);
    setCreatedOrgId(null);
    setOrgData({
      name: '',
      contactPerson: '',
      contactPosition: 'Manager',
      contactEmail: '',
      contactPhone: '',
      address: '',
      city: '',
      province: '',
      postalCode: '',
      country: 'Canada',
      organizationComments: '',
    });
    setLocationData({
      locationName: '',
      contactFirstName: '',
      contactLastName: '',
      contactEmail: '',
      contactPhone: '',
      address: '',
      city: '',
      province: '',
      postalCode: '',
    });
    setError('');
    onComplete();
  };

  const resetAndClose = () => {
    setActiveStep(0);
    setCreatedOrgId(null);
    setError('');
    onClose();
  };

  /**
   * Closing via backdrop/Escape never deletes anything: the organization created in
   * step 1 is kept and the user is told a location can be added later.
   */
  const handleDialogClose = () => {
    if (saving) return;
    if (createdOrgId && activeStep === 1) {
      showInfo(`"${orgData.name}" was created. You can add a location from its Locations dialog.`);
      onComplete();
    }
    resetAndClose();
  };

  /** Explicit Cancel at step 2 asks whether to discard the organization just created. */
  const handleCancel = async () => {
    if (saving) return;
    if (createdOrgId && activeStep === 1) {
      const discard = await confirm({
        title: 'Discard new organization?',
        message: `"${orgData.name}" was already created. Discard it, or keep it and add a location later?`,
        confirmLabel: 'Discard',
        cancelLabel: 'Keep',
        danger: true,
      });
      if (discard) {
        try {
          await sysAdminApi.deleteOrganization(createdOrgId);
        } catch (err: any) {
          console.error('Failed to cleanup org:', err);
          setError(err.response?.data?.error?.message || 'Failed to discard the organization');
          return;
        }
      } else {
        showInfo(`"${orgData.name}" was kept. You can add a location from its Locations dialog.`);
      }
      onComplete();
    }
    resetAndClose();
  };

  return (
    <Dialog open={open} onClose={handleDialogClose} maxWidth="md" fullWidth>
      <DialogTitle>
        <Box>
          <Typography variant="h6">Create New Organization</Typography>
          <Stepper activeStep={activeStep} sx={{ mt: 2 }}>
            {steps.map(label => (
              <Step key={label}>
                <StepLabel>{label}</StepLabel>
              </Step>
            ))}
          </Stepper>
        </Box>
      </DialogTitle>

      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
            {error}
          </Alert>
        )}

        {activeStep === 0 && (
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Organization Name"
                name="name"
                value={orgData.name}
                onChange={handleOrgChange}
                required
                autoFocus
              />
            </Grid>

            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="Contact Person"
                name="contactPerson"
                value={orgData.contactPerson}
                onChange={handleOrgChange}
              />
            </Grid>

            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                select
                label="Position"
                name="contactPosition"
                value={orgData.contactPosition}
                onChange={handleOrgChange}
              >
                {positions.map(pos => (
                  <MenuItem key={pos} value={pos}>
                    {pos}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>

            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="Email"
                name="contactEmail"
                type="email"
                value={orgData.contactEmail}
                onChange={handleOrgChange}
              />
            </Grid>

            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="Phone"
                name="contactPhone"
                value={orgData.contactPhone}
                onChange={handleOrgChange}
                placeholder="(123) 456-7890"
              />
            </Grid>

            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Address"
                name="address"
                value={orgData.address}
                onChange={handleOrgChange}
              />
            </Grid>

            <Grid item xs={12} md={4}>
              <TextField
                fullWidth
                label="City"
                name="city"
                value={orgData.city}
                onChange={handleOrgChange}
              />
            </Grid>

            <Grid item xs={12} md={4}>
              <TextField
                fullWidth
                label="Province"
                name="province"
                value={orgData.province}
                onChange={handleOrgChange}
              />
            </Grid>

            <Grid item xs={12} md={4}>
              <TextField
                fullWidth
                label="Postal Code"
                name="postalCode"
                value={orgData.postalCode}
                onChange={handleOrgChange}
              />
            </Grid>

            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Comments"
                name="organizationComments"
                value={orgData.organizationComments}
                onChange={handleOrgChange}
                multiline
                rows={2}
              />
            </Grid>
          </Grid>
        )}

        {activeStep === 1 && (
          <Box>
            <Alert severity="info" sx={{ mb: 2 }}>
              Every organization needs at least one location. This is where courses will be scheduled and users assigned.
            </Alert>

            <Grid container spacing={2}>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Location Name"
                  name="locationName"
                  value={locationData.locationName}
                  onChange={handleLocationChange}
                  required
                  autoFocus
                  placeholder="e.g., Head Office, Downtown Branch, Main Campus"
                />
              </Grid>

              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Contact First Name"
                  name="contactFirstName"
                  value={locationData.contactFirstName}
                  onChange={handleLocationChange}
                />
              </Grid>

              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Contact Last Name"
                  name="contactLastName"
                  value={locationData.contactLastName}
                  onChange={handleLocationChange}
                />
              </Grid>

              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Contact Email"
                  name="contactEmail"
                  type="email"
                  value={locationData.contactEmail}
                  onChange={handleLocationChange}
                />
              </Grid>

              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Contact Phone"
                  name="contactPhone"
                  value={locationData.contactPhone}
                  onChange={handleLocationChange}
                  placeholder="(123) 456-7890"
                />
              </Grid>

              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Address"
                  name="address"
                  value={locationData.address}
                  onChange={handleLocationChange}
                />
              </Grid>

              <Grid item xs={12} md={4}>
                <TextField
                  fullWidth
                  label="City"
                  name="city"
                  value={locationData.city}
                  onChange={handleLocationChange}
                />
              </Grid>

              <Grid item xs={12} md={4}>
                <TextField
                  fullWidth
                  label="Province"
                  name="province"
                  value={locationData.province}
                  onChange={handleLocationChange}
                />
              </Grid>

              <Grid item xs={12} md={4}>
                <TextField
                  fullWidth
                  label="Postal Code"
                  name="postalCode"
                  value={locationData.postalCode}
                  onChange={handleLocationChange}
                />
              </Grid>
            </Grid>
          </Box>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={handleCancel} disabled={saving}>Cancel</Button>
        <Button onClick={handleNext} variant="contained" color="primary" disabled={saving}>
          {saving ? 'Saving…' : activeStep === 0 ? 'Next: Add Location' : 'Complete'}
        </Button>
      </DialogActions>
      {confirmDialog}
    </Dialog>
  );
};

export default OrganizationWizard;
