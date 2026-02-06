import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';
import AGNT from '../../libs/agnt2.js';
import scrapeUtil from '../../utils/webScrape.js';
import toolRegistry from './toolRegistry.js';
import AuthManager from '../auth/AuthManager.js';
import CodexAuthManager from '../auth/CodexAuthManager.js';
import CodexCliService from '../ai/CodexCliService.js';
import CodexCliSessionManager from '../ai/CodexCliSessionManager.js';
import jwt from 'jsonwebtoken';
import ParameterResolver from '../../workflow/ParameterResolver.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Resolve data references in tool arguments
 * Replaces {{DATA_REF:id}} patterns with actual data from preserved content
 * @param {object} args - Tool arguments that may contain data references
 * @param {object} conversationContext - The conversation context containing preserved data
 * @returns {object} - Arguments with resolved data references
 */
function resolveDataReferences(args, conversationContext) {
  if (!conversationContext || !conversationContext.preservedContent) {
    return args;
  }

  // Recursively scan and replace data references
  function scanAndResolve(obj) {
    if (typeof obj === 'string') {
      // Check for {{DATA_REF:id}} pattern
      const dataRefMatch = obj.match(/^\{\{DATA_REF:(.+?)\}\}$/);
      if (dataRefMatch) {
        const dataId = dataRefMatch[1];
        if (conversationContext.preservedContent[dataId]) {
          console.log(`[Data Resolve] Resolved reference ${dataId} (${conversationContext.preservedContent[dataId].length} chars)`);
          return conversationContext.preservedContent[dataId];
        } else {
          console.warn(`[Data Resolve] Reference ${dataId} not found in preserved content`);
          return obj; // Return original if not found
        }
      }
      return obj;
    } else if (Array.isArray(obj)) {
      return obj.map((item) => scanAndResolve(item));
    } else if (obj !== null && typeof obj === 'object') {
      const newObj = {};
      for (const [key, value] of Object.entries(obj)) {
        newObj[key] = scanAndResolve(value);
      }
      return newObj;
    }
    return obj;
  }

  return scanAndResolve(args);
}

