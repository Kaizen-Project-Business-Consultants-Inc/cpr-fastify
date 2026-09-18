import { useState, useEffect } from 'react';

interface NetworkStatus {
  isOnline: boolean;
  isSlowConnection: boolean;
}

export const useNetworkStatus = (): NetworkStatus => {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isSlowConnection, setIsSlowConnection] = useState(false);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Check for slow connection
    const connection = (navigator as Navigator & { connection?: { effectiveType?: string } }).connection;
    if (connection) {
      // Synchronizing with an external system (navigator.connection) on mount, not derived state.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsSlowConnection(connection.effectiveType === '2g' || connection.effectiveType === 'slow-2g');
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return { isOnline, isSlowConnection };
};

export default useNetworkStatus;
