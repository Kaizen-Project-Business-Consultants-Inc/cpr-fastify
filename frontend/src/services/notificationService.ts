import { api } from './api';

export interface Notification {
  id: number;
  recipientId: number;
  senderId?: number;
  senderName?: string;
  type: string;
  title: string;
  message: string;
  data?: Record<string, unknown>;
  isRead: boolean;
  readAt?: string;
  createdAt: string;
}

export interface NotificationFilters {
  page?: number;
  limit?: number;
  unreadOnly?: boolean;
}

class NotificationService {
  // Get notifications for current user
  async getNotifications(filters: NotificationFilters = {}): Promise<{
    notifications: Notification[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      pages: number;
    };
    unreadCount: number;
  }> {
    const params = new URLSearchParams();
    
    if (filters.page) params.append('page', filters.page.toString());
    if (filters.limit) params.append('limit', filters.limit.toString());
    if (filters.unreadOnly) params.append('unread_only', filters.unreadOnly.toString());

    const response = await api.get(`/notifications?${params.toString()}`);
    // The API returns `data` as a plain array of snake_case rows; older code expected a
    // wrapped { notifications, pagination, unreadCount } object. Support both.
    const raw = response.data?.data;
    const rows: unknown[] = Array.isArray(raw) ? raw : Array.isArray(raw?.notifications) ? raw.notifications : [];
    const notifications: Notification[] = rows.map((r) => {
      const n = r as Record<string, unknown>;
      return {
        id: Number(n.id),
        recipientId: Number(n.recipientId ?? n.user_id ?? n.recipient_id ?? 0),
        senderId: (n.senderId ?? n.sender_id) as number | undefined,
        senderName: (n.senderName ?? n.sender_name) as string | undefined,
        type: String(n.type ?? ''),
        title: String(n.title ?? ''),
        message: String(n.message ?? ''),
        data: n.data as Record<string, unknown> | undefined,
        isRead: Boolean(n.isRead ?? n.is_read),
        readAt: (n.readAt ?? n.read_at) as string | undefined,
        createdAt: String(n.createdAt ?? n.created_at ?? ''),
      };
    });
    const unreadCount = Array.isArray(raw)
      ? notifications.filter((n) => !n.isRead).length
      : Number(raw?.unreadCount ?? notifications.filter((n) => !n.isRead).length);
    const pagination = !Array.isArray(raw) && raw?.pagination
      ? raw.pagination
      : { page: filters.page ?? 1, limit: filters.limit ?? notifications.length, total: notifications.length, pages: 1 };
    return { notifications, pagination, unreadCount };
  }

  // Mark notification as read
  async markAsRead(notificationId: number): Promise<void> {
    await api.post(`/notifications/${notificationId}/read`);
  }

  // Mark all notifications as read
  async markAllAsRead(): Promise<void> {
    await api.post('/notifications/mark-all-read');
  }

  // Delete notification
  async deleteNotification(notificationId: number): Promise<void> {
    await api.delete(`/notifications/${notificationId}`);
  }

}

export const notificationService = new NotificationService(); 