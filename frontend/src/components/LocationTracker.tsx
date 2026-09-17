import React, { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { tokenService } from '../services/tokenService';

/**
 * Component that tracks location changes and saves them for restoration
 * after authentication. This ensures users return to the exact page they were on.
 */
const LocationTracker: React.FC = () => {
  const location = useLocation();
  const { user } = useAuth();

  useEffect(() => {
    // Only save location if user is authenticated
    if (user) {
      const fullLocation = location.pathname + location.search + location.hash;
      
      // Don't save login/auth pages or default dashboard routes
      if (
        !fullLocation.includes('/login') &&
        !fullLocation.includes('/forgot-password') &&
        !fullLocation.includes('/reset-password') &&
        !fullLocation.match(/\/\w+\/dashboard$/) // Don't save default dashboard routes
      ) {
        tokenService.saveCurrentLocation(fullLocation);
      } else {
      }
    } else {
    }
  }, [location, user]);

  // This component doesn't render anything
  return null;
};

export default LocationTracker; 