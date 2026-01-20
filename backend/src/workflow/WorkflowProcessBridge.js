import { fork } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class WorkflowProcessBridge {
  constructor() {
    this.workflowProcess = null;
    this.messageHandlers = new Map();
    this.messageId = 0;
    this.isReady = false;
    this.statusUpdateListeners = [];
    this.readyPromise = null;
  }

  spawn() {
    // Create a promise that resolves when the process is ready
    this.readyPromise = new Promise((resolve, reject) => {
      const workflowProcessPath = path.join(__dirname, './', 'WorkflowProcess.js');

      console.log('Spawning workflow process at:', workflowProcessPath);

      this.workflowProcess = fork(workflowProcessPath, [], {
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
        env: { ...process.env, IS_WORKFLOW_PROCESS: 'true' },
      });

      // Handle messages from workflow process
      this.workflowProcess.on('message', (message) => {
        this.handleMessage(message);
      });

      // Handle process errors
      this.workflowProcess.on('error', (error) => {
        console.error('Workflow process error:', error);
        this.isReady = false;
      });

      // Handle process exit
      this.workflowProcess.on('exit', (code, signal) => {
        console.log(`Workflow process exited with code ${code} and signal ${signal}`);
        this.isReady = false;

        // Auto-restart on unexpected exit
        if (code !== 0 && code !== null) {
          console.log('Workflow process crashed. Restarting in 5 seconds...');
          setTimeout(() => {
            this.restart().catch((err) => {
              console.error('Failed to restart workflow process:', err);
            });
          }, 5000);
        }
      });

      // Handle stdout/stderr
      this.workflowProcess.stdout.on('data', (data) => {
        console.log(`[Workflow Process]: ${data.toString().trim()}`);
      });

      this.workflowProcess.stderr.on('data', (data) => {
        console.error(`[Workflow Process Error]: ${data.toString().trim()}`);
      });

      // Wait for ready message
      const readyTimeout = setTimeout(() => {
        reject(new Error('Workflow process failed to start within 30 seconds'));
      }, 30000);

      const readyHandler = (message) => {
        if (message.type === 'READY') {
          clearTimeout(readyTimeout);
          this.isReady = true;
          console.log('Workflow process is ready');
          resolve();
        }
      };

      this.workflowProcess.once('message', readyHandler);
    });

    return this.readyPromise;
  }

  handleMessage(message) {
    // Handle status updates (broadcast to all listeners)
    if (message.type === 'STATUS_UPDATE') {
      this.statusUpdateListeners.forEach((listener) => {
        listener(message.data.workflowId, message.data.status);
      });
      return;
    }

    // Handle response messages
    if (message.id !== undefined) {
      const handler = this.messageHandlers.get(message.id);
      if (handler) {
        this.messageHandlers.delete(message.id);

        if (message.success) {
          handler.resolve(message.data);
        } else {
          handler.reject(new Error(message.error || 'Unknown error'));
        }
      }
    }
  }

  async sendMessage(type, data, timeout = 30000) {
    // Wait for process to be ready before sending any messages
    if (!this.isReady && this.readyPromise) {
      try {
        await this.readyPromise;
      } catch (error) {
        return Promise.reject(new Error('Workflow process failed to initialize'));
      }
    }

    return new Promise((resolve, reject) => {
      if (!this.workflowProcess) {
        return reject(new Error('Workflow process is not available'));
      }

      if (!this.isReady) {
        return reject(new Error('Workflow process is not ready'));
      }

      const id = ++this.messageId;
      const message = {
        id,
        type,
        data,
        timestamp: Date.now(),
      };

      // Set up timeout
      const timeoutId = setTimeout(() => {
        this.messageHandlers.delete(id);
        reject(new Error(`Message ${type} timed out after ${timeout}ms`));
      }, timeout);

      // Store handler
      this.messageHandlers.set(id, {
        resolve: (data) => {
          clearTimeout(timeoutId);
          resolve(data);
        },
        reject: (error) => {
          clearTimeout(timeoutId);
          reject(error);
        },
      });

      // Send message
      this.workflowProcess.send(message);
    });
  }

  async activateWorkflow(workflow, userId, triggerData = null) {
    try {
      const result = await this.sendMessage('ACTIVATE_WORKFLOW', {
        workflow,
        userId,
        triggerData,
      });
      return result;
    } catch (error) {
      console.error('Error activating workflow via IPC:', error);
      return { error: error.message };
    }
  }

  async deactivateWorkflow(workflowId, userId) {
    try {
      const result = await this.sendMessage('DEACTIVATE_WORKFLOW', {
        workflowId,
        userId,
      });
      return result;
    } catch (error) {
      console.error('Error deactivating workflow via IPC:', error);
      return { error: error.message };
    }
  }

  async fetchWorkflowState(workflowId, userId) {
    try {
      const result = await this.sendMessage('FETCH_WORKFLOW_STATE', {
        workflowId,
        userId,
      });
      return result;
    } catch (error) {
      console.error('Error fetching workflow state via IPC:', error);
      return { status: 'error', error: error.message };
    }
  }

  async restartActiveWorkflows() {
    try {
      const result = await this.sendMessage('RESTART_ACTIVE_WORKFLOWS', {}, 60000);
      return result;
    } catch (error) {
      console.error('Error restarting active workflows via IPC:', error);
      throw error;
    }
  }

  /**
   * Reload plugins in the workflow process
   * Called after plugin install/uninstall to update the running process
   */
  async reloadPlugins() {
    try {
      console.log('[WorkflowProcessBridge] Requesting plugin reload...');
      const result = await this.sendMessage('RELOAD_PLUGINS', {}, 30000);
      console.log('[WorkflowProcessBridge] Plugin reload result:', result);
      return result;
    } catch (error) {
      console.error('Error reloading plugins via IPC:', error);
      return { success: false, error: error.message };
    }
  }

  onStatusUpdate(listener) {
    this.statusUpdateListeners.push(listener);
  }

  async shutdown() {
    if (!this.workflowProcess) {
      return;
    }

    console.log('Shutting down workflow process...');

    try {
      await this.sendMessage('SHUTDOWN', {}, 10000);
    } catch (error) {
      console.error('Error during graceful shutdown:', error);
    }

    // Force kill if still running after 5 seconds
    setTimeout(() => {
      if (this.workflowProcess && !this.workflowProcess.killed) {
        console.log('Force killing workflow process...');
        this.workflowProcess.kill('SIGKILL');
      }
    }, 5000);
  }

  async restart() {
    console.log('Restarting workflow process...');

    if (this.workflowProcess) {
      await this.shutdown();
    }

    // Clear state
    this.messageHandlers.clear();
    this.isReady = false;
    this.workflowProcess = null;
    this.readyPromise = null;

    // Spawn new process
    await this.spawn();

    // Restart active workflows
    await this.restartActiveWorkflows();

    console.log('Workflow process restarted successfully');
  }
}

// Export singleton instance
export default new WorkflowProcessBridge();
