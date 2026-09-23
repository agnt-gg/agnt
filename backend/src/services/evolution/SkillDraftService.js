import { prepareWrite } from '../../utils/lineEndings.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import db from '../../models/database/index.js';
import SkillModel from '../../models/SkillModel.js';
import SkillVersionModel from '../../models/SkillVersionModel.js';
import { serializeSkillMd } from '../../utils/skillValidation.js';
import { getWorkspaceRoot } from '../../utils/workspaceRoot.js';
import { skillMetadata, skillIdentity, isDefaultSkill } from '../../utils/skillTrust.js';

const all = (sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows || [])));
const run = (sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, function(error) { error ? reject(error) : resolve(this); }));
const hash = value => createHash('sha256').update(value).digest('hex');

/** Drafts and their exports are evidence, not automatic replacements for canonical instructions. */
export default class SkillDraftService {
  static async exportVersion(skill, version) {
    const workspace = await getWorkspaceRoot();
    // Not inside a discovery root. Hash path components rather than trusting model names/IDs.
    const directory = path.join(workspace, 'skill-exports', hash(skill.user_id), hash(skill.id), `v${version.version}-${hash(version.instructions).slice(0, 16)}`);
    await fs.mkdir(directory, { recursive: true });
    const file = path.join(directory, 'SKILL.md');
    // Snapshot data comes from the immutable version, not today's mutable metadata/status.
    const summary = version.trace_analysis_summary ? JSON.parse(version.trace_analysis_summary) : {};
    const markdown = serializeSkillMd({ ...skill, instructions: version.instructions,
      metadata: { generatedExport: true, skillId: skill.id, version: version.version,
        sourceTrace: version.source_goal_id, lessonEvidence: summary.lessonEvidence || null,
        contentHash: hash(version.instructions) } });
    const { content } = await prepareWrite(file, markdown);
    try { await fs.writeFile(file, content, { encoding: 'utf8', flag: 'wx' }); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (await fs.readFile(file, 'utf8') !== content) throw new Error('Skill export collision; existing file preserved');
    }
    return file;
  }

  static async attachEvidence(skillId, userId, evidence) {
    if (!evidence) return;
    const skill = await SkillModel.findById(skillId);
    if (!skill || skill.user_id !== userId) throw new Error('Skill not found');
    // SQL JSON append avoids overwriting unrelated metadata updated by another run.
    const entry = { memoryId: evidence.memoryId, executionIds: evidence.executionIds,
      conversationIds: evidence.conversationIds, evidenceSet: evidence.evidenceSet };
    if (!entry.memoryId || !entry.evidenceSet) throw new Error('Incomplete lesson provenance');
    const metadata = skillMetadata(skill);
    if (metadata.lessonLinks !== undefined && !Array.isArray(metadata.lessonLinks)) throw new Error('Malformed lesson links');
    await run(`UPDATE skills SET metadata = json_set(COALESCE(metadata, '{}'), '$.lessonLinks',
        json_insert(COALESCE(json_extract(metadata, '$.lessonLinks'), '[]'), '$[#]', json(?)))
      WHERE id = ? AND user_id = ? AND NOT EXISTS (
        SELECT 1 FROM json_each(skills.metadata, '$.lessonLinks') WHERE json_extract(value, '$.evidenceSet') = ?
      )`, [JSON.stringify(entry), skillId, userId, entry.evidenceSet]);
  }

