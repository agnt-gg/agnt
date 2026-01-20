/**
 * Patch @xenova/transformers ONNX backend to use dynamic imports
 * This fixes ESM resolution issues in Docker/Alpine Linux
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const onnxBackendPath = path.join(__dirname, '..', 'node_modules', '@xenova', 'transformers', 'src', 'backends', 'onnx.js');

const patchedContent = `/**
 * @file Handler file for choosing the correct version of ONNX Runtime, based on the environment.
 * PATCHED: Uses dynamic imports to avoid ESM resolution issues in Docker
 *
 * @module backends/onnx
 */

/** @type {import('onnxruntime-web')} The ONNX runtime module. */
export let ONNX;

export const executionProviders = [
    // 'webgpu',
    'wasm'
];

// Use dynamic imports to avoid ESM resolution failures
// Only import what we need based on the environment
if (typeof process !== 'undefined' && process?.release?.name === 'node') {
    // Running in a node-like environment
    try {
        const ONNX_NODE = await import('onnxruntime-node');
        ONNX = ONNX_NODE.default ?? ONNX_NODE;
        executionProviders.unshift('cpu');
        console.log('✓ Using onnxruntime-node backend');
    } catch (error) {
        // Fallback to web backend if node backend fails
        console.warn('⚠️  onnxruntime-node unavailable, falling back to WASM backend:', error.message);
        const ONNX_WEB = await import('onnxruntime-web');
        ONNX = ONNX_WEB.default ?? ONNX_WEB;
    }
} else {
    // Running in a browser-environment
    const ONNX_WEB = await import('onnxruntime-web');
    ONNX = ONNX_WEB.default ?? ONNX_WEB;

    // SIMD for WebAssembly does not operate correctly in some recent versions of iOS (16.4.x).
    const isIOS = typeof navigator !== 'undefined' && /iP(hone|od|ad).+16_4.+AppleWebKit/.test(navigator.userAgent);
    if (isIOS) {
        ONNX.env.wasm.simd = false;
    }
}
`;

try {
  if (fs.existsSync(onnxBackendPath)) {
    fs.writeFileSync(onnxBackendPath, patchedContent);
    console.log('✓ Patched @xenova/transformers/src/backends/onnx.js to use dynamic imports');
  } else {
    console.log('⚠️  @xenova/transformers/src/backends/onnx.js not found, skipping patch');
  }
} catch (error) {
  console.error('✗ Failed to patch transformers ONNX backend:', error.message);
}
