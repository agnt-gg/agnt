import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import SkillDiscoveryService from '../SkillDiscoveryService.js';
import SkillModel from '../../models/SkillModel.js';
import { HARNESSES, looksLikeTemplate, resolveReadRoot, splitMemories } from './harnesses.js';

/**
 * What can be brought over from the other AI agent tools on this machine.
 *
 * READ-ONLY, AND FAST. This runs during onboarding, where it is one of several
 * things racing to answer before the user clicks Continue. It opens no
 * databases, walks no session directories, and reads only files it will report
 * on. Everything is bounded by the harness list, so cost is a function of how
 * many tools are installed rather than how much history they hold.
 *
 * WHY SKILLS ARE COUNTED, NOT LISTED AS "MISSING"
 * -----------------------------------------------
 * SkillDiscoveryService already scans every one of these tools' skill
 * directories, so a user's skills are USABLE IN AGNT THE MOMENT THEY LAUNCH IT,
 * with nothing imported. The honest thing to tell them is that it already
 * works. What discovery cannot do is make a skill *theirs*: it reads the file
 * in the other tool's directory, so uninstalling that tool takes the skill with
 * it. Copying into AGNT's own skills directory is the only part that is
 * genuinely an import, and it is the only part offered as one.
 */

/** Files we will read in full. Anything larger is reported but not parsed. */
const MAX_READ_BYTES = 256 * 1024;

async function statSafe(target) {
  try {
    return await fs.stat(target);
  } catch {
    return null;
  }
}

async function readTextSafe(target) {
  const stat = await statSafe(target);
  if (!stat || !stat.isFile() || stat.size === 0) return null;
  if (stat.size > MAX_READ_BYTES) return null;
  try {
    return await fs.readFile(target, 'utf8');
  } catch {
    // Locked, permission-denied, or vanished between stat and read. A file we
    // cannot read is a file we cannot offer — never a reason to fail the scan.
    return null;
  }
}

