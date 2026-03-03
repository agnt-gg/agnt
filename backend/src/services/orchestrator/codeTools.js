import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const WORKSPACE_ROOT = path.join(os.homedir(), '.agnt', 'projects');

/**
 * Validate that a resolved path is within WORKSPACE_ROOT
 */
function validatePath(relPath) {
  const resolved = path.resolve(WORKSPACE_ROOT, relPath || '');
  if (!resolved.startsWith(WORKSPACE_ROOT)) {
    throw new Error('Path traversal not allowed');
  }
  return resolved;
}

/**
 * Get tool schemas for code chat context
 */
export function getCodeToolSchemas() {
  return [
    {
      type: 'function',
      function: {
        name: 'read_file',
        description: 'Read the contents of a file from the workspace',
        parameters: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Relative path to the file within the workspace (e.g. "my-project/index.js")',
            },
          },
          required: ['path'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'write_file',
        description: 'Write content to a file in the workspace. Creates the file and any parent directories if they do not exist.',
        parameters: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Relative path to the file within the workspace (e.g. "my-project/hello.py")',
            },
            content: {
              type: 'string',
              description: 'The full file content to write',
            },
          },
          required: ['path', 'content'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'list_files',
        description: 'List files and directories in the workspace at the given path',
        parameters: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Relative directory path within the workspace (e.g. "my-project/src"). Defaults to workspace root.',
            },
          },
        },
      },
    },
  ];
}

/**
 * Execute a code tool function
 */
export async function executeCodeFunction(name, args) {
  // Ensure workspace exists
  await fs.mkdir(WORKSPACE_ROOT, { recursive: true });

  let result;

  switch (name) {
    case 'read_file': {
      const absPath = validatePath(args.path);
      try {
        const content = await fs.readFile(absPath, 'utf-8');
        result = { success: true, content, path: args.path };
      } catch (err) {
        if (err.code === 'ENOENT') {
          result = { success: false, error: `File not found: ${args.path}` };
        } else {
          throw err;
        }
      }
      break;
    }

    case 'write_file': {
      const absPath = validatePath(args.path);
      await fs.mkdir(path.dirname(absPath), { recursive: true });
      await fs.writeFile(absPath, args.content || '', 'utf-8');
      result = {
        success: true,
        path: args.path,
        frontendEvents: [{ type: 'file_written', data: { path: args.path, content: args.content } }],
      };
      break;
    }

    case 'list_files': {
      const relDir = args.path || '';
      const absDir = validatePath(relDir);
      try {
        const entries = await fs.readdir(absDir, { withFileTypes: true });
        const items = entries
          .filter((e) => !e.name.startsWith('.'))
          .map((e) => ({
            name: e.name,
            type: e.isDirectory() ? 'directory' : 'file',
            path: path.join(relDir, e.name).replace(/\\/g, '/'),
          }))
          .sort((a, b) => {
            if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
            return a.name.localeCompare(b.name);
          });
        result = { success: true, items, path: relDir || '/' };
      } catch (err) {
        if (err.code === 'ENOENT') {
          result = { success: false, error: `Directory not found: ${relDir}` };
        } else {
          throw err;
        }
      }
      break;
    }

    default:
      result = { success: false, error: `Unknown function: ${name}` };
  }

  return JSON.stringify(result);
}

/**
 * List all files in the workspace (for system prompt context)
 */
export async function listWorkspaceFiles() {
  await fs.mkdir(WORKSPACE_ROOT, { recursive: true });

  const items = [];

  async function walk(relDir) {
    const absDir = path.resolve(WORKSPACE_ROOT, relDir);
    try {
      const entries = await fs.readdir(absDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          items.push({ name: entry.name, type: 'directory', path: relPath });
          await walk(relPath);
        } else {
          items.push({ name: entry.name, type: 'file', path: relPath });
        }
      }
    } catch (err) {
      // directory doesn't exist or can't be read
    }
  }

  await walk('');
  return items;
}
