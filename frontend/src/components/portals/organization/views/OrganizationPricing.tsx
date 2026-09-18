import React, { useState, useEffect } from 'react';
import { Box, Typography, CircularProgress, Alert } from '@mui/material';
import { getOrganizationPricingForOrg } from '../../../../services/api';
import { formatCurrency, formatDisplayDate } from '../../../../utils/formatters';
import logger from '../../../../utils/logger';
import DataTable, { DataTableRow } from '../../../gtacpr/DataTable';
import StatusChip from '../../../gtacpr/StatusChip';

interface OrganizationPricingData {
  id: number;
  organizationId: number;
  classTypeId: number;
  pricePerStudent: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  classTypeName: string;
}

interface OrganizationPricingProps {
  organizationId: number;
}

// The pricing API exposes one rate (price per student); there is no separate base price.
const columns = [
  { key: 'courseType', label: 'COURSE TYPE', width: '1.4fr' },
  { key: 'studentPrice', label: 'PRICE PER STUDENT', width: '0.9fr', align: 'right' as const },
  { key: 'status', label: 'STATUS', width: '0.6fr' },
  { key: 'updated', label: 'LAST UPDATED', width: '0.8fr' },
];

const infoBoxSx = {
  p: 2,
  bgcolor: (theme: { palette: { mode: string } }) => theme.palette.mode === 'dark' ? 'rgba(37, 99, 235, 0.1)' : '#EFF6FF',
  borderRadius: '8px',
  border: (theme: { palette: { mode: string } }) => `1px solid ${theme.palette.mode === 'dark' ? 'rgba(37, 99, 235, 0.3)' : '#BFDBFE'}`,
};
const infoTextColor = (theme: { palette: { mode: string } }) => theme.palette.mode === 'dark' ? '#60A5FA' : '#1E40AF';

const OrganizationPricing: React.FC<OrganizationPricingProps> = ({ organizationId }) => {
  const [pricingData, setPricingData] = useState<OrganizationPricingData[]>([]);
  const [loading, setLoading] = useState(Boolean(organizationId));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchPricingData = async () => {
      try {
        setLoading(true);
        setError(null);
        const response = await getOrganizationPricingForOrg(organizationId);
        setPricingData(Array.isArray(response?.data) ? response.data : []);
      } catch (err: unknown) {
        logger.error('Error fetching organization pricing:', err);
        setError('Failed to load pricing information. Please try again later.');
      } finally {
        setLoading(false);
      }
    };
    if (organizationId) fetchPricingData();
  }, [organizationId]);

  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}><CircularProgress size={24} aria-label="Loading pricing" /></Box>;
  if (error) return <Alert severity="error">{error}</Alert>;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <Box sx={infoBoxSx}>
        <Typography sx={{ fontSize: 13, fontWeight: 600, color: infoTextColor, mb: 0.5 }}>Pricing Information</Typography>
        <Typography sx={{ fontSize: 12, color: infoTextColor }}>
          These are your current pricing rates for each course type. Contact your system administrator to update pricing.
        </Typography>
      </Box>

      {pricingData.length === 0 ? (
        <Box sx={{ bgcolor: (theme) => theme.palette.background.paper, border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', p: 6, textAlign: 'center' }}>
          <Typography sx={{ fontSize: 14, fontWeight: 600, color: (theme) => theme.palette.text.secondary }}>
            No pricing has been configured for your organization yet.
          </Typography>
          <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.text.secondary, mt: 1 }}>
            Please contact your system administrator to set up pricing.
          </Typography>
        </Box>
      ) : (
        <DataTable columns={columns} shownCount={pricingData.length} totalCount={pricingData.length}>
          {pricingData.map((pricing) => (
            <DataTableRow key={pricing.id} columns={columns}>
              <Box>
                <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: (theme) => theme.palette.text.primary }}>{pricing.classTypeName}</Typography>
                <Typography sx={{ fontSize: 11, color: (theme) => theme.palette.text.secondary }}>ID: {pricing.classTypeId}</Typography>
              </Box>
              <Typography sx={{ fontSize: 13, fontWeight: 600, color: (theme) => theme.palette.text.primary, fontFamily: 'monospace', textAlign: 'right' }}>
                {formatCurrency(pricing.pricePerStudent)}
              </Typography>
              <StatusChip kind={pricing.isActive === false ? 'inactive' : 'active'} label={pricing.isActive === false ? 'Inactive' : 'Active'} />
              <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>{formatDisplayDate(pricing.updatedAt)}</Typography>
            </DataTableRow>
          ))}
        </DataTable>
      )}
    </Box>
  );
};

export default OrganizationPricing;
