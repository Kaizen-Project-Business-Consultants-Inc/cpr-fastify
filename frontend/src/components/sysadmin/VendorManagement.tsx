import React, { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Typography,
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
import api from '../../services/api';
import logger from '../../utils/logger';
import DataTable, { DataTableRow } from '../gtacpr/DataTable';
import StatusChip from '../gtacpr/StatusChip';
import StatCard from '../gtacpr/StatCard';
import { PrimaryButton } from '../gtacpr/Buttons';
import { useConfirm, LinkButton } from '../gtacpr';
import { useServerPagination } from '../../hooks/useServerPagination';
import { getErrorMessage } from '../../utils/errorMessage';
import type { SelectChangeEvent } from '@mui/material';

// GET /sysadmin/vendors: only what the vendors table really holds.
interface Vendor {
  id: number;
  vendorName: string;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  vendorType?: string | null;
  notes?: string | null;
  isActive: boolean;
  status: 'active' | 'inactive';
}

interface VendorForm {
  vendorName: string; contactName: string; email: string; phone: string;
  address: string; vendorType: string; notes: string; status: 'active' | 'inactive';
}

const emptyForm: VendorForm = {
  vendorName: '', contactName: '', email: '', phone: '',
  address: '', vendorType: '', notes: '', status: 'active',
};

const columns = [
  { key: 'vendor', label: 'VENDOR', width: '1.5fr' },
  { key: 'contact', label: 'CONTACT', width: '1.2fr' },
  { key: 'type', label: 'TYPE', width: '1fr' },
  { key: 'address', label: 'ADDRESS', width: '1.4fr' },
  { key: 'status', label: 'STATUS', width: '0.7fr' },
  { key: 'actions', label: '', width: '0.7fr', align: 'right' as const },
];

const vendorTypes = ['Training Provider', 'Equipment Supplier', 'Certification Body', 'Consulting Services', 'Technology Provider', 'Facility Rental', 'Other'];

const VendorManagement = ({ onShowSnackbar }: { onShowSnackbar?: (message: string, severity?: 'success' | 'error') => void }) => {
  // `/sysadmin/vendors` supports page/limit but no search or filter params,
  // and this screen has never had a search box, so there is nothing to filter.
  const grid = useServerPagination<Vendor>({
    pageSize: 25,
    fetchFn: ({ page, limit }) =>
      api.get('/sysadmin/vendors', { params: { page, limit } }).then(r => r.data),
    onError: (err) => {
      logger.error('Error loading vendors:', err);
      onShowSnackbar?.('Failed to load vendors', 'error');
    },
  });
  const vendors = grid.items;

  // The stat cards summarise every vendor, not just the page on screen, and
  // there is no aggregate endpoint — so they come from a separate unpaginated
  // call (the same call this screen used to make for the whole table).
  const [allVendors, setAllVendors] = useState<Vendor[]>([]);
  const [saving, setSaving] = useState(false);
  const { confirm, dialog: confirmDialog } = useConfirm();

  const [showDialog, setShowDialog] = useState(false);
  const [editingVendor, setEditingVendor] = useState<Vendor | null>(null);
  const [formData, setFormData] = useState<VendorForm>(emptyForm);

  const loadVendors = grid.load;
  useEffect(() => { loadVendors(1); }, [loadVendors]);

  const loadStats = useCallback(async () => {
    try {
      const response = await sysAdminApi.getVendors();
      setAllVendors(response.data || []);
    } catch (err) {
      logger.error('Error loading vendor stats:', err);
    }
  }, []);

  // Mount-time fetch of the unpaginated vendor list for the stat cards
  // (external API sync, not state derived from render data), so a direct
  // setState inside is expected.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadStats(); }, [loadStats]);

  const handleAddNew = () => {
    setEditingVendor(null);
    setFormData(emptyForm);
    setShowDialog(true);
  };

  const handleEdit = (vendor: Vendor) => {
    setEditingVendor(vendor);
    setFormData({
      vendorName: vendor.vendorName || '', contactName: vendor.contactName || '',
      email: vendor.email || '', phone: vendor.phone || '', address: vendor.address || '',
      vendorType: vendor.vendorType || '', notes: vendor.notes || '',
      status: vendor.isActive ? 'active' : 'inactive',
    });
    setShowDialog(true);
  };

  const handleDeactivate = async (vendor: Vendor) => {
    const ok = await confirm({
      title: 'Deactivate vendor?',
      message: `"${vendor.vendorName}" will be marked inactive and hidden from vendor selection. You can reactivate it by editing the vendor.`,
      confirmLabel: 'Deactivate',
      danger: true,
    });
    if (!ok) return;
    try {
      await sysAdminApi.deleteVendor(Number(vendor.id));
      onShowSnackbar?.('Vendor deactivated successfully', 'success');
      grid.reload();
      loadStats();
    } catch (err) {
      logger.error('Error deactivating vendor:', err);
      onShowSnackbar?.('Failed to deactivate vendor', 'error');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.vendorName.trim()) { onShowSnackbar?.('Vendor name is required', 'error'); return; }
    if (saving) return;
    try {
      setSaving(true);
      // The server takes the vendors table's own column names.
      const submitData = {
        name: formData.vendorName.trim(),
        contact_name: formData.contactName,
        contact_email: formData.email.trim(),
        contact_phone: formData.phone,
        address: formData.address,
        vendor_type: formData.vendorType,
        notes: formData.notes,
        is_active: formData.status === 'active',
      };
      const isEdit = Boolean(editingVendor);
      if (isEdit && editingVendor) {
        await sysAdminApi.updateVendor(Number(editingVendor.id), submitData);
        onShowSnackbar?.('Vendor updated successfully', 'success');
      } else {
        await sysAdminApi.createVendor(submitData);
        onShowSnackbar?.('Vendor created successfully', 'success');
      }
      setShowDialog(false);
      if (isEdit) grid.reload(); else grid.load(1);
      loadStats();
    } catch (err) {
      logger.error('Error saving vendor:', err);
      onShowSnackbar?.(getErrorMessage(err, 'Failed to save vendor'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement> | SelectChangeEvent) => {
    const { name, value } = e.target as HTMLInputElement;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const activeVendors = allVendors.filter(v => v.isActive);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Stat cards */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' }, gap: '16px' }}>
        <StatCard label="Total Vendors" value={grid.totalCount} sub="All records" dotColor="#4B5563" />
        <StatCard label="Active Vendors" value={activeVendors.length} sub="Currently active" dotColor="#16A34A" />
        <StatCard label="Inactive Vendors" value={allVendors.length - activeVendors.length} sub="Deactivated" dotColor="#ED6C02" />
      </Box>

      {/* Action bar */}
      <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
        <PrimaryButton onClick={handleAddNew}>+ New Vendor</PrimaryButton>
      </Box>

      {/* Table */}
      <DataTable
        columns={columns}
        shownCount={grid.shownCount}
        totalCount={grid.totalCount}
        page={grid.page}
        onPrevPage={grid.onPrevPage}
        onNextPage={grid.onNextPage}
        hasNextPage={grid.hasNextPage}
        loading={grid.loading}
        emptyMessage="No vendors found."
      >
        {vendors.map(vendor => (
          <DataTableRow key={vendor.id} columns={columns}>
            {/* VENDOR */}
            <Box>
              <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: (theme) => theme.palette.text.primary }}>{vendor.vendorName}</Typography>
              {vendor.email && <Typography sx={{ fontSize: 11.5, color: (theme) => theme.palette.text.secondary }}>{vendor.email}</Typography>}
            </Box>
            {/* CONTACT */}
            <Box>
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{vendor.contactName || '—'}</Typography>
              {vendor.phone && <Typography sx={{ fontSize: 11.5, color: (theme) => theme.palette.text.secondary }}>{vendor.phone}</Typography>}
            </Box>
            {/* TYPE */}
            <Typography sx={{ fontSize: 12.5, color: (theme) => theme.palette.text.secondary }}>{vendor.vendorType || '—'}</Typography>
            {/* ADDRESS */}
            <Typography sx={{ fontSize: 12.5, color: (theme) => theme.palette.text.secondary }}>{vendor.address || '—'}</Typography>
            {/* STATUS */}
            <StatusChip kind={vendor.isActive ? 'active' : 'inactive'} label={vendor.status} />
            {/* ACTIONS */}
            <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'flex-end' }}>
              <LinkButton onClick={() => handleEdit(vendor)} aria-label={`Edit ${vendor.vendorName}`}>Edit</LinkButton>
              {vendor.status !== 'inactive' && (
                <>
                  <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.divider }}>|</Typography>
                  <LinkButton tone="neutral" onClick={() => handleDeactivate(vendor)} aria-label={`Deactivate ${vendor.vendorName}`}>Deactivate</LinkButton>
                </>
              )}
            </Box>
          </DataTableRow>
        ))}
      </DataTable>

      {/* Add/Edit Vendor Dialog */}
      <Dialog open={showDialog} onClose={() => setShowDialog(false)} maxWidth="lg" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>{editingVendor ? 'Edit Vendor' : 'Add New Vendor'}</DialogTitle>
        <DialogContent>
          <Box component="form" onSubmit={handleSubmit} sx={{ mt: 2 }}>
            <Grid container spacing={2}>
              <Grid item xs={12}><Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Basic Information</Typography></Grid>
              <Grid item xs={12} sm={6}><TextField fullWidth required label="Vendor Name" name="vendorName" value={formData.vendorName} onChange={handleChange} /></Grid>
              <Grid item xs={12} sm={6}>
                <FormControl fullWidth><InputLabel>Vendor Type</InputLabel>
                  <Select name="vendorType" value={formData.vendorType} label="Vendor Type" onChange={handleChange}>
                    {vendorTypes.map(t => <MenuItem key={t} value={t}>{t}</MenuItem>)}
                  </Select>
                </FormControl>
              </Grid>

              <Grid item xs={12} sm={6}>
                <FormControl fullWidth><InputLabel>Status</InputLabel>
                  <Select name="status" value={formData.status} label="Status" onChange={handleChange}>
                    <MenuItem value="active">Active</MenuItem>
                    <MenuItem value="inactive">Inactive</MenuItem>
                  </Select>
                </FormControl>
              </Grid>

              <Grid item xs={12}><Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.07em', mt: 1 }}>Contact Information</Typography></Grid>
              <Grid item xs={12} sm={6}><TextField fullWidth label="Contact Name" name="contactName" value={formData.contactName} onChange={handleChange} /></Grid>
              <Grid item xs={12} sm={6}><TextField fullWidth type="email" label="Email" name="email" value={formData.email} onChange={handleChange} /></Grid>
              <Grid item xs={12} sm={6}><TextField fullWidth label="Phone" name="phone" value={formData.phone} onChange={handleChange} inputProps={{ maxLength: 20 }} /></Grid>
              <Grid item xs={12}><TextField fullWidth label="Address" name="address" value={formData.address} onChange={handleChange} /></Grid>

              <Grid item xs={12}><TextField fullWidth multiline rows={3} label="Notes" name="notes" value={formData.notes} onChange={handleChange} /></Grid>
            </Grid>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowDialog(false)} disabled={saving}>Cancel</Button>
          <Button onClick={handleSubmit} variant="contained" disabled={saving}>{saving ? 'Saving…' : editingVendor ? 'Update Vendor' : 'Create Vendor'}</Button>
        </DialogActions>
      </Dialog>
      {confirmDialog}
    </Box>
  );
};

export default VendorManagement;
