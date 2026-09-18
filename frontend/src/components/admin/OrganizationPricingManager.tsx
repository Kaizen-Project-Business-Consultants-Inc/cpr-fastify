import React, { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Typography,
  CircularProgress,
  Alert,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Snackbar,
} from '@mui/material';
import OrganizationPricingDialog from './OrganizationPricingDialog';
import * as api from '../../services/api';
import logger from '../../utils/logger';
import DataTable, { DataTableRow } from '../gtacpr/DataTable';
import StatusChip from '../gtacpr/StatusChip';
import { PrimaryButton, GhostButton } from '../gtacpr/Buttons';
import { useConfirm } from '../gtacpr/ConfirmDialog';

interface OrganizationPricing {
  id: number;
  organizationId: number;
  classTypeId: number;
  pricePerStudent: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy?: number;
  lastModifiedBy?: number;
  deletedAt?: string;
  organizationName?: string;
  classTypeName?: string;
}

interface Organization { id: number; name: string; }
interface ClassType { id: number; name: string; }

const columns = [
  { key: 'org', label: 'ORGANIZATION', width: '1.5fr' },
  { key: 'type', label: 'CLASS TYPE', width: '1.3fr' },
  { key: 'price', label: 'PRICE / STUDENT', width: '1fr' },
  { key: 'status', label: 'STATUS', width: '0.7fr' },
  { key: 'updated', label: 'LAST UPDATED', width: '1fr' },
  { key: 'actions', label: '', width: '0.6fr', align: 'right' as const },
];

