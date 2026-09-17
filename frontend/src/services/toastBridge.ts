/**
 * Bridge so non-React code (services, error handlers) can raise toasts through
 * the app's ToastProvider. The provider registers its showToast on mount.
 */
import type { Toast } from '../contexts/ToastContext';

type ShowToast = (toast: Omit<Toast, 'id' | 'timestamp'>) => string;

let handler: ShowToast | null = null;

export function registerToastHandler(fn: ShowToast | null): void {
  handler = fn;
}

export function emitToast(
  type: Toast['type'],
  message: string,
  options: Partial<Omit<Toast, 'id' | 'timestamp' | 'type' | 'message'>> = {}
): void {
  if (!handler) return; // provider not mounted (e.g. during tests) — drop silently
  handler({ type, message, ...options } as Omit<Toast, 'id' | 'timestamp'>);
}
