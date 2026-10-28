// Thread entry for artifactPreviewThread.js: full-parse preview plans, one
// message per document. Errors travel back as text; plans carry no file path.
import { parentPort } from 'node:worker_threads';
import { planWithFullParse } from './artifactPreviewDocument.js';

parentPort.on('message', ({ id, source, options }) => {
  try {
    parentPort.postMessage({ id, plan: planWithFullParse(source, options) });
  } catch (error) {
    parentPort.postMessage({ id, error: String(error?.message || 'preview_failed') });
  }
});
