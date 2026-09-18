/**
 * The one place for money, date and tax formatting.
 *
 * Rules (docs/AUDIT_2026-09-17.md §5):
 *  - Currency is Canadian dollars, formatted en-CA:  $1,234.56
 *  - Date-only values (YYYY-MM-DD) are never passed through `new Date()` + toISOString,
 *    which shifts evening Ontario dates to the previous/next day via UTC.
 *  - Tax rate comes from one constant, not literals scattered through screens.
 */
import { format, parseISO, isValid } from 'date-fns';
import logger from './logger';

// ---------------------------------------------------------------- currency

const cad = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' });

/** "$1,234.56". Accepts numbers or numeric strings; null/undefined/NaN -> "$0.00". */
export const formatCurrency = (amount: number | string | null | undefined): string => {
  const n = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (n == null || Number.isNaN(n)) return cad.format(0);
  return cad.format(n);
};

/** Like formatCurrency but returns "—" for missing values instead of "$0.00". */
export const formatCurrencyOrDash = (amount: number | string | null | undefined): string => {
  const n = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (n == null || Number.isNaN(n)) return '—';
  return cad.format(n);
};

// -------------------------------------------------------------------- tax
//
// The rate is runtime-configurable. The build-time VITE_HST_RATE is only the
// initial/fallback value; `initTaxConfig()` fetches GET /config at app start and
// hands the authoritative rate to `setTaxConfig()`.
//
// Read it with getHSTRate()/getHSTLabel(). The HST_RATE/HST_LABEL constants are
// frozen at build time and cannot see a runtime update — they are kept only for
// call sites that have not migrated yet.

const buildTimeRate: number = (() => {
  const raw = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_HST_RATE;
  const n = raw ? parseFloat(raw) : NaN;
  return Number.isFinite(n) && n >= 0 && n < 1 ? n : 0.13;
})();

const makeTaxLabel = (rate: number): string => `HST (${Math.round(rate * 1000) / 10}%)`;

let currentTaxRate: number = buildTimeRate;
let currentTaxLabel: string = makeTaxLabel(buildTimeRate);

/** The tax rate as a fraction (e.g. 0.13). Always read this, never a literal. */
export const getHSTRate = (): number => currentTaxRate;

/** The display label for the tax line, e.g. "HST (13%)". */
export const getHSTLabel = (): string => currentTaxLabel;

/**
 * Set the tax configuration at runtime. Invalid values are ignored so a bad
 * response can never replace a working rate with NaN.
 */
export const setTaxConfig = (config: { taxRate?: number | string | null; taxLabel?: string | null }): void => {
  const raw = config?.taxRate;
  const n = typeof raw === 'string' ? parseFloat(raw) : raw;
  if (typeof n === 'number' && Number.isFinite(n) && n >= 0 && n < 1) {
    currentTaxRate = n;
    currentTaxLabel = makeTaxLabel(n);
  }
  if (config?.taxLabel) currentTaxLabel = config.taxLabel;
};

/** Reset to the build-time value. Intended for tests. */
export const resetTaxConfig = (): void => {
  currentTaxRate = buildTimeRate;
  currentTaxLabel = makeTaxLabel(buildTimeRate);
};

let taxConfigPromise: Promise<void> | null = null;

/**
 * Fetch GET /api/v1/config once and apply { taxRate, taxLabel }.
 * Never throws and never rejects: on failure the build-time fallback stays.
 * Call this at app start (main.tsx).
 */
export const initTaxConfig = (): Promise<void> => {
  if (taxConfigPromise) return taxConfigPromise;
  taxConfigPromise = (async () => {
    try {
      const { default: api } = await import('../services/api');
      const response = await api.get('/config');
      const data = response?.data?.data;
      if (data) setTaxConfig({ taxRate: data.taxRate, taxLabel: data.taxLabel });
    } catch (e) {
      logger.warn('initTaxConfig: falling back to build-time tax rate', e);
    }
  })();
  return taxConfigPromise;
};

/** @deprecated build-time snapshot; use getHSTRate() so runtime config is honoured. */
export const HST_RATE: number = buildTimeRate;

