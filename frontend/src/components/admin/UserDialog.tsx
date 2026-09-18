import React, { useState, useEffect, useCallback } from 'react';
import { getOrganizationLocations, getOrganizations } from '../../services/api';
import logger from '../../utils/logger';
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
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  FormHelperText,
} from '@mui/material';
import type { SelectChangeEvent } from '@mui/material';
import PhoneInput, { isValidPhoneNumber } from 'react-phone-number-input';
import 'react-phone-number-input/style.css';
import { createUser, updateUser } from '../../services/userService';
import { getErrorMessage } from '../../utils/errorMessage';

interface UserRecord {
  userId: number;
  username: string;
  role?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  organizationId?: number | string;
  locationId?: number | string;
}

interface OrganizationOption {
  organizationId?: number;
  id?: number;
  organizationName?: string;
}

interface LocationOption {
  id: number;
  locationName?: string;
  isActive?: boolean;
}

// Initial empty state for a new user
const initialUserState = {
  username: '',
  password: '', // Handle password update separately if editing
  role: '',
  firstName: '',
  lastName: '',
  email: '',
  phone: '', // Added phone
  organizationId: '', // Store as string initially for Select compatibility
  locationId: '', // Location within the organization
};

// Define allowed roles (fetch from backend ideally, but hardcode for now)
const roles = [
  'SuperAdmin',
  'Admin',
  'Instructor',
  'Organization',
  'Accounting',
];

interface UserDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: () => void;
  user: UserRecord | null;
  existingUsers?: UserRecord[];
}

