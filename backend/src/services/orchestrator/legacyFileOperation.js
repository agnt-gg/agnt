// The existing file_operations implementation, shared by the desktop and the hosted file worker.
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from '../security/toolProcess.js';
import { augmentEnvPath } from '../../utils/envPath.js';
import { prepareWrite } from '../../utils/lineEndings.js';
export const executeLegacyFileOperation = async ({ operation, path: filePath, content, destination, encoding = 'utf8', args = [], timeoutMs, timeout }, authToken, context) => {
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
              result = { operation, path: filePath, absolutePath: path.resolve(filePath), content: data, size: data.length };
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

              // Create directory structure before writing file
              const fileDir = path.dirname(filePath);
              await fs.mkdir(fileDir, { recursive: true });

              // Only TEXT encodings get line-ending reconciliation. Under
              // base64 (or hex) `content` is an encoded blob whose decoded
              // bytes are arbitrary, and rewriting \n inside it would corrupt
              // the file it decodes to.
              const isTextEncoding = /^(utf-?8|ascii|latin1|binary|utf-?16le|ucs-?2)$/i.test(encoding || 'utf8');
              const toWrite = isTextEncoding
                ? (await prepareWrite(filePath, content)).content
                : content;

              await fs.writeFile(filePath, toWrite, encoding);
              result = { operation, path: filePath, bytesWritten: Buffer.from(toWrite, encoding).length };
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

          // augmentEnvPath restores user tool paths so 'python'/'node'/'sh'
          // resolve even under the minimal GUI-launch PATH on macOS.
          const childEnv = augmentEnvPath({ ...process.env });
          if (authToken) {
            let token = authToken;
            if (token.toLowerCase().startsWith('bearer ')) {
              token = token.substring(7);
            }
            childEnv.AGNT_AUTH_TOKEN = token;
          }

          // Accept `timeout` as an alias for `timeoutMs` (LLM reflex; see
          // execute_shell_command). Normalize: undefined → 60000,
          // 0 / negative / non-numeric → none. See execute_shell_command for
          // the rationale on rolling our own timeout/kill instead of spawn's
          // `timeout` option — same tree-orphan problem applies to any child
          // that re-spawns (cmd.exe, sh, powershell.exe).
          const rawTimeout = timeoutMs !== undefined ? timeoutMs : timeout;
          const parsedTimeout = Number(rawTimeout);
          const effectiveTimeoutMs =
            rawTimeout === undefined
              ? 60000
              : Number.isFinite(parsedTimeout) && parsedTimeout > 0
                ? parsedTimeout
                : 0;

          const childProcess = spawn(commandToRun, finalSpawnArgs, { env: childEnv });
          let stdout = '';
          let stderr = '';
          let timedOut = false;
          let timeoutId = null;

          const killTree = () => {
            const pid = childProcess.pid;
            if (!pid) return;
            if (process.platform === 'win32') {
              try {
                spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
                  windowsHide: true,
                  stdio: 'ignore',
                });
              } catch (_) {
                try { childProcess.kill('SIGKILL'); } catch (__) {}
              }
            } else {
              try { childProcess.kill('SIGTERM'); } catch (_) {}
              const escalate = setTimeout(() => {
                try { childProcess.kill('SIGKILL'); } catch (_) {}
              }, 5000);
              if (typeof escalate.unref === 'function') escalate.unref();
            }
          };

          if (effectiveTimeoutMs > 0) {
            timeoutId = setTimeout(() => {
              timedOut = true;
              killTree();
            }, effectiveTimeoutMs);
          }

          childProcess.stdout.on('data', (data) => {
            stdout += data.toString();
          });

          childProcess.stderr.on('data', (data) => {
            stderr += data.toString();
          });

          childProcess.on('error', (err) => {
            // This handles errors in spawning the process itself (e.g., command not found)
            if (timeoutId) clearTimeout(timeoutId);
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
            if (timeoutId) clearTimeout(timeoutId);
            if (timedOut) {
              const secs = Math.round(effectiveTimeoutMs / 1000);
              doResolve(
                JSON.stringify({
                  success: false,
                  timedOut: true,
                  operation,
                  path: filePath,
                  args: execArgs,
                  stdout: stdout.trim(),
                  stderr: stderr.trim(),
                  error: `File execution timed out after ${secs}s and the process tree was terminated. To allow longer runs pass timeoutMs explicitly, or for indefinite background work use _executeAsync: true together with timeoutMs: 0 (the Stop button remains the kill switch).`,
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
    };