/** @deprecated build-time snapshot; use getHSTLabel() so runtime config is honoured. */
export const HST_LABEL: string = makeTaxLabel(buildTimeRate);

/** Split a subtotal into { subtotal, tax, total } using the current rate, rounded to cents. */
export const applyTax = (subtotal: number) => {
  const tax = Math.round(subtotal * getHSTRate() * 100) / 100;
  return { subtotal, tax, total: Math.round((subtotal + tax) * 100) / 100 };
};

// ------------------------------------------------------------------ dates

export const DATE_FORMATS = {
  DISPLAY: 'MMM d, yyyy',    // Jan 1, 2024
  SHORT: 'MM/dd/yyyy',       // 01/01/2024
  ISO: 'yyyy-MM-dd',         // 2024-01-01
  LONG: 'MMMM d, yyyy',      // January 1, 2024
} as const;

type DateInput = string | Date | null | undefined;

/**
 * Parse a date value without a UTC shift. A bare "YYYY-MM-DD" (or the date part of an
 * ISO string) is interpreted as a local calendar date. Returns null when invalid.
 */
export const parseLocalDate = (value: DateInput): Date | null => {
  if (!value) return null;
  if (value instanceof Date) return isValid(value) ? value : null;
  const s = String(value).trim();
  // Date-only, or an ISO datetime: use the calendar date part as local
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) {
    const d = parseISO(`${m[1]}-${m[2]}-${m[3]}`);
    return isValid(d) ? d : null;
  }
  const d = new Date(s);
  return isValid(d) ? d : null;
};

/** "Jan 1, 2024" — the default for dates in tables and details. */
export const formatDisplayDate = (value: DateInput, fallback = '—'): string => {
  const d = parseLocalDate(value);
  if (!d) return fallback;
  try {
    return format(d, DATE_FORMATS.DISPLAY);
  } catch (e) {
    logger.error('formatDisplayDate failed', value, e);
    return fallback;
  }
};

/** Alias kept for existing call sites. Prefer formatDisplayDate. */
export const formatDate = (value: DateInput): string => formatDisplayDate(value, '-');

/** "01/01/2024" */
export const formatShortDate = (value: DateInput): string => {
  const d = parseLocalDate(value);
  return d ? format(d, DATE_FORMATS.SHORT) : '';
};

/** "January 1, 2024" */
export const formatLongDate = (value: DateInput): string => {
  const d = parseLocalDate(value);
  return d ? format(d, DATE_FORMATS.LONG) : '';
};

/** "2024-01-01" from any date input, in LOCAL time (never toISOString). */
export const formatISODate = (value: DateInput): string => {
  const d = parseLocalDate(value);
  return d ? format(d, DATE_FORMATS.ISO) : '';
};

/**
 * "YYYY-MM-DD" for a Date in local time. Use this instead of
 * `date.toISOString().split('T')[0]`, which converts to UTC first and moves evening
 * Ontario dates to the next day.
 */
export const toLocalDateString = (date: Date): string => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

/** Today's local date as "YYYY-MM-DD". */
export const getTodayDate = (): string => toLocalDateString(new Date());

/** "2:30 PM" */
export const formatTime = (value: DateInput): string => {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (!isValid(d)) return '';
  return d.toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit', hour12: true });
};

/** "Jan 1, 2024, 2:30 PM" for timestamps (audit logs, submissions). */
export const formatDateTime = (value: DateInput): string => {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (!isValid(d)) return '—';
  return `${format(d, DATE_FORMATS.DISPLAY)}, ${formatTime(d)}`;
};

/** @deprecated use formatLongDate */
export const formatDateWithoutTimezone = (value: string): string => formatLongDate(value);

// ---------------------------------------------------------------- status

// Get MUI Chip color based on payment/course status
export const getStatusChipColor = (status: string | null | undefined) => {
  switch (status?.toLowerCase()) {
    case 'paid':
      return 'success';
    case 'pending':
      return 'warning';
    case 'overdue':
      return 'error';
    case 'completed':
      return 'success';
    case 'invoiced':
      return 'success';
    case 'scheduled':
      return 'primary';
    case 'billing ready':
      return 'info';
    case 'cancelled':
      return 'error';
    default:
      return 'default';
  }
};
