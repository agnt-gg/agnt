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
 * Resolve a user-supplied path.
 *
 * - Absolute paths are allowed anywhere on the filesystem (intentional).
 * - Relative paths are resolved against the workspace root and must stay inside it.
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
              description: 'Path to the file. Relative paths resolve against the workspace (e.g. "my-project/index.js"). Absolute paths are also accepted and may point anywhere on disk (e.g. "C:\\\\path\\\\to\\\\file.js" or "/path/to/file.js").',
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
              description: 'Path to the file. Relative paths resolve against the workspace (e.g. "my-project/hello.py"). Absolute paths are also accepted and may point anywhere on disk.',
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
              description: 'Path to the file. Relative paths resolve against the workspace (e.g. "my-project/index.js"). Absolute paths are also accepted and may point anywhere on disk (e.g. "C:\\\\path\\\\to\\\\file.js" or "/path/to/file.js").',
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
              description: 'Directory path. Relative paths resolve against the workspace (e.g. "my-project/src"). Absolute paths are also accepted and may point anywhere on disk. Defaults to workspace root.',
            },
          },
        },
      },
    },
  ];
}

// ------------------------------------------------------ path serialization ---

/**
 * Per-path serialization for the file tools.
 *
 * WHY THIS EXISTS
 * ---------------
 * The orchestrator dispatches every tool call in one assistant message
 * CONCURRENTLY — `toolCalls.map(async ...)` feeding a single `Promise.all`
 * (OrchestratorService.js). `edit_file` is a read-modify-write: it reads the
 * whole file, splices the edits in memory, and writes the whole buffer back.
 * Two concurrent calls against the same path therefore interleave as
 *
 *     A:  read v0 ----------> write v0+A
 *     B:  ....... read v0 -------------------> write v0+B      A is gone
 *
 * and BOTH report success, because each one genuinely found its search string
 * in the copy it read. That is a lost update with no error anywhere: the caller
 * is told the edit landed and the file says otherwise. Being silent, it is
 * typically discovered much later — as a missing function or an undefined
 * symbol — long after the turn that caused it.
 *
 * Serializing on the path turns that into
 *
 *     A:  read v0 -> write v0+A
 *     B:                        read v0+A -> write v0+A+B
 *
 * so both edits survive. If A invalidated B's search string, B now fails LOUDLY
 * (reported in `failed[]`) instead of silently discarding A's work — which is
 * the correct outcome, because an edit computed against a stale view of the
 * file should not be applied.
 *
 * The key is the RESOLVED ABSOLUTE PATH, so work on different files still runs
 * fully in parallel. Only same-file work queues.
 *
 * NOT re-entrant, and does not need to be: every case body calls `fs.*`
 * directly and never re-enters executeCodeFunction, so a held lock can never
 * wait on itself.
 */
const _pathLocks = new Map();

/**
 * Windows paths are case-insensitive — `C:\A\b.js` and `c:\a\B.js` are the same
 * file and must map to the same lock. Without this the serialization silently
 * does nothing for exactly the callers most likely to vary the casing.
 */
function pathLockKey(absPath) {
  return process.platform === 'win32' ? absPath.toLowerCase() : absPath;
}

/**
 * Run `fn` with exclusive access to `key`. Waiters are served in arrival order.
 */
async function withPathLock(key, fn) {
  const prev = _pathLocks.get(key) || Promise.resolve();

  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  const tail = prev.then(() => held);
  _pathLocks.set(key, tail);

  // Wait for our turn. A previous holder's REJECTION must not cascade into
  // ours: `prev` is a queue position, never a result we consume.
  await prev.catch(() => {});

  try {
    return await fn();
  } finally {
    release();
    // Only the last waiter clears the entry, so the map cannot grow without
    // bound over a long session. The identity check is safe because nothing
    // else can run between release() and here (single-threaded, no await).
    if (_pathLocks.get(key) === tail) _pathLocks.delete(key);
  }
}

/**
 * Tools whose work must not interleave on a single path.
 *
 * `edit_file` and `write_file` mutate. `read_file` is included so a read can
 * never observe a half-written file mid-`writeFile` and return a torn document.
 *
 * `list_files` is deliberately absent: it is a directory scan rather than file
 * I/O, and a path lock over a directory would carry different semantics.
 */
const PATH_SERIALIZED_TOOLS = new Set(['read_file', 'write_file', 'edit_file']);

/**
 * Execute a code tool function.
 *
 * Thin wrapper: acquires the per-path lock for path-scoped tools, then runs the
 * real implementation. Every other tool dispatches straight through.
 */
export async function executeCodeFunction(name, args) {
  if (!PATH_SERIALIZED_TOOLS.has(name) || typeof args?.path !== 'string') {
    return executeCodeFunctionUnlocked(name, args);
  }

  let key;
  try {
    key = pathLockKey(validatePath(args.path, await getWorkspaceRoot()));
  } catch {
    // Path is invalid (escapes the workspace, etc.). Run unlocked so the case
    // body raises the same error it always has, from the same place.
    return executeCodeFunctionUnlocked(name, args);
  }

  return withPathLock(key, () => executeCodeFunctionUnlocked(name, args));
}

