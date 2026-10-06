/**
 * A chat transport for a turn nobody is watching through this socket (a
 * sub-chat's work, a report back into its parent).
 *
 * Same contract as chatTransport.js; instead of writing SSE frames it keeps
 * the turn's final answer, whether it failed, and the ids of any images it
 * generated (so a texted report can attach them).
 */
export function createHeadlessTransport() {
  let finalContent = null;
  let lastError = null;
  let rejected = null;
  const imageIds = [];
  return {
    onClose() { return () => {}; },
    reject(status, error) { rejected = { status, error }; },
    start() {},
    send(eventName, payload) {
      if (eventName === 'final_content' && typeof payload?.content === 'string') {
        finalContent = payload.content;
        if (payload.recovered_from_error) lastError = lastError || 'The run hit an error before finishing.';
      } else if (eventName === 'error') {
        lastError = payload?.error || 'Unknown error';
      } else if (eventName === 'image_generated') {
        const id = payload?.imageId || payload?.id || payload?.ref;
        if (typeof id === 'string') imageIds.push(id);
      }
    },
    finish() {},
    outcome() {
      if (rejected) return { ok: false, content: null, error: String(rejected.error || `Rejected (${rejected.status})`), imageIds };
      if (!finalContent) return { ok: false, content: null, error: lastError || 'The run ended without an answer.', imageIds };
      return { ok: !lastError, content: finalContent, error: lastError, imageIds };
    },
  };
}

export default createHeadlessTransport;
