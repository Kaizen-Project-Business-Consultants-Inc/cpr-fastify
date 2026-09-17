import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { authService } from '../services/authService';
import { tokenService } from '../services/tokenService';
import api from '../services/api';

const isDev = import.meta.env.DEV;
// eslint-disable-next-line no-console
const log = (...args: unknown[]) => { if (isDev) console.log(...args); };

interface User {
  id: number;
  username: string;
  role: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  organizationId?: number;
  organizationName?: string;
  // Allow additional properties for API compatibility
  [key: string]: unknown;
}

interface SessionStatus {
  hasToken: boolean;
  expiresAt: Date | null;
  timeUntilExpiry: number | null;
  isExpired: boolean;
}

interface TokenValidationResult {
  isValid: boolean;
  user?: User;
  error?: string;
  requiresReauth: boolean;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  error: string | null;
  isAuthenticated: boolean;
  sessionStatus: SessionStatus | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
  refreshSession: () => Promise<void>;
  validateTokenOnPageLoad: () => Promise<TokenValidationResult>;
  register: (username: string, email: string, password: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

/** Map snake_case DB fields to camelCase frontend fields */
function normalizeUser(raw: Record<string, unknown>): User {
  return {
    ...raw,
    id: raw.id as number,
    username: raw.username as string,
    role: raw.role as string,
    email: (raw.email) as string | undefined,
    firstName: (raw.firstName ?? raw.first_name) as string | undefined,
    lastName: (raw.lastName ?? raw.last_name) as string | undefined,
    organizationId: (raw.organizationId ?? raw.organization_id) as number | undefined,
    organizationName: (raw.organizationName ?? raw.organization_name) as string | undefined,
    locationId: (raw.locationId ?? raw.location_id) as number | undefined,
    locationName: (raw.locationName ?? raw.location_name) as string | undefined,
  };
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sessionStatus, setSessionStatus] = useState<SessionStatus | null>(null);
  const [justLoggedIn, setJustLoggedIn] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  // Enhanced token validation on page load - LESS AGGRESSIVE
  const validateTokenOnPageLoad = async (): Promise<TokenValidationResult> => {
    log('[TOKEN VALIDATION] Starting page load token validation');
    
    try {
      const token = tokenService.getAccessToken();
      
      if (!token) {
        log('[TOKEN VALIDATION] No token found');
        return {
          isValid: false,
          requiresReauth: true,
          error: 'No authentication token found'
        };
      }

      // Client-side token expiration check (fast, no network)
      const status = authService.getSessionStatus();
      if (status.isExpired) {
        log('[TOKEN VALIDATION] Token expired on client-side check');
        return {
          isValid: false,
          requiresReauth: true,
          error: 'Token has expired'
        };
      }

      // Only validate with backend if we don't have user data AND we didn't just log in
      // Skip backend validation if we just logged in (user data is fresh from login response)
      let resolvedUser = user; // capture before any async state updates
      if (!user && !justLoggedIn) {
        log('[TOKEN VALIDATION] No user data, validating with backend');
        const userData = await authService.checkAuth();

        if (!userData) {
          log('[TOKEN VALIDATION] Backend validation failed - no user data');
          return {
            isValid: false,
            requiresReauth: true,
            error: 'Token validation failed'
          };
        }

        // Set the user data AND update local variable — setUser is async so we
        // cannot read from the `user` closure after this point
        const normalized = normalizeUser(userData as Record<string, unknown>);
        setUser(normalized);
        resolvedUser = normalized;
        log('[TOKEN VALIDATION] User data set from backend validation');
      } else if (justLoggedIn) {
        log('[TOKEN VALIDATION] Skipping backend validation - just logged in');
      }

      // Use resolvedUser (freshly fetched or existing from state)
      const currentUser = resolvedUser;
      if (!currentUser) {
        log('[TOKEN VALIDATION] No current user data available');
        return {
          isValid: false,
          requiresReauth: true,
          error: 'No user data available'
        };
      }

      // Role-based route validation (only for protected routes)
      const currentPath = location.pathname;
      const roleRoutes = {
        instructor: '/instructor',
        organization: '/organization',
        admin: '/admin',
        accountant: '/accounting',
        superadmin: '/superadmin',
        sysadmin: '/sysadmin',
        hr: '/hr',
        vendor: '/vendor',
      };

      const userRolePrefix = roleRoutes[currentUser.role as keyof typeof roleRoutes];
      
      // Only validate role mismatch for protected routes, not for login/logout pages
      const isProtectedRoute = Object.values(roleRoutes).some(prefix => currentPath.startsWith(prefix));
      const isLoginPage = currentPath === '/login' || currentPath === '/logout';
      
      // ONLY validate role mismatch if we're on a protected route AND the user role doesn't match
      // This prevents false positives when switching tabs
      if (isProtectedRoute && userRolePrefix && !currentPath.startsWith(userRolePrefix)) {
        log('[TOKEN VALIDATION] User role mismatch on protected route:', {
          userRole: currentUser.role,
          currentPath,
          expectedPrefix: userRolePrefix
        });
        
        // This is a multi-tab issue - user has wrong token for this route
        return {
          isValid: false,
          requiresReauth: true,
          error: `Token belongs to ${currentUser.role} but you're on ${currentPath}`
        };
      }

      // If we're on login page but have a valid token, that's fine (user just logged in)
      if (isLoginPage && currentUser) {
        log('[TOKEN VALIDATION] User on login page with valid token - likely just logged in');
        return {
          isValid: true,
          user: currentUser,
          requiresReauth: false
        };
      }

      log('[TOKEN VALIDATION] Token validation successful for user:', currentUser.username);
      return {
        isValid: true,
        user: currentUser,
        requiresReauth: false
      };

    } catch (err: any) {
      log('[TOKEN VALIDATION] Validation error:', err);
      
      const errorMessage = err instanceof Error ? err.message : 'Token validation failed';
      const isAuthError = errorMessage.includes('401') || errorMessage.includes('403');
      
      return {
        isValid: false,
        requiresReauth: isAuthError,
        error: errorMessage
      };
    }
  };

  const checkAuth = async () => {
    try {
      setLoading(true);
      setError(null);
      
      log('[TRACE] Auth check - Starting comprehensive validation');
      const validationResult = await validateTokenOnPageLoad();
      
      if (!validationResult.isValid) {
        log('[TRACE] Auth check - Token validation failed:', validationResult.error);
        setUser(null);
        setSessionStatus(null);
        setError(validationResult.error || 'Authentication failed');
        
        if (validationResult.requiresReauth) {
          log('[TRACE] Auth check - Clearing tokens due to validation failure');
          tokenService.clearTokens();
          tokenService.clearSavedLocation();
          sessionStorage.removeItem('location_restoration_attempted');
        }
        return;
      }

      // Token is valid, set user data
      if (validationResult.user) {
        log('[TRACE] Auth check - Setting user data:', validationResult.user.username);
        setUser(validationResult.user);
        
        // Update session status
        const status = authService.getSessionStatus();
        setSessionStatus(status);
      }
      
      log('[TRACE] Auth check - Authentication successful');
    } catch (err: any) {
      log('[TRACE] Auth check - Unexpected error:', err);
      setError(err instanceof Error ? err.message : 'Authentication failed');
      setUser(null);
      setSessionStatus(null);
      
      // Clear tokens on any unexpected error
      tokenService.clearTokens();
      tokenService.clearSavedLocation();
      sessionStorage.removeItem('location_restoration_attempted');
    } finally {
      setLoading(false);
    }
  };

  const refreshSession = async () => {
    try {
      log('[TRACE] Auth context - Refreshing session');
      await authService.refreshToken();

      // Update session status
      const status = authService.getSessionStatus();
      setSessionStatus(status);

      log('[TRACE] Auth context - Session refreshed successfully');
    } catch (err: any) {
      log('[TRACE] Auth context - Session refresh failed:', err);
      setError(err instanceof Error ? err.message : 'Session refresh failed');
      // Don't clear user here, let the next API call handle it
    }
  };

  const register = async (username: string, email: string, password: string): Promise<void> => {
    // Registration is not currently implemented
    // This stub exists for type compatibility with the Register page
    throw new Error('Registration is not currently available. Please contact your administrator for account setup.');
  };

  // Monitor session status
  useEffect(() => {
    const updateSessionStatus = () => {
      if (user) {
        const status = authService.getSessionStatus();
        setSessionStatus(status);
        
        // Show warning if session is expiring soon
        if (status.timeUntilExpiry && status.timeUntilExpiry < 300000 && status.timeUntilExpiry > 0) {
          log('[TRACE] Auth context - Session expiring soon, showing warning');
          // You could show a notification here
        }
      }
    };

    const interval = setInterval(updateSessionStatus, 120000); // Check every 2 minutes instead of 30 seconds
    return () => clearInterval(interval);
  }, [user]);

  // Enhanced page load validation — runs once on mount
   
  useEffect(() => {
    log('[TRACE] Auth context - Initial page load validation');
    checkAuth();
  }, []);

  // Handle location restoration after successful authentication
  useEffect(() => {
    if (user && !loading) {
      const currentFullPath = window.location.pathname + window.location.search + window.location.hash;
      const savedLocation = tokenService.getSavedLocation();
      
      // Add a flag to prevent infinite loops
      const restorationAttempted = sessionStorage.getItem('location_restoration_attempted');
      
      if (savedLocation && savedLocation !== currentFullPath && !restorationAttempted) {
        // Check if we're on a default dashboard route
        const isDefaultRoute = currentFullPath.match(/\/\w+\/dashboard$/);
        
        // Only restore if the saved location is appropriate for the current user's role
        const isSavedLocationAppropriate = () => {
          // Don't restore if saved location is for a different role
          const roleRoutes = {
            instructor: '/instructor',
            organization: '/organization',
            admin: '/admin',
            accountant: '/accounting',
            superadmin: '/superadmin',
            sysadmin: '/sysadmin',
            hr: '/hr',
            vendor: '/vendor',
          };
          
          const userRolePrefix = roleRoutes[user.role as keyof typeof roleRoutes];
          if (userRolePrefix && !savedLocation.startsWith(userRolePrefix)) {
            log('[TRACE] Auth context - Saved location not appropriate for user role:', {
              userRole: user.role,
              savedLocation,
              userRolePrefix
            });
            return false;
          }
          
          return true;
        };
        
        if (isDefaultRoute && isSavedLocationAppropriate()) {
          // Don't restore location if user is intentionally on dashboard
          // Only restore if we're coming from a login/logout flow
          const isFromAuthFlow = sessionStorage.getItem('from_auth_flow') === 'true';
          
          if (isFromAuthFlow) {
            log('[TRACE] Auth context - Restoring saved location from auth flow:', savedLocation);
            // Mark that we've attempted restoration to prevent loops
            sessionStorage.setItem('location_restoration_attempted', 'true');
            tokenService.clearSavedLocation();
            // Clear auth flow flag since we're restoring location
            sessionStorage.removeItem('from_auth_flow');
            // Use setTimeout to ensure navigation happens after state updates
            setTimeout(() => {
              navigate(savedLocation, { replace: true });
            }, 100);
          } else {
            log('[TRACE] Auth context - Not restoring location (not from auth flow)');
            tokenService.clearSavedLocation();
            // Clear auth flow flag since we're not restoring location
            sessionStorage.removeItem('from_auth_flow');
          }
        } else {
          // Clear saved location if we're already on a specific page or location is inappropriate
          log('[TRACE] Auth context - Clearing saved location (not default route or inappropriate)');
          tokenService.clearSavedLocation();
          // Clear auth flow flag since we're not restoring location
          sessionStorage.removeItem('from_auth_flow');
        }
      } else if (restorationAttempted) {
        // Clear the flag if we're not attempting restoration
        sessionStorage.removeItem('location_restoration_attempted');
        // Also clear auth flow flag
        sessionStorage.removeItem('from_auth_flow');
      }
    }
  }, [user, loading, navigate]);

  const login = async (username: string, password: string) => {
    log('[DEEP TRACE] AuthContext.login - Starting login process:', {
      username,
      timestamp: new Date().toISOString()
    });
    
    try {
      setLoading(true);
      setError(null);
      
      log('[DEEP TRACE] AuthContext.login - Calling authService.login');
      const response = await authService.login(username, password);
      log('[DEEP TRACE] AuthContext.login - Login response received:', {
        user: response.user,
        timestamp: new Date().toISOString()
      });

      setUser(normalizeUser(response.user as Record<string, unknown>));

      // Mark as just logged in to skip redundant /auth/me validation
      setJustLoggedIn(true);
      // Clear the flag after a short delay to allow normal validation on future page loads
      setTimeout(() => setJustLoggedIn(false), 5000);

      // Update session status
      const status = authService.getSessionStatus();
      setSessionStatus(status);

      log('[DEEP TRACE] AuthContext.login - User state updated');

      // Navigate based on user role
      const roleRoutes = {
        instructor: '/instructor/dashboard',
        organization: '/organization/dashboard',
        admin: '/admin/dashboard',
        accountant: '/accounting/dashboard',
        superadmin: '/superadmin/dashboard',
        sysadmin: '/sysadmin/dashboard',
        hr: '/hr',
        vendor: '/vendor/dashboard',
      };

      const targetRoute = roleRoutes[response.user.role as keyof typeof roleRoutes] || '/';
      log('[DEEP TRACE] AuthContext.login - Navigating to:', {
        role: response.user.role,
        targetRoute,
        timestamp: new Date().toISOString()
      });
      
      // Set flag to indicate this is from auth flow for location restoration
      sessionStorage.setItem('from_auth_flow', 'true');
      navigate(targetRoute);
      log('[DEEP TRACE] AuthContext.login - Navigation completed');
    } catch (err: any) {
      log('[DEEP TRACE] AuthContext.login - Error occurred:', {
        error: err,
        message: err instanceof Error ? err.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
      setError(err instanceof Error ? err.message : 'Login failed');
      throw err;
    } finally {
      setLoading(false);
      log('[DEEP TRACE] AuthContext.login - Login process completed');
    }
  };

  const logout = async () => {
    try {
      setLoading(true);
      await authService.logout();
      setUser(null);
      setSessionStatus(null);
      tokenService.clearTokens();
      // Clear any saved location and restoration flags
      tokenService.clearSavedLocation();
      sessionStorage.removeItem('location_restoration_attempted');
      navigate('/login');
    } catch (err: any) {
      setError(err instanceof Error ? err.message : 'Logout failed');
    } finally {
      setLoading(false);
    }
  };

  const isAuthenticated = !!user && !!tokenService.getAccessToken();

  return (
    <AuthContext.Provider value={{
      user,
      loading,
      error,
      isAuthenticated,
      sessionStatus,
      login,
      logout,
      checkAuth,
      refreshSession,
      validateTokenOnPageLoad,
      register
    }}>
      {children}
    </AuthContext.Provider>
  );
};
