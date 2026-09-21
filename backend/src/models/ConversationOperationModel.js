import { randomUUID } from 'node:crypto';

/** Write-ahead receipts. Unknown effects are reconciled, never blindly repeated. */
export class ConversationOperationModel {
  constructor(workStore) { this.store = workStore; }
  async initialize() {
    await this.store.run(`CREATE TABLE IF NOT EXISTS conversation_operations (
      id TEXT PRIMARY KEY, work_id TEXT NOT NULL REFERENCES conversation_work(id),
      logical_key TEXT NOT NULL, fingerprint TEXT NOT NULL, tool_name TEXT NOT NULL,
      status TEXT NOT NULL, result_ref TEXT, attempt_token TEXT NOT NULL,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      UNIQUE(work_id, logical_key)
    )`);
  }
  async begin(claim, { key, fingerprint, toolName, now = Date.now() }) {
    if (![key, fingerprint, toolName].every(value => typeof value === 'string' && value)) throw new Error('Invalid operation identity');
    const id = randomUUID();
    const inserted = await this.store.run(`INSERT OR IGNORE INTO conversation_operations
      (id, work_id, logical_key, fingerprint, tool_name, status, attempt_token, created_at, updated_at)
      SELECT ?, id, ?, ?, ?, 'running', ?, ?, ? FROM conversation_work
      WHERE id = ? AND owner_id = ? AND status = 'running' AND lease_token = ?
      AND generation = ? AND revision = ? AND lease_until > ?`,
    [id, key, fingerprint, toolName, claim.lease_token, now, now, claim.id, claim.owner_id,
      claim.lease_token, claim.generation, claim.revision, now]);
    if (inserted.changes === 1) return { id, dispatch: true };
    const existing = await this.store.get(`SELECT operation.* FROM conversation_operations operation
      JOIN conversation_work work ON work.id = operation.work_id
      WHERE operation.work_id = ? AND operation.logical_key = ? AND work.owner_id = ?`, [claim.id, key, claim.owner_id]);
    if (!existing) throw new Error('Operation ownership lost');
    if (existing.fingerprint !== fingerprint || existing.tool_name !== toolName) throw new Error('Operation identity reused with different input');
    return { id: existing.id, dispatch: false, status: existing.status === 'running' ? 'unknown' : existing.status, resultRef: existing.result_ref };
  }
  async finish(claim, id, { status, resultRef, now = Date.now() }) {
    if (!['completed', 'failed', 'unknown'].includes(status)) throw new Error('Invalid operation outcome');
    if (typeof resultRef !== 'string' || !resultRef) throw new Error('Durable result reference required');
    const result = await this.store.run(`UPDATE conversation_operations SET status = ?, result_ref = ?, updated_at = ?
      WHERE id = ? AND work_id = ? AND attempt_token = ? AND status = 'running'
      AND EXISTS (SELECT 1 FROM conversation_work WHERE id = ? AND owner_id = ?
      AND status = 'running' AND lease_token = ? AND generation = ? AND revision = ? AND lease_until > ?)`,
    [status, resultRef, now, id, claim.id, claim.lease_token, claim.id, claim.owner_id,
      claim.lease_token, claim.generation, claim.revision, now]);
    return result.changes === 1;
  }
}
