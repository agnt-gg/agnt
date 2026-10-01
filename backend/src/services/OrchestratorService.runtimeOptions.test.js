/**
 * Every side effect of a chat turn obeys the caller's runtime options.
 *
 * WHY SOURCE ASSERTIONS
 * ---------------------
 * Same reason as .runAnnouncement / .streamLifetime / .turnTranscript: each
 * property is a CALL SITE inside a 4,000-line handler that no unit test drives
 * end to end. The option VALUES are covered behaviourally in
 * orchestrator/runtimeOptions.test.js and orchestrator/chatConfigs.runtime.test.js;
 * what only the source can show is that each side effect actually reads them.
 *
 * The defect (2026-10-01): thirteen programmatic agent calls became thirteen
 * conversations in the user's sidebar. The run:started broadcast made the open
 * app adopt each run and autosave it. Every gate below is one way that can
 * happen again.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { fileURLToPath } from 'url';

const CODE = fs.readFileSync(fileURLToPath(new URL('./OrchestratorService.js', import.meta.url)), 'utf8');
const SEGMENT = CODE.slice(CODE.indexOf('export async function executeChatSegment'));
const at = (needle) => {
  const index = SEGMENT.indexOf(needle);
  expect(index, `not found: ${needle}`).toBeGreaterThan(-1);
  return index;
};
const before = (needle, chars = 300) => SEGMENT.slice(Math.max(0, at(needle) - chars), at(needle));

describe('resolution', () => {
  it('resolves runtime once, from the request body, before anything is streamed', () => {
    expect(SEGMENT.match(/resolveRuntimeOptions\(/g) || []).toHaveLength(1);
    expect(at('runtime = resolveRuntimeOptions(requestBody?.runtime)')).toBeLessThan(at('transport.start();'));
  });

  it('rejects an invalid runtime with the error status, not a silent default', () => {
    expect(SEGMENT).toMatch(/catch \(runtimeError\) \{\s*return transport\.reject\(runtimeError\.status \|\| 400, runtimeError\.message\);/);
  });

  it('is scoped to the agent endpoints', () => {
    expect(SEGMENT).toMatch(/if \(runtime\.explicit && chatType !== 'agent'\) \{\s*return transport\.reject\(400,/);
  });

  it('hands the options to the prompt builder through the context', () => {
    const context = SEGMENT.slice(at('const conversationContext = {'), at('const conversationContext = {') + 2000);
    expect(context).toMatch(/\n\s*runtime,\n/);
  });
});

describe('nothing reaches the user\'s other clients unless the caller is the chat app', () => {
  it('run registration (which booting clients adopt) is gated', () => {
    expect(SEGMENT).toContain('if (runtime.broadcast) activeRun = startRun({');
  });

  it('the run:started announcement is gated', () => {
    expect(before('broadcastToUser(userId, RealtimeEvents.RUN_STARTED', 80)).toMatch(/if \(userId && runtime\.broadcast\) \{\s*$/);
  });

  it('the chat:* delta mirror is gated', () => {
    expect(before('const chatEventMappings = {', 200)).toMatch(/if \(userId && runtime\.broadcast\) \{/);
  });

  it('the user-message broadcast is gated', () => {
    expect(before('broadcastToUser(userId, RealtimeEvents.CHAT_USER_MESSAGE', 400)).toMatch(/runtime\.broadcast/);
  });

  it('there is no ungated chat-state broadcast left in the turn', () => {
    // Four broadcast sites. Three carry CHAT STATE (a run exists, the user
    // said this, here is the answer) and are what makes an open app adopt and
    // save a run — all three are gated. The fourth carries a TOOL'S EFFECT
    // (set_background_image, theme changes): a script that calls such a tool
    // wants the effect applied, and it never creates a conversation, so it is
    // deliberately not gated. A fifth site fails here until it is classified.
    const sites = [...SEGMENT.matchAll(/broadcastToUser\(/g)].map((m) => SEGMENT.slice(Math.max(0, m.index - 1000), m.index));
    // (1000 chars: the delta mirror's gate sits above its whole event-mapping table.)
    expect(sites).toHaveLength(4);
    const ungated = sites.filter((preamble) => !/runtime\.broadcast/.test(preamble));
    expect(ungated).toHaveLength(1);
    expect(ungated[0]).toMatch(/if \(userId && isGlobalFrontendEvent\(event\.type\)\) \{/);
  });
});

describe('every write is the caller\'s choice', () => {
  it('conversation log', () => {
    expect(SEGMENT).toContain('const logPromise = (!runtime.persist.conversationLog ? Promise.resolve(null) : isNewConversation');
  });

  it('saved transcript', () => {
    expect(SEGMENT).toContain('if (runtime.persist.transcript) persistTurnTranscript({');
  });

  it('in-memory and on-disk conversation state', () => {
    const gate = at('if (runtime.persist.conversationState) {');
    expect(gate).toBeLessThan(at('conversationManager.store(conversationId, {'));
    expect(gate).toBeLessThan(at('saveConversationState(conversationId, userId, conversationContext)'));
  });

  it('insight extraction, a second model call per turn', () => {
    expect(before("import('./evolution/InsightTriggers.js')", 120)).toMatch(/if \(runtime\.persist\.insights && agentExecutionId && userId\) \{/);
  });

  it('the account default provider is only rewritten by the chat app', () => {
    expect(SEGMENT).toMatch(/const persistDefaultNormalized = runtime\.profile === 'ui' && /);
  });

  it('the execution trace is NOT optional', () => {
    // There is deliberately no runtime switch for the run record: every call
    // stays attributable and costed.
    expect(before('const execId = await AgentExecutionModel.create(', 1500)).not.toMatch(/runtime\./);
  });
});

describe('provider honesty', () => {
  it('fallback "none" leaves only the requested tier, after the chain is built', () => {
    const slice = at("if (runtime.model.fallback === 'none') providerChain = providerChain.slice(0, 1);");
    expect(slice).toBeGreaterThan(at('Could not build provider failover chain'));
  });

  it('a failure with no failover is an error event, not prose in the answer', () => {
    const block = SEGMENT.slice(at('LLM adapter recovered from error'), at('LLM adapter recovered from error') + 900);
    expect(block).toMatch(/runtime\.model\.fallback === 'none'[\s\S]*sendEvent\('error'/);
  });

  it('the trace records the pair that served the turn, before the final update', () => {
    expect(at('AgentExecutionModel.recordServedModel(agentExecutionId, normalizedProvider, model)'))
      .toBeLessThan(at('await AgentExecutionModel.update(\n          agentExecutionId,'));
  });
});

describe('stream shape and limits', () => {
  it('filters the caller\'s SSE events without touching the replay log', () => {
    const body = SEGMENT.slice(at('const rawSendEvent'), at('const rawSendEvent') + 1500);
    expect(body).toContain('if (deliversToCaller(eventName)) transport.send(eventName, data);');
  });

  it('flushes line framing before the final events are sent', () => {
    const body = SEGMENT.slice(at('const rawSendEvent'), at('const rawSendEvent') + 1500);
    expect(body.indexOf('lineFramer.flush()')).toBeLessThan(body.indexOf('transport.send(eventName, data)'));
  });

  it('refuses an oversized request before it is sent', () => {
    expect(at('runtime.limits.maxInputTokens !== null && contextResult.totalRequestTokens'))
      .toBeLessThan(at('await streamAcrossChain('));
  });

  it('detaches the disconnect hook and clears the timeout before closing its own transport', () => {
    const finish = SEGMENT.lastIndexOf('transport.finish();');
    expect(SEGMENT.lastIndexOf('detachCancelOnClose?.();')).toBeLessThan(finish);
    expect(SEGMENT.lastIndexOf('clearTimeout(runtimeTimeout)')).toBeLessThan(finish);
  });
});