export const TOOLS = {
  execute_javascript_code: {
    schema: {
      type: 'function',
      function: {
        name: 'execute_javascript_code',
        description:
          'Executes arbitrary JavaScript code and returns the output. The code should "return" the output to produce output. This environment supports standard JavaScript features, including `fetch` for making HTTP requests. Remember that `fetch` returns a Promise.',
        parameters: {
          type: 'object',
          properties: {
            code: {
              type: 'string',
              description:
                "The JavaScript code to execute. For example, 'console.log(1 + 1);' or 'fetch(\"https://api.example.com/data\").then(res => res.json()).then(data => console.log(data));'. Ensure `await` is used for Promises if the script is not an IIFE async function, or use .then() chains.",
            },
          },
          required: ['code'],
        },
      },
    },
    execute: async ({ code: codeString }) => {
      // Renamed 'code' to 'codeString' to match original helper
      return new Promise((resolve) => {
        // Removed reject, always resolve with JSON string
        if (!codeString || typeof codeString !== 'string') {
          return resolve(JSON.stringify({ success: false, error: 'Invalid code provided. Code must be a non-empty string.' }));
        }
        console.log(`Tool call: executeJavaScriptCode with code: \n${codeString}`);

        const nodeProcess = spawn('node', ['-e', codeString], { timeout: 5000 }); // 5 second timeout
        let stdout = '';
        let stderr = '';

        nodeProcess.stdout.on('data', (data) => {
          stdout += data.toString();
        });

        nodeProcess.stderr.on('data', (data) => {
          stderr += data.toString();
        });

        nodeProcess.on('close', (code) => {
          if (code === 0) {
            resolve(JSON.stringify({ success: true, stdout: stdout.trim(), stderr: stderr.trim() }));
          } else {
            resolve(JSON.stringify({ success: false, stdout: stdout.trim(), stderr: `Process exited with code ${code}: ${stderr.trim()}` }));
          }
        });

        nodeProcess.on('error', (err) => {
          console.error('Failed to start subprocess for code execution:', err);
          resolve(JSON.stringify({ success: false, error: `Failed to start subprocess: ${err.message}` }));
        });

        // Handle timeout explicitly
        nodeProcess.on('timeout', () => {
          nodeProcess.kill();
          resolve(JSON.stringify({ success: false, error: 'Code execution timed out after 5 seconds.' }));
        });
      });
    },
  },
  execute_shell_command: {
    schema: {
      type: 'function',
      function: {
        name: 'execute_shell_command',
        description:
          'Executes a shell command in a specified directory. Useful for running build tools, package managers (like npm, pip), or other system commands.',
        parameters: {
          type: 'object',
          properties: {
            command: {
              type: 'string',
              description: "The shell command to execute (e.g., 'npm install', 'python --version').",
            },
            cwd: {
              type: 'string',
              description: "The working directory from which to run the command. Defaults to the server's root directory if not specified.",
              default: '.',
            },
          },
          required: ['command'],
        },
      },
    },
    execute: async ({ command, cwd = '.' }) => {
      console.log(`Tool call: execute_shell_command with command: "${command}" in directory: "${cwd}"`);
      if (!command) {
        return JSON.stringify({ success: false, error: 'Command is required.' });
      }

      // Security check for cwd
      if (cwd.includes('..')) {
        return JSON.stringify({ success: false, error: "Relative paths with '..' are not allowed in cwd." });
      }

      return new Promise((resolve) => {
        // Use shell: true for convenience, which allows using shell syntax like '&&', '|', etc.
        const childProcess = spawn(command, {
          shell: true,
          cwd: cwd,
          timeout: 120000, // 2 minutes, as installs can be slow
        });

        let stdout = '';
        let stderr = '';
        let timedOut = false;

        childProcess.stdout.on('data', (data) => {
          stdout += data.toString();
        });

        childProcess.stderr.on('data', (data) => {
          stderr += data.toString();
        });

        childProcess.on('timeout', () => {
          timedOut = true;
          childProcess.kill('SIGTERM');
        });

        childProcess.on('error', (err) => {
          console.error(`Failed to start shell command: ${command}`, err);
          resolve(JSON.stringify({ success: false, command, cwd, error: `Failed to start process: ${err.message}` }));
        });

        childProcess.on('close', (code, signal) => {
          if (timedOut) {
            resolve(
              JSON.stringify({
                success: false,
                command,
                cwd,
                stdout: stdout.trim(),
                stderr: stderr.trim(),
                error: 'Command execution timed out after 120 seconds and was terminated.',
              })
            );
          } else if (code === 0) {
            resolve(JSON.stringify({ success: true, command, cwd, stdout: stdout.trim(), stderr: stderr.trim() }));
          } else {
            let errMsg = `Process exited with code ${code}`;
            if (signal) {
              errMsg = `Process terminated by signal: ${signal}`;
            }
            const fullStderr = `${stderr.trim()}`;
            resolve(
              JSON.stringify({
                success: false,
                command,
                cwd,
                stdout: stdout.trim(),
                stderr: `${errMsg}${fullStderr ? ': ' + fullStderr : ''}`.trim(),
              })
            );
          }
        });
      });
    },
  },
  codex_exec: {
    schema: {
      type: 'function',
      function: {
        name: 'codex_exec',
        description:
          'Runs a prompt using the local Codex CLI backend. This does not require an OpenAI API key, but does require Codex device login to be completed on this machine.',
        parameters: {
          type: 'object',
          properties: {
            prompt: {
              type: 'string',
              description: 'The prompt to run with Codex CLI.',
            },
            model: {
              type: 'string',
              default: 'gpt-5-codex',
              description: "Codex CLI model to use (for example: 'gpt-5-codex').",
            },
            cwd: {
              type: 'string',
              description: 'Working directory for the Codex CLI command. Defaults to the server process directory.',
            },
            resume: {
              type: 'boolean',
              default: true,
              description:
                'If true, resume the most recent Codex thread for this conversation (or user) when available.',
            },
            sessionScope: {
              type: 'string',
              enum: ['conversation', 'user'],
              default: 'conversation',
              description:
                "Session scope for Codex threads. 'conversation' keeps a thread per conversation; 'user' shares one thread per user.",
            },
            sessionThreadId: {
              type: 'string',
              description:
                'Optional explicit Codex thread ID to resume. If provided, it overrides the session-based resume behavior.',
            },
            fullAuto: {
              type: 'boolean',
              default: false,
              description:
                'If true, runs Codex with --full-auto. This may allow Codex to take actions without additional confirmation.',
            },
            extraArgs: {
              type: 'array',
              items: { type: 'string' },
              description:
                'Optional extra CLI arguments to pass to codex exec. Use with caution and only when you know the Codex CLI flags.',
            },
          },
          required: ['prompt'],
        },
      },
    },
    execute: async (
      {
        prompt,
        model = 'gpt-5-codex',
        cwd,
        resume = true,
        sessionScope = 'conversation',
        sessionThreadId = null,
        fullAuto = false,
        extraArgs = [],
      },
      _authToken,
      context
    ) => {
      try {
        const codexToken = CodexAuthManager.getAccessToken();
        if (!codexToken) {
          return JSON.stringify({
            success: false,
            error: 'Codex CLI is not connected on this machine. Complete device login first.',
          });
        }

        const resolvedCwd = cwd ? path.resolve(cwd) : process.cwd();
        try {
          const stat = await fs.stat(resolvedCwd);
          if (!stat.isDirectory()) {
            return JSON.stringify({
              success: false,
              error: `cwd is not a directory: ${resolvedCwd}`,
            });
          }
        } catch (err) {
          return JSON.stringify({
            success: false,
            error: `cwd does not exist or is not accessible: ${resolvedCwd}`,
          });
        }

        const userId = context?.userId || null;
        const conversationId = context?.conversationId || null;

        const sessionKey = CodexCliSessionManager.getSessionKey({
          userId,
          conversationId,
          provider: 'openai-codex-cli',
          scope: sessionScope === 'user' ? 'user' : 'conversation',
        });

        const existingThreadId = resume && !sessionThreadId ? await CodexCliSessionManager.getThreadId(sessionKey) : null;
        const resumeThreadId = sessionThreadId || existingThreadId;

        const handleEvent = (event) => {
          if (event?.type === 'thread.started' && event.thread_id) {
            CodexCliSessionManager.setThreadId(sessionKey, event.thread_id);
          }
        };

        const result = await CodexCliService.runExecStream(
          {
            prompt,
            model,
            cwd: resolvedCwd,
            resumeThreadId,
            fullAuto,
            extraArgs: Array.isArray(extraArgs) ? extraArgs : [],
            userId,
            conversationId,
            authToken: _authToken,
            provider: 'openai-codex-cli',
          },
          { onEvent: handleEvent }
        );

        if (result?.threadId) {
          CodexCliSessionManager.setThreadId(sessionKey, result.threadId);
        }

        return JSON.stringify({
          success: true,
          provider: 'openai-codex-cli',
          model,
          cwd: resolvedCwd,
          sessionKey,
          resumedFromThreadId: resumeThreadId || null,
          threadId: result?.threadId || resumeThreadId || null,
          text: result?.text || '',
          usage: result?.usage || null,
          exitCode: result?.exitCode ?? 0,
        });
      } catch (error) {
        console.error('codex_exec tool failed:', error);
        return JSON.stringify({
          success: false,
          error: error.message || 'codex_exec failed',
        });
      }
    },
  },
  web_search: {
    schema: {
      type: 'function',
      function: {
        name: 'web_search',
        description:
          'Perform a web search using Google Custom Search API to find information online. ALWAYS USE THIS IN CONJUNCTION WITH THE WEB_SCRAPE TOOL',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'The search query.',
            },
            num: {
              type: 'number',
              default: 5,
              description: 'Number of search results to return (default is 5, max is 10).',
            },
          },
          required: ['query'],
        },
      },
    },
    execute: async ({ query, searchQuery, num, numResults }) => {
      // Handle both parameter naming conventions
      const actualQuery = query || searchQuery;
      const actualNum = num || numResults || 5;

      console.log(`Tool call: executeWebSearch with query: "${actualQuery}", num: ${actualNum}`);

      // Fetch Google Search keys from remote API
      let apiKey, cx;
      try {
        const response = await fetch(`${process.env.REMOTE_URL}/auth/google-search-keys`);

        if (!response.ok) {
          console.error(`Failed to fetch Google Search keys from remote: ${response.status} ${response.statusText}`);
          // Fallback to local environment variables
          apiKey = process.env.GOOGLE_SEARCH_API_KEY;
          cx = process.env.GOOGLE_SEARCH_ENGINE_ID;
        } else {
          const data = await response.json();
          apiKey = data.apiKey;
          cx = data.searchEngineId;
        }
      } catch (error) {
        console.error('Error fetching Google Search keys from remote:', error.message);
        // Fallback to local environment variables
        apiKey = process.env.GOOGLE_SEARCH_API_KEY;
        cx = process.env.GOOGLE_SEARCH_ENGINE_ID;
      }

      if (!apiKey || !cx) {
        const errorMsg = 'Google Search API key or Custom Search Engine ID is not configured. Please configure them on the remote server.';
        console.error(errorMsg);
        return JSON.stringify({ success: false, error: errorMsg });
      }

      if (!actualQuery) {
        return JSON.stringify({ success: false, error: 'Search query is required' });
      }

      const resultsCount = Math.min(Math.max(1, Number(actualNum) || 5), 10);
      const endpoint = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cx}&q=${encodeURIComponent(actualQuery)}&num=${resultsCount}`;

      try {
        const response = await fetch(endpoint);
        const data = await response.json();

        if (!response.ok || data.error) {
          const errorDetail = data.error?.message || response.statusText;
          console.error(`Google Search API error ${response.status}: ${errorDetail}`);
          return JSON.stringify({ success: false, error: `Google Search API error: ${errorDetail}` });
        }

        const results =
          data.items?.map((item) => ({
            title: item.title,
            link: item.link,
            snippet: item.snippet,
            source: item.displayLink,
          })) || [];

        return JSON.stringify({
          success: true,
          query: actualQuery,
          resultsCount: results.length,
          results,
        });
      } catch (error) {
        console.error('Google Custom Search API request failed:', error);
        return JSON.stringify({ success: false, error: `Web search failed: ${error.message}` });
      }
    },
  },
  web_scrape: {
    schema: {
      type: 'function',
      function: {
        name: 'web_scrape',
        description:
          'Fetches and aggressively cleans a webpage URL, returning its main text content, all code snippets, and all discoverable links. Useful for deep content extraction from a specific webpage.',
        parameters: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: "The fully qualified URL of the webpage to scrape (e.g., 'https://example.com/article').",
            },
          },
          required: ['url'],
        },
      },
    },
    execute: async ({ url }) => {
      console.log(`Tool call: executeWebScrape (advanced) with url: "${url}"`);
      if (!url) {
        return JSON.stringify({ success: false, error: 'URL is required for web scraping.' });
      }

      try {
        // Use the imported scrape function from webScrape.js
        const { textContent, links, codeContent } = await scrapeUtil.execute({ url });

        // Check if the scrape itself reported an error (e.g., "ERROR: Could not extract main content...")
        if (textContent.startsWith('Scraping failed for') || textContent.startsWith('ERROR:')) {
          return JSON.stringify({
            success: false,
            error: `Web scraping failed for ${url}. Detail: ${textContent}`,
            url,
            textContent: null, // Explicitly nullify on error
            links: [],
            codeContent: '',
          });
        }

        // Sanitize the scraped content to remove control characters that break JSON
        const sanitizeText = (text) => {
          if (!text || typeof text !== 'string') return text;
          return text.replace(/[\x00-\x1F\x7F]/g, (match) => {
            // Replace control characters with their escaped equivalents or remove them
            const charCode = match.charCodeAt(0);
            switch (charCode) {
              case 9:
                return ' '; // tab -> space
              case 10:
                return ' '; // newline -> space
              case 13:
                return ' '; // carriage return -> space
              default:
                return ''; // remove other control characters
            }
          });
        };

        const sanitizedTextContent = sanitizeText(textContent);
        const sanitizedCodeContent = sanitizeText(codeContent);

        return JSON.stringify({
          success: true,
          url,
          textContent: sanitizedTextContent,
          links,
          codeContent: sanitizedCodeContent,
          message: 'Content, links, and code snippets extracted successfully.',
        });
      } catch (error) {
        console.error(`Advanced web scraping failed for ${url}:`, error);
        // This catch block might be redundant if scrapeUtil.execute handles its own errors and returns a specific textContent.
        // However, it's good for catching unexpected errors in the call itself.
        return JSON.stringify({
          success: false,
          error: `Advanced web scraping failed: ${error.message}`,
          url,
          textContent: null,
          links: [],
          codeContent: '',
        });
      }
    },
  },
  file_operations: {
    schema: {
      type: 'function',
      function: {
        name: 'file_operations',
        description:
          'Perform file system operations - read, write, list, mkdir, check existence, copy, move, and execute files and directories. Use caution with delete, write, move, and execute operations. NEVER truncate the file contents. CRITICAL: DO NOT use this tool to read image files - images uploaded by users are automatically available for vision analysis.',
        parameters: {
          type: 'object',
          properties: {
            operation: {
              type: 'string',
              enum: ['read', 'write', 'list', 'delete', 'mkdir', 'exists', 'copy', 'move', 'execute'],
              description:
                'File operation to perform. NOTE: Do NOT use "read" operation on image files (.png, .jpg, .jpeg, .gif, .webp) - they are handled by vision models.',
            },
            path: {
              type: 'string',
              description:
                "File or directory path. Paths should be relative to the server's execution directory or absolute if necessary and permitted. For 'execute', this is the path to the executable file. WARNING: Do NOT read image files - they are automatically processed for vision analysis.",
            },
            content: {
              type: 'string',
              description: 'Content to write (for write operation)',
            },
            destination: {
              type: 'string',
              description: 'Destination path (for copy/move operations)',
            },
            args: {
              type: 'array',
              items: { type: 'string' },
              description: "Optional array of arguments to pass to the executable file (for 'execute' operation).",
            },
            encoding: {
              type: 'string',
              default: 'utf8',
              description: "File encoding (e.g., 'utf8', 'base64') for read/write operations.",
            },
          },
          required: ['operation', 'path'],
        },
      },
    },
    execute: async ({ operation, path: filePath, content, destination, encoding = 'utf8', args = [] }, authToken, context) => {
      console.log(`Tool call: executeFileOperations with operation: ${operation}, path: ${filePath}, args: ${args}`);

      if (!operation || !filePath) {
        return JSON.stringify({ success: false, error: 'Operation and path are required for file operations.', operation, path: filePath });
      }

      if (filePath.includes('..')) {
        return JSON.stringify({ success: false, error: "Relative paths with '..' are not allowed.", operation, path: filePath });
      }

      // CRITICAL: Prevent reading image files - they should be handled by vision models
      if (operation === 'read') {
        const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.ico'];
        const fileExt = path.extname(filePath).toLowerCase();

        if (imageExtensions.includes(fileExt)) {
          return JSON.stringify({
            success: false,
            error: `Cannot read image file '${filePath}' using file_operations. Images uploaded by users are automatically available for vision analysis. If you need to analyze an image, simply describe what you see in the uploaded image - no tool call needed.`,
            operation,
            path: filePath,
            hint: 'Images are processed automatically by vision-capable models. Do not use file_operations to read them.',
          });
        }
      }

      // Handle non-execute operations
      if (operation !== 'execute') {
        try {
          let result;
          switch (operation) {
            case 'read':
              // Prevent reading image files - images should be uploaded and analyzed via vision API
              const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'];
              const fileExt = path.extname(filePath).toLowerCase();
              if (imageExtensions.includes(fileExt)) {
                return JSON.stringify({
                  success: false,
                  error: `Cannot read image file '${filePath}' using file_operations. Images uploaded by users are automatically available for vision analysis. If you need to process this image, ask the user to upload it directly in the chat.`,
                  operation,
                  path: filePath,
                  hint: 'Image files are handled through the vision API, not file operations. Users should upload images directly in the chat for analysis.',
                });
              }
              const data = await fs.readFile(filePath, encoding);
              result = { operation, path: filePath, content: data, size: data.length };
              break;
            case 'write':
              if (content === undefined || content === null) {
                return JSON.stringify({
                  success: false,
                  error: 'Content parameter is required for write operation. Please provide the content to write to the file.',
                  operation,
                  path: filePath,
                  hint: 'When using the file_operations tool with operation "write", you must provide a "content" parameter with the text content you want to write to the file.',
                });
              }

              // SPECIAL HANDLING: Check if we have preserved full web scrape content that should be used instead
              let contentToWrite = content;

              // If the content looks like it might be truncated web scrape data and we have preserved full content
              if (context && context.preservedContent && context.preservedContent.lastWebScrape) {
                try {
                  // Try to parse the content being written
                  const parsedContent = JSON.parse(content);
                  const preservedData = JSON.parse(context.preservedContent.lastWebScrape.fullContent);

                  // Check various conditions that indicate we should use preserved content:
                  // 1. URL matches and content is exactly "..."
                  // 2. URL matches and content contains truncation markers
                  // 3. URL matches and content is shorter than preserved content
                  // 4. Content has _truncated flag
                  if (
                    parsedContent.url &&
                    preservedData.url === parsedContent.url &&
                    (parsedContent.textContent === '...' ||
                      parsedContent._truncated === true ||
                      (parsedContent.textContent && parsedContent.textContent.includes('[Content truncated')) ||
                      (parsedContent.textContent && parsedContent.textContent.includes('...')) ||
                      (preservedData.textContent && parsedContent.textContent && parsedContent.textContent.length < preservedData.textContent.length))
                  ) {
                    // Use the full preserved content instead
                    contentToWrite = context.preservedContent.lastWebScrape.fullContent;
                    console.log(
                      `Using preserved FULL web scrape content for file write (${contentToWrite.length} chars instead of ${content.length} chars)`
                    );

                    // Clear the preserved content after use to prevent reuse
                    delete context.preservedContent.lastWebScrape;
                  }
                } catch (e) {
                  // If parsing fails, check if raw content matches URL pattern
                  if (context.preservedContent.lastWebScrape.url && content.includes(context.preservedContent.lastWebScrape.url)) {
                    // Content mentions the same URL, likely related
                    contentToWrite = context.preservedContent.lastWebScrape.fullContent;
                    console.log(
                      `Using preserved full web scrape content based on URL match (${contentToWrite.length} chars instead of ${content.length} chars)`
                    );
                    delete context.preservedContent.lastWebScrape;
                  } else {
                    console.log('Could not parse content for full content substitution, using original');
                  }
                }
              }

              // CRITICAL FIX: Automatically create directory structure before writing file
              const fileDir = path.dirname(filePath);
              await fs.mkdir(fileDir, { recursive: true });
              console.log(`[file_operations] Created directory structure: ${fileDir}`);

              await fs.writeFile(filePath, contentToWrite, encoding);
              result = { operation, path: filePath, bytesWritten: Buffer.from(contentToWrite, encoding).length };
              break;
            case 'list':
              const items = await fs.readdir(filePath, { withFileTypes: true });
              result = {
                operation,
                path: filePath,
                items: items.map((item) => ({
                  name: item.name,
                  type: item.isDirectory() ? 'directory' : 'file',
                })),
              };
              break;
            case 'mkdir':
              await fs.mkdir(filePath, { recursive: true });
              result = { operation, path: filePath, created: true };
              break;
            case 'exists':
              try {
                await fs.access(filePath, fs.constants.F_OK); // Check for existence
                result = { operation, path: filePath, exists: true };
              } catch {
                result = { operation, path: filePath, exists: false };
              }
              break;
            case 'copy':
              if (!destination) {
                return JSON.stringify({ success: false, error: 'Destination required for copy operation', operation, path: filePath });
              }
              if (destination.includes('..')) {
                return JSON.stringify({
                  success: false,
                  error: "Relative destination paths with '..' are not allowed.",
                  operation,
                  path: filePath,
                  destination,
                });
              }
              await fs.copyFile(filePath, destination);
              result = { operation, path: filePath, destination, copied: true };
              break;
            case 'move':
              if (!destination) {
                return JSON.stringify({ success: false, error: 'Destination required for move operation', operation, path: filePath });
              }
              if (destination.includes('..')) {
                return JSON.stringify({
                  success: false,
                  error: "Relative destination paths with '..' are not allowed.",
                  operation,
                  path: filePath,
                  destination,
                });
              }
              await fs.rename(filePath, destination);
              result = { operation, path: filePath, destination, moved: true };
              break;
            default:
              // This case should ideally not be reached if operation is validated by schema,
              // but as a fallback for unknown operations not being 'execute'.
              return JSON.stringify({ success: false, error: `Unknown file operation: ${operation}`, operation, path: filePath });
          }
          return JSON.stringify({ success: true, ...result });
        } catch (error) {
          console.error(`File operation failed: ${operation} on ${filePath}`, error);
          return JSON.stringify({ success: false, error: `File operation '${operation}' failed: ${error.message}`, operation, path: filePath });
        }
      }

      // Handle 'execute' operation
      const execArgs = Array.isArray(args) ? args.map(String) : [];

      return new Promise(async (resolve) => {
        let internalResolved = false; // To prevent double resolving
        const doResolve = (value) => {
          if (!internalResolved) {
            internalResolved = true;
            resolve(value);
          }
        };

        try {
          await fs.access(filePath, fs.constants.F_OK); // Check if file exists

          let commandToRun = filePath;
          let finalSpawnArgs = [...execArgs];
          const fileExt = path.extname(filePath).toLowerCase();
          const isWindows = process.platform === 'win32';

          if (fileExt === '.py') {
            commandToRun = 'python'; // Assumes 'python' (or 'python3') is in PATH
            finalSpawnArgs.unshift(filePath);
          } else if (fileExt === '.js') {
            commandToRun = 'node'; // Assumes 'node' is in PATH
            finalSpawnArgs.unshift(filePath);
          } else if (fileExt === '.sh') {
            commandToRun = isWindows ? 'bash' : 'sh'; // 'bash' on Win assumes Git Bash or WSL; 'sh' for POSIX
            finalSpawnArgs.unshift(filePath);
          } else if (fileExt === '.ps1' && isWindows) {
            commandToRun = 'powershell.exe'; // Use explicit .exe for PowerShell on Windows
            // Prepend arguments needed to run a script file, then user-provided args
            finalSpawnArgs = ['-ExecutionPolicy', 'Bypass', '-File', filePath, ...execArgs];
          } else if (fileExt === '.bat' && isWindows) {
            commandToRun = 'cmd.exe';
            finalSpawnArgs = ['/c', filePath, ...execArgs];
          }
          // For other types (e.g., .exe on Windows, or compiled binaries on POSIX),
          // commandToRun remains filePath, and finalSpawnArgs are just execArgs.

          console.log(`Attempting to execute: command='${commandToRun}', args='${JSON.stringify(finalSpawnArgs)}', original file='${filePath}'`);

          const childProcess = spawn(commandToRun, finalSpawnArgs, { timeout: 60000 });
          let stdout = '';
          let stderr = '';
          let timedOut = false;

          childProcess.stdout.on('data', (data) => {
            stdout += data.toString();
          });

          childProcess.stderr.on('data', (data) => {
            stderr += data.toString();
          });

          childProcess.on('timeout', () => {
            timedOut = true;
            childProcess.kill('SIGTERM'); // Send SIGTERM on timeout
            // The 'close' event will handle the resolve with timeout context
          });

          childProcess.on('error', (err) => {
            // This handles errors in spawning the process itself (e.g., command not found)
            console.error(
              `Failed to start process for command '${commandToRun}' with args '${JSON.stringify(finalSpawnArgs)}' (original file: '${filePath}'):`,
              err
            );
            doResolve(
              JSON.stringify({
                success: false,
                operation,
                path: filePath,
                args: execArgs,
                error: `Failed to start process '${commandToRun}': ${err.message}`,
              })
            );
          });

          childProcess.on('close', (code, signal) => {
            if (timedOut) {
              doResolve(
                JSON.stringify({
                  success: false,
                  operation,
                  path: filePath,
                  args: execArgs,
                  stdout: stdout.trim(),
                  stderr: stderr.trim(),
                  error: 'File execution timed out after 60 seconds and was terminated.', // Updated timeout message
                })
              );
            } else if (code === 0) {
              doResolve(JSON.stringify({ success: true, operation, path: filePath, args: execArgs, stdout: stdout.trim(), stderr: stderr.trim() }));
            } else {
              let errMsg = `Process exited with code ${code}`;
              if (signal) {
                errMsg = `Process terminated by signal: ${signal}`;
              }
              const fullStderr = `${stderr.trim()}${stderr.trim() && stdout.trim() ? '\n' : ''}${stdout.trim()}`; // Combine stdout if stderr also present
              doResolve(
                JSON.stringify({
                  success: false,
                  operation,
                  path: filePath,
                  args: execArgs,
                  stdout: stdout.trim(),
                  stderr: `${errMsg}${fullStderr ? ': ' + fullStderr : ''}`.trim(),
                })
              );
            }
          });
        } catch (accessError) {
          // This catch is for fs.access errors
          if (accessError.code === 'ENOENT') {
            doResolve(JSON.stringify({ success: false, operation, path: filePath, args: execArgs, error: `File not found: ${filePath}` }));
          } else {
            // Other errors from fs.access (e.g., permission issues with the path itself)
            console.error(`Error accessing file '${filePath}' before execution:`, accessError);
            doResolve(
              JSON.stringify({
                success: false,
                operation,
                path: filePath,
                args: execArgs,
                error: `Error accessing file '${filePath}': ${accessError.message}`,
              })
            );
          }
        }
      });
    },
  },
  agnt_workflows: {
    schema: {
      type: 'function',
      function: {
        name: 'agnt_workflows',
        description:
          'Manages AGNT workflows. Allows generating workflow definitions, creating, listing, activating, deactivating, retrieving status, triggering workflows, deleting workflows, and fetching execution details or outputs. Requires AGNT_API_KEY to be set in environment variables.',
        parameters: {
          type: 'object',
          properties: {
            operation: {
              type: 'string',
              enum: [
                'generate_workflow_definition',
                'create_workflow',
                'list_workflows',
                'get_workflow_details',
                'activate_workflow',
                'deactivate_workflow',
                'get_workflow_status',
                'trigger_workflow',
                'delete_workflow',
                'get_workflow_executions',
                'get_execution_logs',
                'get_latest_workflow_output',
              ],
              description: 'The AGNT workflow operation to perform.',
            },
            workflow_description: {
              type: 'string',
              description: "A natural language description of what the workflow should do. Used for 'generate_workflow_definition'.",
            },
            available_tool_ids: {
              type: 'array',
              items: { type: 'string' },
              description:
                "Optional. An array of tool type IDs (e.g., 'execute_javascript_code', 'web_search') that can be used by the generated AGNT workflow. Used for 'generate_workflow_definition'.",
            },
            workflow_definition: {
              type: 'string',
              description:
                "A JSON string representing the workflow definition. Used for 'create_workflow'. The definition should be a complete AGNT workflow JSON object.",
            },
            workflow_id: {
              type: 'string',
              description:
                "The ID of the AGNT workflow. Required for operations like 'activate_workflow', 'deactivate_workflow', 'get_workflow_status', 'trigger_workflow', 'get_workflow_details', 'get_workflow_executions', 'get_latest_workflow_output'.",
            },
            trigger_data: {
              type: 'object',
              description: "An object containing data to trigger a workflow with. Used for 'trigger_workflow'.",
            },
            execution_id: {
              type: 'string',
              description: "The ID of the AGNT workflow execution. Required for 'get_execution_logs'.",
            },
          },
          required: ['operation'],
        },
      },
    },
    execute: async (
      { operation, workflow_description, available_tool_ids, workflow_definition, workflow_id, trigger_data, execution_id },
      authToken
    ) => {
      console.log(`Tool call: agnt_workflows with operation: ${operation}`);

      if (!authToken) {
        return JSON.stringify({ success: false, error: 'User authentication token is required for AGNT workflow operations.' });
      }
      // Ensure AGNT_API_KEY is present if other SDK functionalities (not user-specific) might depend on it,
      // but for user-specific calls, the authToken will be used for the AGNT instance.
      // For now, we assume AGNT SDK itself doesn't gate on AGNT_API_KEY if a user token is effectively used for AGNT instance.
      // The original check was: if (!process.env.AGNT_API_KEY) return JSON.stringify({ success: false, error: "AGNT_API_KEY not found in environment variables." });

      let userApiKey = authToken;
      if (authToken.toLowerCase().startsWith('bearer ')) {
        userApiKey = authToken.substring(7);
      }
      const agnt = new AGNT(userApiKey); // Uses user's token

      try {
        let result;
        switch (operation) {
          case 'generate_workflow_definition':
            if (!workflow_description) {
              return JSON.stringify({ success: false, error: "workflow_description is required for 'generate_workflow_definition'." });
            }

            let allToolsFromLibrary = [];
            try {
              const toolLibraryPath = path.join(__dirname, '../../tools/toolLibrary.json');
              const rawToolLibrary = await fs.readFile(toolLibraryPath, 'utf-8');
              const toolLibraryData = JSON.parse(rawToolLibrary);

              for (const category in toolLibraryData) {
                if (Array.isArray(toolLibraryData[category])) {
                  allToolsFromLibrary.push(...toolLibraryData[category]);
                }
              }
            } catch (err) {
              console.error('Failed to load or parse toolLibrary.json:', err);
              return JSON.stringify({ success: false, error: 'Failed to load internal tool library for workflow generation.' });
            }

            let toolsForAgntWorkflow = allToolsFromLibrary;
            if (available_tool_ids && available_tool_ids.length > 0) {
              const toolIdSet = new Set(available_tool_ids);
              toolsForAgntWorkflow = allToolsFromLibrary.filter((tool) => toolIdSet.has(tool.type));

              if (toolsForAgntWorkflow.length === 0 && available_tool_ids.length > 0) {
                console.warn(
                  `AGNT Workflow: available_tool_ids provided (${available_tool_ids.join(
                    ', '
                  )}), but no matching tools found in toolLibrary.json. The AI will be informed that no specific tools from this list are available.`
                );
              } else if (toolsForAgntWorkflow.length < available_tool_ids.length) {
                const foundIds = new Set(toolsForAgntWorkflow.map((t) => t.type));
                const missingIds = available_tool_ids.filter((id) => !foundIds.has(id));
                console.warn(
                  `AGNT Workflow: Some specified available_tool_ids not found in toolLibrary.json: ${missingIds.join(
                    ', '
                  )}. Only found tools will be passed.`
                );
              }
            }

            const workflowElements = {
              overview: workflow_description,
              availableTools: toolsForAgntWorkflow, // Pass the array of full tool schema objects
              customTools: [], // Placeholder for future enhancement if needed
              relevantWorkflows: [], // Placeholder for future enhancement if needed
            };
            result = await agnt.workflows.generate(workflowElements);
            break;

          case 'create_workflow':
            if (!workflow_definition) {
              return JSON.stringify({ success: false, error: "workflow_definition (JSON string) is required for 'create_workflow'." });
            }
            try {
              const parsedDefinition = JSON.parse(workflow_definition);
              result = await agnt.workflows.create(parsedDefinition); // create expects the parsed object
            } catch (e) {
              return JSON.stringify({ success: false, error: `Invalid JSON in workflow_definition: ${e.message}` });
            }
            break;

          case 'list_workflows':
            result = await agnt.workflows.list();
            break;

          case 'get_workflow_details':
            if (!workflow_id) {
              return JSON.stringify({ success: false, error: "workflow_id is required for 'get_workflow_details'." });
            }
            result = await agnt.workflows.get(workflow_id);
            break;

          case 'activate_workflow':
            if (!workflow_id) {
              return JSON.stringify({ success: false, error: "workflow_id is required for 'activate_workflow'." });
            }
            result = await agnt.workflows.activate(workflow_id);
            break;

          case 'deactivate_workflow':
            if (!workflow_id) {
              return JSON.stringify({ success: false, error: "workflow_id is required for 'deactivate_workflow'." });
            }
            result = await agnt.workflows.deactivate(workflow_id);
            break;

          case 'get_workflow_status':
            if (!workflow_id) {
              return JSON.stringify({ success: false, error: "workflow_id is required for 'get_workflow_status'." });
            }
            result = await agnt.workflows.fetchState(workflow_id);
            break;

          case 'trigger_workflow':
            if (!workflow_id) {
              return JSON.stringify({ success: false, error: "workflow_id is required for 'trigger_workflow'." });
            }
            if (trigger_data === undefined) {
              // trigger_data can be an empty object {}
              return JSON.stringify({ success: false, error: "trigger_data (even if empty object) is required for 'trigger_workflow'." });
            }
            result = await agnt.workflows.trigger(workflow_id, trigger_data || {});
            break;

          case 'delete_workflow':
            if (!workflow_id) {
              return JSON.stringify({ success: false, error: "workflow_id is required for 'delete_workflow'." });
            }
            await agnt.workflows.delete(workflow_id);
            result = { message: `Workflow ${workflow_id} deleted successfully.` }; // Or the SDK might return something specific
            break;

          case 'get_workflow_executions':
            if (!workflow_id) {
              return JSON.stringify({ success: false, error: "workflow_id is required for 'get_workflow_executions'." });
            }
            result = await agnt.executions.listForWorkflow(workflow_id);
            break;

          case 'get_execution_logs':
            if (!execution_id) {
              return JSON.stringify({ success: false, error: "execution_id is required for 'get_execution_logs'." });
            }
            result = await agnt.executions.getLogs(execution_id);
            break;

          case 'get_latest_workflow_output':
            if (!workflow_id) {
              return JSON.stringify({ success: false, error: "workflow_id is required for 'get_latest_workflow_output'." });
            }
            result = await agnt.contentOutputs.getLatestForWorkflow(workflow_id);
            break;

          default:
            return JSON.stringify({ success: false, error: `Unknown AGNT workflow operation: ${operation}` });
        }
        return JSON.stringify({ success: true, operation, result });
      } catch (error) {
        console.error(`AGNT workflow tool operation '${operation}' failed:`, error);
        // AGNT SDK methods might throw errors with response data
        const errorMessage = error.response?.data?.message || error.message || 'An unknown error occurred';
        return JSON.stringify({ success: false, error: `AGNT operation '${operation}' failed: ${errorMessage}`, details: error.toString() });
      }
    },
  },
  agnt_tools: {
    schema: {
      type: 'function',
      function: {
        name: 'agnt_tools',
        description:
          'Manages AGNT custom tools. Allows generating tool templates, creating, listing, retrieving details, updating, and deleting custom tools. Requires AGNT_API_KEY to be set in environment variables.',
        parameters: {
          type: 'object',
          properties: {
            operation: {
              type: 'string',
              enum: ['generate_tool_template', 'create_tool', 'list_tools', 'get_tool_details', 'update_tool', 'delete_tool'],
              description: 'The AGNT custom tool operation to perform.',
            },
            tool_description: {
              type: 'string',
              description: "A natural language description of what the custom tool should do. Used for 'generate_tool_template'.",
            },
            tool_definition: {
              type: 'string', // JSON string
              description:
                "A JSON string representing the tool definition. Used for 'create_tool' and 'update_tool'. This should be the complete tool object.",
            },
            tool_id: {
              type: 'string',
              description: "The ID of the AGNT custom tool. Required for 'get_tool_details', 'update_tool', and 'delete_tool'.",
            },
          },
          required: ['operation'],
        },
      },
    },
    execute: async ({ operation, tool_description, tool_definition, tool_id }, authToken) => {
      console.log(`Tool call: agnt_tools with operation: ${operation}`);

      if (!authToken) {
        return JSON.stringify({ success: false, error: 'User authentication token is required for AGNT tool operations.' });
      }
      // Similar to agnt_workflows, AGNT_API_KEY might not be directly needed for user-specific ops if authToken is used.
      // Original check: if (!process.env.AGNT_API_KEY) return JSON.stringify({ success: false, error: "AGNT_API_KEY not found in environment variables." });

      let userApiKey = authToken;
      if (authToken.toLowerCase().startsWith('bearer ')) {
        userApiKey = authToken.substring(7);
      }
      const agnt = new AGNT(userApiKey); // Uses user's token

      try {
        let result;
        switch (operation) {
          case 'generate_tool_template':
            if (!tool_description) {
              return JSON.stringify({ success: false, error: "tool_description is required for 'generate_tool_template'." });
            }
            // The agnt.tools.generateTool in agnt2.js returns { template: toolTemplate, rawResponse: response }
            const generationResult = await agnt.tools.generateTool(tool_description);
            result = generationResult.template; // Return only the toolTemplate
            break;

          case 'create_tool':
            if (!tool_definition) {
              return JSON.stringify({ success: false, error: "tool_definition (JSON string) is required for 'create_tool'." });
            }
            try {
              const parsedDefinition = JSON.parse(tool_definition);
              result = await agnt.tools.create(parsedDefinition); // agnt2.js create handles wrapping if needed
            } catch (e) {
              return JSON.stringify({ success: false, error: `Invalid JSON in tool_definition: ${e.message}` });
            }
            break;

          case 'list_tools':
            result = await agnt.tools.list();
            break;

          case 'get_tool_details':
            if (!tool_id) {
              return JSON.stringify({ success: false, error: "tool_id is required for 'get_tool_details'." });
            }
            result = await agnt.tools.get(tool_id);
            break;

          case 'update_tool':
            if (!tool_id) {
              return JSON.stringify({ success: false, error: "tool_id is required for 'update_tool'." });
            }
            if (!tool_definition) {
              return JSON.stringify({ success: false, error: "tool_definition (JSON string) is required for 'update_tool'." });
            }
            try {
              const parsedUpdateDefinition = JSON.parse(tool_definition);
              result = await agnt.tools.update(tool_id, parsedUpdateDefinition);
            } catch (e) {
              return JSON.stringify({ success: false, error: `Invalid JSON in tool_definition for update: ${e.message}` });
            }
            break;

          case 'delete_tool':
            if (!tool_id) {
              return JSON.stringify({ success: false, error: "tool_id is required for 'delete_tool'." });
            }
            await agnt.tools.delete(tool_id); // delete method in BaseModule doesn't return anything
            result = { message: `Custom tool ${tool_id} deleted successfully.` };
            break;

          default:
            return JSON.stringify({ success: false, error: `Unknown AGNT tool operation: ${operation}` });
        }
        return JSON.stringify({ success: true, operation, result });
      } catch (error) {
        console.error(`AGNT tool operation '${operation}' failed:`, error);
        const errorMessage = error.response?.data?.message || error.message || 'An unknown error occurred with AGNT tools module.';
        return JSON.stringify({ success: false, error: `AGNT tool operation '${operation}' failed: ${errorMessage}`, details: error.toString() });
      }
    },
  },
  execute_custom_agnt_tool: {
    schema: {
      type: 'function',
      function: {
        name: 'execute_custom_agnt_tool',
        description:
          'Executes a previously defined custom AGNT tool by its ID, using the provided input parameters. Custom tools are typically prompt-based and created via the ToolForge or AGNT tools API.',
        parameters: {
          type: 'object',
          properties: {
            tool_id: {
              type: 'string',
              description: 'The ID of the custom AGNT tool to execute.',
            },
            input_parameters: {
              type: 'object',
              description:
                "An object containing key-value pairs for the input fields defined in the custom tool. For example, if the tool has fields 'topic' and 'tone', this would be {'topic': 'AI', 'tone': 'formal'}.",
              additionalProperties: true, // Allows any properties
            },
          },
          required: ['tool_id', 'input_parameters'],
        },
      },
    },
    execute: async ({ tool_id, input_parameters }, authToken, { openai }) => {
      console.log(`Tool call: execute_custom_agnt_tool with tool_id: "${tool_id}", parameters:`, input_parameters);
      if (!tool_id) {
        return JSON.stringify({ success: false, error: 'tool_id is required.' });
      }
      if (!input_parameters || typeof input_parameters !== 'object') {
        // Allow empty input_parameters if the tool doesn't require any
        // return JSON.stringify({ success: false, error: "input_parameters (object) is required." });
      }

      try {
        const toolDefinitionUrl = `http://localhost:3333/api/custom-tools/${tool_id}`;
        const fetchOptions = {};
        if (authToken) {
          fetchOptions.headers = { Authorization: authToken };
        } else {
          console.warn(`execute_custom_agnt_tool: No authToken provided for fetching tool ${tool_id}. Endpoint might require auth.`);
        }

        const response = await fetch(toolDefinitionUrl, fetchOptions);

        if (!response.ok) {
          const errorText = await response.text();
          let detailError = errorText;
          try {
            const jsonError = JSON.parse(errorText);
            detailError = jsonError.error || errorText;
          } catch (e) {
            /* ignore if not json */
          }
          console.error(`Failed to fetch custom tool ${tool_id}: ${response.status} - ${detailError}`);
          return JSON.stringify({
            success: false,
            error: `Custom tool with ID '${tool_id}' not found or error fetching: ${response.statusText}. Detail: ${detailError}`,
          });
        }

        const tool = await response.json();

        if (!tool || !tool.parameters || !tool.parameters.instructions) {
          console.error(`Invalid tool definition for ${tool_id}:`, tool);
          return JSON.stringify({
            success: false,
            error: `Invalid or incomplete definition for custom tool ID '${tool_id}'. Missing 'parameters.instructions'.`,
          });
        }

        let promptTemplate = tool.parameters.instructions;

        // Substitute input_parameters into the promptTemplate
        // The prompt template uses {{variable_name}}
        for (const key in input_parameters) {
          const regex = new RegExp(`{{${key}}}`, 'g');
          promptTemplate = promptTemplate.replace(regex, input_parameters[key]);
        }

        // Check for any remaining unsubstituted placeholders (optional, for debugging)
        const unsubstitutedMatch = promptTemplate.match(/{{(.*?)}}/);
        if (unsubstitutedMatch) {
          console.warn(
            `Warning: Unsubstituted placeholder found in prompt for tool ${tool_id}: ${unsubstitutedMatch[0]}. Parameters provided:`,
            input_parameters
          );
          // Optionally, you could return an error or proceed
          // For now, we'll proceed, the LLM might handle it or ignore it.
        }

        // For now, execute using the orchestrator's default OpenAI client and model
        // In the future, this could be extended to use tool.parameters.provider and tool.parameters.model
        if (!openai) {
          return JSON.stringify({ success: false, error: 'OpenAI client not available in orchestrator.' });
        }

        // Add MathJax instruction for the LLM executing the custom tool
        // const mathJaxInstruction = "IMPORTANT: If returning advanced math or chemical notation, ALWAYS INCLUDE DOUBLE DOLLAR SIGNS SPACE '$$ ' at the beginning and '$$' end of any MathJax advanced math notation. For example: '$$ \\sigma = \\sqrt{\\text{Var}(X)} $$'. For chemical formulas, use '$$\\ce{H2O}$$'.";

        const messagesForToolExecution = [
          // { role: "system", content: mathJaxInstruction }, // Removed from here
          { role: 'user', content: promptTemplate },
        ];

        const llmResponse = await openai.chat.completions.create({
          model: tool.parameters.model || 'gpt-4o-mini', // Use tool's model or orchestrator's default
          messages: messagesForToolExecution,
        });

        const output = llmResponse.choices[0].message.content;
        return JSON.stringify({ success: true, tool_id: tool_id, output: output });
      } catch (error) {
        console.error(`Error executing custom AGNT tool ${tool_id}:`, error);
        return JSON.stringify({ success: false, tool_id: tool_id, error: `Execution failed: ${error.message}` });
      }
    },
  },
  send_email: {
    schema: {
      type: 'function',
      function: {
        name: 'send_email',
        description: 'Sends an email using a remote email service API. Requires REMOTE_URL to be set in environment variables.',
        parameters: {
          type: 'object',
          properties: {
            to: {
              type: 'string',
              description: "The recipient's email address (e.g., 'recipient@example.com').",
            },
            subject: {
              type: 'string',
              description: 'The subject line of the email.',
            },
            body: {
              type: 'string',
              description: 'The content of the email. Can be plain text or HTML.',
            },
            isHtml: {
              type: 'boolean',
              default: false,
              description: 'Set to true if the body is HTML content, false for plain text. Defaults to false.',
            },
            senderName: {
              type: 'string',
              description: "Optional. The name to display as the sender (e.g., 'My Application'). If not provided, a default will be used.",
            },
          },
          required: ['to', 'subject', 'body'],
        },
      },
    },
    execute: async ({ to, subject, body, isHtml = false, senderName }, authToken, context) => {
      console.log(`Tool call: send_email to: "${to}", subject: "${subject}"`);

      if (!process.env.REMOTE_URL) {
        const errorMsg = 'REMOTE_URL environment variable is not configured for email service.';
        console.error(errorMsg);
        return JSON.stringify({ success: false, error: errorMsg });
      }

      if (!to || !subject || !body) {
        return JSON.stringify({ success: false, error: 'To, subject, and body are required for sending an email.' });
      }

      try {
        // Extract workflowId from context if available, otherwise use a default
        const workflowId = context?.workflowId || 'orchestrator-tool';

        const params = {
          to,
          subject,
          body,
          isHtml,
          senderName,
        };

        const response = await fetch(`${process.env.REMOTE_URL}/email/send`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            params,
            workflowId,
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`Email API error: ${response.status} ${response.statusText}`, errorText);
          return JSON.stringify({
            success: false,
            error: `Email service API error: ${response.statusText}`,
            details: errorText,
            to,
            subject,
          });
        }

        const responseData = await response.json();
        console.log('Email sent successfully via API. Response:', responseData);

        return JSON.stringify({
          success: true,
          messageId: responseData.messageId,
          to,
          subject,
          serverResponse: {
            status: response.status,
            statusText: response.statusText,
            data: responseData,
          },
        });
      } catch (error) {
        console.error('Error sending email via API:', error);
        return JSON.stringify({
          success: false,
          error: `Failed to send email via API: ${error.message}`,
          details: error.toString(),
          to,
          subject,
        });
      }
    },
  },
  agnt_goals: {
    schema: {
      type: 'function',
      function: {
        name: 'agnt_goals',
        description:
          'Manages user goals. Allows creating new goals, listing all goals, retrieving specific goal details and status, executing, pausing, resuming, and deleting goals. Requires user authentication.',
        parameters: {
          type: 'object',
          properties: {
            operation: {
              type: 'string',
              enum: [
                'create_goal',
                'list_all_goals',
                'get_goal_details',
                'get_goal_status',
                'execute_goal_action',
                'pause_goal_action',
                'resume_goal_action',
                'delete_goal_action',
              ],
              description: 'The goal management operation to perform.',
            },
            goal_id: {
              type: 'string',
              description:
                "The ID of the goal. Required for operations like 'get_goal_details', 'execute_goal_action', 'pause_goal_action', 'resume_goal_action', 'delete_goal_action'.",
            },
            title: {
              type: 'string',
              description: "The title of the goal. Required for 'create_goal'.",
            },
            description: {
              type: 'string',
              description: "The description of the goal. Optional for 'create_goal'.",
            },
            priority: {
              type: 'string',
              enum: ['low', 'medium', 'high'],
              description: "The priority of the goal. Optional for 'create_goal', defaults to 'medium'.",
            },
            success_criteria: {
              type: 'object',
              description:
                'An object representing the success criteria for \'create_goal\'. For example: {"metric": "task completion", "target": "100%"}. This object will be stored with the goal.',
              additionalProperties: true,
            },
          },
          required: ['operation'],
        },
      },
    },
    execute: async (args, authToken) => {
      const { operation, goal_id, title, description, priority, success_criteria } = args;
      console.log(`Tool call: agnt_goals with operation: ${operation}, args:`, args);

      if (!authToken) {
        return JSON.stringify({ success: false, error: 'Authentication token is required for goal operations.' });
      }

      const GOALS_API_BASE_URL = `http://localhost:${process.env.PORT || 3333}/api/goals`;
      let url = GOALS_API_BASE_URL;
      let options = {
        headers: {
          Authorization: authToken,
          'Content-Type': 'application/json',
        },
      };
      let requestBody = {};

      try {
        switch (operation) {
          case 'create_goal':
            if (!title) return JSON.stringify({ success: false, error: "Title is required for 'create_goal'." });
            url += '/create';
            options.method = 'POST';
            requestBody = { title };
            if (description) requestBody.description = description;
            if (priority) requestBody.priority = priority;
            if (success_criteria) requestBody.success_criteria = success_criteria; // API expects an object
            options.body = JSON.stringify(requestBody);
            break;

          case 'list_all_goals':
            options.method = 'GET';
            // URL is already GOALS_API_BASE_URL
            break;

          case 'get_goal_details':
            if (!goal_id) return JSON.stringify({ success: false, error: "goal_id is required for 'get_goal_details'." });
            url += `/${goal_id}`;
            options.method = 'GET';
            break;

          case 'get_goal_status':
            if (!goal_id) return JSON.stringify({ success: false, error: "goal_id is required for 'get_goal_status'." });
            url += `/${goal_id}/status`;
            options.method = 'GET';
            break;

          case 'execute_goal_action':
            if (!goal_id) return JSON.stringify({ success: false, error: "goal_id is required for 'execute_goal_action'." });
            url += `/${goal_id}/execute`;
            options.method = 'POST';
            // No body needed for this action based on GoalRoutes
            options.body = JSON.stringify({}); // Send empty JSON object for POST
            break;

          case 'pause_goal_action':
            if (!goal_id) return JSON.stringify({ success: false, error: "goal_id is required for 'pause_goal_action'." });
            url += `/${goal_id}/pause`;
            options.method = 'POST';
            options.body = JSON.stringify({});
            break;

          case 'resume_goal_action':
            if (!goal_id) return JSON.stringify({ success: false, error: "goal_id is required for 'resume_goal_action'." });
            url += `/${goal_id}/resume`;
            options.method = 'POST';
            options.body = JSON.stringify({});
            break;

          case 'delete_goal_action':
            if (!goal_id) return JSON.stringify({ success: false, error: "goal_id is required for 'delete_goal_action'." });
            url += `/${goal_id}`;
            options.method = 'DELETE';
            break;

          default:
            return JSON.stringify({ success: false, error: `Unknown agnt_goals operation: ${operation}` });
        }

        const response = await fetch(url, options);
        const responseText = await response.text(); // Read text first for better error diagnosis

        if (!response.ok) {
          let errorDetails = responseText;
          try {
            // Attempt to parse if the error is JSON
            const jsonError = JSON.parse(responseText);
            errorDetails = jsonError.message || jsonError.error || responseText;
          } catch (e) {
            // Not JSON, use raw text
          }
          console.error(`agnt_goals API error: ${response.status} ${response.statusText}`, errorDetails);
          return JSON.stringify({
            success: false,
            error: `API request failed for operation '${operation}' with status ${response.status}: ${errorDetails}`,
            url,
            method: options.method,
          });
        }

        // Attempt to parse response as JSON if content-type suggests it or if it's not a DELETE
        if (options.method !== 'DELETE' && responseText) {
          try {
            const data = JSON.parse(responseText);
            return JSON.stringify({ success: true, operation, data });
          } catch (e) {
            // If parsing fails but response was OK (e.g. for non-JSON success responses)
            console.warn(`agnt_goals: Non-JSON response for supposedly successful ${operation} from ${url}:`, responseText);
            return JSON.stringify({ success: true, operation, data: responseText }); // Return raw text if not JSON
          }
        } else if ((options.method === 'DELETE' && response.status === 200) || response.status === 204) {
          // For DELETE, a 200/204 with no content is success
          return JSON.stringify({ success: true, operation, message: `Goal ${goal_id} deleted successfully (or action completed).` });
        }
        // Fallback for unexpected empty but OK responses
        return JSON.stringify({ success: true, operation, data: responseText || 'Operation completed successfully.' });
      } catch (error) {
        console.error(`Error in agnt_goals tool operation '${operation}':`, error);
        return JSON.stringify({ success: false, error: `Tool execution failed for '${operation}': ${error.message}` });
      }
    },
  },
  agnt_agents: {
    schema: {
      type: 'function',
      function: {
        name: 'agnt_agents',
        description:
          'Manages AGNT agents. Allows creating, listing, retrieving details, updating, and deleting agents. User authentication is required for these operations.',
        parameters: {
          type: 'object',
          properties: {
            operation: {
              type: 'string',
              enum: ['create_agent', 'list_agents', 'get_agent_details', 'update_agent', 'delete_agent'],
              description: 'The AGNT agent operation to perform.',
            },
            agent_id: {
              type: 'string',
              description: "The ID of the AGNT agent. Required for 'get_agent_details', 'update_agent', and 'delete_agent'.",
            },
            agent_data: {
              type: 'object',
              description:
                "Configuration object for creating or updating an agent. Required for 'create_agent' and 'update_agent' operations. Consult the properties of this object for detailed field requirements.",
              properties: {
                name: {
                  type: 'string',
                  description: 'The name of the agent. This is required for creation.',
                },
                description: {
                  type: 'string',
                  description: 'A brief description of what the agent does or is intended for.',
                },
                status: {
                  type: 'string',
                  enum: ['active', 'inactive'],
                  description: 'The operational status of the agent.',
                  default: 'active',
                },
                icon: {
                  type: 'string',
                  description: "An emoji or a short string identifier for the agent's icon (e.g., '🤖', '📈', 'marketing-icon').",
                },
                category: {
                  type: 'string',
                  description: "A category to classify the agent (e.g., 'marketing', 'data_analysis', 'customer_support').",
                },
                assignedTools: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'An array of tool IDs that this agent is permitted to use.',
                  default: [],
                },
                assignedWorkflows: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'An array of workflow IDs that this agent can trigger or manage.',
                  default: [],
                },
                creditLimit: {
                  type: 'number',
                  description: 'The credit limit allocated to this agent. This is required for creation.',
                  default: 1000,
                },
                creditsUsed: {
                  type: 'number',
                  description: 'The amount of credits already consumed by this agent. This is required for creation.',
                  default: 0,
                },
                // Optional fields, more relevant for updates or detailed configurations
                lastActive: {
                  type: 'string',
                  format: 'date-time',
                  description: 'Timestamp of when the agent was last active. Usually system-set on update.',
                },
                successRate: {
                  type: 'number',
                  minimum: 0,
                  maximum: 100,
                  description: 'The success rate of the agent, as a percentage from 0 to 100. Usually system-calculated.',
                },
              },
              required: ['name', 'creditLimit', 'creditsUsed'], // Fields that MUST be present in agent_data for creation
              additionalProperties: true, // Allows backend to be flexible, but LLM should primarily use defined properties.
            },
          },
          required: ['operation'],
        },
      },
    },
    execute: async ({ operation, agent_id, agent_data }, authToken) => {
      console.log(`Tool call: agnt_agents with operation: ${operation}`);

      if (!authToken) {
        return JSON.stringify({ success: false, error: 'User authentication token is required for AGNT agent operations.' });
      }
      // Original check: if (!process.env.AGNT_API_KEY) return JSON.stringify({ success: false, error: "AGNT_API_KEY not found in environment variables." });

      let userApiKey = authToken;
      if (authToken.toLowerCase().startsWith('bearer ')) {
        userApiKey = authToken.substring(7);
      }
      const agnt = new AGNT(userApiKey); // Uses user's token

      try {
        let result;
        switch (operation) {
          case 'create_agent':
            if (!agent_data || typeof agent_data !== 'object') {
              return JSON.stringify({ success: false, error: "agent_data (object) is required for 'create_agent'." });
            }
            // The agnt.agents.create method in agnt2.js handles wrapping { agent: agent_data }
            result = await agnt.agents.create(agent_data);
            break;

          case 'list_agents':
            const agentsList = await agnt.agents.list(); // agnt2.js handles unwrapping .agents
            // Remove icon data from each agent
            if (Array.isArray(agentsList)) {
              result = agentsList.map((agent) => {
                const { icon, ...agentWithoutIcon } = agent;
                return agentWithoutIcon;
              });
            } else if (agentsList && typeof agentsList === 'object' && Array.isArray(agentsList.agents)) {
              // Handle cases where the list might be nested under an 'agents' property
              result = {
                ...agentsList,
                agents: agentsList.agents.map((agent) => {
                  const { icon, ...agentWithoutIcon } = agent;
                  return agentWithoutIcon;
                }),
              };
            } else {
              // If the structure is unexpected, return as is but log a warning
              console.warn('Unexpected format for agents list, icon removal might not be complete:', agentsList);
              result = agentsList;
            }
            break;

          case 'get_agent_details':
            if (!agent_id) {
              return JSON.stringify({ success: false, error: "agent_id is required for 'get_agent_details'." });
            }
            result = await agnt.agents.get(agent_id);
            break;

          case 'update_agent':
            if (!agent_id) {
              return JSON.stringify({ success: false, error: "agent_id is required for 'update_agent'." });
            }
            if (!agent_data || typeof agent_data !== 'object') {
              return JSON.stringify({ success: false, error: "agent_data (object) is required for 'update_agent'." });
            }
            // The agnt.agents.update method in agnt2.js handles wrapping { agent: agent_data }
            result = await agnt.agents.update(agent_id, agent_data);
            break;

          case 'delete_agent':
            if (!agent_id) {
              return JSON.stringify({ success: false, error: "agent_id is required for 'delete_agent'." });
            }
            await agnt.agents.delete(agent_id);
            result = { message: `Agent ${agent_id} deleted successfully.` };
            break;

          default:
            return JSON.stringify({ success: false, error: `Unknown AGNT agent operation: ${operation}` });
        }
        return JSON.stringify({ success: true, operation, result });
      } catch (error) {
        console.error(`AGNT agent operation '${operation}' failed:`, error);
        const errorMessage = error.response?.data?.message || error.message || 'An unknown error occurred with AGNT agents module.';
        const errorDetails = error.response?.data?.details || error.toString();
        return JSON.stringify({ success: false, error: `AGNT agent operation '${operation}' failed: ${errorMessage}`, details: errorDetails });
      }
    },
  },
  agnt_auth: {
    schema: {
      type: 'function',
      function: {
        name: 'agnt_auth',
        description:
          'Manages authentication providers and API keys via the AGNT auth system. Requires AGNT_API_KEY for authorization with the remote auth server.',
        parameters: {
          type: 'object',
          properties: {
            operation: {
              type: 'string',
              enum: [
                'list_providers',
                'create_provider',
                'update_provider',
                'delete_provider',
                'get_provider_details',
                'store_api_key',
                'retrieve_api_key',
                'connect_provider',
                'disconnect_provider',
                'get_connected_apps',
                'get_valid_token',
              ],
              description: 'The AGNT auth operation to perform.',
            },
            provider_id: {
              type: 'string',
              description:
                "The ID of the auth provider. Required for 'update_provider', 'delete_provider', 'get_provider_details', 'store_api_key', 'retrieve_api_key', 'get_valid_token'.",
            },
            provider_name: {
              type: 'string',
              description:
                "The name of the provider (e.g., 'google', 'github'). Required for 'connect_provider', 'disconnect_provider'. This often matches the provider_id but is used for user-facing connection flows.",
            },
            provider_data: {
              type: 'object',
              description: "A JSON object representing the provider's configuration. Used for 'create_provider' and 'update_provider'.",
              additionalProperties: true,
            },
            api_key_string: {
              type: 'string',
              description: "The API key string to store. Required for 'store_api_key'.",
            },
          },
          required: ['operation'],
        },
      },
    },
    execute: async ({ operation, provider_id, provider_name, provider_data, api_key_string }, authToken) => {
      console.log(`Tool call: agnt_auth with operation: ${operation}`);

      if (!authToken) {
        return JSON.stringify({
          success: false,
          error: 'User authentication token is required for AGNT auth operations.',
        });
      }

      // Extract the JWT token and use it for AGNT authentication
      let userApiKey = authToken;
      if (authToken.toLowerCase().startsWith('bearer ')) {
        userApiKey = authToken.substring(7);
      }
      const agnt = new AGNT(userApiKey); // Uses user's JWT token instead of hardcoded AGNT_API_KEY

      try {
        let result;
        switch (operation) {
          case 'list_providers':
            result = await agnt.auth.listProviders();
            break;
          case 'create_provider':
            if (!provider_data || typeof provider_data !== 'object') {
              return JSON.stringify({ success: false, error: "provider_data (object) is required for 'create_provider'." });
            }
            result = await agnt.auth.createProvider(provider_data);
            break;
          case 'update_provider':
            if (!provider_id) {
              return JSON.stringify({ success: false, error: "provider_id is required for 'update_provider'." });
            }
            if (!provider_data || typeof provider_data !== 'object') {
              return JSON.stringify({ success: false, error: "provider_data (object) is required for 'update_provider'." });
            }
            result = await agnt.auth.updateProvider(provider_id, provider_data);
            break;
          case 'delete_provider':
            if (!provider_id) {
              return JSON.stringify({ success: false, error: "provider_id is required for 'delete_provider'." });
            }
            result = await agnt.auth.deleteProvider(provider_id);
            break;
          case 'get_provider_details':
            if (!provider_id) {
              return JSON.stringify({ success: false, error: "provider_id is required for 'get_provider_details'." });
            }
            result = await agnt.auth.getProvider(provider_id);
            break;
          case 'store_api_key':
            if (!provider_id) {
              return JSON.stringify({ success: false, error: "provider_id is required for 'store_api_key'." });
            }
            if (!api_key_string) {
              return JSON.stringify({ success: false, error: "api_key_string is required for 'store_api_key'." });
            }
            result = await agnt.auth.storeApiKey(provider_id, api_key_string);
            break;
          case 'retrieve_api_key':
            if (!provider_id) {
              return JSON.stringify({ success: false, error: "provider_id is required for 'retrieve_api_key'." });
            }
            result = await agnt.auth.retrieveApiKey(provider_id);
            break;
          case 'connect_provider':
            if (!provider_name) {
              return JSON.stringify({ success: false, error: "provider_name is required for 'connect_provider'." });
            }
            result = await agnt.auth.connectProvider(provider_name); // Returns { authUrl: "..." }
            break;
          case 'disconnect_provider':
            if (!provider_name) {
              return JSON.stringify({ success: false, error: "provider_name is required for 'disconnect_provider'." });
            }
            result = await agnt.auth.disconnectProvider(provider_name);
            break;
          case 'get_connected_apps':
            result = await agnt.auth.getConnectedApps();
            break;
          case 'get_valid_token':
            if (!provider_id) {
              return JSON.stringify({ success: false, error: "provider_id is required for 'get_valid_token'." });
            }
            result = await agnt.auth.getValidToken(provider_id); // Returns { access_token: "..." }
            break;
          default:
            return JSON.stringify({ success: false, error: `Unknown AGNT auth operation: ${operation}` });
        }
        return JSON.stringify({ success: true, operation, result });
      } catch (error) {
        console.error(`AGNT auth operation '${operation}' failed:`, error);
        const errorMessage =
          error.response?.data?.message || error.response?.data?.error || error.message || 'An unknown error occurred with AGNT auth module.';
        const errorDetails = error.response?.data?.details || error.toString();
        return JSON.stringify({ success: false, error: `AGNT auth operation '${operation}' failed: ${errorMessage}`, details: errorDetails });
      }
    },
  },
  agnt_chat: {
    schema: {
      type: 'function',
      function: {
        name: 'agnt_chat',
        description:
          'Enables chatting with AGNT agents. *YOU MUST USE THE ACTUAL AGENT ID. LOOK IT UP FIRST!* *CHECK FOR AND USE EXISTING AGENTS FIRST BEFORE CREATING A NEW ONE* Allows listing available agents, sending messages to agents, getting streaming responses, and retrieving agent information for chat context. User authentication is required. ALWAYS list the agents first so you know what ID to send the chat request to.',
        parameters: {
          type: 'object',
          properties: {
            operation: {
              type: 'string',
              enum: ['list_available_agents', 'get_agent_info', 'send_message', 'send_message_stream', 'get_suggestions'],
              description: 'The agent chat operation to perform.',
            },
            agent_id: {
              type: 'string',
              description:
                "The ID of the agent to interact with. Required for 'get_agent_info', 'send_message', 'send_message_stream', and 'get_suggestions'.",
            },
            message: {
              type: 'string',
              description:
                "The message to send to the agent. Required for 'send_message' and 'send_message_stream' *YOU MUST USE THE ACTUAL AGENT ID. LOOK IT UP FIRST!*.",
            },
            history: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  role: { type: 'string', enum: ['user', 'assistant'] },
                  content: { type: 'string' },
                },
                required: ['role', 'content'],
              },
              description: "Optional conversation history for context. Array of message objects with 'role' and 'content' properties.",
              default: [],
            },
            provider: {
              type: 'string',
              description:
                "Optional LLM provider to use (e.g., 'openai', 'anthropic', 'groq'). If not specified, uses the agent's configured provider. Common values: 'openai', 'anthropic', 'groq', 'deepseek'.",
            },
            model: {
              type: 'string',
              description:
                "Optional LLM model to use (e.g., 'gpt-4o-mini', 'claude-3-5-sonnet-20240620', 'llama-3.1-70b-versatile'). If not specified, uses the agent's configured model. Common OpenAI models: 'gpt-4o', 'gpt-4o-mini'. Common Anthropic models: 'claude-3-5-sonnet-20240620', 'claude-3-haiku-20240307'.",
            },
            last_user_message: {
              type: 'string',
              description: "The last user message for generating contextual suggestions. Used with 'get_suggestions' operation.",
            },
            last_assistant_message: {
              type: 'string',
              description: "The last assistant message for generating contextual suggestions. Used with 'get_suggestions' operation.",
            },
          },
          required: ['operation'],
        },
      },
    },
    execute: async (
      { operation, agent_id, message, history = [], provider, model, last_user_message = '', last_assistant_message = '' },
      authToken,
      context
    ) => {
      console.log(`Tool call: agnt_chat with operation: ${operation}`);

      if (!authToken) {
        return JSON.stringify({ success: false, error: 'User authentication token is required for agent chat operations.' });
      }

      // Extract user ID from auth token
      let userId = null;
      try {
        const token = authToken.replace('Bearer ', '');
        const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
        userId = payload.id || payload.userId || payload.sub;
      } catch (e) {
        console.error('Could not decode auth token for agnt_chat:', e);
        return JSON.stringify({ success: false, error: 'Invalid authentication token.' });
      }

      if (!userId) {
        return JSON.stringify({ success: false, error: 'Could not extract user ID from authentication token.' });
      }

      try {
        let result;
        const API_BASE_URL = `http://localhost:${process.env.PORT || 3333}/api`;

        switch (operation) {
          case 'list_available_agents':
            try {
              const response = await fetch(`${API_BASE_URL}/agents`, {
                headers: { Authorization: authToken },
              });

              if (!response.ok) {
                const errorText = await response.text();
                return JSON.stringify({ success: false, error: `Failed to fetch agents: ${response.statusText}`, details: errorText });
              }

              const data = await response.json();
              const agents = data.agents || [];

              // Return simplified agent info suitable for chat selection
              result = agents.map((agent) => ({
                id: agent.id,
                name: agent.name,
                description: agent.description,
                status: agent.status,
                icon: agent.icon,
                category: agent.category,
                provider: agent.provider,
                model: agent.model,
                assignedTools: agent.assignedTools?.length || 0,
                lastActive: agent.lastActive,
              }));
            } catch (error) {
              return JSON.stringify({ success: false, error: `Failed to list agents: ${error.message}` });
            }
            break;

          case 'get_agent_info':
            if (!agent_id) {
              return JSON.stringify({ success: false, error: "agent_id is required for 'get_agent_info'." });
            }

            try {
              const response = await fetch(`${API_BASE_URL}/agents/${agent_id}`, {
                headers: { Authorization: authToken },
              });

              if (!response.ok) {
                if (response.status === 404) {
                  return JSON.stringify({ success: false, error: 'Agent not found.' });
                } else if (response.status === 403) {
                  return JSON.stringify({ success: false, error: 'You do not have permission to access this agent.' });
                }
                const errorText = await response.text();
                return JSON.stringify({ success: false, error: `Failed to fetch agent info: ${response.statusText}`, details: errorText });
              }

              result = await response.json();
            } catch (error) {
              return JSON.stringify({ success: false, error: `Failed to get agent info: ${error.message}` });
            }
            break;

          case 'send_message':
            if (!agent_id) {
              return JSON.stringify({ success: false, error: "agent_id is required for 'send_message'." });
            }
            if (!message) {
              return JSON.stringify({ success: false, error: "message is required for 'send_message'." });
            }

            // Priority order: 1) Tool parameters, 2) Agent settings, 3) User settings, 4) Hardcoded defaults
            let finalProvider = provider;
            let finalModel = model;

            // Step 1: If not provided in tool call, try to get from agent configuration
            if (!finalProvider || !finalModel) {
              try {
                const agentResponse = await fetch(`${API_BASE_URL}/agents/${agent_id}`, {
                  headers: { Authorization: authToken },
                });

                if (agentResponse.ok) {
                  const agentData = await agentResponse.json();
                  console.log(`Agent data for ${agent_id}:`, { provider: agentData.provider, model: agentData.model });

                  // Use agent's provider/model if not already set and agent has valid values
                  if (!finalProvider && agentData.provider && agentData.provider.trim() !== '') {
                    finalProvider = agentData.provider.trim();
                    console.log(`Using agent's provider: ${finalProvider}`);
                  }
                  if (!finalModel && agentData.model && agentData.model.trim() !== '') {
                    finalModel = agentData.model.trim();
                    console.log(`Using agent's model: ${finalModel}`);
                  }
                } else {
                  console.warn(`Failed to fetch agent ${agent_id}: ${agentResponse.status} ${agentResponse.statusText}`);
                }
              } catch (agentFetchError) {
                console.warn(`Could not fetch agent configuration for ${agent_id}:`, agentFetchError.message);
              }
            }

            // Step 2: If still no provider/model, try to get user's default settings
            if (!finalProvider || !finalModel) {
              try {
                const userSettingsResponse = await fetch(`${API_BASE_URL}/users/settings`, {
                  headers: { Authorization: authToken },
                });

                if (userSettingsResponse.ok) {
                  const userSettings = await userSettingsResponse.json();
                  console.log(`User default settings:`, { provider: userSettings.selectedProvider, model: userSettings.selectedModel });

                  // Use user's provider/model if not already set and user has valid values
                  if (!finalProvider && userSettings.selectedProvider && userSettings.selectedProvider.trim() !== '') {
                    finalProvider = userSettings.selectedProvider.trim();
                    console.log(`Using user's default provider: ${finalProvider}`);
                  }
                  if (!finalModel && userSettings.selectedModel && userSettings.selectedModel.trim() !== '') {
                    finalModel = userSettings.selectedModel.trim();
                    console.log(`Using user's default model: ${finalModel}`);
                  }
                } else {
                  console.warn(`Failed to fetch user settings: ${userSettingsResponse.status} ${userSettingsResponse.statusText}`);
                }
              } catch (userSettingsError) {
                console.warn(`Could not fetch user default settings:`, userSettingsError.message);
              }
            }

            // Step 3: Apply hardcoded defaults if still missing
            if (!finalProvider) {
              finalProvider = 'Anthropic';
              console.log(`Using hardcoded default provider: ${finalProvider}`);
            }
            if (!finalModel) {
              finalModel = 'claude-3-5-sonnet-20240620';
              console.log(`Using hardcoded default model: ${finalModel}`);
            }

            console.log(`Final provider/model for ${agent_id}: provider=${finalProvider}, model=${finalModel}`);

            try {
              const requestBody = {
                messages: [...history, { role: 'user', content: message }],
                provider: finalProvider,
                model: finalModel,
              };

              const response = await fetch(`${API_BASE_URL}/agents/${agent_id}/chat`, {
                method: 'POST',
                headers: {
                  Authorization: authToken,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestBody),
              });

              if (!response.ok) {
                const errorText = await response.text();
                return JSON.stringify({ success: false, error: `Agent chat failed: ${response.statusText}`, details: errorText });
              }

              result = await response.json();
            } catch (error) {
              return JSON.stringify({ success: false, error: `Failed to send message to agent: ${error.message}` });
            }
            break;

          case 'send_message_stream':
            if (!agent_id) {
              return JSON.stringify({ success: false, error: "agent_id is required for 'send_message_stream'." });
            }
            if (!message) {
              return JSON.stringify({ success: false, error: "message is required for 'send_message_stream'." });
            }

            // Get agent configuration to use as defaults for provider/model
            let streamAgentProvider = provider;
            let streamAgentModel = model;

            if (!provider || !model) {
              try {
                const agentResponse = await fetch(`${API_BASE_URL}/agents/${agent_id}`, {
                  headers: { Authorization: authToken },
                });

                if (agentResponse.ok) {
                  const agentData = await agentResponse.json();
                  console.log(`Stream - Agent data for ${agent_id}:`, { provider: agentData.provider, model: agentData.model });

                  if (!streamAgentProvider && agentData.provider) {
                    streamAgentProvider = agentData.provider;
                    console.log(`Stream - Using agent's provider: ${streamAgentProvider}`);
                  }
                  if (!streamAgentModel && agentData.model) {
                    streamAgentModel = agentData.model;
                    console.log(`Stream - Using agent's model: ${streamAgentModel}`);
                  }
                } else {
                  console.warn(`Stream - Failed to fetch agent ${agent_id}: ${agentResponse.status} ${agentResponse.statusText}`);
                }
              } catch (agentFetchError) {
                console.warn(`Could not fetch agent configuration for ${agent_id}:`, agentFetchError.message);
              }
            }

            // If still no provider/model, try to get user's default settings
            if (!streamAgentProvider || !streamAgentModel) {
              try {
                const userSettingsResponse = await fetch(`${API_BASE_URL}/users/settings`, {
                  headers: { Authorization: authToken },
                });

                if (userSettingsResponse.ok) {
                  const userSettings = await userSettingsResponse.json();
                  console.log(`Stream - User default settings:`, { provider: userSettings.selectedProvider, model: userSettings.selectedModel });

                  if (!streamAgentProvider && userSettings.selectedProvider) {
                    streamAgentProvider = userSettings.selectedProvider.toLowerCase();
                    console.log(`Stream - Using user's default provider: ${streamAgentProvider}`);
                  }
                  if (!streamAgentModel && userSettings.selectedModel) {
                    streamAgentModel = userSettings.selectedModel;
                    console.log(`Stream - Using user's default model: ${streamAgentModel}`);
                  }
                } else {
                  console.warn(`Stream - Failed to fetch user settings: ${userSettingsResponse.status} ${userSettingsResponse.statusText}`);
                }
              } catch (userSettingsError) {
                console.warn(`Stream - Could not fetch user default settings:`, userSettingsError.message);
              }
            }

            console.log(`Stream - Final provider/model for ${agent_id}: provider=${streamAgentProvider}, model=${streamAgentModel}`);

            if (!streamAgentProvider) {
              return JSON.stringify({
                success: false,
                error:
                  "provider is required for 'send_message_stream'. Either specify it in the tool call, configure it in the agent settings, or set your default provider in user settings. Common values: 'openai', 'anthropic', 'groq', 'deepseek'.",
              });
            }
            if (!streamAgentModel) {
              return JSON.stringify({
                success: false,
                error:
                  "model is required for 'send_message_stream'. Either specify it in the tool call, configure it in the agent settings, or set your default model in user settings. Examples: 'gpt-4o-mini', 'claude-3-5-sonnet-20240620', 'llama-3.1-70b-versatile'.",
              });
            }

            try {
              const requestBody = {
                message: message,
                history: history,
                provider: streamAgentProvider,
                model: streamAgentModel,
              };

              const response = await fetch(`${API_BASE_URL}/agents/${agent_id}/chat-stream`, {
                method: 'POST',
                headers: {
                  Authorization: authToken,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestBody),
              });

              if (!response.ok) {
                const errorText = await response.text();
                return JSON.stringify({ success: false, error: `Agent stream chat failed: ${response.statusText}`, details: errorText });
              }

              // For streaming responses, we'll collect the stream and return the final result
              // Note: This is a simplified approach. In a real implementation, you might want to
              // handle streaming differently depending on the use case.
              let streamResult = '';
              const reader = response.body.getReader();
              const decoder = new TextDecoder();

              try {
                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;

                  const chunk = decoder.decode(value);
                  const lines = chunk.split('\n');

                  for (const line of lines) {
                    if (line.startsWith('data: ')) {
                      try {
                        const data = JSON.parse(line.slice(6));
                        if (data.content) {
                          streamResult += data.content;
                        }
                      } catch (e) {
                        // Ignore parsing errors for individual chunks
                      }
                    }
                  }
                }
              } finally {
                reader.releaseLock();
              }

              result = {
                role: 'assistant',
                content: streamResult,
                streaming: true,
              };
            } catch (error) {
              return JSON.stringify({ success: false, error: `Failed to send streaming message to agent: ${error.message}` });
            }
            break;

          case 'get_suggestions':
            if (!agent_id) {
              return JSON.stringify({ success: false, error: "agent_id is required for 'get_suggestions'." });
            }

            try {
              const requestBody = {
                history: history,
                lastUserMessage: last_user_message,
                lastAssistantMessage: last_assistant_message,
              };

              const response = await fetch(`${API_BASE_URL}/agents/${agent_id}/suggestions`, {
                method: 'POST',
                headers: {
                  Authorization: authToken,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestBody),
              });

              if (!response.ok) {
                const errorText = await response.text();
                return JSON.stringify({ success: false, error: `Failed to get agent suggestions: ${response.statusText}`, details: errorText });
              }

              result = await response.json();
            } catch (error) {
              return JSON.stringify({ success: false, error: `Failed to get agent suggestions: ${error.message}` });
            }
            break;

          default:
            return JSON.stringify({ success: false, error: `Unknown agnt_chat operation: ${operation}` });
        }

        return JSON.stringify({ success: true, operation, result });
      } catch (error) {
        console.error(`AGNT chat operation '${operation}' failed:`, error);
        const errorMessage = error.message || 'An unknown error occurred with AGNT chat.';
        return JSON.stringify({ success: false, error: `AGNT chat operation '${operation}' failed: ${errorMessage}`, details: error.toString() });
      }
    },
  },
  analyze_image: {
    schema: {
      type: 'function',
      function: {
        name: 'analyze_image',
        description:
          'Analyze images using vision-capable AI models. Supports detailed image analysis, object detection, text extraction (OCR), and answering questions about images. Use this tool when the user asks you to analyze, describe, or extract information from images.',
        parameters: {
          type: 'object',
          properties: {
            image: {
              type: 'string',
              description:
                'Image data in base64 format (data:image/[type];base64,[data]) OR a file path to read the image from. For uploaded images in chat, they are automatically available - you can reference them or ask the user to provide the path.',
            },
            prompt: {
              type: 'string',
              description:
                'Question or instruction about the image. Examples: "What objects are in this image?", "Extract all text from this image", "Describe this image in detail", "What is the main subject of this photo?"',
            },
            provider: {
              type: 'string',
              enum: ['openai', 'openai-codex', 'gemini', 'grokai'],
              description:
                "AI provider to use for vision analysis. Options: 'openai' or 'openai-codex' (OpenAI), 'gemini' (Google), 'grokai' (Grok). If not specified, defaults to 'openai'.",
            },
            model: {
              type: 'string',
              description:
                "Specific vision model to use. OpenAI: 'gpt-4.1'. Gemini: 'gemini-3-pro-preview'. Grok: 'grok-4-1-fast-reasoning'. If not specified, uses provider's default vision model.",
            },
            maxTokens: {
              type: 'number',
              description: 'Maximum tokens for the response. Default is 4096. Increase for more detailed analysis.',
              default: 4096,
            },
            temperature: {
              type: 'number',
              description: 'Controls randomness in the output (0.0 to 1.0). Lower values are more focused and deterministic. Default is 0.',
              default: 0,
            },
          },
          required: ['image', 'prompt'],
        },
      },
    },
    execute: async ({ image, prompt, provider = 'openai', model, maxTokens = 4096, temperature = 0 }, authToken, context) => {
      console.log(`Tool call: analyze_image with provider: ${provider}, prompt: "${prompt.substring(0, 50)}..."`);

      if (!prompt) {
        return JSON.stringify({ success: false, error: 'Prompt is required to specify what to analyze in the image.' });
      }

      try {
        // Validate provider
        const normalizedProvider = provider.toLowerCase();
        const supportedProviders = ['openai', 'openai-codex', 'gemini', 'grokai'];
        if (!supportedProviders.includes(normalizedProvider)) {
          return JSON.stringify({
            success: false,
            error: `Provider '${provider}' is not supported for image analysis. Supported providers: ${supportedProviders.join(', ')}`,
          });
        }

        // Get userId from context
        let userId = context?.userId;
        if (!userId && authToken) {
          try {
            const decodedToken = jwt.decode(authToken.replace('Bearer ', ''));
            userId = decodedToken?.userId || decodedToken?.id || decodedToken?.sub;
          } catch (e) {
            console.warn('Could not decode auth token to get userId:', e.message);
          }
        }

        // Verify userId is available
        if (!userId) {
          return JSON.stringify({
            success: false,
            error: 'User authentication is required for image analysis.',
          });
        }

        // CRITICAL: Check if images are available in context first (uploaded images)
        let imageData = null;

        if (context?.imageData && context.imageData.length > 0) {
          // Use the first uploaded image from context
          const uploadedImage = context.imageData[0];
          imageData = `data:${uploadedImage.type};base64,${uploadedImage.data}`;
          console.log(`[analyze_image] Using uploaded image from context: ${uploadedImage.filename} (${uploadedImage.type})`);
        } else if (image) {
          // Fallback to image parameter if provided
          if (image.startsWith('data:image/')) {
            imageData = image;
            console.log(`[analyze_image] Using base64 image from parameter`);
          } else {
            // Assume it's a file path - read and convert to base64
            try {
              const fileBuffer = await fs.readFile(image);
              // Determine MIME type from file extension
              const ext = path.extname(image).toLowerCase();
              const mimeTypes = {
                '.jpg': 'image/jpeg',
                '.jpeg': 'image/jpeg',
                '.png': 'image/png',
                '.gif': 'image/gif',
                '.webp': 'image/webp',
                '.bmp': 'image/bmp',
              };
              const mimeType = mimeTypes[ext] || 'image/jpeg';
              imageData = `data:${mimeType};base64,${fileBuffer.toString('base64')}`;
              console.log(`[analyze_image] Read image from file: ${image} (${mimeType})`);
            } catch (fileError) {
              return JSON.stringify({
                success: false,
                error: `Failed to read image file: ${fileError.message}`,
                hint: 'The image should be automatically available from your upload. If you see this error, the image may not have been uploaded correctly.',
              });
            }
          }
        } else {
          return JSON.stringify({
            success: false,
            error: 'No image data available. Images should be automatically detected from your upload.',
            hint: 'Make sure you have uploaded an image in the chat before asking for analysis.',
          });
        }

        // Validate image data format
        if (!imageData.match(/^data:image\/(jpeg|jpg|png|gif|webp|bmp);base64,/)) {
          return JSON.stringify({
            success: false,
            error: 'Invalid image format. Expected data URL format: data:image/[type];base64,[data]',
          });
        }

        // Get default vision models per provider
        const defaultVisionModels = {
          openai: 'gpt-4.1',
          gemini: 'gemini-3-pro-preview',
          grokai: 'grok-4-1-fast-reasoning',
        };

        const selectedModel = model || defaultVisionModels[normalizedProvider];

        // Import and execute the generate-with-ai-llm tool
        const generateWithAiLlm = await import('../../tools/library/actions/generate-with-ai-llm.js');
        const tool = generateWithAiLlm.default;

        // Build parameters for Vision mode
        const params = {
          mode: 'Vision (Image → Text)',
          provider: normalizedProvider,
          model: selectedModel,
          visionPrompt: prompt,
          visionImage: imageData,
          maxTokens: maxTokens,
          temperature: temperature,
        };

        // Create a mock workflow engine context
        const mockWorkflowEngine = {
          userId: userId,
        };

        // Execute the tool
        const result = await tool.execute(params, {}, mockWorkflowEngine);

        // Check for errors
        if (result.error) {
          return JSON.stringify({
            success: false,
            error: result.error,
            provider: normalizedProvider,
            model: selectedModel,
          });
        }

        // Return successful result
        return JSON.stringify({
          success: true,
          provider: normalizedProvider,
          model: selectedModel,
          analysis: result.generatedText,
          tokenCount: result.tokenCount,
          message: `Successfully analyzed image using ${normalizedProvider} ${selectedModel}`,
        });
      } catch (error) {
        console.error('Error in analyze_image tool:', error);
        return JSON.stringify({
          success: false,
          error: `Image analysis failed: ${error.message}`,
          details: error.toString(),
        });
      }
    },
  },
  generate_image: {
    schema: {
      type: 'function',
      function: {
        name: 'generate_image',
        description:
          'Generate images using AI. Supports OpenAI DALL-E, Google Gemini, and Grok image generation. Use this tool when the user asks you to create, generate, or make images.',
        parameters: {
          type: 'object',
          properties: {
            prompt: {
              type: 'string',
              description: 'Detailed description of the image to generate. Be specific and descriptive.',
            },
            provider: {
              type: 'string',
              enum: ['gemini', 'grokai', 'openai', 'openai-codex'],
              description:
                "AI provider to use for image generation. Options: 'gemini' (Google), 'grokai' (Grok), 'openai' or 'openai-codex' (DALL-E). If not specified, defaults to 'openai'.",
            },
            model: {
              type: 'string',
              description:
                "Specific model to use. OpenAI: 'dall-e-3'. Gemini: 'nano-banana-pro-preview'. Grok: 'grok-4-1-fast-reasoning'. If not specified, uses provider's default model.",
            },
            numberOfImages: {
              type: 'number',
              description: 'Number of images to generate (1-10). Default is 1. Only supported by OpenAI and Grok.',
              default: 1,
            },
            size: {
              type: 'string',
              description: "Image size for OpenAI. Options: '256x256', '512x512', '1024x1024', '1792x1024', '1024x1792'. Default is '1024x1024'.",
            },
            aspectRatio: {
              type: 'string',
              description:
                "Aspect ratio for Gemini. Options: '1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'. Default is '1:1'.",
            },
            quality: {
              type: 'string',
              enum: ['standard', 'hd'],
              description: "Image quality for OpenAI DALL-E 3. Options: 'standard', 'hd'. Default is 'standard'.",
            },
            style: {
              type: 'string',
              enum: ['vivid', 'natural'],
              description: "Image style for OpenAI DALL-E 3. Options: 'vivid', 'natural'. Default is 'vivid'.",
            },
          },
          required: ['prompt'],
        },
      },
    },
    execute: async ({ prompt, provider = 'openai', model, numberOfImages = 1, size, aspectRatio, quality, style }, authToken, context) => {
      console.log(`Tool call: generate_image with provider: ${provider}, prompt: "${prompt.substring(0, 50)}..."`);

      if (!prompt) {
        return JSON.stringify({ success: false, error: 'Prompt is required for image generation.' });
      }

      try {
        // Import the ProviderRegistry to check capabilities
        const ProviderRegistry = await import('../../services/ai/ProviderRegistry.js');

        // Validate provider supports image generation
        const normalizedProvider = provider.toLowerCase();
        if (!ProviderRegistry.supportsImageGeneration(normalizedProvider)) {
          const supportedProviders = ProviderRegistry.getImageGenProviders()
            .map((p) => p.provider)
            .join(', ');
          return JSON.stringify({
            success: false,
            error: `Provider '${provider}' does not support image generation. Supported providers: ${supportedProviders}`,
          });
        }

        // Get userId from context
        let userId = context?.userId;
        if (!userId && authToken) {
          try {
            const decodedToken = jwt.decode(authToken.replace('Bearer ', ''));
            userId = decodedToken?.userId || decodedToken?.id || decodedToken?.sub;
          } catch (e) {
            console.warn('Could not decode auth token to get userId:', e.message);
          }
        }

        // Get available models dynamically (with fallback to static)
        const availableModels = await ProviderRegistry.getImageGenModels(normalizedProvider, userId, authToken);

        // Get provider capabilities
        const capabilities = ProviderRegistry.getImageGenCapabilities(normalizedProvider);

        // Use default model if not specified
        const selectedModel = model || capabilities.defaultModel;

        // Validate model against dynamic list
        if (!availableModels.includes(selectedModel)) {
          return JSON.stringify({
            success: false,
            error: `Model '${selectedModel}' is not valid for ${provider}. Available models: ${availableModels.join(', ')}`,
            hint: 'The model list is dynamically fetched from the provider API. If you expected this model to be available, try refreshing your models list.',
          });
        }

        // Import and execute the generate-with-ai-llm tool
        const generateWithAiLlm = await import('../../tools/library/actions/generate-with-ai-llm.js');
        const tool = generateWithAiLlm.default;

        // Verify userId is available for tool execution
        if (!userId) {
          return JSON.stringify({
            success: false,
            error: 'User authentication is required for image generation.',
          });
        }

        // Build parameters for the generate-with-ai-llm tool
        const params = {
          mode: 'Image Generation',
          provider: provider,
          model: selectedModel,
          imagePrompt: prompt,
          imageOperation: 'Generate',
          numberOfImages: numberOfImages,
        };

        // Add provider-specific parameters
        if (normalizedProvider === 'openai') {
          if (size) params.imageSize = size;
          if (quality) params.imageQuality = quality;
          if (style) params.imageStyle = style;
          params.responseFormat = 'b64_json'; // Always use base64 for orchestrator
        } else if (normalizedProvider === 'gemini') {
          if (aspectRatio) params.aspectRatio = aspectRatio;
        } else if (normalizedProvider === 'grokai') {
          params.responseFormat = 'b64_json'; // Always use base64 for orchestrator
        }

        // Create a mock workflow engine context
        const mockWorkflowEngine = {
          userId: userId,
        };

        // Execute the tool
        const result = await tool.execute(params, {}, mockWorkflowEngine);

        // Check for errors
        if (result.error) {
          return JSON.stringify({
            success: false,
            error: result.error,
            provider: provider,
            model: selectedModel,
          });
        }

        // Return successful result
        return JSON.stringify({
          success: true,
          provider: provider,
          model: selectedModel,
          generatedImages: result.generatedImages || [],
          firstImage: result.firstImage || null,
          revisedPrompt: result.revisedPrompt || null,
          imageMetadata: result.imageMetadata || null,
          message: `Successfully generated ${(result.generatedImages || []).length} image(s) using ${provider} ${selectedModel}`,
        });
      } catch (error) {
        console.error('Error in generate_image tool:', error);
        return JSON.stringify({
          success: false,
          error: `Image generation failed: ${error.message}`,
          details: error.toString(),
        });
      }
    },
  },
};

