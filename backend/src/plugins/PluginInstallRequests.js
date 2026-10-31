import { randomUUID } from 'node:crypto';
import { DEFAULT_FEATURES, PLUGIN_FEATURES, pluginFeatureGrant } from './pluginFeaturePolicy.js';
import db, { dbReady } from '../models/database/index.js';

/**
 * PLUGIN INSTALL REQUESTS AND POLICY, for a shared instance.
 *
 * A member who may not add a plugin themselves asks for it instead; the owner
 * (or an admin, when the owner allows it) approves or declines from Home.
 * The owner's policy widens what members may add on their own:
 *   pre_approved        plugin names any member may add
 *   admins_can_approve  admins decide requests too, not only the owner
 *   members_all_official any official, byte-verified plugin, whatever it reaches
 * Every default is the strict one. Instance-local: this instance's database.
 */
export const POLICY_DEFAULTS = Object.freeze({ preApproved: [], blockedPlugins: [], allowedFeatures: DEFAULT_FEATURES, adminsCanApprove: false, membersAllOfficial: false });
const NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,120}$/;
const fail = (status, message, code) => { throw Object.assign(new Error(message), { status, ...(code ? { code } : {}) }); };

/** What the owner sees on the card: only what the server itself found, never the listing's claims. */
export function reportSummary(report = {}) {
  return {
    trustTier: report.trustTier || 'unaudited',
    integrityState: report.integrityState || 'none',
    valid: !!report.valid,
    version: report.version || null,
    reaches: Object.keys(report.detected || {}),
    declared: Array.isArray(report.declared) ? report.declared.slice(0, 20) : [],
  };
}

/**
 * May this member add the plugin without asking? From the server's own
 * inspection and the owner's policy. Returns 'member-safe' | 'pre-approved' |
 * 'all-official' when allowed, or null when it must be requested.
 * `memberSafe` is memberInstallRefusal(report) === null.
 */
export function memberInstallGrant(name, report, policy, memberSafe) {
  const grant = pluginFeatureGrant(name, report, policy);
  return grant === 'features' && memberSafe ? 'member-safe' : grant;
}

function requestRow(r) {
  return {
    id: r.id, pluginName: r.plugin_name, requesterId: r.requester_id, status: r.status,
    report: JSON.parse(r.report_json || '{}'), decidedBy: r.decided_by || null, decidedAt: r.decided_at || null,
    error: r.error || null, createdAt: r.created_at, seen: !!r.seen_at,
  };
}

