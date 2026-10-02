/**
 * Pack an installed plugin folder into a `.agnt` archive (gzipped tar with the
 * plugin name as its top-level folder), for publishing to the marketplace.
 *
 * Two defects this replaces, both of which shipped broken plugins:
 *   1. Only top-level FILES plus node_modules were packed. Every plugin whose
 *      tools live in a subfolder (`tools/`, `lib/`, assets) was published
 *      without its code.
 *   2. The first archive was cached in plugin-builds/ and served forever, so a
 *      plugin updated after its first publish kept publishing the old bytes.
 *
 * So: pack the whole folder, and build fresh every time.
 */
import fs from 'fs/promises';
import path from 'path';

/** Top-level names never packed: dotfiles (.git, .env…) and npm's lockfile. */
export function isExcludedEntry(name) {
  return name.startsWith('.') || name === 'package-lock.json';
}

/** Top-level entries (files and folders) that belong in the archive. */
export async function listPackageEntries(pluginPath) {
  const entries = await fs.readdir(pluginPath, { withFileTypes: true });
  return entries
    .filter((entry) => (entry.isFile() || entry.isDirectory()) && !isExcludedEntry(entry.name))
    .map((entry) => entry.name)
    .sort();
}

/**
 * Build the archive at `outputFile` (overwriting any previous one) and return
 * its bytes. Nested dotfiles are skipped too.
 */
export async function packageInstalledPlugin(pluginPath, name, outputFile) {
  const include = await listPackageEntries(pluginPath);
  if (!include.length) throw new Error(`Plugin "${name}" has nothing to package`);
  await fs.mkdir(path.dirname(outputFile), { recursive: true });
  const tar = await import('tar');
  await tar.create(
    {
      gzip: true,
      file: outputFile,
      cwd: pluginPath,
      prefix: name,
      portable: true,
      filter: (entryPath) => !entryPath.split(/[\\/]/).some((part) => part.startsWith('.') && part !== '.' && part !== '..'),
    },
    include,
  );
  return fs.readFile(outputFile);
}
