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
} from '@mui/material';
import { vendorApi } from '../../../services/api';
import { useNavigate } from 'react-router-dom';
import { PrimaryButton, GhostButton } from '../../gtacpr/Buttons';
import { useConfirm } from '../../gtacpr/ConfirmDialog';
import { formatCurrency, getTodayDate, toLocalDateString, HST_LABEL } from '../../../utils/formatters';

type MoneyField = 'rate' | 'subtotal' | 'hst' | 'total';
const MONEY_FIELDS: MoneyField[] = ['rate', 'subtotal', 'hst', 'total'];

interface FormState {
  vendorId: string;
  date: string;
  invoiceNumber: string;
  acctNo: string;
  dueDate: string;
  quantity: string;
  item: string;
  description: string;
  rate: string;
  subtotal: string;
  hst: string;
  total: string;
}

interface VendorOption {
  id: number;
  vendorName: string;
}

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = ['application/pdf', 'text/html'];

const defaultDueDate = () => {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return toLocalDateString(d);
};

const emptyForm = (): FormState => ({
  vendorId: '',
  date: getTodayDate(),
  invoiceNumber: '',
  acctNo: '',
  dueDate: defaultDueDate(),
  quantity: '',
  item: '',
  description: '',
  rate: '',
  subtotal: '',
  hst: '',
  total: '',
});

/** Parse a user-typed money string ("1,234.5", "10.") to a number, or null when not a number. */
const parseMoney = (raw: string): number | null => {
  const cleaned = raw.replace(/[$,\s]/g, '');
  if (cleaned === '' || cleaned === '.') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
};

const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

const validateFile = (f: File): string | null => {
  if (!ALLOWED_TYPES.includes(f.type)) return 'Please select a valid PDF or HTML file.';
  if (f.size > MAX_FILE_BYTES) return 'File size must be less than 5MB.';
  return null;
};

