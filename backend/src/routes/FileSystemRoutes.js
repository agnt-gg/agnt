import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { authenticateToken } from './Middleware.js';
import PathManager from '../utils/PathManager.js';

const router = express.Router();

// Default workspace root and settings file live alongside other app data
const DEFAULT_WORKSPACE_ROOT = PathManager.getPath('projects');
const SETTINGS_FILE = PathManager.getPath('code-settings.json');

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
 * Ensure workspace root directory exists
 */
async function ensureWorkspaceRoot() {
  const root = await getWorkspaceRoot();
  try {
    await fs.mkdir(root, { recursive: true });
  } catch (err) {
    // Already exists or other non-fatal error
  }
  return root;
}

/**
 * Validate that a resolved path is within the workspace root (path traversal protection)
 */
function validatePath(relPath, workspaceRoot) {
  const resolved = path.resolve(workspaceRoot, relPath || '');
  if (!resolved.startsWith(workspaceRoot)) {
    throw new Error('Path traversal not allowed');
  }
  return resolved;
}

// GET /api/filesystem/settings
// Returns current workspace root and default
router.get('/settings', authenticateToken, async (req, res) => {
  try {
    const workspaceRoot = await getWorkspaceRoot();
    res.json({ workspaceRoot, defaultRoot: DEFAULT_WORKSPACE_ROOT });
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

// GET /api/filesystem/file?path=<relPath>
// Returns file content
router.get('/file', authenticateToken, async (req, res) => {
  try {
    const root = await getWorkspaceRoot();
    const relPath = req.query.path;
    if (!relPath) return res.status(400).json({ error: 'path is required' });

    const absPath = validatePath(relPath, root);
    const content = await fs.readFile(absPath, 'utf-8');
    res.json({ content, path: relPath });
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
    await fs.writeFile(absPath, content || '', 'utf-8');

    res.json({ success: true, path: relPath });
  } catch (error) {
    console.error('FileSystem write error:', error);
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
router.get('/raw', authenticateToken, async (req, res) => {
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
