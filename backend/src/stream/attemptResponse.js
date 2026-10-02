/**
 * attemptResponse.js — let a streaming attempt fail without the client seeing it.
 *
 * StreamEngine's stream functions own their error handling: on failure they
 * write an SSE error event (or a 500) and end the response. That is right for
 * the LAST attempt and wrong for every earlier one, because the next model
 * never gets a chance. Rewriting three stream implementations to throw instead
 * would touch every transport; wrapping the response does not.
 *
 * The wrapper forwards nothing until the attempt COMMITS, which is its first
 * real CONTENT. The `{ streamId: ... }` line every stream function writes is
 * held back rather than counted: Anthropic's SDK reports HTTP failures (401,
 * 429, 529) as asynchronous error events that arrive AFTER that line, so
 * committing on it would make the commonest failures unrecoverable. The held
 * line is flushed, in order, the moment content arrives.
 *
 * Before commit:
 *   an error event / 4xx-5xx status / send   the attempt's failure; swallowed
 *   end() with nothing failed                an empty success: flushed + ended
 *
 * After commit everything passes straight through, errors included: a stream
 * that fails half way is NOT retried, because splicing a second model's answer
 * onto the first's would be worse than an honest error.
 *
 * `settled` resolves once the attempt has either committed or failed, so a
 * caller can wait out a transport (Anthropic) whose function returns before
 * the provider has answered.
 */

const ERROR_EVENT = /^\s*data:\s*\{\s*"error"/;
const STREAM_ID_LINE = /^\s*\{\s*streamId:/;

function textOf(chunk) {
  return Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk ?? '');
}

function errorFromBody(body) {
  const text = textOf(body);
  const json = text.replace(/^\s*data:\s*/, '').trim();
  try {
    const parsed = JSON.parse(json);
    if (parsed && typeof parsed.error === 'string') return parsed.error;
  } catch { /* not JSON: use the text */ }
  return text.trim() || 'Stream setup failed';
}

/**
 * @param {import('http').ServerResponse} res  the real response
 */
export function createAttemptResponse(res) {
  const state = { committed: false, failed: false, error: null, statusCode: null };
  const held = [];
  let settle;
  const settled = new Promise((resolve) => { settle = resolve; });

  const commit = () => {
    if (state.committed || state.failed) return;
    state.committed = true;
    if (state.statusCode !== null) res.status?.(state.statusCode);
    for (const chunk of held.splice(0)) res.write(chunk);
    settle(state);
  };

  const fail = (body) => {
    if (state.committed || state.failed) return;
    state.failed = true;
    state.error = errorFromBody(body);
    held.length = 0;
    settle(state);
  };

  const response = {
    write(chunk, ...rest) {
      if (state.committed) return res.write(chunk, ...rest);
      if (state.failed) return true;
      const text = textOf(chunk);
      if (state.statusCode >= 400 || ERROR_EVENT.test(text)) {
        fail(text);
        return true;
      }
      if (STREAM_ID_LINE.test(text)) {
        held.push(chunk);
        return true;
      }
      commit();
      return res.write(chunk, ...rest);
    },
    end(...args) {
      if (state.committed) return res.end(...args);
      if (state.failed) return response;
      const body = args[0];
      if (state.statusCode >= 400 || (body != null && ERROR_EVENT.test(textOf(body)))) {
        fail(body ?? `HTTP ${state.statusCode}`);
        return response;
      }
      commit();
      return res.end(...args);
    },
    status(code) {
      if (state.committed) res.status(code);
      else state.statusCode = code;
      return response;
    },
    send(body) {
      if (state.committed) return res.send(body);
      if (state.statusCode !== null && state.statusCode < 400) {
        commit();
        return res.send(body);
      }
      fail(body);
      return response;
    },
    setHeader: (...args) => res.setHeader(...args),
    getHeader: (...args) => res.getHeader?.(...args),
    flushHeaders: () => res.flushHeaders?.(),
    get headersSent() { return res.headersSent; },
  };

  return { response, state, settled };
}

export default { createAttemptResponse };
