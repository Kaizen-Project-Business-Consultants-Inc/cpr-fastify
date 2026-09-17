import React from 'react';
import { Box, Typography, Button } from '@mui/material';
import { useNavigate } from 'react-router-dom';

const NotFound: React.FC = () => {
  const navigate = useNavigate();
  return (
    <Box
      component="main"
      role="main"
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        px: 2,
        bgcolor: (t) => t.palette.background.default,
      }}
    >
      <Box sx={{ textAlign: 'center', maxWidth: 420 }}>
        <Typography sx={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.08em', color: 'text.secondary' }}>
          404
        </Typography>
        <Typography component="h1" sx={{ fontSize: 24, fontWeight: 800, mt: 1 }}>
          Page not found
        </Typography>
        <Typography sx={{ fontSize: 14, color: 'text.secondary', mt: 1.5, mb: 3 }}>
          The address you opened doesn&apos;t exist or has moved. If you followed a link from an
          email, try signing in and opening the item from your dashboard.
        </Typography>
        <Box sx={{ display: 'flex', gap: 1.5, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Button variant="contained" onClick={() => navigate('/')}>
            Go to my dashboard
          </Button>
          <Button variant="text" onClick={() => navigate(-1)}>
            Go back
          </Button>
        </Box>
      </Box>
    </Box>
  );
};

export default NotFound;