export async function getAvailableToolSchemas() {
  await toolRegistry.ensureInitialized();

  // Import async tools
  const { ASYNC_TOOLS } = await import('./asyncTools.js');

  const nativeToolSchemas = Object.values(TOOLS).map((tool) => tool.schema);
  const asyncToolSchemas = Object.values(ASYNC_TOOLS).map((tool) => tool.schema);
  const registryToolSchemas = toolRegistry.getOpenApiSchemas();
  const pluginToolSchemas = toolRegistry.getPluginOpenApiSchemas();

  // Combine and deduplicate by function name to ensure unique tool names
  const allSchemas = [...nativeToolSchemas, ...asyncToolSchemas, ...registryToolSchemas, ...pluginToolSchemas];
  const uniqueSchemas = [];
  const seenNames = new Set();

  for (const schema of allSchemas) {
    if (schema.function && schema.function.name && !seenNames.has(schema.function.name)) {
      seenNames.add(schema.function.name);
      uniqueSchemas.push(schema);
    }
  }

  console.log(
    `[Orchestrator] Available tools: ${uniqueSchemas.length} (${nativeToolSchemas.length} native, ${registryToolSchemas.length} registry, ${pluginToolSchemas.length} plugins)`
  );

  return uniqueSchemas;
}

/**
 * Reload plugin tools in the orchestrator (called when plugins are installed/uninstalled)
 */
