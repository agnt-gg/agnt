import fs from 'fs';
import path from 'path';
import os from 'os';
import PathManager from './PathManager.js';

let LOG_DIR = PathManager.getPath('_logs');

// Ensure the log directory exists, with fallback to temp directory
try {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
  // Test write access
  const testFile = path.join(LOG_DIR, '.write-test');
  fs.writeFileSync(testFile, '');
  fs.unlinkSync(testFile);
} catch (error) {
  // Fallback to temp directory if we can't write to the data directory
  console.warn(`Cannot write to ${LOG_DIR}, falling back to temp directory:`, error.message);
  LOG_DIR = path.join(os.tmpdir(), 'agnt-logs');
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

/**
 * Logs a message to a file.
 * @param {string} message - The message to log.
 * @param {Array} [messages] - The messages array to log.
 * @param {Array} [tools] - The tools array to log.
 * @param {string} [level='INFO'] - The log level (e.g., 'INFO', 'ERROR', 'DEBUG').
 */
function log(message, messages, tools, level = 'INFO') {
  const timestamp = new Date().toISOString();

  // Create the main log entry with the message
  let logEntry = `[${timestamp}] [${level.toUpperCase()}]: ${message}\n`;

  // Add messages to log entry if provided
  if (messages && Array.isArray(messages)) {
    logEntry += `MESSAGES: ${JSON.stringify(messages, null, 2)}\n`;
  }

  // Add tools to log entry if provided
  if (tools && Array.isArray(tools)) {
    logEntry += `TOOLS: ${JSON.stringify(tools, null, 2)}\n`;
  }

  // Add a separator line
  logEntry += '---\n';

  const timestampStr = new Date().toISOString().replace(/[:.]/g, '-'); // YYYY-MM-DDTHH-MM-SS-sss
  const logFileName = `${timestampStr}.log`;
  const logFilePath = path.join(LOG_DIR, logFileName);

  fs.appendFile(logFilePath, logEntry, (err) => {
    if (err) {
      console.error('Failed to write to log file:', err);
    }
  });
}

export default log;
