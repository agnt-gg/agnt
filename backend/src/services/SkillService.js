import SkillModel from '../models/SkillModel.js';
import generateUUID from '../utils/generateUUID.js';
import { parseSkillMd, serializeSkillMd, isValidSkillName, toKebabCase } from '../utils/skillValidation.js';

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
   * Only includes name + description for minimal token usage.
   * @param {Array<{name: string, description: string, source?: string}>} skills
   */
  static buildSkillCatalog(skills) {
    if (!skills || skills.length === 0) return '';

    const entries = skills
      .map((s) => `  <skill name="${s.name}" source="${s.source || 'database'}">\n    <description>${s.description || ''}</description>\n  </skill>`)
      .join('\n');

    return `<available-skills>\n${entries}\n</available-skills>`;
  }

  /**
   * Build behavioral instructions telling the LLM how to use the skill activation system.
   */
  static buildSkillActivationInstructions() {
    return `SKILL ACTIVATION INSTRUCTIONS:
You have skills available (listed above in <available-skills>). Skills provide specialized instructions for specific tasks.
- When a user's request matches a skill's description, call the activate_skill tool with the skill's name to load its full instructions.
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
      const skills = await SkillModel.findAll(userId);
      res.json({ skills });
    } catch (error) {
      console.error('Error fetching skills:', error);
      res.status(500).json({ error: 'Failed to fetch skills' });
    }
  }

  async getSkill(req, res) {
    try {
      const skill = await SkillModel.findById(req.params.id);
      if (!skill) return res.status(404).json({ error: 'Skill not found' });
      res.json({ skill });
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

      const existing = await SkillModel.findById(id);
      if (!existing) return res.status(404).json({ error: 'Skill not found' });

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
      const skill = await SkillModel.findById(req.params.id);
      if (!skill) return res.status(404).json({ error: 'Skill not found' });

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

      const parsed = parseSkillMd(content);

      // Check for fatal errors
      if (parsed.errors.length > 0 && !parsed.frontmatter.name) {
        return res.status(400).json({ error: `Invalid SKILL.md: ${parsed.errors.join('; ')}` });
      }

      const name = parsed.frontmatter.name;
      if (!name) {
        return res.status(400).json({ error: 'SKILL.md must include a "name" field in frontmatter' });
      }

      const sanitizedName = SkillService.sanitizeName(name);
      if (!sanitizedName) {
        return res.status(400).json({ error: 'Skill name must contain at least one letter or number' });
      }

      const description = parsed.frontmatter.description || '';
      if (description.length > 1024) {
        return res.status(400).json({ error: 'Description must be 1024 characters or less' });
      }

      const skillData = {
        name: sanitizedName,
        description,
        instructions: parsed.instructions || '',
        category: parsed.frontmatter.category || 'general',
        icon: parsed.frontmatter.icon || 'fas fa-puzzle-piece',
        license: parsed.frontmatter.license || '',
        compatibility: parsed.frontmatter.compatibility || '',
        metadata: parsed.frontmatter.metadata ? JSON.stringify(parsed.frontmatter.metadata) : '',
        allowedTools: parsed.frontmatter['allowed-tools'] || '',
      };

      const id = generateUUID();
      await SkillModel.createOrUpdate(id, skillData, userId);
      const created = await SkillModel.findById(id);
      res.status(201).json({ skill: created, skillId: id, warnings: parsed.warnings });
    } catch (error) {
      console.error('Error importing skill:', error);
      res.status(500).json({ error: 'Failed to import skill' });
    }
  }

  async deleteSkill(req, res) {
    try {
      const userId = req.user.userId;
      const { id } = req.params;
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
