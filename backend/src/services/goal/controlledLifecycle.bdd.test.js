/** Contract regressions: original six baseline failures now pass with lifecycle fencing.
 * Actual evaluator/completion/update services and SQLite models are exercised.
 * Model responses and unrelated side services are mocked; no provider traffic.
 * Every race waits at a named barrier, commits its competing SQL write, then
 * releases. No sleeps, retries, expected-failure annotations, or live DB imports.
 */
import { beforeAll, beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import sqlite3 from 'sqlite3';

const probe = vi.hoisted(() => ({
  call: vi.fn(), events: [], insights: [],
  broadcast: vi.fn(), insight: vi.fn(),
}));
vi.mock('../ai/LlmService.js', () => ({ createLlmClient: vi.fn(async () => ({})) }));
vi.mock('../orchestrator/llmAdapters.js', () => ({ createLlmAdapter: vi.fn(async () => ({ call: probe.call })) }));
vi.mock('../ai/LlmExecutionService.js', () => ({ default: { executeWithTools: vi.fn(() => { throw new Error('Unexpected task execution'); }) } }));
vi.mock('../orchestrator/agentRuntime.js', () => ({ buildAgentRuntime: vi.fn(() => { throw new Error('Unexpected worker initialization'); }) }));
vi.mock('./AgentTaskMatcher.js', () => ({ default: {} }));
vi.mock('./GoalProcessor.js', () => ({ default: {} }));
vi.mock('./SkillForgeOrchestrator.js', () => ({ default: {} }));
vi.mock('../AutonomousMessageService.js', () => ({ default: {} }));
vi.mock('../evolution/InsightTriggers.js', () => ({ default: { onGoalCompleted: probe.insight } }));
vi.mock('../../utils/realtimeSync.js', () => ({
  broadcastToUser: probe.broadcast,
  RealtimeEvents: new Proxy({}, { get: (_, key) => String(key) }),
}));
vi.mock('../unfirehose/UnfirehoseLogger.js', () => ({ isEnabled: () => false, createSession: vi.fn() }));

let db, other, Goal, Task, Evaluator, Orchestrator, updateTaskRecord;
const run = (handle, sql, args = []) => new Promise((resolve, reject) => handle.run(sql, args, function(error) { error ? reject(error) : resolve(this.changes); }));
const all = (handle, sql, args = []) => new Promise((resolve, reject) => handle.all(sql, args, (error, rows) => error ? reject(error) : resolve(rows)));
let pending, releases, observations, journal, reportDir;

function barrier(label) {
  let enter, release;
  const entered = new Promise(resolve => { enter = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  releases.push(release);
  return {
    entered, release,
    async hold() { journal.push(label + ':entered'); enter(); await gate; journal.push(label + ':released'); },
  };
}
function tracked(promise) {
  const outcome = promise.then(value => ({ ok: true, value }), error => ({ ok: false, error: { message: error.message, code: error.code, writeState: error.writeState, retryable: error.retryable } }));
  pending.push(outcome);
  return outcome;
}
async function reached(bar, work) {
  // If the code finishes before reaching its barrier, fail rather than hang.
  const result = await Promise.race([bar.entered.then(() => 'entered'), work.then(() => 'finished')]);
  expect(result, 'operation must reach the controlled barrier').toBe('entered');
}
function grader(bar = null, fail = false) {
  probe.call.mockImplementation(async () => {
    const index = probe.call.mock.calls.length;
    if (index === 1 && bar) await bar.hold();
    if (index === 1 && fail) throw new Error('Synthetic evaluator outage');
    return { responseMessage: { content: index === 1
      ? JSON.stringify({ score: 95, criteriaMet: { deliverable: true }, feedback: 'Fixture evidence accepted.' })
      : 'Fixture overall feedback.' }, usage: null };
  });
}
async function seed() {
  const userId = 'lifecycle-user-' + crypto.randomUUID();
  await run(db, 'INSERT INTO users(id) VALUES (?)', [userId]);
  const goalId = await Goal.create('Controlled lifecycle', 'Synthetic exact output obligation', userId, 'low', { deliverables: ['Preserve current evidence'] });
  const taskId = await Task.create(goalId, 'Fixture', 'Synthetic task', []);
  await Task.updateStatus(taskId, 'completed', 100, null, null, null, { content: 'Evidence v1', evidenceRevision: 'v1' });
  await Goal.updateStatus(goalId, 'executing');
  const entry = { userId, provider: 'openai', model: 'test-model', abortController: new AbortController(), testGeneration: 'A' };
  Orchestrator.runningGoals.set(goalId, entry);
  observations.push({ goalId, taskId, userId });
  return { goalId, taskId, userId, entry };
}
async function snapshot(row) {
  const [goal, tasks, evaluations, taskEvaluations] = await Promise.all([
    Goal.findOne(row.goalId), Task.findByGoalId(row.goalId),
    all(db, 'SELECT id, passed, evaluation_data FROM goal_evaluations WHERE goal_id=?', [row.goalId]),
    all(db, 'SELECT task_id, score, criteria_met FROM task_evaluations WHERE task_id=?', [row.taskId]),
  ]);
  return { goal: { id: goal.id, status: goal.status, currentIteration: goal.current_iteration },
    tasks: tasks.map(t => ({ id: t.id, status: t.status, progress: t.progress, output: t.output, error: t.error })),
    evaluations, taskEvaluations,
    runningGeneration: Orchestrator.runningGoals.get(row.goalId)?.testGeneration ?? null };
}
beforeAll(async () => {
  const isolated = process.env.__AGNT_TEST_DATA_DIR;
  if (process.env.AGNT_TEST_USE_REAL_DATA === '1' || !isolated || process.env.USER_DATA_PATH !== isolated) throw new Error('Disposable runner isolation required before imports');
  reportDir = process.env.AGNT_LIFECYCLE_TEST_REPORT_DIR;
  if (reportDir && !path.resolve(reportDir).startsWith('/home/tryinget/agnt/projects/')) throw new Error('Receipt directory must be in workspace');
  if (reportDir) await fs.mkdir(reportDir, { recursive: true });
  const database = await import('../../models/database/index.js');
  db = database.default; await database.dbReady;
  const databases = await all(db, 'PRAGMA database_list');
  const file = path.resolve(databases.find(d => d.name === 'main').file);
  if (!file.startsWith(path.resolve(isolated) + path.sep)) throw new Error('DB escaped disposable directory');
  other = await new Promise((resolve, reject) => { const handle = new sqlite3.Database(file, sqlite3.OPEN_READWRITE, error => error ? reject(error) : resolve(handle)); });
  other.configure('busyTimeout', 2000);
  ({ default: Goal } = await import('../../models/GoalModel.js'));
  ({ default: Task } = await import('../../models/TaskModel.js'));
  ({ default: Evaluator } = await import('./GoalEvaluator.js'));
  ({ default: Orchestrator } = await import('./TaskOrchestrator.js'));
  ({ updateTaskRecord } = await import('./updateTaskRecord.js'));
});
beforeEach(() => {
  vi.clearAllMocks(); probe.events = []; probe.insights = [];
  pending = []; releases = []; observations = []; journal = [];
  probe.broadcast.mockImplementation((userId, event, data) => { probe.events.push({ userId, event, data: structuredClone(data) }); });
  probe.insight.mockImplementation(async goalId => { probe.insights.push(goalId); });
  grader();
});
afterEach(async context => {
  try {
    for (const release of releases) release();
    const outcomes = await Promise.all(pending);
    const records = await Promise.all(observations.map(snapshot));
    if (reportDir) await fs.writeFile(path.join(reportDir, context.task.name.match(/^\w+/)[0] + '.json'), JSON.stringify({
      scenario: context.task.name, journal, records, events: probe.events, insights: probe.insights,
      outcomes, modelBoundaryCalls: probe.call.mock.calls.length,
      isolation: process.env.__AGNT_TEST_DATA_DIR,
      note: 'Observed evidence, not a pass claim; use Vitest assertion results.'
    }, null, 2), { flag: 'wx' });
  } finally {
    vi.restoreAllMocks();
    Orchestrator.runningGoals.clear();
  }
});
// Close ONLY our second handle; the shared runner owns its primary connection.
import { afterAll } from 'vitest';
afterAll(async () => { if (other) await new Promise((resolve, reject) => other.close(e => e ? reject(e) : resolve())); });

describe('controlled goal lifecycle boundaries', () => {
  it('L01 unchanged evidence validates after the grading barrier (positive control)', async () => {
    const row = await seed(), bar = barrier('grade'); grader(bar);
    const work = tracked(Orchestrator.completeGoal(row.goalId)); await reached(bar, work);
    expect((await Goal.findOne(row.goalId)).status).toBe('needs_review');
    expect((await all(db, 'SELECT id FROM goal_evaluations WHERE goal_id=?', [row.goalId])).length).toBe(0);
    bar.release(); expect((await work).ok).toBe(true);
    expect((await Goal.findOne(row.goalId)).status).toBe('validated');
    expect(probe.insights).toEqual([row.goalId]);
    expect(Orchestrator.runningGoals.has(row.goalId)).toBe(false);
  });

  it('L02 a passing grade arriving after pause cannot validate or announce success', async () => {
    const row = await seed(), bar = barrier('grade'); grader(bar);
    const work = tracked(Orchestrator.completeGoal(row.goalId)); await reached(bar, work);
    await Orchestrator.pauseGoal(row.goalId); journal.push('pause:committed');
    expect(row.entry.abortController.signal.aborted).toBe(true);
    expect((await Goal.findOne(row.goalId)).status).toBe('paused');
    bar.release(); await work;
    const after = await snapshot(row);
    expect.soft(after.goal.status).toBe('paused');
    expect.soft(after.evaluations.some(e => e.passed === 1)).toBe(false);
    expect.soft(probe.events.some(e => e.data.status === 'validated')).toBe(false);
    expect.soft(probe.insights).toHaveLength(0);
  });

  it('L03 run A late grade cannot overwrite or remove replacement run B', async () => {
    const row = await seed(), bar = barrier('grade'); grader(bar);
    const work = tracked(Orchestrator.completeGoal(row.goalId)); await reached(bar, work);
    await Orchestrator.pauseGoal(row.goalId);
    // Install B at the actual running-map/model boundary; do not start a second
    // worker or mock the old completion/evaluator methods under examination.
    const replacement = { ...row.entry, abortController: new AbortController(), testGeneration: 'B' };
    Orchestrator.runningGoals.set(row.goalId, replacement);
    await Goal.updateStatus(row.goalId, 'executing'); await Goal.updateIteration(row.goalId, 2);
    journal.push('replacement-B:committed');
    bar.release(); await work;
    expect.soft((await Goal.findOne(row.goalId)).status).toBe('executing');
    expect.soft(Orchestrator.runningGoals.get(row.goalId)).toBe(replacement);
    expect.soft(replacement.abortController.signal.aborted).toBe(false);
    expect.soft(probe.events.some(e => e.data.status === 'validated')).toBe(false);
    expect.soft(probe.insights).toHaveLength(0);
  });

  it('L04 a task correction committed during grading invalidates the old evidence', async () => {
    const row = await seed(), bar = barrier('grade'); grader(bar);
    const work = tracked(Evaluator.evaluateGoal(row.goalId, row.userId, 'automatic', 'openai', 'test-model')); await reached(bar, work);
    const changed = await run(other, 'UPDATE tasks SET status=?, progress=0, output=?, error=? WHERE id=? AND goal_id=?',
      ['failed', JSON.stringify({ content: 'Evidence v2: required output missing' }), 'independent correction', row.taskId, row.goalId]);
    expect(changed).toBe(1); journal.push('evidence-v2:committed');
    bar.release(); const outcome = await work;
    const after = await snapshot(row);
    expect.soft(outcome.ok && outcome.value.passed === true).toBe(false);
    expect.soft(after.goal.status).not.toBe('validated');
    expect.soft(after.tasks[0].status).toBe('failed');
    expect.soft(after.evaluations.some(e => e.passed === 1)).toBe(false);
  });

  it('L05 a late evaluator outage cannot replace a committed pause with needs_review', async () => {
    const row = await seed(), bar = barrier('grade'); grader(bar, true);
    const work = tracked(Orchestrator.completeGoal(row.goalId)); await reached(bar, work);
    await Orchestrator.pauseGoal(row.goalId); journal.push('pause:committed');
    bar.release(); await work;
    expect.soft((await Goal.findOne(row.goalId)).status).toBe('paused');
    expect.soft(probe.insights).toHaveLength(0);
    expect.soft(probe.events.filter(e => e.data.status === 'validated')).toHaveLength(0);
  });

  it('L06 progress-only writer cannot restore the status it read before another writer failed the task', async () => {
    const row = await seed(), bar = barrier('before-update');
    const update = Task.updateStatus.bind(Task);
    vi.spyOn(Task, 'updateStatus').mockImplementationOnce(async (...args) => { await bar.hold(); return update(...args); });
    const work = tracked(updateTaskRecord({goal_id:row.goalId,task_id:row.taskId,progress:25}, row.userId)); await reached(bar, work);
    await run(other, 'UPDATE tasks SET status=?, error=?, progress=0 WHERE id=? AND goal_id=?', ['failed', 'winner error', row.taskId, row.goalId]);
    journal.push('competing-failure:committed'); bar.release(); await work;
    const current = await Task.findOne(row.taskId);
    expect.soft(current.status).toBe('failed');
    expect.soft(current.error).toBe('winner error');
    expect.soft(probe.events.some(e => e.data.status === 'completed')).toBe(false);
  });

  it('L07 two explicit writers from one snapshot cannot both report verified conflicting success', async () => {
    const row = await seed(), a = barrier('writer-A'), b = barrier('writer-B');
    const update = Task.updateStatus.bind(Task);
    vi.spyOn(Task, 'updateStatus')
      .mockImplementationOnce(async (...args) => { await a.hold(); return update(...args); })
      .mockImplementationOnce(async (...args) => { await b.hold(); return update(...args); });
    const first = tracked(updateTaskRecord({goal_id:row.goalId,task_id:row.taskId,status:'completed',output:'A output'}, row.userId));
    await reached(a, first);
    const second = tracked(updateTaskRecord({goal_id:row.goalId,task_id:row.taskId,status:'failed',output:'B correction',error:'B failure'}, row.userId));
    await reached(b, second);
    b.release(); const winner = await second; expect(winner.ok).toBe(true);
    journal.push('writer-B:committed-and-read-back'); a.release(); const stale = await first;
    const current = await Task.findOne(row.taskId);
    expect.soft(stale.ok && stale.value.success).not.toBe(true);
    expect.soft(current.status).toBe('failed');
    expect.soft(current.output).toBe(JSON.stringify('B correction'));
  });

  it('L09 task evidence changing away and back still invalidates grading', async () => {
    const row = await seed(), bar = barrier('grade'); grader(bar);
    const old = await Task.findOne(row.taskId);
    const work = tracked(Evaluator.evaluateGoal(row.goalId,row.userId,'automatic','openai','test-model')); await reached(bar,work);
    await run(other,'UPDATE tasks SET output=? WHERE id=?',['temporary',row.taskId]);
    await run(other,'UPDATE tasks SET output=? WHERE id=?',[old.output,row.taskId]);
    bar.release(); const result = await work;
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('STALE_GOAL_EVALUATION');
    expect((await snapshot(row)).evaluations).toHaveLength(0);
  });

  it('L10 partial evaluation persistence rolls back parent and status together', async () => {
    const row = await seed();
    await run(other,"CREATE TRIGGER reject_eval BEFORE INSERT ON task_evaluations BEGIN SELECT RAISE(ABORT,'injected task evaluation failure'); END");
    try {
      const result = await tracked(Evaluator.evaluateGoal(row.goalId,row.userId,'automatic','openai','test-model'));
      expect(result.ok).toBe(false);
      const current=await snapshot(row);
      expect(current.evaluations).toHaveLength(0);expect(current.taskEvaluations).toHaveLength(0);
      expect(current.goal.status).toBe('executing');
    } finally {await run(other,'DROP TRIGGER reject_eval');}
  });

  it('L11 notification failure cannot downgrade committed validation or suppress chat delivery', async () => {
    const row = await seed(); row.entry.conversationId='fixture-chat';
    const delivery=vi.spyOn(Orchestrator,'_sendGoalResultsToChat').mockResolvedValue();
    probe.broadcast.mockImplementation(()=>{throw new Error('notification offline');});
    await tracked(Orchestrator.completeGoal(row.goalId));
    expect((await Goal.findOne(row.goalId)).status).toBe('validated');
    expect(delivery).toHaveBeenCalledOnce();expect(probe.insights).toEqual([row.goalId]);
  });

  it('L12 pause before the initial completion status write cannot be overwritten', async () => {
    const row=await seed(),bar=barrier('initial-status');
    const update=Goal.updateStatus.bind(Goal);
    vi.spyOn(Goal,'updateStatus').mockImplementationOnce(async(...args)=>{await bar.hold();return update(...args);});
    const work=tracked(Orchestrator.completeGoal(row.goalId));await reached(bar,work);
    await Orchestrator.pauseGoal(row.goalId);
    bar.release();await work;
    expect((await Goal.findOne(row.goalId)).status).toBe('paused');expect(probe.call).not.toHaveBeenCalled();
  });

  it('L13 autonomous grading cancelled by pause cannot persist a late result or replan', async () => {
    const row=await seed(),bar=barrier('grade');grader(bar);
    await Goal.updateStatus(row.goalId,'planning');
    vi.spyOn(Orchestrator,'executeGoalTasks').mockResolvedValue();
    const replan=vi.spyOn(Orchestrator,'_replanFailedTasks').mockImplementation(()=>{throw new Error('Replan forbidden');});
    const grading=Evaluator.evaluateGoal.bind(Evaluator);let gradingWork;
    vi.spyOn(Evaluator,'evaluateGoal').mockImplementation((...args)=>{gradingWork=tracked(grading(...args));return gradingWork.then(out=>{if(!out.ok)throw Object.assign(new Error(out.error.message),out.error);return out.value;});});
    const work=tracked(Orchestrator.executeGoalAutonomous(row.goalId,row.userId,{maxIterations:1,provider:'openai',model:'test-model'}));
    await reached(bar,work);await Orchestrator.pauseGoal(row.goalId);bar.release();await work;await gradingWork;
    expect((await Goal.findOne(row.goalId)).status).toBe('paused');expect((await snapshot(row)).evaluations).toHaveLength(0);expect(replan).not.toHaveBeenCalled();
  });

  it('L14 autonomous run A cannot remove replacement B when its grader is cancelled', async () => {
    const row=await seed(),bar=barrier('grade');grader(bar);
    await Goal.updateStatus(row.goalId,'planning');
    vi.spyOn(Orchestrator,'executeGoalTasks').mockResolvedValue();
    const grading=Evaluator.evaluateGoal.bind(Evaluator);let gradingWork;
    vi.spyOn(Evaluator,'evaluateGoal').mockImplementation((...args)=>{gradingWork=tracked(grading(...args));return gradingWork.then(out=>{if(!out.ok)throw Object.assign(new Error(out.error.message),out.error);return out.value;});});
    const work=tracked(Orchestrator.executeGoalAutonomous(row.goalId,row.userId,{maxIterations:1,provider:'openai',model:'test-model'}));
    await reached(bar,work);await Orchestrator.pauseGoal(row.goalId);
    const replacement={...row.entry,abortController:new AbortController(),testGeneration:'B'};
    Orchestrator.runningGoals.set(row.goalId,replacement);await Goal.updateStatus(row.goalId,'executing');
    bar.release();await work;await gradingWork;
    expect((await Goal.findOne(row.goalId)).status).toBe('executing');expect(Orchestrator.runningGoals.get(row.goalId)).toBe(replacement);expect((await snapshot(row)).evaluations).toHaveLength(0);
  });

  it('L08 sequential intentional updates still persist and verify (positive control)', async () => {
    const row = await seed();
    const first = await updateTaskRecord({goal_id:row.goalId,task_id:row.taskId,status:'failed',progress:0,error:'required input missing'}, row.userId);
    const second = await updateTaskRecord({goal_id:row.goalId,task_id:row.taskId,progress:10}, row.userId);
    expect(first.success).toBe(true); expect(second.success).toBe(true);
    const current = await Task.findOne(row.taskId);
    expect(current.status).toBe('failed'); expect(current.progress).toBe(10); expect(current.error).toBe('required input missing');
  });
});

describe('Given evaluation survives past its durable run lease',()=>{
 it('R1 When ownership expires during grading, Then no evaluation or validated status is committed',async()=>{
  const row=await seed();
  await run(db,"INSERT INTO goal_run_ownership(goal_id,user_id,run_id,boot_id,generation,lease_until,state) VALUES(?,?,?,'fixture',1,?,'running')",[row.goalId,row.userId,'old-run',Date.now()+30000]);
  const bar=barrier('grading');grader(bar);
  const work=tracked(Evaluator.evaluateGoal(row.goalId,row.userId,'automatic','openai','test-model'));
  await reached(bar,work);
  await run(other,'UPDATE goal_run_ownership SET lease_until=0 WHERE goal_id=?',[row.goalId]);bar.release();
  const result=await work;expect(result.ok).toBe(false);
  expect((await snapshot(row)).evaluations).toEqual([]);
  expect((await Goal.findOne(row.goalId)).status).toBe('executing');
 });
});

describe('Given a recovered checkpoint entering the actual autonomous runner',()=>{
 it('R2 When recovered at evaluation iteration 3, Then completed task outputs are not replayed and ownership closes atomically with validation',async()=>{
  const row=await seed();await Goal.updateStatus(row.goalId,'planning');
  const {GoalRunOwnership}=await import('../../models/database/goalRunOwnership.js');
  const store=new GoalRunOwnership(other);await store.initialize();const l=await store.acquire(row.goalId,row.userId,'old',1000);
  await store.authorizeContinuation(l,{mode:'autonomous',maxIterations:4,provider:'openai',model:'test-model'},1100);
  await store.checkpoint(l,{phase:'evaluate',iteration:3},1200);await Goal.updateStatus(row.goalId,'executing');
  await store.reconcile(32000);const recovered=await store.recover(row.goalId,'new',Date.now());expect(recovered).toBeTruthy();
  const execute=vi.spyOn(Orchestrator,'executeGoalTasks').mockImplementation(()=>{throw Error('Completed work must not replay')});
  grader();await Orchestrator.executeGoalAutonomous(row.goalId,row.userId,recovered.config,recovered);
  expect(execute).not.toHaveBeenCalled();expect((await Goal.findOne(row.goalId)).current_iteration).toBe(3);
  expect((await Goal.findOne(row.goalId)).status).toBe('validated');
  expect((await store.inspect(row.goalId)).state).toBe('released');
  expect(await store.reconcile(Date.now()+60000)).toBe(0);
 });
});

describe('Given process death can occur immediately after grading commits',()=>{
 it('R3 When successful evaluation returns before runner cleanup, Then durable ownership is already released in the same transaction',async()=>{
  const row=await seed();await run(db,"INSERT INTO goal_run_ownership(goal_id,user_id,run_id,boot_id,generation,lease_until,state) VALUES(?,?,?,'fixture',1,?,'running')",[row.goalId,row.userId,'run',Date.now()+30000]);
  grader();await Evaluator.evaluateGoal(row.goalId,row.userId,'automatic','openai','test-model');
  const owner=await new Promise((r,j)=>db.get('SELECT state FROM goal_run_ownership WHERE goal_id=?',[row.goalId],(e,row)=>e?j(e):r(row)));
  expect(owner.state).toBe('released');
 });
});

describe('Given an expired async run context reaches model writers',()=>{
 it('R4 When failure and phase updates arrive late, Then none can overwrite current state',async()=>{
  const row=await seed();await run(db,"INSERT INTO goal_run_ownership(goal_id,user_id,run_id,boot_id,generation,lease_until,state) VALUES(?,?,?,'fixture',1,0,'running')",[row.goalId,row.userId,'run']);
  const {withGoalRun}=await import('./goalRunContext.js');
  await withGoalRun({goalId:row.goalId,userId:row.userId,runId:'run',generation:1},async()=>{
    expect(await Task.updateStatus(row.taskId,'failed')).toBe(0);
    expect(await Goal.updateStatus(row.goalId,'failed')).toBe(0);
    expect(await Goal.updateLoopStatus(row.goalId,'error')).toBe(0);
    expect(await Task.assignWorkflow(row.taskId,'unexpected')).toBe(0);
  });
  expect((await Task.findOne(row.taskId)).status).toBe('completed');
 });
});

describe('Given a real process crashes at a safe checkpoint',()=>{
 it('R5 When another process recovers the durable checkpoint, Then actual grading completes without task replay',async()=>{
  const row=await seed();await Goal.updateStatus(row.goalId,'planning');
  const {spawn}=await import('node:child_process');const {pathToFileURL}=await import('node:url');
  const {GoalRunOwnership}=await import('../../models/database/goalRunOwnership.js');
  const directory=path.join(process.env.__AGNT_TEST_DATA_DIR,'crash-runner');await fs.mkdir(directory,{recursive:true});
  const script=path.join(directory,'worker.mjs');
  await fs.writeFile(script,`import {createRequire} from 'node:module';const require=createRequire(${JSON.stringify(import.meta.url)});const sqlite3=require('sqlite3');const {GoalRunOwnership}=await import(${JSON.stringify(new URL('../../models/database/goalRunOwnership.js',import.meta.url).href)});const db=new sqlite3.Database(${JSON.stringify(db.filename)});const store=new GoalRunOwnership(db);const l=await store.acquire(${JSON.stringify(row.goalId)},${JSON.stringify(row.userId)},'child',1000);await store.authorizeContinuation(l,{mode:'autonomous',maxIterations:4,provider:'openai',model:'test-model'},1100);await store.checkpoint(l,{phase:'evaluate',iteration:3},1200);await store.run("UPDATE goals SET status='executing' WHERE id=?",[l.goalId]);console.log('CHECKPOINT');setInterval(()=>{},1000);`);
  const child=spawn(process.execPath,[script],{stdio:['ignore','pipe','pipe']});
  try {
    await new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(Error('child checkpoint timeout')),5000);child.stdout.on('data',d=>{text+=d;if(text.includes('CHECKPOINT')){clearTimeout(timer);resolve()}});child.once('exit',()=>{clearTimeout(timer);reject(Error('child exited early'))})});
    const exit=new Promise(r=>child.once('exit',r));child.kill('SIGKILL');await exit;
    const store=new GoalRunOwnership(other);await store.reconcile(32000);
    const recovered=await store.recover(row.goalId,'replacement',Date.now());expect(recovered).toBeTruthy();
    const execute=vi.spyOn(Orchestrator,'executeGoalTasks').mockImplementation(()=>{throw Error('No replay')});grader();
    await Orchestrator.executeGoalAutonomous(row.goalId,row.userId,recovered.config,recovered);
    expect(execute).not.toHaveBeenCalled();expect((await Goal.findOne(row.goalId)).status).toBe('validated');
    expect((await Goal.findOne(row.goalId)).current_iteration).toBe(3);
    expect((await store.inspect(row.goalId)).state).toBe('released');
  }finally{child.kill('SIGKILL')}
 });
});

