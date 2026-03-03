import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { authenticateToken } from './Middleware.js';

const router = express.Router();

// Workspace root: ~/.agnt/projects/
const WORKSPACE_ROOT = path.join(os.homedir(), '.agnt', 'projects');

/**
 * Ensure workspace root directory exists
 */
async function ensureWorkspaceRoot() {
  try {
    await fs.mkdir(WORKSPACE_ROOT, { recursive: true });
  } catch (err) {
    // Already exists or other non-fatal error
  }
}

/**
 * Validate that a resolved path is within WORKSPACE_ROOT (path traversal protection)
 */
function validatePath(relPath) {
  const resolved = path.resolve(WORKSPACE_ROOT, relPath || '');
  if (!resolved.startsWith(WORKSPACE_ROOT)) {
    throw new Error('Path traversal not allowed');
  }
  return resolved;
}

// GET /api/filesystem/tree?dir=<relPath>
// Returns directory listing for the given relative path (default: root)
router.get('/tree', authenticateToken, async (req, res) => {
  try {
    await ensureWorkspaceRoot();
    const relDir = req.query.dir || '';
    const absDir = validatePath(relDir);

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
    const relPath = req.query.path;
    if (!relPath) return res.status(400).json({ error: 'path is required' });

    const absPath = validatePath(relPath);
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
    const { path: relPath, content } = req.body;
    if (!relPath) return res.status(400).json({ error: 'path is required' });

    const absPath = validatePath(relPath);

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
    const { path: relPath } = req.body;
    if (!relPath) return res.status(400).json({ error: 'path is required' });

    const absPath = validatePath(relPath);
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
    const { oldPath, newPath } = req.body;
    if (!oldPath || !newPath) return res.status(400).json({ error: 'oldPath and newPath are required' });

    const absOld = validatePath(oldPath);
    const absNew = validatePath(newPath);

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

// DELETE /api/filesystem/file?path=<relPath>
// Delete a file or empty directory
router.delete('/file', authenticateToken, async (req, res) => {
  try {
    const relPath = req.query.path;
    if (!relPath) return res.status(400).json({ error: 'path is required' });

    const absPath = validatePath(relPath);
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