export async function reloadPluginTools() {
  await toolRegistry.ensureInitialized();
  return await toolRegistry.reloadPluginTools();
}

/**
 * Validates tool arguments against the tool's schema
 */
function validateToolArguments(toolName, args, schema) {
  try {
    const requiredParams = schema.function.parameters.required || [];
    const properties = schema.function.parameters.properties || {};

    const missingParams = [];
    const invalidParams = [];

    // Check for missing required parameters
    for (const param of requiredParams) {
      if (args[param] === undefined || args[param] === null) {
        missingParams.push(param);
      }
    }

    // Check parameter types
    for (const [paramName, paramValue] of Object.entries(args)) {
      if (properties[paramName]) {
        const expectedType = properties[paramName].type;
        const actualType = Array.isArray(paramValue) ? 'array' : typeof paramValue;

        if (expectedType && actualType !== expectedType && paramValue !== null && paramValue !== undefined) {
          invalidParams.push({
            param: paramName,
            expected: expectedType,
            actual: actualType,
            value: paramValue,
          });
        }
      }
    }

    if (missingParams.length > 0 || invalidParams.length > 0) {
      const errorDetails = [];

      if (missingParams.length > 0) {
        errorDetails.push(`Missing required parameters: ${missingParams.join(', ')}`);
      }

      if (invalidParams.length > 0) {
        const typeErrors = invalidParams.map((p) => `${p.param} (expected ${p.expected}, got ${p.actual})`).join(', ');
        errorDetails.push(`Invalid parameter types: ${typeErrors}`);
      }

      return {
        valid: false,
        error: `Tool '${toolName}' validation failed: ${errorDetails.join('; ')}`,
      };
    }

    return { valid: true };
  } catch (error) {
    console.warn(`Schema validation error for tool '${toolName}':`, error);
    return { valid: true }; // Allow execution if validation fails
  }
}

