import { api } from './api';
import { tokenService } from './tokenService';
import { AxiosError } from 'axios';

const isDev = import.meta.env.DEV;
// eslint-disable-next-line no-console
const log = (...args: unknown[]) => { if (isDev) console.log(...args); };
const logError = (...args: unknown[]) => { if (isDev) console.error(...args); };

interface LoginResponse {
  user: {
    id: number;
    username: string;
    role: string;
    organizationId?: number;
    organizationName?: string;
  };
  accessToken: string;
  sessionId?: string;
}

interface RefreshResponse {
  accessToken: string;
  expiresIn?: number;
}

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

interface AuthUser {
  id: number;
  username: string;
  role: string;
  organizationId?: number;
  organizationName?: string;
  [key: string]: unknown;
}

// Add request deduplication for auth checks
let authCheckPromise: Promise<AuthUser> | null = null;
let refreshPromise: Promise<RefreshResponse> | null = null;

/**
 * Authentication service that handles user authentication operations.
 * Includes methods for login, registration, logout, and token verification.
 */
export const authService = {
  /**
   * Authenticates a user with username and password.
   * @param username - The user's username
   * @param password - The user's password
   * @returns Promise with the authentication response
   * @throws Error if authentication fails
   */
  async login(username: string, password: string): Promise<LoginResponse> {
    log('[AUTH] Login attempt');

    try {
      const response = await api.post<ApiResponse<LoginResponse>>('/auth/login', {
        username: username.trim(),
        password
      });

      if (!response.data.success || !response.data.data) {
        throw new Error(response.data.error?.message || 'Login failed');
      }

      const { user, accessToken, sessionId } = response.data.data;

      if (!accessToken) {
        throw new Error('No access token received from server');
      }

      log('[AUTH] Login successful');

      // Store access token and set in API headers
      tokenService.setAccessToken(accessToken);
      // Token is stored in tokenService; interceptor adds Bearer header automatically

      return response.data.data;
    } catch (error: any) {
      logError('[AUTH] Login error:', error instanceof Error ? error.message : 'Unknown error');
      throw error;
    }
  },

  /**
   * Refreshes the access token using the refresh token.
   * @returns Promise with the refresh response
   * @throws Error if refresh fails
   */
  async refreshToken(): Promise<RefreshResponse> {
    // Return existing promise if one is already in progress
    if (refreshPromise) {
      log('[AUTH] Returning existing refresh promise');
      return refreshPromise;
    }

    log('[AUTH] Starting token refresh');

    try {
      refreshPromise = api
        .post<ApiResponse<RefreshResponse>>('/auth/refresh')
        .then(response => {
          if (!response.data.success || !response.data.data) {
            throw new Error(response.data.error?.message || 'Token refresh failed');
          }

          const { accessToken, expiresIn } = response.data.data;

          if (!accessToken) {
            throw new Error('No access token received from refresh');
          }

          log('[AUTH] Token refresh successful');
          
          // Update the token in memory and API headers
          tokenService.setAccessToken(accessToken, expiresIn);
          // Token is stored in tokenService; interceptor adds Bearer header automatically

          refreshPromise = null; // Clear the promise cache
          return response.data.data;
        })
        .catch(error => {
          logError('[AUTH] Token refresh failed:', error.message);

          // Clear tokens on refresh failure
          if (error.response?.status === 401 || error.response?.status === 403) {
            log('[AUTH] Clearing tokens due to refresh failure');
            // Use forceLogout for blacklisted tokens to ensure complete cleanup
            if (error.response?.data?.error?.code === 'AUTH_1003') {
              log('[AUTH] Token blacklisted during refresh, forcing logout');
              tokenService.forceLogout();
            } else {
              tokenService.clearTokens();
              // Tokens cleared via tokenService; interceptor won't add header
            }
          }

          refreshPromise = null; // Clear the promise cache
          throw error;
        });

      return refreshPromise;
    } catch (error: any) {
      logError('[AUTH] Unexpected refresh error:', error);
      throw error;
    }
  },

  /**
   * Registers a new user.
   * @param username - The new user's username
   * @param email - The new user's email
   * @param password - The new user's password
   * @returns Promise with the registration response
   * @throws Error if registration fails
   */
  async register(username: string, email: string, password: string): Promise<LoginResponse> {
    // eslint-disable-next-line no-useless-catch
    try {
      const response = await api.post<ApiResponse<LoginResponse>>('/auth/register', {
        username,
        email,
        password,
      });

      if (!response.data.success || !response.data.data) {
        throw new Error(response.data.error?.message || 'Registration failed');
      }

      const { user, accessToken } = response.data.data;

      // Store the tokens
      if (accessToken) {
        tokenService.setAccessToken(accessToken);
        // Token is stored in tokenService; interceptor adds Bearer header automatically
      }

      return response.data.data;
    } catch (error: any) {
      throw error;
    }
  },

  /**
   * Logs out the current user.
   * @returns Promise that resolves when logout is complete
   */
  async logout(): Promise<void> {
    try {
      await api.post('/auth/logout');
    } finally {
      // Use forceLogout for comprehensive cleanup across all tabs
      tokenService.forceLogout();
    }
  },

  /**
   * Verifies the current authentication status.
   * @returns Promise with the verification response or false if not authenticated
   */
  async checkAuth() {
    // Return existing promise if one is already in progress
    if (authCheckPromise) {
      log('[AUTH] Returning existing auth check promise');
      return authCheckPromise;
    }

    try {
      const token = tokenService.getAccessToken();
      log('[AUTH] Token present:', !!token);
      
      if (!token) {
        log('[AUTH] No access token found');
        return null;
      }

      // Ensure token is set in headers
      // Token is stored in tokenService; interceptor adds Bearer header automatically
      log('[AUTH] Token set in headers');

      log('[AUTH] Checking authentication with backend');
      // Create and cache the promise
      authCheckPromise = api
        .get<ApiResponse<{ user: AuthUser }>>('/auth/me')
        .then(response => {
          if (!response.data.success || !response.data.data) {
            throw new Error(response.data.error?.message || 'Auth check failed');
          }
          const userData = response.data.data.user;
          log('[AUTH] Auth check successful');
          authCheckPromise = null; // Clear the promise cache
          return userData;
        })
        .catch(error => {
          logError('[AUTH] Auth check failed:', error.message);

          // Only clear tokens if we get a 401 (unauthorized) or 403 (forbidden)
          if (error.response?.status === 401 || error.response?.status === 403) {
            log('[AUTH] Clearing tokens due to auth failure');
            // Use forceLogout for blacklisted tokens to ensure complete cleanup
            if (error.response?.data?.error?.code === 'AUTH_1003') {
              log('[AUTH] Token blacklisted, forcing logout');
              tokenService.forceLogout();
            } else {
              tokenService.clearTokens();
              // Tokens cleared via tokenService; interceptor won't add header
            }
          }

          authCheckPromise = null; // Clear the promise cache
          throw error;
        });

      return authCheckPromise;
    } catch (error: any) {
      logError('[AUTH] Unexpected error:', error);
      throw error;
    }
  },

  /**
   * Gets the current access token.
   * @returns The current access token or null if not authenticated
   */
  getAccessToken() {
    return tokenService.getAccessToken();
  },

  /**
   * Checks if the user is currently authenticated.
   * @returns True if the user is authenticated, false otherwise
   */
  isAuthenticated() {
    return !!this.getAccessToken();
  },

  /**
   * Gets session status information.
   * @returns Session status object
   */
  getSessionStatus() {
    return tokenService.getSessionStatus();
  },

  async recoverPassword(email: string): Promise<void> {
    log('[AUTH] Password recovery request');
    try {
      const response = await api.post('/auth/recover-password', { email });
      log('[AUTH] Password recovery sent');
      return response.data;
    } catch (error: unknown) {
      logError('[AUTH] Password recovery error');
      const errObj = error as { response?: { data?: { message?: string } } };
      // eslint-disable-next-line preserve-caught-error
      throw new Error(errObj.response?.data?.message || 'Failed to send recovery email');
    }
  },
};
