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

  // Find webhook by workflow ID
  static findByWorkflowId(workflowId) {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT w.*, 
               json_extract(wf.workflow_data, '$.name') as workflow_name,
               wf.status as workflow_status
        FROM webhooks w
        LEFT JOIN workflows wf ON w.workflow_id = wf.id
        WHERE w.workflow_id = ?
      `;

      db.get(query, [workflowId], (err, row) => {
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
      const { workflow_id, user_id, webhook_url, method, auth_type } = webhookData;

      const query = `
        INSERT INTO webhooks (id, workflow_id, user_id, webhook_url, method, auth_type)
        VALUES (?, ?, ?, ?, ?, ?)
      `;

      db.run(query, [id, workflow_id, user_id, webhook_url, method || null, auth_type || null], function (err) {
        if (err) {
          reject(err);
        } else {
          resolve({ id, ...webhookData });
        }
      });
    });
  }

  // Delete webhook by workflow ID
  static deleteByWorkflowId(workflowId) {
    return new Promise((resolve, reject) => {
      db.run('DELETE FROM webhooks WHERE workflow_id = ?', [workflowId], function (err) {
        if (err) {
          reject(err);
        } else {
          resolve({ deleted: this.changes > 0 });
        }
      });
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
                // Create webhook record with placeholder URL (will be updated when workflow starts)
                const webhookUrl = `${process.env.REMOTE_URL}/webhook/${wf.id}`;
                await this.create({
                  workflow_id: wf.id,
                  user_id: wf.user_id,
                  webhook_url: webhookUrl,
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