function OrganizationPricingManager() {
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [pricingData, setPricingData] = useState<OrganizationPricing[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [classTypes, setClassTypes] = useState<ClassType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' as 'success' | 'error' | 'warning' | 'info' });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPricing, setEditingPricing] = useState<OrganizationPricing | null>(null);

  const [filterOrg, setFilterOrg] = useState('');
  const [filterClassType, setFilterClassType] = useState('');
  const [order, setOrder] = useState<'asc' | 'desc'>('asc');
  const [orderBy, setOrderBy] = useState('organizationName');

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [pricingResponse, orgsResponse, typesResponse] = await Promise.all([
        api.getCoursePricing(), api.getOrganizations(), api.getClassTypes(),
      ]);
      setPricingData(Array.isArray(pricingResponse) ? pricingResponse : []);
      setOrganizations(Array.isArray(orgsResponse) ? orgsResponse : []);
      setClassTypes(Array.isArray(typesResponse) ? typesResponse : []);
    } catch (err: unknown) {
      logger.error('Error fetching organization pricing data:', err);
      const errObj = err as { message?: string };
      setError(errObj.message || 'Failed to load data.');
      setPricingData([]); setOrganizations([]); setClassTypes([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleAddOpen = () => { setEditingPricing(null); setDialogOpen(true); };
  const handleEditOpen = (pricing: OrganizationPricing) => { setEditingPricing(pricing); setDialogOpen(true); };

  const handleDelete = async (id: number) => {
    const target = pricingData.find((p) => p.id === id);
    const ok = await confirm({
      title: 'Delete pricing record?',
      message: `${target?.organizationName || 'This organization'} / ${target?.classTypeName || 'course'} pricing will be removed. This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (ok) {
      try {
        setError('');
        await api.deleteCoursePricing(id);
        setPricingData(pricingData.filter(p => p.id !== id));
        showSnackbar('Pricing record deleted successfully.', 'success');
      } catch (err: unknown) {
        logger.error(`Error deleting organization pricing ${id}:`, err);
        const errObj = err as { message?: string };
        showSnackbar(errObj.message || 'Failed to delete pricing record.', 'error');
      }
    }
  };

  const showSnackbar = (message: string, severity: 'success' | 'error' | 'warning' | 'info' = 'success') => {
    setSnackbar({ open: true, message, severity });
  };

  const handleDialogClose = () => { setDialogOpen(false); setEditingPricing(null); };
  const handleDialogSave = () => { fetchData(); };

  const getProcessedData = () => {
    if (!Array.isArray(pricingData)) return [];
    let filtered = [...pricingData];
    if (filterOrg) filtered = filtered.filter(p => p.organizationId === parseInt(filterOrg, 10));
    if (filterClassType) filtered = filtered.filter(p => p.classTypeId === parseInt(filterClassType, 10));

    filtered.sort((a, b) => {
      let compareA: string | number, compareB: string | number;
      switch (orderBy) {
        case 'organizationName': compareA = a.organizationName || ''; compareB = b.organizationName || ''; break;
        case 'classTypeName': compareA = a.classTypeName || ''; compareB = b.classTypeName || ''; break;
        case 'pricePerStudent': compareA = Number(a.pricePerStudent) || 0; compareB = Number(b.pricePerStudent) || 0; break;
        default: compareA = a.id; compareB = b.id;
      }
      if (compareB < compareA) return order === 'asc' ? 1 : -1;
      if (compareB > compareA) return order === 'asc' ? -1 : 1;
      return 0;
    });
    return filtered;
  };

  const processedData = getProcessedData();

  const formatCurrency = (amount: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
  const formatDate = (dateString: string) => new Date(dateString).toLocaleDateString();

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400 }}>
        <CircularProgress size={48} />
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {error && <Alert severity="error" sx={{ mb: 0 }}>{error}</Alert>}

      {/* Toolbar */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <FormControl size="small" sx={{ minWidth: 200 }}>
          <InputLabel>Organization</InputLabel>
          <Select value={filterOrg} label="Organization" onChange={(e) => setFilterOrg(e.target.value)}>
            <MenuItem value="">All Organizations</MenuItem>
            {Array.isArray(organizations) && organizations.map(org => (
              <MenuItem key={org?.id || 'unknown'} value={(org?.id || '').toString()}>{org?.name || 'Unknown'}</MenuItem>
            ))}
          </Select>
        </FormControl>

        <FormControl size="small" sx={{ minWidth: 200 }}>
          <InputLabel>Class Type</InputLabel>
          <Select value={filterClassType} label="Class Type" onChange={(e) => setFilterClassType(e.target.value)}>
            <MenuItem value="">All Class Types</MenuItem>
            {Array.isArray(classTypes) && classTypes.map(type => (
              <MenuItem key={type?.id || 'unknown'} value={(type?.id || '').toString()}>{type?.name || 'Unknown'}</MenuItem>
            ))}
          </Select>
        </FormControl>

        <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.text.secondary, flex: 1 }}>
          {processedData.length} pricing rule{processedData.length !== 1 ? 's' : ''}
        </Typography>

        <GhostButton onClick={fetchData}>Refresh</GhostButton>
        <PrimaryButton onClick={handleAddOpen}>+ Add Pricing</PrimaryButton>
      </Box>

      {/* Table */}
      {processedData.length === 0 ? (
        <Box sx={{ bgcolor: (theme) => theme.palette.background.paper, border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', p: 6, textAlign: 'center' }}>
          <Typography sx={{ color: (theme) => theme.palette.text.secondary, fontSize: 14 }}>No pricing records found</Typography>
        </Box>
      ) : (
        <DataTable columns={columns} shownCount={processedData.length} totalCount={pricingData.length}>
          {processedData.map(pricing => (
            <DataTableRow key={pricing.id} columns={columns}>
              {/* ORGANIZATION */}
              <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: (theme) => theme.palette.text.primary }}>
                {pricing.organizationName || 'Unknown'}
              </Typography>
              {/* CLASS TYPE */}
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
                {pricing.classTypeName || 'Unknown'}
              </Typography>
              {/* PRICE */}
              <Typography sx={{ fontSize: 14, fontWeight: 700, color: (theme) => theme.palette.text.primary, fontFamily: 'monospace' }}>
                {formatCurrency(pricing.pricePerStudent)}
              </Typography>
              {/* STATUS */}
              <StatusChip kind={pricing.isActive ? 'active' : 'inactive'} label={pricing.isActive ? 'Active' : 'Inactive'} />
              {/* UPDATED */}
              <Typography sx={{ fontSize: 12.5, color: (theme) => theme.palette.text.secondary }}>
                {formatDate(pricing.updatedAt)}
              </Typography>
              {/* ACTIONS */}
              <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'flex-end' }}>
                <Box onClick={() => handleEditOpen(pricing)} sx={{ fontSize: 12, fontWeight: 600, color: '#CC1F1F', cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}>
                  Edit
                </Box>
                <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.divider }}>|</Typography>
                <Box onClick={() => handleDelete(pricing.id)} sx={{ fontSize: 12, fontWeight: 600, color: (theme) => theme.palette.text.secondary, cursor: 'pointer', '&:hover': { textDecoration: 'underline', color: '#CC1F1F' } }}>
                  Delete
                </Box>
              </Box>
            </DataTableRow>
          ))}
        </DataTable>
      )}

      <OrganizationPricingDialog
        open={dialogOpen}
        onClose={handleDialogClose}
        onSave={handleDialogSave}
        pricing={editingPricing}
        organizations={organizations}
        classTypes={classTypes}
      />

      <Snackbar open={snackbar.open} autoHideDuration={6000} onClose={() => setSnackbar({ ...snackbar, open: false })}>
        <Alert onClose={() => setSnackbar({ ...snackbar, open: false })} severity={snackbar.severity} sx={{ width: '100%' }}>
          {snackbar.message}
        </Alert>
      </Snackbar>
      {confirmDialog}
    </Box>
  );
}

export default OrganizationPricingManager;
