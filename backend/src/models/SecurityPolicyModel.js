import db from './database/index.js';
import { DEFAULT_SECURITY_POLICY, normalizeSecurityPolicy } from '../services/security/securityPolicy.js';

class SecurityPolicyModel {
  static get(userId) {
    return new Promise((resolve, reject) => {
      db.get('SELECT policy_json, revision FROM security_policies WHERE user_id = ?', [userId], (error, row) => {
        if (error) return reject(error);
        if (!row) return resolve({ policy: normalizeSecurityPolicy(DEFAULT_SECURITY_POLICY), revision: 0 });
        try {
          resolve({ policy: normalizeSecurityPolicy(JSON.parse(row.policy_json)), revision: row.revision });
        } catch {
          resolve({ policy: normalizeSecurityPolicy(DEFAULT_SECURITY_POLICY), revision: row.revision || 0 });
        }
      });
    });
  }

  static async save(userId, input) {
    const policy = normalizeSecurityPolicy(input);
    return new Promise((resolve, reject) => {
      db.get(
        `INSERT INTO security_policies (user_id, policy_json, revision, updated_at)
         VALUES (?, ?, 1, datetime('now'))
         ON CONFLICT(user_id) DO UPDATE SET
           policy_json = excluded.policy_json,
           revision = security_policies.revision + 1,
           updated_at = datetime('now')
         RETURNING revision`,
        [userId, JSON.stringify(policy)],
        (error, row) => error ? reject(error) : resolve({ policy, revision: row?.revision || 1 })
      );
    });
  }

  static reset(userId) {
    return new Promise((resolve, reject) => {
      db.run('DELETE FROM security_policies WHERE user_id = ?', [userId], (error) => {
        if (error) return reject(error);
        resolve({ policy: normalizeSecurityPolicy(DEFAULT_SECURITY_POLICY), revision: 0 });
      });
    });
  }
}

export default SecurityPolicyModel;
