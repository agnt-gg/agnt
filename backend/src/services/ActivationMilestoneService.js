import crypto from 'node:crypto';

const ENDPOINT = 'https://agnt.gg/api/analytics/funnel/app';
const inFlight = new Map();
const run = (db, sql, parameters = []) => new Promise((resolve, reject) => db.run(sql, parameters, function(error) { if (error) reject(error); else resolve(this.changes); }));
const get = (db, sql, parameters = []) => new Promise((resolve, reject) => db.get(sql, parameters, (error, row) => error ? reject(error) : resolve(row)));

/** Only persisted, completed root executions establish activation; no prompts or outputs leave the device. */
export async function collectActivationMilestones(db, userId) {
  const agent = await get(db, `SELECT id, end_time FROM agent_executions WHERE user_id=? AND status='completed'
    AND (error IS NULL OR error='') AND parent_execution_id IS NULL AND origin NOT IN ('test','fixture')
    AND julianday(end_time) IS NOT NULL AND julianday(end_time)>=julianday(start_time)
    ORDER BY julianday(end_time),id LIMIT 1`, [userId]);
  const workflow = await get(db, `SELECT id, end_time FROM workflow_executions WHERE user_id=? AND status='completed'
    AND julianday(end_time) IS NOT NULL AND julianday(end_time)>=julianday(start_time)
    ORDER BY julianday(end_time),id LIMIT 1`, [userId]);
  const candidates = [];
  if (agent) candidates.push({ name: 'first_agent_completed', ...agent });
  if (workflow) candidates.push({ name: 'first_workflow_completed', ...workflow });
  candidates.sort((a,b) => Date.parse(a.end_time)-Date.parse(b.end_time));
  if (candidates.length) candidates.push({ ...candidates[0], name: 'first_run_completed' });
  return candidates.map(row => ({ name: row.name, occurred_at: new Date(row.end_time).toISOString(), execution_id: row.id }));
}

async function deliver({ db, userId, token, appVersion, fetchImpl, enabled, now }) {
  if (!enabled || process.env.AGNT_DISABLE_TELEMETRY === '1') return { enabled: false, sent: 0 };
  await run(db, `CREATE TABLE IF NOT EXISTS activation_milestone_outbox (
    user_id TEXT NOT NULL, event_name TEXT NOT NULL, execution_id TEXT NOT NULL,
    occurred_at TEXT NOT NULL, acknowledged_at TEXT, attempted_at TEXT, PRIMARY KEY(user_id,event_name))`);
  const milestones = await collectActivationMilestones(db, userId);
  let sent = 0;
  for (const milestone of milestones) {
    await run(db, `INSERT OR IGNORE INTO activation_milestone_outbox(user_id,event_name,execution_id,occurred_at) VALUES(?,?,?,?)`, [userId,milestone.name,milestone.execution_id,milestone.occurred_at]);
    const row = await get(db, 'SELECT * FROM activation_milestone_outbox WHERE user_id=? AND event_name=?', [userId,milestone.name]);
    if (row.acknowledged_at || row.attempted_at && now()-Date.parse(row.attempted_at)<60000) continue;
    await run(db, 'UPDATE activation_milestone_outbox SET attempted_at=? WHERE user_id=? AND event_name=?', [new Date(now()).toISOString(),userId,milestone.name]);
    const eventId = crypto.createHash('sha256').update(`${userId}:${milestone.name}`).digest('hex');
    const response = await fetchImpl(ENDPOINT, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type':'application/json' },
      body: JSON.stringify({ event: milestone.name, occurred_at: row.occurred_at,
        meta: { execution_id: row.execution_id, app_version: appVersion, source_event_id: eventId } }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`Activation delivery returned HTTP ${response.status}`);
    const receipt = await response.json();
    if (receipt.success !== true) throw new Error('Activation delivery was not acknowledged');
    await run(db, 'UPDATE activation_milestone_outbox SET acknowledged_at=? WHERE user_id=? AND event_name=?', [new Date(now()).toISOString(),userId,milestone.name]);
    sent++;
  }
  return { enabled:true, sent };
}
export async function syncActivationMilestones(options) {
  if (!options.userId || !options.token) throw new Error('Authenticated identity required');
  if (inFlight.has(options.userId)) return inFlight.get(options.userId);
  const promise = deliver({ fetchImpl: fetch, now: Date.now, ...options });
  inFlight.set(options.userId, promise);
  try { return await promise; } finally { inFlight.delete(options.userId); }
}
