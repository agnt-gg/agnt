import {describe,it,expect} from 'vitest';
import {runNativeFixtures,hash,parseVerdict,validateConfig} from './NativeFixtureExperiment.js';
function setup(){
 const item={taskInput:'Use fixture only.',expectedBehavior:JSON.stringify({criteria:[{id:'correct_answer',description:'Answer fixture',required:true}]}),metadata:{skill:'sample',id:'fixture-one',executionMode:'fixture-reasoning-no-tools'}};
 const dataset={user_id:'u',items:[item]};const experiment={id:'e',user_id:'u',name:'fixture',config:{provider:'p',model:'m',tokenBudget:1000,candidate:{name:'sample',instructions:'Check fixture facts.',sha256:hash('Check fixture facts.')},datasetSha256:hash(JSON.stringify(dataset.items))}};
 const calls=[],created=[],updates=[],metrics=[],statuses=[];let n=0;
 const executions={create:async(...a)=>{const id='x'+(++n);created.push({id,a});return id;},update:async(...a)=>updates.push(a)};
 const experiments={updateStatus:async(...a)=>statuses.push(a),createRun:async()=> 'r'+(++n),updateRunStatus:async()=>{},updateRunMetrics:async(...a)=>metrics.push(a),createResult:async()=>{}};
 let impl=async c=>({content:c.messages[0].content.startsWith('Grade')?' {"correct_answer":true} ':'fixture answer',usage:{inputTokens:20,outputTokens:10,totalTokens:30},toolExecutions:[]});
 const llm={executeWithTools:async c=>{calls.push(c);return impl(c);}};
 return {experiment,dataset,calls,created,updates,metrics,statuses,setImpl:f=>impl=f,args:{experiment,dataset,userId:'u',provider:'p',model:'m'},deps:{executions,experiments,llm,broadcast:()=>{}}};
}
function withControl(f, instructions = 'Preserve original behavior.') {
  f.experiment.config.control = { instructions, sha256: hash(instructions) };
  return f;
}