/** Directory names directly under `<home>/skills` that hold a SKILL.md. */
async function listSkillDirs(skillsRoot) {
  let entries;
  try {
    entries = await fs.readdir(skillsRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const found = [];
  for (const entry of entries) {
    // Leading dots are the convention for a tool's own bookkeeping
    // (`.system`, `.usage.json`) rather than a user's skill.
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const stat = await statSafe(path.join(skillsRoot, entry.name, 'SKILL.md'));
    if (stat?.isFile()) found.push(entry.name);
  }
  return found;
}

/**
 * The set of skill names AGNT already has, from all three places it can have
 * them: its own skills directory on disk, the discovery catalog, and the
 * database.
 *
 * ALL THREE ARE UNCONDITIONAL EXCEPT THE DB. Only the database lookup needs to
 * know who is asking; the disk does not. Gating the disk check on a userId
 * meant an anonymous scan reported every skill as importable — including ones
 * sitting in AGNT's own folder — and the import then skipped them all as
 * "already in AGNT". Promising nine and delivering two is a worse failure than
 * promising nothing, and it is the failure that survives a missing token.
 */
async function existingSkillNames(userId) {
  const names = new Set();

  // 1. AGNT's own skills directory, read directly. This is the ground truth
  //    for "copying this file would land on top of an existing one", and it
  //    is true regardless of who is asking or whether discovery has run.
  for (const name of await listSkillDirs(path.join(os.homedir(), '.agnt', 'skills'))) {
    names.add(name.toLowerCase());
  }

  // 2. The discovery catalog is name-deduped by priority, and AGNT's own
  //    directory outranks every other tool's, so `client === 'agnt'` means
  //    precisely "AGNT holds its own copy". Catches skills registered from
  //    somewhere other than the default folder.
  try {
    for (const skill of SkillDiscoveryService.getSkillCatalog() || []) {
      if (skill?.client === 'agnt' && skill?.name) names.add(String(skill.name).toLowerCase());
    }
  } catch {
    // Discovery not yet initialised (very early boot). The disk read above
    // already covered the common case.
  }

  // 3. Rows the user owns, which may exist without files.
  if (userId) {
    try {
      const rows = await SkillModel.findAll(userId);
      for (const row of rows || []) {
        if (row?.name) names.add(String(row.name).toLowerCase());
      }
    } catch {
      // Best-effort. The two checks above are the load-bearing ones.
    }
  }

  return names;
}

/** Persona text for one harness, or null when there is nothing real to take. */
async function readPersona(harness, harnessHome) {
  if (!harness.persona) return null;

  const parts = [];
  for (const rel of harness.persona.files) {
    const text = await readTextSafe(path.join(harnessHome, rel));
    if (!text || looksLikeTemplate(text)) continue;
    parts.push({ origin: rel, text: text.trim() });
  }
  if (parts.length === 0) return null;

  return {
    origins: parts.map((p) => p.origin),
    text: parts.map((p) => p.text).join('\n\n'),
    bytes: parts.reduce((sum, p) => sum + Buffer.byteLength(p.text, 'utf8'), 0),
  };
}

/** Individual memories for one harness. */
async function readMemories(harness, harnessHome) {
  if (!harness.memory) return [];
  const out = [];
  for (const rel of harness.memory.files) {
    const text = await readTextSafe(path.join(harnessHome, rel));
    if (!text || looksLikeTemplate(text)) continue;
    for (const content of splitMemories(text, harness.memory.delimiter)) {
      out.push({ origin: rel, content });
    }
  }
  return out;
}

class HarnessScanner {
  /**
   * @param {object}  [opts]
   * @param {string}  [opts.userId]  used to check what AGNT already has
   * @param {object}  [opts.env]     injected for tests; defaults to process.env
   * @returns {Promise<{sources: object[], totals: object}>}
   */
  static async detect({ userId, env = process.env } = {}) {
    const alreadyHave = await existingSkillNames(userId);

    const sources = [];
    // Names seen in an earlier harness this run. Two tools holding the same
    // skill is the normal case, not the exception — they are usually the same
    // file synced across tools — so the second one must not offer it again.
    const claimed = new Set();

    for (const harness of HARNESSES) {
      const harnessHome = harness.homeDir(env);
      const stat = await statSafe(harnessHome);
      if (!stat?.isDirectory()) continue;

      const skillNames = await listSkillDirs(path.join(harnessHome, 'skills'));
      const newSkills = [];
      for (const name of skillNames) {
        const key = name.toLowerCase();
        if (alreadyHave.has(key) || claimed.has(key)) continue;
        claimed.add(key);
        newSkills.push(name);
      }

      // OpenClaw's readable files sit under a separately-configurable
      // workspace, so persona and memory resolve from there rather than home.
      const readRoot = resolveReadRoot(harness, harnessHome, env);

      const persona = await readPersona(harness, readRoot);
      const memories = await readMemories(harness, readRoot);

      sources.push({
        id: harness.id,
        label: harness.label,
        icon: harness.icon,
        home: harnessHome,
        skills: {
          total: skillNames.length,
          importable: newSkills.length,
          names: newSkills,
        },
        persona: persona
          ? { available: true, origins: persona.origins, bytes: persona.bytes,
              preview: persona.text.slice(0, 180) }
          : { available: false },
        memories: { count: memories.length },
      });
    }

    const totals = {
      sources: sources.length,
      skillsSeen: sources.reduce((n, s) => n + s.skills.total, 0),
      skillsImportable: sources.reduce((n, s) => n + s.skills.importable, 0),
      personas: sources.filter((s) => s.persona.available).length,
      memories: sources.reduce((n, s) => n + s.memories.count, 0),
    };

    return { sources, totals };
  }

  /** Persona + memories for one harness, for the import path. */
  static async read(harnessId, { env = process.env } = {}) {
    const harness = HARNESSES.find((h) => h.id === harnessId);
    if (!harness) return null;

    const harnessHome = harness.homeDir(env);
    if (!(await statSafe(harnessHome))?.isDirectory()) return null;

    const readRoot = resolveReadRoot(harness, harnessHome, env);

    return {
      harness,
      home: harnessHome,
      skillsRoot: path.join(harnessHome, 'skills'),
      persona: await readPersona(harness, readRoot),
      memories: await readMemories(harness, readRoot),
    };
  }
}

export default HarnessScanner;
