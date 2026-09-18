import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  IconButton,
  TextField,
  Grid,
  Alert,
  Chip,
  Box,
  Paper,
  Tooltip,
  CircularProgress,
} from '@mui/material';
import {
  Edit as EditIcon,
  Delete as DeleteIcon,
  Add as AddIcon,
} from '@mui/icons-material';
import { sysAdminApi } from '../../services/api';
import { useConfirm } from '../gtacpr';

interface Location {
  id: number;
  organizationId: number;
  locationName: string;
  address?: string;
  city?: string;
  province?: string;
  postalCode?: string;
  contactFirstName?: string;
  contactLastName?: string;
  contactEmail?: string;
  contactPhone?: string;
  isActive: boolean;
  userCount?: number;
  courseCount?: number;
  invoiceCount?: number;
}

interface LocationsDialogProps {
  open: boolean;
  onClose: () => void;
  organization: {
    id: number;
    organizationName: string;
  } | null;
}

const LocationsDialog: React.FC<LocationsDialogProps> = ({
  open,
  onClose,
  organization,
}) => {
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [editDialog, setEditDialog] = useState(false);
  const [editingLocation, setEditingLocation] = useState<Location | null>(null);
  const [saving, setSaving] = useState(false);
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [formData, setFormData] = useState({
    locationName: '',
    address: '',
    city: '',
    province: '',
    postalCode: '',
    contactFirstName: '',
    contactLastName: '',
    contactEmail: '',
    contactPhone: '',
  });

  useEffect(() => {
    if (open && organization) {
      loadLocations();
    }
  }, [open, organization]);

  const loadLocations = async () => {
    if (!organization) return;
    try {
      setLoading(true);
      setError('');
      const response = await sysAdminApi.getOrganizationLocations(organization.id);
      setLocations(response.data || []);
    } catch (err: any) {
      setError('Failed to load locations');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenEdit = (location: Location | null = null) => {
    if (location) {
      setEditingLocation(location);
      setFormData({
        locationName: location.locationName || '',
        address: location.address || '',
        city: location.city || '',
        province: location.province || '',
        postalCode: location.postalCode || '',
        contactFirstName: location.contactFirstName || '',
        contactLastName: location.contactLastName || '',
        contactEmail: location.contactEmail || '',
        contactPhone: location.contactPhone || '',
      });
    } else {
      setEditingLocation(null);
      setFormData({
        locationName: '',
        address: '',
        city: '',
        province: '',
        postalCode: '',
        contactFirstName: '',
        contactLastName: '',
        contactEmail: '',
        contactPhone: '',
      });
    }
    setEditDialog(true);
  };

  const handleCloseEdit = () => {
    setEditDialog(false);
    setEditingLocation(null);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));
  };

  const handleSubmit = async () => {
    if (!organization || saving) return;
    try {
      setSaving(true);
      setError('');
      if (editingLocation) {
        await sysAdminApi.updateOrganizationLocation(
          organization.id,
          editingLocation.id,
          formData
        );
        setSuccess('Location updated successfully');
      } else {
        await sysAdminApi.createOrganizationLocation(organization.id, formData);
        setSuccess('Location created successfully');
      }
      handleCloseEdit();
      loadLocations();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to save location');
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (loc: Location) => {
    if (!organization) return;
    const ok = await confirm({
      title: 'Delete location?',
      message: `"${loc.locationName}" will be removed from ${organization.organizationName}. This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      setError('');
      await sysAdminApi.deleteOrganizationLocation(organization.id, loc.id);
      setSuccess('Location removed successfully');
      loadLocations();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to delete location');
      console.error(err);
    }
  };

  const formatPhone = (phone?: string) => {
    if (!phone) return '';
    const cleaned = phone.replace(/\D/g, '');
    if (cleaned.length === 10) {
      return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
    }
    return phone;
  };

  return (
    <>
      <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
        <DialogTitle>
          Locations for {organization?.organizationName}
        </DialogTitle>
        <DialogContent>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
              {error}
            </Alert>
          )}
          {success && (
            <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>
              {success}
            </Alert>
          )}

          <Box sx={{ mb: 2, display: 'flex', justifyContent: 'flex-end' }}>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => handleOpenEdit(null)}
            >
              Add Location
            </Button>
          </Box>

          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
              <CircularProgress />
            </Box>
          ) : locations.length === 0 ? (
            <Alert severity="info">
              No locations found. Add a location to get started.
            </Alert>
          ) : (
            <TableContainer component={Paper}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Location Name</TableCell>
                    <TableCell>Contact</TableCell>
                    <TableCell>Email / Phone</TableCell>
                    <TableCell>Address</TableCell>
                    <TableCell align="center">Status</TableCell>
                    <TableCell align="center">Usage</TableCell>
                    <TableCell align="center">Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {locations.map(loc => (
                    <TableRow key={loc.id} sx={{ opacity: loc.isActive ? 1 : 0.5 }}>
                      <TableCell>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          {loc.locationName}
                          {!loc.isActive && (
                            <Chip label="Inactive" size="small" color="default" />
                          )}
                        </Box>
                      </TableCell>
                      <TableCell>
                        {loc.contactFirstName || loc.contactLastName
                          ? `${loc.contactFirstName || ''} ${loc.contactLastName || ''}`.trim()
                          : '-'}
                      </TableCell>
                      <TableCell>
                        <Box sx={{ fontSize: '0.9em' }}>
                          {loc.contactEmail || '-'}
                          <br />
                          {formatPhone(loc.contactPhone) || '-'}
                        </Box>
                      </TableCell>
                      <TableCell>
                        {loc.address || loc.city ? (
                          <Box sx={{ fontSize: '0.9em' }}>
                            {loc.address && <div>{loc.address}</div>}
                            {loc.city && loc.province && (
                              <div>
                                {loc.city}, {loc.province} {loc.postalCode}
                              </div>
                            )}
                          </Box>
                        ) : (
                          '-'
                        )}
                      </TableCell>
                      <TableCell align="center">
                        {loc.isActive ? (
                          <Chip label="Active" size="small" color="success" />
                        ) : (
                          <Chip label="Inactive" size="small" />
                        )}
                      </TableCell>
                      <TableCell align="center">
                        <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'center' }}>
                          <Tooltip title="Users">
                            <Chip label={`${loc.userCount || 0} users`} size="small" variant="outlined" />
                          </Tooltip>
                          <Tooltip title="Courses">
                            <Chip label={`${loc.courseCount || 0} courses`} size="small" variant="outlined" />
                          </Tooltip>
                        </Box>
                      </TableCell>
                      <TableCell align="center">
                        <Tooltip title="Edit">
                          <IconButton
                            size="small"
                            onClick={() => handleOpenEdit(loc)}
                            color="primary"
                            aria-label={`Edit ${loc.locationName}`}
                          >
                            <EditIcon />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Delete">
                          <IconButton
                            size="small"
                            onClick={() => handleDelete(loc)}
                            color="error"
                            aria-label={`Delete ${loc.locationName}`}
                          >
                            <DeleteIcon />
                          </IconButton>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </DialogContent>
        <DialogActions>
          {locations.length === 0 && (
            <Alert severity="warning" sx={{ mr: 2, flex: 1 }}>
              Please add at least one location before closing
            </Alert>
          )}
          <Button
            onClick={onClose}
            disabled={locations.length === 0}
          >
            Close
          </Button>
        </DialogActions>
      </Dialog>

      {/* Add/Edit Location Dialog */}
      <Dialog open={editDialog} onClose={handleCloseEdit} maxWidth="md" fullWidth>
        <DialogTitle>
          {editingLocation ? 'Edit Location' : 'Add New Location'}
        </DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Location Name"
                name="locationName"
                value={formData.locationName}
                onChange={handleInputChange}
                required
                placeholder="e.g., Downtown Branch, North Campus"
              />
            </Grid>

            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="Contact First Name"
                name="contactFirstName"
                value={formData.contactFirstName}
                onChange={handleInputChange}
              />
            </Grid>

            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="Contact Last Name"
                name="contactLastName"
                value={formData.contactLastName}
                onChange={handleInputChange}
              />
            </Grid>

            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="Contact Email"
                name="contactEmail"
                type="email"
                value={formData.contactEmail}
                onChange={handleInputChange}
              />
            </Grid>

            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="Contact Phone"
                name="contactPhone"
                value={formData.contactPhone}
                onChange={handleInputChange}
                placeholder="(123) 456-7890"
              />
            </Grid>

            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Address"
                name="address"
                value={formData.address}
                onChange={handleInputChange}
              />
            </Grid>

            <Grid item xs={12} md={4}>
              <TextField
                fullWidth
                label="City"
                name="city"
                value={formData.city}
                onChange={handleInputChange}
              />
            </Grid>

            <Grid item xs={12} md={4}>
              <TextField
                fullWidth
                label="Province"
                name="province"
                value={formData.province}
                onChange={handleInputChange}
              />
            </Grid>

            <Grid item xs={12} md={4}>
              <TextField
                fullWidth
                label="Postal Code"
                name="postalCode"
                value={formData.postalCode}
                onChange={handleInputChange}
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseEdit} disabled={saving}>Cancel</Button>
          <Button
            onClick={handleSubmit}
            variant="contained"
            color="primary"
            disabled={!formData.locationName || saving}
          >
            {saving ? 'Saving…' : editingLocation ? 'Update' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>
      {confirmDialog}
    </>
  );
};

export default LocationsDialog;
