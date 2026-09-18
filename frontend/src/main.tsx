import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocalizationProvider } from '@mui/x-date-pickers';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { AuthProvider } from './contexts/AuthContext';
import { ToastProvider } from './contexts/ToastContext';
import { NetworkProvider } from './contexts/NetworkContext';
import { CustomThemeProvider } from './contexts/ThemeContext';
import ErrorBoundary from './components/common/ErrorBoundary';
import ToastContainer from './components/common/ToastContainer';
import TokenValidationProvider from './components/TokenValidationProvider';
import App from './App';
import { initTaxConfig } from './utils/formatters';
import './index.css';

// Global error handlers — capture unhandled errors in all environments
function reportError(source: string, error: unknown) {
  const payload = {
    source,
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    url: window.location.href,
    timestamp: new Date().toISOString(),
  };
  if (import.meta.env.DEV) {
    console.error(`[${source}]`, payload);
  }
  // Fire-and-forget POST to backend error collector
  const apiBase = import.meta.env.VITE_API_URL || '/api/v1';
  fetch(`${apiBase}/client-errors`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch(() => { /* silently ignore reporting failures */ });
}

window.onerror = (msg, url, line, col, error) => {
  reportError('window.onerror', error || msg);
  return false;
};
window.addEventListener('unhandledrejection', event => {
  reportError('unhandledrejection', event.reason);
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30_000,       // 30s default — most data is fresh enough
      gcTime: 5 * 60_000,     // 5min garbage collection
    },
  },
});

const handleRootError = (error: Error, errorInfo: React.ErrorInfo) => {
  console.error('[Root Error Boundary] Critical application error:', error, errorInfo);
};

// Fetch the authoritative tax rate from GET /config. Never rejects; the build-time
// value stays if the request fails, so this must not block the first render.
void initTaxConfig();

try {
  const rootElement = document.getElementById('root');
  if (!rootElement) throw new Error('Root element not found');

  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <ErrorBoundary context="root_application" onError={handleRootError} showDetails={true}>
        <QueryClientProvider client={queryClient}>
          <CustomThemeProvider>
            <LocalizationProvider dateAdapter={AdapterDateFns}>
              <BrowserRouter
                future={{
                  v7_startTransition: true,
                  v7_relativeSplatPath: true,
                }}
              >
                <AuthProvider>
                  <NetworkProvider>
                    <ToastProvider>
                      <TokenValidationProvider>
                        <App />
                      </TokenValidationProvider>
                      <ToastContainer />
                    </ToastProvider>
                  </NetworkProvider>
                </AuthProvider>
              </BrowserRouter>
            </LocalizationProvider>
          </CustomThemeProvider>
        </QueryClientProvider>
      </ErrorBoundary>
    </React.StrictMode>
  );
} catch (error) {
  console.error('[main.tsx] Fatal Error', error);
  document.body.innerHTML = `
    <div style="color: red; padding: 20px;">
      <h1>Error</h1>
      <pre>${error instanceof Error ? error.message : 'Unknown error'}</pre>
    </div>
  `;
}
