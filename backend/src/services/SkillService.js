import SkillModel from '../models/SkillModel.js';
import db from '../models/database/index.js';
import generateUUID from '../utils/generateUUID.js';
import { parseSkillMd, serializeSkillMd, isValidSkillName, toKebabCase } from '../utils/skillValidation.js';
import { skillCatalogGist } from '../utils/skillCatalogGist.js';
import { extractRelations, filterSupersededEntries } from '../utils/skillRelations.js';

/**
 * PRD-057: Programmatic skill import from SKILL.md text.
 * Shared by the SkillRoutes.importSkillMd HTTP handler and PluginAssetLoader.
 *
 * @param {string} content      raw SKILL.md text (frontmatter + body)
 * @param {string} userId       importing user ID
 * @param {object} [options]
 * @param {string} [options.sourcePlugin]  plugin name when invoked by plugin loader
 * @param {string} [options.slugOverride]  force a particular slug (for plugin-namespacing)
 * @returns {Promise<{ id: string, slug: string, warnings: string[] }>}
 */
export async function importSkillFromMd(content, userId, options = {}) {
  if (!content || typeof content !== 'string') {
    throw new Error('importSkillFromMd requires SKILL.md text');
  }
  if (!userId) throw new Error('importSkillFromMd requires a userId');

  const parsed = parseSkillMd(content);
  if (parsed.errors.length > 0 && !parsed.frontmatter.name) {
    throw new Error(`Invalid SKILL.md: ${parsed.errors.join('; ')}`);
  }

  const name = parsed.frontmatter.name;
  if (!name) throw new Error('SKILL.md must include a "name" field in frontmatter');

  const sanitizedName = (name || '').trim();
  if (!sanitizedName) throw new Error('Skill name must contain at least one letter or number');

  const description = parsed.frontmatter.description || '';
  if (description.length > 1024) throw new Error('Description must be 1024 characters or less');

  const displayName = parsed.frontmatter.displayName || sanitizedName;
  const slug = options.slugOverride || sanitizedName;

  const skillData = {
    name: displayName,
    slug,
    description,
    instructions: parsed.instructions || '',
    category: parsed.frontmatter.category || 'general',
    icon: parsed.frontmatter.icon || 'fas fa-puzzle-piece',
    license: parsed.frontmatter.license || '',
    compatibility: parsed.frontmatter.compatibility || '',
    metadata: parsed.frontmatter.metadata || {},
    allowedTools: parsed.frontmatter['allowed-tools'] || [],
  };

  const id = generateUUID();
  await SkillModel.createOrUpdate(id, skillData, userId);

  if (options.sourcePlugin) {
    await new Promise((resolve, reject) => {
      db.run(
        `UPDATE skills SET source_plugin = ?, is_user_modified = 0 WHERE id = ?`,
        [options.sourcePlugin, id],
        (err) => (err ? reject(err) : resolve())
      );
    });
  }

  return { id, slug, warnings: parsed.warnings || [] };
}

class SkillService {
  /**
   * Sanitize skill name: trim whitespace
   */
  static sanitizeName(name) {
    if (!name || typeof name !== 'string') return null;
    return name.trim() || null;
  }

  /**
   * Build a compact XML catalog of available skills (Tier 1 - progressive disclosure).
   * One line per skill: "- name: gist". Full descriptions cost >13k tokens
   * at ~100 skills; the gist keeps just enough trigger signal
   * (activate_skill returns the full playbook).
   *
   * Relationship-aware (metadata.relations):
   * - Skills superseded by another skill PRESENT in the catalog are omitted
   *   (token saving; steers the model to the successor).
   * - depends-on relations surface as a "[needs: ...]" suffix so the model
   *   activates prerequisites in one shot.
   * @param {Array<{name: string, description: string, source?: string, metadata?: object|string}>} skills
   */
  static buildSkillCatalog(skills) {
    if (!skills || skills.length === 0) return '';

    const { entries: visible } = filterSupersededEntries(skills);
    if (visible.length === 0) return '';

    const entries = visible
      .map((s) => {
        const { dependsOn } = extractRelations(s.metadata);
        const needs = dependsOn.length > 0 ? ` [needs: ${dependsOn.join(', ')}]` : '';
        return `- ${s.name}: ${skillCatalogGist(s.description)}${needs}`;
      })
      .join('\n');

    return `<available-skills>\n${entries}\n</available-skills>`;
  }

