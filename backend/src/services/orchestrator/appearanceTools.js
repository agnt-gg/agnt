// Live appearance control — set the app's background from a chat turn.
//
// SCOPE IS DELIBERATELY EPHEMERAL. The persisted background lives in the
// browser's IndexedDB (theme store, key `customBackgroundImage_<theme>`) and is
// written by exactly one thing: the file picker in Settings → Theme. That is
// the user's setting, and an assistant should not silently overwrite it.
//
// So this module does NOT touch IndexedDB, localStorage, or the database. It
// emits a frontend event carrying a URL; the theme store holds it in memory as
// an OVERLAY on top of whatever the user configured. Reload the page and the
// user's own background is back, untouched. `clear_background_image` restores
// it immediately without a reload.
//
// TRANSPORT is the proven tutorial rail (tutorialTools.js): tool returns
// `frontendEvents` → OrchestratorService ships each as a `frontend_event` SSE →
// chatUnified.js re-dispatches global-scope ones as a window CustomEvent →
// TerminalLayout.vue (which owns #bg-layer) applies it. Global-scope because a
// background belongs to the window, not to the chat channel that asked for it.
//
// MEDIA DELIVERY reuses /api/local-file, which already enforces auth, the
// credential-shaped-path refusal, root scoping and Range requests. We resolve
// and pre-validate here only so the model gets a real error message instead of
// a silent 403/404 inside an <img> tag.
import fs from 'fs';
import path from 'path';
import { isSecretPath, assertWithinRoots, describeRoots } from '../../utils/localFileScope.js';

// Only renderable backgrounds. #bg-layer renders <img> or <video>; anything
// else would produce a blank layer that looks like a bug.
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg', '.bmp']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.ogg', '.mov', '.m4v']);

export function kindForExtension(ext) {
  const lower = String(ext || '').toLowerCase();
  if (IMAGE_EXTENSIONS.has(lower)) return 'image';
  if (VIDEO_EXTENSIONS.has(lower)) return 'video';
  return null;
}

// Mirrors the chat renderer's file:/// rewrite so both paths produce identical
// URLs for the same file. encodeURI leaves `#` and `?` alone — harmless in a
// browser address bar, but inside a path segment a browser would read them as
// the start of a fragment or query and drop the rest, so both are escaped.
export function toLocalFileUrl(absPath) {
  const forward = String(absPath).replace(/\\/g, '/');
  return `/api/local-file/${encodeURI(forward).replace(/#/g, '%23').replace(/\?/g, '%3F')}`;
}

export function getAppearanceToolSchemas() {
  return [
    {
      type: 'function',
      function: {
        name: 'set_background_image',
        description:
          "Set the app's background to an image or video file on disk, live, without a reload. "
          + 'The change is EPHEMERAL: it overlays the background the user configured in Settings → Theme '
          + 'but never overwrites it, and it disappears on page refresh. Use this to preview or show off a '
          + 'wallpaper the user asked for. Call clear_background_image to restore their own background immediately.',
        parameters: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Absolute path to an image (.png/.jpg/.jpeg/.gif/.webp/.avif/.svg/.bmp) or video (.mp4/.webm/.ogg/.mov/.m4v) file on the local disk.',
            },
          },
          required: ['path'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'clear_background_image',
        description:
          "Remove an ephemeral background set by set_background_image and restore the user's own configured "
          + 'background immediately. Safe to call when nothing is overlaid — it is a no-op.',
        parameters: { type: 'object', properties: {} },
      },
    },
  ];
}

export async function executeAppearanceTool(functionName, args, authToken, context) {
  switch (functionName) {
    case 'set_background_image': {
      const raw = args && typeof args.path === 'string' ? args.path.trim() : '';
      if (!raw) {
        return { success: false, error: 'set_background_image requires an absolute `path` to an image or video file.' };
      }

      const resolved = path.resolve(raw);
      if (!path.isAbsolute(resolved)) {
        return { success: false, error: `Path must be absolute. Got: ${raw}` };
      }

      // Same refusals /api/local-file applies at serve time, checked up front so
      // the failure is a tool error the model can act on rather than a broken
      // <img> the user has to notice.
      //
      // ORDER MATTERS: the credential refusal runs BEFORE the extension check.
      // The allow-list happens to shadow most secrets (`.pem` is not an image),
      // but `.env` is extensionless and would otherwise be reported as an
      // unsupported file type — and `~/.ssh/avatar.png` is a perfectly valid
      // image extension inside a directory that must never be served. A
      // credential path is refused as a credential whatever it is named.
      if (isSecretPath(resolved)) {
        return { success: false, error: 'Refused: that path looks like a credential file.' };
      }
      const scope = assertWithinRoots(resolved);
      if (!scope.ok) {
        return { success: false, error: `Refused: path is outside the configured local-file roots (${describeRoots()}).` };
      }

      const kind = kindForExtension(path.extname(resolved));
      if (!kind) {
        return {
          success: false,
          error: `Unsupported background type "${path.extname(resolved) || '(none)'}". `
            + `Images: ${[...IMAGE_EXTENSIONS].join(' ')} — Videos: ${[...VIDEO_EXTENSIONS].join(' ')}`,
        };
      }

      let stat;
      try {
        stat = fs.statSync(resolved);
      } catch {
        return { success: false, error: `File not found: ${resolved}` };
      }
      if (!stat.isFile()) {
        return { success: false, error: `Not a file: ${resolved}` };
      }

      const url = toLocalFileUrl(resolved);
      console.log(`[appearanceTools] set_background_image -> ${resolved} (${kind}, ${stat.size} bytes)`);

      return {
        success: true,
        kind,
        fileName: path.basename(resolved),
        absolutePath: resolved,
        bytes: stat.size,
        ephemeral: true,
        message: `Background set to ${path.basename(resolved)} (${kind}). This is a live overlay — the user's saved background is untouched and returns on refresh or clear_background_image.`,
        frontendEvents: [
          { type: 'appearance:background', data: { url, kind, fileName: path.basename(resolved) } },
        ],
      };
    }

    case 'clear_background_image': {
      console.log('[appearanceTools] clear_background_image');
      return {
        success: true,
        message: "Ephemeral background cleared — the user's own background is restored.",
        frontendEvents: [
          { type: 'appearance:background', data: { url: null, kind: null, fileName: null } },
        ],
      };
    }

    default:
      return { success: false, error: `Unknown appearance tool: ${functionName}` };
  }
}
