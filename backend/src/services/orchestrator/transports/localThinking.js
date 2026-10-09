/** Separate a leading local-model <think> block before any bytes reach chat.
 * Tags may straddle arbitrary SSE chunks. Once the answer begins, literal
 * tags (e.g. in a code example) are left alone. An unclosed block stays reasoning.
 */
export function createLocalThinkingParser() {
  let pending = '';
  let phase = 'prefix';
  return {
    push(chunk = '', final = false) {
      pending += chunk;
      let content = '';
      let reasoning = '';
      if (phase === 'prefix') {
        const trimmed = pending.trimStart();
        if (trimmed.startsWith('<think>')) {
          pending = trimmed.slice(7);
          phase = 'thinking';
        } else if (!final && (trimmed === '' || '<think>'.startsWith(trimmed))) {
          return { content, reasoning };
        } else {
          phase = 'answer';
        }
      }
      if (phase === 'thinking') {
        const end = pending.indexOf('</think>');
        if (end >= 0) {
          reasoning = pending.slice(0, end);
          pending = pending.slice(end + 8);
          phase = 'answer';
        } else {
          let held = 0;
          if (!final) {
            for (let length = 1; length < 8 && length <= pending.length; length++) {
              if ('</think>'.startsWith(pending.slice(-length))) held = length;
            }
          }
          reasoning = pending.slice(0, pending.length - held);
          pending = held ? pending.slice(-held) : '';
        }
      }
      if (phase === 'answer') {
        content = pending;
        pending = '';
      }
      return { content, reasoning };
    },
  };
}
