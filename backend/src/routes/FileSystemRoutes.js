import express from 'express';
import fs from 'fs/promises';
import { open as fsOpen } from 'fs/promises';
import path from 'path';
import multer from 'multer';
import { authenticateToken } from './Middleware.js';
import { requireAuthMedia } from '../utils/authGuard.js';
import PathManager from '../utils/PathManager.js';
import { prepareWrite } from '../utils/lineEndings.js';
import { describeUnsafeRoot } from '../utils/installDirGuard.js';

const router = express.Router();

// Multer for OS drag-and-drop uploads into the workspace. Memory storage so we
// control the filename/dest ourselves (path traversal + collision handling).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

// Default workspace root and settings file live alongside other app data
const DEFAULT_WORKSPACE_ROOT = PathManager.getPath('projects');
const SETTINGS_FILE = PathManager.getPath('code-settings.json');

// Hard cap for the GET /file *text* preview. Files above this are reported as
// `{ noPreview: true, reason: 'too_large' }` so the frontend can short-circuit
// instead of allocating a huge UTF-8 string in the Node process and shipping
// it to the client (which freezes the editor and can OOM the backend).
//
// IMPORTANT: this cap only applies to the text-into-editor path. Streamed
// previews (images, video, audio, PDF, etc.) go through `/api/local-file/`
// with HTTP Range support and are NOT subject to this limit — a 100 MB .mp4
// previews fine because it streams chunk-by-chunk into a <video> element.
const MAX_PREVIEW_BYTES = 25 * 1024 * 1024;
// First chunk size used to sniff whether a file is binary. Looking for a NUL
// byte in the first ~8 KB is the same heuristic git/grep/file(1) use.
const BINARY_SNIFF_BYTES = 8192;

