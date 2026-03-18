import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { parseSkillMd, isValidSkillName } from '../utils/skillValidation.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Directories to skip during scanning
const SKIP_DIRS = new Set([
  '.git', 'node_modules', '.next', '.nuxt', 'dist', 'build', '__pycache__',
  '.venv', 'venv', '.cache', '.temp', '.tmp', 'coverage', '.nyc_output',
]);

const MAX_SCAN_DEPTH = 5;
const MAX_DIRECTORIES = 2000;

/**
 * SkillDiscoveryService - Discovers Agent Skills from the filesystem
 * following the agentskills.io standard.
 *
 * Scan locations (priority order, highest first):
 *   1. Project-level client-specific: <project>/.agnt/skills/
 *   2. Project-level cross-client:    <project>/.agents/skills/
 *   3. User-level client-specific:    ~/.agnt/skills/
 *   4. User-level cross-client:       ~/.agents/skills/
 */
class SkillDiscoveryService {
  constructor() {
    /** @type {Map<string, DiscoveredSkill>} */
    this.skills = new Map();
    this.scanLocations = [];
    this.isScanning = false;
    this.lastScanTime = null;
    this.initialized = false;
  }

  /**
   * Initialize scan locations and run initial discovery.
   * Auto-registers builtin skills into the database.
   * @param {string} [projectRoot] - Optional project/workspace root path
   */
  async init(projectRoot) {
    this.scanLocations = this._buildScanLocations(projectRoot);
    await this.discoverAll();
    this.initialized = true;
    console.log(`[SkillDiscovery] Initialized. Found ${this.skills.size} skills from filesystem.`);

    // Auto-register builtin skills into the database
    await this._autoRegisterBuiltinSkills();
  }

  /**
   * Build the ordered list of scan locations.
   */
  _buildScanLocations(projectRoot) {
    const locations = [];
    const homeDir = os.homedir();

    if (projectRoot) {
      // Project-level (higher priority)
      locations.push({
        path: path.join(projectRoot, '.agnt', 'skills'),
        scope: 'project',
        client: 'agnt',
        priority: 4,
        trusted: false, // Project-level skills may be untrusted (from cloned repos)
      });
      locations.push({
        path: path.join(projectRoot, '.agents', 'skills'),
        scope: 'project',
        client: 'cross-client',
        priority: 3,
        trusted: false,
      });
    }

    // User-level (lower priority)
    locations.push({
      path: path.join(homeDir, '.agnt', 'skills'),
      scope: 'user',
      client: 'agnt',
      priority: 2,
      trusted: true,
    });
    locations.push({
      path: path.join(homeDir, '.agents', 'skills'),
      scope: 'user',
      client: 'cross-client',
      priority: 1,
      trusted: true,
    });

    // Builtin skills bundled with AGNT (lowest priority — user/project skills override)
    const builtinSkillsPath = path.resolve(__dirname, '../../skills');
    locations.push({
      path: builtinSkillsPath,
      scope: 'builtin',
      client: 'agnt',
      priority: 0,
      trusted: true,
      looseFiles: true, // Scan loose .md files, not just SKILL.md in subdirs
    });

    return locations;
  }

  /**
   * Scan all locations and discover skills.
   * Higher-priority locations override lower-priority ones on name collision.
   */
  async discoverAll() {
    if (this.isScanning) return;
    this.isScanning = true;

    try {
      const discovered = new Map();
      let totalDirsScanned = 0;

      // Scan in reverse priority order so higher-priority overwrites lower
      const sortedLocations = [...this.scanLocations].sort((a, b) => a.priority - b.priority);

      for (const location of sortedLocations) {
        if (totalDirsScanned >= MAX_DIRECTORIES) break;

        try {
          await fs.access(location.path);
        } catch {
          // Directory doesn't exist, skip
          continue;
        }

        const skills = await this._scanDirectory(location.path, location, 0, totalDirsScanned);
        totalDirsScanned += skills.dirsScanned;

        for (const skill of skills.found) {
          const existing = discovered.get(skill.name);
          if (existing) {
            // Higher priority wins
            if (skill.priority > existing.priority) {
              console.log(`[SkillDiscovery] Skill "${skill.name}" from ${skill.scope}/${skill.client} overrides ${existing.scope}/${existing.client}`);
              discovered.set(skill.name, skill);
            } else {
              console.log(`[SkillDiscovery] Skill "${skill.name}" collision: keeping ${existing.scope}/${existing.client} over ${skill.scope}/${skill.client}`);
            }
          } else {
            discovered.set(skill.name, skill);
          }
        }
      }

      this.skills = discovered;
      this.lastScanTime = new Date().toISOString();
      console.log(`[SkillDiscovery] Scan complete. ${discovered.size} skills found, ${totalDirsScanned} directories scanned.`);
    } finally {
      this.isScanning = false;
    }
  }

