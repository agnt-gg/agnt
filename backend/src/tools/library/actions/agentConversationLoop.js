// Workflow-agent execution boundary. Reuses host runtime/policy dispatch; no
// actor-authored field can clear a failed or uncertain child observation.
import { randomUUID } from 'node:crypto';
import { taskFailureReason } from '../../../services/goal/taskOutcome.js';
import { getAvailableToolSchemas } from '../../../services/orchestrator/tools.js';
import { getToolsForCategories } from '../../../services/orchestrator/toolSelector.js';
import { stripProviderIncompatibleTools } from '../../../services/orchestrator/providerToolCompat.js';

// Resolve requested additions through existing registry/category rules, retaining
// the runtime's original permission ceiling. This is residency, not a new grant.
export async function refreshAgentSchemas(context, schemas, userId, provider) {
  const requested = context._requestedToolCategories;
  if (!requested?.size) return schemas;
  const live = await getAvailableToolSchemas({ userId, asyncEnabled: false });
  const ceiling = context._toolCeiling instanceof Set ? context._toolCeiling : context.enabledTools;
  const additions = getToolsForCategories(live, [...requested]);
  requested.clear();
  const all = new Map(schemas.map(s => [s.function.name, s]));
  for (const s of additions) if (!ceiling || ceiling.has(s.function.name)) all.set(s.function.name, s);
  return stripProviderIncompatibleTools([...all.values()], provider);
}

export function workflowCancellation(engine, pollMs = 25) {
  const controller = new AbortController();
  const parent = engine?.abortSignal || engine?.signal;
  const check = () => { if (engine?.stopRequested || parent?.aborted) controller.abort(); };
  check();
  parent?.addEventListener('abort', check, { once: true });
  const timer = setInterval(check, pollMs); timer.unref?.();
  return { signal: controller.signal, check, dispose() { clearInterval(timer); parent?.removeEventListener('abort', check); } };
}
function cancelled() { return Object.assign(new Error('Workflow agent cancelled; child termination is not implied'), { code: 'WORKFLOW_AGENT_CANCELLED' }); }
function waitFor(factory, signal) {
  if (signal.aborted) return Promise.reject(cancelled());
  return new Promise((resolve, reject) => {
    const abort = () => { cleanup(); reject(cancelled()); };
    const cleanup = () => signal.removeEventListener('abort', abort);
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve().then(() => { if (signal.aborted) throw cancelled(); return factory(); }).then(
      value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); }
    );
  });
}
function responseText(message) {
  if (typeof message?.content === 'string') return message.content;
  if (Array.isArray(message?.content)) return message.content.filter(x => x?.type === 'text').map(x => x.text || '').join('\n');
  return '';
}
function returnedFailure(value) {
  // Only conventional execution-envelope result nesting, not arbitrary report
  // contents such as a linter's domain-level valid:false field.
  for (let depth = 0; value && typeof value === 'object' && depth < 6; depth++) {
    if (value.success === false || value.error) return true;
    value = value.result;
  }
  return false;
}
export async function runAgentConversation({ adapter, messages, schemas, context, dispatch, cancellation, refreshSchemas, maxRounds = 10 }) {
  const { signal, check } = cancellation;
  // Discovery mutates this invocation's context; keep it stable across calls.
  context = { ...context, abortSignal: signal };
  const executions = [], allowed = new Set(schemas.map(s => s.function?.name));
  let rounds = 0, response = null, pending = [], modelPending = false;
  const checkpoint = () => { check(); if (signal.aborted) throw cancelled(); };
  const finish = (outcome, error = null) => ({
    success: outcome === 'completed', outcome, response: responseText(response), error,
    toolExecutions: structuredClone(executions), toolsUsed: executions.length,
    execution: { rounds, maxRounds, pendingToolCalls: pending.length,
      modelOutcome: modelPending ? 'unknown' : 'returned_or_not_started',
      unresolvedCalls: executions.filter(x => x.disposition === 'unknown').map(x => x.callId),
      failedCalls: executions.filter(x => ['failed','not_dispatched'].includes(x.disposition)).map(x => x.callId),
      cancellationRequested: signal.aborted, childTerminationVerified: false,
      semantics: 'Conversation protocol outcome, not verified task completion. Failed calls require separate review; prose cannot clear them.' }
  });
  async function ask() {
    checkpoint(); modelPending = true;
    const value = await waitFor(() => adapter.call(messages, schemas, context), signal);
    modelPending = false; checkpoint();
    if (!value?.responseMessage) throw Error('Missing model response');
    response = value.responseMessage;
    if (value.toolCalls != null && !Array.isArray(value.toolCalls)) throw Error('Malformed model tool calls');
    pending = value.toolCalls || []; messages.push(response);
  }
  try {
    await ask();
    while (pending.length && rounds < maxRounds) {
      checkpoint(); rounds++;
      const calls = pending; pending = []; const replies = [];
      // Serial admission prevents a later call starting after a stop/failure
      // boundary has been observed. Already-dispatched tools may ignore abort.
      for (let index = 0; index < calls.length; index++) {
        pending = calls.slice(index); checkpoint();
        const call = calls[index], name = call.function?.name;
        const receipt = { callId: randomUUID(), toolCallId: call.id, name, disposition: 'not_dispatched', arguments: null };
        executions.push(receipt);
        let args, raw;
        try {
          if (!allowed.has(name)) throw Error('Tool is not in this agent invocation schema');
          args = JSON.parse(call.function.arguments);
          if (!args || typeof args !== 'object' || Array.isArray(args)) throw Error('Tool arguments must be an object');
          receipt.arguments = args;
        } catch (error) {
          receipt.error = error.message; raw = JSON.stringify({ success: false, error: error.message });
        }
        if (args && !receipt.error) {
          checkpoint(); receipt.disposition = 'unknown';
          try {
            raw = await waitFor(() => dispatch(name, args, context), signal);
            let parsed;
            try { parsed = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { throw Error('Unparseable child response; outcome unresolved'); }
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Error('Malformed child response; outcome unresolved');
            receipt.disposition = returnedFailure(parsed) ? 'failed' : 'returned';
            receipt.success = receipt.disposition === 'returned';
            receipt.result = parsed;
            if (parsed.error) receipt.error = String(parsed.error);
            raw = typeof raw === 'string' ? raw : JSON.stringify(raw);
          } catch (error) {
            if (signal.aborted || error.code === 'WORKFLOW_AGENT_CANCELLED') throw error;
            receipt.error = error.message; raw = JSON.stringify({ success: false, error: error.message });
          }
        }
        receipt.rawResponse = raw;
        checkpoint();
        replies.push({ tool_call_id: call.id, role: 'tool', name, content: raw });
        pending = calls.slice(index + 1);
      }
      messages.push(...adapter.formatToolResults(replies));
      if (refreshSchemas) {
        checkpoint();
        const refreshed = await waitFor(() => refreshSchemas(context, schemas), signal);
        schemas = refreshed;
        allowed.clear(); schemas.forEach(s => allowed.add(s.function?.name));
      }
      await ask();
    }
    checkpoint();
    if (pending.length) return finish('incomplete', 'Tool round limit reached with pending calls');
    if (executions.some(x => x.disposition !== 'returned')) return finish('needs_review', 'Failed or unresolved child calls require review');
    if (!responseText(response).trim()) return finish('incomplete', 'No final response');
    const reportedFailure = taskFailureReason({ content: responseText(response) });
    if (reportedFailure) return finish('needs_review', reportedFailure);
    return finish('completed');
  } catch (error) {
    return finish(signal.aborted ? 'cancelled' : 'failed', error.message || 'Agent execution failed');
  }
}
