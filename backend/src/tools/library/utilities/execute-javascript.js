import BaseAction from '../BaseAction.js';
import { fork } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class ExecuteJavaScript extends BaseAction {
  static schema = {
    title: 'Execute Javascript',
    category: 'utility',
    type: 'execute-javascript',
    icon: 'javascript',
    description:
      'This utility node allows you to execute custom JavaScript code within the workflow, enabling advanced logic and data transformations.',
    parameters: {
      code: {
        type: 'string',
        inputType: 'codearea',
        description: 'The JavaScript code to execute',
      },
    },
    outputs: {
      result: {
        type: 'any',
        description: 'The result of the JavaScript code execution',
      },
      error: {
        type: 'string',
        description: 'Error message if the code execution failed',
      },
    },
  };

  constructor() {
    super('executeJavaScript');
  }

  async execute(params, inputData, workflowEngine) {
    this.validateParams(params);

    console.log('Executing JavaScript code:', params.code);

    return new Promise((resolve) => {
      const child = fork(path.join(__dirname, 'execute-javascript-child.js'));

      let hasResolved = false;

      const resolveOnce = (output) => {
        if (!hasResolved) {
          hasResolved = true;
          resolve(this.formatOutput(output));
        }
      };

      child.on('message', (message) => {
        console.log('Received message from child process:', message);
        resolveOnce(message);
      });

      child.on('error', (error) => {
        console.error('Error in child process:', error);
        resolveOnce({
          success: false,
          result: null,
          error: error.message,
        });
      });

      child.on('exit', (code, signal) => {
        if (!hasResolved) {
          console.error(`Child process exited with code ${code} and signal ${signal}`);
          resolveOnce({
            success: false,
            result: null,
            error: `Child process exited unexpectedly (code: ${code}, signal: ${signal})`,
          });
        }
      });

      // Send message to child process with error handling
      try {
        child.send({
          code: params.code,
          inputData,
          workflowContext: {
            workflowId: workflowEngine.workflowId,
            userId: workflowEngine.userId,
            outputs: workflowEngine.outputs,
            errors: workflowEngine.errors,
            DB: workflowEngine.DB,
            isSubWorkflow: workflowEngine.isSubWorkflow,
            parentInputData: workflowEngine.parentInputData,
          },
        });
      } catch (sendError) {
        console.error('Failed to send message to child process:', sendError.message);
        resolveOnce({
          success: false,
          result: null,
          error: `IPC communication failed: ${sendError.message}`,
        });
        // Kill the child process since we can't communicate with it
        try {
          child.kill();
        } catch (killError) {
          // Ignore kill errors
        }
      }

      // Set a timeout to kill the child process if it takes too long
      setTimeout(() => {
        if (!hasResolved) {
          child.kill();
          resolveOnce({
            success: false,
            result: null,
            error: 'Execution timed out',
          });
        }
      }, 60000); // 60 seconds timeout
    });
  }

  validateParams(params) {
    if (!params.code) {
      throw new Error('JavaScript code is required');
    }
  }

  formatOutput(output) {
    return {
      success: output.success,
      result: output.result,
      error: output.error,
      outputs: output.result,
    };
  }
}

export default new ExecuteJavaScript();
