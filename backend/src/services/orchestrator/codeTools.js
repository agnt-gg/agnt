import fs from 'fs/promises';
import path from 'path';
import PathManager from '../../utils/PathManager.js';

const DEFAULT_WORKSPACE_ROOT = PathManager.getPath('projects');
const SETTINGS_FILE = PathManager.getPath('code-settings.json');

/**
 * Get the current workspace root path (exported for system prompt)
 */
export async function getWorkspaceRootPath() {
  return await getWorkspaceRoot();
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
 * Validate that a resolved path is within the workspace root
 */
function validatePath(relPath, workspaceRoot) {
  const resolved = path.resolve(workspaceRoot, relPath || '');
  if (!resolved.startsWith(workspaceRoot)) {
    throw new Error('Path traversal not allowed');
  }
  return resolved;
}

/**
 * Get tool schemas for code chat context
 */
export function getCodeToolSchemas() {
  return [
    {
      type: 'function',
      function: {
        name: 'read_file',
        description: 'Read the contents of a file from the workspace',
        parameters: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Relative path to the file within the workspace (e.g. "my-project/index.js")',
            },
          },
          required: ['path'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'write_file',
        description: 'Write content to a file in the workspace. Creates the file and any parent directories if they do not exist. Use this only for creating NEW files or complete rewrites.',
        parameters: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Relative path to the file within the workspace (e.g. "my-project/hello.py")',
            },
            content: {
              type: 'string',
              description: 'The full file content to write',
            },
          },
          required: ['path', 'content'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'edit_file',
        description: 'Apply surgical search/replace edits to an existing file. Use this for bug fixes, style tweaks, adding features, or any targeted modification instead of rewriting the entire file. Each edit is a { search, replace } pair applied sequentially.',
        parameters: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Relative path to the file within the workspace (e.g. "my-project/index.js")',
            },
            edits: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  search: { type: 'string', description: 'Exact string to find in the current file content' },
                  replace: { type: 'string', description: 'Replacement string' },
                },
                required: ['search', 'replace'],
              },
              description: 'Array of search/replace pairs to apply sequentially',
            },
            description: {
              type: 'string',
              description: 'Brief summary of what these edits accomplish',
            },
          },
          required: ['path', 'edits', 'description'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'list_files',
        description: 'List files and directories in the workspace at the given path',
        parameters: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Relative directory path within the workspace (e.g. "my-project/src"). Defaults to workspace root.',
            },
          },
        },
      },
    },
  ];
}

/**
 * Execute a code tool function
 */
export async function executeCodeFunction(name, args) {
  // Ensure workspace exists
  const WORKSPACE_ROOT = await getWorkspaceRoot();
  await fs.mkdir(WORKSPACE_ROOT, { recursive: true });

  let result;

  switch (name) {
    case 'read_file': {
      const absPath = validatePath(args.path, WORKSPACE_ROOT);
      try {
        const content = await fs.readFile(absPath, 'utf-8');
        result = { success: true, content, path: args.path, absolutePath: absPath };
      } catch (err) {
        if (err.code === 'ENOENT') {
          result = { success: false, error: `File not found: ${args.path}` };
        } else {
          throw err;
        }
      }
      break;
    }

    case 'write_file': {
      const absPath = validatePath(args.path, WORKSPACE_ROOT);
      await fs.mkdir(path.dirname(absPath), { recursive: true });
      await fs.writeFile(absPath, args.content || '', 'utf-8');
      result = {
        success: true,
        path: args.path,
        frontendEvents: [{ type: 'file_written', data: { path: args.path, content: args.content } }],
      };
      break;
    }

    case 'edit_file': {
      const absPath = validatePath(args.path, WORKSPACE_ROOT);
      let currentContent;
      try {
        currentContent = await fs.readFile(absPath, 'utf-8');
      } catch (err) {
        if (err.code === 'ENOENT') {
          result = { success: false, error: `File not found: ${args.path}. Use write_file to create new files.` };
          break;
        }
        throw err;
      }

      let updatedContent = currentContent;
      const applied = [];
      const failed = [];

      // Normalize whitespace for fuzzy matching
      const normalizeWS = (s) => s.replace(/\s+/g, ' ').trim();

      function fuzzyFind(source, search) {
        // Try exact match first
        const exactIdx = source.indexOf(search);
        if (exactIdx !== -1) return { start: exactIdx, end: exactIdx + search.length };

        // Fuzzy: normalize whitespace and slide through source
        const normSearch = normalizeWS(search);
        if (!normSearch) return null;

        let srcPos = 0;
        const srcLen = source.length;
        while (srcPos < srcLen) {
          let normWindow = '';
          let windowEnd = srcPos;

          while (windowEnd < srcLen) {
            const ch = source[windowEnd];
            if (/\s/.test(ch)) {
              if (!normWindow.endsWith(' ') && normWindow.length > 0) {
                normWindow += ' ';
              }
              windowEnd++;
            } else {
              normWindow += ch;
              windowEnd++;
            }

            const trimmedWindow = normWindow.trim();
            if (trimmedWindow === normSearch) {
              return { start: srcPos, end: windowEnd };
            }
            if (trimmedWindow.length > normSearch.length + 10) break;
          }
          srcPos++;
        }
        return null;
      }

      for (let i = 0; i < args.edits.length; i++) {
        const edit = args.edits[i];
        const match = fuzzyFind(updatedContent, edit.search);
        if (match) {
          updatedContent = updatedContent.substring(0, match.start) + edit.replace + updatedContent.substring(match.end);
          applied.push({ index: i, search: edit.search.substring(0, 80) });
        } else {
          failed.push({ index: i, search: edit.search.substring(0, 80), reason: 'Search string not found' });
        }
      }

      if (applied.length === 0) {
        result = {
          success: false,
          error: 'None of the search strings were found in the file.',
          failed,
          message: 'No edits could be applied. Check that your search strings match the current file content.',
        };
        break;
      }

      // Write the updated content back
      await fs.writeFile(absPath, updatedContent, 'utf-8');

      result = {
        success: true,
        applied,
        failed: failed.length > 0 ? failed : undefined,
        description: args.description,
        path: args.path,
        message: `Applied ${applied.length}/${args.edits.length} edits to ${args.path}: ${args.description}`,
        frontendEvents: [{ type: 'file_written', data: { path: args.path, content: updatedContent } }],
      };
      break;
    }

    case 'list_files': {
      const relDir = args.path || '';
      const absDir = validatePath(relDir, WORKSPACE_ROOT);
      try {
        const entries = await fs.readdir(absDir, { withFileTypes: true });
        const items = entries
          .filter((e) => !e.name.startsWith('.'))
          .map((e) => ({
            name: e.name,
            type: e.isDirectory() ? 'directory' : 'file',
            path: path.join(relDir, e.name).replace(/\\/g, '/'),
          }))
          .sort((a, b) => {
            if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
            return a.name.localeCompare(b.name);
          });
        result = { success: true, items, path: relDir || '/' };
      } catch (err) {
        if (err.code === 'ENOENT') {
          result = { success: false, error: `Directory not found: ${relDir}` };
        } else {
          throw err;
        }
      }
      break;
    }

    default:
      result = { success: false, error: `Unknown function: ${name}` };
  }

  return JSON.stringify(result);
}

