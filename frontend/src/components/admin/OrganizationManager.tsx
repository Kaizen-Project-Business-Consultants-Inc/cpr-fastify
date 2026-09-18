import React, { useState, useEffect, useCallback } from 'react';
import { api, getOrganizations } from '../../services/api';
import { Box, Typography, CircularProgress, Alert } from '@mui/material';
import OrganizationDialog from './OrganizationDialog';
import { formatPhoneNumber } from 'react-phone-number-input';
import DataTable, { DataTableRow } from '../gtacpr/DataTable';
import UserAvatar from '../gtacpr/UserAvatar';
import { PrimaryButton } from '../gtacpr/Buttons';
import LinkButton from '../gtacpr/LinkButton';
import { useConfirm } from '../gtacpr/ConfirmDialog';
import { useSnackbar } from '../../contexts/SnackbarContext';
import { getErrorMessage } from '../../utils/errorMessage';

const formatPhone = (phoneString: string | null | undefined) => {
  if (!phoneString) return '—';
  return formatPhoneNumber(phoneString) || phoneString;
};

const columns = [
  { key: 'org', label: 'ORGANIZATION', width: '1.6fr' },
  { key: 'contact', label: 'CONTACT', width: '1fr' },
  { key: 'email', label: 'EMAIL', width: '1.2fr' },
  { key: 'phone', label: 'PHONE', width: '1fr' },
  { key: 'address', label: 'ADDRESS', width: '1.4fr' },
  { key: 'actions', label: '', width: '0.6fr', align: 'right' as const },
];

function getInitials(name?: string): string {
  if (!name) return '?';
  return name.split(' ').map(p => p[0] || '').join('').slice(0, 2).toUpperCase();
}

interface Organization {
  id: number;
  organizationName?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  addressStreet?: string;
  addressCity?: string;
  addressProvince?: string;
}

function OrganizationManager() {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingOrg, setEditingOrg] = useState<Organization | null>(null);
  const { confirm, dialog: confirmDialog } = useConfirm();
  const { showSuccess, showError } = useSnackbar();

  const fetchOrganizations = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getOrganizations();
      setOrganizations(data || []);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to load organizations.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchOrganizations(); }, [fetchOrganizations]);

  const handleAddOpen = () => { setEditingOrg(null); setDialogOpen(true); };
  const handleEditOpen = (org: Organization) => { setEditingOrg(org); setDialogOpen(true); };
  const handleDelete = async (org: Organization) => {
    const name = org.organizationName || `organization #${org.id}`;
    const ok = await confirm({
      title: 'Delete organization?',
      message: `${name} will be deleted. Its users will lose access and this cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.delete(`/sysadmin/organizations/${org.id}`);
      showSuccess(`${name} deleted`);
      fetchOrganizations();
    } catch (err) {
      showError(getErrorMessage(err, 'Failed to delete organization'));
    }
  };
  const handleDialogClose = () => { setDialogOpen(false); setEditingOrg(null); };
  const handleDialogSave = () => {
    showSuccess(editingOrg ? 'Organization updated' : 'Organization added');
    fetchOrganizations();
  };

  const formatAddress = (org: Organization) => {
    const parts = [org.addressStreet, org.addressCity, org.addressProvince].filter(Boolean);
    return parts.length > 0 ? parts.join(', ') : '—';
  };

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
        <PrimaryButton onClick={handleAddOpen}>+ Add Organization</PrimaryButton>
      </Box>

      {organizations.length === 0 ? (
        <Box sx={{ bgcolor: (theme) => theme.palette.background.paper, border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', p: 6, textAlign: 'center' }}>
          <Typography sx={{ color: (theme) => theme.palette.text.secondary, fontSize: 14 }}>No organizations found.</Typography>
        </Box>
      ) : (
        <DataTable columns={columns} shownCount={organizations.length} totalCount={organizations.length}>
          {organizations.map(org => (
            <DataTableRow key={org.id} columns={columns}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                <UserAvatar initials={getInitials(org.organizationName)} />
                <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: (theme) => theme.palette.text.primary }}>{org.organizationName}</Typography>
              </Box>
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{org.contactName || '—'}</Typography>
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{org.contactEmail || '—'}</Typography>
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{formatPhone(org.contactPhone)}</Typography>
              <Typography sx={{ fontSize: 12.5, color: (theme) => theme.palette.text.secondary }}>{formatAddress(org)}</Typography>
              <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'flex-end' }}>
                <LinkButton onClick={() => handleEditOpen(org)} aria-label={`Edit ${org.organizationName}`}>Edit</LinkButton>
                <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.divider }}>|</Typography>
                <LinkButton tone="neutral" onClick={() => handleDelete(org)} aria-label={`Delete ${org.organizationName}`}>Delete</LinkButton>
              </Box>
            </DataTableRow>
          ))}
        </DataTable>
      )}

      <OrganizationDialog open={dialogOpen} onClose={handleDialogClose} onSave={handleDialogSave} organization={editingOrg} />
      {confirmDialog}
    </Box>
  );
}

export default OrganizationManager;
