import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import sqlite3 from 'sqlite3';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
const db = new sqlite3.Database(':memory:');
const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'lesson-skill-test-'));
vi.mock('../../models/database/index.js',()=>({default:db}));
vi.mock('../../models/EvolutionSettingsModel.js',()=>({default:{get:async()=>({chatSkillForge:true})}}));
vi.mock('../../models/LlmCallModel.js',()=>({default:{byExecutionIds:async()=>new Map()}}));
vi.mock('../../utils/workspaceRoot.js',()=>({getWorkspaceRoot:async()=>workspace}));
vi.mock('../../libs/agnt2.js',()=>({default:{}}));
vi.mock('../../tools/library/triggers/LocalEmailReceiver.js',()=>({default:{}}));
vi.mock('node-fetch',()=>({default:vi.fn(()=>{throw new Error('Network forbidden')})}));
const run=(sql,params=[])=>new Promise((resolve,reject)=>db.run(sql,params,function(error){error?reject(error):resolve(this)}));
const all=(sql,params=[])=>new Promise((resolve,reject)=>db.all(sql,params,(error,rows)=>error?reject(error):resolve(rows)));
const schema=await fs.readFile(new URL('../../models/database/index.js',import.meta.url),'utf8');
for(const table of ['agent_memory','agent_executions','agent_tool_executions','skills','skill_versions','extraction_gate']) {
  const match=schema.match(new RegExp('CREATE TABLE IF NOT EXISTS '+table+' \\([\\s\\S]*?\\)`'));
  if(!match) throw new Error('Missing schema '+table);
  await run(match[0].slice(0,-1));
}
for(const column of ['slug TEXT','source_plugin TEXT','is_user_modified INTEGER DEFAULT 0']) {
  try { await run('ALTER TABLE skills ADD COLUMN '+column); } catch(error) { if(!error.message.includes('duplicate column')) throw error; }
}
for (const table of ['agent_executions','agent_tool_executions']) {
  for (const column of ['input_tokens','output_tokens','total_tokens','estimated_cost','cache_read_tokens','cache_creation_tokens']) await run('ALTER TABLE '+table+' ADD COLUMN '+column+' REAL DEFAULT 0');
}
// Columns the real schema adds by ALTER live outside the CREATE TABLE block
// above, so take them from the same source rather than restating them here -
// a hand-written list silently drifts the moment a column is added upstream.
for (const match of schema.matchAll(/'(ALTER TABLE (?:agent_executions|agent_tool_executions) ADD COLUMN [^']+)'/g)) {
  try { await run(match[1]); } catch(error) { if(!error.message.includes('duplicate column')) throw error; }
}
await run('CREATE TABLE agents(id TEXT PRIMARY KEY,name TEXT,status TEXT,created_by TEXT)');
const {default:Bridge}=await import('./LessonSkillBridge.js');
const {default:Forge}=await import('./ChatSkillForge.js');
const {default:Drafts}=await import('./SkillDraftService.js');
const {default:Skills}=await import('../../models/SkillModel.js');
const {default:Versions}=await import('../../models/SkillVersionModel.js');
const {default:Executions}=await import('../../models/AgentExecutionModel.js');
const {default:Analyzer}=await import('../goal/TraceAnalyzer.js');
const {default:Evolver}=await import('../goal/SkillEvolver.js');
const {default:Insights}=await import('./InsightEngine.js');
const {TOOLS}=await import('../orchestrator/tools.js');
const {buildSkillCatalog,buildSkillsContext}=await import('../SkillService.js');
const {default:Discovery}=await import('../SkillDiscoveryService.js');
const {parseSkillMd}=await import('../../utils/skillValidation.js');
const {isDefaultSkill}=await import('../../utils/skillTrust.js');
const lesson='Lesson v1\nWhen: native release\nDo: inspect headers\nBoundary: not a launch test\nEvidence: CPU mismatch';
const candidate={traceQuality:'high',patterns:[],overallAssessment:'Procedure demonstrated',skillCandidate:{shouldGenerate:true,name:'Native Release Verification',category:'coding',description:'Verify packaged native target',allowedTools:['inspect_binary'],instructions:'# Native Release Verification\n\n## Inputs\nTarget and artifact.\n## Steps\n1. Inspect headers.\n2. Compare CPU.\n## Verify\nReport mismatch.\n## Boundary\nNot launch proof.\n## Recovery\nStop if unavailable.'}};
let judge,serial=0;
async function seed(memoryId,number,{user='u1',conversation,receiptSuccess=true,evidence=true,toolSuccess=true}={}) {
  const id=`${memoryId}-${number}-${serial++}`, call=`${id}-inspect`,conv=conversation||`conv-${id}`;
  await run('INSERT OR IGNORE INTO agent_memory(id,agent_id,user_id,memory_type,content) VALUES(?,?,?,?,?)',[memoryId,'orchestrator',user,'pattern',lesson]);
  await run("INSERT INTO agent_executions(id,user_id,conversation_id,status,start_time,initial_prompt,final_response) VALUES(?,?,?,'completed',?,?,?)",[id,user,conv,`2026-09-08T10:${String(number).padStart(2,'0')}:00Z`,'Verify packaged native target','Measured CPU header']);
  await run("INSERT INTO agent_tool_executions(id,execution_id,tool_call_id,tool_name,status,input,output) VALUES(?,?,?,'inspect_binary','completed','{}',?)",[call,id,call,JSON.stringify({success:toolSuccess,cpu:'x64'})]);
  const receipt={success:receiptSuccess,status:'reported_application',memory_id:memoryId,execution_id:id,application:'Inspected headers first',evidence_tool_call_ids:evidence?[call]:[]};
  await run("INSERT INTO agent_tool_executions(id,execution_id,tool_call_id,tool_name,status,input,output) VALUES(?,?,?,'record_memory_use','completed','{}',?)",[id+'receipt',id,id+'receipt',JSON.stringify(number%2?JSON.stringify(receipt):receipt)]);
  return Executions.getExecutionDetails(id);
}
beforeEach(()=>{vi.restoreAllMocks();judge=vi.spyOn(Analyzer,'analyzeLessonApplications').mockResolvedValue(structuredClone(candidate));});
afterAll(async()=>{await new Promise(resolve=>db.close(resolve));await fs.rm(workspace,{recursive:true,force:true});});
describe('lesson -> procedure -> activation end to end',()=>{
  it('creates nothing before three distinct supported conversations',async()=>{
    const a=await seed('threshold',1),b=await seed('threshold',2,{conversation:a.conversationId});
    expect((await Bridge.consider(a,'u1')).action).toBe('skipped');
    expect((await Bridge.consider(b,'u1')).action).toBe('skipped');
    expect(judge).not.toHaveBeenCalled();
  });
  it('does not count failed envelopes, missing evidence or failed tool outputs',async()=>{
    await seed('negative',1,{receiptSuccess:false});await seed('negative',2,{evidence:false});
    const c=await seed('negative',3,{toolSuccess:false});
    expect(await Bridge.episodes('negative','u1')).toHaveLength(0);
    await Bridge.consider(c,'u1');expect(judge).not.toHaveBeenCalled();
  });
  it('creates one draft, preserves evidence, exports SKILL.md, then accepts and retrieves it',async()=>{
    await seed('complete',1);await seed('complete',2);const c=await seed('complete',3);
    const results=await Promise.all([Forge.onChatCompleted(c.id,'u1'),Forge.onChatCompleted(c.id,'u1')]);
    expect(judge).toHaveBeenCalledTimes(1);
    const result=results.find(result=>result.skillId);expect(result.status).toBe('draft');
    let skill=await Skills.findById(result.skillId);
    expect(isDefaultSkill(skill)).toBe(false);
    expect(buildSkillCatalog([skill])).toBe('');
    expect(buildSkillsContext([skill])).not.toContain('Inspect headers');
    const meta=JSON.parse(skill.metadata);
    expect(meta.lessonLinks[0].executionIds).toHaveLength(3);
    expect(new Set(meta.lessonLinks[0].conversationIds).size).toBe(3);
    expect(judge.mock.calls[0][1]).toHaveLength(3);
    expect((await Versions.findById(result.versionId)).status).toBe('draft');
    const markdown=await fs.readFile(result.exportPath,'utf8');
    expect(parseSkillMd(markdown).instructions).toContain('Inspect headers');
    expect(markdown).toContain('generatedExport');
    expect(await Discovery._parseSkillDirectory(path.dirname(result.exportPath),result.exportPath,{scope:'user'})).toBeNull();
    expect(result.exportPath.startsWith(workspace)).toBe(true);
    expect(await Drafts.exportVersion(skill,await Versions.findById(result.versionId))).toBe(result.exportPath);
    const context={userId:'u1'};
    let activation=JSON.parse(await TOOLS.activate_skill.execute({skill_id:skill.id},'',context));
    expect(activation.success).toBe(false);
    activation=JSON.parse(await TOOLS.activate_skill.execute({skill_id:skill.id,allow_draft:true},'',context));
    expect(activation.verification_status).toBe('draft');
    expect(activation.skill_id).toBe(skill.id);expect(activation.content_hash).toMatch(/^[a-f0-9]{64}$/);
    expect((await Drafts.linkedMemories([{id:'complete',content:lesson}],'u1'))[0].linkedSkills).toEqual([]);
    await expect(Drafts.accept(skill.id,result.versionId,'u2',activation.content_hash)).rejects.toThrow();
    await expect(Drafts.accept(skill.id,result.versionId,'u1','wrong')).rejects.toThrow();
    await Drafts.accept(skill.id,result.versionId,'u1',activation.content_hash);
    skill=await Skills.findById(skill.id);
    expect(isDefaultSkill(skill)).toBe(true);
    expect(buildSkillCatalog([skill])).toContain('Native Release');
    expect((await Drafts.linkedMemories([{id:'complete',content:lesson}],'u1'))[0].linkedSkills.join(' ')).toContain('activate_skill(skill_id=');
    expect((await Drafts.linkedMemories([{id:'complete',content:lesson}],'u2'))[0].content).not.toContain('Procedure:');
    const loaded=JSON.parse(await TOOLS.activate_skill.execute({skill_id:skill.id},'',{userId:'u1'}));
    expect(loaded.verification_status).toBe('accepted');expect(loaded.version).toBe(1);
    await Bridge.consider(c,'u1');expect(judge).toHaveBeenCalledTimes(1);
  });
  it('keeps a decline durable so identical evidence is not reviewed again',async()=>{
    judge.mockResolvedValue({traceQuality:'high',patterns:[],skillCandidate:{shouldGenerate:false}});
    await seed('decline',1);await seed('decline',2);const c=await seed('decline',3);
    expect((await Bridge.consider(c,'u1')).action).toBe('skipped');
    await Bridge.consider(c,'u1');expect(judge).toHaveBeenCalledOnce();
    const d=await seed('decline',4);await Bridge.consider(d,'u1');expect(judge).toHaveBeenCalledTimes(2);
  });
  it('links equivalent existing procedures without replacing their instructions',async()=>{
    const skill=(await Skills.findAll('u1')).find(isDefaultSkill);
    const before=skill.instructions;
    judge.mockResolvedValue({traceQuality:'high',patterns:[],linkSkillId:skill.id,samePurpose:true,sameApplicability:true,sameProcedure:true,skillCandidate:{shouldGenerate:false}});
    await seed('link-existing',1);await seed('link-existing',2);const c=await seed('link-existing',3);
    expect((await Bridge.consider(c,'u1')).action).toBe('linked');
    expect((await Skills.findById(skill.id)).instructions).toBe(before);
    expect(JSON.parse((await Skills.findById(skill.id)).metadata).lessonLinks.some(link=>link.memoryId==='link-existing')).toBe(true);
  });
  it('rejects invented foreign links and does not rerun a failed evidence set',async()=>{
    judge.mockResolvedValue({linkSkillId:'foreign',samePurpose:true,sameApplicability:true,sameProcedure:true});
    await seed('bad-link',1);await seed('bad-link',2);const c=await seed('bad-link',3);
    expect((await Bridge.consider(c,'u1')).action).toBe('error');
    await Bridge.consider(c,'u1');expect(judge).toHaveBeenCalledOnce();
    expect(await Bridge.episodes('bad-link','u2')).toEqual([]);
  });
  it('stores refinement as a separate draft and activates exact draft version only with opt-in',async()=>{
    const skill=(await Skills.findAll('u1')).find(isDefaultSkill);
    const original=skill.instructions;
    vi.spyOn(Evolver,'_mergeSkillInstructions').mockResolvedValue(original+'\n3. Verify every module.');
    const result=await Evolver.refineSkill(skill.id,{...candidate,skillCandidate:{...candidate.skillCandidate,instructions:original+'\nCheck all modules'}},'chat:refinement','u1');
    expect(result.status).toBe('draft');
    expect((await Skills.findById(skill.id)).instructions).toBe(original);
    expect((await Versions.findLatest(skill.id)).version).toBe(1);
    const draft=JSON.parse(await TOOLS.activate_skill.execute({skill_id:skill.id,version_id:result.versionId,allow_draft:true},'',{userId:'u1'}));
    expect(draft.instructions).toContain('Verify every module');expect(draft.verification_status).toBe('draft');
    const normal=JSON.parse(await TOOLS.activate_skill.execute({skill_id:skill.id},'',{userId:'u1'}));
    expect(normal.instructions).toBe(original);
    expect((await Versions.findBySkillId(skill.id))).toHaveLength(2);
    await Evolver.refineSkill(skill.id,{...candidate,skillCandidate:{...candidate.skillCandidate,instructions:original+'\nCheck all modules'}},'chat:refinement','u1');
    expect((await Versions.findBySkillId(skill.id))).toHaveLength(2);
  });
  it('does not equate unrelated procedures merely because their tools overlap',async()=>{
    vi.spyOn(Insights,'_callLlm').mockResolvedValue(JSON.stringify({skillId:'made-up',samePurpose:false,sameApplicability:false,sameProcedure:false}));
    const result=await Evolver._findSimilarSkill({...candidate.skillCandidate,name:'Native GPU Shader Art',description:'Render images',instructions:'Different procedure'},'u1');
    expect(result).toBeNull();
  });
  it('returns complete activation identity even for repeated loads and refuses foreign IDs',async()=>{
    const skill=(await Skills.findAll('u1')).find(isDefaultSkill);const context={userId:'u1'};
    const first=JSON.parse(await TOOLS.activate_skill.execute({skill_id:skill.id},'',context));
    const second=JSON.parse(await TOOLS.activate_skill.execute({skill_id:skill.id},'',context));
    expect(second.already_activated).toBe(true);expect(second.content_hash).toBe(first.content_hash);expect(second.skill_id).toBe(first.skill_id);
    const foreign=JSON.parse(await TOOLS.activate_skill.execute({skill_id:skill.id},'',{userId:'u2'}));expect(foreign.success).toBe(false);
  });
  it('keeps a procedure pointer visible when the lesson text is abbreviated',async()=>{
    const {buildMemoryDigest}=await import('../../utils/memoryDigest.js');
    const skill=(await Skills.findAll('u1')).find(isDefaultSkill);
    const linked=await Drafts.linkedMemories([{id:'complete',content:lesson.repeat(1000)}],'u1');
    const digest=buildMemoryDigest(linked);
    expect(digest.text).toContain(skill.id);expect(digest.text).toContain('activate_skill');
    expect(digest.text).toContain('[abbreviated]');
  });
  it('does not lose concurrently attached lesson evidence',async()=>{
    const skill=(await Skills.findAll('u1')).find(isDefaultSkill);
    await Promise.all(Array.from({length:8},(_,i)=>Drafts.attachEvidence(skill.id,'u1',{memoryId:'parallel'+i,executionIds:['e'],conversationIds:['c'],evidenceSet:'parallel'+i})));
    const links=JSON.parse((await Skills.findById(skill.id)).metadata).lessonLinks;
    expect(links.filter(link=>link.memoryId.startsWith('parallel'))).toHaveLength(8);
  });
  it('allocates concurrent different draft versions without duplicate numbers',async()=>{
    const skill=(await Skills.findAll('u1')).find(isDefaultSkill);
    const versions=await Promise.all(Array.from({length:4},(_,i)=>Drafts.createVersion({skillId:skill.id,userId:'u1',instructions:'Concurrent candidate '+i,sourceGoalId:'chat:concurrent'+i,summary:{verification:'unverified'}})));
    expect(new Set(versions.map(version=>version.version)).size).toBe(4);
    const repeated=await Drafts.createVersion({skillId:skill.id,userId:'u1',instructions:'Concurrent candidate 0',sourceGoalId:'chat:concurrent0',summary:{}});
    expect(repeated.id).toBe(versions[0].id);
  });
  it('refuses existing export collisions without overwriting content',async()=>{
    const skill=(await Skills.findAll('u1')).find(isDefaultSkill);
    const version=(await Versions.findBySkillId(skill.id)).at(-1);
    const file=await Drafts.exportVersion(skill,version);
    await fs.writeFile(file,'fixture-owned modified export');
    await expect(Drafts.exportVersion(skill,version)).rejects.toThrow('collision');
    expect(await fs.readFile(file,'utf8')).toBe('fixture-owned modified export');
  });
  it('ignores malformed output envelopes and rejects a mismatched user',async()=>{
    const details=await seed('malformed',1);
    await run('UPDATE agent_tool_executions SET output=? WHERE execution_id=? AND tool_name=?',[JSON.stringify('not-json'),details.id,'record_memory_use']);
    expect(await Bridge.episodes('malformed','u1')).toEqual([]);
    expect((await Bridge.consider(details,'u2')).action).toBe('skipped');
  });

});
