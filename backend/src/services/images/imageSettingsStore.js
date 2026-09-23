import { initialSettings, validateState } from './imageSettingsContract.js';

/** Inject the established DB connection; no import-time schema work or own DB.
 * initialize() must be called by the main-process migration owner, not workers.
 * This module is not mounted in production until that integration is reviewed.
 */
export function createImageSettingsStore(db) {
  const run = (sql, params = []) => new Promise((resolve,reject) => db.run(sql,params,function(error) { error ? reject(error) : resolve(this.changes); }));
  const get = (sql, params) => new Promise((resolve,reject) => db.get(sql,params,(error,row) => error ? reject(error) : resolve(row)));
  const validUser = userId => { if (typeof userId !== 'string' || !userId.trim() || userId.length > 256) throw new Error('Invalid user identity.'); };
  return {
    async initialize() {
      await run('CREATE TABLE IF NOT EXISTS image_settings (user_id TEXT PRIMARY KEY, revision INTEGER NOT NULL CHECK(revision >= 1), state_json TEXT NOT NULL)');
    },
    async read(userId) {
      validUser(userId);
      const row = await get('SELECT revision, state_json FROM image_settings WHERE user_id = ?', [userId]);
      if (!row) return initialSettings();
      const state = JSON.parse(row.state_json); validateState(state);
      if (state.revision !== row.revision) throw new Error('Stored image settings revision mismatch.');
      return state;
    },
    async compareAndSwap(userId, expectedRevision, next) {
      validUser(userId); validateState(next);
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || next.revision !== expectedRevision + 1) throw new Error('Invalid settings revision transition.');
      const json = JSON.stringify(next);
      if (Buffer.byteLength(json,'utf8') > 65536) throw new Error('Image settings exceed size limit.');
      let changed;
      if (expectedRevision === 0) {
        changed = await run('INSERT INTO image_settings (user_id, revision, state_json) VALUES (?, ?, ?) ON CONFLICT(user_id) DO NOTHING', [userId,next.revision,json]);
      } else {
        changed = await run('UPDATE image_settings SET revision = ?, state_json = ? WHERE user_id = ? AND revision = ?', [next.revision,json,userId,expectedRevision]);
      }
      if (changed !== 1) throw Object.assign(new Error('Image settings revision conflict; reload before saving.'), {code:'IMAGE_SETTINGS_CONFLICT'});
      return JSON.parse(json);
    },
  };
}
