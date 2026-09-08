/** JSON SSE framing for authenticated chat streams. Unknown named JSON events
 * are forwarded for host policy; comments/id/retry are ignored. EOF must end at
 * a frame boundary: even valid JSON without its blank delimiter is incomplete.
 * Limits bound decoded frame/stream memory, not provider execution duration.
 */
export function createBoundedSseReader(reader, { maxFrameChars = 1048576, maxStreamChars = 16777216, readTimeoutMs = 60000 } = {}) {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let buffer = '', total = 0, closed = false, pendingError = null;
  async function close(cancel = false) {
    if (closed) return;
    closed = true;
    // Cancellation may itself hang on a broken transport. Request it without
    // allowing its promise to prevent lock release or request settlement.
    try { if (cancel) Promise.resolve(reader.cancel?.()).catch(() => {}); }
    finally { reader.releaseLock?.(); }
  }
  function frames() {
    const output = [];
    let match;
    while ((match = /\r?\n\r?\n/.exec(buffer))) {
      try {
        const frame = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        if (frame.length > maxFrameChars) throw new Error('sse_frame_limit');
        let name = 'message';
        const data = [];
        for (const line of frame.split(/\r?\n/)) {
          if (!line || line.startsWith(':')) continue;
          const colon = line.indexOf(':');
          const field = colon < 0 ? line : line.slice(0, colon);
          const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
          if (field === 'event') name = value;
          else if (field === 'data') data.push(value);
          else if (field !== 'id' && field !== 'retry') throw new Error('sse_field_invalid');
        }
        if (!data.length) { if (name !== 'message') throw new Error('sse_data_missing'); continue; }
        const parsed = JSON.parse(data.join('\n'));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('sse_payload_invalid');
        output.push({ name, data: parsed });
      } catch (error) {
        if (!output.length) throw error;
        // Preserve historical acceptance from earlier frames in this read.
        // The next read fails before consuming any more wire data.
        pendingError = error; buffer = ''; break;
      }
    }
    if (buffer.length > maxFrameChars) {
      if (!output.length) throw new Error('sse_frame_limit');
      pendingError = new Error('sse_frame_limit'); buffer = '';
    }
    return output;
  }
  return {
    async read() {
      try {
        if (pendingError) throw pendingError;
        let timer;
        const timeout = new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('sse_read_timeout')), Math.min(300000, Math.max(1, readTimeoutMs)));
        });
        let chunk;
        try { chunk = await Promise.race([reader.read(), timeout]); }
        finally { clearTimeout(timer); }
        const { done, value } = chunk;
        const text = done ? decoder.decode() : decoder.decode(value, { stream: true });
        total += text.length;
        if (total > maxStreamChars) throw new Error('sse_stream_limit');
        buffer += text;
        const events = frames();
        if (done) {
          if (buffer.length) throw new Error('sse_incomplete_eof');
          await close();
        }
        return { done, events };
      } catch (error) { try { await close(true); } catch { /* preserve framing failure */ } throw error; }
    },
    close,
  };
}
