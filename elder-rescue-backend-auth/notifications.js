const db = require('./db');

function queueNotification({ reportId, recipientType, recipientId, destination, eventType, payload }) {
  const result = db.prepare(`
    INSERT INTO notifications
      (report_id, recipient_type, recipient_id, destination, event_type, payload_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    reportId,
    recipientType,
    recipientId || null,
    destination,
    eventType,
    JSON.stringify(payload)
  );
  return result.lastInsertRowid;
}

async function dispatchPendingNotifications() {
  const webhookUrl = process.env.NOTIFICATION_WEBHOOK_URL;
  if (!webhookUrl) return;

  const pending = db.prepare(`
    SELECT * FROM notifications
    WHERE status IN ('pending', 'failed') AND attempts < 5
    ORDER BY created_at ASC
    LIMIT 20
  `).all();

  for (const notification of pending) {
    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: notification.id,
          report_id: notification.report_id,
          recipient_type: notification.recipient_type,
          recipient_id: notification.recipient_id,
          destination: notification.destination,
          event_type: notification.event_type,
          payload: JSON.parse(notification.payload_json),
        }),
      });
      if (!response.ok) throw new Error(`Notification provider returned ${response.status}.`);
      db.prepare(`
        UPDATE notifications
        SET status = 'sent', attempts = attempts + 1, sent_at = datetime('now'), last_error = NULL
        WHERE id = ?
      `).run(notification.id);
    } catch (error) {
      db.prepare(`
        UPDATE notifications
        SET status = 'failed', attempts = attempts + 1, last_error = ?
        WHERE id = ?
      `).run(String(error.message).slice(0, 500), notification.id);
    }
  }
}

module.exports = { queueNotification, dispatchPendingNotifications };