  /** One SQL statement allocates a version and deduplicates concurrent identical candidates. */
  static async createVersion({ skillId, userId, instructions, sourceGoalId, summary }) {
    const id = randomUUID();
    const changed = await run(`INSERT INTO skill_versions (id,skill_id,user_id,version,instructions,parent_version_id,source_goal_id,trace_analysis_summary,status)
      SELECT ?,?,?,COALESCE(MAX(version),0)+1,?,
        (SELECT id FROM skill_versions WHERE skill_id=? AND status='active' ORDER BY version DESC LIMIT 1),?,?,'draft'
      FROM skill_versions WHERE skill_id=? HAVING NOT EXISTS
        (SELECT 1 FROM skill_versions WHERE skill_id=? AND user_id=? AND (instructions=? OR source_goal_id=?))`,
      [id,skillId,userId,instructions,skillId,sourceGoalId,JSON.stringify(summary),skillId,skillId,userId,instructions,sourceGoalId]);
    if (changed.changes) return SkillVersionModel.findById(id);
    const [existing] = await all('SELECT * FROM skill_versions WHERE skill_id=? AND user_id=? AND (instructions=? OR source_goal_id=?) ORDER BY version DESC LIMIT 1', [skillId,userId,instructions,sourceGoalId]);
    if (!existing) throw new Error('Version could not be saved');
    return existing;
  }

  static async linkedMemories(memories, userId) {
    if (!memories.length || !userId) return memories;
    const ids = memories.map(memory => memory.id);
    const rows = await all(`SELECT DISTINCT s.* FROM skills s, json_each(CASE WHEN json_valid(s.metadata) THEN s.metadata ELSE '{}' END, '$.lessonLinks') link
      WHERE s.user_id = ? AND json_extract(link.value, '$.memoryId') IN (${ids.map(() => '?').join(',')}) ORDER BY s.id`, [userId, ...ids]);
    return memories.map(memory => {
      const linked = rows.filter(skill => isDefaultSkill(skill) && skillMetadata(skill).lessonLinks.some(link => link.memoryId === memory.id)).slice(0, 2);
      return { ...memory, linkedSkills: linked.map(skill => {
        const identity = skillIdentity(skill);
        return `\nProcedure: activate_skill(skill_id=${JSON.stringify(skill.id)}). Version: ${identity.version ?? 'unversioned'}; hash: ${identity.content_hash}; status: ${identity.verification_status}.`;
      }) };
    });
  }

  /** Explicit owner acceptance with stale-review protection. Never claims an empirical evaluation. */
  static async accept(skillId, versionId, userId, expectedHash) {
    const skill = await SkillModel.findById(skillId);
    const version = await SkillVersionModel.findById(versionId);
    if (!skill || skill.user_id !== userId || !version || version.user_id !== userId || version.skill_id !== skillId) throw new Error('Skill version not found');
    if (version.status !== 'draft' || hash(version.instructions) !== expectedHash) throw new Error('Draft changed or is not pending');
    const metadata = skillMetadata(skill);
    const summary = version.trace_analysis_summary ? JSON.parse(version.trace_analysis_summary) : {};
    if (summary.lessonEvidence) {
      const links = metadata.lessonLinks || [];
      if (!links.some(link=>link.evidenceSet===summary.lessonEvidence.evidenceSet)) metadata.lessonLinks = [...links,summary.lessonEvidence];
    }
    metadata.skillforge = { ...metadata.skillforge, status: 'accepted', currentVersion: version.version,
      acceptance: { userId, versionId, contentHash: expectedHash, at: new Date().toISOString() } };
    // Canonical row is the publication boundary; compare both fields to reject concurrent edits.
    const changed = await run(`UPDATE skills SET instructions = ?, metadata = ?, updated_at = datetime('now')
      WHERE id = ? AND user_id = ? AND instructions = ? AND metadata = ?`,
      [version.instructions, JSON.stringify(metadata), skillId, userId, skill.instructions, skill.metadata]);
    if (!changed.changes) throw new Error('Skill changed during review; reload before accepting');
    await run(`UPDATE skill_versions SET status = CASE WHEN id = ? THEN 'active' ELSE 'superseded' END
      WHERE skill_id = ? AND user_id = ? AND (status = 'active' OR id = ?)
      AND EXISTS (SELECT 1 FROM skills WHERE id=? AND user_id=? AND json_extract(metadata,'$.skillforge.acceptance.versionId')=?)`, [versionId, skillId, userId, versionId, skillId, userId, versionId]);
    return { skillId, versionId, version: version.version, contentHash: expectedHash, status: 'accepted' };
  }
}