const InvoiceUpload: React.FC = () => {
  const navigate = useNavigate();
  const { confirm, dialog } = useConfirm();

  const [formData, setFormData] = useState<FormState>(emptyForm);
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [vendorsLoading, setVendorsLoading] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<{ invoiceNumber: string; message: string } | null>(null);

  useEffect(() => {
    const loadVendors = async () => {
      try {
        setVendorsLoading(true);
        const response = await vendorApi.getVendors();
        const rows: Array<Record<string, unknown>> = Array.isArray(response) ? response : response?.data ?? [];
        setVendors(
          rows.map((v) => ({
            id: Number(v.id),
            vendorName: String(v.vendor_name ?? v.vendorName ?? v.name ?? `Vendor ${v.id}`),
          }))
        );
      } catch {
        setError('Failed to load vendors. Please try again.');
      } finally {
        setVendorsLoading(false);
      }
    };
    loadVendors();
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    if (MONEY_FIELDS.includes(name as MoneyField)) {
      // Keep the raw string while typing so "10." and "0.5" are possible; only allow money characters.
      if (value !== '' && !/^[\d,]*\.?\d*$/.test(value)) return;
    }
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  /** On blur, normalise a money field to two decimals (or clear it when it is not a number). */
  const handleMoneyBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    const n = parseMoney(value);
    setFormData((prev) => ({ ...prev, [name]: n == null ? '' : n.toFixed(2) }));
  };

  const handleSelectChange = (e: SelectChangeEvent<string>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;
    const problem = validateFile(selected);
    if (problem) {
      setError(problem);
      return;
    }
    setFile(selected);
    setError(null);
  };

  const totalNumber = parseMoney(formData.total);
  const subtotalNumber = parseMoney(formData.subtotal);
  const hstNumber = parseMoney(formData.hst);
  const totalError = formData.total !== '' && (totalNumber == null || totalNumber <= 0) ? 'Total must be greater than zero' : null;

  const isFormComplete =
    !!file &&
    !!formData.vendorId &&
    formData.invoiceNumber.trim() !== '' &&
    formData.description.trim() !== '' &&
    !!formData.date &&
    totalNumber != null &&
    totalNumber > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (uploading) return;
    setError(null);

    if (!isFormComplete || !file || totalNumber == null) {
      setError('Please fill in all required fields, including vendor, total and the invoice file.');
      return;
    }
    const fileProblem = validateFile(file);
    if (fileProblem) {
      setError(fileProblem);
      return;
    }

    const vendorName = vendors.find((v) => String(v.id) === formData.vendorId)?.vendorName ?? '';
    const ok = await confirm({
      title: 'Submit this invoice?',
      confirmLabel: 'Upload invoice',
      message: (
        <Box sx={{ display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 2, rowGap: 0.5, fontSize: 14 }}>
          <span>Vendor</span><strong>{vendorName || '—'}</strong>
          <span>Invoice #</span><strong>{formData.invoiceNumber.trim()}</strong>
          <span>Subtotal</span><span>{subtotalNumber != null ? formatCurrency(subtotalNumber) : '—'}</span>
          <span>{HST_LABEL}</span><span>{hstNumber != null ? formatCurrency(hstNumber) : '—'}</span>
          <span>Total</span><strong>{formatCurrency(totalNumber)}</strong>
          <span>File</span><span>{file.name}</span>
        </Box>
      ),
    });
    if (!ok) return;

    setUploading(true);
    try {
      // Field names match backend/src/routes/vendors.ts submitInvoiceSchema.
      const payload = new FormData();
      payload.append('invoice_number', formData.invoiceNumber.trim());
      payload.append('amount', String(totalNumber));
      payload.append('description', formData.description.trim());
      payload.append('date', formData.date);
      if (formData.dueDate) payload.append('due_date', formData.dueDate);
      if (formData.quantity) payload.append('quantity', formData.quantity);
      if (formData.item.trim()) payload.append('manual_type', formData.item.trim());
      if (formData.acctNo.trim()) payload.append('acct_no', formData.acctNo.trim());
      const rate = parseMoney(formData.rate);
      if (rate != null) payload.append('rate', String(rate));
      if (subtotalNumber != null) payload.append('subtotal', String(subtotalNumber));
      if (hstNumber != null) payload.append('hst', String(hstNumber));
      payload.append('total', String(totalNumber));
      payload.append('detected_vendor_id', formData.vendorId);
      payload.append('invoice_pdf', file);

      const response = await vendorApi.uploadInvoice(payload);
      if (response && response.success === false) {
        throw new Error(response.error || response.message || 'Failed to upload invoice');
      }
      setSubmitted({
        invoiceNumber: formData.invoiceNumber.trim(),
        message: response?.message || 'Invoice uploaded successfully.',
      });
      setFormData(emptyForm());
      setFile(null);
    } catch (err: unknown) {
      const errObj = err as { response?: { data?: { error?: string } }; message?: string };
      setError(errObj.response?.data?.error || errObj.message || 'Failed to upload invoice. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  const moneyField = (name: MoneyField, label: string, required = false) => (
    <TextField
      fullWidth
      label={label}
      name={name}
      type="text"
      inputMode="decimal"
      value={formData[name]}
      onChange={handleInputChange}
      onBlur={handleMoneyBlur}
      required={required}
      placeholder="0.00"
      error={name === 'total' && !!totalError}
      helperText={name === 'total' ? totalError ?? ' ' : ' '}
      InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
    />
  );

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '24px', maxWidth: 800 }}>
      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

      {submitted && (
        <Alert
          severity="success"
          onClose={() => setSubmitted(null)}
          action={
            <Box sx={{ display: 'flex', gap: 1 }}>
              <GhostButton size="small" onClick={() => navigate('/vendor/history', { state: { refresh: true } })}>
                View invoices
              </GhostButton>
            </Box>
          }
        >
          <strong>Invoice {submitted.invoiceNumber} uploaded.</strong> {submitted.message} It is now pending submission — open Invoice
          Management to submit it to admin, or upload another below.
        </Alert>
      )}

      <Card sx={{ border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', boxShadow: '0 1px 3px rgba(0,0,0,.05)', p: 3 }}>
        <Typography sx={{ fontSize: 14, color: (theme) => theme.palette.text.secondary, mb: 3 }}>
          Fill in the invoice details, attach the PDF, then click &quot;Upload Invoice&quot;. You will be asked to confirm the totals before it is sent.
        </Typography>

        <form onSubmit={handleSubmit} noValidate>
          <Grid container spacing={3}>
            <Grid item xs={12}>
              <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                Invoice Details
              </Typography>
            </Grid>
            <Grid item xs={12} md={6}>
              <FormControl fullWidth required>
                <InputLabel id="vendor-select-label">Vendor Name</InputLabel>
                <Select
                  labelId="vendor-select-label"
                  label="Vendor Name"
                  name="vendorId"
                  value={formData.vendorId}
                  onChange={handleSelectChange}
                  disabled={vendorsLoading}
                >
                  {vendors.map((vendor) => (
                    <MenuItem key={vendor.id} value={String(vendor.id)}>{vendor.vendorName}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField fullWidth label="Invoice Date" name="date" type="date" value={formData.date} onChange={handleInputChange} required InputLabelProps={{ shrink: true }} />
            </Grid>

            <Grid item xs={12} md={6}>
              <TextField fullWidth label="Invoice #" name="invoiceNumber" value={formData.invoiceNumber} onChange={handleInputChange} required placeholder="e.g., INV-2024-001" />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField fullWidth label="Acct. No." name="acctNo" value={formData.acctNo} onChange={handleInputChange} placeholder="Account number" />
            </Grid>

            <Grid item xs={12} md={6}>
              <TextField fullWidth label="Due Date" name="dueDate" type="date" value={formData.dueDate} onChange={handleInputChange} InputLabelProps={{ shrink: true }} />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField fullWidth label="Quantity" name="quantity" type="number" inputProps={{ min: 1, step: 1 }} value={formData.quantity} onChange={handleInputChange} placeholder="0" />
            </Grid>

            <Grid item xs={12} md={6}>
              <TextField fullWidth label="Item" name="item" value={formData.item} onChange={handleInputChange} placeholder="Item code or name" />
            </Grid>
            <Grid item xs={12} md={6}>
              {moneyField('rate', 'Rate')}
            </Grid>

            <Grid item xs={12}>
              <TextField fullWidth label="Description" name="description" value={formData.description} onChange={handleInputChange} multiline rows={3} required placeholder="Describe the goods or services..." />
            </Grid>

            <Grid item xs={12}>
              <Typography sx={{ fontSize: 13, fontWeight: 700, color: (theme) => theme.palette.text.secondary, textTransform: 'uppercase', letterSpacing: '0.07em', mt: 1 }}>
                Financial Summary
              </Typography>
            </Grid>
            <Grid item xs={12} md={4}>{moneyField('subtotal', 'Subtotal')}</Grid>
            <Grid item xs={12} md={4}>{moneyField('hst', HST_LABEL)}</Grid>
            <Grid item xs={12} md={4}>{moneyField('total', 'Total', true)}</Grid>

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
                <input type="file" hidden accept=".pdf,.html,.htm" onChange={handleFileChange} aria-label="Invoice file" />
              </GhostButton>
              <Typography sx={{ fontSize: 12, color: file ? '#16A34A' : (theme) => theme.palette.text.secondary, mt: 0.5 }}>
                {file ? `File selected: ${file.name} - ${formatFileSize(file.size)}` : 'Please select a PDF or HTML file (max 5MB)'}
              </Typography>
            </Grid>

            <Grid item xs={12}>
              <PrimaryButton type="submit" fullWidth sx={{ py: 1.5 }} disabled={uploading || !isFormComplete}>
                {uploading ? <><CircularProgress size={20} color="inherit" sx={{ mr: 1 }} /> Uploading…</> : 'Upload Invoice'}
              </PrimaryButton>
            </Grid>
          </Grid>
        </form>
      </Card>

      {dialog}
    </Box>
  );
};

export default InvoiceUpload;
