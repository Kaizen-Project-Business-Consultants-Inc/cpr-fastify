import React from 'react';
import { Box, Typography, Button } from '@mui/material';
import { useNavigate } from 'react-router-dom';

interface Props {
  /** Where "Back to dashboard" goes, e.g. "/accounting/dashboard". */
  homePath: string;
}

/** Shown by a portal's catch-all route instead of bare "View not found" text. */
const PortalNotFound: React.FC<Props> = ({ homePath }) => {
  const navigate = useNavigate();
  return (
    <Box sx={{ p: 4, textAlign: 'center' }}>
      <Typography component="h2" sx={{ fontSize: 18, fontWeight: 700 }}>
        That page isn&apos;t here
      </Typography>
      <Typography sx={{ fontSize: 14, color: 'text.secondary', mt: 1, mb: 2.5 }}>
        The address may be out of date. Use the sidebar, or go back to your dashboard.
      </Typography>
      <Button variant="contained" onClick={() => navigate(homePath)}>
        Back to dashboard
      </Button>
    </Box>
  );
};

export default PortalNotFound;
