import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Box,
  Alert,
  FormHelperText,
} from '@mui/material';
import { createCoursePricing, updateCoursePrice } from '../../services/api';
import logger from '../../utils/logger';

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

interface Organization {
  id: number;
  name: string;
}

interface ClassType {
  id: number;
  name: string;
}

interface OrganizationPricingDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: () => void;
  pricing: OrganizationPricing | null;
  organizations: Organization[];
  classTypes: ClassType[];
}

function OrganizationPricingDialog({
  open,
  onClose,
  onSave,
  pricing,
  organizations,
  classTypes,
}: OrganizationPricingDialogProps) {
  const [formData, setFormData] = useState({
    organizationId: '',
    classTypeId: '',
    pricePerStudent: '',
    isActive: true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const isEditing = !!pricing;

  useEffect(() => {
    if (pricing) {
      setFormData({
        organizationId: pricing.organizationId.toString(),
        classTypeId: pricing.classTypeId.toString(),
        pricePerStudent: pricing.pricePerStudent.toString(),
        isActive: pricing.isActive,
      });
    } else {
      setFormData({
        organizationId: '',
        classTypeId: '',
        pricePerStudent: '',
        isActive: true,
      });
    }
    setErrors({});
    setSubmitError('');
  }, [pricing, open]);

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    if (!formData.organizationId) {
      newErrors.organizationId = 'Organization is required';
    }

    if (!formData.classTypeId) {
      newErrors.classTypeId = 'Class type is required';
    }

    if (!formData.pricePerStudent) {
      newErrors.pricePerStudent = 'Price is required';
    } else {
      const price = parseFloat(formData.pricePerStudent);
      if (isNaN(price) || price < 0) {
        newErrors.pricePerStudent = 'Price must be a positive number';
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validateForm()) {
      return;
    }

    setLoading(true);
    setSubmitError('');

    try {
      // POST /accounting/course-pricing (createCoursePricing) requires
      // courseTypeId — sending classTypeId (this form's own field name)
      // always 400'd with "courseTypeId: Required", so Create Pricing has
      // never worked through this screen.
      const submitData = {
        organizationId: parseInt(formData.organizationId, 10),
        courseTypeId: parseInt(formData.classTypeId, 10),
        pricePerStudent: parseFloat(formData.pricePerStudent),
        isActive: formData.isActive,
      };

      if (isEditing && pricing) {
        await updateCoursePrice(pricing.id, submitData);
        logger.info(`Course pricing ${pricing.id} updated successfully`);
      } else {
        await createCoursePricing(submitData);
        logger.info('Course pricing created successfully');
      }

      onSave();
      onClose();
    } catch (err: unknown) {
      logger.error('Error saving organization pricing:', err);
      setSubmitError(err instanceof Error ? err.message : 'Failed to save pricing record');
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (field: string, value: string | boolean) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    // Clear error when user starts typing
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }));
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        {isEditing ? 'Edit Course Pricing' : 'Add Course Pricing'}
      </DialogTitle>
      <DialogContent>
        <Box sx={{ pt: 1 }}>
          {submitError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {submitError}
            </Alert>
          )}

          <FormControl fullWidth sx={{ mb: 2 }} error={!!errors.organizationId}>
            <InputLabel>Organization</InputLabel>
            <Select
              value={formData.organizationId}
              label="Organization"
              onChange={(e) => handleInputChange('organizationId', e.target.value)}
              disabled={loading}
            >
              {Array.isArray(organizations) && organizations.map((org) => (
                <MenuItem key={org?.id || 'unknown'} value={(org?.id || '').toString()}>
                  {org?.name || 'Unknown Organization'}
                </MenuItem>
              ))}
            </Select>
            {errors.organizationId && (
              <FormHelperText>{errors.organizationId}</FormHelperText>
            )}
          </FormControl>

          <FormControl fullWidth sx={{ mb: 2 }} error={!!errors.classTypeId}>
            <InputLabel>Class Type</InputLabel>
            <Select
              value={formData.classTypeId}
              label="Class Type"
              onChange={(e) => handleInputChange('classTypeId', e.target.value)}
              disabled={loading}
            >
              {Array.isArray(classTypes) && classTypes.map((type) => (
                <MenuItem key={type?.id || 'unknown'} value={(type?.id || '').toString()}>
                  {type?.name || 'Unknown Class Type'}
                </MenuItem>
              ))}
            </Select>
            {errors.classTypeId && (
              <FormHelperText>{errors.classTypeId}</FormHelperText>
            )}
          </FormControl>

          <TextField
            fullWidth
            label="Price per Student"
            type="number"
            value={formData.pricePerStudent}
            onChange={(e) => handleInputChange('pricePerStudent', e.target.value)}
            error={!!errors.pricePerStudent}
            helperText={errors.pricePerStudent || 'Enter the price per student'}
            disabled={loading}
            sx={{ mb: 2 }}
            InputProps={{
              startAdornment: '$',
            }}
          />

          <FormControl fullWidth sx={{ mb: 2 }}>
            <InputLabel>Status</InputLabel>
            <Select
              value={formData.isActive.toString()}
              label="Status"
              onChange={(e) => handleInputChange('isActive', e.target.value === 'true')}
              disabled={loading}
            >
              <MenuItem value="true">Active</MenuItem>
              <MenuItem value="false">Inactive</MenuItem>
            </Select>
          </FormControl>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={loading}>
          Cancel
        </Button>
        <Button
          onClick={handleSubmit}
          variant="contained"
          disabled={loading}
        >
          {loading ? 'Saving...' : (isEditing ? 'Update' : 'Create')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default OrganizationPricingDialog; 