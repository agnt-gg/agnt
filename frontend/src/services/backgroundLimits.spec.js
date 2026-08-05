// These numbers exist to be THE SAME on both sides of the app. The Settings
// picker and the set_background_image chat tool are two doors into one setting;
// if they disagree, a background the assistant installs is one the settings
// panel would have refused, which is exactly the class of split-brain bug this
// module was created to end.
//
// The matching pin lives in
// backend/src/services/orchestrator/appearanceTools.test.js. Changing one side
// alone turns the other side red on purpose.
import { describe, it, expect } from 'vitest';
import { MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, maxBytesFor, formatMb } from './backgroundLimits.js';

describe('background limits', () => {
  it('pins the shared ceilings', () => {
    expect(MAX_IMAGE_BYTES).toBe(25 * 1024 * 1024);
    expect(MAX_VIDEO_BYTES).toBe(100 * 1024 * 1024);
  });

  it('gives video the larger ceiling', () => {
    expect(maxBytesFor('video')).toBe(MAX_VIDEO_BYTES);
    expect(maxBytesFor('image')).toBe(MAX_IMAGE_BYTES);
  });

  it('falls back to the image ceiling for anything unrecognised', () => {
    // Safer to under-allow than to let an unknown kind through at video size.
    expect(maxBytesFor(undefined)).toBe(MAX_IMAGE_BYTES);
    expect(maxBytesFor(null)).toBe(MAX_IMAGE_BYTES);
    expect(maxBytesFor('audio')).toBe(MAX_IMAGE_BYTES);
  });

  it('clears the old base64-era image cap, so ordinary wallpapers fit', () => {
    // The picker used to refuse anything over 5MB. Backgrounds are Blobs in
    // IndexedDB now; a 7MB PNG is unremarkable and must be accepted.
    expect(MAX_IMAGE_BYTES).toBeGreaterThan(7 * 1024 * 1024);
  });

  it('formats sizes the way both error messages read them', () => {
    expect(formatMb(25 * 1024 * 1024)).toBe('25MB');
    expect(formatMb(100 * 1024 * 1024)).toBe('100MB');
    expect(formatMb(7.5 * 1024 * 1024)).toBe('7.5MB');
  });
});
