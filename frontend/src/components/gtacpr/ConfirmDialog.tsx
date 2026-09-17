import React, { useCallback, useRef, useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Button,
  CircularProgress,
} from '@mui/material';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /** Plain text or a node. Say what will happen and whether it can be undone. */
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirm button for destructive / irreversible actions. */
  danger?: boolean;
  /** Disables both buttons and shows a spinner on confirm while the action runs. */
  loading?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

/**
 * The one confirmation dialog for the app. Replaces window.confirm and ad-hoc dialogs.
 * Escape/backdrop are blocked while `loading` so a request cannot be orphaned.
 */
const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  loading = false,
  onConfirm,
  onCancel,
}) => (
  <Dialog
    open={open}
    onClose={loading ? undefined : onCancel}
    disableEscapeKeyDown={loading}
    aria-labelledby="confirm-dialog-title"
    aria-describedby="confirm-dialog-description"
    maxWidth="xs"
    fullWidth
  >
    <DialogTitle id="confirm-dialog-title" sx={{ fontSize: 16, fontWeight: 700 }}>
      {title}
    </DialogTitle>
    <DialogContent>
      {typeof message === 'string' ? (
        <DialogContentText id="confirm-dialog-description" sx={{ fontSize: 14 }}>
          {message}
        </DialogContentText>
      ) : (
        <div id="confirm-dialog-description">{message}</div>
      )}
    </DialogContent>
    <DialogActions sx={{ px: 3, pb: 2 }}>
      <Button onClick={onCancel} disabled={loading} color="inherit">
        {cancelLabel}
      </Button>
      <Button
        onClick={onConfirm}
        disabled={loading}
        variant="contained"
        color={danger ? 'error' : 'primary'}
        autoFocus
        startIcon={loading ? <CircularProgress size={16} color="inherit" /> : undefined}
      >
        {confirmLabel}
      </Button>
    </DialogActions>
  </Dialog>
);

export default ConfirmDialog;

export interface ConfirmOptions {
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

/**
 * Imperative helper:
 *
 *   const { confirm, dialog } = useConfirm();
 *   ...
 *   const ok = await confirm({ title: 'Delete location?', message: '...', danger: true });
 *   if (!ok) return;
 *   ...
 *   return (<>{dialog}...</>)
 *
 * Resolves true on confirm, false on cancel. Render `dialog` once in the component.
 */
export function useConfirm() {
  const [state, setState] = useState<(ConfirmOptions & { open: boolean }) | null>(null);
  const [loading, setLoading] = useState(false);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const confirm = useCallback((opts: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
      setState({ ...opts, open: true });
    });
  }, []);

  const settle = useCallback((ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setLoading(false);
    setState((s) => (s ? { ...s, open: false } : s));
  }, []);

  const dialog = state ? (
    <ConfirmDialog
      open={state.open}
      title={state.title}
      message={state.message}
      confirmLabel={state.confirmLabel}
      cancelLabel={state.cancelLabel}
      danger={state.danger}
      loading={loading}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  ) : null;

  return { confirm, dialog, setLoading };
}