export async function executeTool(toolName, args, authToken, context) {
  try {
    // CRITICAL: Resolve data references in arguments before execution
    const resolvedArgs = resolveDataReferences(args, context);

    const nativeTool = TOOLS[toolName];
    if (nativeTool) {
      console.log(`Executing native orchestrator tool: ${toolName}`);

      // Validate arguments against schema
      const validation = validateToolArguments(toolName, resolvedArgs, nativeTool.schema);
      if (!validation.valid) {
        console.error(`Tool validation failed for ${toolName}:`, validation.error);
        return JSON.stringify({
          success: false,
          error: validation.error,
          tool: toolName,
          provided_args: Object.keys(resolvedArgs),
          schema_hint: `Check the tool schema for '${toolName}' to see required parameters and types.`,
        });
      }

      // Execute the tool with error handling
      try {
        const result = await nativeTool.execute(resolvedArgs, authToken, context);
        return result;
      } catch (toolError) {
        console.error(`Tool execution error for ${toolName}:`, toolError);
        return JSON.stringify({
          success: false,
          error: `Tool '${toolName}' execution failed: ${toolError.message}`,
          tool: toolName,
          details: toolError.toString(),
        });
      }
    }

    const registryToolName = toolName.replace(/_/g, '-');
    const registryTool = toolRegistry.getTool(registryToolName);

    if (registryTool) {
      const toolSource = registryTool.isPlugin ? `plugin (${registryTool.pluginName})` : 'registry';
      console.log(`[Orchestrator] Executing ${toolSource} tool: ${registryToolName}`);

      // Validate arguments against registry tool schema
      const validation = validateToolArguments(registryToolName, args, registryTool.openApiSchema);
      if (!validation.valid) {
        console.error(`Registry tool validation failed for ${registryToolName}:`, validation.error);
        return JSON.stringify({
          success: false,
          error: validation.error,
          tool: registryToolName,
          provided_args: Object.keys(args),
          schema_hint: `Check the tool schema for '${registryToolName}' to see required parameters and types.`,
        });
      }

      const params = { ...args };

      // Get userId from context first (passed from agnt-agent.js), fallback to decoding authToken
      let userId = context?.userId || null;

      if (!userId && authToken) {
        try {
          const decodedToken = jwt.decode(authToken.replace('Bearer ', ''));
          userId = decodedToken?.userId || decodedToken?.id || decodedToken?.sub;
        } catch (e) {
          console.warn('Could not decode auth token to get userId.', e.message);
        }
      }

      const mockWorkflowEngine = {
        userId: userId,
        ...context,
        // Add empty maps/objects required by ParameterResolver
        currentTriggerData: {},
        nodeNameToId: new Map(),
        outputs: {},
        // Add DB object for execute-python workflowContext
        DB: {},
      };

      // Attach ParameterResolver to mockWorkflowEngine
      mockWorkflowEngine.parameterResolver = new ParameterResolver(mockWorkflowEngine);

      if (registryTool.authConfig.authRequired) {
        if (!userId) {
          return JSON.stringify({
            success: false,
            error: `Authentication required for tool '${registryToolName}', but user could not be identified from token.`,
          });
        }

        const accessToken = await AuthManager.getValidAccessToken(userId, registryTool.authConfig.authProvider);
        if (!accessToken) {
          return JSON.stringify({
            success: false,
            error: `OAuth token not found or invalid for provider '${registryTool.authConfig.authProvider}'. Please connect the application in your settings.`,
          });
        }
        params.accessToken = accessToken;
      }

      const inputData = {};

      try {
        const result = await registryTool.implementation.execute(params, inputData, mockWorkflowEngine);

        if (typeof result === 'object' && result !== null) {
          return JSON.stringify(result);
        }
        return String(result);
      } catch (toolError) {
        console.error(`Registry tool execution error for ${registryToolName}:`, toolError);
        return JSON.stringify({
          success: false,
          error: `Registry tool '${registryToolName}' execution failed: ${toolError.message}`,
          tool: registryToolName,
          details: toolError.toString(),
        });
      }
    }

    console.error(`Tool '${toolName}' not found in native tools or registry.`);
    return JSON.stringify({
      success: false,
      error: `Tool '${toolName}' not found.`,
      available_tools_hint: 'Use getAvailableToolSchemas() to see all available tools.',
    });
  } catch (error) {
    console.error(`Unexpected error in executeTool for '${toolName}':`, error);
    return JSON.stringify({
      success: false,
      error: `Unexpected error executing tool '${toolName}': ${error.message}`,
      tool: toolName,
      details: error.toString(),
    });
  }
}
