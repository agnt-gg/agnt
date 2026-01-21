/**
 * Check build requirements and provide helpful error messages
 * 
 * This script runs after postinstall to check if native modules built successfully
 * and provides actionable error messages if they didn't.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const projectRoot = path.resolve(__dirname, '..');
const sqlite3Path = path.join(projectRoot, 'node_modules', 'sqlite3');

// Check if sqlite3 native bindings exist
const checkSqlite3 = () => {
  const possiblePaths = [
    path.join(sqlite3Path, 'build', 'Release', 'node_sqlite3.node'),
    path.join(sqlite3Path, 'build', 'Debug', 'node_sqlite3.node'),
    path.join(sqlite3Path, 'build', 'node_sqlite3.node'),
  ];

  const found = possiblePaths.find(p => fs.existsSync(p));
  return { found: !!found, path: found };
};

const sqlite3Check = checkSqlite3();

if (!sqlite3Check.found) {
  console.warn('\n⚠️  WARNING: sqlite3 native module may not have built correctly\n');
  console.warn('The sqlite3 native bindings were not found. This may cause the backend to fail.');
  console.warn('\nCommon causes:');
  console.warn('1. Project path contains spaces (check with: npm run preinstall)');
  console.warn('2. Missing build tools (Xcode Command Line Tools on macOS)');
  console.warn('3. Node.js version mismatch with Electron');
  console.warn('\nTo fix:');
  console.warn('1. Ensure your project path has no spaces');
  console.warn('2. Run: npm run rebuild');
  console.warn('3. If that fails, see README.md Troubleshooting section\n');
} else {
  console.log('✓ sqlite3 native module found');
}
