import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Grid,
  TextField,
  Button,
} from '@mui/material';
import { sysAdminApi } from '../../services/api';
import logger from '../../utils/logger';
import SearchBar from '../gtacpr/SearchBar';
import DataTable, { DataTableRow } from '../gtacpr/DataTable';
import UserAvatar from '../gtacpr/UserAvatar';
import RoleChip from '../gtacpr/RoleChip';
import StatusChip from '../gtacpr/StatusChip';
import { PrimaryButton } from '../gtacpr/Buttons';
import { useConfirm, LinkButton } from '../gtacpr';
import { formatDisplayDate } from '../../utils/formatters';

const columns = [
  { key: 'user', label: 'USER', width: '1.5fr' },
  { key: 'email', label: 'EMAIL', width: '1.3fr' },
  { key: 'role', label: 'ROLE', width: '0.8fr' },
  { key: 'org', label: 'ORGANIZATION', width: '1.1fr' },
  { key: 'mobile', label: 'MOBILE', width: '0.9fr' },
  { key: 'status', label: 'STATUS', width: '0.7fr' },
  { key: 'onboarded', label: 'ONBOARDED', width: '0.8fr' },
  { key: 'actions', label: '', width: '0.5fr', align: 'right' as const },
];

const userRoles = ['admin', 'instructor', 'organization', 'student', 'accountant', 'sysadmin', 'hr'];
const userStatuses = ['active', 'inactive', 'suspended'];

function getInitials(user: any): string {
  const first = user.firstName || '';
  const last = user.lastName || '';
  if (first || last) return `${first[0] || ''}${last[0] || ''}`.toUpperCase();
  return (user.username || '?')[0].toUpperCase();
}

