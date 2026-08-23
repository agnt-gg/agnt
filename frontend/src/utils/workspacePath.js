/**
 * Turning a rendered `/api/local-file/...` URL back into a workspace-relative
 * path, so chat can publish a preview the same way Artifacts does.
 *
 * Chat renders local HTML two ways — an `<iframe src="/api/local-file/...">`
 * the assistant emitted, and a ```html code block paired with a file on disk.
 * Both display a real file, but the publish pipeline
 * (`POST /api/filesystem/publish-manifest`) takes a WORKSPACE-RELATIVE entry
 * path: `normalizeBundlePath` in backend/src/services/artifactBundles/manifest.js
 * rejects absolute paths and drive letters outright, because accepting them
 * would make the bundle root user-controlled. So the URL has to come back to a
 * relative path here, on the client, before it can be published.
 *
 * A path that does not live under the workspace root is NOT an error — it is a
 * file we decline to publish (plugin output under %APPDATA%, a temp render, a
 * remote URL). Every function returns '' for that case and callers hide the
 * Share affordance rather than offering one that cannot work.
 */

import { API_CONFIG } from '@/tt.config.js';
import { getSettings } from '@/services/fileSystemService.js';

const LOCAL_FILE_SEGMENT = '/local-file/';

/**
 * Inverse of `buildLocalFileUrl` in utils/localFileUrl.js.
 *
 * That builder produces `${API_CONFIG.BASE_URL}/local-file/${encodeURI(path)}`
 * plus an optional `?_=<messageId>` cache-bust, so this strips the same prefix,
 * drops the query/fragment and decodes. Matching on the configured base — not
 * a bare `/local-file/` substring — is deliberate: a third-party URL that
 * happens to contain that segment must not be mistaken for a local file.
 *
 * @param {string} value - An iframe/img src.
 * @returns {string} Absolute filesystem path, or '' when this is not one of ours.
 */
export function localFileUrlToAbsolutePath(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  const candidates = [`${API_CONFIG.BASE_URL}${LOCAL_FILE_SEGMENT}`];
  // Same-origin relative form (`/api/local-file/...`). The renderer normally
  // emits the absolute base, but HTML written by hand or by an older build can
  // use the path form, and it resolves to the identical endpoint.
  try {
    const apiPath = new URL(API_CONFIG.BASE_URL, 'http://localhost').pathname.replace(/\/+$/, '');
    candidates.push(`${apiPath}${LOCAL_FILE_SEGMENT}`);
  } catch {
    candidates.push(`/api${LOCAL_FILE_SEGMENT}`);
  }

  const base = candidates.find((prefix) => raw.startsWith(prefix));
  if (!base) return '';

  const tail = raw.slice(base.length).split(/[?#]/)[0];
  if (!tail) return '';
  try {
    return decodeURI(tail);
  } catch {
    return tail;
  }
}

/** Only an HTML document can be the entry point of a creation bundle. */
export function isPublishableEntry(absolutePath) {
  return /\.html?$/i.test(String(absolutePath || '').split(/[?#]/)[0]);
}

const normalizeSeparators = (value) => String(value || '').replace(/\\/g, '/');

/**
 * Windows drive-letter paths compare case-insensitively; POSIX paths do not.
 *
 * Deriving this from the path SHAPE rather than from `navigator` keeps the
 * function pure and testable. A case-only mismatch on a case-insensitive POSIX
 * volume (macOS default) therefore just hides the Share button — the safe
 * direction to be wrong in, versus resolving a path against the wrong root.
 */
const comparableFor = (path) => (/^[a-z]:/i.test(path) ? path.toLowerCase() : path);

/**
 * Express `absolutePath` relative to `workspaceRoot`.
 *
 * Prefix matching is done on the root PLUS a separator so `C:/work` does not
 * swallow `C:/workspace-other` — the same collision the backend's
 * `validatePath` guards against with `path.relative`.
 *
 * @returns {string} Relative POSIX path, or '' when the file is outside the root.
 */
export function toWorkspaceRelative(absolutePath, workspaceRoot) {
  const file = normalizeSeparators(absolutePath).replace(/\/+$/, '');
  const root = normalizeSeparators(workspaceRoot).replace(/\/+$/, '');
  if (!file || !root) return '';

  const comparableFile = comparableFor(file);
  const comparableRoot = comparableFor(root);
  if (!comparableFile.startsWith(`${comparableRoot}/`)) return '';

  const relative = file.slice(root.length + 1);
  // A traversal or empty segment means the path was never really inside the
  // root. The backend rejects these too; refusing here keeps the button honest.
  if (!relative || relative.split('/').some((part) => !part || part === '.' || part === '..')) return '';
  return relative;
}

let workspaceRootPromise = null;

/**
 * The workspace root, fetched once per session.
 *
 * Every rendered message asks whether its preview is publishable, so an
 * uncached lookup would issue one request per preview on a long conversation.
 * The promise itself is cached (not just its value) so concurrent callers
 * share a single in-flight request. A failure clears the cache so the next
 * call retries instead of pinning a transient error for the whole session.
 */
export async function getWorkspaceRoot() {
  if (!workspaceRootPromise) {
    workspaceRootPromise = getSettings()
      .then((settings) => settings?.workspaceRoot || '')
      .catch((error) => {
        workspaceRootPromise = null;
        throw error;
      });
  }
  return workspaceRootPromise;
}

/** Test seam and settings-change hook. */
export function resetWorkspaceRootCache() {
  workspaceRootPromise = null;
}

/**
 * Workspace-relative entry path for a file on disk, or '' when it cannot be
 * published. Never throws — a failed settings lookup means "not publishable",
 * which is the correct fallback for a UI affordance.
 */
export async function resolveWorkspaceEntry(absolutePath) {
  if (!absolutePath || !isPublishableEntry(absolutePath)) return '';
  try {
    return toWorkspaceRelative(absolutePath, await getWorkspaceRoot());
  } catch {
    return '';
  }
}

/**
 * A human title for a creation, derived from its path.
 *
 * `index.html` is the overwhelmingly common entry name and makes a useless
 * title, so an index entry is named after its directory instead — the folder
 * is what the user actually calls the thing.
 */
export function titleFromEntryPath(absolutePath) {
  const parts = normalizeSeparators(absolutePath).split('/').filter(Boolean);
  const fileName = parts.pop() || '';
  const stem = fileName.replace(/\.[^.]+$/, '');
  const chosen = /^index$/i.test(stem) && parts.length ? parts[parts.length - 1] : stem;
  if (!chosen) return 'My Creation';
  return chosen
    .replace(/[-_]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}
