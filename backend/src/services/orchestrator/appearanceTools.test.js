// set_background_image is the first tool that reaches out and changes the
// user's own window chrome. Two properties matter more than the happy path:
//
//   1. It must never be able to point the browser at something that is not a
//      renderable media file the user is allowed to see.
//   2. It must set the user's REAL background — the same setting the Settings →
//      Theme picker writes — so it applies instantly, survives a reload, and is
//      visible and reversible in the UI. The old in-memory overlay satisfied
//      none of that and produced "you set a background, it isn't in my theme
//      settings, and it's gone when I refresh."
//
// This module still writes nothing itself; it emits an event and the browser
// does the storing (only the browser has the IndexedDB). So (2) is guarded here
// by asserting the event contract, and end-to-end in the frontend by
// theme.assistantBackground.spec.js.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  getAppearanceToolSchemas,
  executeAppearanceTool,
  kindForExtension,
  toLocalFileUrl,
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
} from './appearanceTools.js';

let tmpDir;
let pngPath;
let mp4Path;
let txtPath;
let subDirPath;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'appearance-tools-'));
  pngPath = path.join(tmpDir, 'annie.png');
  mp4Path = path.join(tmpDir, 'loop.mp4');
  txtPath = path.join(tmpDir, 'notes.txt');
  subDirPath = path.join(tmpDir, 'a-directory.png'); // extension lies; it's a dir
  fs.writeFileSync(pngPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  fs.writeFileSync(mp4Path, Buffer.from([0x00, 0x00, 0x00, 0x18]));
  fs.writeFileSync(txtPath, 'not a background');
  fs.mkdirSync(subDirPath);
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const run = (name, args) => executeAppearanceTool(name, args, 'token', { userId: 'u1' });

describe('schemas', () => {
  const schemas = getAppearanceToolSchemas();
  const names = schemas.map((s) => s.function.name);

  it('exposes exactly the two appearance tools', () => {
    expect(names).toEqual(['set_background_image', 'clear_background_image']);
  });

  it('set_background_image requires a path', () => {
    const s = schemas.find((x) => x.function.name === 'set_background_image');
    expect(s.function.parameters.required).toEqual(['path']);
  });

  it('tells the model the change persists and replaces the current background', () => {
    // The model decides whether to warn the user their wallpaper is being
    // swapped. If the schema stops saying this, it will start describing a
    // permanent, overwriting change as a harmless preview.
    const set = schemas.find((x) => x.function.name === 'set_background_image');
    expect(set.function.description).toMatch(/persist/i);
    expect(set.function.description).toMatch(/replaces/i);
    expect(set.function.description).toMatch(/Settings/);
    // And it must not claim the opposite any more.
    expect(set.function.description.toLowerCase()).not.toMatch(/ephemeral/);
  });

  it('describes clearing as removing the setting, not restoring a previous one', () => {
    const clear = schemas.find((x) => x.function.name === 'clear_background_image');
    expect(clear.function.description).toMatch(/remove/i);
    expect(clear.function.description.toLowerCase()).not.toMatch(/ephemeral/);
  });
});

describe('size limits', () => {
  // MIRRORS frontend/src/services/backgroundLimits.js, which pins the same two
  // numbers. Changing one side alone fails the other side's test — which is
  // the point: a file the assistant installs must be one Settings accepts.
  it('pins the shared ceilings', () => {
    expect(MAX_IMAGE_BYTES).toBe(25 * 1024 * 1024);
    expect(MAX_VIDEO_BYTES).toBe(100 * 1024 * 1024);
  });

  it('refuses an oversized file with an actionable message', async () => {
    const bigPath = path.join(tmpDir, 'huge.png');
    // Sparse file — no need to actually write 25MB of bytes.
    const fd = fs.openSync(bigPath, 'w');
    fs.ftruncateSync(fd, MAX_IMAGE_BYTES + 1);
    fs.closeSync(fd);

    const res = await run('set_background_image', { path: bigPath });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/over the 25MB background limit/);
    expect(res.frontendEvents).toBeUndefined();

    fs.rmSync(bigPath, { force: true });
  });

  it('allows a video that would be over the image limit', async () => {
    const bigVideo = path.join(tmpDir, 'big.mp4');
    const fd = fs.openSync(bigVideo, 'w');
    fs.ftruncateSync(fd, MAX_IMAGE_BYTES + 1);
    fs.closeSync(fd);

    const res = await run('set_background_image', { path: bigVideo });
    expect(res.success).toBe(true);

    fs.rmSync(bigVideo, { force: true });
  });

  it('accepts an ordinary multi-megabyte wallpaper', async () => {
    // The old picker capped images at 5MB, a leftover from persisting base64 in
    // localStorage. A 7MB PNG is a perfectly normal wallpaper and must work.
    const sevenMb = path.join(tmpDir, 'wallpaper.png');
    const fd = fs.openSync(sevenMb, 'w');
    fs.ftruncateSync(fd, 7 * 1024 * 1024);
    fs.closeSync(fd);

    expect((await run('set_background_image', { path: sevenMb })).success).toBe(true);

    fs.rmSync(sevenMb, { force: true });
  });
});

describe('kindForExtension', () => {
  it('classifies images and videos, rejects everything else', () => {
    expect(kindForExtension('.PNG')).toBe('image');
    expect(kindForExtension('.webp')).toBe('image');
    expect(kindForExtension('.mp4')).toBe('video');
    expect(kindForExtension('.webm')).toBe('video');
    expect(kindForExtension('.txt')).toBeNull();
    expect(kindForExtension('.html')).toBeNull();
    expect(kindForExtension('')).toBeNull();
    expect(kindForExtension(undefined)).toBeNull();
  });
});