describe('Given operator-authorized explicit resume',()=>{
 it('R6 When a paused goal has no uncertain attempts, Then execution leaves pause with a live ownership context',async()=>{
  const row=await seed();await Goal.updateStatus(row.goalId,'paused');
  vi.spyOn(Orchestrator,'executeGoalTasks').mockResolvedValue();
  await Orchestrator.resumeGoal(row.goalId,'openai','test-model');
  expect((await Goal.findOne(row.goalId)).status).toBe('executing');
 });
});

describe('Given fresh databases must support durable iteration records',()=>{
 it('R7 When a phase record is stored, Then it is readable on a newly initialized schema',async()=>{
  const row=await seed();const {default:Iterations}=await import('../../models/GoalIterationModel.js');
  const id=await Iterations.create(row.goalId,3,95,true,{phase:'evaluated'},[],10);
  expect(id).toBeTruthy();expect((await Iterations.findOne(row.goalId,3)).world_state_snapshot).toEqual({phase:'evaluated'});
 });
});

describe('Given an old task calls the evaluator after replacement',()=>{
 it('R8 When its async identity differs from the persisted owner, Then it cannot grade for the new owner',async()=>{
  const row=await seed();await run(db,"INSERT INTO goal_run_ownership(goal_id,user_id,run_id,boot_id,generation,lease_until,state) VALUES(?,?,?,'new',2,?,'running')",[row.goalId,row.userId,'new',Date.now()+30000]);
  const {withGoalRun}=await import('./goalRunContext.js');grader();
  await expect(withGoalRun({goalId:row.goalId,userId:row.userId,runId:'old',generation:1},()=>Evaluator.evaluateGoal(row.goalId,row.userId,'automatic','openai','test-model'))).rejects.toMatchObject({code:'STALE_GOAL_EVALUATION'});
  expect((await snapshot(row)).evaluations).toEqual([]);
 });
});

