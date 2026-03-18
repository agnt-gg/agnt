/**
 * Bootstrap builtin skills to ~/.agnt/skills/ on first run or app update.
 * Skills bundled in the app directory are copied to the user-level location
 * so they follow the agentskills.io standard discovery paths.
 */
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST_FILE = '.builtin-manifest.json';

/**
 * Get the path to the bundled skills directory inside the app.
 */
function getBundledSkillsPath() {
  return path.resolve(__dirname, '../../skills');
}

/**
 * Get the user-level AGNT skills directory (~/.agnt/skills/).
 */
function getUserSkillsPath() {
  return path.join(os.homedir(), '.agnt', 'skills');
}

/**
 * Compute a fast hash of a file's contents.
 */
async function hashFile(filePath) {
  try {
    const content = await fs.readFile(filePath);
    return crypto.createHash('md5').update(content).digest('hex');
  } catch {
    return null;
  }
}

/**
 * Read the bootstrap manifest from the destination directory.
 */
async function readManifest(destDir) {
  try {
    const raw = await fs.readFile(path.join(destDir, MANIFEST_FILE), 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Write the bootstrap manifest to the destination directory.
 */
async function writeManifest(destDir, manifest) {
  await fs.writeFile(
    path.join(destDir, MANIFEST_FILE),
    JSON.stringify(manifest, null, 2) + '\n',
    'utf-8'
  );
}

/**
 * Recursively copy a directory.
 */
async function copyDir(src, dest) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

/**
 * Bootstrap builtin skills from the app bundle to ~/.agnt/skills/.
 * - Creates the destination directory if needed
 * - Copies new skills that don't exist yet
 * - Updates skills whose bundled SKILL.md has changed (unless user modified them)
 * - Tracks state via a manifest file
 */
export async function bootstrapBuiltinSkills() {
  const srcDir = getBundledSkillsPath();
  const destDir = getUserSkillsPath();

  // Check if bundled skills exist
  let srcEntries;
  try {
    srcEntries = await fs.readdir(srcDir, { withFileTypes: true });
  } catch {
    // No bundled skills directory — nothing to bootstrap
    return;
  }

  const skillDirs = srcEntries.filter((e) => e.isDirectory());
  if (skillDirs.length === 0) return;

  await fs.mkdir(destDir, { recursive: true });

  const manifest = await readManifest(destDir) || { version: null, skills: {} };
  let copied = 0;
  let updated = 0;

  for (const dir of skillDirs) {
    const srcSkillDir = path.join(srcDir, dir.name);
    const destSkillDir = path.join(destDir, dir.name);
    const srcSkillMd = path.join(srcSkillDir, 'SKILL.md');

    // Verify bundled skill has SKILL.md
    try {
      await fs.access(srcSkillMd);
    } catch {
      continue; // Not a valid skill directory
    }

    const srcHash = await hashFile(srcSkillMd);
    const manifestEntry = manifest.skills[dir.name];

    // Check if destination already exists
    const destSkillMd = path.join(destSkillDir, 'SKILL.md');
    let destExists = false;
    try {
      await fs.access(destSkillMd);
      destExists = true;
    } catch {
      // Doesn't exist yet
    }

    if (!destExists) {
      // New skill — copy it
      await copyDir(srcSkillDir, destSkillDir);
      manifest.skills[dir.name] = { hash: srcHash };
      copied++;
    } else if (manifestEntry && manifestEntry.hash !== srcHash) {
      // Bundled version changed — check if user modified it
      const destHash = await hashFile(destSkillMd);
      if (destHash === manifestEntry.hash) {
        // User hasn't modified it — safe to update
        await copyDir(srcSkillDir, destSkillDir);
        manifest.skills[dir.name] = { hash: srcHash };
        updated++;
      } else {
        // User modified it — don't clobber, just update manifest hash to stop re-checking
        console.log(`[SkillBootstrap] Skipping "${dir.name}" — user has modified it`);
      }
    } else if (!manifestEntry) {
      // Skill exists but no manifest entry (pre-existing install) — record it, don't overwrite
      const destHash = await hashFile(destSkillMd);
      manifest.skills[dir.name] = { hash: destHash };
    }
  }

  await writeManifest(destDir, manifest);

  if (copied > 0 || updated > 0) {
    console.log(`[SkillBootstrap] Bootstrapped ${copied} new, ${updated} updated skills to ${destDir}`);
  }
}

/**
 * Get the set of skill names that were bootstrapped (for auto-registration).
 */
export async function getBootstrappedSkillNames() {
  const destDir = getUserSkillsPath();
  const manifest = await readManifest(destDir);
  return manifest ? new Set(Object.keys(manifest.skills)) : new Set();
}
