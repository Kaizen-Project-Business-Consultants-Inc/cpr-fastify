import React, { ReactNode } from 'react';
import { Card, Box, Typography, Button, CircularProgress } from '@mui/material';
import { SIDEBAR_BG } from './tokens';

/** Space after a labelled right-aligned column so its numbers do not touch the next column's text. */
const RIGHT_COLUMN_GUTTER = '16px';

interface DataTableColumn {
  key: string;
  label: string;
  align?: 'left' | 'right' | 'center';
  width?: string;
}

interface DataTableProps {
  columns: DataTableColumn[];
  children: ReactNode;
  totalCount?: number;
  shownCount?: number;
  page?: number;
  onPrevPage?: () => void;
  onNextPage?: () => void;
  hasNextPage?: boolean;
  loading?: boolean;
  emptyMessage?: string;
}

const DataTable: React.FC<DataTableProps> = ({
  columns,
  children,
  totalCount,
  shownCount,
  page,
  onPrevPage,
  onNextPage,
  hasNextPage,
  loading,
  emptyMessage = 'No results found.',
}) => (
  <Card
    sx={{
      borderRadius: '10px',
      overflow: 'hidden',
      boxShadow: '0 1px 3px rgba(0,0,0,.05)',
    }}
  >
    {/* Header — scrolls with body */}
    <Box sx={{ overflowX: 'auto' }} role="table" aria-label="Data table">
      <Box sx={{ minWidth: 720 }}>
        <Box
          role="row"
          sx={{
            display: 'grid',
            gridTemplateColumns: columns.map((c) => c.width || '1fr').join(' '),
            backgroundColor: SIDEBAR_BG,
            padding: '13px 22px',
          }}
        >
          {columns.map((col) => (
            <Typography
              key={col.key}
              role="columnheader"
              sx={{
                fontSize: '11px',
                fontWeight: 700,
                color: '#ffffff',
                textAlign: col.align || 'left',
                // keeps right-aligned numbers off the next column's text without widening the grid
                paddingRight: col.align === 'right' && col.label ? RIGHT_COLUMN_GUTTER : 0,
              }}
            >
              {col.label}
            </Typography>
          ))}
        </Box>

        {/* Body */}
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }} role="status" aria-label="Loading">
            <CircularProgress size={32} />
          </Box>
        ) : React.Children.count(children) === 0 ? (
          <Box sx={{ textAlign: 'center', py: 6 }}>
            <Typography sx={{ fontSize: '13px', color: (theme) => theme.palette.text.secondary }}>
              {emptyMessage}
            </Typography>
          </Box>
        ) : (
          <Box role="rowgroup">{children}</Box>
        )}
      </Box>
    </Box>

    {/* Footer */}
    {(totalCount !== undefined || onPrevPage || onNextPage) && (
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '13px 22px',
          borderTop: (theme) => `1px solid ${theme.palette.divider}`,
        }}
      >
        <Typography sx={{ fontSize: '12px', color: (theme) => theme.palette.text.secondary }} aria-live="polite">
          {totalCount !== undefined
            ? `Showing ${shownCount || 0} of ${totalCount} results`
            : ''}
        </Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          {onPrevPage && (
            <Button
              variant="outlined"
              size="small"
              onClick={onPrevPage}
              disabled={page === 0}
              sx={{ borderRadius: '8px', textTransform: 'none', fontSize: '12px' }}
            >
              Prev
            </Button>
          )}
          {onNextPage && (
            <Button
              variant="outlined"
              size="small"
              onClick={onNextPage}
              disabled={!hasNextPage}
              sx={{ borderRadius: '8px', textTransform: 'none', fontSize: '12px' }}
            >
              Next
            </Button>
          )}
        </Box>
      </Box>
    )}
  </Card>
);

export const DataTableRow: React.FC<{
  columns: DataTableColumn[];
  children: ReactNode[];
  onClick?: () => void;
}> = ({ columns, children, onClick }) => (
  <Box
    role="row"
    onClick={onClick}
    onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
    tabIndex={onClick ? 0 : undefined}
    sx={{
      display: 'grid',
      gridTemplateColumns: columns.map((c) => c.width || '1fr').join(' '),
      padding: '14px 22px',
      borderBottom: (theme) => `1px solid ${theme.palette.divider}`,
      alignItems: 'center',
      cursor: onClick ? 'pointer' : 'default',
      '&:hover': onClick ? { backgroundColor: (theme) => theme.palette.action.hover } : {},
      '&:focus-visible': onClick ? { outline: '2px solid #CC1F1F', outlineOffset: '-2px' } : {},
    }}
  >
    {React.Children.map(children, (child, i) => (
      <Box role="cell" key={columns[i]?.key || i} sx={columns[i]?.align === 'right' && columns[i]?.label ? { pr: RIGHT_COLUMN_GUTTER } : undefined}>{child}</Box>
    ))}
  </Box>
);

export default DataTable;
