import fs from 'fs/promises';
import path from 'path';
import PathManager from '../../utils/PathManager.js';
import {
  findMatches,
  describeMiss,
  describeAmbiguity,
  shiftRecords,
  renderDiff,
  lineAt,
  lineStartAt,
  lineEndAt,
  MATCH_TIERS,
} from './fileEditMatcher.js';
import { observe, checkStale, getObservation, hashContent } from './fileObservations.js';
import { grepFiles, globFiles, looksBinary, DEFAULTS as SEARCH_DEFAULTS } from './fileSearch.js';

const DEFAULT_WORKSPACE_ROOT = PathManager.getPath('projects');
const SETTINGS_FILE = PathManager.getPath('code-settings.json');

/**
 * Hard ceiling on the text a single read returns.
 *
 * This cap already existed — it was just invisible and unnavigable. The
 * orchestrator truncates every tool result at `toolOutputCap` (default 100,000
 * chars, OrchestratorService.js), so an 822,617-char read — the largest in
 * production history — was being silently chopped with no marker and no way to
 * ask for the rest. Making the cap explicit, slightly below the envelope so the
 * JSON wrapper fits, and pairing it with `offset`/`limit` turns a silent
 * truncation into a paginated read.
 */
export const MAX_READ_CHARS = 80_000;

/** Snippets echoed back in a diff hunk are clipped to keep failures cheap. */
const MAX_DIFF_BLOCK_CHARS = 600;

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
function validatePath(inputPath, workspaceRoot, { allowEmpty = false } = {}) {
  if (inputPath && path.isAbsolute(inputPath)) {
    return path.resolve(inputPath);
  }
  // `list_files` passes allowEmpty: a directory listing with no argument
  // coherently means "the workspace root". Reading, writing or editing a file
  // with no name does not — hence the distinction below rather than a blanket
  // default. See codeTools.pathRequired.test.js.
  if (allowEmpty && (inputPath === undefined || inputPath === null || inputPath === '')) {
    return path.resolve(workspaceRoot);
  }
  // A missing or blank path is a CALLER ERROR, not a request for the workspace
  // root. `path.resolve(root, '')` returns the root directory itself, so the
  // old `inputPath || ''` silently turned "no path supplied" into "operate on
  // the workspace directory" — and `fs.readFile` on a directory raises
  // `EISDIR: illegal operation on a directory, read`. That error described the
  // symptom (a directory was read) and hid the cause (no path was given),
  // which sent debugging in entirely the wrong direction for months.
  //
  // This is the same sentinel-collision shape as treating 0 as "unset": the
  // empty string is a valid input that happens to mean something catastrophic
  // here, so it must be rejected explicitly rather than defaulted.
  if (typeof inputPath !== 'string' || inputPath.trim() === '') {
    throw new Error(
      "Missing required parameter 'path'. Provide a file path relative to the " +
      'workspace (e.g. "my-project/index.js") or an absolute path.',
    );
  }
  const resolved = path.resolve(workspaceRoot, inputPath);
  const rel = path.relative(workspaceRoot, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Path traversal not allowed');
  }
  return resolved;
}

const PATH_PARAM_DESC =
  'Path to the file. Relative paths resolve against the workspace (e.g. "my-project/index.js"). ' +
  'Absolute paths are also accepted and may point anywhere on disk (e.g. "C:\\\\path\\\\to\\\\file.js" or "/path/to/file.js").';

/**
 * Get tool schemas for code chat context
 */
