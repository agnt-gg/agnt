import fs from 'fs';
import path from 'path';
import PathManager from './PathManager.js';

const LOG_DIR = PathManager.getPath('_logs');

// Ensure the log directory exists
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
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
