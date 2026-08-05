/**
 * Size ceiling for a custom background, shared by every way one can be set.
 *
 * There are two ingress points — the Settings → Theme file picker and the
 * `set_background_image` chat tool — and they must agree, or a file the
 * assistant happily installs is one the settings panel would have refused
 * (or vice versa). Both now read these constants.
 *
 * The old picker limits (5MB image / 20MB video) are from when backgrounds
 * were persisted as base64 in localStorage. They are Blobs in IndexedDB now,
 * where an ordinary 4K wallpaper is unremarkable, so the ceiling only needs to
 * stop something absurd.
 *
 * MIRRORED in backend/src/services/orchestrator/appearanceTools.js, which
 * enforces the same numbers before emitting the event so an oversized file is
 * reported to the model as a tool error. Both sides pin the values in a test.
 */

export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

/** Human-readable size, e.g. 25MB — used in both surfaces' error copy. */
export function formatMb(bytes) {
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10}MB`;
}

/** Ceiling for a background of the given kind. Unknown kinds get the image limit. */
export function maxBytesFor(kind) {
  return kind === 'video' ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
}

export default { MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, maxBytesFor, formatMb };