  /**
   * Build behavioral instructions telling the LLM how to use the skill activation system.
   */
  static buildSkillActivationInstructions() {
    return `SKILL ACTIVATION INSTRUCTIONS:
You have skills available (listed above in <available-skills> as one-line gists). Each line is an abbreviated summary - a skill's full playbook loads only when activated.
- When a user's request plausibly matches a skill's gist, call the activate_skill tool with the skill's name to load its full instructions. Activation is cheap - if unsure whether a skill applies, activate it and check rather than guessing.
- Only activate skills that are relevant to the current task.
- Once activated, follow the skill's instructions carefully.
- You can activate multiple skills if needed for a complex task.
- Skills may include bundled scripts and reference files — use your file-reading capabilities to access them when the skill instructions reference them.`;
  }

  /**
   * Build XML-tagged prompt injection string from activated skills (Tier 2).
   * Used for skills that have been explicitly activated by the LLM or statically assigned.
   */
  static buildSkillsContext(skills) {
    if (!skills || skills.length === 0) return '';

    const skillBlocks = skills.map((skill) => {
      const parts = [`<skill name="${skill.name}">`];
      if (skill.description) parts.push(`  <description>${skill.description}</description>`);
      if (skill.instructions) parts.push(`  <instructions>${skill.instructions}</instructions>`);
      if (skill.allowed_tools) {
        try {
          const tools = JSON.parse(skill.allowed_tools);
          if (Array.isArray(tools) && tools.length > 0) {
            parts.push(`  <allowed-tools>${tools.join(', ')}</allowed-tools>`);
          }
        } catch (e) {
          // Could be space-delimited string per Agent Skills spec
          if (typeof skill.allowed_tools === 'string' && skill.allowed_tools.trim()) {
            parts.push(`  <allowed-tools>${skill.allowed_tools}</allowed-tools>`);
          }
        }
      }
      parts.push('</skill>');
      return parts.join('\n');
    });

    return `ASSIGNED SKILLS:
<skills>
${skillBlocks.join('\n\n')}
</skills>

You have the above skills assigned. Follow the instructions defined in each skill when relevant to the user's request.`;
  }

  async getAllSkills(req, res) {
    try {
      const userId = req.user.userId;
      const dbSkills = await SkillModel.findAll(userId);

      // Merge filesystem-discovered skills so the UI sees everything
      let filesystemSkills = [];
      try {
        const { default: SkillDiscoveryService } = await import('./SkillDiscoveryService.js');
        if (SkillDiscoveryService.initialized) {
          const dbSlugs = new Set(dbSkills.map((s) => s.slug).filter(Boolean));
          filesystemSkills = Array.from(SkillDiscoveryService.skills.values())
            .filter((s) => !dbSlugs.has(s.name)) // Don't duplicate DB skills
            .map((s) => ({
              id: `fs-${s.name}`,
              name: s.displayName || s.name,
              slug: s.name,
              description: s.description || '',
              instructions: s.instructions || '',
              icon: 'fas fa-puzzle-piece',
              category: s.frontmatter?.metadata?.category || 'general',
              is_builtin: 0,
              is_filesystem: 1,
              scope: s.scope,
              client: s.client,
              trusted: s.trusted,
              dir_path: s.dirPath,
            }));
        }
      } catch {
        // Discovery not available
      }

      res.json({ skills: [...dbSkills, ...filesystemSkills] });
    } catch (error) {
      console.error('Error fetching skills:', error);
      res.status(500).json({ error: 'Failed to fetch skills' });
    }
  }