async function executeCodeFunctionUnlocked(name, args) {
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

      // ---- Line-ending & whitespace tolerant matching --------------------
      //
      // Two bugs lived here, and together they silently corrupted files while
      // the tool reported success.
      //
      // 1. CRLF FILES ALWAYS FELL THROUGH TO FUZZY MATCHING.
      //    Callers write search strings with "\n". On a CRLF file
      //    source.indexOf(search) can never match, so EVERY multi-line edit
      //    took the fuzzy path — which was never meant to be the common case.
      //
      // 2. THE FUZZY MATCHER SWALLOWED THE PRECEDING NEWLINE.
      //    normalizeWS() trims, so a window starting on whitespace normalizes
      //    identically to one starting at the next non-whitespace character.
      //    The scan slid forward from offset 0, so the FIRST position that
      //    matched was the one sitting on the whitespace run BEFORE the target
      //    — including the "\r\n" that ended the previous line. Splicing at
      //    that offset deleted the line break and welded the replacement onto
      //    the previous line. In practice that meant welding a statement onto
      //    the end of a comment: still-valid JS, invisible in review, and it
      //    only surfaced later as a ReferenceError or a SyntaxError.
      //
      // Reproduced 2026-07-25 with a 2x2 fixture matrix: CRLF + multi-line
      // search corrupted 100% of the time; LF, or CRLF with a CRLF search
      // string, or a single-line search, were all clean. Multi-byte UTF-8
      // upstream of the edit point was ruled out as a factor.

      const normalizeWS = (s) => s.replace(/\s+/g, ' ').trim();

      // The file's dominant line ending. Replacement text is coerced to it so
      // an edit never injects "\n" into a CRLF file — which is what produced
      // mixed-ending files and spurious whole-file diffs.
      const crlfCount = (currentContent.match(/\r\n/g) || []).length;
      const lfCount = (currentContent.match(/(?<!\r)\n/g) || []).length;
      const dominantEol = crlfCount > lfCount ? '\r\n' : '\n';
      const coerceEol = (s) =>
        typeof s === 'string' ? s.replace(/\r\n/g, '\n').replace(/\n/g, dominantEol) : s;

      function countOccurrences(source, needle) {
        if (!needle) return 0;
        let n = 0;
        for (let k = source.indexOf(needle); k !== -1; k = source.indexOf(needle, k + needle.length)) n++;
        return n;
      }

      function fuzzyFind(source, search) {
        // Exact match, attempted against BOTH line-ending conventions. This is
        // the path that should serve essentially every real edit; getting CRLF
        // right here is what stops the fuzzy fallback from ever running.
        const asLf = search.replace(/\r\n/g, '\n');
        const asCrlf = asLf.replace(/\n/g, '\r\n');
        const variants = [search];
        if (asLf !== search) variants.push(asLf);
        if (asCrlf !== search && asCrlf !== asLf) variants.push(asCrlf);

        for (const v of variants) {
          const idx = source.indexOf(v);
          if (idx !== -1) {
            return { start: idx, end: idx + v.length, fuzzy: false, occurrences: countOccurrences(source, v) };
          }
        }

        // Fuzzy fallback — only for genuine indentation / whitespace drift.
        const normSearch = normalizeWS(search);
        if (!normSearch) return null;
        const searchIndented = /^[ \t]/.test(search);
        const srcLen = source.length;

        for (let srcPos = 0; srcPos < srcLen; srcPos++) {
          // NEVER begin a window on whitespace. Because normalizeWS() trims,
          // such a window matches exactly the same text as one beginning at the
          // next non-whitespace character — but it reports a start offset that
          // sits before the preceding newline, and splicing there deletes it.
          // This one guard is the line-merge fix.
          if (/\s/.test(source[srcPos])) continue;

          let normWindow = '';
          let windowEnd = srcPos;

          while (windowEnd < srcLen) {
            const ch = source[windowEnd];
            if (/\s/.test(ch)) {
              if (normWindow.length > 0 && !normWindow.endsWith(' ')) {
                normWindow += ' ';
              }
              windowEnd++;
            } else {
              normWindow += ch;
              windowEnd++;
            }

            const trimmedWindow = normWindow.trim();
            if (trimmedWindow === normSearch) {
              let start = srcPos;
              // If the search string carried its own indentation, absorb the
              // file's indentation as well so the replacement lands flush
              // rather than double-indented. Horizontal whitespace ONLY —
              // crossing a newline here is precisely the bug described above.
              if (searchIndented) {
                while (start > 0 && (source[start - 1] === ' ' || source[start - 1] === '\t')) start--;
              }
              return { start, end: windowEnd, fuzzy: true, occurrences: 1 };
            }
            if (trimmedWindow.length > normSearch.length + 10) break;
          }
        }
        return null;
      }

      for (let i = 0; i < args.edits.length; i++) {
        const edit = args.edits[i];
        const match = fuzzyFind(updatedContent, edit.search);
        if (match) {
          const replacement = coerceEol(edit.replace ?? '');
          updatedContent =
            updatedContent.substring(0, match.start) + replacement + updatedContent.substring(match.end);
          const entry = { index: i, search: edit.search.substring(0, 80) };
          // Surface a fuzzy hit so the caller knows the match was approximate
          // and is worth eyeballing.
          if (match.fuzzy) entry.fuzzy = true;
          // Surface ambiguity rather than silently editing the first hit.
          if (match.occurrences > 1) {
            entry.occurrences = match.occurrences;
            entry.note = 'search string is not unique — edited the FIRST occurrence';
          }
          applied.push(entry);
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
