/**
 * Media routes — the routes whose responses are loaded by the BROWSER.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS MODULE EXISTS
 * ---------------------------------------------------------------------------
 * Most API routes are called by our own JavaScript, which can set an
 * `Authorization: Bearer` header. A handful are different: their URL ends up in
 * an `<img src>`, `<video src>`, `<iframe src>`, `<link href>`, or a CSS
 * `url()`. Those requests are issued by the browser itself, and a browser
 * CANNOT attach an Authorization header to a subresource load. Ever.
 *
 * So a byte-streaming route guarded by a header-only check is unreachable by
 * the exact consumer it exists to serve. That mismatch sat here undetected for
 * a long time because `authenticateToken` never actually rejected anyone — it
 * set `req.user = { isAuthenticated: false }` and called `next()`. Once that
 * hole was closed, every browser-loaded asset started returning 401:
 *
 *   <img src="/api/filesystem/raw?path=…">   Artifacts image/video/PDF preview
 *   <img src="/api/images/<id>">             generated images, after a reload
 *
 * The cure is not to weaken the auth. It is to recognise that these routes are
 * a distinct CLASS with a distinct credential carrier — the `agnt_media_token`
 * cookie, which is the only carrier that survives both subresource loads and
 * relative-URL resolution inside served HTML — and to guard the whole class
 * with `requireAuthMedia`.
 *
 * ---------------------------------------------------------------------------
 * ADDING A ROUTE THAT STREAMS BYTES
 * ---------------------------------------------------------------------------
 *  1. Guard it with `requireAuthMedia`, never `authenticateToken`.
 *  2. Add its mount prefix here.
 *  3. Add the same prefix to MEDIA_COOKIE_PATHS in
 *     frontend/src/services/mediaAuth.js, or the cookie will never be sent to
 *     it. A cross-file test asserts the two lists agree.
 *
 * Scope note: each prefix is narrow on purpose. The cookie is set once per
 * prefix rather than once at `/api`, so it is never attached to a mutating
 * endpoint — a cookie that reaches POST /api/filesystem/file would be a CSRF
 * carrier, whereas these three are read-only byte streams.
 */

/**
 * Mount prefixes of every route that streams bytes to a browser subresource.
 * Order is irrelevant; exact strings matter (they are also cookie paths).
 */
export const MEDIA_ROUTE_PREFIXES = Object.freeze([
  // Arbitrary absolute path on disk, Range-enabled. Used by chat, widgets and
  // artifact HTML previews via the file:/// → /api/local-file rewrite.
  '/api/local-file',
  // Workspace-relative raw file bytes. Strictly narrower than local-file:
  // validatePath() confines it to the workspace root and rejects traversal.
  '/api/filesystem/raw',
  // Generated images by opaque id, resolved from {{IMAGE_REF:id}} once the
  // in-memory base64 cache is gone (i.e. after any page reload).
  '/api/images',
]);

export default { MEDIA_ROUTE_PREFIXES };
