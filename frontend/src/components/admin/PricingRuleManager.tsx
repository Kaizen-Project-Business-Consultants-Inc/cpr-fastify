import React, { useState, useEffect, useCallback } from 'react';
import * as api from '../../services/api';
import { Box, Typography, CircularProgress, Alert, Snackbar } from '@mui/material';
import PricingRuleDialog from './PricingRuleDialog';
import { formatCurrency } from '../../utils/formatters';
import logger from '../../utils/logger';
import DataTable, { DataTableRow } from '../gtacpr/DataTable';
import { PrimaryButton } from '../gtacpr/Buttons';
import LinkButton from '../gtacpr/LinkButton';
import { useConfirm } from '../gtacpr/ConfirmDialog';
import { getErrorMessage } from '../../utils/errorMessage';

interface PricingRule {
  pricingid: number;
  organizationid?: number | null;
  coursetypeid?: number | null;
  organizationname?: string;
  name?: string;
  price: number | string;
}

const columns = [
  { key: 'org', label: 'ORGANIZATION', width: '1.5fr' },
  { key: 'course', label: 'COURSE', width: '1.5fr' },
  { key: 'price', label: 'PRICE', width: '1fr', align: 'right' as const },
  { key: 'actions', label: '', width: '0.6fr', align: 'right' as const },
];

function PricingRuleManager() {
  const [pricingRules, setPricingRules] = useState<PricingRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' as 'success' | 'error' | 'warning' | 'info' });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<PricingRule | null>(null);
  const { confirm, dialog: confirmDialog } = useConfirm();

  const fetchPricingRules = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.getPricingRules();
      setPricingRules(data || []);
    } catch (err) {
      logger.error('Error fetching pricing rules:', err);
      setError(getErrorMessage(err, 'Failed to load pricing rules.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchPricingRules(); }, [fetchPricingRules]);

  const showSnackbar = (message: string, severity: 'success' | 'error' | 'warning' | 'info' = 'success') => {
    setSnackbar({ open: true, message, severity });
  };

  const handleAddOpen = () => { setEditingRule(null); setDialogOpen(true); };
  const handleEditOpen = (rule: PricingRule) => { setEditingRule(rule); setDialogOpen(true); };

  const handleDelete = async (rule: PricingRule) => {
    const id = rule.pricingid;
    const label = `${rule.organizationname || 'All organizations'} / ${rule.name || 'All course types'} (${formatCurrency(rule.price)})`;
    const ok = await confirm({
      title: 'Delete pricing rule?',
      message: `${label} will be removed. Future invoices for this organization and course will have no price until a new rule is added. This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      setError('');
      await api.deletePricingRule(id);
      showSnackbar('Pricing rule deleted.', 'success');
      fetchPricingRules();
    } catch (err) {
      logger.error(`Error deleting pricing rule ${id}:`, err);
      showSnackbar(getErrorMessage(err, 'Failed to delete pricing rule.'), 'error');
    }
  };

  const handleDialogClose = () => { setDialogOpen(false); setEditingRule(null); };
  const handleDialogSave = () => { showSnackbar(editingRule ? 'Pricing rule updated.' : 'Pricing rule added.', 'success'); fetchPricingRules(); };

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
        <PrimaryButton onClick={handleAddOpen}>+ Add Pricing Rule</PrimaryButton>
      </Box>

      {pricingRules.length === 0 ? (
        <Box sx={{ bgcolor: (theme) => theme.palette.background.paper, border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', p: 6, textAlign: 'center' }}>
          <Typography sx={{ color: (theme) => theme.palette.text.secondary, fontSize: 14 }}>No pricing rules found.</Typography>
        </Box>
      ) : (
        <DataTable columns={columns} shownCount={pricingRules.length} totalCount={pricingRules.length}>
          {pricingRules.map(rule => (
            <DataTableRow key={rule.pricingid} columns={columns}>
              <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: (theme) => theme.palette.text.primary }}>{rule.organizationname || 'All Orgs'}</Typography>
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{rule.name || 'All Types'}</Typography>
              <Typography sx={{ fontSize: 14, fontWeight: 700, color: (theme) => theme.palette.text.primary, fontFamily: 'monospace', textAlign: 'right' }}>{formatCurrency(rule.price)}</Typography>
              <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'flex-end' }}>
                <LinkButton onClick={() => handleEditOpen(rule)} aria-label={`Edit pricing rule ${rule.pricingid}`}>Edit</LinkButton>
                <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.divider }}>|</Typography>
                <LinkButton tone="neutral" onClick={() => handleDelete(rule)} aria-label={`Delete pricing rule ${rule.pricingid}`}>Delete</LinkButton>
              </Box>
            </DataTableRow>
          ))}
        </DataTable>
      )}

      <Snackbar open={snackbar.open} autoHideDuration={6000} onClose={() => setSnackbar({ ...snackbar, open: false })} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert onClose={() => setSnackbar({ ...snackbar, open: false })} severity={snackbar.severity} variant="filled" sx={{ width: '100%' }}>{snackbar.message}</Alert>
      </Snackbar>

      <PricingRuleDialog open={dialogOpen} onClose={handleDialogClose} onSave={handleDialogSave} rule={editingRule} />
      {confirmDialog}
    </Box>
  );
}

export default PricingRuleManager;
