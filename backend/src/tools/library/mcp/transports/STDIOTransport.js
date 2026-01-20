import { spawn } from 'child_process';
import { createInterface } from 'readline';

/**
 * STDIO Transport for MCP
 * Handles communication via stdin/stdout with a spawned process
 */
class STDIOTransport {
  constructor(options = {}) {
    this.command = options.command;
    this.args = options.args || [];
    this.cwd = options.cwd;
    this.env = options.env || {};
    this.process = null;
    this.readline = null;
    this.messageHandlers = new Map();
    this.notificationHandlers = [];
    this.connected = false;
    this.messageId = 0;
  }

  async connect() {
    if (this.connected) return;

    console.log(`[STDIOTransport] Spawning process: ${this.command} ${this.args.join(' ')}`);

    return new Promise((resolve, reject) => {
      try {
        // On Windows, we need to use shell mode for npm/npx commands
        const isWindows = process.platform === 'win32';
        const isNpmCommand = this.command === 'npm' || this.command === 'npx';

        const spawnOptions = {
          cwd: this.cwd,
          env: { ...process.env, ...this.env },
          stdio: ['pipe', 'pipe', 'pipe'],
        };

        // On Windows, use shell mode for npm/npx to properly resolve the command
        if (isWindows && isNpmCommand) {
          spawnOptions.shell = true;
        }

        this.process = spawn(this.command, this.args, spawnOptions);

        // Track if process spawned successfully
        let processSpawned = false;
        let spawnError = null;

        // Handle spawn errors immediately
        this.process.on('error', (err) => {
          console.error('[STDIOTransport] Process spawn error:', err);
          spawnError = err;
          this.connected = false;
          if (!processSpawned) {
            reject(new Error(`Failed to spawn process: ${err.message}`));
          }
        });

        // Handle process exit
        this.process.on('exit', (code, signal) => {
          console.log(`[STDIOTransport] Process exited with code ${code}, signal ${signal}`);
          this.connected = false;
          if (!processSpawned && code !== 0) {
            reject(new Error(`Process exited immediately with code ${code}`));
          }
        });

        // Set up readline for line-delimited JSON
        this.readline = createInterface({
          input: this.process.stdout,
          crlfDelay: Infinity,
        });

        this.readline.on('line', (line) => {
          // Skip empty lines
          if (!line || line.trim() === '') {
            return;
          }

          // Only try to parse lines that look like JSON (start with { or [)
          const trimmedLine = line.trim();
          if (!trimmedLine.startsWith('{') && !trimmedLine.startsWith('[')) {
            // This is likely debug output, log it but don't try to parse
            console.log('[STDIOTransport] Non-JSON output:', trimmedLine);
            return;
          }

          try {
            const data = JSON.parse(line);
            // Only handle if it looks like a JSON-RPC message
            if (data && typeof data === 'object' && (data.jsonrpc || data.id || data.method)) {
              this._handleMessage(data);
            } else {
              console.log('[STDIOTransport] Ignoring non-JSON-RPC message:', line);
            }
          } catch (err) {
            // Only log parsing errors for lines that looked like they should be JSON
            console.warn('[STDIOTransport] Failed to parse JSON line:', line.substring(0, 100));
          }
        });

        // Handle stderr
        this.process.stderr.on('data', (data) => {
          console.error('[STDIOTransport] stderr:', data.toString());
        });

        // Wait a bit to ensure process spawned successfully
        setTimeout(() => {
          if (spawnError) {
            reject(spawnError);
          } else if (!this.process || this.process.killed) {
            reject(new Error('Process was killed or failed to start'));
          } else {
            processSpawned = true;
            this.connected = true;
            console.log('[STDIOTransport] Process spawned successfully');
            resolve();
          }
        }, 100);
      } catch (err) {
        console.error('[STDIOTransport] Error in connect:', err);
        reject(err);
      }
    });
  }

  _handleMessage(data) {
    // Handle response to a request
    if (data.id && this.messageHandlers.has(data.id)) {
      const handler = this.messageHandlers.get(data.id);
      handler.resolve(data);
      this.messageHandlers.delete(data.id);
      return;
    }

    // Handle notification (no id, or method present)
    if (data.method) {
      for (const handler of this.notificationHandlers) {
        handler(data);
      }
    }
  }

  async send(message) {
    if (!this.connected || !this.process || !this.process.stdin) {
      throw new Error('Transport not connected');
    }

    const requestId = message.id || `req-${++this.messageId}`;
    message.id = requestId;

    const responsePromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.messageHandlers.delete(requestId);
        reject(new Error(`Timeout waiting for response to ${message.method}`));
      }, 30000);

      this.messageHandlers.set(requestId, {
        resolve: (data) => {
          clearTimeout(timeout);
          resolve(data);
        },
      });
    });

    // Send newline-delimited JSON
    this.process.stdin.write(JSON.stringify(message) + '\n');

    return responsePromise;
  }

  onNotification(handler) {
    this.notificationHandlers.push(handler);
  }

  async close() {
    if (this.readline) {
      this.readline.close();
      this.readline = null;
    }

    if (this.process) {
      this.process.kill();
      this.process = null;
    }

    this.connected = false;
    this.messageHandlers.clear();
    this.notificationHandlers = [];
  }
}

export default STDIOTransport;
