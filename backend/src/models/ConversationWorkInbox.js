import { randomUUID } from 'node:crypto';
/** Durable steering and wake events; duplicates cannot create duplicate instructions. */
export class ConversationWorkInbox {
  constructor(store) { this.store=store; }
  async initialize() {
    await this.store.run(`CREATE TABLE IF NOT EXISTS conversation_work_inbox (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
      work_id TEXT NOT NULL REFERENCES conversation_work(id), event_key TEXT NOT NULL,
      kind TEXT NOT NULL, payload TEXT NOT NULL, consumed_generation INTEGER,
      created_at INTEGER NOT NULL, UNIQUE(work_id,event_key)
    )`);
    await this.store.run(`CREATE TRIGGER IF NOT EXISTS conversation_work_inbox_checkpoint
      AFTER UPDATE OF checkpoint_json ON conversation_work
      WHEN json_valid(NEW.checkpoint_json) BEGIN
      UPDATE conversation_work_inbox SET consumed_generation=NEW.generation
      WHERE work_id=NEW.id AND consumed_generation IS NULL
      AND sequence <= COALESCE(json_extract(NEW.checkpoint_json,'$.inboxThrough'),0);
      END`);
  }
  async append(workId,ownerId,{key,kind,payload,now=Date.now()}) {
    if (!['steering','credential_updated','operation_completed','permission_granted'].includes(kind)) throw new Error('Invalid inbox event');
    if(typeof key!=='string'||!key)throw new Error('Idempotency key required');
    const serialized=JSON.stringify(payload);
    if(Buffer.byteLength(serialized)>65536)throw new Error('Inbox event too large');
    const result=await this.store.run(`INSERT OR IGNORE INTO conversation_work_inbox(id,work_id,event_key,kind,payload,created_at)
      SELECT ?,id,?,?,?,? FROM conversation_work WHERE id=? AND owner_id=? AND status NOT IN ('succeeded','cancelled')`,
    [randomUUID(),key,kind,serialized,now,workId,ownerId]);
    return result.changes===1;
  }
  async pending(claim) {
    return new Promise((resolve,reject)=>this.store.database.all(`SELECT inbox.* FROM conversation_work_inbox inbox
      JOIN conversation_work work ON work.id=inbox.work_id
      WHERE work.id=? AND work.owner_id=? AND work.lease_token=? AND work.generation=?
      AND work.status='running' AND inbox.consumed_generation IS NULL ORDER BY inbox.sequence`,
    [claim.id,claim.owner_id,claim.lease_token,claim.generation],(error,rows)=>error?reject(error):resolve(rows)));
  }
}
