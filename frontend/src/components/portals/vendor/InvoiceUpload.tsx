
import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Card,
  TextField,
  Grid,
  Alert,
  CircularProgress,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  InputAdornment,
  SelectChangeEvent,
  Snackbar,
  Stack,
} from '@mui/material';
import { vendorApi } from '../../../services/api';
import { useNavigate } from 'react-router-dom';
import StatusChip from '../../gtacpr/StatusChip';
import { PrimaryButton, GhostButton } from '../../gtacpr/Buttons';

const InvoiceUpload: React.FC = () => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const dueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const [formData, setFormData] = useState({
      vendorName: '',
      date: today,
      invoiceNumber: '',
      acctNo: '',
      dueDate: dueDate,
      quantity: '',
      item: '',
      description: '',
      rate: '',
      subtotal: '',
      hst: '',
      total: '',
      vendorId: '',
      detectedVendorId: '',
    });
    const [vendors, setVendors] = useState<Array<{id: number, vendorName: string, vendorType: string}>>([]);
    const [vendorsLoading, setVendorsLoading] = useState(true);
    const [file, setFile] = useState<File | null>(null);
    const [loading, setLoading] = useState(false);
    const [scanning, setScanning] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [snackbarOpen, setSnackbarOpen] = useState(false);
    const [ocrResults, setOcrResults] = useState<Record<string, unknown> | null>(null);
    const [ocrConfidence, setOcrConfidence] = useState<number | null>(null);
    const [showConfirmation, setShowConfirmation] = useState(false);
    const [pendingOcrData, setPendingOcrData] = useState<Record<string, unknown> | null>(null);
    const navigate = useNavigate();

    useEffect(() => {
      const loadVendors = async () => {
        try {
          setVendorsLoading(true);
          const response = await vendorApi.getVendors();
          setVendors(response || []);
        } catch (error: any) {
          console.error('Error loading vendors:', error);
          setError('Failed to load vendors. Please try again.');
        } finally {
          setVendorsLoading(false);
        }
      };
      loadVendors();
    }, []);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const { name, value } = e.target;
      let cleanValue = value;
      if (['subtotal', 'hst', 'total', 'rate'].includes(name)) {
        cleanValue = value.replace(/,/g, '');
        if (cleanValue && !isNaN(parseFloat(cleanValue))) {
          cleanValue = parseFloat(cleanValue).toString();
        } else if (cleanValue === '') {
          cleanValue = '';
        } else {
          return;
        }
      }
      setFormData(prev => ({ ...prev, [name]: cleanValue }));
    };

    const handleSelectChange = (e: SelectChangeEvent<string>) => {
      const { name, value } = e.target;
      setFormData(prev => ({ ...prev, [name as string]: value }));
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files[0]) {
        const selectedFile = e.target.files[0];
        if (selectedFile.type !== 'application/pdf' && selectedFile.type !== 'text/html') {
          setError('Please select a valid PDF or HTML file.');
          return;
        }
        if (selectedFile.size > 5 * 1024 * 1024) {
          setError('File size must be less than 5MB.');
          return;
        }
        setFile(selectedFile);
        setError(null);
      }
    };

    const formatFileSize = (bytes: number): string => {
      if (bytes === 0) return '0 Bytes';
      const k = 1024;
      const sizes = ['Bytes', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    const handleSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      setLoading(true);
      setError(null);
      setSuccess(null);

      try {
        if (!formData.invoiceNumber || !formData.total || !formData.description || !formData.date || !formData.vendorId) {
          setError('Please fill in all required fields including vendor selection.');
          setLoading(false);
          return;
        }
        if (!file) {
          setError('Please select an invoice PDF file.');
          setLoading(false);
          return;
        }
        if (file.type !== 'application/pdf' && file.type !== 'text/html') {
          setError('Please select a valid PDF or HTML file.');
          setLoading(false);
          return;
        }
        if (file.size > 5 * 1024 * 1024) {
          setError('File size must be less than 5MB.');
          setLoading(false);
          return;
        }

        const formDataToSend = new FormData();
        Object.entries(formData).forEach(([key, value]) => {
          if (value) formDataToSend.append(key, value);
        });
        if (file) formDataToSend.append('invoice_pdf', file);

        const response = await vendorApi.uploadInvoice(formDataToSend);

        if (response && response.success) {
          const successMessage = response.message || 'Invoice uploaded successfully!';
          setSuccess(successMessage);
          setSnackbarOpen(true);
          setFormData({
            vendorName: '', date: today, invoiceNumber: '', acctNo: '', dueDate: dueDate,
            quantity: '', item: '', description: '', rate: '', subtotal: '', hst: '', total: '',
            vendorId: '', detectedVendorId: '',
          });
          setFile(null);
          setTimeout(() => { navigate('/vendor/history', { state: { refresh: true } }); }, 1200);
        }
      } catch (err: unknown) {
        const errObj = err as { response?: { data?: { error?: string } }; message?: string };
        if (errObj.response?.data?.error) {
          setError(errObj.response.data.error);
        } else if (errObj.message) {
          setError(errObj.message);
        } else {
          setError('Failed to upload invoice. Please try again.');
        }
      } finally {
        setLoading(false);
      }
    };

    const handleScanInvoice = async () => {
      if (!file) {
        setError('Please select a PDF or HTML file first');
        return;
      }

      try {
        setScanning(true);
        setError(null);

        const response = await vendorApi.scanInvoice(file);

        if (response.success && response.data) {
          const extractedData = response.data;
          const updatedFormData = { ...formData };

          if (extractedData.invoiceDate) updatedFormData.date = extractedData.invoiceDate;
          if (extractedData.invoiceNumber) updatedFormData.invoiceNumber = extractedData.invoiceNumber;
          if (extractedData.dueDate) updatedFormData.dueDate = extractedData.dueDate;
          if (extractedData.description) updatedFormData.description = extractedData.description;
          if (extractedData.amount) updatedFormData.total = extractedData.amount.replace(/,/g, '');
          if (extractedData.acctNo) updatedFormData.acctNo = extractedData.acctNo;
          if (extractedData.quantity) updatedFormData.quantity = extractedData.quantity;
          if (extractedData.item) updatedFormData.item = extractedData.item;
          if (extractedData.rate) updatedFormData.rate = extractedData.rate.replace(/,/g, '');
          if (extractedData.subtotal) updatedFormData.subtotal = extractedData.subtotal.replace(/,/g, '');
          if (extractedData.hst) updatedFormData.hst = extractedData.hst.replace(/,/g, '');

          // Vendor Detection
          if (extractedData.vendorDetection && extractedData.vendorDetection.detectedVendorId) {
            const detectedVendorId = extractedData.vendorDetection.detectedVendorId;
            const detectedVendorName = extractedData.vendorDetection.detectedVendorName;
            const confidence = extractedData.vendorDetection.confidence;

            if (confidence > 0.7) {
              updatedFormData.vendorId = detectedVendorId.toString();
              updatedFormData.vendorName = detectedVendorName;
              updatedFormData.detectedVendorId = detectedVendorId.toString();
            } else {
              updatedFormData.detectedVendorId = detectedVendorId.toString();
            }
          } else if (extractedData.vendorName && vendors.length > 0) {
            const matchedVendor = vendors.find(vendor =>
              vendor.vendorName.toLowerCase().includes(extractedData.vendorName.toLowerCase()) ||
              extractedData.vendorName.toLowerCase().includes(vendor.vendorName.toLowerCase())
            );
            if (matchedVendor) {
              updatedFormData.vendorId = matchedVendor.id.toString();
              updatedFormData.vendorName = matchedVendor.vendorName;
              updatedFormData.detectedVendorId = matchedVendor.id.toString();
            }
          }

          setFormData(updatedFormData);
          setOcrResults(extractedData);
          setOcrConfidence(extractedData.confidence);
          setPendingOcrData(extractedData);
          setShowConfirmation(true);

          const vendorMessage = updatedFormData.vendorId
            ? 'Vendor has been auto-matched and form is ready to submit!'
            : 'Form has been populated. Please select the vendor from the dropdown.';
          setSuccess(`Invoice scanned successfully! ${vendorMessage}`);
          setSnackbarOpen(true);
        } else {
          setError('Failed to scan invoice. Please try again or enter data manually.');
        }
      } catch (err: unknown) {
        const errObj = err as { response?: { data?: { error?: string } } };
        setError(errObj.response?.data?.error || 'Failed to scan invoice. Please try again.');
      } finally {
        setScanning(false);
      }
    };

    const handleSaveOcrData = () => {
      if (pendingOcrData) {
        const updatedFormData = { ...formData };
        if (pendingOcrData.invoiceDate) updatedFormData.date = String(pendingOcrData.invoiceDate);
        if (pendingOcrData.invoiceNumber) updatedFormData.invoiceNumber = String(pendingOcrData.invoiceNumber);
        if (pendingOcrData.dueDate) updatedFormData.dueDate = String(pendingOcrData.dueDate);
        if (pendingOcrData.description) updatedFormData.description = String(pendingOcrData.description);
        if (pendingOcrData.amount) updatedFormData.total = String(pendingOcrData.amount);
        if (pendingOcrData.acctNo) updatedFormData.acctNo = String(pendingOcrData.acctNo);
        if (pendingOcrData.quantity) updatedFormData.quantity = String(pendingOcrData.quantity);
        if (pendingOcrData.item) updatedFormData.item = String(pendingOcrData.item);
        if (pendingOcrData.rate) updatedFormData.rate = String(pendingOcrData.rate);
        if (pendingOcrData.subtotal) updatedFormData.subtotal = String(pendingOcrData.subtotal);
        if (pendingOcrData.hst) updatedFormData.hst = String(pendingOcrData.hst);
        setFormData(updatedFormData);
        setShowConfirmation(false);
        setPendingOcrData(null);
        setSuccess('OCR data applied to form successfully! Please select the vendor from the dropdown.');
        setSnackbarOpen(true);
      }
    };

    const handleCancelOcrData = () => {
      setShowConfirmation(false);
      setPendingOcrData(null);
      const freshToday = new Date().toISOString().split('T')[0];
      const freshDueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      setFormData({
        vendorName: '', date: freshToday, invoiceNumber: '', acctNo: '', dueDate: freshDueDate,
        quantity: '', item: '', description: '', rate: '', subtotal: '', hst: '', total: '',
        vendorId: '', detectedVendorId: '',
      });
      setOcrResults(null);
      setOcrConfidence(null);
      setSuccess('Form cleared. You can now enter data manually or scan another invoice.');
      setSnackbarOpen(true);
    };

    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '24px', maxWidth: 800 }}>
        {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
        {success && <Alert severity="success" onClose={() => setSuccess(null)}>{success}</Alert>}

        <Card sx={{ border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', boxShadow: '0 1px 3px rgba(0,0,0,.05)', p: 3 }}>
          <Typography sx={{ fontSize: 14, color: (theme) => theme.palette.text.secondary, mb: 3 }}>
            Please fill in the invoice details below and select your PDF file, then click "Upload Invoice" to submit.
          </Typography>

          <form onSubmit={handleSubmit}>
            <Grid container spacing={3}>
              {/* Row 1: Vendor Name and Date */}
              <Grid item xs={12}>
                <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                  Invoice Details
                </Typography>
              </Grid>
              <Grid item xs={12} md={6}>
                <FormControl fullWidth>
                  <InputLabel>Vendor Name *</InputLabel>
                  <Select name="vendorId" value={formData.vendorId} onChange={handleSelectChange} required disabled={vendorsLoading}>
                    {vendors.map((vendor) => (
                      <MenuItem key={vendor.id} value={vendor.id}>{vendor.vendorName}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField fullWidth label="Date *" name="date" type="date" value={formData.date} onChange={handleInputChange} required InputLabelProps={{ shrink: true }} />
              </Grid>

              {/* Row 2: Invoice # and Acct. No. */}
              <Grid item xs={12} md={6}>
                <TextField fullWidth label="Invoice # *" name="invoiceNumber" value={formData.invoiceNumber} onChange={handleInputChange} required placeholder="e.g., INV-2024-001" />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField fullWidth label="Acct. No." name="acctNo" value={formData.acctNo} onChange={handleInputChange} placeholder="Account number" />
              </Grid>

              {/* Row 3: Due Date and Quantity */}
              <Grid item xs={12} md={6}>
                <TextField fullWidth label="Due Date" name="dueDate" type="date" value={formData.dueDate} onChange={handleInputChange} InputLabelProps={{ shrink: true }} />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField fullWidth label="Quantity" name="quantity" type="number" value={formData.quantity} onChange={handleInputChange} placeholder="0" />
              </Grid>

              {/* Row 4: Item and Rate */}
              <Grid item xs={12} md={6}>
                <TextField fullWidth label="Item" name="item" value={formData.item} onChange={handleInputChange} placeholder="Item code or name" />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth label="Rate" name="rate" type="text"
                  value={formData.rate ? parseFloat(formData.rate).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ''}
                  onChange={handleInputChange} placeholder="0.00"
                  InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
                />
              </Grid>

              {/* Row 5: Description */}
              <Grid item xs={12}>
                <TextField fullWidth label="Description *" name="description" value={formData.description} onChange={handleInputChange} multiline rows={3} required placeholder="Describe the goods or services..." />
              </Grid>

              {/* Row 6: Subtotal, HST, and Total */}
              <Grid item xs={12}>
                <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.07em', mt: 1 }}>
                  Financial Summary
                </Typography>
              </Grid>
              <Grid item xs={12} md={4}>
                <TextField
                  fullWidth label="Subtotal" name="subtotal" type="text"
                  value={formData.subtotal ? parseFloat(formData.subtotal).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ''}
                  onChange={handleInputChange} placeholder="0.00"
                  InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
                />
              </Grid>
              <Grid item xs={12} md={4}>
                <TextField
                  fullWidth label="HST" name="hst" type="text"
                  value={formData.hst ? parseFloat(formData.hst).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ''}
                  onChange={handleInputChange} placeholder="0.00"
                  InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
                />
              </Grid>
              <Grid item xs={12} md={4}>
                <TextField
                  fullWidth label="Total *" name="total" type="text"
                  value={formData.total ? parseFloat(formData.total).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ''}
                  onChange={handleInputChange} required placeholder="0.00"
                  InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
                />
              </Grid>

              {/* File Upload */}
              <Grid item xs={12}>
                <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.07em', mt: 1, mb: 1 }}>
                  File Upload
                </Typography>
                <GhostButton
                  component="label"
                  fullWidth
                  sx={{ py: 2, border: file ? '1px solid #16A34A' : (theme) => `1px dashed ${theme.palette.divider}`, color: file ? '#16A34A' : (theme) => theme.palette.text.secondary }}
                >
                  {file ? `${file.name} (${formatFileSize(file.size)})` : 'Choose PDF or HTML File'}
                  <input type="file" hidden accept=".pdf,.html,.htm" onChange={handleFileChange} />
                </GhostButton>
                {file && (
                  <Typography sx={{ fontSize: 12, color: '#16A34A', mt: 0.5 }}>File selected: {file.name} - {formatFileSize(file.size)}</Typography>
                )}
                {!file && (
                  <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.text.secondary, mt: 0.5 }}>Please select a PDF or HTML file (max 5MB)</Typography>
                )}
              </Grid>

              {/* Scan Invoice */}
              <Grid item xs={12}>
                <GhostButton
                  fullWidth
                  sx={{ py: 2 }}
                  onClick={handleScanInvoice}
                  disabled={loading || !file || scanning}
                >
                  {scanning ? <><CircularProgress size={20} sx={{ mr: 1 }} /> Scanning...</> : 'Scan Invoice (OCR)'}
                </GhostButton>

                {ocrResults && (
                  <Stack direction="row" spacing={1} sx={{ mt: 1.5, flexWrap: 'wrap', gap: 0.5 }}>
                    <StatusChip kind="success" label={`Confidence: ${ocrConfidence}%`} />
                    {ocrResults.vendorName ? <StatusChip kind="neutral" label={`Vendor: ${String(ocrResults.vendorName)}`} /> : null}
                    {ocrResults.invoiceNumber ? <StatusChip kind="neutral" label={`Invoice #: ${String(ocrResults.invoiceNumber)}`} /> : null}
                    {ocrResults.amount ? <StatusChip kind="neutral" label={`Total: ${String(ocrResults.amount)}`} /> : null}
                  </Stack>
                )}

                {showConfirmation && pendingOcrData && (
                  <Box sx={{ border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', p: 3, mt: 2, bgcolor: (theme) => theme.palette.background.default }}>
                    <Typography sx={{ fontSize: 14, fontWeight: 700, color: (theme) => theme.palette.text.primary, mb: 1 }}>Extracted Data Review</Typography>
                    <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary, mb: 2 }}>
                      The form has been automatically populated with the extracted data. Please review and select the vendor from the dropdown above.
                    </Typography>

                    <Grid container spacing={1.5} sx={{ mb: 2 }}>
                      {[
                        ['Vendor', pendingOcrData.vendorName],
                        ['Invoice #', pendingOcrData.invoiceNumber],
                        ['Date', pendingOcrData.invoiceDate],
                        ['Due Date', pendingOcrData.dueDate],
                        ['Account #', pendingOcrData.acctNo],
                        ['Item', pendingOcrData.item],
                        ['Quantity', pendingOcrData.quantity],
                        ['Rate', pendingOcrData.rate],
                        ['Subtotal', pendingOcrData.subtotal],
                        ['Tax/HST', pendingOcrData.hst],
                        ['Total', pendingOcrData.amount],
                      ].map(([label, value]) => (
                        <Grid item xs={6} md={3} key={String(label)}>
                          <Typography sx={{ fontSize: 11, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase' }}>{String(label)}</Typography>
                          <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.primary, fontWeight: label === 'Total' ? 700 : 400 }}>{String(value || '—')}</Typography>
                        </Grid>
                      ))}
                      <Grid item xs={12}>
                        <Typography sx={{ fontSize: 11, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase' }}>Description</Typography>
                        <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.primary }}>{String(pendingOcrData.description || '—')}</Typography>
                      </Grid>
                    </Grid>

                    <Stack direction="row" spacing={2}>
                      <GhostButton
                        onClick={() => { setShowConfirmation(false); setPendingOcrData(null); }}
                        sx={{ flex: 1 }}
                      >
                        OK
                      </GhostButton>
                      <GhostButton
                        onClick={handleCancelOcrData}
                        sx={{ flex: 1, color: '#CC1F1F', borderColor: '#CC1F1F' }}
                      >
                        Clear Form
                      </GhostButton>
                    </Stack>
                  </Box>
                )}
              </Grid>

              {/* Submit */}
              <Grid item xs={12}>
                <PrimaryButton
                  type="submit"
                  fullWidth
                  sx={{ py: 1.5 }}
                  disabled={loading || !file || !formData.vendorId || !formData.invoiceNumber || !formData.total || !formData.description || !formData.date || showConfirmation}
                >
                  {loading ? <><CircularProgress size={20} color="inherit" sx={{ mr: 1 }} /> Uploading...</> : 'Upload Invoice'}
                </PrimaryButton>
              </Grid>
            </Grid>
          </form>
        </Card>

        <Snackbar open={snackbarOpen} autoHideDuration={6000} onClose={() => setSnackbarOpen(false)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
          <Alert onClose={() => setSnackbarOpen(false)} severity={error ? 'error' : success ? 'success' : 'info'} variant="filled" sx={{ width: '100%' }}>
            {error || success || 'Invoice uploaded successfully!'}
          </Alert>
        </Snackbar>
      </Box>
    );
  } catch (error: any) {
    console.error('Error in InvoiceUpload component:', error);
    return (
      <Box>
        <Alert severity="error" sx={{ mb: 2 }}>Failed to load invoice upload component. Please try again later.</Alert>
      </Box>
    );
  }
};

export default InvoiceUpload;
