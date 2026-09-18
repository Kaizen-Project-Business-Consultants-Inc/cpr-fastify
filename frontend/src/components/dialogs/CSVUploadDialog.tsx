import React, { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  Alert,
  CircularProgress,
} from '@mui/material';
import { CloudUpload as UploadIcon } from '@mui/icons-material';
import { parseCSV, ParsedCSVResult } from '../../utils/csvParser';
import { organizationApi } from '../../services/api';
import { tokenService } from '../../services/tokenService';

interface UploadResult {
  fileName: string;
  content: string;
  parsed: ParsedCSVResult;
  response: unknown;
}

interface CSVUploadDialogProps {
  open: boolean;
  onClose: () => void;
  onUploadSuccess?: (data: UploadResult) => void;
  title?: string;
  description?: string;
  courseRequestId?: number;
  organizationId?: number;
}

const CSVUploadDialog: React.FC<CSVUploadDialogProps> = ({
  open,
  onClose,
  onUploadSuccess,
  title = 'Upload CSV File',
  description = 'Select a CSV file to upload',
  courseRequestId,
  organizationId,
}) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parseResult, setParseResult] = useState<ParsedCSVResult | null>(null);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    
    if (file) {
      
      if (file.type === 'text/csv' || file.name.endsWith('.csv')) {
        setSelectedFile(file);
        setError(null);
        setParseResult(null);
      } else {
        setError('Please select a valid CSV file');
        setSelectedFile(null);
        setParseResult(null);
      }
    } else {
      // No file selected
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) {
      setError('Please select a file first');
      return;
    }

    setUploading(true);
    setError(null);

    try {
      // Check authentication before upload. Was reading a `window.tokenService`
      // global that nothing in the app ever set, so this always failed and
      // blocked every upload with "Authentication required" even when the
      // user was properly logged in — the real token lives in the
      // tokenService module (same one api.ts's request interceptor uses).
      const token = tokenService.getAccessToken();
      if (!token) {
        console.error('[CSVUploadDialog] No access token found');
        setError('Authentication required. Please log in again.');
        return;
      }

      const text = await selectedFile.text();
      
      // Parse CSV
      const parsed = parseCSV(text, courseRequestId, organizationId);
      setParseResult(parsed);
      
      if (!parsed.success) {
        setError(`CSV parsing failed: ${parsed.errors.join(', ')}`);
        return;
      }

      if (parsed.students.length === 0) {
        setError('No valid student data found in CSV');
        return;
      }

      // Send to backend
      const response = await organizationApi.uploadStudents(courseRequestId!, parsed.students);
      
      const result = { 
        fileName: selectedFile.name, 
        content: text,
        parsed: parsed,
        response: response
      };
      
      onUploadSuccess?.(result);
      onClose();
    } catch (err: unknown) {
      console.error('[CSVUploadDialog] Upload error:', err);

      // Enhanced error handling
      const errObj = err as { response?: { status?: number }; message?: string };
      if (errObj.response?.status === 401) {
        setError('Authentication failed. Please log in again.');
      } else if (errObj.response?.status === 403) {
        setError('Access denied. You do not have permission to upload students for this course.');
      } else if (errObj.response?.status === 404) {
        setError('Course not found. Please refresh the page and try again.');
      } else if (errObj.response?.status === 500) {
        setError('Server error occurred. Please try again or contact support.');
      } else if (errObj.message) {
        setError(errObj.message);
      } else {
        setError('Failed to upload file. Please try again.');
      }
    } finally {
      setUploading(false);
    }
  };

  const handleClose = () => {
    setSelectedFile(null);
    setError(null);
    setUploading(false);
    setParseResult(null);
    onClose();
  };

  // Debug logging removed for cleaner console

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="textSecondary" gutterBottom>
          {description}
        </Typography>
        
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {parseResult && parseResult.errors.length > 0 && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            <Typography variant="body2" gutterBottom>
              CSV parsed with {parseResult.errors.length} errors:
            </Typography>
            <ul style={{ margin: 0, paddingLeft: 16 }}>
              {parseResult.errors.slice(0, 3).map((error, index) => (
                <li key={index}>
                  <Typography variant="body2">{error}</Typography>
                </li>
              ))}
            </ul>
            {parseResult.errors.length > 3 && (
              <Typography variant="body2" sx={{ mt: 1 }}>
                ... and {parseResult.errors.length - 3} more errors
              </Typography>
            )}
          </Alert>
        )}

        {parseResult && parseResult.success && (
          <Alert severity="info" sx={{ mb: 2 }}>
            <Typography variant="body2">
              Found {parseResult.validRows} valid students out of {parseResult.totalRows} total rows
            </Typography>
          </Alert>
        )}

        <Box sx={{ textAlign: 'center', py: 3 }}>
          <input
            accept=".csv"
            style={{ display: 'none' }}
            id="csv-file-input"
            type="file"
            onChange={handleFileSelect}
          />
          <label htmlFor="csv-file-input">
            <Button
              variant="outlined"
              component="span"
              startIcon={<UploadIcon />}
              disabled={uploading}
            >
              Choose CSV File
            </Button>
          </label>
          
          {selectedFile && (
            <Typography variant="body2" sx={{ mt: 2 }}>
              Selected: {selectedFile.name}
            </Typography>
          )}
        </Box>
      </DialogContent>
      
      <DialogActions>
        <Button onClick={handleClose} disabled={uploading}>
          Cancel
        </Button>
        <Button
          onClick={handleUpload}
          variant="contained"
          disabled={!selectedFile || uploading}
          startIcon={uploading ? <CircularProgress size={20} /> : null}
        >
          {uploading ? 'Uploading...' : 'Upload'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default CSVUploadDialog; 