// Heavy / generated dirs we never recurse into for the system prompt.
// Annie can still drill into them via the `list_files` tool.
const WORKSPACE_PROMPT_IGNORE = new Set([
  'node_modules', '.git', '.svn', '.hg',
  'dist', 'build', 'out', '.next', '.nuxt', '.cache',
  'target', 'bin', 'obj',
  '__pycache__', '.venv', 'venv', 'env',
  '.pytest_cache', '.mypy_cache', '.tox',
  'frames', 'extracted_frames',
  'coverage', '.nyc_output',
  '.idea', '.vscode',
  'tmp', 'temp',
]);

/**
 * List workspace files for the system prompt.
 *
 * Bounded recursion: stops at maxDepth and stops once items.length hits
 * maxEntries. Heavy generated dirs (node_modules, frames, dist, etc.) are
 * collapsed to a single entry with a child-count instead of being walked
 * — without this, a video-pipeline workspace can dump 200k+ tokens of
 * paths into the prompt and trigger emergency context truncation.
 *
 * Returns { items, truncated, collapsedDirs }. `items` keeps the legacy
 * shape ({ name, type, path }), with optional { collapsed, childCount }
 * on directories that were not walked.
 */
export async function listWorkspaceFiles({ maxEntries = 500, maxDepth = 3 } = {}) {
  const WORKSPACE_ROOT = await getWorkspaceRoot();
  await fs.mkdir(WORKSPACE_ROOT, { recursive: true });

  const items = [];
  const collapsedDirs = [];
  let truncated = false;

  async function countChildren(absDir) {
    try {
      const entries = await fs.readdir(absDir);
      return entries.filter((n) => !n.startsWith('.')).length;
    } catch { return 0; }
  }

  async function walk(relDir, depth) {
    if (truncated) return;
    const absDir = path.resolve(WORKSPACE_ROOT, relDir);
    let entries;
    try {
      entries = await fs.readdir(absDir, { withFileTypes: true });
    } catch { return; }

    // Directories first, then files; alphabetical within each group.
    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    for (const entry of entries) {
      if (truncated) return;
      if (entry.name.startsWith('.')) continue;
      if (items.length >= maxEntries) { truncated = true; return; }

      const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        const isIgnored = WORKSPACE_PROMPT_IGNORE.has(entry.name);
        const atDepthCap = depth + 1 > maxDepth;
        if (isIgnored || atDepthCap) {
          const childCount = await countChildren(path.resolve(WORKSPACE_ROOT, relPath));
          items.push({ name: entry.name, type: 'directory', path: relPath, collapsed: true, childCount });
          collapsedDirs.push(relPath);
          continue;
        }
        items.push({ name: entry.name, type: 'directory', path: relPath });
        await walk(relPath, depth + 1);
      } else {
        items.push({ name: entry.name, type: 'file', path: relPath });
      }
    }
  }

  await walk('', 0);
  return { items, truncated, collapsedDirs };
}
