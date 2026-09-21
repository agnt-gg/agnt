import { encrypt, decrypt } from '../../utils/encryption.js';

/** Task credentials stay encrypted and are revalidated, never minted or extended here. */
export class PersistentWorkAuthority {
  constructor({ store, verifyCredential, authorizeScope, resolveTeam, encode = encrypt, decode = decrypt }) {
    Object.assign(this, { store, verifyCredential, authorizeScope, resolveTeam, encode, decode });
  }
  async initialize() {
    await this.store.run(`CREATE TABLE IF NOT EXISTS conversation_work_authority (
      work_id TEXT PRIMARY KEY REFERENCES conversation_work(id),owner_id TEXT NOT NULL,
      kind TEXT NOT NULL,binding_json TEXT NOT NULL,credential TEXT,revoked INTEGER NOT NULL DEFAULT 0
    )`);
  }
  async bind(work, { kind, binding, credential }) {
    if (!['personal','team'].includes(kind)) throw new Error('Unknown authority kind');
    if (kind === 'team' && credential) throw new Error('Team bindings cannot capture personal credentials');
    await this.authorizeScope(work, binding);
    if (kind === 'personal') await this.checkCredential(work, credential);
    await this.store.run(`INSERT INTO conversation_work_authority(work_id,owner_id,kind,binding_json,credential)
      SELECT id,owner_id,?,?,? FROM conversation_work WHERE id=? AND owner_id=?`,
    [kind,JSON.stringify(binding),credential ? this.encode(credential) : null,work.id,work.owner_id]);
  }
  async checkCredential(work, credential) {
    if (!credential) throw Object.assign(new Error('Credential required'),{code:'waiting_auth'});
    const identity = await this.verifyCredential(credential);
    if (!identity?.ok || identity.ownerId !== work.owner_id) throw Object.assign(new Error('Credential unavailable or revoked'),{code:'waiting_auth'});
    return identity;
  }
  async resolve(work) {
    const row=await this.store.get('SELECT * FROM conversation_work_authority WHERE work_id=? AND owner_id=?',[work.id,work.owner_id]);
    if(!row || row.revoked) throw Object.assign(new Error('Work authority revoked'),{code:'waiting_permission'});
    const binding=JSON.parse(row.binding_json);
    await this.authorizeScope(work,binding);
    if(row.kind==='team') return this.resolveTeam(work,binding);
    const credential=this.decode(row.credential);
    await this.checkCredential(work,credential);
    return {authToken:credential,run:execute=>execute()};
  }
  async refresh(work, credential) {
    await this.checkCredential(work,credential);
    const result=await this.store.run(`UPDATE conversation_work_authority SET credential=?
      WHERE work_id=? AND owner_id=? AND kind='personal' AND revoked=0`,[this.encode(credential),work.id,work.owner_id]);
    return result.changes===1;
  }
  async revoke(work) {
    await this.store.run('UPDATE conversation_work_authority SET revoked=1,credential=NULL WHERE work_id=? AND owner_id=?',[work.id,work.owner_id]);
    await this.store.pause(work.id,work.owner_id);
  }
}
