import React, { useState } from 'react';
import { getErrorMessage } from '../../utils/errorMessage';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Box,
  Alert,
  CircularProgress,
} from '@mui/material';

interface Course {
  id: number;
  name: string;
  coursecode: string;
  duration: number;
  maxstudents: number;
  createdAt: string;
  updatedAt: string;
}

interface CourseDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: (data: Omit<Course, 'id'>) => Promise<void>;
  course?: Course;
}

interface CourseData {
  id?: number;
  name: string;
  coursecode: string;
  duration: number;
  maxstudents: number;
}

interface FieldErrors {
  name?: string;
  coursecode?: string;
  duration?: string;
  maxstudents?: string;
}

const CourseDialog: React.FC<CourseDialogProps> = ({
  open,
  onClose,
  onSave,
  course,
}) => {
  const isEditMode = !!course;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formData, setFormData] = useState<CourseData>({
    name: course?.name || '',
    coursecode: course?.coursecode || '',
    duration: course?.duration || 0,
    maxstudents: course?.maxstudents || 0,
  });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = event.target;
    setFormData(prev => ({
      ...prev,
      [name]: name === 'duration' || name === 'maxstudents' ? Number(value) : value,
    }));
    // Clear field error when user starts typing
    if (fieldErrors[name as keyof FieldErrors]) {
      setFieldErrors(prev => ({
        ...prev,
        [name]: undefined,
      }));
    }
  };

  const validateForm = (): boolean => {
    const newFieldErrors: FieldErrors = {};
    let isValid = true;

    if (!formData.name) {
      newFieldErrors.name = 'Course Name required';
      isValid = false;
    }
    if (!formData.coursecode) {
      newFieldErrors.coursecode = 'Course Code required';
      isValid = false;
    }
    if (formData.duration <= 0) {
      newFieldErrors.duration = 'Duration must be greater than 0';
      isValid = false;
    }
    if (formData.maxstudents <= 0) {
      newFieldErrors.maxstudents = 'Maximum students must be greater than 0';
      isValid = false;
    }

    setFieldErrors(newFieldErrors);
    return isValid;
  };

  const handleSubmit = async () => {
    if (!validateForm()) return;

    setLoading(true);
    setError(null);

    try {
      await onSave(formData as Omit<Course, 'coursetypeid'>);
      onClose();
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to save course'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth='sm' fullWidth>
      <DialogTitle>
        {isEditMode ? 'Edit Course' : 'Add New Course'}
      </DialogTitle>
      <DialogContent>
        <Box sx={{ mt: 2 }}>
          {error && (
            <Alert severity='error' sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}
          <TextField
            fullWidth
            label='Course Name'
            name='name'
            value={formData.name}
            onChange={handleChange}
            error={!!fieldErrors.name}
            helperText={fieldErrors.name}
            margin='normal'
            disabled={loading}
          />
          <TextField
            fullWidth
            label='Course Code'
            name='coursecode'
            value={formData.coursecode}
            onChange={handleChange}
            error={!!fieldErrors.coursecode}
            helperText={fieldErrors.coursecode}
            margin='normal'
            disabled={loading}
          />
          <TextField
            fullWidth
            label='Duration (minutes)'
            name='duration'
            type='number'
            value={formData.duration}
            onChange={handleChange}
            error={!!fieldErrors.duration}
            helperText={fieldErrors.duration}
            margin='normal'
            disabled={loading}
          />
          <TextField
            fullWidth
            label='Maximum Students'
            name='maxstudents'
            type='number'
            value={formData.maxstudents}
            onChange={handleChange}
            error={!!fieldErrors.maxstudents}
            helperText={fieldErrors.maxstudents}
            margin='normal'
            disabled={loading}
          />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={loading}>
          Cancel
        </Button>
        <Button
          onClick={handleSubmit}
          variant='contained'
          disabled={loading}
          startIcon={loading ? <CircularProgress size={20} /> : null}
        >
          {isEditMode ? 'Update' : 'Create'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default CourseDialog;
