import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getPool } from '../config/database.js';
import { requireAuth } from '../plugins/auth.js';
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise';

const validNotificationTypes: readonly string[] = [
  'payment_submitted',
  'timesheet_submitted',
  'invoice_status_change',
  'payment_verification_needed',
  'payment_verified',
  'timesheet_approved',
  'invoice_overdue',
  'system_alert',
] as const;

const updatePreferenceSchema = z.object({
  email_enabled: z.boolean().optional(),
  push_enabled: z.boolean().optional(),
  sound_enabled: z.boolean().optional(),
});

export async function notificationRoutes(app: FastifyInstance) {
  const pool = getPool();

  // Get user notifications
  app.get('/', { preHandler: [requireAuth] }, async (request) => {
    const { limit = '50', offset = '0', unread_only = 'false' } = request.query as Record<string, string>;
    let where = 'WHERE user_id = ?';
    const params: unknown[] = [request.userId];
    if (unread_only === 'true') { where += ' AND is_read = false'; }

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT * FROM notifications ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), parseInt(offset)]
    );
    return { success: true, data: rows };
  });

  // Get unread count
  app.get('/unread-count', { preHandler: [requireAuth] }, async (request) => {
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = false',
      [request.userId]
    );
    return { success: true, data: { count: Number(rows[0]?.count ?? 0) } };
  });

  // Mark notification as read
  app.post('/:id/read', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [result] = await pool.query<ResultSetHeader>(
      'UPDATE notifications SET is_read = true WHERE id = ? AND user_id = ?',
      [id, request.userId]
    );
    if (result.affectedRows === 0) return reply.status(404).send({ error: 'Notification not found' });
    return { success: true, message: 'Notification marked as read' };
  });

  // Mark all as read
  app.post('/mark-all-read', { preHandler: [requireAuth] }, async (request) => {
    const [result] = await pool.query<ResultSetHeader>(
      'UPDATE notifications SET is_read = true WHERE user_id = ? AND is_read = false',
      [request.userId]
    );
    return { success: true, message: `${result.affectedRows} notifications marked as read`, data: { count: result.affectedRows } };
  });

  // Delete notification
  app.delete('/:id', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [result] = await pool.query<ResultSetHeader>(
      'DELETE FROM notifications WHERE id = ? AND user_id = ?',
      [id, request.userId]
    );
    if (result.affectedRows === 0) return reply.status(404).send({ error: 'Notification not found' });
    return { success: true, message: 'Notification deleted' };
  });

  // Get notification preferences
  app.get('/preferences', { preHandler: [requireAuth] }, async (request) => {
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT * FROM notification_preferences WHERE user_id = ?',
      [request.userId]
    );
    return { success: true, data: rows };
  });

  // Update notification preferences
  app.put('/preferences/:type', { preHandler: [requireAuth] }, async (request, reply) => {
    const { type } = request.params as { type: string };
    if (!validNotificationTypes.includes(type)) {
      return reply.status(400).send({ error: 'Invalid notification type' });
    }

    const data = updatePreferenceSchema.parse(request.body);
    const [existing] = await pool.query<RowDataPacket[]>(
      'SELECT id FROM notification_preferences WHERE user_id = ? AND notification_type = ?',
      [request.userId, type]
    );

    if (existing.length > 0) {
      await pool.query(
        `UPDATE notification_preferences SET
         email_enabled = COALESCE(?, email_enabled),
         push_enabled = COALESCE(?, push_enabled),
         sound_enabled = COALESCE(?, sound_enabled),
         updated_at = CURRENT_TIMESTAMP
         WHERE user_id = ? AND notification_type = ?`,
        [data.email_enabled ?? null, data.push_enabled ?? null, data.sound_enabled ?? null,
         request.userId, type]
      );
    } else {
      await pool.query(
        `INSERT INTO notification_preferences (user_id, notification_type, email_enabled, push_enabled, sound_enabled)
         VALUES (?, ?, ?, ?, ?)`,
        [request.userId, type, data.email_enabled ?? true, data.push_enabled ?? true, data.sound_enabled ?? true]
      );
    }

    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT * FROM notification_preferences WHERE user_id = ? AND notification_type = ?',
      [request.userId, type]
    );
    return { success: true, data: rows[0] };
  });
}
