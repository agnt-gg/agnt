/**
 * Validate that the installation path doesn't contain spaces
 * 
 * Native modules (like sqlite3) fail to build when the project path contains spaces
 * because build tools split paths incorrectly. This script checks for this issue
 * early and provides a clear error message.
 */

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get the project root (parent of scripts directory)
const projectRoot = path.resolve(__dirname, '..');
const projectPath = projectRoot;

// Check if path contains spaces
if (projectPath.includes(' ')) {
  console.error('\n❌ INSTALLATION PATH ERROR\n');
  console.error('Your project path contains spaces, which will cause native module build failures.');
  console.error(`\nCurrent path: ${projectPath}\n`);
  console.error('SOLUTION:');
  console.error('1. Move the project to a path without spaces, for example:');
  console.error('   - ~/projects/agnt');
  console.error('   - /Users/yourname/code/agnt');
  console.error('   - C:\\Users\\yourname\\projects\\agnt (Windows)\n');
  console.error('2. Then run npm install again from the new location.\n');
  console.error('For more troubleshooting help, see the README.md Troubleshooting section.\n');
  process.exit(1);
}

console.log('✓ Installation path validated (no spaces detected)');
