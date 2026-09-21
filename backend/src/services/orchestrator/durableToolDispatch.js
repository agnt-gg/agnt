import { createHash } from 'node:crypto';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}

/** Receipt storage is injected; credentials and tool results never enter a checkpoint. */
export function createDurableToolDispatch({ claim, operations, receipts, assertOwnership, segmentId }) {
  if (!segmentId) throw new Error('A stable segment identity is required');
  return async ({ toolCallId, name, args, execute }) => {
    if (!toolCallId) throw new Error('A stable tool call identity is required');
    await assertOwnership();
    const fingerprint = createHash('sha256').update(JSON.stringify(canonical({ name, args }))).digest('hex');
    const intent = await operations.begin(claim, { key: `${segmentId}:${toolCallId}`, fingerprint, toolName: name });
    if (!intent.dispatch) {
      if (['completed', 'failed'].includes(intent.status) && intent.resultRef) return receipts.read(intent.resultRef);
      throw Object.assign(new Error('Previous operation outcome requires reconciliation'), { code: 'operation_uncertain' });
    }
    // No automatic catch-and-retry: a throw can follow a successful external write.
    let result;
    try { result = await execute(); }
    catch (error) {
      throw Object.assign(new Error('Tool outcome requires reconciliation', { cause: error }), { code: 'operation_uncertain' });
    }
    const resultRef = await receipts.write(intent.id, result);
    await assertOwnership();
    const committed = await operations.finish(claim, intent.id, {
      status: result?.success === false ? 'failed' : 'completed', resultRef,
    });
    if (!committed) throw new Error('Operation result lost its execution lease');
    return result;
  };
}
