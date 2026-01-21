import BaseAction from '../BaseAction.js';
import { spawn } from 'child_process';
import path from 'path';

class ExecutePython extends BaseAction {
  static schema = {
    title: 'Execute Python',
    category: 'utility',
    type: 'execute-python',
    icon: 'python',
    description: 'This utility node allows you to execute custom Python code within the workflow, enabling advanced logic and data transformations.',
    parameters: {
      code: {
        type: 'string',
        inputType: 'codearea',
        description: 'The Python code to execute',
      },
    },
    outputs: {
      result: {
        type: 'any',
        description: 'The result of the Python code execution',
      },
      error: {
        type: 'string',
        description: 'Error message if the code execution failed',
      },
    },
  };

  constructor() {
    super('executePython');
    this.maxExecutionTime = 60000; // 60 seconds
  }

  async execute(params, inputData, workflowEngine) {
    this.validateParams(params);
    const resolvedParams = workflowEngine.parameterResolver.resolveParameters(params);
    console.log('Executing Python code:', resolvedParams.code);

    try {
      const result = await this.runPythonCode(resolvedParams.code, inputData, workflowEngine);
      return this.formatOutput({
        success: true,
        result: result.result,
        output: result.output,
        error: result.error,
      });
    } catch (error) {
      console.error('Error executing Python code:', error);
      return this.formatOutput({
        success: false,
        result: null,
        output: null,
        error: error.message,
      });
    }
  }

  async runPythonCode(userCode, inputData, workflowEngine) {
    return new Promise((resolve, reject) => {
      const wrappedCode = `
import json
import sys
from io import StringIO
import traceback
from datetime import datetime
import math
import random
import re
import string
import decimal
import fractions
import statistics
import uuid
import collections
import itertools
import functools
import operator

# Pre-import data science packages BEFORE security restrictions
import tempfile
import os
import uuid
import shutil
import atexit

# Create isolated temp directory for this execution only
execution_id = uuid.uuid4().hex[:8]
execution_temp_dir = tempfile.mkdtemp(prefix=f"python_exec_{execution_id}_")

# Register cleanup function
def cleanup_temp_dir():
    try:
        shutil.rmtree(execution_temp_dir, ignore_errors=True)
    except:
        pass

atexit.register(cleanup_temp_dir)

try:
    import requests
except ImportError:
    requests = None

try:
    import numpy as np
except ImportError:
    np = None

try:
    import pandas as pd
except ImportError:
    pd = None

try:
    import matplotlib
    matplotlib.use('Agg')  # Non-GUI backend
    import matplotlib.pyplot as plt
    from io import BytesIO
    import base64
except ImportError:
    matplotlib = None
    plt = None
    BytesIO = None
    base64 = None

# Block potentially dangerous modules
import builtins
BLOCKED_MODULES = {'os', 'subprocess', 'sys', 'pty', 'socket', 'shutil', 'pickle'}
original_import = builtins.__import__

def secure_import(name, *args, **kwargs):
    if name in BLOCKED_MODULES:
        raise ImportError(f"Module '{name}' is blocked for security reasons")
    return original_import(name, *args, **kwargs)

builtins.__import__ = secure_import

# Provide sandboxed file operations for matplotlib
def restricted_open(filename, mode='r', *args, **kwargs):
    if isinstance(filename, str):
        # Only allow access to our isolated temp directory
        if filename.startswith(execution_temp_dir):
            return original_open(filename, mode, *args, **kwargs)
        # Allow standard streams
        if filename in ['<stdin>', '<stdout>', '<stderr>']:
            return original_open(filename, mode, *args, **kwargs)
    # Allow file-like objects (BytesIO, StringIO)
    if hasattr(filename, 'read') or hasattr(filename, 'write'):
        return filename
    
    raise PermissionError(f"File access denied: {filename}")

# Store original open before replacing
original_open = builtins.open
builtins.open = restricted_open

# Remove os module access from user code after internal setup
del os
del tempfile
del shutil

def run_user_code(workflow_input, workflow_context):
    output = StringIO()
    sys.stdout = output
    sys.stderr = output
    result = None
    error = None
    
    try:
        def user_function():
${userCode
  .split('\n')
  .map((line) => '            ' + line)
  .join('\n')}
        
        result = user_function()
        
        # Smart detection: if no return value but there's print output, use print output as result
        if result is None:
            output_text = output.getvalue().strip()
            if output_text:
                result = output_text
                
    except Exception as e:
        error = str(e)
        traceback.print_exc(file=output)
    finally:
        sys.stdout = sys.__stdout__
        sys.stderr = sys.__stderr__
    
    return {
        'result': result,
        'output': output.getvalue(),
        'error': error
    }

# Main execution
try:
    input_data = json.loads(sys.stdin.read())
    result = run_user_code(input_data['inputData'], input_data['workflowContext'])
    print(json.dumps(result))
except Exception as e:
    print(json.dumps({
        'result': None,
        'output': '',
        'error': f"Fatal error: {str(e)}"
    }))
`;

      const spawnOptions = {
        stdio: ['pipe', 'pipe', 'pipe'],
      };

      // Note: Don't override uid/gid - let subprocess inherit from parent process
      // Setting explicit uid/gid can cause EPERM errors in containers where
      // the process is running as a different user (e.g., node:1000 vs hardcoded 1001)

      const pythonCommand = process.platform === 'win32' ? 'python' : 'python3';
      const pythonProcess = spawn(pythonCommand, ['-c', wrappedCode], spawnOptions);

      let stdout = '';
      let stderr = '';

      const timeout = setTimeout(() => {
        pythonProcess.kill();
        reject(new Error('Python script execution timed out'));
      }, this.maxExecutionTime);

      pythonProcess.stdout.on('data', (data) => {
        if (stdout.length > 1024 * 1024) {
          pythonProcess.kill();
          reject(new Error('Output size limit exceeded'));
          return;
        }
        stdout += data.toString();
      });

      pythonProcess.stderr.on('data', (data) => {
        if (stderr.length > 1024 * 1024) {
          pythonProcess.kill();
          reject(new Error('Error output size limit exceeded'));
          return;
        }
        stderr += data.toString();
      });

      pythonProcess.on('close', (code) => {
        clearTimeout(timeout);
        if (code !== 0) {
          console.error(`Python script exited with code ${code}`);
          console.error(`STDERR: ${stderr}`);
          reject(new Error(`Python script exited with code ${code}\n${stderr}`));
        } else {
          try {
            const parsedOutput = JSON.parse(stdout);
            resolve(parsedOutput);
          } catch (error) {
            console.error(`Failed to parse Python script output: ${error.message}`);
            console.error(`Raw output: ${stdout}`);
            reject(new Error(`Failed to parse Python script output: ${error.message}`));
          }
        }
      });

      const inputJson = JSON.stringify({
        inputData,
        workflowContext: workflowEngine.DB,
      });
      pythonProcess.stdin.write(inputJson);
      pythonProcess.stdin.end();
    });
  }

  validateParams(params) {
    if (!params.code) {
      throw new Error('Code is required for Python execution');
    }

    const code = params.code.toLowerCase();
    const blacklist = [
      'import os',
      'import sys',
      'import subprocess',
      'import pty',
      '__import__',
      'eval(',
      'exec(',
      'open(',
      'file(',
      'globals(',
      'locals(',
    ];

    if (blacklist.some((term) => code.includes(term))) {
      throw new Error('Code contains forbidden operations');
    }
  }

  formatOutput(output) {
    return {
      ...output,
      outputs: output.result,
    };
  }
}

export default new ExecutePython();
