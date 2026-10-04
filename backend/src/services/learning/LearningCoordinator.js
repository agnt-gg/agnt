import sqlite3 from 'sqlite3';
import { randomUUID } from 'node:crypto';
import { canonicalCandidate, hash, learningError, validateEvent, scoreTrial, WORK_STATES } from './learningContract.js';

const parse = row => row ? { ...row,
  ...(row.candidate_json ? { candidate: JSON.parse(row.candidate_json) } : {}),
  ...(row.baseline_json ? { baseline: JSON.parse(row.baseline_json) } : {}),
  ...(row.result_json ? { result: JSON.parse(row.result_json) } : {}) } : null;

/** Dedicated connection owns every learning transaction; no unrelated writer can join one. */
export class LearningCoordinator {
  constructor(connection, { clock = () => Date.now() } = {}) { this.db = connection; this.clock = clock; this.queue = Promise.resolve(); }
  run(sql, args = []) { return new Promise((resolve, reject) => this.db.run(sql, args, function(error) { error ? reject(error) : resolve(this.changes); })); }
  get(sql, args = []) { return new Promise((resolve, reject) => this.db.get(sql, args, (error, row) => error ? reject(error) : resolve(row))); }
  all(sql, args = []) { return new Promise((resolve, reject) => this.db.all(sql, args, (error, rows) => error ? reject(error) : resolve(rows))); }
  transaction(fn) {
    const operation = this.queue.then(async () => {
      await this.run('BEGIN IMMEDIATE');
      try { const result = await fn(); await this.run('COMMIT'); return result; }
      catch (error) { await this.run('ROLLBACK'); throw error; }
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
  assertUser(userId) { if (typeof userId !== 'string' || !userId || userId.length > 200) throw learningError('account_required', 401); }
  async owned(table, id, userId) {
    if (!['learning_work','learning_findings','learning_trials','learning_policies'].includes(table)) throw learningError('invalid_table');
    const row = await this.get(`SELECT * FROM ${table} WHERE id=? AND user_id=?`, [id,userId]);
    if (!row) throw learningError('not_found', 404);
    return parse(row);
  }
  async work(userId, sourceType, sourceId, state = 'running') {
    return this.transaction(()=>this.registerWork(userId,sourceType,sourceId,state));
  }
  async registerWork(userId, sourceType, sourceId, state = 'running') {
    this.assertUser(userId);
    if (!['agent','workflow','goal','task','trial'].includes(sourceType) || typeof sourceId !== 'string' || !sourceId || sourceId.length > 200 || !WORK_STATES.includes(state)) throw learningError('invalid_work');
    const now = this.clock();
    await this.run(`INSERT OR IGNORE INTO learning_work(id,user_id,source_type,source_id,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?)`, [randomUUID(),userId,sourceType,sourceId,state,now,now]);
    return this.get('SELECT * FROM learning_work WHERE user_id=? AND source_type=? AND source_id=?', [userId,sourceType,sourceId]);
  }
  async append(userId, workId, input) {
    this.assertUser(userId);
    const event = validateEvent(input);
    return this.transaction(async () => {
      await this.owned('learning_work',workId,userId);
      if (!event.trialId && (await this.get('SELECT paused FROM learning_settings WHERE user_id=?',[userId]))?.paused) return {inserted:false,paused:true};
      if (event.trialId) {
        const trial = await this.owned('learning_trials',event.trialId,userId);
        if (event.type==='policy_exposure' && (!['watching','active'].includes(trial.state) || trial.review_due_at <= this.clock() && trial.state === 'watching')) throw learningError('trial_not_exposable',409);
        if (event.type==='tool_outcome' && (event.occurredAt<trial.started_at || event.occurredAt>=trial.review_due_at&&trial.state!=='active')) throw learningError('trial_outcome_outside_window',409);
        if (event.type==='policy_exposure'&&event.payload.candidateHash!==trial.candidate_hash)throw learningError('exposure_hash_mismatch',409);
        if (trial.candidate.when.capability !== event.capability) throw learningError('trial_scope_mismatch',409);
      }
      const changed = await this.run(`INSERT OR IGNORE INTO learning_events(id,user_id,work_id,event_key,type,capability,outcome,error_kind,trial_id,occurred_at,recorded_at,payload_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
        [randomUUID(),userId,workId,event.eventKey,event.type,event.capability||null,event.outcome||null,event.errorKind||null,event.trialId||null,event.occurredAt,this.clock(),JSON.stringify(event.payload)]);
      if (changed && ['tool_attempt','tool_outcome'].includes(event.type) && ['failed','blocked'].includes(event.outcome)) {
        const signature = hash([event.capability,event.errorKind]);
        await this.run(`INSERT INTO learning_findings(id,user_id,signature,capability,error_kind,first_seen_at,last_seen_at) VALUES(?,?,?,?,?,?,?)
          ON CONFLICT(user_id,signature) DO UPDATE SET last_seen_at=MAX(last_seen_at,excluded.last_seen_at),revision=revision+1`,
          [randomUUID(),userId,signature,event.capability,event.errorKind||'other',event.occurredAt,event.occurredAt]);
      }
      return { inserted: Boolean(changed) };
    });
  }
  async finishWork(userId, workId, state) {
    if (!WORK_STATES.includes(state)) throw learningError('invalid_work_state');
    return this.transaction(async () => {
      const row = await this.owned('learning_work',workId,userId);
      if (!['received','running'].includes(row.state)) return row;
      await this.run('UPDATE learning_work SET state=?,revision=revision+1,updated_at=? WHERE id=? AND user_id=?',[state,this.clock(),workId,userId]);
      await this.run(`INSERT OR IGNORE INTO learning_events(id,user_id,work_id,event_key,type,outcome,occurred_at,recorded_at,payload_json) VALUES(?,?,?,?,'work_state',?,?,?,'{}')`,[randomUUID(),userId,workId,`work:${workId}:${state}`,state,this.clock(),this.clock()]);
      return this.owned('learning_work',workId,userId);
    });
  }
  async cohort(userId, capability, start, end, trialId = null) {
    const condition = trialId ? 'AND trial_id=?' : 'AND trial_id IS NULL';
    return this.get(`SELECT COUNT(*) AS eligible,
      COALESCE(SUM(outcome IN ('failed','blocked')),0) AS failed,
      COALESCE(SUM(outcome='unknown'),0) AS unknown,
      COUNT(DISTINCT work_id) AS independent_runs
      FROM learning_events WHERE user_id=? AND capability=? AND type='tool_outcome' AND occurred_at>=? AND occurred_at<? ${condition}`,
      [userId,capability,start,end,...(trialId?[trialId]:[])]);
  }
  async findings(userId) {
    return this.all(`SELECT f.*,COUNT(e.id) AS occurrences,COUNT(DISTINCT e.work_id) AS independent_runs
      FROM learning_findings f LEFT JOIN learning_events e ON e.user_id=f.user_id AND e.capability=f.capability AND e.error_kind=f.error_kind
      AND e.type IN ('tool_attempt','tool_outcome') AND e.outcome IN ('failed','blocked')
      WHERE f.user_id=? GROUP BY f.id ORDER BY f.last_seen_at DESC LIMIT 100`,[userId]);
  }
  async summary(userId) {
    this.assertUser(userId);
    await this.queue;
    const findings = await this.findings(userId);
    const trials = (await this.all('SELECT * FROM learning_trials WHERE user_id=? ORDER BY started_at DESC LIMIT 100',[userId])).map(parse);
    for(const trial of trials.filter(row=>row.state==='watching')) trial.observed=await this.cohort(userId,trial.candidate.when.capability,trial.started_at,Math.min(this.clock(),trial.review_due_at),trial.id);
    const policies = (await this.all('SELECT * FROM learning_policies WHERE user_id=? ORDER BY activated_at DESC LIMIT 100',[userId])).map(parse);
    const settings = await this.get('SELECT * FROM learning_settings WHERE user_id=?',[userId]);
    const visible = findings.map(finding => {
      let candidate = null;
      if (finding.occurrences >= 3 && finding.independent_runs >= 2 && finding.state === 'detected') {
        try { candidate = canonicalCandidate(finding.capability,finding.error_kind); } catch { /* unsupported: visible as a finding, never an executable proposal */ }
      }
      return { ...finding, candidate, candidate_hash: candidate ? hash(candidate) : null };
    });
    return { schema_version: 1, settings: { paused: Boolean(settings?.paused), revision: settings?.revision||0 }, findings: visible, trials, policies,
      counts: { needsAttention: visible.filter(x=>x.state==='detected'&&x.occurrences>=3&&x.independent_runs>=2).length+trials.filter(x=>x.state==='reviewed').length,
        watching: trials.filter(x=>x.state==='watching').length, learned: policies.filter(x=>x.state==='active').length },
      coverage: await this.get('SELECT COUNT(*) AS events,COUNT(DISTINCT work_id) AS work FROM learning_events WHERE user_id=?',[userId]) };
  }
  async setPaused(userId, paused) {
    this.assertUser(userId); if (typeof paused !== 'boolean') throw learningError('invalid_pause');
    await this.transaction(()=>this.run(`INSERT INTO learning_settings(user_id,paused) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET paused=excluded.paused,revision=revision+1`,[userId,Number(paused)]));
    return { paused };
  }
  async approve(userId, findingId, input) {
    if (!input || Object.keys(input).some(key=>!['revision','candidateHash','durationDays','minimumSamples'].includes(key))) throw learningError('invalid_trial');
    const { revision, candidateHash, durationDays = 7, minimumSamples = 20 } = input;
    if (!Number.isSafeInteger(revision) || !Number.isInteger(durationDays) || durationDays < 1 || durationDays > 30 || !Number.isInteger(minimumSamples) || minimumSamples < 10 || minimumSamples > 1000) throw learningError('invalid_trial');
    return this.transaction(async () => {
      if ((await this.get('SELECT paused FROM learning_settings WHERE user_id=?',[userId]))?.paused) throw learningError('learning_paused',409);
      const finding = await this.owned('learning_findings',findingId,userId);
      if (finding.revision !== revision || finding.state !== 'detected') throw learningError('stale_finding',409);
      const evidence = await this.get(`SELECT COUNT(*) AS n,COUNT(DISTINCT work_id) AS runs FROM learning_events WHERE user_id=? AND capability=? AND error_kind=? AND type='tool_outcome' AND outcome='failed'`,[userId,finding.capability,finding.error_kind]);
      if (evidence.n < 3 || evidence.runs < 2) throw learningError('insufficient_recurrence',409);
      const candidate = canonicalCandidate(finding.capability,finding.error_kind);
      if (hash(candidate) !== candidateHash) throw learningError('candidate_changed',409);
      const now = this.clock(), baseline = await this.cohort(userId,finding.capability,now-7*86400000,now);
      baseline.window_start=now-7*86400000;baseline.window_end=now;
      if (baseline.eligible < minimumSamples || baseline.unknown > 0) throw learningError('insufficient_baseline',409);
      if (await this.get(`SELECT id FROM learning_trials WHERE user_id=? AND state IN ('watching','active') AND json_extract(candidate_json,'$.when.capability')=?`,[userId,finding.capability])) throw learningError('overlapping_trial',409);
      const id = randomUUID();
      await this.run(`INSERT INTO learning_trials(id,user_id,finding_id,candidate_json,candidate_hash,state,baseline_json,started_at,review_due_at,minimum_samples,approved_at) VALUES(?,?,?,?,?,'watching',?,?,?,?,?)`,[id,userId,findingId,JSON.stringify(candidate),candidateHash,JSON.stringify(baseline),now,now+durationDays*86400000,minimumSamples,now]);
      await this.run("UPDATE learning_findings SET state='watching',revision=revision+1 WHERE id=? AND user_id=?",[findingId,userId]);
      await this.recordTransition(userId,id,'candidate','watching','owner_approved_hash');
      return this.owned('learning_trials',id,userId);
    });
  }
  async dismiss(userId, id, revision) {
    return this.transaction(async()=>{
      const row=await this.owned('learning_findings',id,userId);
      if (row.revision!==revision||row.state!=='detected') throw learningError('stale_finding',409);
      await this.run("UPDATE learning_findings SET state='dismissed',revision=revision+1 WHERE id=? AND user_id=?",[id,userId]);
      return {state:'dismissed'};
    });
  }
  async policyFor(userId, capability) {
    await this.queue;
    if ((await this.get('SELECT paused FROM learning_settings WHERE user_id=?',[userId]))?.paused) return null;
    const row = await this.get(`SELECT * FROM learning_trials WHERE user_id=? AND state IN ('watching','active') AND json_extract(candidate_json,'$.when.capability')=?
      AND (state='active' OR review_due_at>?) ORDER BY started_at DESC LIMIT 1`,[userId,capability,this.clock()]);
    return parse(row);
  }
  async recordTransition(userId, trialId, from, to, reason) {
    const work = await this.registerWork(userId,'trial',trialId);
    await this.run(`INSERT INTO learning_events(id,user_id,work_id,event_key,type,occurred_at,recorded_at,payload_json) VALUES(?,?,?,?,'trial_state',?,?,?)`,[randomUUID(),userId,work.id,`state:${trialId}:${to}:${randomUUID()}`,this.clock(),this.clock(),JSON.stringify({from,to,reason})]);
  }
  async reviewDue(limit = 50) {
    const due = await this.all("SELECT id,user_id FROM learning_trials WHERE state='watching' AND review_due_at<=? ORDER BY review_due_at LIMIT ?",[this.clock(),limit]);
    let reviewed=0;
    for (const row of due) {try{await this.review(row.user_id,row.id);reviewed++;}catch(error){if(error.code!=='review_not_due')throw error;}}
    const active=await this.all("SELECT id,user_id FROM learning_trials WHERE state='active' ORDER BY started_at LIMIT ?",[limit]);
    for(const row of active) await this.monitorActive(row.user_id,row.id);
    return { reviewed };
  }
  async monitorActive(userId,id) {
    return this.transaction(async()=>{
      const trial=await this.owned('learning_trials',id,userId);if(trial.state!=='active')return;
      const policy=await this.get("SELECT * FROM learning_policies WHERE user_id=? AND trial_id=? AND state='active'",[userId,id]);if(!policy)return;
      const observed=await this.cohort(userId,trial.candidate.when.capability,Math.max(policy.activated_at,this.clock()-7*86400000),this.clock(),id);
      const result=scoreTrial(trial.baseline,observed,trial.minimum_samples);
      if(result.verdict==='regressed'){
        await this.run("UPDATE learning_policies SET state='reverted',version=version+1 WHERE user_id=? AND trial_id=?",[userId,id]);
        await this.run("UPDATE learning_trials SET state='reverted',revision=revision+1,ended_at=?,result_json=? WHERE user_id=? AND id=?",[this.clock(),JSON.stringify(result),userId,id]);
        await this.run("UPDATE learning_findings SET state='reverted',revision=revision+1 WHERE user_id=? AND id=?",[userId,trial.finding_id]);
        await this.recordTransition(userId,id,'active','reverted','measured_regression');
      }
    });
  }
  async review(userId,id) {
    return this.transaction(async()=>{
      const trial=await this.owned('learning_trials',id,userId);
      if(trial.state!=='watching'||trial.review_due_at>this.clock()) throw learningError('review_not_due',409);
      const candidate=await this.cohort(userId,trial.candidate.when.capability,trial.started_at,trial.review_due_at,id);
      const missing = await this.get(`SELECT COUNT(*) AS n FROM learning_events e WHERE e.user_id=? AND e.trial_id=? AND e.type='policy_exposure' AND NOT EXISTS (SELECT 1 FROM learning_events o WHERE o.user_id=e.user_id AND o.work_id=e.work_id AND o.trial_id=e.trial_id AND o.type='tool_outcome' AND o.event_key=replace(e.event_key,'exposure:','call:'))`,[userId,id]);
      candidate.incomplete_exposures=missing.n;
      const result=scoreTrial(trial.baseline,candidate,trial.minimum_samples);
      // All provisional effects end at the deadline. Keeping a supported change is a separate owner decision.
      await this.run("UPDATE learning_trials SET state='reviewed',result_json=?,revision=revision+1,ended_at=? WHERE id=? AND user_id=?",[JSON.stringify(result),this.clock(),id,userId]);
      await this.run("UPDATE learning_findings SET state='reviewed',revision=revision+1 WHERE id=? AND user_id=?",[trial.finding_id,userId]);
      await this.recordTransition(userId,id,'watching','reviewed',result.verdict);
      return {...trial,state:'reviewed',result};
    });
  }
  async keep(userId,id,revision,candidateHash) {
    return this.transaction(async()=>{
      if((await this.get('SELECT paused FROM learning_settings WHERE user_id=?',[userId]))?.paused)throw learningError('learning_paused',409);
      const trial=await this.owned('learning_trials',id,userId);
      if(trial.revision!==revision||trial.candidate_hash!==candidateHash) throw learningError('stale_trial',409);
      if(trial.state!=='reviewed'||trial.result?.verdict!=='supported') throw learningError('promotion_not_supported',409);
      const policyId=randomUUID();
      await this.run(`INSERT INTO learning_policies(id,user_id,trial_id,capability,error_kind,state,candidate_json,candidate_hash,activated_at) VALUES(?,?,?,?,?,'active',?,?,?)`,[policyId,userId,id,trial.candidate.when.capability,trial.candidate.when.error_kind,trial.candidate_json,trial.candidate_hash,this.clock()]);
      await this.run("UPDATE learning_trials SET state='active',revision=revision+1 WHERE id=? AND user_id=?",[id,userId]);
      await this.run("UPDATE learning_findings SET state='active',revision=revision+1 WHERE id=? AND user_id=?",[trial.finding_id,userId]);
      await this.recordTransition(userId,id,'reviewed','active','owner_kept_supported_trial');
      return this.owned('learning_policies',policyId,userId);
    });
  }
  async undo(userId,id,revision) {
    return this.transaction(async()=>{
      const trial=await this.owned('learning_trials',id,userId);
      if(trial.revision!==revision||!['watching','active','reviewed'].includes(trial.state))throw learningError('stale_trial',409);
      await this.run("UPDATE learning_policies SET state='reverted',version=version+1 WHERE trial_id=? AND user_id=?",[id,userId]);
      await this.run("UPDATE learning_trials SET state='reverted',revision=revision+1,ended_at=? WHERE id=? AND user_id=?",[this.clock(),id,userId]);
      await this.run("UPDATE learning_findings SET state='reverted',revision=revision+1 WHERE id=? AND user_id=?",[trial.finding_id,userId]);
      await this.recordTransition(userId,id,trial.state,'reverted','runtime_policy_deactivated');
      const remaining=await this.get("SELECT COUNT(*) AS n FROM learning_policies WHERE trial_id=? AND user_id=? AND state='active'",[id,userId]);
      if(remaining.n)throw learningError('restore_not_verified',500);
      return {state:'reverted',restored:true};
    });
  }
}

let singleton;
export async function getLearningCoordinator() {
  if (!singleton) singleton = (async()=>{
    const {default:db,dbReady}=await import('../../models/database/index.js'); await dbReady;
    const connection=await new Promise((resolve,reject)=>{const c=new sqlite3.Database(db.filename,error=>error?reject(error):resolve(c));});
    connection.configure('busyTimeout',3000);
    return new LearningCoordinator(connection);
  })();
  return singleton;
}