describe('Given the real recovery coordinator finds safe abandoned work',()=>{
 it('R9 When its scan runs, Then it dispatches one safe checkpoint into the actual runner',async()=>{
  // This suite retains earlier fixture goals for audit; only this scenario is
  // authorized for automatic continuation in the coordinator scan.
  await run(db,'DELETE FROM goal_run_authorizations');
  const row=await seed();await Goal.updateStatus(row.goalId,'planning');
  const {GoalRunOwnership}=await import('../../models/database/goalRunOwnership.js');const store=new GoalRunOwnership(other);
  const l=await store.acquire(row.goalId,row.userId,'old',1000);await store.authorizeContinuation(l,{mode:'autonomous',maxIterations:4,provider:'openai',model:'test-model'},1100);
  await store.checkpoint(l,{phase:'evaluate',iteration:3},1200);
  const {default:recovery}=await import('./GoalRunRecovery.js');grader();let finish;const done=new Promise(r=>finish=r);
  const dispatch=vi.fn(async lease=>{try{return await Orchestrator.executeGoalAutonomous(lease.goalId,lease.userId,lease.config,lease)}finally{finish()}});
  const stop=recovery.startCoordinator(dispatch);
  try{await Promise.race([done,new Promise((_,reject)=>setTimeout(()=>reject(Error('coordinator timeout')),3000))]);
   expect(dispatch).toHaveBeenCalledTimes(1);expect((await Goal.findOne(row.goalId)).status).toBe('validated');
  }finally{stop();}
 });
});

describe('Given a remote prerequisite is still executing',()=>{
 it('R10 When local execution visits the next group, Then it waits for remote results before deciding dependency readiness',async()=>{
  const row=await seed();await Goal.updateStatus(row.goalId,'planning');
  const {default:recovery}=await import('./GoalRunRecovery.js');const lease=await recovery.acquire(row.goalId,row.userId);
  const entry={userId:row.userId,runLease:lease,autonomous:true,abortController:new AbortController()};Orchestrator.runningGoals.set(row.goalId,entry);
  await Task.updateStatus(row.taskId,'pending');
  let waited=false;const wait=vi.spyOn(recovery,'waitRemote').mockImplementation(async()=>{waited=true});
  const ready=vi.spyOn(Task,'canExecuteTask').mockImplementation(async()=>{expect(waited).toBe(true);return false});
  try{await Orchestrator.executeGoalTasks(row.goalId,row.userId);expect(ready).toHaveBeenCalled();expect(wait).toHaveBeenCalled();}finally{await recovery.release(lease)}
 });
});
