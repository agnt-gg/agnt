const fs = require('fs');
const path = require('path');

const { readdirSync, readFileSync, statSync, createWriteStream } = fs;
const { join, extname } = path;

// Define the list of files/directories to ignore in one place
const IGNORED_ITEMS = [
  'output.txt',
  'llms.txt',
  'LIGMA.mjs',
  'LIGMA.cjs',
  'node_modules',
  'schema-patterns',
  'database.txt',
  'summaries',
  '.pyc',
  '__pycache__',
  'lib',
  'img',
  'css',
  'api',
  'login',
  'account',
  'package-lock.json',
  '.gitignore',
  '.git',
  '.env',
  'typescript',
  'utilities',
  'LICENSE',
];

// file extensions to ignore
const FILE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.bmp', '.ico', '.tiff', '.pdf'];

// Function to check if a file is an image based on extension
function isImageFile(filePath) {
  const ext = extname(filePath).toLowerCase();
  return FILE_EXTENSIONS.includes(ext);
}

// Function to process file content and replace certain sections with ellipsis
function processFileContent(content, filePath) {
  console.log(`Processing file: ${filePath}`);
  
  // Replace content inside <style>...</style> tags with ellipsis
  content = content.replace(/<style>[\s\S]*?<\/style>/gi, '<style>...</style>');
  
  // Replace SVG content but preserve the tags
  content = content.replace(/<svg[\s\S]*?<\/svg>/gi, '<svg>...</svg>');
  
  // Handle CSS files - replace content but keep structure
  if (filePath.toLowerCase().endsWith('.css')) {
    content = '/* CSS content simplified */\n';
  }
  
  // Handle large JSON content (preserving structure but reducing size)
  if (filePath.toLowerCase().endsWith('.json')) {
    try {
      const jsonObj = JSON.parse(content);
      // If it's a large JSON file, provide a summary instead
      if (content.length > 10000) {
        content = `/* Large JSON file, keys: ${Object.keys(jsonObj).join(', ')} */\n`;
      }
    } catch (e) {
      // Not valid JSON or other error, keep original
    }
  }
  
  return content;
}

function buildDirectoryOutline(srcDir, depth = 0) {
  let result = '';
  const files = readdirSync(srcDir);
  const prefix = '  '.repeat(depth);

  console.log(`Building outline for directory: ${srcDir}`);
  console.log(`Files found: ${files.join(', ')}`);

  files.forEach((file) => {
    if (IGNORED_ITEMS.includes(file)) {
      console.log(`Ignoring: ${file}`);
      return;
    }

    const filePath = join(srcDir, file);
    const stats = statSync(filePath);

    if (stats.isFile()) {
      // Skip image files
      if (isImageFile(filePath)) {
        console.log(`Skipping image file: ${file}`);
        return;
      }
      result += `${prefix}- ${file}\n`;
    } else if (stats.isDirectory()) {
      result += `${prefix}+ ${file}\n`;
      result += buildDirectoryOutline(filePath, depth + 1);
    }
  });

  return result;
}

function processDirectory(srcDir, writeStream) {
  const files = readdirSync(srcDir);
  console.log(`\nProcessing directory: ${srcDir}`);
  console.log(`Files found: ${files.join(', ')}`);

  files.forEach((file) => {
    if (IGNORED_ITEMS.includes(file)) {
      console.log(`Ignoring: ${file}`);
      return;
    }

    const filePath = join(srcDir, file);
    const stats = statSync(filePath);

    if (stats.isFile()) {
      // Skip image files
      if (isImageFile(filePath)) {
        console.log(`Skipping image file: ${file}`);
        return;
      }
      try {
        const fileContent = readFileSync(filePath, 'utf-8');
        // Process the file content before writing it
        const processedContent = processFileContent(fileContent, filePath);
        writeStream.write(
          `----------------------\n${filePath.toUpperCase()}\n----------------------\n${processedContent}\n`
        );
        console.log(`Successfully processed: ${file}`);
      } catch (error) {
        console.error(`Error processing file ${file}:`, error);
      }
    } else if (stats.isDirectory()) {
      processDirectory(filePath, writeStream);
    }
  });
}

function combineFiles(srcDir, outputFile) {
  console.log(`\nStarting LIGMA process...`);
  console.log(`Source directory: ${srcDir}`);
  console.log(`Output file: ${outputFile}`);

  // Create a writable stream so that we don't create one huge string in memory.
  const writeStream = createWriteStream(outputFile, { encoding: 'utf-8' });
  
  const directoryOutline = buildDirectoryOutline(srcDir);
  writeStream.write(`Directory Structure:\n${directoryOutline}\nFile Contents:\n`);

  processDirectory(srcDir, writeStream);
  
  writeStream.end();
  writeStream.on('finish', () => {
    console.log('\n✅ All files combined successfully into:', outputFile);
  });
  writeStream.on('error', (error) => {
    console.error('\n❌ Error writing to output file:', error);
  });
}

const srcDir = './';
const outputFile = './llms.txt';

combineFiles(srcDir, outputFile);