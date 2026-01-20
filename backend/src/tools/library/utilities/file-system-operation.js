import BaseAction from '../BaseAction.js';
import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);

class FileSystemOperation extends BaseAction {
  static schema = {
    title: 'File System Operation',
    category: 'utility',
    type: 'file-system-operation',
    icon: 'folder',
    description: 'This utility node performs file system operations within a specified root directory.',
    parameters: {
      rootDirectory: {
        type: 'string',
        inputType: 'text',
        description: 'The root directory for file system operations',
      },
      operation: {
        type: 'string',
        inputType: 'select',
        options: ['readFile', 'writeFile', 'appendFile', 'executeFile', 'listFiles'],
        description: 'The type of file system operation to perform',
      },
      path: {
        type: 'string',
        inputType: 'text',
        description: 'The relative path for the file or directory',
      },
      content: {
        type: 'string',
        inputType: 'textarea',
        description: 'The content to write or append to the file (for writeFile and appendFile operations)',
        conditional: {
          field: 'operation',
          value: ['writeFile', 'appendFile'],
        },
      },
    },
    outputs: {
      success: {
        type: 'boolean',
        description: 'Indicates whether the file system operation was successful',
      },
      result: {
        type: 'any',
        description:
          'The result of the operation (file content for readFile, execution output for executeFile, list of files for listFiles, or operation status for writeFile and appendFile)',
      },
      error: {
        type: 'string',
        description: 'Error message if the file system operation failed',
      },
    },
  };

  constructor() {
    super('file-system-operation');
  }

  async execute(params, inputData, workflowEngine) {
    console.log('File System Operation params:', JSON.stringify(params, null, 2));

    try {
      this.validateParams(params);
    } catch (error) {
      console.error('Parameter validation failed:', error.message);
      return this.formatOutput({
        success: false,
        result: null,
        error: error.message,
      });
    }

    const { rootDirectory, operation, path: filePath, content } = params;
    const fullPath = path.join(rootDirectory, filePath);

    console.log(`Performing ${operation} operation on ${fullPath}`);

    try {
      let result;
      switch (operation) {
        case 'readFile':
          console.log(`Attempting to read file: ${fullPath}`);
          if (await this.fileExists(fullPath)) {
            const stats = await fs.stat(fullPath);
            if (stats.isDirectory()) {
              console.log(`${fullPath} is a directory. Listing contents instead of reading.`);
              result = await fs.readdir(fullPath);
            } else {
              // Read the file as a Buffer
              result = await fs.readFile(fullPath);
              console.log(`File read successfully. Size: ${result.length} bytes`);

              // Define text-based file extensions
              const textExtensions = ['.md', '.txt', '.csv', '.json', '.xml', '.yml', '.yaml'];
              const fileExtension = path.extname(fullPath).toLowerCase();

              if (textExtensions.includes(fileExtension)) {
                // Convert Buffer to UTF-8 string for text-based files
                result = result.toString('utf-8');
                console.log('Text-based file converted to UTF-8 string');

                // Special handling for JSON files
                if (fileExtension === '.json') {
                  try {
                    const parsedJson = JSON.parse(result);
                    result = JSON.stringify(parsedJson, null, 2); // Pretty-print JSON
                    console.log('JSON file parsed and stringified successfully');
                  } catch (parseError) {
                    console.warn('Failed to parse JSON file:', parseError.message);
                    // Keep the original string if parsing fails
                  }
                }
              } else {
                // Convert Buffer to base64 string for non-text files
                result = result.toString('base64');
                console.log('Binary file converted to base64 string');
              }
            }
          } else {
            throw new Error(`File does not exist: ${fullPath}`);
          }
          break;
        case 'writeFile':
          console.log(`Attempting to write file: ${fullPath}`);
          await this.ensureDirectoryExists(path.dirname(fullPath));
          await fs.writeFile(fullPath, content, 'utf8');
          result = 'File written successfully';
          console.log(`File written successfully: ${fullPath}`);
          break;
        case 'appendFile':
          console.log(`Attempting to append to file: ${fullPath}`);
          await this.ensureDirectoryExists(path.dirname(fullPath));
          await fs.appendFile(fullPath, content, 'utf8');
          result = 'Content appended to file successfully';
          console.log(`Content appended successfully to: ${fullPath}`);
          break;
        case 'listFiles':
          console.log(`Attempting to list files in directory: ${fullPath}`);
          result = await fs.readdir(fullPath);
          console.log(`Directory contents:`, result);
          break;
        case 'executeFile':
          console.log(`Attempting to execute file: ${fullPath}`);
          result = await this.executeFile(fullPath);
          console.log(`File executed successfully: ${fullPath}`);
          break;
        default:
          throw new Error(`Unsupported operation: ${operation}`);
      }

      console.log('Operation result:', result);

      return this.formatOutput({
        success: true,
        result,
        error: null,
      });
    } catch (error) {
      console.error('Error in file system operation:', error);
      console.error('Error stack:', error.stack);
      return this.formatOutput({
        success: false,
        result: null,
        error: `${error.message}\nStack: ${error.stack}`,
      });
    }
  }

  async ensureDirectoryExists(directoryPath) {
    console.log(`Ensuring directory exists: ${directoryPath}`);
    try {
      await fs.mkdir(directoryPath, { recursive: true });
      console.log(`Directory created or already exists: ${directoryPath}`);
    } catch (error) {
      if (error.code !== 'EEXIST') {
        console.error(`Error creating directory: ${directoryPath}`, error);
        throw error;
      } else {
        console.log(`Directory already exists: ${directoryPath}`);
      }
    }
  }

  async fileExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async executeFile(filePath) {
    console.log(`Executing file: ${filePath}`);
    try {
      let command;
      if (filePath.endsWith('.py')) {
        // Use python interpreter for .py files
        command = `python "${filePath}"`;
      } else if (filePath.endsWith('.ps1')) {
        // Use powershell for .ps1 files
        command = `powershell.exe -ExecutionPolicy Bypass -File "${filePath}"`;
      } else if (filePath.endsWith('.sh')) {
        // Use bash for .sh files
        command = `bash "${filePath}"`;
      } else if (filePath.endsWith('.js')) {
        // Use node for .js files
        command = `node "${filePath}"`;
      } else {
        throw new Error(`Unsupported file type for execution: ${path.extname(filePath)}`);
      }
      const { stdout, stderr } = await execPromise(command);
      if (stderr) {
        console.error(`Error executing file: ${stderr}`);
      }
      return stdout.trim();
    } catch (error) {
      console.error(`Error executing file: ${filePath}`, error);
      throw error;
    }
  }

  validateParams(params) {
    console.log('Validating parameters:', JSON.stringify(params, null, 2));
    if (!params.rootDirectory) {
      throw new Error('Root directory is required for file system operation');
    }
    if (!params.operation) {
      throw new Error('Operation is required for file system operation');
    }
    if (!params.path) {
      throw new Error('File path (params.path) is required for file system operation');
    }
    if (params.operation === 'writeFile' && !params.content) {
      throw new Error('Content is required for writeFile operation');
    }
    console.log('Parameter validation successful');
  }

  formatOutput(output) {
    console.log('Formatting output:', JSON.stringify(output, null, 2));
    return {
      ...output,
      outputs: {
        success: output.success,
        result: output.result,
        error: output.error,
      },
    };
  }
}

export default new FileSystemOperation();
