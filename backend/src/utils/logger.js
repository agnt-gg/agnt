import { getRecorder } from '../diagnostics/install.js';

/**
 * Logs a message.
 *
 * Signature unchanged so all existing call sites keep working. The old
 * implementation composed a NEW FILENAME on every call, which produced 43,581
 * single-line files across 239 days with no rotation and no retention. It now
 * delegates to the diagnostics recorder: one rotating JSONL file per day,
 * redacted, deduped, size- and age-capped, and included in the crash ring.
 *
 * @param {string} message - The message to log.
 * @param {Array} [messages] - The messages array to log.
 * @param {Array} [tools] - The tools array to log.
 * @param {string} [level='INFO'] - The log level (e.g., 'INFO', 'ERROR', 'DEBUG').
 */
function log(message, messages, tools, level = 'INFO') {
  const recorder = getRecorder();
  if (!recorder) {
    // Diagnostics not installed (a bare script importing this module directly).
    // The console bridge is absent too, so this is the only sink available.
    console.log(`[${level.toUpperCase()}]: ${message}`);
    return;
  }

  const data = {};
  if (messages && Array.isArray(messages)) data.messages = messages;
  if (tools && Array.isArray(tools)) data.tools = tools;

  recorder.write(level, undefined, message, {
    data: Object.keys(data).length ? data : undefined,
  });
}

export default log;