describe('versioned native fixture controls', () => {
  it('keeps absent control as the legacy no-skill baseline', async () => {
    const f = setup();
    const result = await runNativeFixtures(f.args, f.deps);
    expect(f.calls[0].messages[0].content).toBe('Answer only from the supplied fixture. No tools or external actions. Fixture pair x1:0');
    expect(result.controlHash).toBeNull();
    expect(result.comparisonMode).toBe('no-skill-control');
    expect(result.rows.map(row => row.instructionHash)).toEqual([null, f.experiment.config.candidate.sha256]);
  });

  it('uses the frozen old skill in control and the candidate in treatment', async () => {
    const f = withControl(setup());
    const result = await runNativeFixtures(f.args, f.deps);
    const [control,, treatment] = f.calls;
    expect(control.messages[0].content).toContain('\nSkill instructions:\nPreserve original behavior.');
    expect(treatment.messages[0].content).toContain('\nSkill instructions:\nCheck fixture facts.');
    expect(control.messages[1]).toEqual(treatment.messages[1]);
    expect(control.messages[0].content).not.toContain('Check fixture facts.');
    expect(treatment.messages[0].content).not.toContain('Preserve original behavior.');
    expect(JSON.parse(f.created[0].a[4]).controlHash).toBe(f.experiment.config.control.sha256);
    expect(result).toMatchObject({ controlHash: f.experiment.config.control.sha256, comparisonMode: 'skill-vs-skill', autoPromotion: false });
    expect(result.rows.map(row => row.instructionHash)).toEqual([f.experiment.config.control.sha256, f.experiment.config.candidate.sha256]);
    expect(f.metrics.every(([, metrics]) => metrics.controlHash === f.experiment.config.control.sha256)).toBe(true);
    for (const judge of [f.calls[1], f.calls[3]]) {
      expect(JSON.stringify(judge.messages)).not.toMatch(/Preserve original behavior|Check fixture facts|Skill instructions|control|treatment/);
    }
  });

  it('makes identical-skill A/A observations cache-distinct without labeling arms', async () => {
    const f = setup();
    withControl(f, f.experiment.config.candidate.instructions);
    const result = await runNativeFixtures(f.args, f.deps);
    const [a,, b] = f.calls;
    const normalize = text => text.replace(/Observation [0-9a-f-]+/g, 'Observation <opaque>');
    expect(a.messages[0].content).toMatch(/Observation [0-9a-f-]{36}/);
    expect(normalize(a.messages[0].content)).toBe(normalize(b.messages[0].content));
    expect(a.messages).not.toEqual(b.messages);
    expect(a.messages[0].content).not.toMatch(/control|treatment|Candidate instructions/);
    expect(result.rows[0].instructionHash).toBe(result.rows[1].instructionHash);
    expect(result.rows[0].executionId).not.toBe(result.rows[1].executionId);
  });

  it.each([
    ['null', null], ['array', []], ['missing text', { sha256: hash('old') }],
    ['blank', { instructions: '  ', sha256: hash('  ') }],
    ['wrong type', { instructions: 42, sha256: hash('42') }],
    ['missing hash', { instructions: 'old' }],
    ['mismatched hash', { instructions: 'old', sha256: hash('new') }],
  ])('rejects an explicitly invalid control (%s) before traces or model calls', async (_name, control) => {
    const f = setup(); f.experiment.config.control = control;
    await expect(runNativeFixtures(f.args, f.deps)).rejects.toThrow('Frozen control hash mismatch');
    expect(f.created).toHaveLength(0); expect(f.calls).toHaveLength(0);
    expect(f.statuses).toHaveLength(0);
  });

  it('retains ownership checks with an explicit control', async () => {
    const f = withControl(setup()); f.experiment.user_id = 'other';
    await expect(runNativeFixtures(f.args, f.deps)).rejects.toThrow('ownership');
    expect(f.created).toHaveLength(0);
  });

  it('freezes both instruction snapshots before asynchronous execution starts', async () => {
    const f = withControl(setup());
    const originalCreate = f.deps.executions.create;
    f.deps.executions.create = async (...args) => {
      f.experiment.config.control.instructions = 'changed after validation';
      f.experiment.config.candidate.instructions = 'also changed';
      return originalCreate(...args);
    };
    await runNativeFixtures(f.args, f.deps);
    expect(f.calls[0].messages[0].content).toContain('Preserve original behavior.');
    expect(f.calls[2].messages[0].content).toContain('Check fixture facts.');
    expect(JSON.stringify(f.calls)).not.toContain('changed after validation');
  });

  it('preserves completed subject evidence and both trace IDs when a grader is invalid', async () => {
    const f = withControl(setup());
    f.setImpl(async call => {
      const judge = call.messages[0].content.startsWith('Grade');
      if (judge) {
        const subjectId = call.ledger.parentExecutionId;
        expect(f.updates.some(row => row[0] === subjectId && row[1] === 'completed' && row[2] === 'saved subject')).toBe(true);
      }
      return { content: judge ? 'malformed verdict' : 'saved subject', usage: { totalTokens: 30 } };
    });
    await expect(runNativeFixtures(f.args, f.deps)).rejects.toThrow();
    const subjectId = f.created[1].id, judgeId = f.created[2].id;
    expect(f.updates.filter(row => row[0] === subjectId)).toEqual([[subjectId, 'completed', 'saved subject', 0, 0, null, { totalTokens: 30 }]]);
    expect(f.updates.some(row => row[0] === judgeId && row[1] === 'failed' && row[2] === 'malformed verdict')).toBe(true);
    expect(f.metrics[0][1]).toMatchObject({ classification: 'eval-bug', subjectExecutionId: subjectId, graderExecutionId: judgeId, controlHash: f.experiment.config.control.sha256 });
    expect(f.calls).toHaveLength(2);
  });

  it('does not start grading if persisting the subject response fails', async () => {
    const f = withControl(setup());
    f.deps.executions.update = async (...args) => {
      if (args[1] === 'completed') throw Error('trace store unavailable');
      f.updates.push(args);
    };
    await expect(runNativeFixtures(f.args, f.deps)).rejects.toThrow('trace store unavailable');
    expect(f.calls).toHaveLength(1);
    expect(f.statuses.at(-1)[1]).toBe('failed');
  });

  it.each(['missing usage', 'empty output'])('never records successful subject evidence for %s', async reason => {
    const f = withControl(setup());
    f.setImpl(async () => reason === 'missing usage' ? { content: 'answer' } : { content: '', usage: { totalTokens: 30 } });
    await expect(runNativeFixtures(f.args, f.deps)).rejects.toThrow();
    expect(f.calls).toHaveLength(1);
    expect(f.updates.some(row => row[1] === 'completed')).toBe(false);
    expect(f.metrics[0][1].classification).toBe('eval-bug');
  });
});

