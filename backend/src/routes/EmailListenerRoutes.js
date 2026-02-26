import express from 'express';
import db from '../models/database/index.js';
import { authenticateToken } from './Middleware.js';

const EmailListenerRoutes = express.Router();

// Get all workflows with receive-email trigger nodes for the authenticated user
EmailListenerRoutes.get('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const listeners = await new Promise((resolve, reject) => {
      // Use node_summary (denormalized) for fast matching, fall back to workflow_data LIKE
      const query = `
        SELECT id, workflow_data, status, created_at, updated_at
        FROM workflows
        WHERE user_id = ?
        AND (
          node_summary LIKE '%"type":"receive-email"%'
          OR node_summary LIKE '%"type": "receive-email"%'
          OR workflow_data LIKE '%receive-email%'
        )
        ORDER BY updated_at DESC
      `;

      db.all(query, [userId], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          const results = [];

          for (const row of rows || []) {
            let workflowName = 'Unnamed Workflow';
            let emailAddress = `workflow-${row.id}@${process.env.IMAP_EMAIL_DOMAIN || 'agnt.gg'}`;
            let emailConfig = 'Built-in Email';
            let hasEmailNode = false;

            try {
              const data = JSON.parse(row.workflow_data);
              workflowName = data.name || workflowName;

              // Find the receive-email node to confirm and get config details
              const emailNode = data.nodes?.find((n) => n.type === 'receive-email');
              if (emailNode) {
                hasEmailNode = true;
                if (emailNode.parameters) {
                  emailConfig = emailNode.parameters.emailConfig || 'Built-in Email';
                  if (emailConfig === 'Custom IMAP' && emailNode.parameters.imapUser) {
                    emailAddress = emailNode.parameters.imapUser;
                  }
                }
              }
            } catch {
              // ignore parse errors
            }

            // Only include if we confirmed a receive-email node exists
            if (hasEmailNode) {
              results.push({
                id: row.id,
                workflow_id: row.id,
                workflow_name: workflowName,
                workflow_status: row.status,
                email_address: emailAddress,
                email_config: emailConfig,
                created_at: row.created_at,
                updated_at: row.updated_at,
              });
            }
          }

          resolve(results);
        }
      });
    });

    res.json({ success: true, listeners });
  } catch (error) {
    console.error('Error fetching email listeners:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch email listeners' });
  }
});

export default EmailListenerRoutes;