  /**
   * Fetch a skill and decide whether this requester may act on it.
   *
   * SkillModel.findAll already states the ownership rule in SQL —
   * `WHERE user_id = ? OR is_builtin = 1` — so the list endpoint has always
   * been scoped. The by-id routes reached for findById (`WHERE id = ?`) and
   * never compared the owner to the caller, so the rule was declared in one
   * query and ignored in four handlers. This applies the rule findAll already
   * declares; it does not invent a new policy.
   *
   * The check lives here rather than in findById because eight internal callers
   * legitimately fetch a skill by id with no requester in scope at all
   * (OrchestratorService, SkillEvolver x3, chatConfigs, PluginBundler,
   * EvalDatasetService, ExperimentService). Scoping the model method would
   * break every one of them.
   *
   * Reads honour the built-in exception exactly as findAll grants it — a skill
   * that is listable must not be unreadable. Writes do not: a row everyone can
   * see must not be a row anyone can edit, or one user's change silently
   * rewrites what every other user sees.
   *
   * 404 and 403 are kept distinct, matching AgentRoutes' export check and
   * ContractRoutes: absent and forbidden are different answers.
   */
  static async _authorize(id, userId, { write = false } = {}) {
    const skill = await SkillModel.findById(id);
    if (!skill) return { ok: false, status: 404, error: 'Skill not found' };
    if (skill.user_id === userId) return { ok: true, skill };
    if (!write && skill.is_builtin) return { ok: true, skill };
    return {
      ok: false,
      status: 403,
      error: write
        ? 'You do not have permission to modify this skill'
        : 'You do not have permission to view this skill',
    };
  }

  async getSkill(req, res) {
    try {
      const auth = await SkillService._authorize(req.params.id, req.user.userId);
      if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
      res.json({ skill: auth.skill });
    } catch (error) {
      console.error('Error fetching skill:', error);
      res.status(500).json({ error: 'Failed to fetch skill' });
    }
  }

  async createSkill(req, res) {
    try {
      const userId = req.user.userId;
      const { skill } = req.body;
      if (!skill || !skill.name || !skill.description) {
        return res.status(400).json({ error: 'name and description are required' });
      }

      const sanitizedName = SkillService.sanitizeName(skill.name);
      if (!sanitizedName) {
        return res.status(400).json({ error: 'Skill name must contain at least one letter or number' });
      }
      skill.name = sanitizedName;

      // Warn if name doesn't conform to Agent Skills spec (but don't reject)
      if (!isValidSkillName(sanitizedName)) {
        console.warn(`[SkillService] Skill name "${sanitizedName}" does not conform to Agent Skills spec (kebab-case, 1-64 chars)`);
      }

      const id = generateUUID();
      await SkillModel.createOrUpdate(id, skill, userId);
      const created = await SkillModel.findById(id);
      res.status(201).json({ skill: created, skillId: id });
    } catch (error) {
      console.error('Error creating skill:', error);
      res.status(500).json({ error: 'Failed to create skill' });
    }
  }

