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
  Chip,
  Rating,
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
import { formatDisplayDate } from '../../utils/formatters';
import { getErrorMessage } from '../../utils/errorMessage';
import type { SelectChangeEvent } from '@mui/material';

interface Vendor {
  id: string;
  vendorName: string;
  contactFirstName?: string;
  contactLastName?: string;
  email?: string;
  mobile?: string;
  phone?: string;
  addressStreet?: string;
  addressCity?: string;
  addressProvince?: string;
  addressPostalCode?: string;
  vendorType?: string;
  services?: string[];
  contractStartDate?: string;
  contractEndDate?: string;
  performanceRating?: number | null;
  insuranceExpiry?: string;
  certificationStatus?: string;
  billingContactEmail?: string;
  comments?: string;
  status: string;
}

const columns = [
  { key: 'vendor', label: 'VENDOR', width: '1.5fr' },
  { key: 'contact', label: 'CONTACT', width: '1fr' },
  { key: 'type', label: 'TYPE', width: '0.9fr' },
  { key: 'services', label: 'SERVICES', width: '1.2fr' },
  { key: 'rating', label: 'RATING', width: '0.7fr' },
  { key: 'cert', label: 'CERTIFICATION', width: '0.9fr' },
  { key: 'contract', label: 'CONTRACT', width: '0.9fr' },
  { key: 'status', label: 'STATUS', width: '0.7fr' },
  { key: 'actions', label: '', width: '0.5fr', align: 'right' as const },
];

const vendorTypes = ['Training Provider', 'Equipment Supplier', 'Certification Body', 'Consulting Services', 'Technology Provider', 'Facility Rental', 'Other'];
const serviceTypes = ['CPR Training', 'First Aid Training', 'BLS Training', 'Equipment Supply', 'Certification Services', 'Facility Rental', 'Technology Support', 'Consulting', 'Other'];
const certificationStatuses = ['Certified', 'Pending', 'Expired', 'Not Required', 'Under Review'];

