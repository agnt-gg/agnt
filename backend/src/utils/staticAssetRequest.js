/**
 * Distinguishes a request for a build artefact from a request for an SPA route.
 *
 * The catch-all `app.get('*')` answers everything the static middleware missed
 * with `index.html`. For `/settings` that is exactly right. For
 * `/assets/js/Settings.B4rtEn8e.js` — a hash that a rebuild deleted — it is a
 * lie: the browser gets 200 OK with `text/html`, refuses to execute it as a
 * module script, and the lazy screen renders blank. A 404 lets the client
 * recognise the condition and recover.
 *
 * Anything under `assets/` is a build artefact by construction; elsewhere the
 * file extension decides. `.html` is deliberately excluded — that is a document
 * request and belongs to the SPA.
 */

const ASSET_EXTENSIONS = new Set([
  // code + maps
  'js', 'mjs', 'cjs', 'css', 'map', 'wasm',
  // data
  'json', 'xml', 'txt', 'csv',
  // images
  'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif', 'ico', 'bmp',
  // fonts
  'woff', 'woff2', 'ttf', 'otf', 'eot',
  // media
  'mp3', 'wav', 'ogg', 'mp4', 'webm', 'mov',
  // bundles
  'pdf', 'zip', 'gz',
]);

/**
 * @param {string} pathname Request path, query already stripped by express.
 * @returns {boolean} true when a miss should be a 404 rather than index.html.
 */
export function isStaticAssetRequest(pathname) {
  if (typeof pathname !== 'string' || pathname === '') return false;

  // Vite's assetsDir. Every file here is content-hashed and immutable; a miss
  // is always a stale reference, never a route.
  if (pathname.startsWith('/assets/')) return true;

  const lastSegment = pathname.slice(pathname.lastIndexOf('/') + 1);
  const dot = lastSegment.lastIndexOf('.');
  if (dot <= 0) return false; // no extension, or a dotfile like `.well-known`

  const ext = lastSegment.slice(dot + 1).toLowerCase();
  return ASSET_EXTENSIONS.has(ext);
}

export const STATIC_ASSET_EXTENSIONS = ASSET_EXTENSIONS;