  async updateSkill(req, res) {
    try {
      const userId = req.user.userId;
      const { id } = req.params;
      const { skill } = req.body;

      // Before anything else, including the PRD-057 stamp below: a refused
      // request must leave no trace on the row at all.
      const auth = await SkillService._authorize(id, userId, { write: true });
      if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
      const existing = auth.skill;

      // A malformed body is the caller's mistake, not a server fault. Without
      // this, `skill.name` below threw a TypeError into the catch and the route
      // answered 500 — which hides a client error among real failures. createSkill
      // already guards exactly this; updateSkill did not.
      //
      // Placed after authorisation, so a stranger learns nothing about their
      // payload for a row they cannot touch, and before the PRD-057 stamp, so a
      // rejected request still leaves no trace on the row.
      if (!skill || typeof skill !== 'object' || Array.isArray(skill)) {
        return res.status(400).json({ error: 'Request body must contain a skill object' });
      }

      // PRD-057: mark plugin-installed skills as user-modified on UI updates
      if (existing.source_plugin) {
        await new Promise((resolve) => {
          db.run(`UPDATE skills SET is_user_modified = 1 WHERE id = ?`, [id], () => resolve());
        });
      }

      if (skill.name) {
        const sanitizedName = SkillService.sanitizeName(skill.name);
        if (!sanitizedName) {
          return res.status(400).json({ error: 'Skill name must contain at least one letter or number' });
        }
        skill.name = sanitizedName;
      }

      const merged = {
        name: skill.name || existing.name,
        description: skill.description || existing.description,
        instructions: skill.instructions !== undefined ? skill.instructions : existing.instructions,
        license: skill.license !== undefined ? skill.license : existing.license,
        compatibility: skill.compatibility !== undefined ? skill.compatibility : existing.compatibility,
        metadata: skill.metadata !== undefined ? skill.metadata : existing.metadata,
        allowedTools: skill.allowedTools !== undefined ? skill.allowedTools : existing.allowed_tools,
        icon: skill.icon !== undefined ? skill.icon : existing.icon,
        category: skill.category !== undefined ? skill.category : existing.category,
      };

      await SkillModel.createOrUpdate(id, merged, userId);
      const updated = await SkillModel.findById(id);
      res.json({ skill: updated });
    } catch (error) {
      console.error('Error updating skill:', error);
      res.status(500).json({ error: 'Failed to update skill' });
    }
  }

  /**
   * Export a skill as SKILL.md (YAML frontmatter + markdown body)
   * Uses the shared serializeSkillMd utility for Agent Skills spec compliance.
   */
  async exportSkillMd(req, res) {
    try {
      const auth = await SkillService._authorize(req.params.id, req.user.userId);
      if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
      const skill = auth.skill;

      const content = serializeSkillMd(skill);

      // Use kebab-case directory name per spec
      const dirName = isValidSkillName(skill.name) ? skill.name : toKebabCase(skill.name) || 'skill';
      const filename = `${dirName}.SKILL.md`;
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(content);
    } catch (error) {
      console.error('Error exporting skill:', error);
      res.status(500).json({ error: 'Failed to export skill' });
    }
  }

  /**
   * Import a skill from SKILL.md content (YAML frontmatter + markdown body).
   * Uses the shared parseSkillMd utility for Agent Skills spec compliance.
   */
  async importSkillMd(req, res) {
    try {
      const userId = req.user.userId;

      // Accept raw text or JSON { content: "..." }
      let content = '';
      if (typeof req.body === 'string') {
        content = req.body;
      } else if (req.body && req.body.content) {
        content = req.body.content;
      } else {
        return res.status(400).json({ error: 'Request body must contain SKILL.md content' });
      }

      const result = await importSkillFromMd(content, userId);
      const created = await SkillModel.findById(result.id);
      res.status(201).json({ skill: created, skillId: result.id, warnings: result.warnings });
    } catch (error) {
      console.error('Error importing skill:', error);
      res.status(400).json({ error: error.message || 'Failed to import skill' });
    }
  }

  async deleteSkill(req, res) {
    try {
      const userId = req.user.userId;
      const { id } = req.params;
      // SkillModel.delete is scoped too — this is deliberate belt-and-braces.
      // The check here is what makes a stranger's delete answer 403; the scope
      // in the model is what protects every other caller of that method.
      const auth = await SkillService._authorize(id, userId, { write: true });
      if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

      const changes = await SkillModel.delete(id, userId);
      if (changes === 0) return res.status(404).json({ error: 'Skill not found' });
      res.json({ message: 'Skill deleted' });
    } catch (error) {
      console.error('Error deleting skill:', error);
      res.status(500).json({ error: 'Failed to delete skill' });
    }
  }
}

console.log('Skill Service Started...');

// Named exports for static utility functions
export const buildSkillsContext = SkillService.buildSkillsContext;
export const buildSkillCatalog = SkillService.buildSkillCatalog;
export const buildSkillActivationInstructions = SkillService.buildSkillActivationInstructions;

export default new SkillService();
