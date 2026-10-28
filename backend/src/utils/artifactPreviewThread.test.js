import { describe, it, expect } from 'vitest';
import { planPreviewDocumentAsync, planWithFullParseOffThread, OFF_THREAD_MIN_CHARS, _previewThreadAlive } from './artifactPreviewThread.js';
import { planWithFullParse, planPreviewDocument } from './artifactPreviewDocument.js';

const options = { documentURL: '/api/local-preview/C:/work/page.html', prefix: '/api/local-preview/' };

describe('preview planning off the event loop', () => {
  it('plans a large document that needs rewriting on the worker, identically to the full parse', async () => {
    const source = `<html><head></head><body><img src="file:///C:/work/a.png"><p>${'x'.repeat(OFF_THREAD_MIN_CHARS)}</p></body></html>`;
    const plan = await planPreviewDocumentAsync(source, options);
    expect(_previewThreadAlive()).toBe(true);
    expect(plan).toEqual(planWithFullParse(source, options));
    expect(plan.html).toContain('src="/api/local-preview/C:/work/a.png"');
  });

  it('plans scannable and small documents in place, with the same result as the synchronous planner', async () => {
    for (const source of ['<html><head></head><body><p>x</p></body></html>', '<img src="file:///C:/work/a.png">']) {
      expect(await planPreviewDocumentAsync(source, options)).toEqual(planPreviewDocument(source, options));
    }
  });

  it('delivers a failed job as that job\'s error and keeps serving the next one', async () => {
    await expect(planWithFullParseOffThread(null, options)).rejects.toThrow();
    const source = `<html><body><img src="file:///C:/work/b.png">${'y'.repeat(OFF_THREAD_MIN_CHARS)}</body></html>`;
    expect(await planWithFullParseOffThread(source, options)).toEqual(planWithFullParse(source, options));
  });
});
