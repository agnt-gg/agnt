/**
 * voiceConnectLog — the one place a voice connect leaves a trace on disk.
 *
 * WHY THIS EXISTS
 * ---------------
 * The client already measures every realtime connect stage by stage and posts
 * the line to /api/speech/realtime/timing, and the server knows which provider
 * route opened the session and how long it took. Both went to console only.
 * Under Electron the backend's stdout is buffered in main-process memory and
 * never written anywhere, so "voice sat on Connecting… for ages" could only be
 * investigated by reproducing it — the slow connects themselves were gone.
 *
 * So these lines ALSO append to <AGNT root>/logs/voice-connect.log.
 *
 * DESIGN
 * ------
 * - Bounded: past `maxBytes` the file rolls to `.1` (one generation kept), so
 *   a machine that connects voice all day can never grow it without limit.
 * - Serialized: appends and rollovers run on one promise chain, so two connects
 *   finishing together cannot interleave or race a rename.
 * - Never throws: this is diagnostics. A full disk or a locked file costs a
 *   single warning, never a voice session.
 * - Callers pass already-sanitized text — short names and numbers. Nothing here
 *   ever sees a token.
 */
import fs from 'fs';
import path from 'path';

export const VOICE_CONNECT_LOG_MAX_BYTES = 512 * 1024;

/**
 * @param {{ file: string, maxBytes?: number, now?: () => Date }} options
 * @returns {{ append: (text: string) => Promise<void>, file: string }}
 */
export function createVoiceConnectLog({ file, maxBytes = VOICE_CONNECT_LOG_MAX_BYTES, now = () => new Date() }) {
  let queue = Promise.resolve();
  let warned = false;

  async function rollIfFull() {
    let size;
    try {
      ({ size } = await fs.promises.stat(file));
    } catch (err) {
      if (err.code === 'ENOENT') return;
      throw err;
    }
    if (size < maxBytes) return;
    // rename() replaces an existing `.1` on every platform Node supports.
    await fs.promises.rename(file, `${file}.1`);
  }

  async function write(text) {
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await rollIfFull();
    // One physical line per entry, whatever the caller handed in.
    const line = String(text).replace(/[\r\n]+/g, ' ');
    await fs.promises.appendFile(file, `${now().toISOString()} ${line}\n`, 'utf8');
  }

  function append(text) {
    queue = queue.then(
      () => write(text),
      () => write(text),
    ).catch((err) => {
      // Warn once per process: a persistently unwritable log must not turn
      // every connect into console noise.
      if (!warned) {
        warned = true;
        console.warn(`[speech] could not write ${file}: ${err.message}`);
      }
    });
    return queue;
  }

  return { append, file };
}

let defaultLog = null;

/**
 * Append one line to the install's voice connect log. Resolved lazily so that
 * importing a module that logs does not resolve AGNT's data folders.
 */
export async function appendVoiceConnectLine(text) {
  if (!defaultLog) {
    const { default: pathManager } = await import('../utils/PathManager.js');
    defaultLog = createVoiceConnectLog({ file: pathManager.getPath('logs', 'voice-connect.log') });
  }
  return defaultLog.append(text);
}

export default { createVoiceConnectLog, appendVoiceConnectLine, VOICE_CONNECT_LOG_MAX_BYTES };