async function isBinaryFile(absPath) {
  let handle;
  try {
    handle = await fsOpen(absPath, 'r');
    const buf = Buffer.alloc(BINARY_SNIFF_BYTES);
    const { bytesRead } = await handle.read(buf, 0, BINARY_SNIFF_BYTES, 0);
    for (let i = 0; i < bytesRead; i++) {
      if (buf[i] === 0) return true;
    }
    return false;
  } catch {
    // If we can't sniff, fall through and let the caller try a normal read.
    return false;
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
}

/**
 * Get the current workspace root from settings
 */
async function getWorkspaceRoot() {
  try {
    const raw = await fs.readFile(SETTINGS_FILE, 'utf-8');
    const settings = JSON.parse(raw);
    if (settings.workspaceRoot) {
      return path.resolve(settings.workspaceRoot);
    }
  } catch {
    // Settings file doesn't exist or is invalid — use default
  }
  return DEFAULT_WORKSPACE_ROOT;
}

/**
 * Save workspace root to settings
 */
async function saveWorkspaceRoot(rootPath) {
  let settings = {};
  try {
    const raw = await fs.readFile(SETTINGS_FILE, 'utf-8');
    settings = JSON.parse(raw);
  } catch {
    // Start fresh
  }
  settings.workspaceRoot = rootPath;
  await fs.mkdir(path.dirname(SETTINGS_FILE), { recursive: true });
  await fs.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8');
}

/**
 * Ensure workspace root directory exists.
 *
 * With ONE exception: a root inside the install directory is never re-created.
 *
 * That exception is the difference between a user seeing "my folder is gone"
 * and "my folder is empty". After the updater erased $INSTDIR, the very next
 * tree load called this function, which cheerfully mkdir'd the folder back
 * into existence — so the user opened a real, present, empty directory and
 * concluded AGNT had wiped his files in place. Re-creating the folder destroys
 * the only evidence of what actually happened and makes the product look like
 * it corrupts data.
 *
 * If the directory still exists this changes nothing (mkdir on an existing
 * path is a no-op anyway). It only bites when the folder is ALREADY gone,
 * which is exactly the case where we must not paper over it.
 */
async function ensureWorkspaceRoot() {
  const root = await getWorkspaceRoot();
  if (describeUnsafeRoot(root)) return root;
  try {
    await fs.mkdir(root, { recursive: true });
  } catch (err) {
    // Already exists or other non-fatal error
  }
  return root;
}

/**
 * Resolve a user-supplied path.
 *
 * - Absolute paths are allowed anywhere on the filesystem (intentional —
 *   the editor can browse outside the configured workspace).
 * - Relative paths are resolved against the workspace root and must stay
 *   inside it (path traversal protection).
 *
 * Uses path.relative for the containment check so prefix collisions
 * (`C:\foo` vs `C:\foobar`) and Windows case differences are handled correctly.
 */
function validatePath(inputPath, workspaceRoot) {
  if (inputPath && path.isAbsolute(inputPath)) {
    return path.resolve(inputPath);
  }
  const resolved = path.resolve(workspaceRoot, inputPath || '');
  const rel = path.relative(workspaceRoot, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Path traversal not allowed');
  }
  return resolved;
}

/**
 * Shout, once, at startup if the CONFIGURED workspace root is already inside
 * the install directory.
 *
 * The picker now refuses to create this situation, but installs that predate
 * the guard are already in it and lose everything on their next update. They
 * cannot be fixed silently — the folder is the user's, and moving someone's
 * files without asking is its own kind of data loss — so the loudest thing we
 * can do without touching their disk is say so on every boot and flag it on
 * the settings endpoint the UI already calls.
 */
async function warnIfWorkspaceUnsafe() {
  try {
    const unsafe = describeUnsafeRoot(await getWorkspaceRoot());
    if (!unsafe) return;
    console.warn(
      '\n' +
        '='.repeat(72) + '\n' +
        '  WARNING: your workspace folder will be DELETED by the next update.\n' +
        `  Workspace: ${unsafe.workspaceRoot}\n` +
        `  AGNT install: ${unsafe.installRoot}\n` +
        '  Installing an AGNT update erases the install directory and\n' +
        '  everything inside it. Move your work and pick a different\n' +
        '  workspace folder BEFORE you install another update.\n' +
        '='.repeat(72) + '\n',
    );
  } catch {
    // Never let a diagnostic take the backend down.
  }
}
warnIfWorkspaceUnsafe();

// GET /api/filesystem/settings
// Returns current workspace root and default
router.get('/settings', authenticateToken, async (req, res) => {
  try {
    const workspaceRoot = await getWorkspaceRoot();
    res.json({
      workspaceRoot,
      defaultRoot: DEFAULT_WORKSPACE_ROOT,
      // null when safe; the UI shows a banner when it isn't.
      unsafeRoot: describeUnsafeRoot(workspaceRoot),
    });
  } catch (error) {
    console.error('FileSystem settings error:', error);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/filesystem/settings  { workspaceRoot }
// Update workspace root directory
router.put('/settings', authenticateToken, async (req, res) => {
  try {
    const { workspaceRoot } = req.body;
    if (!workspaceRoot) return res.status(400).json({ error: 'workspaceRoot is required' });

    const resolved = path.resolve(workspaceRoot);

    // Refuse BEFORE mkdir. Creating the folder first is what made the original
    // failure look survivable: the user saw a real, empty directory appear and
    // reasonably concluded their files had been erased from it, when in fact
    // this call had just created it. Validate, then create.
    const unsafe = describeUnsafeRoot(resolved);
    if (unsafe) {
      return res.status(400).json({ error: unsafe.message, ...unsafe });
    }

    // Verify the directory exists or can be created
    await fs.mkdir(resolved, { recursive: true });

    await saveWorkspaceRoot(resolved);
    res.json({ success: true, workspaceRoot: resolved });
  } catch (error) {
    console.error('FileSystem settings update error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/filesystem/tree?dir=<relPath>
// Returns directory listing for the given relative path (default: root)
router.get('/tree', authenticateToken, async (req, res) => {
  try {
    const root = await ensureWorkspaceRoot();
    const relDir = req.query.dir || '';
    const absDir = validatePath(relDir, root);

    const entries = await fs.readdir(absDir, { withFileTypes: true });
    const items = entries
      .filter((e) => !e.name.startsWith('.'))
      .map((e) => ({
        name: e.name,
        type: e.isDirectory() ? 'directory' : 'file',
        path: path.join(relDir, e.name).replace(/\\/g, '/'),
      }))
      .sort((a, b) => {
        // Directories first, then alphabetical
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

    res.json({ items, root: relDir || '/' });
  } catch (error) {
    console.error('FileSystem tree error:', error);
    res.status(error.message === 'Path traversal not allowed' ? 403 : 500).json({ error: error.message });
  }
});

// Dirs we never descend into during recursive search. These are cheap wins:
// they're large, rarely what the user is looking for, and skipping them keeps
// a search across a big workspace responsive.
const SEARCH_SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.cache', '.turbo', '.venv', 'venv', '__pycache__', '.pytest_cache']);
const SEARCH_MAX_RESULTS = 200;
const SEARCH_MAX_ENTRIES = 20000;

// GET /api/filesystem/search?q=<query>&dir=<relPath>
// Recursively searches file/directory names under `dir` (default: workspace
// root). Case-insensitive substring match on the name. Returns up to
// SEARCH_MAX_RESULTS matches with a truncated flag when we hit either the
// result cap or the entry-scan cap (safety valve for pathological workspaces).
router.get('/search', authenticateToken, async (req, res) => {
  try {
    const root = await ensureWorkspaceRoot();
    const q = (req.query.q || '').trim();
    if (!q) return res.json({ items: [], truncated: false });

    const relDir = req.query.dir || '';
    const absDir = validatePath(relDir, root);

    const needle = q.toLowerCase();
    const items = [];
    let entriesScanned = 0;
    let truncated = false;

    const walk = async (currentAbs, currentRel) => {
      if (items.length >= SEARCH_MAX_RESULTS || entriesScanned >= SEARCH_MAX_ENTRIES) {
        truncated = true;
        return;
      }
      let entries;
      try {
        entries = await fs.readdir(currentAbs, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (items.length >= SEARCH_MAX_RESULTS || entriesScanned >= SEARCH_MAX_ENTRIES) {
          truncated = true;
          return;
        }
        if (e.name.startsWith('.')) continue;
        if (e.isDirectory() && SEARCH_SKIP_DIRS.has(e.name)) continue;

        entriesScanned++;
        const relPath = (currentRel ? `${currentRel}/${e.name}` : e.name).replace(/\\/g, '/');

        if (e.name.toLowerCase().includes(needle)) {
          items.push({
            name: e.name,
            type: e.isDirectory() ? 'directory' : 'file',
            path: relPath,
          });
        }

        if (e.isDirectory()) {
          await walk(path.join(currentAbs, e.name), relPath);
        }
      }
    };

    await walk(absDir, relDir);

    // Directories first, then alpha — matches how /tree sorts.
    items.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    res.json({ items, truncated, scope: relDir || '/' });
  } catch (error) {
    console.error('FileSystem search error:', error);
    res.status(error.message === 'Path traversal not allowed' ? 403 : 500).json({ error: error.message });
  }
});

// GET /api/filesystem/file?path=<relPath>
// Returns file content. Guards against opening huge or binary files: if the
// file is over MAX_PREVIEW_BYTES or contains NUL bytes in its first chunk,
// responds with `{ noPreview: true, reason, size }` (HTTP 200) so the frontend
// can show a "No preview available" placeholder without ever loading the bytes.
router.get('/file', authenticateToken, async (req, res) => {
  try {
    const root = await getWorkspaceRoot();
    const relPath = req.query.path;
    if (!relPath) return res.status(400).json({ error: 'path is required' });

    const absPath = validatePath(relPath, root);

    // Stat first so we can short-circuit on size before allocating any buffer.
    const stat = await fs.stat(absPath);
    if (stat.isDirectory()) {
      return res.status(400).json({ error: 'path is a directory' });
    }
    if (stat.size > MAX_PREVIEW_BYTES) {
      return res.json({
        path: relPath,
        noPreview: true,
        reason: 'too_large',
        size: stat.size,
      });
    }

    // Cheap binary sniff (NUL byte in first 8 KB). Catches .exe/.dll/.zip/etc.
    // that don't have a known extension we already special-case in the UI.
    if (await isBinaryFile(absPath)) {
      return res.json({
        path: relPath,
        noPreview: true,
        reason: 'binary',
        size: stat.size,
      });
    }

    const content = await fs.readFile(absPath, 'utf-8');
    res.json({ content, path: relPath, size: stat.size });
  } catch (error) {
    console.error('FileSystem read error:', error);
    if (error.code === 'ENOENT') return res.status(404).json({ error: 'File not found' });
    res.status(error.message === 'Path traversal not allowed' ? 403 : 500).json({ error: error.message });
  }
});

// POST /api/filesystem/file  { path, content }
// Write/create a file
router.post('/file', authenticateToken, async (req, res) => {
  try {
    const root = await getWorkspaceRoot();
    const { path: relPath, content } = req.body;
    if (!relPath) return res.status(400).json({ error: 'path is required' });

    const absPath = validatePath(relPath, root);

    // Ensure parent directory exists
    await fs.mkdir(path.dirname(absPath), { recursive: true });

    // The file explorer round-trips content through a browser textarea, which
    // normalizes to LF on the way in. Writing that back verbatim silently
    // restyled every line of a CRLF file on save.
    const prepared = await prepareWrite(absPath, content || '');
    await fs.writeFile(absPath, prepared.content, 'utf-8');

    res.json({ success: true, path: relPath, lineEndings: prepared.action });
  } catch (error) {
    console.error('FileSystem write error:', error);
    res.status(error.message === 'Path traversal not allowed' ? 403 : 500).json({ error: error.message });
  }
});

// POST /api/filesystem/upload  (multipart)  fields: dir, files[]
// OS drag-and-drop uploads. Files land inside `dir` (relative to workspace
// root; empty string = root). Collisions get " (n)" suffixed before the ext.
router.post('/upload', authenticateToken, upload.array('files'), async (req, res) => {
  try {
    const root = await getWorkspaceRoot();
    const dir = typeof req.body.dir === 'string' ? req.body.dir : '';
    const files = req.files || [];
    if (files.length === 0) return res.status(400).json({ error: 'no files uploaded' });

    const absDir = validatePath(dir, root);
    // If a file already exists at the target path, refuse — the caller meant a directory.
    try {
      const stat = await fs.stat(absDir);
      if (!stat.isDirectory()) return res.status(400).json({ error: 'target is not a directory' });
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    await fs.mkdir(absDir, { recursive: true });

    const uploaded = [];
    for (const file of files) {
      // Sanitize: strip any directory components and leading dots so
      // "..\evil.txt" or ".htaccess" can't escape or hide.
      const rawName = file.originalname || 'file';
      let safeName = path.basename(rawName).replace(/^\.+/, '') || 'file';
      const ext = path.extname(safeName);
      const stem = ext ? safeName.slice(0, -ext.length) : safeName;

      let finalName = safeName;
      let n = 1;
      // Loop until we find a free name. Bounded by n<10000 as a sanity guard.
      // eslint-disable-next-line no-constant-condition
      while (n < 10000) {
        try {
          await fs.access(path.join(absDir, finalName));
          finalName = `${stem} (${n})${ext}`;
          n += 1;
        } catch {
          break;
        }
      }

      await fs.writeFile(path.join(absDir, finalName), file.buffer);
      const rel = path.relative(root, path.join(absDir, finalName)).split(path.sep).join('/');
      uploaded.push({ path: rel, size: file.size });
    }

    res.json({ success: true, uploaded });
  } catch (error) {
    console.error('FileSystem upload error:', error);
    res.status(error.message === 'Path traversal not allowed' ? 403 : 500).json({ error: error.message });
  }
});

// POST /api/filesystem/mkdir  { path }
// Create a directory
router.post('/mkdir', authenticateToken, async (req, res) => {
  try {
    const root = await getWorkspaceRoot();
    const { path: relPath } = req.body;
    if (!relPath) return res.status(400).json({ error: 'path is required' });

    const absPath = validatePath(relPath, root);
    await fs.mkdir(absPath, { recursive: true });

    res.json({ success: true, path: relPath });
  } catch (error) {
    console.error('FileSystem mkdir error:', error);
    res.status(error.message === 'Path traversal not allowed' ? 403 : 500).json({ error: error.message });
  }
});

// POST /api/filesystem/rename  { oldPath, newPath }
// Rename or move a file/directory
router.post('/rename', authenticateToken, async (req, res) => {
  try {
    const root = await getWorkspaceRoot();
    const { oldPath, newPath } = req.body;
    if (!oldPath || !newPath) return res.status(400).json({ error: 'oldPath and newPath are required' });

    const absOld = validatePath(oldPath, root);
    const absNew = validatePath(newPath, root);

    // Ensure parent directory of destination exists
    await fs.mkdir(path.dirname(absNew), { recursive: true });
    await fs.rename(absOld, absNew);

    res.json({ success: true, oldPath, newPath });
  } catch (error) {
    console.error('FileSystem rename error:', error);
    if (error.code === 'ENOENT') return res.status(404).json({ error: 'Source not found' });
    res.status(error.message === 'Path traversal not allowed' ? 403 : 500).json({ error: error.message });
  }
});

// GET /api/filesystem/raw?path=<relPath>
// Serve a file with its native content-type (images, videos, etc.)
//
// requireAuthMedia, NOT authenticateToken: this URL is consumed by <img>,
// <video>, <audio> and <iframe> in the Artifacts preview, and a browser cannot
// put an Authorization header on a subresource load. The header-only guard
// made every one of those previews 401. See utils/mediaRoutes.js.
//
// Accepting the media cookie here is safe: validatePath below confines the
// request to the workspace root and rejects traversal, so this route is
// strictly narrower than /api/local-file, which already accepts that cookie
// for any absolute path.
router.get('/raw', requireAuthMedia, async (req, res) => {
  try {
    const root = await getWorkspaceRoot();
    const relPath = req.query.path;
    if (!relPath) return res.status(400).json({ error: 'path is required' });

    const absPath = validatePath(relPath, root);

    // Verify the file exists
    await fs.stat(absPath);

    // Use express sendFile for proper content-type detection and streaming
    const resolvedPath = path.resolve(absPath);
    res.sendFile(resolvedPath);
  } catch (error) {
    console.error('FileSystem raw read error:', error);
    if (error.code === 'ENOENT') return res.status(404).json({ error: 'File not found' });
    res.status(error.message === 'Path traversal not allowed' ? 403 : 500).json({ error: error.message });
  }
});

// DELETE /api/filesystem/file?path=<relPath>
// Delete a file or empty directory
router.delete('/file', authenticateToken, async (req, res) => {
  try {
    const root = await getWorkspaceRoot();
    const relPath = req.query.path;
    if (!relPath) return res.status(400).json({ error: 'path is required' });

    const absPath = validatePath(relPath, root);
    const stat = await fs.stat(absPath);

    if (stat.isDirectory()) {
      await fs.rm(absPath, { recursive: true });
    } else {
      await fs.unlink(absPath);
    }

    res.json({ success: true, path: relPath });
  } catch (error) {
    console.error('FileSystem delete error:', error);
    if (error.code === 'ENOENT') return res.status(404).json({ error: 'File not found' });
    res.status(error.message === 'Path traversal not allowed' ? 403 : 500).json({ error: error.message });
  }
});

export default router;
