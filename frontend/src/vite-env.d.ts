/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_TITLE: string;
  readonly DEV: boolean;
  readonly PROD: boolean;
  readonly MODE: string;
}

// Declaration merging with vite/client's ImportMeta — ESLint can't see that usage textually.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Global tokenService type declaration
interface TokenService {
  getAccessToken(): string | null;
  setAccessToken(token: string, expiresIn?: number): void;
  getRefreshToken(): null;
  setRefreshToken(): void;
  saveCurrentLocation(location: string): void;
  saveCurrentFullLocation(): void;
  getSavedLocation(): string | null;
  clearSavedLocation(): void;
  clearTokens(): void;
  hasTokens(): boolean;
  getAuthHeader(): { Authorization?: string };
  forceLogout(): void;
  debugLocation(): void;
  getSessionStatus(): {
    hasToken: boolean;
    expiresAt: Date | null;
    timeUntilExpiry: number | null;
    isExpired: boolean;
  };
}

declare global {
  interface Window {
    tokenService?: TokenService;
  }
}

export {};