describe('toLocalFileUrl', () => {
  it('normalises Windows separators', () => {
    expect(toLocalFileUrl('C:\\Users\\Studio\\a.png')).toBe('/api/local-file/C:/Users/Studio/a.png');
  });

  it('percent-encodes spaces', () => {
    expect(toLocalFileUrl('/home/u/my pic.png')).toBe('/api/local-file//home/u/my%20pic.png');
  });

  it('escapes # and ? so the path is not read as a fragment or query', () => {
    // encodeURI leaves both alone; unescaped, everything after them would be
    // dropped from the request path and the image would 404.
    expect(toLocalFileUrl('/home/u/a#b.png')).toBe('/api/local-file//home/u/a%23b.png');
    expect(toLocalFileUrl('/home/u/a?b.png')).toBe('/api/local-file//home/u/a%3Fb.png');
  });

  it('round-trips through the decode the route performs', () => {
    const abs = '/home/u/a b#c?d.png';
    const url = toLocalFileUrl(abs);
    expect(decodeURIComponent(url.replace('/api/local-file/', ''))).toBe(abs);
  });
});

describe('set_background_image — rejections', () => {
  it('rejects a missing path', async () => {
    expect((await run('set_background_image', {})).success).toBe(false);
    expect((await run('set_background_image', { path: '   ' })).success).toBe(false);
  });

  it('rejects a non-media extension', async () => {
    const res = await run('set_background_image', { path: txtPath });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/Unsupported background type/);
  });

  it('rejects a file that does not exist', async () => {
    const res = await run('set_background_image', { path: path.join(tmpDir, 'nope.png') });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/File not found/);
  });

  it('rejects a directory wearing an image extension', async () => {
    const res = await run('set_background_image', { path: subDirPath });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/Not a file/);
  });

  it('rejects an extensionless credential file as a credential, not as a bad type', async () => {
    // `.env` has no extension, so if the allow-list ran first this would be
    // reported as an unsupported file type and the security refusal would be
    // unreachable for exactly the files that most need it.
    const res = await run('set_background_image', { path: path.join(tmpDir, '.env') });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/credential/i);
  });

  it('rejects a real image sitting inside a secret directory', async () => {
    // The case the allow-list cannot catch: valid extension, forbidden location.
    const res = await run('set_background_image', { path: path.join(tmpDir, '.ssh', 'avatar.png') });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/credential/i);
  });

  it('rejects private key material even with an image-ish name', async () => {
    const res = await run('set_background_image', { path: path.join(tmpDir, 'wallpaper.pem') });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/credential/i);
  });

  it('every rejection emits NO frontend event', async () => {
    for (const bad of [{}, { path: txtPath }, { path: path.join(tmpDir, 'nope.png') }, { path: subDirPath }]) {
      const res = await run('set_background_image', bad);
      expect(res.success).toBe(false);
      expect(res.frontendEvents).toBeUndefined();
    }
  });
});

describe('set_background_image — success', () => {
  it('emits exactly one appearance:background event carrying a servable URL', async () => {
    const res = await run('set_background_image', { path: pngPath });
    expect(res.success).toBe(true);
    expect(res.kind).toBe('image');
    expect(res.fileName).toBe('annie.png');
    expect(res.persisted).toBe(true);
    expect(res.ephemeral).toBeUndefined();
    expect(res.frontendEvents).toHaveLength(1);
    expect(res.frontendEvents[0].type).toBe('appearance:background');
    expect(res.frontendEvents[0].data.url).toBe(toLocalFileUrl(pngPath));
    expect(res.frontendEvents[0].data.kind).toBe('image');
  });

  it('classifies video files as video so #bg-layer renders a <video>', async () => {
    const res = await run('set_background_image', { path: mp4Path });
    expect(res.success).toBe(true);
    expect(res.frontendEvents[0].data.kind).toBe('video');
  });

  it('accepts a relative-looking path by resolving it, or fails cleanly', async () => {
    // path.resolve() against cwd — the point is it never throws and never
    // returns success with a non-absolute URL.
    const res = await run('set_background_image', { path: 'definitely-not-here.png' });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/File not found/);
  });

  it('touches nothing on disk — the browser does the storing', async () => {
    const before = fs.readdirSync(tmpDir).sort();
    const res = await run('set_background_image', { path: pngPath });
    expect(res.success).toBe(true);
    expect(fs.readdirSync(tmpDir).sort()).toEqual(before);
  });

  it('tells the user, in the result, that this is their real setting', async () => {
    // The message is what the assistant paraphrases back. If it still called
    // this a temporary overlay, the user would be told the opposite of what
    // just happened to their theme.
    const res = await run('set_background_image', { path: pngPath });
    expect(res.message).toMatch(/Settings/);
    expect(res.message).toMatch(/survives a reload|persist/i);
    expect(res.message.toLowerCase()).not.toMatch(/ephemeral|returns on refresh/);
  });
});

describe('clear_background_image', () => {
  it('emits a null-url event and needs no arguments', async () => {
    const res = await run('clear_background_image', {});
    expect(res.success).toBe(true);
    expect(res.frontendEvents).toHaveLength(1);
    expect(res.frontendEvents[0].type).toBe('appearance:background');
    expect(res.frontendEvents[0].data.url).toBeNull();
  });

  it('reports removing the setting, not restoring a hidden previous one', async () => {
    const res = await run('clear_background_image', {});
    expect(res.message).toMatch(/removed/i);
    expect(res.message.toLowerCase()).not.toMatch(/ephemeral/);
  });

  it('is safe with no args at all', async () => {
    expect((await run('clear_background_image', undefined)).success).toBe(true);
  });
});

describe('unknown tool', () => {
  it('fails closed', async () => {
    const res = await run('set_background_colour', { path: pngPath });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/Unknown appearance tool/);
  });
});