  /**
   * Recursively scan a directory for skills (subdirectories containing SKILL.md).
   * Also picks up loose .md files if the location has looseFiles enabled.
   */
  async _scanDirectory(dirPath, location, depth, globalDirCount) {
    const result = { found: [], dirsScanned: 0 };

    if (depth > MAX_SCAN_DEPTH || globalDirCount + result.dirsScanned >= MAX_DIRECTORIES) {
      return result;
    }

    let entries;
    try {
      entries = await fs.readdir(dirPath, { withFileTypes: true });
    } catch {
      return result;
    }

    // Scan loose .md files in this directory (for builtin skills)
    if (location.looseFiles && depth === 0) {
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        if (!entry.name.endsWith('.md')) continue;

        const filePath = path.join(dirPath, entry.name);
        const skill = await this._parseLooseSkillFile(filePath, location);
        if (skill) {
          result.found.push(skill);
        }
      }
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (SKIP_DIRS.has(entry.name)) continue;
      if (globalDirCount + result.dirsScanned >= MAX_DIRECTORIES) break;

      result.dirsScanned++;
      const subDir = path.join(dirPath, entry.name);

      // Check if this directory contains SKILL.md
      try {
        const skillMdPath = path.join(subDir, 'SKILL.md');
        await fs.access(skillMdPath);

        // Found a skill directory - parse it
        const skill = await this._parseSkillDirectory(subDir, skillMdPath, location);
        if (skill) {
          result.found.push(skill);
        }
      } catch {
        // No SKILL.md here, scan deeper
        const sub = await this._scanDirectory(subDir, location, depth + 1, globalDirCount + result.dirsScanned);
        result.found.push(...sub.found);
        result.dirsScanned += sub.dirsScanned;
      }
    }

