import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';
import { AnthropicAdapter } from './orchestrator/llmAdapters.js';

const read = (relative) => fs.readFileSync(new URL(relative, import.meta.url), 'utf8');
const service = read('./OrchestratorService.js');
const frontend = read('../../../frontend/src/services/chatService.js');
const mainFrontend = read('../../../frontend/src/store/features/chat.js');
const historySource = frontend.slice(frontend.indexOf('export function toChatHistory(messages) {'));
// Execute the real folding helper too: compression adds this dependency to both builders.
const compactionSource = read('../../../frontend/src/services/conversationCompaction.js')
  .replace(/^import .*;$/gm, '')
  .replace(/export default \{[\s\S]*$/, '')
  .replace(/export /g, '');
const foldHistorySource = vm.runInNewContext(compactionSource + '\nfoldHistorySource;');
const toHistory = vm.runInNewContext(`(${historySource.slice(0, historySource.indexOf('\n}') + 2).replace('export ', '')})`, { foldHistorySource });
const injectorAnchor = 'function injectDateIntoLastUserMessage(messages) {';
const injectorStart = service.indexOf(injectorAnchor);
const injectorSource = injectorStart < 0 ? null : service.slice(injectorStart, service.indexOf('\n}', injectorStart) + 2);
const code = service.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// Execute the old stage when present: this suite must fail on the unfixed service.
// The live integration experiment separately exercises the full request handler.
function prepare(displayMessages, now = '2026-09-08T23:59:59Z', forceOldStage = false) {
  const messages = JSON.parse(JSON.stringify(toHistory(displayMessages)));
  const sandbox = { messages, Date: class extends Date { constructor(...args) { super(...(args.length ? args : [now])); } } };
  const oldStage = injectorSource || `function injectDateIntoLastUserMessage(messages) {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user' && typeof messages[i].content === 'string') {
        messages[i].content += '\\n\\n<context date="' + new Date().toISOString().slice(0, 10) + '" />';
        return;
      }
    }
  }`;
  if (forceOldStage || (injectorSource && /injectDateIntoLastUserMessage\(messages\);/.test(code))) {
    vm.runInNewContext(oldStage + '\ninjectDateIntoLastUserMessage(messages);', sandbox);
  }
  return JSON.parse(JSON.stringify(sandbox.messages));
}
const user = (content) => ({ role: 'user', content });
const assistant = (content) => ({ role: 'assistant', content });
const adapter = () => new AnthropicAdapter({ messages: { create: async () => ({}) } }, 'claude-sonnet-5');
const normalized = (messages) => adapter()._normalizeHistoryMessages(structuredClone(messages));

describe('clock-independent human-turn history', () => {
  it('retains the exact previous user block at the provider normalization boundary', () => {
    const first = normalized(prepare([user('Dataset 1')]));
    const second = normalized(prepare([user('Dataset 1'), assistant('OK1'), user('Dataset 2')]));
    expect(second[0]).toEqual(first[0]);
  });
  it('does not mutate user content to supply the clock', () => {
    expect(prepare([user('Dataset 1')])).toEqual([user('Dataset 1')]);
  });
  it('does not put the injector anywhere else in the handler', () => {
    expect(code).not.toMatch(/injectDateIntoLastUserMessage/);
    expect(code).not.toContain('<context date=');
  });
  it('preserves bytes across UTC midnight', () => {
    const messages = [user('same input')];
    expect(prepare(messages, '2026-09-08T23:59:59Z')).toEqual(prepare(messages, '2026-09-09T00:00:01Z'));
  });
  it('is idempotent on retries', () => {
    const once = prepare([user('retry')]);
    expect(prepare(once)).toEqual(once);
  });
  it('preserves a reloaded historical footer, including literal user-supplied tags', () => {
    const messages = [user('A literal <context date="2001-01-01" />'), assistant('OK'), user('next')];
    expect(prepare(JSON.parse(JSON.stringify(messages)))).toEqual(messages);
  });
  it('does not walk backwards into an old text message when an image is newest', () => {
    const messages = [user('old text'), assistant('OK'), user([{ type: 'text', text: 'new image' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'fixture' } }])];
    expect(prepare(messages)).toEqual(messages);
  });
  it('preserves tool-block histories at the date stage', () => {
    const messages = [user('task'), assistant([{ type: 'tool_use', id: 'tool_1', name: 'read_file', input: {} }]), user([{ type: 'tool_result', tool_use_id: 'tool_1', content: 'result' }])];
    expect(prepare(messages)).toEqual(messages);
    expect(normalized(prepare(messages))).toEqual(normalized(messages));
  });
  it('keeps one-hour rolling markers on the existing adapter', () => {
    const messages = normalized(prepare([user('one'), assistant('OK1'), user('two')]));
    adapter()._applyRollingCacheBreakpoints(messages);
    const markers = messages.flatMap(m => [m.cache_control, ...(Array.isArray(m.content) ? m.content.map(b => b.cache_control) : [])]).filter(Boolean);
    expect(markers).toHaveLength(2);
    expect(markers.every(marker => marker.ttl === '1h')).toBe(true);
  });
  it('executes the main frontend builder and matches the panel builder for the measured text history', () => {
    const extractFunction = (name) => {
      const start = mainFrontend.indexOf(`function ${name}(`);
      expect(start).toBeGreaterThan(-1);
      return mainFrontend.slice(start, mainFrontend.indexOf('\n}', start) + 2);
    };
    const mainBuilder = vm.runInNewContext(
      `${extractFunction('speakerOfMessage')}\n${extractFunction('isOwnAssistantMessage')}\n(${extractFunction('buildChatHistory')})`,
      { MAX_TOOL_RESULT_CHARS: 2000, foldHistorySource },
    );
    const messages = [user('one'), assistant('OK1'), user('two')];
    for (const provider of ['claude-code', 'openai-codex']) {
      expect(JSON.parse(JSON.stringify(mainBuilder(messages, provider)))).toEqual(JSON.parse(JSON.stringify(toHistory(messages))));
    }
  });
  it('keeps the compressed summary prefix stable across turns and midnight', () => {
    const marker = {id:'fold-1',role:'compaction',content:'Summary',timestamp:1};
    const first = prepare([user('original'),assistant('old'),marker,user('next')]);
    const second = prepare([user('original'),assistant('old'),marker,user('next'),assistant('OK'),user('later')], '2026-09-09T00:00:01Z');
    expect(second.slice(0,first.length)).toEqual(first);
    expect(first[0].content).toContain('Summary');
    expect(first.some(m=>m.content==='original')).toBe(false);
  });

  it('negative control: restoring the old injector breaks the protected prefix', () => {
    const first = prepare([user('one')], undefined, true);
    const second = prepare([user('one'), assistant('OK1'), user('two')], undefined, true);
    expect(first[0]).not.toEqual(second[0]);
  });
});
