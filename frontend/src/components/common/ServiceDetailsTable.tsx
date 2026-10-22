import React from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Typography,
  Box,
} from '@mui/material';
import { formatDisplayDate } from '../../utils/formatters';

interface ServiceDetail {
  date: string;
  location: string;
  course: string;
  students: number;
  ratePerStudent: number;
  baseCost: number;
  tax: number;
  total: number;
}

interface ServiceDetailsTableProps {
  services: ServiceDetail[];
  showTotals?: boolean;
}

const ServiceDetailsTable: React.FC<ServiceDetailsTableProps> = ({ 
  services, 
  showTotals = true 
}) => {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-CA', {
      style: 'currency',
      currency: 'CAD',
    }).format(amount);
  };

  const calculateTotals = () => {
    return services.reduce(
      (acc, service) => ({
        baseCost: acc.baseCost + service.baseCost,
        tax: acc.tax + service.tax,
        total: acc.total + service.total,
      }),
      { baseCost: 0, tax: 0, total: 0 }
    );
  };

  const totals = calculateTotals();

  return (
    <Box>
      <Typography variant="h6" gutterBottom sx={{ fontWeight: 'bold', mb: 2 }}>
        Service Details
      </Typography>
      
      <TableContainer component={Paper} sx={{ mb: 2 }}>
        <Table size="small">
          <TableHead>
            <TableRow sx={{ backgroundColor: 'grey.100' }}>
              <TableCell sx={{ fontWeight: 'bold' }}>Date</TableCell>
              <TableCell sx={{ fontWeight: 'bold' }}>Location</TableCell>
              <TableCell sx={{ fontWeight: 'bold' }}>Course</TableCell>
              <TableCell sx={{ fontWeight: 'bold' }} align="center">Students</TableCell>
              <TableCell sx={{ fontWeight: 'bold' }} align="right">Rate/Student</TableCell>
              <TableCell sx={{ fontWeight: 'bold' }} align="right">Base Cost</TableCell>
              <TableCell sx={{ fontWeight: 'bold' }} align="right">Tax (HST)</TableCell>
              <TableCell sx={{ fontWeight: 'bold' }} align="right">Total</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {services.map((service, index) => (
              <TableRow 
                key={index}
                sx={{ 
                  '&:nth-of-type(odd)': { backgroundColor: 'grey.50' },
                  '&:hover': { backgroundColor: 'grey.100' }
                }}
              >
                <TableCell>{formatDisplayDate(service.date)}</TableCell>
                <TableCell>{service.location}</TableCell>
                <TableCell>{service.course}</TableCell>
                <TableCell align="center">{service.students}</TableCell>
                <TableCell align="right">{formatCurrency(service.ratePerStudent)}</TableCell>
                <TableCell align="right">{formatCurrency(service.baseCost)}</TableCell>
                <TableCell align="right">{formatCurrency(service.tax)}</TableCell>
                <TableCell align="right" sx={{ fontWeight: 'bold' }}>
                  {formatCurrency(service.total)}
                </TableCell>
              </TableRow>
            ))}
            
            {showTotals && services.length > 1 && (
              <TableRow sx={{ backgroundColor: 'primary.50', borderTop: 2 }}>
                <TableCell colSpan={5} sx={{ fontWeight: 'bold' }}>
                  SUBTOTAL
                </TableCell>
                <TableCell align="right" sx={{ fontWeight: 'bold' }}>
                  {formatCurrency(totals.baseCost)}
                </TableCell>
                <TableCell align="right" sx={{ fontWeight: 'bold' }}>
                  {formatCurrency(totals.tax)}
                </TableCell>
                <TableCell align="right" sx={{ fontWeight: 'bold', color: 'primary.main' }}>
                  {formatCurrency(totals.total)}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
};

export default ServiceDetailsTable; 