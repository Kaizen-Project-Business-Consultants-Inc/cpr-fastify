import React, { useState, useEffect, useCallback } from 'react';
import * as api from '../../services/api';
import { Box, Typography, CircularProgress, Alert, Snackbar } from '@mui/material';
import UserDialog from './UserDialog';
import { formatPhoneNumber } from 'react-phone-number-input';
import logger from '../../utils/logger';
import DataTable, { DataTableRow } from '../gtacpr/DataTable';
import UserAvatar from '../gtacpr/UserAvatar';
import RoleChip from '../gtacpr/RoleChip';
import { PrimaryButton } from '../gtacpr/Buttons';
import LinkButton from '../gtacpr/LinkButton';
import { useConfirm } from '../gtacpr/ConfirmDialog';
import { getErrorMessage } from '../../utils/errorMessage';

const formatPhone = (phoneString: string | null | undefined) => {
  if (!phoneString) return '—';
  return formatPhoneNumber(phoneString) || phoneString;
};

const columns = [
  { key: 'user', label: 'USER', width: '1.4fr' },
  { key: 'role', label: 'ROLE', width: '0.7fr' },
  { key: 'email', label: 'EMAIL', width: '1.2fr' },
  { key: 'phone', label: 'PHONE', width: '0.9fr' },
  { key: 'org', label: 'ORGANIZATION', width: '1fr' },
  { key: 'location', label: 'LOCATION', width: '0.9fr' },
  { key: 'actions', label: '', width: '0.5fr', align: 'right' as const },
];

interface UserRecord {
  userId: number;
  username: string;
  role?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  organizationName?: string;
  locationName?: string;
}

function getInitials(user: UserRecord): string {
  const f = user.firstName || '';
  const l = user.lastName || '';
  if (f || l) return `${f[0] || ''}${l[0] || ''}`.toUpperCase();
  return (user.username || '?')[0].toUpperCase();
}

function UserManager() {
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserRecord | null>(null);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' as 'success' | 'error' | 'warning' | 'info' });
  const { confirm, dialog: confirmDialog } = useConfirm();

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.getUsers();
      setUsers(data || []);
    } catch (err) {
      logger.error('Error fetching users:', err);
      setError('Failed to load users');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const showSnackbar = (message: string, severity: 'success' | 'error' | 'warning' | 'info' = 'success') => {
    setSnackbar({ open: true, message, severity });
  };

  const handleAddOpen = () => { setEditingUser(null); setDialogOpen(true); };
  const handleEditOpen = (user: UserRecord) => { setEditingUser(user); setDialogOpen(true); };

  const handleDeactivate = async (user: UserRecord) => {
    const label = `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.username;
    const ok = await confirm({
      title: 'Deactivate user?',
      message: `${label} (${user.username}) will no longer be able to log in. Their records are kept and the account can be reactivated later.`,
      confirmLabel: 'Deactivate',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.api.put(`/sysadmin/users/${user.userId}`, { status: 'inactive' });
      showSnackbar(`${label} deactivated.`, 'success');
      fetchUsers();
    } catch (err) {
      logger.error(`Error deactivating user ${user.userId}:`, err);
      showSnackbar(`Failed to deactivate user: ${getErrorMessage(err)}`, 'error');
    }
  };

  const handleDialogClose = () => { setDialogOpen(false); setEditingUser(null); };
  const handleDialogSave = () => { showSnackbar(editingUser ? 'User updated.' : 'User added.', 'success'); fetchUsers(); };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400 }}>
        <CircularProgress size={48} />
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {error && <Alert severity="error">{error}</Alert>}

      <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
        <PrimaryButton onClick={handleAddOpen}>+ Add User</PrimaryButton>
      </Box>

      {users.length === 0 ? (
        <Box sx={{ bgcolor: (theme) => theme.palette.background.paper, border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', p: 6, textAlign: 'center' }}>
          <Typography sx={{ color: (theme) => theme.palette.text.secondary, fontSize: 14 }}>No users found.</Typography>
        </Box>
      ) : (
        <DataTable columns={columns} shownCount={users.length} totalCount={users.length}>
          {users.map(user => (
            <DataTableRow key={user.userId} columns={columns}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                <UserAvatar initials={getInitials(user)} />
                <Box>
                  <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: (theme) => theme.palette.text.primary }}>
                    {`${user.firstName || ''} ${user.lastName || ''}`.trim() || user.username}
                  </Typography>
                  <Typography sx={{ fontSize: 11.5, color: (theme) => theme.palette.text.secondary }}>{user.username}</Typography>
                </Box>
              </Box>
              <RoleChip role={user.role || 'Unknown'} />
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{user.email}</Typography>
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{formatPhone(user.phone)}</Typography>
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{user.organizationName || '—'}</Typography>
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{user.locationName || '—'}</Typography>
              <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'flex-end' }}>
                <LinkButton onClick={() => handleEditOpen(user)} aria-label={`Edit ${user.username}`}>Edit</LinkButton>
                <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.divider }}>|</Typography>
                <LinkButton tone="neutral" onClick={() => handleDeactivate(user)} aria-label={`Deactivate ${user.username}`}>Deactivate</LinkButton>
              </Box>
            </DataTableRow>
          ))}
        </DataTable>
      )}

      <Snackbar open={snackbar.open} autoHideDuration={6000} onClose={() => setSnackbar({ ...snackbar, open: false })} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert onClose={() => setSnackbar({ ...snackbar, open: false })} severity={snackbar.severity} variant="filled" sx={{ width: '100%' }}>{snackbar.message}</Alert>
      </Snackbar>

      <UserDialog open={dialogOpen} onClose={handleDialogClose} onSave={handleDialogSave} user={editingUser} existingUsers={users} />
      {confirmDialog}
    </Box>
  );
}

export default UserManager;
