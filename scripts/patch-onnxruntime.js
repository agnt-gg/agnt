/**
 * Patch onnxruntime-node to use onnxruntime-web in Electron builds
 *
 * This script replaces the onnxruntime-node index.js to re-export onnxruntime-web
 * instead of trying to load native binaries.
 *
 * The native onnxruntime-node binaries don't work well with Electron packaging
 * because they require platform-specific .node files that are difficult to
 * bundle correctly with ASAR archives.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const onnxNodeDir = path.join(__dirname, '..', 'node_modules', 'onnxruntime-node', 'dist');

// Patch index.js to re-export onnxruntime-web
const indexPath = path.join(onnxNodeDir, 'index.js');
const patchedIndex = `"use strict";
// PATCHED: Re-export onnxruntime-web for Electron compatibility
// The native onnxruntime-node bindings don't work in Electron ASAR builds
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
// Re-export everything from onnxruntime-web instead of onnxruntime-common + native backend
__exportStar(require("onnxruntime-web"), exports);
`;

try {
  if (fs.existsSync(indexPath)) {
    fs.writeFileSync(indexPath, patchedIndex);
    console.log('✓ Patched onnxruntime-node/dist/index.js to use onnxruntime-web');
  } else {
    console.log('⚠ onnxruntime-node/dist/index.js not found, skipping patch');
  }
} catch (error) {
  console.error('✗ Failed to patch onnxruntime-node:', error.message);
}
