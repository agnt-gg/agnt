import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import SkillDiscoveryService from '../SkillDiscoveryService.js';
import { importSkillFromMd } from '../SkillService.js';
import { importAgent } from '../AgentImportService.js';
import AgentMemoryModel from '../../models/AgentMemoryModel.js';
import HarnessScanner from './HarnessScanner.js';

/**
 * Copy what another AI agent tool holds into AGNT's own storage.
 *
 * WHAT THIS DOES THAT DISCOVERY DOES NOT
 * --------------------------------------
 * SkillDiscoveryService already READS the other tools' skill directories, so
 * those skills work in AGNT untouched. This service makes them AGNT's: the
 * files are copied into `~/.agnt/skills/`, so uninstalling the tool they came
 * from no longer takes them away. Persona and memory have no equivalent in
 * discovery at all and are genuinely new records.
 *
 * EVERY STEP FAILS SOFT AND REPORTS.
 * A user importing five things and hitting one permission error should end up
 * with four things and one honest line about the fifth — not zero things and a
 * stack trace. Nothing here throws for a per-item failure; the failure goes in
 * the report and the loop continues.
 *
 * NOTHING IS EVER OVERWRITTEN. A name that already exists in AGNT is skipped
 * and said so. Imports are additive, so running one twice cannot destroy work
 * done between the two runs.
 */

const AGNT_SKILLS_DIR = () => path.join(os.homedir(), '.agnt', 'skills');

/** Files inside a skill directory that belong to the source tool, not the skill. */
const SKIP_ENTRIES = new Set(['.git', '.usage.json', '.usage.json.lock', 'node_modules']);

/** Guard rails on a recursive copy of a directory we did not write. */
const MAX_SKILL_FILES = 2000;
const MAX_SKILL_BYTES = 64 * 1024 * 1024;

/**
 * Copy a directory tree, refusing to write anywhere but under `destRoot`.
 *
 * A skill directory is third-party content, so a symlink inside it could point
 * at anything on disk. Resolving each destination and requiring it to stay
 * under the root means a hostile or merely careless link cannot make this
 * function write outside AGNT's skills folder.
 */
async function copyTree(srcDir, destDir, destRoot, budget) {
  const entries = await fs.readdir(srcDir, { withFileTypes: true });
  await fs.mkdir(destDir, { recursive: true });

  for (const entry of entries) {
    if (SKIP_ENTRIES.has(entry.name)) continue;

    const src = path.join(srcDir, entry.name);
    const dest = path.join(destDir, entry.name);

    const resolved = path.resolve(dest);
    if (resolved !== destRoot && !resolved.startsWith(destRoot + path.sep)) {
      throw new Error(`Refusing to write outside the skills directory: ${entry.name}`);
    }

    // Symlinks are followed for neither files nor directories: isDirectory()
    // and isFile() are false for a symlink entry, so links are simply not
    // copied. That is the intended behaviour, not an oversight.
    if (entry.isDirectory()) {
      await copyTree(src, dest, destRoot, budget);
      continue;
    }
    if (!entry.isFile()) continue;

    const stat = await fs.stat(src);
    budget.files += 1;
    budget.bytes += stat.size;
    if (budget.files > MAX_SKILL_FILES) throw new Error('Skill has too many files to import');
    if (budget.bytes > MAX_SKILL_BYTES) throw new Error('Skill is too large to import');

    await fs.copyFile(src, dest);
  }
}

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * Turn a harness persona into an AGNT agent.
 *
 * Provider and model are deliberately left empty. The source tool's model
 * string names an account AGNT may not have — pinning it would produce an
 * agent that cannot run. Empty means "use my configured provider", which is
 * the one setting we know is good, because onboarding just established it.
 */
function buildAgentPayload(source, personaText) {
  return {
    name: `${source.label} Agent`,
    description: `Imported from ${source.label} on this machine.`,
    icon: source.icon || 'agent',
    category: 'imported',
    systemPrompt: personaText,
    provider: '',
    model: '',
    status: 'ACTIVE',
  };
}