function UserDialog({ open, onClose, onSave, user, existingUsers = [] }: UserDialogProps) {
  const [userData, setUserData] = useState(initialUserState);
  const [organizations, setOrganizations] = useState<OrganizationOption[]>([]);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [loadingOrgs, setLoadingOrgs] = useState(false);
  const [loadingLocations, setLoadingLocations] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | boolean>>({});
  const isEditMode = Boolean(user?.userId);

  // Fetch organizations for the dropdown if role is Organization
  const fetchOrganizations = useCallback(async () => {
    setLoadingOrgs(true);
    try {
      logger.info('Fetching organizations for user dialog');
      const data = await getOrganizations(); // Use existing API function
      setOrganizations(data || []);
    } catch (fetchErr) {
      logger.error('Error fetching organizations for dialog:', fetchErr);
      setError('Could not load organizations list.'); // Show error in dialog
      setOrganizations([]);
    }
    setLoadingOrgs(false);
  }, []);

  // Fetch locations for the selected organization
  const fetchLocations = useCallback(async (orgId: number) => {
    if (!orgId) {
      setLocations([]);
      return;
    }
    setLoadingLocations(true);
    try {
      logger.info('Fetching locations for organization:', orgId);
      const data = await getOrganizationLocations(orgId);
      // Filter to only active locations
      const activeLocations = (data || []).filter((loc: LocationOption) => loc.isActive !== false);
      setLocations(activeLocations);
    } catch (fetchErr) {
      logger.error('Error fetching locations for dialog:', fetchErr);
      setLocations([]);
    }
    setLoadingLocations(false);
  }, []);

  useEffect(() => {
    if (open) {
      // Only fetch when dialog is opened
      fetchOrganizations();
      if (isEditMode && user) {
        const orgId = user.organizationId ? String(user.organizationId) : '';
        setUserData({
          username: user.username || '',
          password: '', // Don't prefill password for edit
          role: user.role || '',
          firstName: user.firstName || '',
          lastName: user.lastName || '',
          email: user.email || '',
          phone: user.phone || '', // Add phone
          organizationId: orgId, // Convert ID to string for Select
          locationId: user.locationId ? String(user.locationId) : '',
        });
        // Fetch locations if user has an organization
        if (user.organizationId) {
          fetchLocations(Number(user.organizationId));
        }
      } else {
        setUserData(initialUserState);
        setLocations([]);
      }
      setError('');
      setFieldErrors({});
    }
  }, [user, isEditMode, open, fetchOrganizations, fetchLocations]);

  // Handler for standard MUI TextFields
  const handleTextChange = (
    event: SelectChangeEvent<string> | React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = event.target;
    setUserData(prevData => {
      const newData = {
        ...prevData,
        [name]: value,
      };
      // When organization changes, clear location and fetch new locations
      if (name === 'organizationId') {
        newData.locationId = ''; // Clear location when org changes
        if (value) {
          fetchLocations(parseInt(value, 10));
        } else {
          setLocations([]);
        }
      }
      // When role changes away from Organization, clear org and location
      if (name === 'role' && value !== 'Organization') {
        newData.organizationId = '';
        newData.locationId = '';
        setLocations([]);
      }
      return newData;
    });
    if (fieldErrors[name]) {
      setFieldErrors(prev => ({ ...prev, [name]: false }));
    }
    if (error) {
      setError('');
    }
  };

  // Handler specifically for react-phone-number-input
  const handlePhoneChange = (name: string, value: string | undefined) => {
    setUserData(prevData => ({
      ...prevData,
      // Use the name passed ('phone') and the value directly
      [name]: value || '', // Ensure empty string if value is null/undefined
    }));
    if (fieldErrors[name]) {
      setFieldErrors(prev => ({ ...prev, [name]: false }));
    }
    if (error) {
      setError('');
    }
  };

  const handleSave = async () => {
    setError('');
    setFieldErrors({});
    const newFieldErrors: Record<string, string> = {};

    // --- Client-side validation ---
    // Required fields
    if (!userData.username.trim())
      newFieldErrors.username = 'Username required';
    if (!isEditMode && !userData.password)
      newFieldErrors.password = 'Password required for new user';
    if (!userData.role) newFieldErrors.role = 'Role required';
    if (!userData.firstName.trim())
      newFieldErrors.firstName = 'First Name required';
    if (!userData.lastName.trim())
      newFieldErrors.lastName = 'Last Name required';
    if (userData.role === 'Organization' && !userData.organizationId)
      newFieldErrors.organizationId = 'Organization required for this role';
    if (userData.role === 'Organization' && !userData.locationId)
      newFieldErrors.locationId = 'Location required for this role';

    // Phone validation (if entered)
    if (userData.phone && !isValidPhoneNumber(userData.phone)) {
      newFieldErrors.phone = 'Invalid phone number.';
    }

    // Email format validation (basic)
    if (userData.email && !/\S+@\S+\.\S+/.test(userData.email)) {
      newFieldErrors.email = 'Invalid email format.';
    }

    // Check for duplicate username (case-insensitive, ignore self if editing)
    const usernameLower = userData.username.trim().toLowerCase();
    if (
      usernameLower &&
      existingUsers.some(
        u =>
          u.username.toLowerCase() === usernameLower &&
          u.userId !== user?.userId
      )
    ) {
      newFieldErrors.username = 'Username already taken.';
    }

    // Check for duplicate email (case-insensitive, ignore self if editing, allow empty)
    const emailLower = userData.email.trim().toLowerCase();
    if (
      emailLower &&
      existingUsers.some(
        u =>
          u.email &&
          u.email.toLowerCase() === emailLower &&
          u.userId !== user?.userId
      )
    ) {
      newFieldErrors.email = 'Email already registered.';
    }
    // --- End Client-side validation ---

    if (Object.keys(newFieldErrors).length > 0) {
      setError('Please fix highlighted field(s).');
      setFieldErrors(newFieldErrors);
      return;
    }

    setLoading(true);
    try {
      // Prepare data for API (convert orgId and locationId back to number if set)
      const dataToSend: {
        username: string;
        password?: string;
        role: string;
        firstName: string;
        lastName: string;
        email: string;
        phone: string;
        organizationId: number | null;
        locationId: number | null;
      } = {
        ...userData,
        organizationId: userData.organizationId
          ? parseInt(userData.organizationId, 10)
          : null,
        locationId: userData.locationId
          ? parseInt(userData.locationId, 10)
          : null,
      };
      // Don't send empty password string for updates unless explicitly changing
      if (isEditMode && !dataToSend.password) {
        delete dataToSend.password;
      }

      if (isEditMode && user) {
        logger.info(
          '[UserDialog] Calling updateUser with ID:',
          user.userId,
          'Data:',
          dataToSend
        );
        await updateUser(user.userId, dataToSend);
      } else {
        logger.info('[UserDialog] Calling addUser with Data:', dataToSend);
        await createUser(dataToSend);
      }
      logger.info('[UserDialog] Save successful, calling onSave and onClose.');
      onSave();
      onClose();
    } catch (err) {
      logger.error('Save user error:', err);
      const message = getErrorMessage(err, 'Failed to save user.');

      // Try to parse backend error for specific fields
      const backendFieldErrors: Record<string, string> = {};
      if (message.toLowerCase().includes('username already exists')) {
        backendFieldErrors.username = 'Username already exists.';
      } else if (message.toLowerCase().includes('email already exists')) {
        backendFieldErrors.email = 'Email already exists.';
      } else if (message.toLowerCase().includes('invalid organization id')) {
        backendFieldErrors.organizationId = 'Selected organization is invalid.';
      } // Add more specific checks if backend provides them

      // Set general error and specific field errors
      setError(message); // Still show general error message
      setFieldErrors(prev => ({ ...prev, ...backendFieldErrors })); // Merge with existing client errors
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth='sm' fullWidth>
      <DialogTitle>{isEditMode ? 'Edit User' : 'Add New User'}</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity='error' sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <Grid container spacing={2} sx={{ mt: 1 }}>
          <Grid item xs={12} sm={6}>
            <TextField
              name='username'
              label='Username *'
              value={userData.username}
              onChange={handleTextChange}
              fullWidth
              required
              error={Boolean(fieldErrors.username)}
              helperText={fieldErrors.username || ''}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              name='password'
              label={isEditMode ? 'New Password (Optional)' : 'Password *'}
              type='password'
              value={userData.password}
              onChange={handleTextChange}
              fullWidth
              required={!isEditMode}
              error={Boolean(fieldErrors.password)}
              helperText={fieldErrors.password || ''}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              name='firstName'
              label='First Name *'
              value={userData.firstName}
              onChange={handleTextChange}
              fullWidth
              required
              error={Boolean(fieldErrors.firstName)}
              helperText={fieldErrors.firstName || ''}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              name='lastName'
              label='Last Name *'
              value={userData.lastName}
              onChange={handleTextChange}
              fullWidth
              required
              error={Boolean(fieldErrors.lastName)}
              helperText={fieldErrors.lastName || ''}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              name='email'
              label='Email'
              type='email'
              value={userData.email}
              onChange={handleTextChange}
              fullWidth
              error={Boolean(fieldErrors.email)}
              helperText={fieldErrors.email || ''}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <FormControl fullWidth error={Boolean(fieldErrors.phone)}>
              <PhoneInput
                placeholder='Enter phone number'
                value={userData.phone}
                onChange={value => handlePhoneChange('phone', value)}
                defaultCountry='CA'
                international
                countryCallingCodeEditable={false}
                limitMaxLength
                style={{
                  border: fieldErrors.phone
                    ? '1px solid red'
                    : '1px solid #ccc',
                  borderRadius: '4px',
                  padding: '16.5px 14px',
                }}
                className={fieldErrors.phone ? 'phone-input-error' : ''}
              />
              {fieldErrors.phone && (
                <FormHelperText>{fieldErrors.phone}</FormHelperText>
              )}
            </FormControl>
          </Grid>
          <Grid item xs={12} sm={6}>
            <FormControl fullWidth required error={Boolean(fieldErrors.role)}>
              <InputLabel id='role-select-label'>Role *</InputLabel>
              <Select
                name='role'
                labelId='role-select-label'
                label='Role *'
                value={userData.role}
                onChange={handleTextChange}
              >
                {roles.map(r => (
                  <MenuItem key={r} value={r}>
                    {r}
                  </MenuItem>
                ))}
              </Select>
              {fieldErrors.role && (
                <FormHelperText>{fieldErrors.role}</FormHelperText>
              )}
            </FormControl>
          </Grid>

          {/* Conditional Organization Dropdown */}
          {userData.role === 'Organization' && (
            <>
              <Grid item xs={12} sm={6}>
                <FormControl
                  fullWidth
                  required
                  error={Boolean(fieldErrors.organizationId)}
                  disabled={loadingOrgs}
                >
                  <InputLabel id='org-select-label'>Organization *</InputLabel>
                  <Select
                    name='organizationId'
                    labelId='org-select-label'
                    label='Organization *'
                    value={userData.organizationId}
                    onChange={handleTextChange}
                  >
                    <MenuItem value=''>
                      <em>Select Organization...</em>
                    </MenuItem>
                    {organizations.map(org => (
                      <MenuItem
                        key={org.organizationId || org.id}
                        value={String(org.organizationId || org.id)}
                      >
                        {org.organizationName}
                      </MenuItem>
                    ))}
                  </Select>
                  {fieldErrors.organizationId && (
                    <FormHelperText>
                      {fieldErrors.organizationId}
                    </FormHelperText>
                  )}
                  {loadingOrgs && (
                    <FormHelperText>Loading organizations...</FormHelperText>
                  )}
                </FormControl>
              </Grid>

              {/* Location Dropdown - appears when organization is selected */}
              <Grid item xs={12} sm={6}>
                <FormControl
                  fullWidth
                  required
                  error={Boolean(fieldErrors.locationId)}
                  disabled={!userData.organizationId || loadingLocations}
                >
                  <InputLabel id='location-select-label'>Location *</InputLabel>
                  <Select
                    name='locationId'
                    labelId='location-select-label'
                    label='Location *'
                    value={userData.locationId}
                    onChange={handleTextChange}
                  >
                    <MenuItem value=''>
                      <em>{userData.organizationId ? 'Select Location...' : 'Select Organization First'}</em>
                    </MenuItem>
                    {locations.map(loc => (
                      <MenuItem
                        key={loc.id}
                        value={String(loc.id)}
                      >
                        {loc.locationName}
                      </MenuItem>
                    ))}
                  </Select>
                  {fieldErrors.locationId && (
                    <FormHelperText>
                      {fieldErrors.locationId}
                    </FormHelperText>
                  )}
                  {loadingLocations && (
                    <FormHelperText>Loading locations...</FormHelperText>
                  )}
                  {userData.organizationId && locations.length === 0 && !loadingLocations && (
                    <FormHelperText>No locations available for this organization</FormHelperText>
                  )}
                </FormControl>
              </Grid>
            </>
          )}
        </Grid>
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
            'Add User'
          )}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default UserDialog;
