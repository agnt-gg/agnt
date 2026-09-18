import {
  randomUUID,
  randomBytes,
  createHash
} from 'node:crypto';

export class TeamError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const fail = (status, message) => {
  throw new TeamError(status, message)
};
const digest = value => createHash('sha256').update(value).digest('hex');
const TYPES = new Set(['markdown', 'text', 'html', 'csv', 'agent', 'workflow', 'tool', 'skill', 'widget', 'goal']);
const ROLES = new Set(['admin', 'member', 'viewer']);

function bounded(value, max, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(400, `Invalid ${label}`);
  return value.trim()
}

/** Dedicated connection + serialized transactions prevent check/write races with membership revocation. */
export class TeamRepository {
  constructor(db) {
    this.db = db;
    this.queue = Promise.resolve();
    this.ready = this.initialize()
  }
  run(sql, args = []) {
    return new Promise((resolve, reject) => this.db.run(sql, args, function(e) {
      e ? reject(e) : resolve({
        changes: this.changes
      })
    }))
  }
  get(sql, args = []) {
    return new Promise((resolve, reject) => this.db.get(sql, args, (e, row) => e ? reject(e) : resolve(row)))
  }
  all(sql, args = []) {
    return new Promise((resolve, reject) => this.db.all(sql, args, (e, rows) => e ? reject(e) : resolve(rows || [])))
  }
  async initialize() {
    await this.run('PRAGMA foreign_keys=ON');
    await this.run('PRAGMA journal_mode=WAL');
    await this.run('PRAGMA busy_timeout=10000');
    for (const sql of [
        'CREATE TABLE IF NOT EXISTS teams(id TEXT PRIMARY KEY,name TEXT NOT NULL,owner_id TEXT NOT NULL,created_at TEXT NOT NULL)',
        'CREATE TABLE IF NOT EXISTS team_members(team_id TEXT NOT NULL REFERENCES teams(id),user_id TEXT NOT NULL,role TEXT NOT NULL,email TEXT,PRIMARY KEY(team_id,user_id))',
        'CREATE TABLE IF NOT EXISTS team_invites(id TEXT PRIMARY KEY,team_id TEXT NOT NULL REFERENCES teams(id),email TEXT NOT NULL,role TEXT NOT NULL,token_hash TEXT NOT NULL UNIQUE,expires_at INTEGER NOT NULL,accepted INTEGER NOT NULL DEFAULT 0)',
        'CREATE TABLE IF NOT EXISTS team_assets(id TEXT PRIMARY KEY,team_id TEXT NOT NULL REFERENCES teams(id),name TEXT NOT NULL,kind TEXT NOT NULL,revision INTEGER NOT NULL,updated_by TEXT NOT NULL,updated_at TEXT NOT NULL)',
        'CREATE TABLE IF NOT EXISTS team_asset_versions(asset_id TEXT NOT NULL REFERENCES team_assets(id),revision INTEGER NOT NULL,content TEXT NOT NULL,author_id TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(asset_id,revision))',
        'CREATE TABLE IF NOT EXISTS team_events(id TEXT PRIMARY KEY,team_id TEXT NOT NULL REFERENCES teams(id),actor_id TEXT NOT NULL,action TEXT NOT NULL,target_id TEXT,created_at TEXT NOT NULL)',
        'CREATE INDEX IF NOT EXISTS team_members_user ON team_members(user_id)',
        'CREATE INDEX IF NOT EXISTS team_assets_team ON team_assets(team_id,updated_at)',
        'CREATE INDEX IF NOT EXISTS team_events_team ON team_events(team_id,created_at)',
        'CREATE INDEX IF NOT EXISTS team_invites_team ON team_invites(team_id,email,expires_at)',
      ]) await this.run(sql)
  }
  async transaction(fn) {
    const work = this.queue.then(async () => {
      await this.ready;
      await this.run('BEGIN IMMEDIATE');
      try {
        const result = await fn();
        await this.run('COMMIT');
        return result
      } catch (e) {
        await this.run('ROLLBACK');
        throw e
      }
    });
    this.queue = work.catch(() => {});
    return work
  }
  async member(teamId, userId, roles = null) {
    const row = await this.get('SELECT * FROM team_members WHERE team_id=? AND user_id=?', [teamId, userId]);
    if (!row) fail(404, 'Team not found');
    if (roles && !roles.includes(row.role)) fail(403, 'Your team role does not allow this operation');
    return row
  }
  async event(teamId, userId, action, target) {
    await this.run('INSERT INTO team_events VALUES(?,?,?,?,?,?)', [randomUUID(), teamId, userId, action, target, new Date().toISOString()])
  }
  list(userId) {
    return this.transaction(() => this.all('SELECT t.*,m.role FROM teams t JOIN team_members m ON t.id=m.team_id WHERE m.user_id=? ORDER BY t.name', [userId]))
  }
  create(userId, email, name) {
    return this.transaction(async () => {
      const id = randomUUID(),
        title = bounded(name, 100, 'team name');
      await this.run('INSERT INTO teams VALUES(?,?,?,?)', [id, title, userId, new Date().toISOString()]);
      await this.run('INSERT INTO team_members VALUES(?,?,?,?)', [id, userId, 'owner', email || '']);
      await this.event(id, userId, 'team.created', id);
      return {
        id,
        name: title,
        role: 'owner'
      }
    })
  }
  members(teamId, userId) {
    return this.transaction(async () => {
      await this.member(teamId, userId);
      return this.all('SELECT user_id,role,email FROM team_members WHERE team_id=? ORDER BY role,email', [teamId])
    })
  }
  invite(teamId, userId, email, role) {
    return this.transaction(async () => {
      await this.member(teamId, userId, ['owner', 'admin']);
      email = bounded(email, 254, 'email').toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !ROLES.has(role)) fail(400, 'Invalid invitation');
      if (await this.get('SELECT 1 FROM team_members WHERE team_id=? AND lower(email)=?', [teamId, email])) fail(409, 'This person is already a member');
      if (await this.get('SELECT 1 FROM team_invites WHERE team_id=? AND email=? AND accepted=0 AND expires_at>?', [teamId, email, Date.now()])) fail(409, 'A pending invitation already exists');
      const token = randomBytes(32).toString('base64url'),
        id = randomUUID(),
        expiresAt = Date.now() + 7 * 86400000;
      await this.run('INSERT INTO team_invites VALUES(?,?,?,?,?,?,0)', [id, teamId, email, role, digest(token), expiresAt]);
      await this.event(teamId, userId, 'member.invited', id);
      return {
        id,
        token,
        expiresAt,
        email,
        role
      }
    })
  }
  accept(userId, email, token) {
    return this.transaction(async () => {
      bounded(token, 200, 'invitation');
      const invite = await this.get('SELECT * FROM team_invites WHERE token_hash=?', [digest(token)]);
      if (!invite || invite.accepted || invite.expires_at < Date.now()) fail(404, 'Invitation expired or unavailable');
      if (!email || email.toLowerCase() !== invite.email) fail(403, 'Sign in as the invited email address');
      const existing = await this.get('SELECT 1 FROM team_members WHERE team_id=? AND user_id=?', [invite.team_id, userId]);
      if (existing) fail(409, 'Already a team member');
      await this.run('INSERT INTO team_members VALUES(?,?,?,?)', [invite.team_id, userId, invite.role, email]);
      await this.run('UPDATE team_invites SET accepted=1 WHERE id=?', [invite.id]);
      await this.event(invite.team_id, userId, 'member.joined', userId);
      return {
        teamId: invite.team_id
      }
    })
  }
  invitations(teamId, userId) {
    return this.transaction(async () => {
      await this.member(teamId, userId, ['owner', 'admin']);
      return this.all('SELECT id,email,role,expires_at,accepted FROM team_invites WHERE team_id=? AND accepted=0 AND expires_at>?', [teamId, Date.now()])
    })
  }
  revoke(teamId, userId, id) {
    return this.transaction(async () => {
      await this.member(teamId, userId, ['owner', 'admin']);
      await this.run('DELETE FROM team_invites WHERE team_id=? AND id=?', [teamId, id]);
      await this.event(teamId, userId, 'invite.revoked', id)
    })
  }
  removeMember(teamId, userId, target) {
    return this.transaction(async () => {
      await this.member(teamId, userId, ['owner']);
      const member = await this.member(teamId, target);
      if (member.role === 'owner') fail(409, 'The team owner cannot be removed');
      await this.run('DELETE FROM team_members WHERE team_id=? AND user_id=?', [teamId, target]);
      await this.event(teamId, userId, 'member.removed', target)
    })
  }
  assets(teamId, userId) {
    return this.transaction(async () => {
      await this.member(teamId, userId);
      return this.all('SELECT * FROM team_assets WHERE team_id=? ORDER BY updated_at DESC LIMIT 500', [teamId])
    })
  }
  asset(teamId, userId, id, revision) {
    return this.transaction(async () => {
      if(revision!==undefined && (!Number.isInteger(revision)||revision<1))fail(400,'Revision must be a positive integer');
      await this.member(teamId, userId);
      const row = await this.get('SELECT * FROM team_assets WHERE id=? AND team_id=?', [id, teamId]);
      if (!row) fail(404, 'Asset not found');
      const ver = await this.get('SELECT content,author_id,created_at FROM team_asset_versions WHERE asset_id=? AND revision=?', [id, revision || row.revision]);
      if (!ver) fail(404, 'Version not found');
      return {
        ...row,
        ...ver,
        revision: revision || row.revision
      }
    })
  }
  save(teamId, userId, input) {
    return this.transaction(async () => {
      await this.member(teamId, userId, ['owner', 'admin', 'member']);
      const name = bounded(input.name, 180, 'asset name'),
        kind = input.kind,
        content = input.content;
      if (!TYPES.has(kind) || typeof content !== 'string' || Buffer.byteLength(content) > 200000) fail(400, 'Invalid asset type or content (maximum 200 KB)');
      const now = new Date().toISOString();
      let id = input.id,
        revision = 1;
      if (id) {
        const row = await this.get('SELECT * FROM team_assets WHERE team_id=? AND id=?', [teamId, id]);
        if (!row) fail(404, 'Asset not found');
        if (!Number.isInteger(input.expectedRevision) || row.revision !== input.expectedRevision) fail(409, 'This asset changed. Reload before saving; your draft has not been applied.');
        revision = row.revision + 1;
        await this.run('UPDATE team_assets SET name=?,kind=?,revision=?,updated_by=?,updated_at=? WHERE id=?', [name, kind, revision, userId, now, id])
      } else {
        id = randomUUID();
        await this.run('INSERT INTO team_assets VALUES(?,?,?,?,?,?,?)', [id, teamId, name, kind, revision, userId, now])
      }
      await this.run('INSERT INTO team_asset_versions VALUES(?,?,?,?,?)', [id, revision, content, userId, now]);
      await this.event(teamId, userId, revision === 1 ? 'asset.created' : 'asset.revised', id);
      return {
        id,
        name,
        kind,
        revision
      }
    })
  }
  history(teamId, userId) {
    return this.transaction(async () => {
      await this.member(teamId, userId);
      return this.all('SELECT * FROM team_events WHERE team_id=? ORDER BY created_at DESC LIMIT 100', [teamId])
    })
  }
}