export class PluginInstallRequests {
  constructor(database, databaseReady = Promise.resolve()) { this.db = database; this.databaseReady = databaseReady; this.initializing = null; }
  run(sql, p = []) { return new Promise((res, rej) => this.db.run(sql, p, function (e) { e ? rej(e) : res(this.changes); })); }
  get(sql, p = []) { return new Promise((res, rej) => this.db.get(sql, p, (e, r) => (e ? rej(e) : res(r)))); }
  all(sql, p = []) { return new Promise((res, rej) => this.db.all(sql, p, (e, r) => (e ? rej(e) : res(r || [])))); }
  ready() {
    if (!this.initializing) this.initializing = (async () => {
      await (typeof this.databaseReady === 'function' ? this.databaseReady() : this.databaseReady);
      await this.run(`CREATE TABLE IF NOT EXISTS plugin_install_requests(id TEXT PRIMARY KEY, plugin_name TEXT NOT NULL, requester_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending','approved','declined','failed')), report_json TEXT NOT NULL DEFAULT '{}',
        decided_by TEXT, decided_at TEXT, error TEXT, seen_at TEXT, created_at TEXT NOT NULL)`);
      await this.run('CREATE INDEX IF NOT EXISTS plugin_install_requests_status ON plugin_install_requests(status, created_at)');
      await this.run('CREATE TABLE IF NOT EXISTS plugin_install_policy(key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    })().catch((error) => { this.initializing = null; throw error; });
    return this.initializing;
  }

  async policy() {
    await this.ready();
    const rows = await this.all('SELECT key, value FROM plugin_install_policy');
    const stored = Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value)]));
    return {
      preApproved: Array.isArray(stored.preApproved) ? stored.preApproved.filter((n) => NAME.test(n)) : [],
      blockedPlugins: Array.isArray(stored.blockedPlugins) ? stored.blockedPlugins.filter((n) => NAME.test(n)) : [],
      allowedFeatures: Array.isArray(stored.allowedFeatures) ? stored.allowedFeatures.filter((id) => PLUGIN_FEATURES.some((f) => f.id === id)) : [...DEFAULT_FEATURES],
      adminsCanApprove: stored.adminsCanApprove === true,
      membersAllOfficial: stored.membersAllOfficial === true,
    };
  }
  /** Partial update; unknown keys and malformed values are refused, never stored. */
  async setPolicy(input = {}) {
    await this.ready();
    const next = {};
    for (const key of Object.keys(input)) if (!Object.hasOwn(POLICY_DEFAULTS, key)) fail(400, `Unknown plugin policy field: ${key}`);
    for (const key of ['preApproved', 'blockedPlugins']) {
      if (input[key] !== undefined) {
        if (!Array.isArray(input[key]) || input[key].length > 500 || input[key].some((n) => typeof n !== 'string' || !NAME.test(n))) fail(400, `${key} must be a list of plugin names`);
        next[key] = [...new Set(input[key])].sort();
      }
    }
    if (input.allowedFeatures !== undefined) {
      if (!Array.isArray(input.allowedFeatures) || input.allowedFeatures.length > PLUGIN_FEATURES.length || input.allowedFeatures.some((id) => !PLUGIN_FEATURES.some((f) => f.id === id))) fail(400, 'allowedFeatures must contain known feature IDs');
      next.allowedFeatures = [...new Set(input.allowedFeatures)].sort();
    }
    for (const key of ['adminsCanApprove', 'membersAllOfficial']) {
      if (input[key] !== undefined) { if (typeof input[key] !== 'boolean') fail(400, `${key} must be true or false`); next[key] = input[key]; }
    }
    for (const [key, value] of Object.entries(next)) await this.run('INSERT INTO plugin_install_policy(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [key, JSON.stringify(value)]);
    return this.policy();
  }

  /** One open request per person per plugin: asking twice returns the same request. */
  async request(pluginName, requesterId, report) {
    await this.ready();
    if (!NAME.test(pluginName) || !requesterId) fail(400, 'Invalid request');
    const open = await this.get("SELECT * FROM plugin_install_requests WHERE plugin_name=? AND requester_id=? AND status='pending'", [pluginName, requesterId]);
    if (open) return { request: requestRow(open), created: false };
    const id = randomUUID();
    await this.run("INSERT INTO plugin_install_requests(id,plugin_name,requester_id,status,report_json,created_at) VALUES(?,?,?,'pending',?,?)",
      [id, pluginName, requesterId, JSON.stringify(reportSummary(report)), new Date().toISOString()]);
    return { request: requestRow(await this.get('SELECT * FROM plugin_install_requests WHERE id=?', [id])), created: true };
  }
  async find(id) { await this.ready(); const r = await this.get('SELECT * FROM plugin_install_requests WHERE id=?', [id]); return r ? requestRow(r) : null; }
  async pending() { await this.ready(); return (await this.all("SELECT * FROM plugin_install_requests WHERE status='pending' ORDER BY created_at DESC LIMIT 200")).map(requestRow); }
  /** A person's own requests: open ones, and decided ones they have not dismissed yet. */
  async mine(requesterId) {
    await this.ready();
    return (await this.all("SELECT * FROM plugin_install_requests WHERE requester_id=? AND (status='pending' OR seen_at IS NULL) ORDER BY created_at DESC LIMIT 50", [requesterId])).map(requestRow);
  }
  async pendingFor(pluginName) { await this.ready(); return (await this.all("SELECT * FROM plugin_install_requests WHERE plugin_name=? AND status='pending'", [pluginName])).map(requestRow); }
  /** Decide one open request; a decided request cannot be decided again (409). */
  async decide(id, status, deciderId, error = null) {
    await this.ready();
    if (!['approved', 'declined', 'failed'].includes(status)) fail(400, 'Invalid decision');
    const changed = await this.run("UPDATE plugin_install_requests SET status=?, decided_by=?, decided_at=?, error=? WHERE id=? AND status='pending'", [status, deciderId, new Date().toISOString(), error, id]);
    if (!changed) fail(409, 'This request was already decided', 'already_decided');
    return this.find(id);
  }
  async markSeen(id, requesterId) {
    await this.ready();
    await this.run("UPDATE plugin_install_requests SET seen_at=? WHERE id=? AND requester_id=? AND status<>'pending'", [new Date().toISOString(), id, requesterId]);
  }
}

export default new PluginInstallRequests(db, () => dbReady);
