import db from './database/index.js';
import { v4 as uuidv4 } from 'uuid';

class WebhookModel {
  // Find all webhooks for a specific user
  static findByUserId(userId) {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT w.*, 
               json_extract(wf.workflow_data, '$.name') as workflow_name,
               wf.status as workflow_status
        FROM webhooks w
        LEFT JOIN workflows wf ON w.workflow_id = wf.id
        WHERE w.user_id = ?
        ORDER BY w.created_at DESC
      `;

      db.all(query, [userId], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows || []);
        }
      });
    });
  }

  /**
   * Find webhook by workflow ID.
   *
   * Pass `userId` from anything serving an HTTP request. A workflow id is a
   * guessable handle, not a secret, so the owner belongs in the WHERE clause.
   * `null` is for trusted internal callers with no user context (webhook sync
   * at boot) and never for a route handler.
   */
  static findByWorkflowId(workflowId, userId = null) {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT w.*, 
               json_extract(wf.workflow_data, '$.name') as workflow_name,
               wf.status as workflow_status
        FROM webhooks w
        LEFT JOIN workflows wf ON w.workflow_id = wf.id
        WHERE w.workflow_id = ?${userId ? ' AND w.user_id = ?' : ''}
      `;

      db.get(query, userId ? [workflowId, userId] : [workflowId], (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row || null);
        }
      });
    });
  }

  // Create a new webhook
  static create(webhookData) {
    return new Promise((resolve, reject) => {
      const id = uuidv4();
      const { workflow_id, user_id, webhook_url, method, auth_type, endpoint_id, slug } = webhookData;

      const query = `
        INSERT INTO webhooks (id, workflow_id, user_id, webhook_url, method, auth_type, endpoint_id, slug)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `;

      db.run(query, [id, workflow_id, user_id, webhook_url, method || null, auth_type || null, endpoint_id || null, slug || null], function (err) {
        if (err) {
          reject(err);
        } else {
          resolve({ id, ...webhookData });
        }
      });
    });
  }

  /**
   * Delete webhook by workflow ID.
   *
   * `userId` is MANDATORY here — not optional as on the read path. No internal
   * caller needs an unscoped delete, so requiring the argument makes the
   * unsafe call impossible to write rather than merely discouraged. Callers
   * without a user in scope resolve one via findOwnerId below.
   */
  static deleteByWorkflowId(workflowId, userId) {
    if (!userId) {
      return Promise.reject(new Error('deleteByWorkflowId requires a userId: an unscoped delete crosses tenants'));
    }
    return new Promise((resolve, reject) => {
      db.run('DELETE FROM webhooks WHERE workflow_id = ? AND user_id = ?', [workflowId, userId], function (err) {
        if (err) {
          reject(err);
        } else {
          resolve({ deleted: this.changes > 0 });
        }
      });
    });
  }

  /**
   * Resolve the owner of a webhook row.
   *
   * Exists so that trusted internal callers which legitimately have no user in
   * scope (workflow deactivation, restart cleanup) can still perform a SCOPED
   * delete. The alternative — an unscoped delete helper — would be a method
   * whose whole purpose is to skip the ownership check, and it would be reached
   * for by the next person in a hurry.
   */
  static findOwnerId(workflowId) {
    return new Promise((resolve, reject) => {
      db.get('SELECT user_id FROM webhooks WHERE workflow_id = ?', [workflowId], (err, row) => {
        if (err) reject(err);
        else resolve(row?.user_id || null);
      });
    });
  }

  /** Adopt a hosted endpoint onto a row created by the retired relay. Scoped to the owner. */
  static attachEndpoint(workflowId, userId, { endpoint_id, slug, webhook_url }) {
    if (!userId) return Promise.reject(new Error('attachEndpoint requires a userId'));
    return new Promise((resolve, reject) => {
      db.run(
        'UPDATE webhooks SET endpoint_id = ?, slug = ?, webhook_url = ?, updated_at = CURRENT_TIMESTAMP WHERE workflow_id = ? AND user_id = ?',
        [endpoint_id, slug, webhook_url, workflowId, userId],
        function (err) {
          if (err) reject(err);
          else resolve({ updated: this.changes > 0 });
        }
      );
    });
  }

  /** Advance the event cursor. Monotonic: never moves backwards. */
  static saveCursor(workflowId, cursor) {
    return new Promise((resolve, reject) => {
      db.run(
        'UPDATE webhooks SET cursor = MAX(COALESCE(cursor, 0), ?), updated_at = CURRENT_TIMESTAMP WHERE workflow_id = ?',
        [cursor, workflowId],
        function (err) {
          if (err) reject(err);
          else resolve({ updated: this.changes > 0 });
        }
      );
    });
  }

  // Load all webhooks (for server restart)
  static loadAll() {
    return new Promise((resolve, reject) => {
      db.all('SELECT * FROM webhooks', [], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows || []);
        }
      });
    });
  }

  // Sync webhooks from existing workflows
  static async syncFromWorkflows() {
    return new Promise((resolve, reject) => {
      // Get all workflows
      db.all('SELECT id, user_id, workflow_data FROM workflows', [], async (err, workflows) => {
        if (err) {
          reject(err);
          return;
        }

        let synced = 0;
        for (const wf of workflows) {
          try {
            const workflowData = JSON.parse(wf.workflow_data);

            // Check if workflow has a webhook-listener node
            const hasWebhookNode = workflowData.nodes?.some((node) => node.type === 'webhook-listener');

            if (hasWebhookNode) {
              // Check if webhook already exists in database
              const existing = await this.findByWorkflowId(wf.id);

              if (!existing) {
                // Placeholder until activation creates the hosted endpoint and
                // writes the real https://webhooks.agnt.gg/in/{slug} URL.
                await this.create({
                  workflow_id: wf.id,
                  user_id: wf.user_id,
                  webhook_url: 'pending',
                  method: null,
                  auth_type: null,
                });
                synced++;
                console.log(`Synced webhook for workflow ${wf.id}`);
              }
            }
          } catch (parseError) {
            console.error(`Error parsing workflow ${wf.id}:`, parseError);
          }
        }

        console.log(`Webhook sync complete: ${synced} webhooks created`);
        resolve({ synced });
      });
    });
  }
}

export default WebhookModel;
