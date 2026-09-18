import React from 'react';
import { Chip } from '@mui/material';
import { STATUS } from './tokens';

type StatusKind = 'success' | 'active' | 'open' | 'warning' | 'pending' | 'danger' | 'overdue' | 'expired' | 'neutral' | 'inactive' | 'brand' | 'critical';

const kindMap: Record<StatusKind, { bg: string; color: string }> = {
  success: STATUS.success,
  active: STATUS.success,
  open: STATUS.success,
  warning: STATUS.warning,
  pending: STATUS.warning,
  danger: STATUS.danger,
  overdue: STATUS.danger,
  expired: STATUS.danger,
  neutral: STATUS.neutral,
  inactive: STATUS.neutral,
  brand: STATUS.brand,
  critical: STATUS.brand,
};

interface StatusChipProps {
  kind: StatusKind;
  label: string;
}

const StatusChip: React.FC<StatusChipProps> = ({ kind, label }) => {
  const p = kindMap[kind];
  return (
    <Chip
      label={label}
      size="small"
      sx={{
        borderRadius: '20px',
        fontSize: '11.5px',
        fontWeight: 600,
        backgroundColor: p.bg,
        color: p.color,
        height: 'auto',
        padding: '3px 10px',
      }}
    />
  );
};

export default StatusChip;
