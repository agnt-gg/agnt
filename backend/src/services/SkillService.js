import SkillModel from '../models/SkillModel.js';
import generateUUID from '../utils/generateUUID.js';

class SkillService {
  /**
   * Validate skill name per agentskills.io spec: lowercase, hyphens, max 64 chars
   */
  static validateName(name) {
    if (!name || typeof name !== 'string') return false;
    if (name.length > 64) return false;
    return /^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(name) || /^[a-z0-9]$/.test(name);
  }

  /**
   * Build XML-tagged prompt injection string from skills array
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
          // ignore parse errors
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

      if (!SkillService.validateName(skill.name)) {
        return res.status(400).json({
          error: 'Skill name must be lowercase, use hyphens, max 64 chars (e.g. "my-skill-name")',
        });
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

      if (skill.name && !SkillService.validateName(skill.name)) {
        return res.status(400).json({
          error: 'Skill name must be lowercase, use hyphens, max 64 chars',
        });
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

// Named export for static utility function
export const buildSkillsContext = SkillService.buildSkillsContext;

export default new SkillService();
