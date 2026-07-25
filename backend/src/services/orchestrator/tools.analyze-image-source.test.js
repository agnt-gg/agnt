import { describe, expect, it } from 'vitest';
import { resolveAnalyzeImageSource } from './tools.js';

// Regression coverage for the analyze_image source-selection bug:
// context.imageData (chat uploads) used to be checked FIRST and unconditionally,
// so an explicit file path was silently discarded whenever the user had attached
// an image in the same turn. The caller received a confident analysis of the
// wrong picture and nothing in the response revealed the substitution.

const tinyPng =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9ZdU0v8AAAAASUVORK5CYII=';

const upload = (filename, data = tinyPng, type = 'image/png') => ({ filename, data, type });

// Stand-in for fs.readFile. Resolves only for paths present in `files`.
function fakeReadFile(files) {
  return async (p) => {
    if (!(p in files)) {
      const err = new Error(`ENOENT: no such file or directory, open '${p}'`);
      err.code = 'ENOENT';
      throw err;
    }
    return Buffer.from(files[p]);
  };
}

// First test pays the one-time cost of importing tools.js, which transitively
// pulls in DB init, the plugin registry and friends. Give it room.
describe('resolveAnalyzeImageSource', { timeout: 30000 }, () => {
  describe('an explicit reference beats an active upload', () => {
    it('reads the file path even when an image was uploaded in the same turn', async () => {
      const res = await resolveAnalyzeImageSource({
        image: 'C:\\work\\contact_sheet.jpg',
        uploads: [upload('avatar.png')],
        readFile: fakeReadFile({ 'C:\\work\\contact_sheet.jpg': 'GRID-BYTES' }),
      });

      expect(res.ok).toBe(true);
      expect(res.imageData).toBe(`data:image/jpeg;base64,${Buffer.from('GRID-BYTES').toString('base64')}`);
      expect(res.source).toBe('parameter:file:C:\\work\\contact_sheet.jpg');
      // The upload must not have leaked in.
      expect(res.imageData).not.toContain(tinyPng);
    });

    it('honours a POSIX path alongside an upload', async () => {
      const res = await resolveAnalyzeImageSource({
        image: '/tmp/render/frame.png',
        uploads: [upload('avatar.png')],
        readFile: fakeReadFile({ '/tmp/render/frame.png': 'FRAME' }),
      });

      expect(res.ok).toBe(true);
      expect(res.source).toBe('parameter:file:/tmp/render/frame.png');
    });

    it('accepts a bare filename with an image extension', async () => {
      const res = await resolveAnalyzeImageSource({
        image: 'output.webp',
        uploads: [upload('avatar.png')],
        readFile: fakeReadFile({ 'output.webp': 'WEBP' }),
      });

      expect(res.ok).toBe(true);
      expect(res.source).toBe('parameter:file:output.webp');
      expect(res.imageData.startsWith('data:image/webp;base64,')).toBe(true);
    });

    it('prefers a data URI over an upload', async () => {
      const dataUri = `data:image/png;base64,${tinyPng}`;
      const res = await resolveAnalyzeImageSource({
        image: dataUri,
        uploads: [upload('avatar.png', 'T1RIRVI=')],
      });

      expect(res).toEqual({ ok: true, imageData: dataUri, source: 'parameter:base64' });
    });
  });

  describe('placeholders fall through to the upload', () => {
    it('ignores a prose placeholder and uses the upload', async () => {
      const res = await resolveAnalyzeImageSource({
        image: 'the uploaded image',
        uploads: [upload('avatar.png')],
      });

      expect(res.ok).toBe(true);
      expect(res.imageData).toBe(`data:image/png;base64,${tinyPng}`);
      expect(res.source).toBe('upload[0]:avatar.png');
    });

    it('uses the upload when image is omitted entirely', async () => {
      const res = await resolveAnalyzeImageSource({ uploads: [upload('avatar.png')] });

      expect(res.ok).toBe(true);
      expect(res.source).toBe('upload[0]:avatar.png');
    });

    it('treats an empty / whitespace image as absent', async () => {
      const res = await resolveAnalyzeImageSource({ image: '   ', uploads: [upload('avatar.png')] });

      expect(res.ok).toBe(true);
      expect(res.source).toBe('upload[0]:avatar.png');
    });
  });

  describe('multiple uploads are all reachable', () => {
    const three = [upload('one.png'), upload('two.png'), upload('three.png')];

    it('defaults to the first upload', async () => {
      const res = await resolveAnalyzeImageSource({ uploads: three });
      expect(res.source).toBe('upload[0]:one.png');
    });

    it('selects the Nth upload via imageIndex', async () => {
      const res = await resolveAnalyzeImageSource({ imageIndex: 2, uploads: three });
      expect(res.ok).toBe(true);
      expect(res.source).toBe('upload[2]:three.png');
    });

    it('rejects an out-of-range imageIndex rather than silently clamping', async () => {
      const res = await resolveAnalyzeImageSource({ imageIndex: 7, uploads: three });
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/imageIndex 7 is out of range/);
      expect(res.error).toMatch(/valid indices 0-2/);
    });
  });

  describe('unreadable paths', () => {
    it('falls back to the upload and records the fallback in source', async () => {
      const res = await resolveAnalyzeImageSource({
        image: 'C:\\hallucinated\\upload.png',
        uploads: [upload('avatar.png')],
        readFile: fakeReadFile({}),
      });

      expect(res.ok).toBe(true);
      expect(res.imageData).toBe(`data:image/png;base64,${tinyPng}`);
      // The substitution must be visible to the caller.
      expect(res.source).toContain('upload[0]:avatar.png');
      expect(res.source).toContain('fallback');
      expect(res.source).toContain('C:\\hallucinated\\upload.png');
    });

    it('errors when there is no upload to fall back to', async () => {
      const res = await resolveAnalyzeImageSource({
        image: '/nope/missing.png',
        uploads: [],
        readFile: fakeReadFile({}),
      });

      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/Failed to read image file/);
      expect(res.path).toBe('/nope/missing.png');
    });
  });

  describe('nothing usable', () => {
    it('errors when no image and no uploads are supplied', async () => {
      const res = await resolveAnalyzeImageSource({});
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/No image data available/);
    });

    it('explains that an unrecognised value was not a path or data URI', async () => {
      const res = await resolveAnalyzeImageSource({ image: 'the uploaded image', uploads: [] });
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/neither a data URI nor a file path/);
    });
  });
});
