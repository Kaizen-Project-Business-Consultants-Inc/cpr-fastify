import React, { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Typography,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Pagination,
  Alert,
  CircularProgress,
} from '@mui/material';
import { notificationService, Notification, NotificationFilters } from '../../services/notificationService';
import StatusChip from '../gtacpr/StatusChip';
import LinkButton from '../gtacpr/LinkButton';
import { useConfirm } from '../gtacpr/ConfirmDialog';
import { GhostButton } from '../gtacpr/Buttons';
import { useSnackbar } from '../../contexts/SnackbarContext';
import { formatDateTime } from '../../utils/formatters';

const getNotificationKind = (type: string) => {
  switch (type) {
    case 'timesheet_submitted':
    case 'profile_change_submitted':
    case 'payment_created':
      return 'warning' as const;
    case 'timesheet_approved':
    case 'payment_completed':
      return 'success' as const;
    case 'timesheet_rejected':
    case 'payment_rejected':
      return 'danger' as const;
    default:
      return 'neutral' as const;
  }
};

const getErrorMessage = (err: unknown, fallback: string) => {
  const e = err as { response?: { data?: { error?: { message?: string }; message?: string } }; message?: string };
  return e?.response?.data?.error?.message || e?.response?.data?.message || e?.message || fallback;
};

// Notification Item Component
const NotificationItem: React.FC<{
  notification: Notification;
  busy: boolean;
  onMarkAsRead: (n: Notification) => void;
  onDelete: (n: Notification) => void;
}> = ({ notification, busy, onMarkAsRead, onDelete }) => (
  <Box sx={{
    p: 2,
    borderBottom: (theme) => `1px solid ${theme.palette.divider}`,
    bgcolor: notification.isRead ? 'transparent' : (theme) => theme.palette.background.default,
    borderLeft: notification.isRead ? 'none' : '3px solid #CC1F1F',
  }}>
    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
      <Box sx={{ flex: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
          <Typography sx={{ fontSize: 13.5, fontWeight: notification.isRead ? 400 : 700, color: (theme) => theme.palette.text.primary }}>{notification.title}</Typography>
          <StatusChip kind={getNotificationKind(notification.type)} label={notification.type.replace(/_/g, ' ').toUpperCase()} />
        </Box>
        <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary, mb: 0.5 }}>{notification.message}</Typography>
        <Box sx={{ display: 'flex', gap: 2 }}>
          <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.text.secondary }}>{formatDateTime(notification.createdAt)}</Typography>
          {notification.senderName && <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.text.secondary }}>From: {notification.senderName}</Typography>}
        </Box>
      </Box>
      <Box sx={{ display: 'flex', gap: 1, ml: 2 }}>
        {!notification.isRead && (
          <LinkButton onClick={() => onMarkAsRead(notification)} disabled={busy} sx={{ color: '#16A34A' }} aria-label={`Mark "${notification.title}" as read`}>Read</LinkButton>
        )}
        <LinkButton tone="danger" onClick={() => onDelete(notification)} disabled={busy} aria-label={`Delete "${notification.title}"`}>Delete</LinkButton>
      </Box>
    </Box>
  </Box>
);

/**
 * HR notifications: list, mark read, delete.
 * (Stats, system overview and sending notifications were removed: their endpoints do not exist.)
 */
const NotificationsPanel: React.FC = () => {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<NotificationFilters>({ page: 1, limit: 20 });
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, pages: 0 });
  const [unreadCount, setUnreadCount] = useState(0);
  const { showSuccess, showError } = useSnackbar();
  const { confirm, dialog: confirmDialog } = useConfirm();

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const notificationsData = await notificationService.getNotifications(filters);
      setNotifications(notificationsData.notifications);
      setPagination(notificationsData.pagination);
      setUnreadCount(notificationsData.unreadCount);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to load notifications'));
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleMarkAsRead = async (n: Notification) => {
    if (busy) return;
    setBusy(true);
    try {
      await notificationService.markAsRead(n.id);
      await loadData();
    } catch (err: unknown) {
      showError(getErrorMessage(err, 'Failed to mark notification as read'));
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteNotification = async (n: Notification) => {
    if (busy) return;
    const ok = await confirm({
      title: 'Delete notification?',
      message: `"${n.title}" will be permanently removed. This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await notificationService.deleteNotification(n.id);
      showSuccess('Notification deleted');
      await loadData();
    } catch (err: unknown) {
      showError(getErrorMessage(err, 'Failed to delete notification'));
    } finally {
      setBusy(false);
    }
  };

  const handleMarkAllAsRead = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await notificationService.markAllAsRead();
      showSuccess('All notifications marked as read');
      await loadData();
    } catch (err: unknown) {
      showError(getErrorMessage(err, 'Failed to mark all as read'));
    } finally {
      setBusy(false);
    }
  };

  if (loading && notifications.length === 0 && !error) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400 }}><CircularProgress size={48} /></Box>;
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {confirmDialog}
      {error && (
        <Alert severity="error" onClose={() => setError(null)} action={<GhostButton onClick={loadData}>Retry</GhostButton>}>
          {error}
        </Alert>
      )}

      {/* Actions */}
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
        <GhostButton onClick={handleMarkAllAsRead} disabled={busy || unreadCount === 0}>Mark All as Read</GhostButton>
        <GhostButton onClick={loadData} disabled={loading || busy}>Refresh</GhostButton>
        <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary, ml: 1 }}>
          {unreadCount} unread
        </Typography>
      </Box>

      {/* Filter */}
      <Box sx={{ display: 'flex', gap: 2 }}>
        <FormControl sx={{ minWidth: 200 }} size="small">
          <InputLabel id="notifications-show-label">Show</InputLabel>
          <Select
            labelId="notifications-show-label"
            value={filters.unreadOnly ? 'true' : 'false'}
            onChange={(e) => setFilters(prev => ({ ...prev, unreadOnly: e.target.value === 'true', page: 1 }))}
            label="Show"
          >
            <MenuItem value="false">All Notifications</MenuItem>
            <MenuItem value="true">Unread Only</MenuItem>
          </Select>
        </FormControl>
      </Box>

      {/* Notifications List */}
      <Box sx={{ border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '10px', bgcolor: (theme) => theme.palette.background.paper, overflow: 'hidden' }}>
        {notifications.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 4 }}>
            <Typography sx={{ fontSize: 14, fontWeight: 600, color: (theme) => theme.palette.text.secondary }}>No notifications found</Typography>
            <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary, mt: 0.5 }}>You&apos;re all caught up!</Typography>
          </Box>
        ) : (
          notifications.map((notification) => (
            <NotificationItem
              key={notification.id}
              notification={notification}
              busy={busy}
              onMarkAsRead={handleMarkAsRead}
              onDelete={handleDeleteNotification}
            />
          ))
        )}
      </Box>

      {/* Pagination */}
      {pagination.pages > 1 && (
        <Box sx={{ display: 'flex', justifyContent: 'center' }}>
          <Pagination count={pagination.pages} page={pagination.page} onChange={(_, p) => setFilters(prev => ({ ...prev, page: p }))} />
        </Box>
      )}
    </Box>
  );
};

export default NotificationsPanel;