export function getCodeToolSchemas() {
  return [
    {
      type: 'function',
      function: {
        name: 'read_file',
        description:
          'Read a file from the workspace. Returns the exact text plus size, line count and a content hash. ' +
          `Reads are capped at ${MAX_READ_CHARS.toLocaleString('en-US')} characters — use offset/limit to page through anything larger. ` +
          'Text returned here is byte-exact and safe to copy verbatim into an edit_file search string.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: PATH_PARAM_DESC },
            offset: {
              type: 'integer',
              description: 'Optional 1-based line number to start reading from. Use with limit to page through a large file.',
            },
            limit: {
              type: 'integer',
              description: 'Optional number of lines to return, starting at offset.',
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
        description:
          'Write content to a file in the workspace. Creates the file and any parent directories if they do not exist. ' +
          'Use this only for creating NEW files or complete rewrites — it replaces the entire file. ' +
          'For targeted changes use edit_file, which cannot destroy content it was not shown.',
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
        description:
          'Apply surgical search/replace edits to an existing file. Each edit is a { search, replace } pair. ' +
          'Search strings must match text that is actually in the file right now — read it first if you are not certain. ' +
          'Edits are ALL-OR-NOTHING: if any search misses, nothing is written and the response tells you what the file actually says. ' +
          'A search that matches more than once is refused rather than applied to the first hit; add surrounding context or set replace_all.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: PATH_PARAM_DESC },
            edits: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  search: { type: 'string', description: 'Exact string to find in the current file content' },
                  replace: { type: 'string', description: 'Replacement string' },
                  replace_all: {
                    type: 'boolean',
                    description: 'Replace every occurrence instead of failing when the search string is not unique. Default false.',
                  },
                },
                required: ['search', 'replace'],
              },
              description: 'Array of search/replace pairs to apply sequentially',
            },
            description: {
              type: 'string',
              description: 'Brief summary of what these edits accomplish (optional, used only to label the result)',
            },
          },
          // `description` is deliberately NOT required: it is read only at the
          // end of the case body to label the success message (`Applied N/M
          // edits to <path>: <description>`). The edit itself succeeds
          // identically without it, and 3 real production calls did exactly
          // that. `required` should describe what execution depends on.
          //
          // This is schema hygiene, not a safety control — the pre-execution
          // guard blocks only calls where EVERY required parameter is absent
          // (see toolArgGuard.js), so an omitted description was never at risk
          // of being blocked. Stating it accurately anyway keeps the array
          // meaningful for the model and for any future consumer.
          required: ['path', 'edits'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'list_files',
        description: 'List files and directories in the workspace at the given path (one level). Use glob_files to search recursively.',
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
    {
      type: 'function',
      function: {
        name: 'grep_files',
        description:
          'Search file CONTENTS for a regular expression, recursively. Returns matching lines with their file path and line number. ' +
          'Use this instead of shelling out to grep/findstr/rg — it is platform independent, skips node_modules/dist/.git and binaries, and returns structured results.',
        parameters: {
          type: 'object',
          properties: {
            pattern: { type: 'string', description: 'JavaScript regular expression to search for (or a literal string when literal=true).' },
            path: { type: 'string', description: 'File or directory to search. Defaults to the workspace root.' },
            glob: { type: 'string', description: 'Only search files whose path matches this glob, e.g. "**/*.js" or "*.test.js".' },
            literal: { type: 'boolean', description: 'Treat pattern as a literal string rather than a regex. Default false.' },
            ignore_case: { type: 'boolean', description: 'Case-insensitive search. Default false.' },
            context: { type: 'integer', description: 'Lines of surrounding context to include with each match (0-3). Default 0.' },
            max_results: { type: 'integer', description: `Maximum matching lines to return. Default ${SEARCH_DEFAULTS.maxResults}, cap ${SEARCH_DEFAULTS.maxResultsCap}.` },
          },
          required: ['pattern'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'glob_files',
        description:
          'Find files by PATH pattern, recursively, sorted most-recently-modified first. Supports **, *, ? and {a,b}. ' +
          'A pattern with no "/" matches the file name at any depth, so "*.test.js" finds every test file.',
        parameters: {
          type: 'object',
          properties: {
            pattern: { type: 'string', description: 'Glob pattern, e.g. "**/*.vue", "src/**/index.js" or "*.test.js".' },
            path: { type: 'string', description: 'Directory to search under. Defaults to the workspace root.' },
            max_results: { type: 'integer', description: `Maximum files to return. Default ${SEARCH_DEFAULTS.maxGlobResults}, cap ${SEARCH_DEFAULTS.maxGlobResultsCap}.` },
          },
          required: ['pattern'],
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

// ------------------------------------------------------------ atomic write ---

/**
 * Write via a sibling temp file and rename.
 *
 * `fs.writeFile` truncates the destination and then streams into it, so a crash,
 * a full disk or a killed process mid-write leaves a TRUNCATED real file. rename
 * is atomic within a filesystem, so the destination is only ever the old
 * complete file or the new complete file.
 *
 * The temp file is a sibling deliberately — a cross-device rename fails with
 * EXDEV, and os.tmpdir() is very often on a different volume.
 *
 * Windows makes rename fail transiently when an indexer or antivirus holds a
 * handle open, hence the short retry. If it still will not rename, fall back to
 * a direct write rather than failing the caller: a rare torn-write risk is a
 * better trade than an operation that refuses to work at all on some machines.
 */
async function writeFileAtomic(absPath, content) {
  const dir = path.dirname(absPath);
  const tmp = path.join(dir, `.${path.basename(absPath)}.${process.pid}.${Date.now().toString(36)}.tmp`);

  await fs.writeFile(tmp, content, 'utf-8');
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await fs.rename(tmp, absPath);
      return { atomic: true };
    } catch (err) {
      const transient = err.code === 'EPERM' || err.code === 'EACCES' || err.code === 'EBUSY';
      if (!transient || attempt === 2) {
        await fs.rm(tmp, { force: true }).catch(() => {});
        if (!transient) throw err;
        await fs.writeFile(absPath, content, 'utf-8');
        return { atomic: false };
      }
      await new Promise((r) => setTimeout(r, 50 * (attempt + 1)));
    }
  }
  return { atomic: false };
}

/**
 * Read a file as text, refusing binaries.
 *
 * A binary read used to succeed: the bytes came back decoded as UTF-8, full of
 * U+FFFD replacement characters, with `success: true`. Anything downstream then
 * reasoned about corrupted text — and an edit against it would have written the
 * corruption back to disk, destroying the file.
 */
async function readTextFile(absPath, relPathForMessage) {
  const buf = await fs.readFile(absPath);
  if (looksBinary(buf)) {
    return {
      binary: true,
      error:
        `Binary file (${buf.length.toLocaleString('en-US')} bytes): ${relPathForMessage}. ` +
        'These tools return and edit UTF-8 text; decoding this would produce replacement ' +
        'characters, and writing it back would corrupt the file.',
    };
  }
  return { binary: false, content: buf.toString('utf8'), bytes: buf.length };
}

/** Split preserving exact bytes: '\r' stays on the line, join('\n') restores it. */
function splitLines(content) {
  return content.split('\n');
}

function countLines(content) {
  if (content === '') return 0;
  const n = splitLines(content).length;
  return content.endsWith('\n') ? n - 1 : n;
}

/** Normalize a possibly-stringified array argument. Returns { edits } or { error }. */
function coerceEdits(raw) {
  let edits = raw;
  if (typeof edits === 'string') {
    try {
      edits = JSON.parse(edits);
    } catch {
      return { error: "Parameter 'edits' must be an array of { search, replace } objects, but a non-JSON string was supplied." };
    }
  }
  if (!Array.isArray(edits)) {
    return { error: `Parameter 'edits' must be an array of { search, replace } objects (received ${edits === null ? 'null' : typeof edits}).` };
  }
  if (edits.length === 0) {
    return { error: "Parameter 'edits' is empty — supply at least one { search, replace } pair." };
  }
  for (let i = 0; i < edits.length; i++) {
    const e = edits[i];
    if (!e || typeof e !== 'object' || Array.isArray(e)) {
      return { error: `edits[${i}] must be an object with "search" and "replace" string properties.` };
    }
    if (typeof e.search !== 'string' || e.search === '') {
      return { error: `edits[${i}].search must be a non-empty string. An empty search matches nothing and would be applied at an arbitrary position.` };
    }
    if (e.replace !== undefined && typeof e.replace !== 'string') {
      return { error: `edits[${i}].replace must be a string (use "" to delete).` };
    }
  }
  return { edits };
}

const clipBlock = (s) => (s.length <= MAX_DIFF_BLOCK_CHARS ? s : `${s.slice(0, MAX_DIFF_BLOCK_CHARS)}…`);

async function executeCodeFunctionUnlocked(name, args) {
  // Ensure workspace exists
  const WORKSPACE_ROOT = await getWorkspaceRoot();
  await fs.mkdir(WORKSPACE_ROOT, { recursive: true });

  let result;

  switch (name) {
    case 'read_file': {
      const absPath = validatePath(args.path, WORKSPACE_ROOT);
      try {
        const read = await readTextFile(absPath, args.path);
        if (read.binary) {
          result = { success: false, error: read.error, path: args.path, absolutePath: absPath };
          break;
        }

        const full = read.content;
        // Observe the WHOLE file even on a paged read: the hash identifies the
        // file, and a page is still a genuine sighting of that identity.
        observe(pathLockKey(absPath), full, { path: absPath });

        const totalLines = countLines(full);
        const hasWindow = Number.isInteger(args.offset) || Number.isInteger(args.limit);

        let content = full;
        let startLine = 1;
        let endLine = totalLines;
        let truncated = false;
        const notes = [];

        if (hasWindow) {
          const lines = splitLines(full);
          const from = Math.max(1, Number.isInteger(args.offset) ? args.offset : 1);
          const count = Number.isInteger(args.limit) && args.limit > 0 ? args.limit : lines.length;
          const sliceEnd = Math.min(lines.length, from - 1 + count);
          content = lines.slice(from - 1, sliceEnd).join('\n');
          startLine = from;
          endLine = Math.min(totalLines, from - 1 + count);
          if (sliceEnd < lines.length) truncated = true;
        }

        if (content.length > MAX_READ_CHARS) {
          const kept = content.slice(0, MAX_READ_CHARS);
          // Prefer a line boundary so the returned text is always whole lines
          // and therefore always safe to copy into an edit search string.
          const lastNl = kept.lastIndexOf('\n');
          content = lastNl > MAX_READ_CHARS / 2 ? kept.slice(0, lastNl) : kept;
          endLine = startLine - 1 + countLines(content.endsWith('\n') ? content : `${content}\n`);
          truncated = true;
          notes.push(`Output capped at ${MAX_READ_CHARS.toLocaleString('en-US')} characters.`);
        }

        if (truncated) {
          notes.push(`Showing lines ${startLine}-${endLine} of ${totalLines}. Continue with offset: ${endLine + 1}.`);
        }

        result = {
          success: true,
          content,
          path: args.path,
          absolutePath: absPath,
          bytes: read.bytes,
          totalLines,
          startLine,
          endLine,
          truncated,
          hash: hashContent(full),
        };
        if (notes.length) result.note = notes.join(' ');
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
      const content = args.content || '';

      // Report an overwrite rather than performing it silently. write_file
      // replacing a file the caller had never looked at is a real way to lose
      // work, and the only cheap defence is making it visible in the result.
      let previous = null;
      try {
        const stat = await fs.stat(absPath);
        if (stat.isFile()) previous = { bytes: stat.size };
      } catch { /* new file */ }

      await fs.mkdir(path.dirname(absPath), { recursive: true });
      await writeFileAtomic(absPath, content);
      observe(pathLockKey(absPath), content, { path: absPath });

      result = {
        success: true,
        path: args.path,
        absolutePath: absPath,
        bytes: content.length,
        created: previous === null,
        frontendEvents: [{ type: 'file_written', data: { path: args.path, content } }],
      };
      if (previous) {
        result.overwrote = true;
        result.previousBytes = previous.bytes;
        result.note =
          `Replaced an existing ${previous.bytes.toLocaleString('en-US')}-byte file with ` +
          `${content.length.toLocaleString('en-US')} bytes. Use edit_file for targeted changes.`;
      }
      break;
    }

    case 'edit_file': {
      const absPath = validatePath(args.path, WORKSPACE_ROOT);

      const coerced = coerceEdits(args.edits);
      if (coerced.error) {
        result = { success: false, error: coerced.error };
        break;
      }
      const edits = coerced.edits;

      let currentContent;
      let originalBytes;
      try {
        const read = await readTextFile(absPath, args.path);
        if (read.binary) {
          result = { success: false, error: read.error };
          break;
        }
        currentContent = read.content;
        originalBytes = read.bytes;
      } catch (err) {
        if (err.code === 'ENOENT') {
          result = { success: false, error: `File not found: ${args.path}. Use write_file to create new files.` };
          break;
        }
        throw err;
      }

      // ---- Staleness ------------------------------------------------------
      // The path lock serializes AGNT's own tool calls. It cannot serialize the
      // user's editor, a shell command or a patch script, so an edit can still
      // be computed against content that no longer exists on disk. Refusing is
      // the only safe answer: applying it would delete the other writer's work
      // and report success.
      const lockKey = pathLockKey(absPath);
      // Captured BEFORE this call observes anything, so it answers "had anyone
      // looked at this file before now?" rather than "did we just look at it?".
      const priorObservation = getObservation(lockKey);
      const stale = checkStale(lockKey, currentContent);
      if (stale) {
        result = {
          success: false,
          error: `File changed on disk since it was last read: ${args.path}`,
          stale: {
            observedHash: stale.priorHash,
            currentHash: stale.currentHash,
            observedBytes: stale.priorSize,
            currentBytes: stale.currentSize,
            observedAt: new Date(stale.observedAt).toISOString(),
          },
          message:
            'Something else modified this file after it was last read — most likely an ' +
            'editor, a shell command or another agent. Editing against the version you ' +
            'have would silently discard those changes, so nothing was written. Call ' +
            'read_file on this path and rebuild the edit from what is actually there.',
        };
        break;
      }

      // ---- Matching -------------------------------------------------------
      //
      // Layered: exact, then line-ending normalized, then whitespace
      // insensitive. Every layer counts ALL occurrences, so ambiguity is a
      // refusal rather than a silent edit of whichever hit came first.
      //
      // The line-ending layer is load-bearing, not a nicety. Callers write
      // search strings with "\n"; on a CRLF file `indexOf` can never match, so
      // before it existed EVERY multi-line edit fell through to the fuzzy
      // matcher — which was never designed to be the common path and welded
      // replacement text onto the end of the preceding line.
      const crlfCount = (currentContent.match(/\r\n/g) || []).length;
      const lfCount = (currentContent.match(/(?<!\r)\n/g) || []).length;
      const dominantEol = crlfCount > lfCount ? '\r\n' : '\n';
      const coerceEol = (s) =>
        typeof s === 'string' ? s.replace(/\r\n/g, '\n').replace(/\n/g, dominantEol) : s;

      let updatedContent = currentContent;
      const applied = [];
      const failed = [];
      const records = [];

      for (let i = 0; i < edits.length; i++) {
        const edit = edits[i];
        const found = findMatches(updatedContent, edit.search);

        if (!found) {
          failed.push({ index: i, ...describeMiss(updatedContent, edit.search) });
          continue;
        }

        const replaceAll = edit.replace_all === true || edit.replaceAll === true;
        if (found.matches.length > 1 && !replaceAll) {
          failed.push({ index: i, ...describeAmbiguity(updatedContent, edit.search, found.matches, found.tier) });
          continue;
        }

        const replacement = coerceEol(edit.replace ?? '');
        const targets = replaceAll ? found.matches : [found.matches[0]];
        const firstLine = lineAt(updatedContent, targets[0].start);

        // Splice right-to-left so earlier offsets stay valid within this edit.
        for (let t = targets.length - 1; t >= 0; t--) {
          const { start, end } = targets[t];
          const ls = lineStartAt(updatedContent, start);
          const le = lineEndAt(updatedContent, end);
          const prefix = updatedContent.slice(ls, start);
          const suffix = updatedContent.slice(end, le);
          const removed = updatedContent.slice(start, end);

          shiftRecords(records, start, end, replacement.length);
          records.push({
            finalStart: start,
            oldBlock: clipBlock(prefix + removed + suffix),
            newBlock: clipBlock(prefix + replacement + suffix),
          });

          updatedContent = updatedContent.slice(0, start) + replacement + updatedContent.slice(end);
        }

        const entry = {
          index: i,
          search: edit.search.substring(0, 80),
          line: firstLine,
          tier: found.tier,
          replacements: targets.length,
        };
        // Preserved for callers that key on it: a whitespace-tier hit matched
        // approximately and is worth eyeballing.
        if (found.tier === MATCH_TIERS.WHITESPACE) entry.fuzzy = true;
        if (targets.length > 1) entry.occurrences = found.matches.length;
        applied.push(entry);
      }

      // ---- All-or-nothing -------------------------------------------------
      //
      // Partial application used to return `success: true` with a `failed[]`
      // array alongside it, and 82 production calls left a file half-edited
      // while reporting success. A half-edited file is the worst possible
      // state: the model's mental model and the bytes on disk have diverged,
      // and the next edit is computed against neither. Writing nothing keeps
      // the file exactly as the caller last understood it.
      if (failed.length > 0) {
        // The remedy sentence must not point at a field that is absent.
        // `didYouMean` is omitted when nothing in the file resembles the search
        // — deliberately, since an unrelated suggestion invites a second wrong
        // guess — and in that case the correct instruction is the opposite one:
        // re-read, or check the path. Sending the reader to a section that is
        // not there costs exactly the round trip this diagnostic exists to save.
        const haveCandidates = failed.some((f) => f.didYouMean);
        const state = applied.length === 0
          ? 'No edits were applied and the file is unchanged.'
          : 'Edits are all-or-nothing, so the file is unchanged.';
        const remedy = haveCandidates
          ? 'Use the "didYouMean" text below — it is copied verbatim from the file — and resend the whole set.'
          : 'Nothing in this file resembles the failed search string, so there is nothing to suggest. Re-read the file, or check that this is the right path, before resending.';
        result = {
          success: false,
          error:
            applied.length === 0
              ? 'None of the search strings were found in the file.'
              : `${failed.length} of ${edits.length} edits could not be applied — nothing was written.`,
          failed,
          wouldHaveApplied: applied,
          path: args.path,
          totalLines: countLines(currentContent),
          message: `${state} ${remedy}`,
        };
        // A failure on a file nobody has read is a DIFFERENT diagnosis from a
        // failure on one that is already in context, and it deserves to say so.
        // Measured over production history: edits against a file the execution
        // had never read failed at 7.4%, versus 4.9% when it had — 1.51x.
        //
        // This is a hint, not a gate. Forcing a read before every edit caps out
        // at 17% of failures (the other 50% happen on files that WERE read) and
        // costs ~40 extra reads per failure prevented, so the interlock is a bad
        // trade. Naming the condition on the failure path is free.
        //
        // "Not read" means not seen since the server started, by any
        // conversation — the ledger is process-global. That errs toward staying
        // quiet, which is the right direction: a false nag is worse than a
        // missed one.
        if (!priorObservation) {
          result.grounding = 'This file has not been read in this session.';
          result.message +=
            ' Note: this file has not been read in this session, so the search ' +
            'strings were written from memory rather than from its actual ' +
            'contents. Call read_file on it before retrying.';
        }
        break;
      }

      await writeFileAtomic(absPath, updatedContent);
      observe(lockKey, updatedContent, { path: absPath });

      result = {
        success: true,
        applied,
        description: args.description,
        path: args.path,
        bytesBefore: originalBytes,
        bytesAfter: Buffer.byteLength(updatedContent, 'utf8'),
        diff: renderDiff(updatedContent, records),
        message: `Applied ${applied.length}/${edits.length} edits to ${args.path}${args.description ? `: ${args.description}` : ''}`,
        frontendEvents: [{ type: 'file_written', data: { path: args.path, content: updatedContent } }],
      };
      break;
    }

    case 'list_files': {
      const relDir = args.path || '';
      const absDir = validatePath(relDir, WORKSPACE_ROOT, { allowEmpty: true });
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

    case 'grep_files': {
      if (typeof args.pattern !== 'string' || args.pattern === '') {
        result = { success: false, error: "Missing required parameter 'pattern'." };
        break;
      }
      const absRoot = validatePath(args.path, WORKSPACE_ROOT, { allowEmpty: true });
      try {
        const found = await grepFiles(absRoot, {
          pattern: args.pattern,
          glob: typeof args.glob === 'string' && args.glob ? args.glob : null,
          literal: args.literal === true,
          ignoreCase: args.ignore_case === true || args.ignoreCase === true,
          maxResults: Number.isInteger(args.max_results) ? args.max_results : SEARCH_DEFAULTS.maxResults,
          contextLines: Number.isInteger(args.context) ? args.context : 0,
        });
        result = { success: true, root: args.path || '/', pattern: args.pattern, ...found };
        if (found.matches.length === 0) {
          result.message = `No matches for /${args.pattern}/ in ${found.filesScanned} file(s).`;
        }
      } catch (err) {
        if (err.code === 'ENOENT') {
          result = { success: false, error: `Path not found: ${args.path}` };
        } else if (err instanceof SyntaxError) {
          result = { success: false, error: `Invalid regular expression: ${err.message}. Set literal: true to search for it as plain text.` };
        } else {
          throw err;
        }
      }
      break;
    }

    case 'glob_files': {
      if (typeof args.pattern !== 'string' || args.pattern === '') {
        result = { success: false, error: "Missing required parameter 'pattern'." };
        break;
      }
      const absRoot = validatePath(args.path, WORKSPACE_ROOT, { allowEmpty: true });
      try {
        const found = await globFiles(absRoot, {
          pattern: args.pattern,
          maxResults: Number.isInteger(args.max_results) ? args.max_results : SEARCH_DEFAULTS.maxGlobResults,
        });
        result = { success: true, root: args.path || '/', pattern: args.pattern, count: found.files.length, ...found };
        if (found.files.length === 0) {
          result.message = `No files matched "${args.pattern}". Patterns containing "/" match the full relative path; patterns without one match the file name at any depth.`;
        }
      } catch (err) {
        if (err.code === 'ENOENT') {
          result = { success: false, error: `Path not found: ${args.path}` };
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
