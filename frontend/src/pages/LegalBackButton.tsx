import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@mui/material';
import { ArrowBack as ArrowBackIcon } from '@mui/icons-material';

/**
 * Back button for the public legal pages. Goes back to wherever the visitor came from in the
 * app (login, or a portal page if signed in). Opened directly or in a new tab, there is nowhere
 * to go back to, so it goes to `/`, which sends signed-in people to their portal and others
 * to the login page.
 */
const LegalBackButton: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const cameFromApp = location.key !== 'default';

  return (
    <Button startIcon={<ArrowBackIcon />} onClick={() => (cameFromApp ? navigate(-1) : navigate('/', { replace: true }))} sx={{ mb: 3 }} variant="text">
      Back
    </Button>
  );
};

export default LegalBackButton;
