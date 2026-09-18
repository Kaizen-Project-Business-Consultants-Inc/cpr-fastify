import React, { useState, useEffect, useCallback } from 'react';
import * as api from '../../services/api';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Alert,
  CircularProgress,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  FormHelperText,
  Box,
  InputAdornment,
} from '@mui/material';
import Grid2 from '@mui/material/Unstable_Grid2';
import logger from '../../utils/logger';

const initialRuleState = {
  organizationId: '',
  courseTypeId: '',
  price: '', // Store as string for TextField
};

function PricingRuleDialog({ open, onClose, onSave, rule }: { open: any; onClose: any; onSave: any; rule: any }) {
  const [formData, setFormData] = useState(initialRuleState);
  const [organizations, setOrganizations] = useState<any[]>([]);
  const [courseTypes, setCourseTypes] = useState<any[]>([]);
  const [loadingLists, setLoadingLists] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | boolean>>({});
  const isEditMode = Boolean(rule?.pricingid);

  // Fetch lists needed for dropdowns
  const fetchLists = useCallback(async () => {
    setLoadingLists(true);
    try {
      const [orgData, typeData] = await Promise.all([
        api.getOrganizations(),
        api.getCourseTypes(),
      ]);
      setOrganizations(orgData || []);
      setCourseTypes(typeData || []);
    } catch (fetchErr) {
      logger.error('Error fetching lists for pricing dialog:', fetchErr);
      setError('Failed to load required data');
      setOrganizations([]);
      setCourseTypes([]);
    }
    setLoadingLists(false);
  }, []);

  useEffect(() => {
    if (open) {
      fetchLists();
      if (isEditMode && rule) {
        setFormData({
          // For edit, Org and Course Type are usually fixed, only price is changed
          organizationId: rule.organizationid
            ? String(rule.organizationid)
            : '',
          courseTypeId: rule.coursetypeid ? String(rule.coursetypeid) : '',
          price:
            rule.price !== null ? String(Number(rule.price).toFixed(2)) : '', // Format price
        });
      } else {
        setFormData(initialRuleState);
      }
      setError('');
      setFieldErrors({});
    }
  }, [rule, isEditMode, open, fetchLists]);

  const handleChange = (event: any) => {
    const { name, value } = event.target;
    // Allow only numbers and one decimal point for price
    if (name === 'price' && value && !/^[0-9]*\.?[0-9]{0,2}$/.test(value)) {
      return;
    }
    setFormData(prevData => ({
      ...prevData,
      [name]: value,
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
    let hasClientError = false;
    const newFieldErrors: Record<string, string> = {};

    // Client-side validation
    if (!formData.organizationId)
      newFieldErrors.organizationId = 'Organization required';
    if (!formData.courseTypeId)
      newFieldErrors.courseTypeId = 'Course Type required';
    if (
      !formData.price ||
      isNaN(parseFloat(formData.price)) ||
      parseFloat(formData.price) < 0
    ) {
      newFieldErrors.price = 'Valid price required';
    }

    if (Object.keys(newFieldErrors).length > 0) {
      setError('Please fix highlighted field(s).');
      setFieldErrors(newFieldErrors);
      hasClientError = true;
      return;
    }

    setLoading(true);
    try {
      // Prepare data for API
      const dataToSend = {
        organizationId: parseInt(formData.organizationId, 10),
        courseTypeId: parseInt(formData.courseTypeId, 10),
        price: parseFloat(formData.price),
      };

      if (isEditMode) {
        // Update pricing rule with new data
        await api.updatePricingRule(rule.pricingid, dataToSend);
      } else {
        await api.addPricingRule(dataToSend);
      }
      onSave();
      onClose();
    } catch (err: any) {
      logger.error('Save pricing rule error:', err);
      const message = err.message || 'Failed to save rule.';
      setError('Failed to save. Please fix highlighted field(s).');

      const tempFieldErrors: Record<string, string> = {};
      if (message.toLowerCase().includes('already exists')) {
        tempFieldErrors.organizationId =
          'Rule already exists for this Org/Course Type';
        tempFieldErrors.courseTypeId =
          'Rule already exists for this Org/Course Type';
      } else if (message.toLowerCase().includes('invalid organizationid')) {
        tempFieldErrors.organizationId = 'Invalid Organization selected.';
      } else if (message.toLowerCase().includes('invalid coursetypeid')) {
        tempFieldErrors.courseTypeId = 'Invalid Course Type selected.';
      }
      setFieldErrors(tempFieldErrors);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth='md' fullWidth>
      <DialogTitle>
        {isEditMode ? 'Edit Pricing Rule' : 'Add New Pricing Rule'}
      </DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity='error' sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        {loadingLists ? (
          <CircularProgress />
        ) : (
          <Box sx={{ mt: 2 }}>
            <Grid2 container spacing={2}>
              <Grid2 xs={12} sm={6}>
                <FormControl fullWidth error={Boolean(fieldErrors.organizationId)}>
                  <InputLabel id='pricing-rule-org-label'>Organization</InputLabel>
                  <Select
                    labelId='pricing-rule-org-label'
                    value={formData.organizationId || ''}
                    onChange={handleChange}
                    name='organizationId'
                    label='Organization'
                  >
                    {organizations.map(org => (
                      <MenuItem
                        key={org.organizationid}
                        value={String(org.organizationid)}
                      >
                        {org.organizationname}
                      </MenuItem>
                    ))}
                  </Select>
                  {fieldErrors.organizationId && <FormHelperText>{fieldErrors.organizationId}</FormHelperText>}
                </FormControl>
              </Grid2>
              <Grid2 xs={12} sm={6}>
                <FormControl fullWidth error={Boolean(fieldErrors.courseTypeId)}>
                  <InputLabel id='pricing-rule-course-label'>Course Name</InputLabel>
                  <Select
                    labelId='pricing-rule-course-label'
                    value={formData.courseTypeId || ''}
                    onChange={handleChange}
                    name='courseTypeId'
                    label='Course Name'
                  >
                    {courseTypes.map(type => (
                      <MenuItem
                        key={type.id}
                        value={String(type.id)}
                      >
                        {type.name} ({type.coursecode})
                      </MenuItem>
                    ))}
                  </Select>
                  {fieldErrors.courseTypeId && <FormHelperText>{fieldErrors.courseTypeId}</FormHelperText>}
                </FormControl>
              </Grid2>
              <Grid2 xs={12} sm={6}>
                <TextField
                  fullWidth
                  label='Price'
                  name='price'
                  type='number'
                  value={formData.price || ''}
                  onChange={handleChange}
                  error={Boolean(fieldErrors.price)}
                  helperText={fieldErrors.price || ''}
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position='start'>$</InputAdornment>
                    ),
                    inputProps: { min: 0, step: 0.01 }, // Allow decimals
                  }}
                />
              </Grid2>
            </Grid2>
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ p: '16px 24px' }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={handleSave} variant='contained' disabled={loading}>
          {loading ? <CircularProgress size={24} /> : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default PricingRuleDialog;
