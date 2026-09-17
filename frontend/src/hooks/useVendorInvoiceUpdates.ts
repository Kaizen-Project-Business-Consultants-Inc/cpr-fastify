/**
 * Vendor-invoice real-time updates.
 *
 * The Express-era app pushed these over socket.io; the Fastify backend has no
 * socket server, so the previous implementation opened a connection that never
 * succeeded. Until a push channel exists (see TODO WS-1), this hook reports
 * `isConnected: false` and screens fall back to polling/refresh as they already do.
 */
export interface VendorInvoiceUpdate {
  invoiceId: number;
  newStatus?: string;
  notes?: string;
  action?: string;
  updatedBy: string;
  timestamp: string;
}

interface UseVendorInvoiceUpdatesProps {
  onStatusUpdate?: (update: VendorInvoiceUpdate) => void;
  onNotesUpdate?: (update: VendorInvoiceUpdate) => void;
  onRefresh?: () => void;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const useVendorInvoiceUpdates = (_props: UseVendorInvoiceUpdatesProps = {}) => {
  return { socket: null, isConnected: false } as const;
};
