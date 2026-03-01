import SkillModel from '../models/SkillModel.js';
import generateUUID from '../utils/generateUUID.js';

class SkillService {
  /**
   * Sanitize skill name: trim whitespace
   */
  static sanitizeName(name) {
    if (!name || typeof name !== 'string') return null;
    return name.trim() || null;
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

      const sanitizedName = SkillService.sanitizeName(skill.name);
      if (!sanitizedName) {
        return res.status(400).json({ error: 'Skill name must contain at least one letter or number' });
      }
      skill.name = sanitizedName;

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
   */
  async exportSkillMd(req, res) {
    try {
      const skill = await SkillModel.findById(req.params.id);
      if (!skill) return res.status(404).json({ error: 'Skill not found' });

      // Build YAML frontmatter
      const yamlLines = [];
      yamlLines.push(`name: "${skill.name}"`);
      if (skill.description) yamlLines.push(`description: "${skill.description.replace(/"/g, '\\"')}"`);
      if (skill.category) yamlLines.push(`category: "${skill.category}"`);
      if (skill.icon) yamlLines.push(`icon: "${skill.icon}"`);
      if (skill.license) yamlLines.push(`license: "${skill.license}"`);
      if (skill.compatibility) yamlLines.push(`compatibility: "${skill.compatibility}"`);
      if (skill.allowed_tools) {
        try {
          const tools = JSON.parse(skill.allowed_tools);
          if (Array.isArray(tools) && tools.length > 0) {
            yamlLines.push(`allowed-tools:`);
            tools.forEach((t) => yamlLines.push(`  - ${t}`));
          }
        } catch (e) {
          // If not JSON, treat as raw string
          if (skill.allowed_tools) yamlLines.push(`allowed-tools: "${skill.allowed_tools}"`);
        }
      }
      if (skill.metadata) {
        try {
          const meta = typeof skill.metadata === 'string' ? JSON.parse(skill.metadata) : skill.metadata;
          if (meta && typeof meta === 'object') {
            yamlLines.push(`metadata:`);
            Object.entries(meta).forEach(([k, v]) => yamlLines.push(`  ${k}: "${v}"`));
          }
        } catch (e) {
          // ignore
        }
      }

      const frontmatter = `---\n${yamlLines.join('\n')}\n---`;
      const body = skill.instructions || '';
      const content = `${frontmatter}\n\n${body}\n`;

      const filename = `${skill.name || 'skill'}.SKILL.md`;
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(content);
    } catch (error) {
      console.error('Error exporting skill:', error);
      res.status(500).json({ error: 'Failed to export skill' });
    }
  }

  /**
   * Import a skill from SKILL.md content (YAML frontmatter + markdown body)
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

      // Parse YAML frontmatter (between --- delimiters)
      const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
      if (!fmMatch) {
        return res.status(400).json({ error: 'Invalid SKILL.md format: missing YAML frontmatter (--- delimiters)' });
      }

      const yamlStr = fmMatch[1];
      const instructions = fmMatch[2].trim();

      // Simple YAML parser for flat key-value pairs and arrays
      const parsed = {};
      let currentKey = null;
      let currentArray = null;

      for (const line of yamlStr.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        // Array item
        if (trimmed.startsWith('- ') && currentKey) {
          if (!currentArray) currentArray = [];
          currentArray.push(trimmed.slice(2).replace(/^["']|["']$/g, ''));
          continue;
        }

        // Save previous array
        if (currentKey && currentArray) {
          parsed[currentKey] = currentArray;
          currentArray = null;
        }

        // Nested key (indented) for metadata
        if (line.startsWith('  ') && currentKey === 'metadata') {
          const nestedMatch = trimmed.match(/^(\w[\w-]*)\s*:\s*(.*)$/);
          if (nestedMatch) {
            if (!parsed.metadata) parsed.metadata = {};
            parsed.metadata[nestedMatch[1]] = nestedMatch[2].replace(/^["']|["']$/g, '');
          }
          continue;
        }

        // Top-level key: value
        const kvMatch = trimmed.match(/^([\w-]+)\s*:\s*(.*)$/);
        if (kvMatch) {
          currentKey = kvMatch[1];
          const val = kvMatch[2].replace(/^["']|["']$/g, '').trim();
          if (val) {
            parsed[currentKey] = val;
          }
        }
      }

      // Save trailing array
      if (currentKey && currentArray) {
        parsed[currentKey] = currentArray;
      }

      // Extract fields
      const name = parsed.name;
      if (!name) {
        return res.status(400).json({ error: 'SKILL.md must include a "name" field in frontmatter' });
      }

      const sanitizedName = SkillService.sanitizeName(name);
      if (!sanitizedName) {
        return res.status(400).json({ error: 'Skill name must contain at least one letter or number' });
      }

      const description = parsed.description || '';
      if (description.length > 1024) {
        return res.status(400).json({ error: 'Description must be 1024 characters or less' });
      }

      const skillData = {
        name: sanitizedName,
        description,
        instructions: instructions || '',
        category: parsed.category || 'general',
        icon: parsed.icon || 'fas fa-puzzle-piece',
        license: parsed.license || '',
        compatibility: parsed.compatibility || '',
        metadata: parsed.metadata ? JSON.stringify(parsed.metadata) : '',
        allowedTools: Array.isArray(parsed['allowed-tools']) ? JSON.stringify(parsed['allowed-tools']) : '',
      };

      const id = generateUUID();
      await SkillModel.createOrUpdate(id, skillData, userId);
      const created = await SkillModel.findById(id);
      res.status(201).json({ skill: created, skillId: id });
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

// Named export for static utility function
export const buildSkillsContext = SkillService.buildSkillsContext;

export default new SkillService();