describe('native fixture experiments',()=>{
 it('records batch + subject/grader trees without conversations, tools or global mutation',async()=>{const f=setup();const r=await runNativeFixtures(f.args,f.deps);expect(f.created).toHaveLength(5);expect(f.created.every(x=>x.a[3]===null)).toBe(true);expect(f.calls.every(x=>x.toolSchemas.length===0&&x.maxToolRounds===0&&x.ledger.conversationId===null)).toBe(true);expect(f.created.slice(1).every(x=>x.a[8].rootExecutionId===r.executionId)).toBe(true);expect(r.autoPromotion).toBe(false);expect(r.coverage).toBe(2);});
 it('puts the sole treatment difference into keyed messages, not ignored systemPrompt',async()=>{const f=setup();await runNativeFixtures(f.args,f.deps);const [control,,treatment]=f.calls;expect(control.messages[1]).toEqual(treatment.messages[1]);expect(treatment.messages[0].content).toBe(control.messages[0].content+'\nCandidate instructions:\nCheck fixture facts.');expect(control.systemPrompt).toBeUndefined();});
 it('blinds the grader to arm label and candidate text',async()=>{const f=setup();await runNativeFixtures(f.args,f.deps);for(const c of [f.calls[1],f.calls[3]]){expect(JSON.stringify(c.messages)).not.toContain('Candidate instructions');expect(JSON.stringify(c.messages)).not.toContain('treatment');}});
 it('rejects ownership mismatches before creating traces',async()=>{const f=setup();f.dataset.user_id='other';await expect(runNativeFixtures(f.args,f.deps)).rejects.toThrow('ownership');expect(f.created).toHaveLength(0);});
 it('rejects candidate and dataset drift',()=>{const f=setup();f.experiment.config.candidate.instructions+=' changed';expect(()=>validateConfig(f.experiment,f.dataset,'u','p','m')).toThrow('hash');});
 it('requires requested model match pinned config',()=>{const f=setup();expect(()=>validateConfig(f.experiment,f.dataset,'u','p','other')).toThrow('Pinned');});
 it('invalid judge result is eval-bug, fails batch, no promotion',async()=>{const f=setup();f.setImpl(async c=>({content:c.messages[0].content.startsWith('Grade')?'not JSON':'answer',usage:{totalTokens:30}}));await expect(runNativeFixtures(f.args,f.deps)).rejects.toThrow();expect(f.metrics[0][1].classification).toBe('eval-bug');expect(f.statuses.at(-1)[1]).toBe('failed');expect(f.calls).toHaveLength(2);});
 it('provider failure is infra and stops remaining work',async()=>{const f=setup();f.setImpl(async()=>{throw Error('HTTP 429 rate limit');});await expect(runNativeFixtures(f.args,f.deps)).rejects.toThrow('429');expect(f.metrics[0][1].classification).toBe('infra');expect(f.calls).toHaveLength(1);});
 it('missing usage is not invented as zero success',async()=>{const f=setup();f.setImpl(async()=>({content:'answer'}));await expect(runNativeFixtures(f.args,f.deps)).rejects.toThrow('usage');expect(f.metrics[0][1].classification).toBe('eval-bug');});
 it('does not execute unsolicited tool calls',async()=>{const f=setup();f.setImpl(async()=>({content:'tool?',usage:{totalTokens:30},responseMessage:{tool_calls:[{id:'t'}]}}));await expect(runNativeFixtures(f.args,f.deps)).rejects.toThrow('requested tools');expect(f.metrics[0][1].classification).toBe('behavioral');});
 it('budget stops next grader rather than silently overspending more rounds',async()=>{const f=setup();f.setImpl(async()=>({content:'answer',usage:{totalTokens:1200}}));await expect(runNativeFixtures(f.args,f.deps)).rejects.toThrow('budget');expect(f.calls).toHaveLength(1);});
 it('requires exact boolean rubric coverage',()=>{const c=[{id:'a'}];expect(()=>parseVerdict('{"a":"true"}',c)).toThrow();expect(()=>parseVerdict('{"a":true,"b":false}',c)).toThrow();expect(parseVerdict('{"a":false}',c).pass).toBe(false);});
});
