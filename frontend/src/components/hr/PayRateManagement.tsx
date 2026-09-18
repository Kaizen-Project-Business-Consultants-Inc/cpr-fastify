import React, { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Typography,
  Tabs,
  Tab,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Grid,
  Alert,
  CircularProgress,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Checkbox,
  Card,
  TablePagination,
} from '@mui/material';
import { payRateService,
  PayRateTier,
  InstructorPayRateList,
  InstructorPayRateDetail,
  PayRateTierForm,
  InstructorPayRateForm,
  BulkPayRateUpdate
} from '../../services/payRateService';
import DataTable, { DataTableRow } from '../gtacpr/DataTable';
import StatusChip from '../gtacpr/StatusChip';
import SearchBar from '../gtacpr/SearchBar';
import LinkButton from '../gtacpr/LinkButton';
import { useConfirm } from '../gtacpr/ConfirmDialog';
import { PrimaryButton, GhostButton } from '../gtacpr/Buttons';
import { useSnackbar } from '../../contexts/SnackbarContext';
import { useDebounce } from '../../hooks/useDebounce';
import { formatCurrency, formatDisplayDate, getTodayDate } from '../../utils/formatters';

/** Dialog forms keep raw strings so fields can be cleared while typing; parsed on submit. */
interface MoneyFormFields { hourlyRate: string; courseBonus: string; }
const parseMoney = (v: string): number | null => {
  const n = parseFloat(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const emptyRateForm = () => ({ hourlyRate: '', courseBonus: '50', tierId: undefined as number | undefined, effectiveDate: getTodayDate(), notes: '', changeReason: '' });

const instructorColumns = [
  { key: 'select', label: '', width: '0.3fr' },
  { key: 'instructor', label: 'INSTRUCTOR', width: '1.2fr' },
  { key: 'contact', label: 'CONTACT', width: '0.8fr' },
  { key: 'rate', label: 'CURRENT RATE', width: '1fr' },
  { key: 'status', label: 'STATUS', width: '0.6fr' },
  { key: 'actions', label: '', width: '0.7fr', align: 'right' as const },
];

const historyColumns = [
  { key: 'change', label: 'RATE CHANGE', width: '1fr' },
  { key: 'bonus', label: 'BONUS CHANGE', width: '0.8fr' },
  { key: 'date', label: 'EFFECTIVE DATE', width: '0.8fr' },
  { key: 'reason', label: 'REASON', width: '1fr' },
  { key: 'by', label: 'CHANGED BY', width: '0.7fr' },
  { key: 'tier', label: 'TIER', width: '0.8fr' },
];

const PayRateManagement: React.FC = () => {
  const [activeTab, setActiveTab] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tiers, setTiers] = useState<PayRateTier[]>([]);
  const [tierDialogOpen, setTierDialogOpen] = useState(false);
  const [editingTier, setEditingTier] = useState<PayRateTier | null>(null);
  const [tierForm, setTierForm] = useState<{ name: string; description: string; baseHourlyRate: string; courseBonus: string }>({ name: '', description: '', baseHourlyRate: '', courseBonus: '50' });
  const [saving, setSaving] = useState(false);
  const { showSuccess, showError } = useSnackbar();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [instructors, setInstructors] = useState<InstructorPayRateList[]>([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 10, total: 0, pages: 0 });
  const [searchTerm, setSearchTerm] = useState('');
  const debouncedSearch = useDebounce(searchTerm, 300);
  const [hasRateFilter, setHasRateFilter] = useState<'true' | 'false' | ''>('');
  const [rateDialogOpen, setRateDialogOpen] = useState(false);
  const [selectedInstructor, setSelectedInstructor] = useState<InstructorPayRateList | null>(null);
  const [rateForm, setRateForm] = useState<Omit<InstructorPayRateForm, keyof MoneyFormFields> & MoneyFormFields>(emptyRateForm());
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false);
  const [selectedInstructors, setSelectedInstructors] = useState<number[]>([]);
  const [bulkForm, setBulkForm] = useState<Omit<BulkPayRateUpdate, keyof MoneyFormFields | 'instructorIds'> & MoneyFormFields>(emptyRateForm());
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false);
  const [instructorDetail, setInstructorDetail] = useState<InstructorPayRateDetail | null>(null);

  const loadTiers = useCallback(async () => {
    try { setLoading(true); const data = await payRateService.getTiers(); setTiers(data); }
    catch (err: unknown) { setError((err as { message?: string }).message || 'Failed to load tiers'); }
    finally { setLoading(false); }
  }, []);

  const loadInstructors = useCallback(async () => {
    try {
      setLoading(true);
      const data = await payRateService.getInstructors({ page: pagination.page, limit: pagination.limit, search: debouncedSearch, ...(hasRateFilter && { has_rate: hasRateFilter as 'true' | 'false' }) });
      setInstructors(data.instructors);
      setPagination(data.pagination);
    } catch (err: unknown) { setError((err as { message?: string }).message || 'Failed to load instructors'); }
    finally { setLoading(false); }
  }, [pagination.page, pagination.limit, debouncedSearch, hasRateFilter]);

  // Data fetch on mount / whenever the callback identity changes (i.e. its own deps
  // changed) — the standard fetch-on-mount pattern, not state derived from render.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadTiers(); }, [loadTiers]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadInstructors(); }, [loadInstructors]);

  const selectedNames = instructors.filter(i => selectedInstructors.includes(i.id)).map(i => i.username);

  const tierRate = parseMoney(tierForm.baseHourlyRate);
  const tierBonus = parseMoney(tierForm.courseBonus);
  const tierValid = tierForm.name.trim() !== '' && tierRate !== null && tierBonus !== null;

  const handleTierSubmit = async () => {
    if (saving || !tierValid || tierRate === null || tierBonus === null) return;
    const payload: PayRateTierForm = { name: tierForm.name.trim(), description: tierForm.description, baseHourlyRate: tierRate, courseBonus: tierBonus };
    try {
      setSaving(true);
      if (editingTier) { await payRateService.updateTier(editingTier.id, payload); }
      else { await payRateService.createTier(payload); }
      setTierDialogOpen(false);
      setEditingTier(null);
      setTierForm({ name: '', description: '', baseHourlyRate: '', courseBonus: '50' });
      showSuccess(editingTier ? 'Tier updated' : 'Tier created');
      loadTiers();
    } catch (err: unknown) { showError((err as { message?: string }).message || 'Failed to save tier'); }
    finally { setSaving(false); }
  };

  const rateHourly = parseMoney(rateForm.hourlyRate);
  const rateBonus = parseMoney(rateForm.courseBonus);
  const rateValid = rateHourly !== null && rateBonus !== null && rateForm.effectiveDate !== '';

  const handleRateSubmit = async () => {
    if (!selectedInstructor || saving || !rateValid || rateHourly === null || rateBonus === null) return;
    const ok = await confirm({
      title: 'Set pay rate?',
      message: `${selectedInstructor.username} will be paid ${formatCurrency(rateHourly)}/hr plus ${formatCurrency(rateBonus)} per course, effective ${formatDisplayDate(rateForm.effectiveDate)}.`,
      confirmLabel: 'Set rate',
    });
    if (!ok) return;
    const payload: InstructorPayRateForm = { ...rateForm, hourlyRate: rateHourly, courseBonus: rateBonus };
    try {
      setSaving(true);
      await payRateService.setInstructorRate(selectedInstructor.id, payload);
      setRateDialogOpen(false);
      setSelectedInstructor(null);
      setRateForm(emptyRateForm());
      showSuccess(`Pay rate set for ${selectedInstructor.username}`);
      loadInstructors();
    } catch (err: unknown) { showError((err as { message?: string }).message || 'Failed to set rate'); }
    finally { setSaving(false); }
  };

  const bulkHourly = parseMoney(bulkForm.hourlyRate);
  const bulkBonus = parseMoney(bulkForm.courseBonus);
  const bulkValid = bulkHourly !== null && bulkBonus !== null && bulkForm.effectiveDate !== '' && selectedInstructors.length > 0;

  const handleBulkSubmit = async () => {
    if (saving || !bulkValid || bulkHourly === null || bulkBonus === null) return;
    const count = selectedInstructors.length;
    const preview = selectedNames.slice(0, 5).join(', ') + (selectedNames.length > 5 ? ` and ${selectedNames.length - 5} more` : '');
    const ok = await confirm({
      title: `Update pay rates for ${count} instructor${count === 1 ? '' : 's'}?`,
      message: `${preview || `${count} instructors`} will be set to ${formatCurrency(bulkHourly)}/hr plus ${formatCurrency(bulkBonus)} per course, effective ${formatDisplayDate(bulkForm.effectiveDate)}.`,
      confirmLabel: `Update ${count}`,
      danger: true,
    });
    if (!ok) return;
    const payload: BulkPayRateUpdate = { ...bulkForm, instructorIds: selectedInstructors, hourlyRate: bulkHourly, courseBonus: bulkBonus };
    try {
      setSaving(true);
      await payRateService.bulkUpdateRates(payload);
      setBulkDialogOpen(false);
      setSelectedInstructors([]);
      setBulkForm(emptyRateForm());
      showSuccess(`Pay rates updated for ${count} instructor${count === 1 ? '' : 's'}`);
      loadInstructors();
    } catch (err: unknown) { showError((err as { message?: string }).message || 'Failed to update rates'); }
    finally { setSaving(false); }
  };

  const openRateDialog = (instructor: InstructorPayRateList) => {
    setSelectedInstructor(instructor);
    setRateForm({ ...emptyRateForm(), hourlyRate: instructor.hourlyRate != null ? String(instructor.hourlyRate) : '', courseBonus: instructor.courseBonus != null ? String(instructor.courseBonus) : '50' });
    setRateDialogOpen(true);
  };

  const openHistoryDialog = async (instructor: InstructorPayRateList) => {
    try {
      setLoading(true);
      const detail = await payRateService.getInstructorDetail(instructor.id);
      setInstructorDetail(detail);
      setHistoryDialogOpen(true);
    } catch (err: unknown) { setError((err as { message?: string }).message || 'Failed to load history'); }
    finally { setLoading(false); }
  };

  const openTierDialog = (tier?: PayRateTier) => {
    if (tier) { setEditingTier(tier); setTierForm({ name: tier.name, description: tier.description || '', baseHourlyRate: String(tier.baseHourlyRate), courseBonus: String(tier.courseBonus) }); }
    else { setEditingTier(null); setTierForm({ name: '', description: '', baseHourlyRate: '', courseBonus: '50' }); }
    setTierDialogOpen(true);
  };

  const handleInstructorSelection = (id: number, checked: boolean) => {
    setSelectedInstructors(checked ? [...selectedInstructors, id] : selectedInstructors.filter(i => i !== id));
  };

  if (loading && instructors.length === 0) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400 }}><CircularProgress size={48} /></Box>;
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {confirmDialog}
      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

      <Box sx={{ border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', bgcolor: (theme) => theme.palette.background.paper }}>
        <Box sx={{ borderBottom: 1, borderColor: (theme) => theme.palette.divider, px: 3, pt: 1 }}>
          <Tabs value={activeTab} onChange={(_, v) => setActiveTab(v)} sx={{
            '& .MuiTab-root': { textTransform: 'none', fontSize: 13, fontWeight: 600, color: (theme) => theme.palette.text.secondary, minHeight: 42 },
            '& .Mui-selected': { color: '#CC1F1F !important' },
            '& .MuiTabs-indicator': { backgroundColor: '#CC1F1F' },
          }}>
            <Tab label="Instructors" />
            <Tab label="Pay Rate Tiers" />
            <Tab label="Bulk Operations" />
          </Tabs>
        </Box>

        {/* Instructors Tab */}
        {activeTab === 0 && (
          <Box sx={{ p: 3 }}>
            <Box sx={{ display: 'flex', gap: 2, mb: 2, alignItems: 'center' }}>
              <SearchBar value={searchTerm} onChange={(v) => setSearchTerm(v)} placeholder="Search instructors..." />
              <FormControl sx={{ minWidth: 150 }}>
                <InputLabel id="rate-status-label">Rate Status</InputLabel>
                <Select labelId="rate-status-label" value={hasRateFilter} onChange={(e) => setHasRateFilter(e.target.value as 'true' | 'false' | '')} label="Rate Status" size="small">
                  <MenuItem value="">All</MenuItem>
                  <MenuItem value="true">Has Rate</MenuItem>
                  <MenuItem value="false">No Rate</MenuItem>
                </Select>
              </FormControl>
              <PrimaryButton onClick={() => setBulkDialogOpen(true)} disabled={selectedInstructors.length === 0}>
                Bulk Update ({selectedInstructors.length})
              </PrimaryButton>
            </Box>

            <DataTable columns={instructorColumns} shownCount={instructors.length} totalCount={pagination.total}>
              {instructors.map((instructor) => (
                <DataTableRow key={instructor.id} columns={instructorColumns}>
                  <Checkbox
                    checked={selectedInstructors.includes(instructor.id)}
                    onChange={(e) => handleInstructorSelection(instructor.id, e.target.checked)}
                    inputProps={{ 'aria-label': `Select ${instructor.username}` }}
                    sx={{ '&.Mui-checked': { color: '#CC1F1F' } }}
                  />
                  <Box>
                    <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: (theme) => theme.palette.text.primary }}>{instructor.username}</Typography>
                    <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.text.secondary }}>{instructor.email}</Typography>
                  </Box>
                  <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{instructor.phone || '—'}</Typography>
                  <Box>
                    {instructor.hourlyRate ? (
                      <>
                        <Typography sx={{ fontSize: 13, fontWeight: 600, fontFamily: 'monospace', color: (theme) => theme.palette.text.primary }}>{formatCurrency(instructor.hourlyRate)}/hr</Typography>
                        <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.text.secondary }}>+{formatCurrency(instructor.courseBonus)}/course</Typography>
                        {instructor.tierName && <StatusChip kind="brand" label={instructor.tierName} />}
                      </>
                    ) : (
                      <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>No rate set</Typography>
                    )}
                  </Box>
                  <StatusChip kind={instructor.rateStatus === 'Set' ? 'success' : 'warning'} label={instructor.rateStatus} />
                  <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
                    <LinkButton onClick={() => openRateDialog(instructor)} aria-label={`Edit pay rate for ${instructor.username}`}>Edit</LinkButton>
                    <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.divider }} aria-hidden="true">|</Typography>
                    <LinkButton onClick={() => openHistoryDialog(instructor)} aria-label={`Pay rate history for ${instructor.username}`}>History</LinkButton>
                  </Box>
                </DataTableRow>
              ))}
            </DataTable>

            <TablePagination
              component="div"
              count={pagination.total}
              page={pagination.page - 1}
              onPageChange={(_, newPage) => setPagination({ ...pagination, page: newPage + 1 })}
              rowsPerPage={pagination.limit}
              onRowsPerPageChange={(e) => setPagination({ ...pagination, limit: parseInt(e.target.value), page: 1 })}
            />
          </Box>
        )}

        {/* Tiers Tab */}
        {activeTab === 1 && (
          <Box sx={{ p: 3 }}>
            <Box sx={{ mb: 2 }}>
              <PrimaryButton onClick={() => openTierDialog()}>+ Add New Tier</PrimaryButton>
            </Box>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' }, gap: '16px' }}>
              {tiers.map((tier) => (
                <Card key={tier.id} sx={{ border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', boxShadow: '0 1px 3px rgba(0,0,0,.05)', p: 3 }}>
                  <Typography sx={{ fontSize: 16, fontWeight: 700, color: (theme) => theme.palette.text.primary, mb: 0.5 }}>{tier.name}</Typography>
                  <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary, mb: 1 }}>{tier.description}</Typography>
                  <Typography sx={{ fontSize: 24, fontWeight: 700, fontFamily: 'monospace', color: '#CC1F1F' }}>{formatCurrency(tier.baseHourlyRate)}/hr</Typography>
                  <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary, mb: 1 }}>+{formatCurrency(tier.courseBonus)} per course</Typography>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <StatusChip kind={tier.isActive ? 'active' : 'inactive'} label={tier.isActive ? 'Active' : 'Inactive'} />
                    <LinkButton onClick={() => openTierDialog(tier)} aria-label={`Edit tier ${tier.name}`}>Edit</LinkButton>
                  </Box>
                </Card>
              ))}
            </Box>
          </Box>
        )}

        {/* Bulk Operations Tab */}
        {activeTab === 2 && (
          <Box sx={{ p: 3 }}>
            <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.07em', mb: 1 }}>Bulk Pay Rate Operations</Typography>
            <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary, mb: 2 }}>Select multiple instructors from the Instructors tab and update their pay rates simultaneously.</Typography>
            <PrimaryButton onClick={() => setBulkDialogOpen(true)} disabled={selectedInstructors.length === 0}>
              Update {selectedInstructors.length} Selected Instructors
            </PrimaryButton>
          </Box>
        )}
      </Box>

      {/* Tier Dialog */}
      <Dialog open={tierDialogOpen} onClose={() => setTierDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontSize: 18, fontWeight: 700, color: (theme) => theme.palette.text.primary }}>{editingTier ? 'Edit Pay Rate Tier' : 'Create New Pay Rate Tier'}</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid item xs={12}><TextField fullWidth label="Tier Name" value={tierForm.name} onChange={(e) => setTierForm({ ...tierForm, name: e.target.value })} required /></Grid>
            <Grid item xs={12}><TextField fullWidth label="Description" value={tierForm.description} onChange={(e) => setTierForm({ ...tierForm, description: e.target.value })} multiline rows={2} /></Grid>
            <Grid item xs={6}><TextField fullWidth label="Base Hourly Rate ($)" type="number" value={tierForm.baseHourlyRate} onChange={(e) => setTierForm({ ...tierForm, baseHourlyRate: e.target.value })} inputProps={{ min: 0, step: 0.01 }} required error={tierForm.baseHourlyRate !== '' && tierRate === null} helperText={tierForm.baseHourlyRate !== '' && tierRate === null ? 'Enter a valid amount' : ' '} /></Grid>
            <Grid item xs={6}><TextField fullWidth label="Course Bonus ($)" type="number" value={tierForm.courseBonus} onChange={(e) => setTierForm({ ...tierForm, courseBonus: e.target.value })} inputProps={{ min: 0, step: 0.01 }} error={tierForm.courseBonus !== '' && tierBonus === null} helperText={tierForm.courseBonus !== '' && tierBonus === null ? 'Enter a valid amount' : ' '} /></Grid>
          </Grid>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <GhostButton onClick={() => setTierDialogOpen(false)} disabled={saving}>Cancel</GhostButton>
          <PrimaryButton onClick={handleTierSubmit} disabled={saving || !tierValid}>{saving ? 'Saving...' : 'Save'}</PrimaryButton>
        </DialogActions>
      </Dialog>

      {/* Rate Dialog */}
      <Dialog open={rateDialogOpen} onClose={() => setRateDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontSize: 18, fontWeight: 700, color: (theme) => theme.palette.text.primary }}>Set Pay Rate for {selectedInstructor?.username}</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid item xs={6}><TextField fullWidth label="Hourly Rate ($)" type="number" value={rateForm.hourlyRate} onChange={(e) => setRateForm({ ...rateForm, hourlyRate: e.target.value })} inputProps={{ min: 0, step: 0.01 }} required error={rateForm.hourlyRate !== '' && rateHourly === null} helperText={rateForm.hourlyRate !== '' && rateHourly === null ? 'Enter a valid amount' : ' '} /></Grid>
            <Grid item xs={6}><TextField fullWidth label="Course Bonus ($)" type="number" value={rateForm.courseBonus} onChange={(e) => setRateForm({ ...rateForm, courseBonus: e.target.value })} inputProps={{ min: 0, step: 0.01 }} error={rateForm.courseBonus !== '' && rateBonus === null} helperText={rateForm.courseBonus !== '' && rateBonus === null ? 'Enter a valid amount' : ' '} /></Grid>
            <Grid item xs={6}>
              <FormControl fullWidth><InputLabel id="rate-tier-label">Pay Rate Tier</InputLabel>
                <Select labelId="rate-tier-label" value={rateForm.tierId || ''} onChange={(e) => setRateForm({ ...rateForm, tierId: e.target.value ? Number(e.target.value) : undefined })} label="Pay Rate Tier">
                  <MenuItem value="">No Tier</MenuItem>
                  {tiers.map((tier) => <MenuItem key={tier.id} value={tier.id}>{tier.name} ({formatCurrency(tier.baseHourlyRate)}/hr)</MenuItem>)}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={6}><TextField fullWidth label="Effective Date" type="date" value={rateForm.effectiveDate} onChange={(e) => setRateForm({ ...rateForm, effectiveDate: e.target.value })} InputLabelProps={{ shrink: true }} required /></Grid>
            <Grid item xs={12}><TextField fullWidth label="Change Reason" value={rateForm.changeReason} onChange={(e) => setRateForm({ ...rateForm, changeReason: e.target.value })} multiline rows={2} /></Grid>
            <Grid item xs={12}><TextField fullWidth label="Notes" value={rateForm.notes} onChange={(e) => setRateForm({ ...rateForm, notes: e.target.value })} multiline rows={2} /></Grid>
          </Grid>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <GhostButton onClick={() => setRateDialogOpen(false)} disabled={saving}>Cancel</GhostButton>
          <PrimaryButton onClick={handleRateSubmit} disabled={saving || !rateValid}>{saving ? 'Saving...' : 'Save'}</PrimaryButton>
        </DialogActions>
      </Dialog>

      {/* Bulk Update Dialog */}
      <Dialog open={bulkDialogOpen} onClose={() => setBulkDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ fontSize: 18, fontWeight: 700, color: (theme) => theme.palette.text.primary }}>Bulk Update Pay Rates ({selectedInstructors.length} instructors)</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid item xs={6}><TextField fullWidth label="Hourly Rate ($)" type="number" value={bulkForm.hourlyRate} onChange={(e) => setBulkForm({ ...bulkForm, hourlyRate: e.target.value })} inputProps={{ min: 0, step: 0.01 }} required error={bulkForm.hourlyRate !== '' && bulkHourly === null} helperText={bulkForm.hourlyRate !== '' && bulkHourly === null ? 'Enter a valid amount' : ' '} /></Grid>
            <Grid item xs={6}><TextField fullWidth label="Course Bonus ($)" type="number" value={bulkForm.courseBonus} onChange={(e) => setBulkForm({ ...bulkForm, courseBonus: e.target.value })} inputProps={{ min: 0, step: 0.01 }} error={bulkForm.courseBonus !== '' && bulkBonus === null} helperText={bulkForm.courseBonus !== '' && bulkBonus === null ? 'Enter a valid amount' : ' '} /></Grid>
            <Grid item xs={6}>
              <FormControl fullWidth><InputLabel id="bulk-tier-label">Pay Rate Tier</InputLabel>
                <Select labelId="bulk-tier-label" value={bulkForm.tierId || ''} onChange={(e) => setBulkForm({ ...bulkForm, tierId: e.target.value ? Number(e.target.value) : undefined })} label="Pay Rate Tier">
                  <MenuItem value="">No Tier</MenuItem>
                  {tiers.map((tier) => <MenuItem key={tier.id} value={tier.id}>{tier.name} ({formatCurrency(tier.baseHourlyRate)}/hr)</MenuItem>)}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={6}><TextField fullWidth label="Effective Date" type="date" value={bulkForm.effectiveDate} onChange={(e) => setBulkForm({ ...bulkForm, effectiveDate: e.target.value })} InputLabelProps={{ shrink: true }} required /></Grid>
            <Grid item xs={12}><TextField fullWidth label="Change Reason" value={bulkForm.changeReason} onChange={(e) => setBulkForm({ ...bulkForm, changeReason: e.target.value })} multiline rows={2} /></Grid>
            <Grid item xs={12}><TextField fullWidth label="Notes" value={bulkForm.notes} onChange={(e) => setBulkForm({ ...bulkForm, notes: e.target.value })} multiline rows={2} /></Grid>
          </Grid>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <GhostButton onClick={() => setBulkDialogOpen(false)} disabled={saving}>Cancel</GhostButton>
          <PrimaryButton onClick={handleBulkSubmit} disabled={saving || !bulkValid}>
            {saving ? 'Updating...' : `Update ${selectedInstructors.length} Instructors`}
          </PrimaryButton>
        </DialogActions>
      </Dialog>

      {/* History Dialog */}
      <Dialog open={historyDialogOpen} onClose={() => setHistoryDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ fontSize: 18, fontWeight: 700, color: (theme) => theme.palette.text.primary }}>Pay Rate History — {instructorDetail?.instructor.username}</DialogTitle>
        <DialogContent>
          {instructorDetail && (
            <Box sx={{ pt: 1 }}>
              <Box sx={{ p: 2, bgcolor: (theme) => theme.palette.background.default, borderRadius: '8px', border: (theme) => `1px solid ${theme.palette.divider}`, mb: 2 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.07em', mb: 1 }}>Current Rate</Typography>
                {instructorDetail.currentRate ? (
                  <>
                    <Typography sx={{ fontSize: 24, fontWeight: 700, fontFamily: 'monospace', color: '#CC1F1F' }}>{formatCurrency(instructorDetail.currentRate.hourlyRate)}/hr</Typography>
                    <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>+{formatCurrency(instructorDetail.currentRate.courseBonus)} per course</Typography>
                    <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.text.secondary }}>Effective: {formatDisplayDate(instructorDetail.currentRate.effectiveDate)}</Typography>
                  </>
                ) : (
                  <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>No current rate set</Typography>
                )}
              </Box>

              <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.07em', mb: 1 }}>Rate History</Typography>
              <DataTable columns={historyColumns} shownCount={instructorDetail.history.length} totalCount={instructorDetail.history.length}>
                {instructorDetail.history.map((change) => (
                  <DataTableRow key={change.id} columns={historyColumns}>
                    <Typography sx={{ fontSize: 13, fontFamily: 'monospace', color: (theme) => theme.palette.text.primary }}>{formatCurrency(change.oldHourlyRate ?? 0)} → {formatCurrency(change.newHourlyRate)}/hr</Typography>
                    <Typography sx={{ fontSize: 13, fontFamily: 'monospace', color: (theme) => theme.palette.text.secondary }}>{formatCurrency(change.oldCourseBonus ?? 0)} → {formatCurrency(change.newCourseBonus)}</Typography>
                    <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{formatDisplayDate(change.effectiveDate)}</Typography>
                    <Typography sx={{ fontSize: 12.5, color: (theme) => theme.palette.text.secondary }}>{change.changeReason || '—'}</Typography>
                    <Typography sx={{ fontSize: 12.5, color: (theme) => theme.palette.text.secondary }}>{change.changedByName || '—'}</Typography>
                    <Box sx={{ display: 'flex', gap: 0.5 }}>
                      <StatusChip kind="neutral" label={change.oldTierName || 'None'} />
                      <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.text.secondary }}>→</Typography>
                      <StatusChip kind="brand" label={change.newTierName || 'None'} />
                    </Box>
                  </DataTableRow>
                ))}
              </DataTable>
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <GhostButton onClick={() => setHistoryDialogOpen(false)}>Close</GhostButton>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default PayRateManagement;
