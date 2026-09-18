import { createHash } from 'node:crypto';
import db from '../../models/database/index.js';
import Memory from '../../models/AgentMemoryModel.js';
import Skills from '../../models/SkillModel.js';
import Executions from '../../models/AgentExecutionModel.js';
import SkillDraftService from './SkillDraftService.js';

const all = (sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows || [])));
const run = (sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, function(error) { error ? reject(error) : resolve(this); }));
const parse = value => { try { for (let i=0; i<2 && typeof value === 'string'; i++) value=JSON.parse(value); return value; } catch { return null; } };
const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** One bounded evidence review in the existing completion hook. No new scheduled worker. */
export default class LessonSkillBridge {
  static async consider(details, userId, context = {}) {
    const [owned] = await all("SELECT id FROM agent_executions WHERE id=? AND user_id=? AND status='completed'", [details.id,userId]);
    if (!owned) return {handled:true,action:'skipped',reason:'Execution unavailable'};
    const receipts = (details.toolExecutions || []).filter(tool => (tool.toolName || tool.tool_name) === 'record_memory_use' && tool.status === 'completed')
      .map(tool => parse(tool.output)).filter(receipt => receipt?.success === true && receipt.status === 'reported_application');
    if (!receipts.length) return { handled: false };
    // Receipt-bearing episodes use this path, not the unrelated tool-multiset detector too.
    for (const memoryId of [...new Set(receipts.map(receipt => receipt.memory_id))].slice(0, 3)) {
      const [memory] = await Memory.findAuthorized({ userId, agentId: details.agentId, memoryId });
      if (!memory?.content.startsWith('Lesson v1\n')) continue;
      const episodes = await this.episodes(memoryId, userId, details.agentId);
      if (episodes.length < 3 || !episodes.some(episode => episode.id === details.id)) continue;
      const evidence = { memoryId, executionIds: episodes.map(episode => episode.id).sort(),
        conversationIds: episodes.map(episode => episode.conversationId).sort() };
      evidence.evidenceSet = fingerprint(evidence);
      // An atomic claim in the existing gate table prevents duplicate reviews across processes/restarts.
      const now = new Date().toISOString();
      const claim = await run(`INSERT INTO extraction_gate (user_id,source_type,scope_id,signature,occurrence_count,first_seen_at,last_seen_at,last_extracted_at)
        VALUES (?,'lesson_skill',?,?,0,?,?,NULL) ON CONFLICT DO NOTHING`, [userId,memoryId,evidence.evidenceSet,now,now]);
      if (!claim.changes) continue;
      const sourceRef = `lesson:${memoryId}:${evidence.evidenceSet}`;
      try {
        const existing = (await Skills.findAll(userId)).filter(skill => skill.user_id === userId);
        const TraceAnalyzer = (await import('../goal/TraceAnalyzer.js')).default;
        const analysis = await TraceAnalyzer.analyzeLessonApplications(memory, episodes, existing, userId, context);
        if (!analysis) throw new Error('Lesson review returned no valid decision');
        let result = { action: 'skipped', reason: 'Lesson sufficient; no procedure needed' };
        if (analysis.linkSkillId) {
          const skill = existing.find(skill => skill.id === analysis.linkSkillId);
          if (!skill || analysis.samePurpose !== true || analysis.sameApplicability !== true || analysis.sameProcedure !== true) throw new Error('Unverified skill link');
          await SkillDraftService.attachEvidence(skill.id,userId,evidence);
          result = { action:'linked',skillId:skill.id,skillName:skill.name };
        } else if (analysis.skillCandidate?.shouldGenerate) {
          const Evolver = (await import('../goal/SkillEvolver.js')).default;
          result = await Evolver.evolveSkill({ ...analysis, lessonEvidence:evidence }, sourceRef, userId);
          if (result.action === 'error') throw new Error(result.reason);
        }
        await run(`UPDATE extraction_gate SET occurrence_count=1,last_extracted_at=? WHERE user_id=? AND source_type='lesson_skill' AND scope_id=? AND signature=?`, [now,userId,memoryId,evidence.evidenceSet]);
        return { handled:true, ...result };
      } catch (error) {
        // Fail closed. Keep the claim, so a partially written draft cannot be duplicated on retry.
        console.error('[LessonSkillBridge] Evidence review incomplete:', error.message);
        return { handled:true, action:'error', reason:error.message, evidenceSet:evidence.evidenceSet };
      }
    }
    return { handled:true, action:'skipped', reason:'No new eligible evidence set' };
  }

  static async episodes(memoryId,userId,agentId) {
    const params=[userId];
    let scope='';
    if (agentId && !['orchestrator','agent-chat'].includes(agentId)) { scope=' AND e.agent_id = ?'; params.push(agentId); }
    params.push(memoryId);
    // Decode object output or legacy JSON-string output, but never accept failed tool envelopes.
    const rawDecoded="CASE WHEN json_valid(t.output) THEN CASE WHEN json_type(t.output)='text' THEN json_extract(t.output,'$') ELSE t.output END ELSE '{}' END";
    const decoded="CASE WHEN json_valid("+rawDecoded+") THEN "+rawDecoded+" ELSE '{}' END";
    const rows=await all(`SELECT t.output,e.id,e.conversation_id FROM agent_tool_executions t JOIN agent_executions e ON e.id=t.execution_id
      WHERE e.user_id=? ${scope} AND e.status='completed' AND t.status='completed' AND t.tool_name='record_memory_use'
      AND json_extract(${decoded},'$.memory_id')=? ORDER BY e.start_time DESC,e.id,t.id LIMIT 300`,params);
    const seen=new Set(),episodes=[];
    let loaded=0;
    for(const row of rows) {
      const receipt=parse(row.output);
      if (!receipt?.success || receipt.status!=='reported_application' || receipt.execution_id!==row.id || !row.conversation_id || seen.has(row.conversation_id)) continue;
      if (!Array.isArray(receipt.evidence_tool_call_ids) || !receipt.evidence_tool_call_ids.length) continue;
      if (++loaded > 12) break;
      const details=await Executions.getExecutionDetails(row.id);
      const tools=(details?.toolExecutions || []).filter(tool=>receipt.evidence_tool_call_ids.includes(tool.toolCallId));
      if (tools.length!==new Set(receipt.evidence_tool_call_ids).size || tools.some(tool=>tool.status!=='completed' || tool.toolName==='record_memory_use' || parse(tool.output)?.success===false)) continue;
      seen.add(row.conversation_id);
      episodes.push({id:row.id,conversationId:row.conversation_id,application:receipt.application,
        initialPrompt:details.initialPrompt,tools:tools.slice(0,8).map(tool=>({id:tool.toolCallId,name:tool.toolName,input:JSON.stringify(tool.input ?? null).slice(0,1000),output:JSON.stringify(tool.output ?? null).slice(0,1500)}))});
      if(episodes.length===3) break;
    }
    return episodes;
  }
}