const UserManagement = ({ onShowSnackbar }: { onShowSnackbar: any }) => {
  const [users, setUsers] = useState<any[]>([]);
  const [organizations, setOrganizations] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [saving, setSaving] = useState(false);
  const { confirm, dialog: confirmDialog } = useConfirm();

  // Dialog state
  const [showDialog, setShowDialog] = useState(false);
  const [editingUser, setEditingUser] = useState<any>(null);
  const [formData, setFormData] = useState({
    username: '', email: '', password: '', firstName: '', lastName: '',
    fullName: '', role: '', mobile: '', organizationId: '', locationId: '',
    dateOnboarded: '', userComments: '', status: 'active',
  });

  useEffect(() => { loadUsers(); loadOrganizations(); }, []);

  const loadUsers = async () => {
    setLoading(true);
    try {
      const response = await sysAdminApi.getUsers();
      setUsers(response.data || []);
    } catch (err: any) {
      logger.error('Error loading users:', err);
      onShowSnackbar?.('Failed to load users', 'error');
    } finally {
      setLoading(false);
    }
  };

  const loadOrganizations = async () => {
    try {
      const response = await sysAdminApi.getOrganizations();
      setOrganizations(response.data || []);
    } catch (err: any) {
      logger.error('Error loading organizations:', err);
    }
  };

  const loadLocations = async (orgId: any) => {
    if (!orgId) { setLocations([]); return; }
    try {
      const response = await sysAdminApi.getOrganizationLocations(orgId);
      setLocations(response.data || []);
    } catch { setLocations([]); }
  };

  const handleAddNew = () => {
    setEditingUser(null);
    setLocations([]);
    setFormData({
      username: '', email: '', password: '', firstName: '', lastName: '',
      fullName: '', role: '', mobile: '', organizationId: '', locationId: '',
      dateOnboarded: '', userComments: '', status: 'active',
    });
    setShowDialog(true);
  };

  const handleEdit = async (user: any) => {
    setEditingUser(user);
    setFormData({
      username: user.username || '', email: user.email || '', password: '',
      firstName: user.firstName || '', lastName: user.lastName || '',
      fullName: user.fullName || '', role: user.role || '', mobile: user.mobile || '',
      organizationId: user.organizationId || '', locationId: user.locationId || '',
      dateOnboarded: user.dateOnboarded ? user.dateOnboarded.split('T')[0] : '',
      userComments: user.userComments || '', status: user.status || 'active',
    });
    if (user.organizationId) await loadLocations(user.organizationId);
    else setLocations([]);
    setShowDialog(true);
  };

  const handleDeactivate = async (user: any) => {
    const displayName = user.fullName || `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.username;
    const ok = await confirm({
      title: 'Deactivate user?',
      message: `${displayName} (${user.username}) will no longer be able to sign in. You can reactivate them by editing the user.`,
      confirmLabel: 'Deactivate',
      danger: true,
    });
    if (!ok) return;
    try {
      await sysAdminApi.updateUser(user.id, { status: 'inactive' });
      onShowSnackbar?.('User deactivated successfully', 'success');
      loadUsers();
    } catch (err: any) {
      logger.error('Error deactivating user:', err);
      onShowSnackbar?.('Failed to deactivate user', 'error');
    }
  };

  const handleSubmit = async (e: any) => {
    e.preventDefault();
    if (!formData.username.trim() || !formData.email.trim() || !formData.role) {
      onShowSnackbar?.('Username, email, and role are required', 'error'); return;
    }
    if (!editingUser && !formData.password.trim()) {
      onShowSnackbar?.('Password is required for new users', 'error'); return;
    }
    if (saving) return;
    try {
      setSaving(true);
      const submitData = {
        ...formData,
        organizationId: formData.organizationId || null,
        locationId: formData.locationId || null,
        dateOnboarded: formData.dateOnboarded || null,
      };
      const mutableSubmitData: Record<string, unknown> = { ...submitData };
      if (!mutableSubmitData.password) delete mutableSubmitData.password;

      if (editingUser) {
        await sysAdminApi.updateUser(editingUser.id, submitData);
        onShowSnackbar?.('User updated successfully', 'success');
      } else {
        await sysAdminApi.createUser(submitData);
        onShowSnackbar?.('User created successfully', 'success');
      }
      setShowDialog(false);
      loadUsers();
    } catch (err: any) {
      logger.error('Error saving user:', err);
      const errorMessage = err.response?.data?.error?.message || err.response?.data?.message || err.message || 'Failed to save user';
      onShowSnackbar?.(errorMessage, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleChange = async (e: any) => {
    const { name, value, checked, type } = e.target;
    setFormData(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
    if (name === 'organizationId') {
      setFormData(prev => ({ ...prev, locationId: '' }));
      if (value) await loadLocations(value);
      else setLocations([]);
    }
  };

  const filtered = users.filter(u => {
    if (roleFilter && u.role !== roleFilter) return false;
    if (!searchTerm) return true;
    const q = searchTerm.toLowerCase();
    return (u.username || '').toLowerCase().includes(q)
      || (u.email || '').toLowerCase().includes(q)
      || (u.fullName || '').toLowerCase().includes(q)
      || (`${u.firstName || ''} ${u.lastName || ''}`).toLowerCase().includes(q);
  });

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400 }}>
        <CircularProgress size={48} />
      </Box>
    );
  }

  const allRoles = [...new Set(users.map(u => u.role).filter(Boolean))];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Toolbar */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <Box sx={{ flex: 1, maxWidth: 380 }}>
          <SearchBar placeholder="Search users..." value={searchTerm} onChange={setSearchTerm} />
        </Box>
        {/* Role filter pills */}
        <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
          <Box
            component="button"
            type="button"
            aria-pressed={!roleFilter}
            onClick={() => setRoleFilter('')}
            sx={{
              px: 1.5, py: 0.5, borderRadius: '20px', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
              border: '1px solid', borderColor: !roleFilter ? 'rgba(204,31,31,.3)' : (theme: any) => theme.palette.divider,
              bgcolor: !roleFilter ? '#FFF0F0' : (theme: any) => theme.palette.background.paper, color: !roleFilter ? '#CC1F1F' : (theme: any) => theme.palette.text.secondary,
            }}
          >
            All
          </Box>
          {allRoles.map(role => (
            <Box
              key={role}
              component="button"
              type="button"
              aria-pressed={roleFilter === role}
              onClick={() => setRoleFilter(role)}
              sx={{
                px: 1.5, py: 0.5, borderRadius: '20px', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                border: '1px solid', textTransform: 'capitalize',
                borderColor: roleFilter === role ? 'rgba(204,31,31,.3)' : (theme: any) => theme.palette.divider,
                bgcolor: roleFilter === role ? '#FFF0F0' : (theme: any) => theme.palette.background.paper,
                color: roleFilter === role ? '#CC1F1F' : (theme: any) => theme.palette.text.secondary,
              }}
            >
              {role}
            </Box>
          ))}
        </Box>
        <Box sx={{ ml: 'auto' }}>
          <PrimaryButton onClick={handleAddNew}>+ New User</PrimaryButton>
        </Box>
      </Box>

      <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.text.secondary, mt: -1 }}>
        {filtered.length} user{filtered.length !== 1 ? 's' : ''}
      </Typography>

      {/* Table */}
      <DataTable columns={columns} shownCount={filtered.length} totalCount={users.length}>
        {filtered.map(user => (
          <DataTableRow key={user.id} columns={columns}>
            {/* USER */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <UserAvatar initials={getInitials(user)} />
              <Box>
                <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: (theme) => theme.palette.text.primary }}>
                  {user.fullName || `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.username}
                </Typography>
                <Typography sx={{ fontSize: 11.5, color: (theme) => theme.palette.text.secondary }}>{user.username}</Typography>
              </Box>
            </Box>
            {/* EMAIL */}
            <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{user.email}</Typography>
            {/* ROLE */}
            <RoleChip role={user.role} />
            {/* ORG */}
            <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{user.organizationName || '—'}</Typography>
            {/* MOBILE */}
            <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{user.mobile || '—'}</Typography>
            {/* STATUS */}
            <StatusChip
              kind={user.status === 'active' ? 'active' : user.status === 'suspended' ? 'danger' : 'inactive'}
              label={user.status || 'active'}
            />
            {/* ONBOARDED */}
            <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{formatDisplayDate(user.dateOnboarded)}</Typography>
            {/* ACTIONS */}
            <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'flex-end' }}>
              <LinkButton onClick={() => handleEdit(user)} aria-label={`Edit ${user.username}`}>Edit</LinkButton>
              {user.status !== 'inactive' && (
                <>
                  <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.divider }}>|</Typography>
                  <LinkButton tone="neutral" onClick={() => handleDeactivate(user)} aria-label={`Deactivate ${user.username}`}>Deactivate</LinkButton>
                </>
              )}
            </Box>
          </DataTableRow>
        ))}
      </DataTable>

      {/* Add/Edit User Dialog */}
      <Dialog open={showDialog} onClose={() => setShowDialog(false)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>{editingUser ? 'Edit User' : 'Add New User'}</DialogTitle>
        <DialogContent>
          <Box component="form" onSubmit={handleSubmit} autoComplete="off" sx={{ mt: 2 }}>
            <Grid container spacing={2}>
              <Grid item xs={12} sm={6}><TextField fullWidth required label="Username" name="username" value={formData.username} onChange={handleChange} autoComplete="off" /></Grid>
              <Grid item xs={12} sm={6}><TextField fullWidth required type="email" label="Email" name="email" value={formData.email} onChange={handleChange} autoComplete="off" /></Grid>
              <Grid item xs={12} sm={6}>
                <TextField fullWidth type="password" label={editingUser ? 'New Password (leave blank to keep current)' : 'Password'} name="password" value={formData.password} onChange={handleChange} required={!editingUser} autoComplete="new-password" />
              </Grid>
              <Grid item xs={12} sm={6}>
                <FormControl fullWidth required><InputLabel>Role</InputLabel>
                  <Select name="role" value={formData.role} label="Role" onChange={handleChange}>
                    {userRoles.map(role => <MenuItem key={role} value={role}>{role.charAt(0).toUpperCase() + role.slice(1)}</MenuItem>)}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} sm={6}><TextField fullWidth label="First Name" name="firstName" value={formData.firstName} onChange={handleChange} /></Grid>
              <Grid item xs={12} sm={6}><TextField fullWidth label="Last Name" name="lastName" value={formData.lastName} onChange={handleChange} /></Grid>
              <Grid item xs={12} sm={6}><TextField fullWidth label="Mobile" name="mobile" value={formData.mobile} onChange={handleChange} /></Grid>
              <Grid item xs={12} sm={6}>
                <FormControl fullWidth><InputLabel>Organization</InputLabel>
                  <Select name="organizationId" value={formData.organizationId} label="Organization" onChange={handleChange}>
                    <MenuItem value="">None</MenuItem>
                    {organizations.map((org: any) => <MenuItem key={org.id} value={org.id}>{org.organizationName}</MenuItem>)}
                  </Select>
                </FormControl>
              </Grid>
              {formData.organizationId && formData.role === 'organization' && (
                <Grid item xs={12} sm={6}>
                  <FormControl fullWidth><InputLabel>Location</InputLabel>
                    <Select name="locationId" value={formData.locationId} label="Location" onChange={handleChange}>
                      <MenuItem value="">Select Location</MenuItem>
                      {locations.map((loc: any) => <MenuItem key={loc.id} value={loc.id}>{loc.locationName}</MenuItem>)}
                    </Select>
                  </FormControl>
                </Grid>
              )}
              <Grid item xs={12} sm={6}><TextField fullWidth type="date" label="Date Onboarded" name="dateOnboarded" value={formData.dateOnboarded} onChange={handleChange} InputLabelProps={{ shrink: true }} /></Grid>
              <Grid item xs={12} sm={6}>
                <FormControl fullWidth><InputLabel>Status</InputLabel>
                  <Select name="status" value={formData.status} label="Status" onChange={handleChange}>
                    {userStatuses.map(status => <MenuItem key={status} value={status}>{status.charAt(0).toUpperCase() + status.slice(1)}</MenuItem>)}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12}><TextField fullWidth multiline rows={3} label="Comments" name="userComments" value={formData.userComments} onChange={handleChange} /></Grid>
            </Grid>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowDialog(false)} disabled={saving}>Cancel</Button>
          <Button onClick={handleSubmit} variant="contained" disabled={saving}>{saving ? 'Saving…' : editingUser ? 'Update User' : 'Create User'}</Button>
        </DialogActions>
      </Dialog>
      {confirmDialog}
    </Box>
  );
};

export default UserManagement;
