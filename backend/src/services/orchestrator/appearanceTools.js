// Live appearance control — set the app's background from a chat turn.
//
// THIS IS THE USER'S REAL BACKGROUND SETTING, NOT A SEPARATE ONE.
//
// It used to be an in-memory overlay that vanished on reload and never showed
// up in Settings → Theme. That produced exactly one experience: "you set a
// background, it isn't in my theme settings, and it's gone when I refresh."
// Two background systems meant two behaviours, and the assistant's one was the
// worse half of the product.
//
// So there is now ONE system. `set_background_image` drives the same store
// action the Settings → Theme file picker drives (`setCustomBackgroundImage`),
// against the same IndexedDB key (`customBackgroundImage_<theme>`), and turns
// the "Custom Background" toggle on. The result is indistinguishable from the
// user having picked the file themselves: it applies instantly, it survives a
// reload, and it appears in Settings with its preview, opacity and blur
// controls. `clear_background_image` is the same as the × button plus turning
// the toggle back off.
//
// Because it OVERWRITES the stored background for the active theme, the tool
// description says so — an assistant should tell the user it is replacing
// their wallpaper, not silently swap it.
//
// TRANSPORT is the proven tutorial rail (tutorialTools.js): tool returns
// `frontendEvents` → OrchestratorService ships each as a `frontend_event` SSE →
// chatUnified.js re-dispatches global-scope ones as a window CustomEvent →
// TerminalLayout.vue (which owns #bg-layer) applies it. Global-scope because a
// background belongs to the window, not to the chat channel that asked for it.
//
// MEDIA DELIVERY reuses /api/local-file, which already enforces auth, the
// credential-shaped-path refusal, root scoping and Range requests. The browser
// fetches that URL and stores the resulting Blob, so the background keeps
// working after the file moves or the app restarts. We resolve and pre-validate
// here so the model gets a real error message instead of a silent 403/404.
import fs from 'fs';
import path from 'path';
import { isSecretPath, assertWithinRoots, describeRoots } from '../../utils/localFileScope.js';

// Only renderable backgrounds. #bg-layer renders <img> or <video>; anything
// else would produce a blank layer that looks like a bug.
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg', '.bmp']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.ogg', '.mov', '.m4v']);

// Upper bound on what we will copy into the browser's IndexedDB. This is a
// "don't stuff a Blu-ray in there" guard, not a quality limit — the store holds
// Blobs, not base64, so an ordinary 4K wallpaper is not a problem.
//
// MIRRORS frontend/src/services/backgroundLimits.js. Both files pin these
// numbers in a test, so changing one alone fails loudly on the other side.
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

export function kindForExtension(ext) {
  const lower = String(ext || '').toLowerCase();
  if (IMAGE_EXTENSIONS.has(lower)) return 'image';
  if (VIDEO_EXTENSIONS.has(lower)) return 'video';
  return null;
}

function formatMb(bytes) {
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10}MB`;
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
          "Set the app's background to an image or video file on disk. Applies instantly, with no reload. "
          + "This writes the user's REAL background setting — the same one as Settings → Theme — so it "
          + 'persists across restarts, turns the "Custom Background" toggle on, and shows up in Settings '
          + 'with its preview, opacity and blur controls. It REPLACES whatever background the active theme '
          + 'already had, so tell the user their previous wallpaper is being swapped. '
          + 'Call clear_background_image to remove it and go back to the plain theme background.',
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
          "Remove the active theme's custom background and turn the \"Custom Background\" setting off, "
          + 'returning the app to its plain theme background. Equivalent to the × button in '
          + 'Settings → Theme. Safe to call when no custom background is set — it is a no-op.',
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

      // Checked here rather than in the browser so an oversized file is a tool
      // error the model can report, not a silent failure after the event ships.
      const maxBytes = kind === 'video' ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
      if (stat.size > maxBytes) {
        return {
          success: false,
          error: `That ${kind} is ${formatMb(stat.size)}, over the ${formatMb(maxBytes)} background limit. `
            + 'Pick a smaller file or downscale it first.',
        };
      }

      const url = toLocalFileUrl(resolved);
      console.log(`[appearanceTools] set_background_image -> ${resolved} (${kind}, ${stat.size} bytes)`);

      return {
        success: true,
        kind,
        fileName: path.basename(resolved),
        absolutePath: resolved,
        bytes: stat.size,
        persisted: true,
        message: `Background set to ${path.basename(resolved)} (${kind}). This is the user's real theme `
          + 'background setting: it applies immediately, survives a reload, and is now visible in '
          + "Settings → Theme. It replaced the active theme's previous custom background.",
        frontendEvents: [
          { type: 'appearance:background', data: { url, kind, fileName: path.basename(resolved) } },
        ],
      };
    }

    case 'clear_background_image': {
      console.log('[appearanceTools] clear_background_image');
      return {
        success: true,
        message: "Custom background removed and the \"Custom Background\" setting turned off — the app is "
          + 'back to its plain theme background.',
        frontendEvents: [
          { type: 'appearance:background', data: { url: null, kind: null, fileName: null } },
        ],
      };
    }

    default:
      return { success: false, error: `Unknown appearance tool: ${functionName}` };
  }
}