function getCertKind(status: string): 'active' | 'warning' | 'danger' | 'neutral' | 'pending' {
  switch (status) {
    case 'Certified': return 'active';
    case 'Pending': case 'Under Review': return 'warning';
    case 'Expired': return 'danger';
    default: return 'neutral';
  }
}

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
  const [formData, setFormData] = useState<{
    vendorName: string; contactFirstName: string; contactLastName: string;
    email: string; mobile: string; phone: string; addressStreet: string;
    addressCity: string; addressProvince: string; addressPostalCode: string;
    vendorType: string; services: string[]; contractStartDate: string;
    contractEndDate: string; performanceRating: number | null;
    insuranceExpiry: string; certificationStatus: string;
    billingContactEmail: string; comments: string; status: string;
  }>({
    vendorName: '', contactFirstName: '', contactLastName: '',
    email: '', mobile: '', phone: '', addressStreet: '',
    addressCity: '', addressProvince: '', addressPostalCode: '',
    vendorType: '', services: [], contractStartDate: '',
    contractEndDate: '', performanceRating: 0,
    insuranceExpiry: '', certificationStatus: '',
    billingContactEmail: '', comments: '', status: 'active',
  });

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
    setFormData({
      vendorName: '', contactFirstName: '', contactLastName: '',
      email: '', mobile: '', phone: '', addressStreet: '',
      addressCity: '', addressProvince: '', addressPostalCode: '',
      vendorType: '', services: [], contractStartDate: '',
      contractEndDate: '', performanceRating: 0,
      insuranceExpiry: '', certificationStatus: '',
      billingContactEmail: '', comments: '', status: 'active',
    });
    setShowDialog(true);
  };

  const handleEdit = (vendor: Vendor) => {
    setEditingVendor(vendor);
    setFormData({
      vendorName: vendor.vendorName || '', contactFirstName: vendor.contactFirstName || '',
      contactLastName: vendor.contactLastName || '', email: vendor.email || '',
      mobile: vendor.mobile || '', phone: vendor.phone || '',
      addressStreet: vendor.addressStreet || '', addressCity: vendor.addressCity || '',
      addressProvince: vendor.addressProvince || '', addressPostalCode: vendor.addressPostalCode || '',
      vendorType: vendor.vendorType || '', services: vendor.services || [],
      contractStartDate: vendor.contractStartDate ? vendor.contractStartDate.split('T')[0] : '',
      contractEndDate: vendor.contractEndDate ? vendor.contractEndDate.split('T')[0] : '',
      performanceRating: vendor.performanceRating || 0,
      insuranceExpiry: vendor.insuranceExpiry ? vendor.insuranceExpiry.split('T')[0] : '',
      certificationStatus: vendor.certificationStatus || '',
      billingContactEmail: vendor.billingContactEmail || '',
      comments: vendor.comments || '', status: vendor.status || 'active',
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
      const submitData = {
        ...formData,
        contractStartDate: formData.contractStartDate || null,
        contractEndDate: formData.contractEndDate || null,
        insuranceExpiry: formData.insuranceExpiry || null,
        performanceRating: formData.performanceRating || null,
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
    const { name, value, checked, type } = e.target as HTMLInputElement;
    setFormData(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
  };

  const handleServicesChange = (e: SelectChangeEvent<string[]>) => {
    const { value } = e.target;
    setFormData(prev => ({ ...prev, services: typeof value === 'string' ? value.split(',') : value }));
  };

  const activeVendors = allVendors.filter(v => v.status === 'active');
  const certified = allVendors.filter(v => v.certificationStatus === 'Certified');
  const avgRating = allVendors.reduce((sum, v) => sum + (v.performanceRating || 0), 0) / (allVendors.length || 1);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Stat cards */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' }, gap: '16px' }}>
        <StatCard label="Total Vendors" value={grid.totalCount} sub="All records" dotColor="#4B5563" />
        <StatCard label="Active Vendors" value={activeVendors.length} sub="Currently active" dotColor="#16A34A" />
        <StatCard label="Certified" value={certified.length} sub="Valid certification" dotColor="#CC1F1F" />
        <StatCard label="Avg Rating" value={avgRating.toFixed(1)} sub="Performance score" dotColor="#ED6C02" />
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
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
                {`${vendor.contactFirstName || ''} ${vendor.contactLastName || ''}`.trim() || '—'}
              </Typography>
              {vendor.mobile && <Typography sx={{ fontSize: 11.5, color: (theme) => theme.palette.text.secondary }}>{vendor.mobile}</Typography>}
            </Box>
            {/* TYPE */}
            <Typography sx={{ fontSize: 12.5, color: (theme) => theme.palette.text.secondary }}>{vendor.vendorType || '—'}</Typography>
            {/* SERVICES */}
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
              {vendor.services && vendor.services.length > 0 ? (
                <>
                  {vendor.services.slice(0, 2).map((s: string, i: number) => (
                    <Chip key={i} label={s} size="small" sx={{ fontSize: 11, bgcolor: (theme) => theme.palette.divider, color: (theme) => theme.palette.text.secondary, height: 22 }} />
                  ))}
                  {vendor.services.length > 2 && (
                    <Chip label={`+${vendor.services.length - 2}`} size="small" sx={{ fontSize: 11, bgcolor: '#FFF0F0', color: '#CC1F1F', height: 22 }} />
                  )}
                </>
              ) : (
                <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.text.secondary }}>—</Typography>
              )}
            </Box>
            {/* RATING */}
            <Typography sx={{ fontSize: 13, fontWeight: 600, color: (theme) => theme.palette.text.primary }}>
              {vendor.performanceRating ? `${vendor.performanceRating}/5` : '—'}
            </Typography>
            {/* CERTIFICATION */}
            <StatusChip kind={getCertKind(vendor.certificationStatus || '')} label={vendor.certificationStatus || 'Not Set'} />
            {/* CONTRACT */}
            <Box>
              <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.text.secondary }}>{formatDisplayDate(vendor.contractStartDate)}</Typography>
              {vendor.contractEndDate && (
                <Typography sx={{ fontSize: 11, color: (theme) => theme.palette.text.secondary }}>to {formatDisplayDate(vendor.contractEndDate)}</Typography>
              )}
            </Box>
            {/* STATUS */}
            <StatusChip
              kind={vendor.status === 'active' ? 'active' : vendor.status === 'suspended' ? 'danger' : 'inactive'}
              label={vendor.status || 'active'}
            />
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

              <Grid item xs={12}><Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.07em', mt: 1 }}>Contact Information</Typography></Grid>
              <Grid item xs={12} sm={6}><TextField fullWidth label="Contact First Name" name="contactFirstName" value={formData.contactFirstName} onChange={handleChange} /></Grid>
              <Grid item xs={12} sm={6}><TextField fullWidth label="Contact Last Name" name="contactLastName" value={formData.contactLastName} onChange={handleChange} /></Grid>
              <Grid item xs={12} sm={6}><TextField fullWidth type="email" label="Email" name="email" value={formData.email} onChange={handleChange} /></Grid>
              <Grid item xs={12} sm={6}><TextField fullWidth label="Mobile" name="mobile" value={formData.mobile} onChange={handleChange} /></Grid>

              <Grid item xs={12}>
                <FormControl fullWidth><InputLabel>Services Provided</InputLabel>
                  <Select multiple name="services" value={formData.services} label="Services Provided" onChange={handleServicesChange}
                    renderValue={(selected: string[]) => (
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                        {selected.map((v: string) => <Chip key={v} label={v} size="small" />)}
                      </Box>
                    )}
                  >
                    {serviceTypes.map(s => <MenuItem key={s} value={s}>{s}</MenuItem>)}
                  </Select>
                </FormControl>
              </Grid>

              <Grid item xs={12}><Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.07em', mt: 1 }}>Contract & Performance</Typography></Grid>
              <Grid item xs={12} sm={6}><TextField fullWidth type="date" label="Contract Start" name="contractStartDate" value={formData.contractStartDate} onChange={handleChange} InputLabelProps={{ shrink: true }} /></Grid>
              <Grid item xs={12} sm={6}><TextField fullWidth type="date" label="Contract End" name="contractEndDate" value={formData.contractEndDate} onChange={handleChange} InputLabelProps={{ shrink: true }} /></Grid>
              <Grid item xs={12} sm={6}>
                <Box>
                  <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.text.secondary, mb: 0.5 }}>Performance Rating</Typography>
                  <Rating name="performanceRating" value={formData.performanceRating} onChange={(_, newValue) => setFormData(prev => ({ ...prev, performanceRating: newValue }))} />
                </Box>
              </Grid>
              <Grid item xs={12} sm={6}>
                <FormControl fullWidth><InputLabel>Certification Status</InputLabel>
                  <Select name="certificationStatus" value={formData.certificationStatus} label="Certification Status" onChange={handleChange}>
                    {certificationStatuses.map(s => <MenuItem key={s} value={s}>{s}</MenuItem>)}
                  </Select>
                </FormControl>
              </Grid>

              <Grid item xs={12}><TextField fullWidth multiline rows={3} label="Comments" name="comments" value={formData.comments} onChange={handleChange} /></Grid>
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
