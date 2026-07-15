import fs from 'fs';
import readline from 'readline';
import path from 'path';
import SecurityPolicyModel from '../../models/SecurityPolicyModel.js';
import pathManager from '../../utils/PathManager.js';
import { DEFAULT_SECURITY_POLICY, getSecurityRuleCatalog, mergeSecurityPolicies, normalizeSecurityPolicy } from './securityPolicy.js';

const AUDIT_LOG_PATH = path.join(pathManager.getRootDir(), 'security-audit.jsonl');

const cache = new Map();

class SecurityPolicyService {
  static async getUserPolicy(userId) {
    if (!userId) return { policy: normalizeSecurityPolicy(DEFAULT_SECURITY_POLICY), revision: 0 };
    // The workflow runtime is a separate child process. Its cache cannot be
    // invalidated by an account-policy update in the parent, so workflow
    // checks read SQLite directly and see saved changes on the very next node.
    const useCache = process.env.IS_WORKFLOW_PROCESS !== 'true';
    if (useCache && cache.has(userId)) return cache.get(userId);
    try {
      const value = await SecurityPolicyModel.get(userId);
      if (useCache) cache.set(userId, value);
      return value;
    } catch (error) {
      console.error('[SecurityPolicy] Failed to load policy; using Balanced:', error.message);
      return { policy: normalizeSecurityPolicy(DEFAULT_SECURITY_POLICY), revision: 0 };
    }
  }

  static async updateUserPolicy(userId, input) {
    const value = await SecurityPolicyModel.save(userId, input);
    cache.set(userId, value);
    return value;
  }

  static async resetUserPolicy(userId) {
    const value = await SecurityPolicyModel.reset(userId);
    cache.delete(userId);
    return value;
  }

  static async getEffectivePolicy({ userId, workflowPolicy }) {
    const account = await this.getUserPolicy(userId);
    return {
      policy: mergeSecurityPolicies(account.policy, workflowPolicy),
      revision: account.revision,
      scope: workflowPolicy?.inherit === false ? 'workflow' : 'account',
    };
  }

  static getRuleCatalog() {
    return getSecurityRuleCatalog();
  }

  static async getAuditEvents({ userId, limit = 100, decision }) {
    if (!fs.existsSync(AUDIT_LOG_PATH)) return [];
    const events = [];
    const stream = fs.createReadStream(AUDIT_LOG_PATH, { encoding: 'utf8' });
    const reader = readline.createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of reader) {
      try {
        const event = JSON.parse(line);
        // Authenticated audit readers must never receive global or another
        // user's historical events. Legacy entries without userId are hidden.
        if (userId && event.userId !== userId) continue;
        if (decision && event.action !== decision) continue;
        events.push(event);
        if (events.length > 1000) events.shift();
      } catch {
        // Ignore malformed historical lines.
      }
    }
    return events.slice(-Math.min(Math.max(limit, 1), 250)).reverse();
  }
}

export default SecurityPolicyService;
