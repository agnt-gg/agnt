import { randomUUID } from 'node:crypto';
import { encrypt, decrypt } from '../utils/encryption.js';

/** Immutable encrypted snapshots; checkpoints contain references, not history copies. */
export class ConversationSnapshotModel {
  constructor(store, { encode = encrypt, decode = decrypt } = {}) { Object.assign(this, {store,encode,decode}); }
  async initialize() {
    await this.store.run(`CREATE TABLE IF NOT EXISTS conversation_snapshots (
      id TEXT PRIMARY KEY, work_id TEXT NOT NULL REFERENCES conversation_work(id),
      owner_id TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL
    )`);
    await this.store.run('CREATE INDEX IF NOT EXISTS conversation_snapshots_work ON conversation_snapshots(work_id, created_at)');
  }
  forWork(work) {
    return {
      write: async value => {
        const serialized = JSON.stringify(value);
        if (Buffer.byteLength(serialized) > 32 * 1024 * 1024) throw new Error('Snapshot exceeds storage allowance');
        const id = randomUUID();
        const result = await this.store.run(`INSERT INTO conversation_snapshots(id,work_id,owner_id,payload,created_at)
          SELECT ?,id,owner_id,?,? FROM conversation_work WHERE id = ? AND owner_id = ?`,
        [id,this.encode(serialized),Date.now(),work.id,work.owner_id]);
        if (result.changes !== 1) throw new Error('Snapshot owner unavailable');
        return id;
      },
      read: async id => {
        if (typeof id !== 'string' || !id) throw new Error('Snapshot reference required');
        const row = await this.store.get('SELECT payload FROM conversation_snapshots WHERE id = ? AND work_id = ? AND owner_id = ?', [id,work.id,work.owner_id]);
        if (!row) throw new Error('Snapshot unavailable for this work');
        return JSON.parse(this.decode(row.payload));
      },
    };
  }
}