    return result;
  }

  /**
   * Parse a loose .md or SKILL.md skill file using the shared parser.
   * Supports both YAML frontmatter (agentskills.io) and loose markdown formats.
   */
  async _parseLooseSkillFile(filePath, location) {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const parsed = parseSkillMd(content);

      const name = parsed.frontmatter.name || path.basename(filePath, '.md').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const displayName = parsed.frontmatter.displayName || name;

      if (!parsed.frontmatter.description) {
        console.warn(`[SkillDiscovery] Skipping ${filePath}: no description found`);
        return null;
      }

      return {
        name,
        displayName,
        description: parsed.frontmatter.description,
        instructions: parsed.instructions,
        frontmatter: parsed.frontmatter,
        dirPath: path.dirname(filePath),
        skillMdPath: filePath,
        scope: location.scope,
        client: location.client,
        priority: location.priority,
        trusted: location.trusted,
        validName: isValidSkillName(name),
        discoveredAt: new Date().toISOString(),
      };
    } catch (error) {
      console.error(`[SkillDiscovery] Failed to parse skill file ${filePath}:`, error.message);
      return null;
    }
  }

  /**
   * Parse a skill directory containing SKILL.md.
   */
  async _parseSkillDirectory(dirPath, skillMdPath, location) {
    try {
      const content = await fs.readFile(skillMdPath, 'utf-8');
      const parsed = parseSkillMd(content);

      if (parsed.errors.length > 0) {
        console.warn(`[SkillDiscovery] Errors parsing ${skillMdPath}:`, parsed.errors);
        // If description is missing, skip (essential for catalog)
        if (!parsed.frontmatter.description) {
          return null;
        }
      }

      if (parsed.warnings.length > 0) {
        console.warn(`[SkillDiscovery] Warnings for ${skillMdPath}:`, parsed.warnings);
      }

      // Use directory name as fallback for name
      const dirName = path.basename(dirPath);
      const name = parsed.frontmatter.name || dirName;

      // Check if name matches directory name (spec requirement)
      if (parsed.frontmatter.name && parsed.frontmatter.name !== dirName) {
        console.warn(`[SkillDiscovery] Skill name "${parsed.frontmatter.name}" doesn't match directory "${dirName}" at ${dirPath}`);
      }

      return {
        name,
        displayName: parsed.frontmatter.displayName || name,
        description: parsed.frontmatter.description || '',
        instructions: parsed.instructions,
        frontmatter: parsed.frontmatter,
        dirPath,
        skillMdPath,
        scope: location.scope,
        client: location.client,
        priority: location.priority,
        trusted: location.trusted,
        validName: isValidSkillName(name),
        discoveredAt: new Date().toISOString(),
      };
    } catch (error) {
      console.error(`[SkillDiscovery] Failed to parse ${skillMdPath}:`, error.message);
      return null;
    }
  }

  /**
   * Get the compact catalog for progressive disclosure (Tier 1).
   * Returns name + description only.
   */
  getSkillCatalog() {
    return Array.from(this.skills.values())
      .filter((skill) => skill.scope !== 'builtin') // Builtins are auto-registered in DB
      .map((skill) => ({
        name: skill.name,
        description: skill.description,
        source: 'filesystem',
        scope: skill.scope,
        client: skill.client,
        trusted: skill.trusted,
      }));
  }

  /**
   * Get full skill content for activation (Tier 2).
   */
  getSkillContent(name) {
    const skill = this.skills.get(name);
    if (!skill) return null;

    return {
      name: skill.name,
      description: skill.description,
      instructions: skill.instructions,
      frontmatter: skill.frontmatter,
      dirPath: skill.dirPath,
      trusted: skill.trusted,
    };
  }

  /**
   * Get full discovered skill object.
   */
  getSkill(name) {
    return this.skills.get(name) || null;
  }

  /**
   * List bundled resources (scripts/, references/, assets/) for a skill.
   */
  async listResources(name) {
    const skill = this.skills.get(name);
    if (!skill) return null;

    const resources = { scripts: [], references: [], assets: [], other: [] };
    const resourceDirs = ['scripts', 'references', 'assets'];

    for (const dir of resourceDirs) {
      const dirPath = path.join(skill.dirPath, dir);
      try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isFile()) {
            resources[dir].push({
              name: entry.name,
              path: path.join(dir, entry.name),
              absolutePath: path.join(dirPath, entry.name),
            });
          }
        }
      } catch {
        // Directory doesn't exist, skip
      }
    }

    // Also list any other files in the skill root (besides SKILL.md)
    try {
      const rootEntries = await fs.readdir(skill.dirPath, { withFileTypes: true });
      for (const entry of rootEntries) {
        if (entry.isFile() && entry.name !== 'SKILL.md') {
          resources.other.push({
            name: entry.name,
            path: entry.name,
            absolutePath: path.join(skill.dirPath, entry.name),
          });
        }
      }
    } catch {
      // Ignore errors
    }

    return resources;
  }

  /**
   * Read a specific resource file from a skill.
   */
  async readResource(skillName, resourcePath) {
    const skill = this.skills.get(skillName);
    if (!skill) return null;

    // Security: ensure the resolved path is within the skill directory
    const fullPath = path.resolve(skill.dirPath, resourcePath);
    if (!fullPath.startsWith(path.resolve(skill.dirPath))) {
      throw new Error('Resource path escapes skill directory');
    }

    try {
      return await fs.readFile(fullPath, 'utf-8');
    } catch {
      return null;
    }
  }

  /**
   * Check if a skill is from a project-level directory.
   */
  isProjectLevel(name) {
    const skill = this.skills.get(name);
    return skill ? skill.scope === 'project' : false;
  }

  /**
   * Auto-register builtin skills into the database so they appear in the UI.
   * Uses is_builtin=1 and a deterministic ID to prevent duplicates.
   */
  async _autoRegisterBuiltinSkills() {
    const builtinSkills = Array.from(this.skills.values()).filter((s) => s.scope === 'builtin');
    if (builtinSkills.length === 0) return;

    try {
      const { default: SkillModel } = await import('../models/SkillModel.js');
      let registered = 0;

      for (const skill of builtinSkills) {
        // Deterministic ID so re-runs update instead of duplicate
        const id = `builtin-${skill.name}`;

        try {
          const existing = await SkillModel.findById(id);
          if (existing) {
            // Fix icon if it was set to an emoji (not a valid CSS class)
            if (existing.icon && !existing.icon.startsWith('fa')) {
              await SkillModel.createOrUpdate(id, { ...existing, icon: 'fas fa-puzzle-piece', isBuiltin: 1 }, existing.user_id || 'system');
            }
            continue;
          }

          await SkillModel.createOrUpdate(id, {
            name: skill.displayName || skill.name,
            description: skill.description,
            instructions: skill.instructions || '',
            license: skill.frontmatter?.license || '',
            compatibility: skill.frontmatter?.compatibility || '',
            metadata: JSON.stringify(skill.frontmatter?.metadata || {}),
            allowedTools: JSON.stringify(skill.frontmatter?.['allowed-tools'] || []),
            icon: 'fas fa-puzzle-piece',
            category: skill.frontmatter?.metadata?.category || 'general',
            isBuiltin: 1,
          }, 'system');
          registered++;
        } catch (err) {
          console.warn(`[SkillDiscovery] Failed to register builtin skill "${skill.name}":`, err.message);
        }
      }

      if (registered > 0) {
        console.log(`[SkillDiscovery] Auto-registered ${registered} builtin skills into database.`);
      }
    } catch (error) {
      console.warn('[SkillDiscovery] Auto-registration failed (non-fatal):', error.message);
    }
  }

  /**
   * Update the project root and re-scan (e.g., when workspace changes).
   */
  async setProjectRoot(projectRoot) {
    this.scanLocations = this._buildScanLocations(projectRoot);
    await this.discoverAll();
  }

  /**
   * Get all scan location paths (for debugging/UI).
   */
  getScanLocations() {
    return this.scanLocations.map((loc) => ({
      path: loc.path,
      scope: loc.scope,
      client: loc.client,
      priority: loc.priority,
    }));
  }
}

console.log('Skill Discovery Service Started...');

export default new SkillDiscoveryService();
