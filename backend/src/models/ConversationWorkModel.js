import { randomUUID } from 'node:crypto';

/** Inject the database: tests and workers must never implicitly open the app DB. */
export class ConversationWorkModel {
  constructor(database) { this.database = database; }

  run(sql, parameters = []) {
    return new Promise((resolve, reject) => this.database.run(sql, parameters, function (error) {
      if (error) reject(error); else resolve({ changes: this.changes });
    }));
  }

  get(sql, parameters = []) {
    return new Promise((resolve, reject) => this.database.get(sql, parameters, (error, row) => {
      if (error) reject(error); else resolve(row ?? null);
    }));
  }

  async initialize() {
    await this.run(`CREATE TABLE IF NOT EXISTS conversation_work (
      id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, owner_id TEXT NOT NULL,
      objective TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'queued', checkpoint_json TEXT NOT NULL DEFAULT '{}',
      next_wake INTEGER NOT NULL DEFAULT 0, lease_token TEXT, lease_until INTEGER,
      generation INTEGER NOT NULL DEFAULT 0, reason TEXT, updated_at INTEGER NOT NULL
    )`);
    await this.run(`CREATE UNIQUE INDEX IF NOT EXISTS conversation_work_active
      ON conversation_work(conversation_id) WHERE status NOT IN ('succeeded', 'cancelled')`);
    await this.run('CREATE INDEX IF NOT EXISTS conversation_work_due ON conversation_work(status, next_wake, lease_until)');
    await this.run(`CREATE TABLE IF NOT EXISTS conversation_work_events (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT, work_id TEXT NOT NULL,
      owner_id TEXT NOT NULL, status TEXT NOT NULL, generation INTEGER NOT NULL,
      revision INTEGER NOT NULL, reason TEXT, created_at INTEGER NOT NULL
    )`);
    await this.run(`CREATE TRIGGER IF NOT EXISTS conversation_work_status_event AFTER UPDATE OF status ON conversation_work
      WHEN NEW.status != OLD.status BEGIN
      INSERT INTO conversation_work_events(work_id,owner_id,status,generation,revision,reason,created_at)
      VALUES(NEW.id,NEW.owner_id,NEW.status,NEW.generation,NEW.revision,NEW.reason,NEW.updated_at);
      END`);
  }

  async create({ conversationId, ownerId, objective, checkpoint = {}, status = 'queued', now = Date.now() }) {
    if (![conversationId, ownerId, objective].every((value) => typeof value === 'string' && value.trim())) {
      throw new Error('Conversation, owner and objective are required');
    }
    if (!['queued', 'preparing'].includes(status)) throw new Error('Invalid initial state');
    const id = randomUUID();
    const serialized = JSON.stringify(checkpoint);
    if (Buffer.byteLength(serialized) > 1024 * 1024) throw new Error('Checkpoint exceeds bounded storage allowance');
    await this.run(`INSERT INTO conversation_work(id, conversation_id, owner_id, objective, checkpoint_json, status, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`, [id, conversationId, ownerId, objective, serialized, status, now]);
    return this.find(id, ownerId);
  }

  async admit(id, ownerId, checkpoint, now = Date.now()) {
    const serialized = JSON.stringify(checkpoint);
    if (Buffer.byteLength(serialized) > 1024 * 1024) throw new Error('Checkpoint exceeds bounded storage allowance');
    const result = await this.run(`UPDATE conversation_work SET status='queued',checkpoint_json=?,updated_at=?
      WHERE id=? AND owner_id=? AND status='preparing'`, [serialized, now, id, ownerId]);
    return result.changes === 1;
  }

