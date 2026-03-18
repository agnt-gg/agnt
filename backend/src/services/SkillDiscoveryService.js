import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { parseSkillMd, isValidSkillName, toKebabCase } from '../utils/skillValidation.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Directories to skip during scanning
const SKIP_DIRS = new Set([
  '.git', 'node_modules', '.next', '.nuxt', 'dist', 'build', '__pycache__',
  '.venv', 'venv', '.cache', '.temp', '.tmp', 'coverage', '.nyc_output',
]);

const MAX_SCAN_DEPTH = 5;
const MAX_DIRECTORIES = 2000;

// All known agent skill client directories (project-level and user-level).
// The agentskills.io standard says each client scans its own dir + the cross-client .agents/ dir.
// We scan ALL of them so skills from any ecosystem work in AGNT.
const CLIENT_SKILL_DIRS = [
  '.agnt/skills',       // AGNT (us)
  '.claude/skills',     // Claude Code
  '.codex/skills',      // OpenAI Codex
  '.cursor/skills',     // Cursor
  '.windsurf/skills',   // Windsurf
  '.copilot/skills',    // VS Code / Copilot
  '.kilocode/skills',   // KiloCode
  '.github/skills',     // GitHub Copilot (project-level)
  '.agents/skills',     // Cross-client standard
];

/**
 * SkillDiscoveryService - Discovers Agent Skills from the filesystem
 * following the agentskills.io standard.
 *
 * Scans all known agent skill directories at both project and user level,
 * plus ancestor directories up to the git root for monorepo support.
 *
 * Priority order (highest → lowest):
 *   1. Project-level (all client dirs)
 *   2. Ancestor directories up to git root
 *   3. User-level ~/.agnt/skills/ (AGNT home — bootstrapped builtins live here)
 *   4. User-level (all other client dirs)
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
   * Auto-registers bootstrapped builtin skills into the database.
   * @param {string} [projectRoot] - Optional project/workspace root path
   */
  async init(projectRoot) {
    this.scanLocations = this._buildScanLocations(projectRoot);
    await this.discoverAll();
    this.initialized = true;
    console.log(`[SkillDiscovery] Initialized. Found ${this.skills.size} skills across ${this.scanLocations.length} scan locations.`);
  }

  /**
   * Build the ordered list of scan locations across all known ecosystems.
   */
  _buildScanLocations(projectRoot) {
    const locations = [];
    const homeDir = os.homedir();
    let priority = 0;

    // --- User-level: cross-client and other ecosystems (lowest priority) ---
    for (const dir of CLIENT_SKILL_DIRS) {
      // .agnt/skills gets higher user-level priority (it's our home)
      if (dir === '.agnt/skills') continue;
      locations.push({
        path: path.join(homeDir, dir),
        scope: 'user',
        client: dir.split('/')[0].replace('.', ''),
        priority: priority++,
        trusted: true,
      });
    }

    // AGNT user-level gets highest user-level priority (bootstrapped builtins live here)
    locations.push({
      path: path.join(homeDir, '.agnt', 'skills'),
      scope: 'user',
      client: 'agnt',
      priority: priority++,
      trusted: true,
    });

    // --- Ancestor directories (monorepo support) ---
    if (projectRoot) {
      const gitRoot = this._findGitRoot(projectRoot);
      const stopAt = gitRoot || path.parse(projectRoot).root;
      let current = path.dirname(projectRoot);

      while (current !== stopAt && current !== path.dirname(current)) {
        for (const dir of CLIENT_SKILL_DIRS) {
          locations.push({
            path: path.join(current, dir),
            scope: 'ancestor',
            client: dir.split('/')[0].replace('.', ''),
            priority: priority,
            trusted: false,
          });
        }
        priority++;
        current = path.dirname(current);
      }

      // --- Project-level: all ecosystems (highest priority) ---
      for (const dir of CLIENT_SKILL_DIRS) {
        locations.push({
          path: path.join(projectRoot, dir),
          scope: 'project',
          client: dir.split('/')[0].replace('.', ''),
          priority: priority,
          trusted: false,
        });
      }
      priority++;
    }

    return locations;
  }

  /**
   * Find the git root by walking up from startDir.
   */
  _findGitRoot(startDir) {
    let dir = startDir;
    while (dir !== path.dirname(dir)) {
      try {
        fsSync.accessSync(path.join(dir, '.git'));
        return dir;
      } catch { /* not here */ }
      dir = path.dirname(dir);
    }
    return null;
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

      // Scan in ascending priority order so higher-priority overwrites lower
      const sortedLocations = [...this.scanLocations].sort((a, b) => a.priority - b.priority);

      for (const location of sortedLocations) {
        if (totalDirsScanned >= MAX_DIRECTORIES) break;

        try {
          await fs.access(location.path);
        } catch {
          continue;
        }

        const skills = await this._scanDirectory(location.path, location, 0, totalDirsScanned);
        totalDirsScanned += skills.dirsScanned;

        for (const skill of skills.found) {
          const existing = discovered.get(skill.name);
          if (existing) {
            if (skill.priority > existing.priority) {
              discovered.set(skill.name, skill);
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

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (SKIP_DIRS.has(entry.name)) continue;
      if (entry.name.startsWith('.')) continue; // Skip hidden dirs inside skill locations
      if (globalDirCount + result.dirsScanned >= MAX_DIRECTORIES) break;

      result.dirsScanned++;
      const subDir = path.join(dirPath, entry.name);

      // Check if this directory contains SKILL.md
      try {
        const skillMdPath = path.join(subDir, 'SKILL.md');
        await fs.access(skillMdPath);

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
   * Parse a skill directory containing SKILL.md.
   */
  async _parseSkillDirectory(dirPath, skillMdPath, location) {
    try {
      const content = await fs.readFile(skillMdPath, 'utf-8');
      const parsed = parseSkillMd(content);

      if (parsed.errors.length > 0) {
        console.warn(`[SkillDiscovery] Errors parsing ${skillMdPath}:`, parsed.errors);
        if (!parsed.frontmatter.description) {
          return null;
        }
      }

      // Use directory name as fallback for name (spec: name must match dir name)
      const dirName = path.basename(dirPath);
      const name = parsed.frontmatter.name || dirName;

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
   * Returns name + description for ALL discovered skills.
   */
  getSkillCatalog() {
    return Array.from(this.skills.values())
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