class HarnessImporter {
  /**
   * @param {object}   selection            what the user ticked
   * @param {string[]} selection.skills     harness ids to copy skills from
   * @param {string[]} selection.personas   harness ids to make an agent from
   * @param {string[]} selection.memories   harness ids to copy memories from
   * @param {string}   userId
   * @param {object}   [opts]
   * @param {object}   [opts.env]
   * @returns {Promise<{imported: object, items: object[], failures: object[]}>}
   */
  static async run(selection, userId, { env = process.env } = {}) {
    if (!userId) throw new Error('Import requires a userId');

    const wanted = {
      skills: new Set(selection?.skills || []),
      personas: new Set(selection?.personas || []),
      memories: new Set(selection?.memories || []),
    };

    const items = [];
    const failures = [];
    const imported = { skills: 0, agents: 0, memories: 0 };

    // Recomputed rather than trusted from the client: the payload arrives from
    // a browser, and the set of skills AGNT already has may have changed since
    // the page rendered. This is also what keeps a forged request from naming
    // a directory outside the harness list.
    const { sources } = await HarnessScanner.detect({ userId, env });

    for (const source of sources) {
      const readable = await HarnessScanner.read(source.id, { env });
      if (!readable) continue;

      // ── skills: files first, then the row that points at them ──
      if (wanted.skills.has(source.id) && source.skills.names.length > 0) {
        for (const name of source.skills.names) {
          const src = path.join(readable.skillsRoot, name);
          const destRoot = path.resolve(AGNT_SKILLS_DIR());
          const dest = path.join(destRoot, name);
          try {
            if (await exists(dest)) {
              items.push({ kind: 'skill', name, source: source.id, status: 'skipped',
                detail: 'already in AGNT' });
              continue;
            }
            await copyTree(src, dest, destRoot, { files: 0, bytes: 0 });

            // The row makes it selectable in the UI; the files make it work.
            // A copy without a row is invisible, so a failure here is a
            // failure of the whole item and the files are rolled back.
            try {
              const md = await fs.readFile(path.join(dest, 'SKILL.md'), 'utf8');
              await importSkillFromMd(md, userId);
            } catch (rowErr) {
              await fs.rm(dest, { recursive: true, force: true });
              throw rowErr;
            }

            imported.skills += 1;
            items.push({ kind: 'skill', name, source: source.id, status: 'imported' });
          } catch (err) {
            failures.push({ kind: 'skill', name, source: source.id,
              error: String(err?.message || err) });
          }
        }
      }

      // ── persona → agent ──
      let agentId = null;
      if (wanted.personas.has(source.id) && readable.persona) {
        try {
          const result = await importAgent(
            buildAgentPayload(source, readable.persona.text), userId
          );
          agentId = result.id;
          imported.agents += 1;
          items.push({ kind: 'agent', name: `${source.label} Agent`, source: source.id,
            status: 'imported', detail: readable.persona.origins.join(', ') });
        } catch (err) {
          failures.push({ kind: 'agent', name: `${source.label} Agent`, source: source.id,
            error: String(err?.message || err) });
        }
      }

      // ── memories ──
      if (wanted.memories.has(source.id) && readable.memories.length > 0) {
        // Memories hang off an agent. Without one from this run they go to the
        // orchestrator, which is the assistant the user is about to talk to —
        // the place they would expect their old notes to surface.
        const target = agentId || 'orchestrator';
        let written = 0;
        for (const memory of readable.memories) {
          try {
            // 'context' is the honest type for an imported note: it is
            // background the user did not state to AGNT directly. The model
            // de-duplicates by content, so re-running is safe.
            await AgentMemoryModel.create({
              agentId: target,
              userId,
              memoryType: 'context',
              content: memory.content,
            });
            written += 1;
          } catch (err) {
            failures.push({ kind: 'memory', name: memory.origin, source: source.id,
              error: String(err?.message || err) });
          }
        }
        if (written > 0) {
          imported.memories += written;
          items.push({ kind: 'memory', name: `${written} memories`, source: source.id,
            status: 'imported' });
        }
      }
    }

    // Newly copied directories are invisible to the catalog until it rescans.
    // Without this the user imports a skill and cannot find it until restart.
    if (imported.skills > 0) {
      try {
        await SkillDiscoveryService.discoverAll();
      } catch {
        // The files and rows are already written; a stale catalog is a
        // refresh away and must not turn a successful import into an error.
      }
    }

    return { imported, items, failures };
  }
}

export default HarnessImporter;
