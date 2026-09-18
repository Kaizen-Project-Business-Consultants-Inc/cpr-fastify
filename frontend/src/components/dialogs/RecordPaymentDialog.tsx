import React, { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Grid,
  CircularProgress,
  Alert,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Box,
  Divider,
} from '@mui/material';
import Typography from '@mui/material/Typography';
import type { SelectChangeEvent } from '@mui/material';
import { getInvoicePayments } from '../../services/api';
import logger from '../../utils/logger';
import { recordPayment } from '../../services/paymentService';
import { getTodayDate, formatCurrency } from '../../utils/formatters';
import { getErrorMessage } from '../../utils/errorMessage';

export interface PaymentDialogInvoice {
  invoiceid: number;
  invoicenumber?: string;
  amount?: number | string;
}

interface RecordPaymentDialogProps {
  open: boolean;
  onClose: () => void;
  invoice: PaymentDialogInvoice | null;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
}

const RecordPaymentDialog = ({
  open,
  onClose,
  invoice,
  onSuccess,
  onError,
}: RecordPaymentDialogProps) => {
  const [paymentData, setPaymentData] = useState({
    paymentDate: getTodayDate(), // Default to today (local date, not UTC)
    amountPaid: '',
    paymentMethod: '', // e.g., Check, EFT, Credit Card
    referenceNumber: '', // e.g., Check #, Transaction ID
    notes: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  // State for payment summary
  const [paidToDate, setPaidToDate] = useState(0);
  const [balanceDue, setBalanceDue] = useState(invoice?.amount || 0);
  const [isLoadingSummary, setIsLoadingSummary] = useState(false);

  const handleChange = (
    event: SelectChangeEvent<string> | React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = event.target;
    // Allow only numbers and one decimal for amount
    if (name === 'amountPaid' && value && !/^[0-9]*\.?[0-9]*$/.test(value)) {
      return;
    }
    setPaymentData(prev => ({
      ...prev,
      [name]: value,
    }));
    setError(''); // Clear error on change
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setIsSubmitting(true);


    // Basic Validation
    const amount = parseFloat(paymentData.amountPaid);
    if (isNaN(amount) || amount <= 0) {
      setError('Please enter a valid positive payment amount.');
      setIsSubmitting(false);
      return;
    }
    if (!paymentData.paymentDate) {
      setError('Please enter a payment date.');
      setIsSubmitting(false);
      return;
    }
    // The server requires a payment method (zod: `paymentMethod: string().min(1)`).
    if (!paymentData.paymentMethod) {
      setError('Please select a payment method.');
      setIsSubmitting(false);
      return;
    }
    if (!invoice?.invoiceid) {
      setError('No invoice selected.');
      setIsSubmitting(false);
      return;
    }

    try {
      logger.info(`Recording payment for invoice: ${invoice?.invoiceid}`);
      
      // Field names mirror the server's zod schema (see InvoicePaymentData).
      // Date and notes are recorded as entered; omitting the date would make the
      // server stamp today instead.
      await recordPayment(invoice.invoiceid, {
        amount,
        paymentMethod: paymentData.paymentMethod,
        reference: paymentData.referenceNumber || undefined,
        paymentDate: paymentData.paymentDate || undefined,
        notes: paymentData.notes || undefined,
      });
      
      logger.info(`Payment recorded successfully for invoice: ${invoice?.invoiceid}`);
      onSuccess(paymentData.notes || 'Payment recorded successfully.'); // Notify parent
    } catch (err) {
      console.error('❌ [RecordPaymentDialog] Payment recording failed:', err);
      logger.error('Failed to record payment:', err);
      const errorMessage = getErrorMessage(err, 'Failed to record payment');
      setError(errorMessage);
      onError(errorMessage);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Reset form and fetch payment summary when dialog opens
  React.useEffect(() => {
    if (open && invoice?.invoiceid) {
      // Reset form state
      setPaymentData({
        paymentDate: getTodayDate(),
        amountPaid: '',
        paymentMethod: '',
        referenceNumber: '',
        notes: '',
      });
      setError('');
      setIsSubmitting(false);

      // Fetch payment history to calculate summary
      const fetchPaymentSummary = async () => {
        setIsLoadingSummary(true);
        try {
          // GET /accounting/invoices/:id/payments returns { success, data: rows }
          // and the rows are raw `payments` columns, so the amount is `amount`.
          const response = await getInvoicePayments(invoice.invoiceid);
          const rows: Array<{ amount?: number | string }> = Array.isArray(response)
            ? response
            : (response?.data ?? []);
          const totalPaid = rows.reduce(
            (sum: number, p) => sum + parseFloat(String(p.amount || 0)),
            0
          );
          const originalAmount = parseFloat(String(invoice.amount || 0));
          setPaidToDate(totalPaid);
          setBalanceDue(originalAmount - totalPaid);
          logger.debug(
            `[RecordPaymentDialog] Payment summary loaded: Paid=${totalPaid}, Balance=${originalAmount - totalPaid}`
          );
        } catch (err) {
          logger.error('Error loading payment summary:', err);
          // Don't block the dialog, but maybe show a small error?
          // For now, just default to 0 paid / full balance
          setPaidToDate(0);
          setBalanceDue(parseFloat(String(invoice.amount || 0)));
        } finally {
          setIsLoadingSummary(false);
        }
      };
      fetchPaymentSummary();
    }
  }, [open, invoice]);

  if (!invoice) return null;

  return (
    <Dialog open={open} onClose={onClose} maxWidth='sm' fullWidth>
      <DialogTitle>Record Payment for Invoice #{invoice.invoicenumber}</DialogTitle>
      <DialogContent dividers>
        {/* Payment Summary Section */}
        <Box
          sx={{
            mb: 2,
            p: 1,
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 1,
          }}
        >
          <Typography variant='subtitle2' gutterBottom>
            Invoice Summary:
          </Typography>
          {isLoadingSummary ? (
            <CircularProgress size={20} />
          ) : (
            <Grid container spacing={0.5}>
              <Grid item xs={6}>
                <Typography variant='body2'>Original Amount:</Typography>
              </Grid>
              <Grid item xs={6}>
                <Typography variant='body2' align='right'>
                  {formatCurrency(invoice.amount)}
                </Typography>
              </Grid>
              <Grid item xs={6}>
                <Typography variant='body2'>Paid to Date:</Typography>
              </Grid>
              <Grid item xs={6}>
                <Typography variant='body2' align='right'>
                  {formatCurrency(paidToDate)}
                </Typography>
              </Grid>
              <Grid item xs={6}>
                <Typography variant='body2'>
                  <strong>Balance Due:</strong>
                </Typography>
              </Grid>
              <Grid item xs={6}>
                <Typography variant='body2' align='right'>
                  <strong>{formatCurrency(balanceDue)}</strong>
                </Typography>
              </Grid>
            </Grid>
          )}
        </Box>
        <Divider sx={{ mb: 2 }} />

        {error && (
          <Alert severity='error' sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <Grid
          container
          spacing={2}
          component='form'
          id='payment-form'
          onSubmit={handleSubmit}
        >
          <Grid item xs={12} sm={6}>
            <TextField
              label='Payment Date'
              name='paymentDate'
              type='date'
              value={paymentData.paymentDate}
              onChange={handleChange}
              InputLabelProps={{ shrink: true }}
              fullWidth
              required
              disabled={isSubmitting}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              label='Amount Paid'
              name='amountPaid'
              type='text' // Use text to allow decimal input, validated in handler
              value={paymentData.amountPaid}
              onChange={handleChange}
              InputProps={{
                startAdornment: <Typography sx={{ mr: 0.5 }}>$</Typography>,
              }}
              fullWidth
              required
              disabled={isSubmitting}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <FormControl fullWidth>
              <InputLabel id='payment-method-label'>Payment Method</InputLabel>
              <Select
                labelId='payment-method-label'
                name='paymentMethod'
                value={paymentData.paymentMethod}
                label='Payment Method'
                onChange={handleChange}
                disabled={isSubmitting}
              >
                <MenuItem value=''>
                  <em>None</em>
                </MenuItem>
                <MenuItem value='Check'>Check</MenuItem>
                <MenuItem value='EFT'>EFT / Bank Transfer</MenuItem>
                <MenuItem value='Credit Card'>Credit Card</MenuItem>
                <MenuItem value='Cash'>Cash</MenuItem>
                <MenuItem value='Other'>Other</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              label='Reference # (Optional)'
              name='referenceNumber'
              value={paymentData.referenceNumber}
              onChange={handleChange}
              fullWidth
              disabled={isSubmitting}
            />
          </Grid>
          <Grid item xs={12}>
            <TextField
              label='Notes (Optional)'
              name='notes'
              value={paymentData.notes}
              onChange={handleChange}
              multiline
              rows={2}
              fullWidth
              disabled={isSubmitting}
            />
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button
          type='submit'
          form='payment-form'
          variant='contained'
          disabled={isSubmitting}
        >
          {isSubmitting ? <CircularProgress size={24} /> : 'Record Payment'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default RecordPaymentDialog;