  due({ now = Date.now(), limit = 1 } = {}) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid admission limit');
    return new Promise((resolve, reject) => this.database.all(`SELECT id, owner_id FROM conversation_work
      WHERE next_wake <= ? AND (status IN ('queued', 'retry_wait') OR
      (status = 'running' AND lease_until <= ?)) ORDER BY updated_at, id LIMIT ?`,
    [now, now, limit], (error, rows) => error ? reject(error) : resolve(rows)));
  }

  events(id, ownerId, after = 0) {
    if (!Number.isSafeInteger(after) || after < 0) throw new Error('Invalid event cursor');
    return new Promise((resolve, reject) => this.database.all(`SELECT sequence, work_id AS workId, status, generation, revision, reason
      FROM conversation_work_events WHERE work_id = ? AND owner_id = ? AND sequence > ?
      ORDER BY sequence LIMIT 1000`, [id, ownerId, after], (error, rows) => error ? reject(error) : resolve(rows)));
  }

  findActiveConversation(conversationId, ownerId) {
    return this.get(`SELECT * FROM conversation_work WHERE conversation_id = ? AND owner_id = ?
      AND status NOT IN ('succeeded','cancelled') ORDER BY updated_at DESC LIMIT 1`, [conversationId, ownerId]);
  }

  find(id, ownerId) {
    return this.get('SELECT * FROM conversation_work WHERE id = ? AND owner_id = ?', [id, ownerId]);
  }

  async claim(id, ownerId, { now = Date.now(), leaseMs = 120000 } = {}) {
    if (!Number.isFinite(leaseMs) || leaseMs <= 0) throw new Error('Invalid lease duration');
    const token = randomUUID();
    const result = await this.run(`UPDATE conversation_work SET status = 'running', lease_token = ?,
      lease_until = ?, generation = generation + 1, updated_at = ?
      WHERE id = ? AND owner_id = ? AND next_wake <= ?
      AND (status IN ('queued', 'retry_wait') OR (status = 'running' AND lease_until <= ?))
      AND (lease_token IS NULL OR lease_until <= ?)`,
    [token, now + leaseMs, now, id, ownerId, now, now, now]);
    return result.changes === 1 ? this.find(id, ownerId) : null;
  }

  async checkpoint(claim, { status, checkpoint, reason, nextWake = 0, now = Date.now() }) {
    if (!['queued', 'retry_wait', 'waiting_dependency', 'waiting_auth', 'waiting_permission', 'succeeded'].includes(status)) {
      throw new Error('Invalid checkpoint state');
    }
    const serialized = JSON.stringify(checkpoint);
    if (Buffer.byteLength(serialized) > 1024 * 1024) throw new Error('Checkpoint exceeds bounded storage allowance');
    const result = await this.run(`UPDATE conversation_work SET status = ?, checkpoint_json = ?,
      reason = ?, next_wake = ?, lease_token = NULL, lease_until = NULL, updated_at = ?
      WHERE id = ? AND owner_id = ? AND status = 'running' AND lease_token = ?
      AND generation = ? AND revision = ? AND lease_until > ?`,
    [status, serialized, reason, nextWake, now, claim.id, claim.owner_id, claim.lease_token,
      claim.generation, claim.revision, now]);
    return result.changes === 1;
  }

  async pause(id, ownerId, now = Date.now()) {
    const result = await this.run(`UPDATE conversation_work SET status = 'paused', generation = generation + 1,
      lease_token = NULL, lease_until = NULL, updated_at = ?
      WHERE id = ? AND owner_id = ? AND status NOT IN ('succeeded', 'cancelled')`, [now, id, ownerId]);
    return result.changes === 1;
  }

  async resume(id, ownerId, now = Date.now()) {
    const result = await this.run(`UPDATE conversation_work SET status = 'queued', next_wake = ?, updated_at = ?
      WHERE id = ? AND owner_id = ? AND status = 'paused'`, [now, now, id, ownerId]);
    return result.changes === 1;
  }

  async wake(id, ownerId, reason, now = Date.now()) {
    const allowed = { credential_updated: 'waiting_auth', operation_completed: 'waiting_dependency', permission_granted: 'waiting_permission' };
    const previous = allowed[reason];
    if (!previous) throw new Error('Invalid wake reason');
    const result = await this.run(`UPDATE conversation_work SET status = 'queued', next_wake = ?, reason = ?, updated_at = ?
      WHERE id = ? AND owner_id = ? AND status = ?`, [now, reason, now, id, ownerId, previous]);
    return result.changes === 1;
  }

  async renew(claim, { now = Date.now(), leaseMs = 120000 } = {}) {
    if (!Number.isFinite(leaseMs) || leaseMs <= 0) throw new Error('Invalid lease duration');
    const result = await this.run(`UPDATE conversation_work SET lease_until = ?, updated_at = ?
      WHERE id = ? AND owner_id = ? AND status = 'running' AND lease_token = ?
      AND generation = ? AND lease_until > ?`,
    [now + leaseMs, now, claim.id, claim.owner_id, claim.lease_token, claim.generation, now]);
    return result.changes === 1;
  }
}
