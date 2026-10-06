// Source contracts for the request-path wiring of the token-diet changes, in
// the style of the neighbouring *.wiring tests: the behaviour itself is
// unit-tested in historyRehydration / toolResultAging; these pin that the
// handler actually calls it, with the guards that keep it safe.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

const SRC = fs.readFileSync(new URL('./OrchestratorService.js', import.meta.url), 'utf8');
const between = (from, to) => SRC.slice(SRC.indexOf(from), SRC.indexOf(to, SRC.indexOf(from)));

describe('history rehydration wiring', () => {
  const block = between('Prepare messages - filter out', 'Broadcast user message to all connected tabs');

  it('runs only for the same provider and model, and never on a prepared (supervisor) history', () => {
    expect(block).toMatch(/if \(!preparedHistory && canRehydrateFor\(priorContext\?\._cacheRoundState, normalizedProvider, model\)\)/);
    expect(block).toMatch(/rehydrateHistory\(messages, storedTranscript\)/);
  });

  it('reads a stored transcript only for its owner', () => {
    const helper = between('async function storedTranscriptFor(', 'async function universalChatHandler(');
    expect(helper).toMatch(/priorContext\.userId === userId \? priorContext\.messages : null/);
    expect(helper).toMatch(/loadStoredTranscript\(conversationId, userId\)/);
  });
});

describe('uploaded files', () => {
  it('attach to the user message they were uploaded with, not the first one', () => {
    const block = between('Add file context (and attachments block)', 'Log vision context if images are present');
    expect(block).toMatch(/messages\.findLastIndex\(\(m\) => m\.role === 'user'\)/);
    expect(block).not.toMatch(/messages\.findIndex\(\(m\) => m\.role === 'user'\)/);
  });
});

describe('tool-result aging wiring', () => {
  it('ages the request copy inside the single tier funnel, before the request is fingerprinted', () => {
    const tier = between('const runTierStream = async', 'const onProviderFallback');
    const aging = tier.indexOf('messages = ageToolResults(messages, conversationContext');
    expect(aging).toBeGreaterThan(-1);
    expect(aging).toBeLessThan(tier.indexOf('prepareTierRequest('));
    expect(aging).toBeLessThan(tier.indexOf('cacheRounds.stamp('));
  });

  it('restores the aging watermark across turns', () => {
    expect(SRC).toMatch(/conversationContext\._agedToolCallIds = \[\.\.\.priorContext\._agedToolCallIds\]/);
  });
});

describe('reference-tool view cap', () => {
  it('sizes the cap per tool, under the user cap', () => {
    expect(SRC).toMatch(/const MAX_TOOL_RESULT_CHARS = toolResultCapFor\(functionName, toolOutputCap\);/);
  });
});
