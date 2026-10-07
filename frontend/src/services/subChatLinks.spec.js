/**
 * Handoffs and handbacks drawn as linked cards (reported 2026-10-07: the
 * handback read as if the user had typed it, raw INSTRUCTIONS block and all,
 * and nothing linked to the other chat).
 */
import { describe, it, expect, vi } from 'vitest';

const router = vi.hoisted(() => ({ push: vi.fn(() => Promise.resolve()) }));
vi.mock('vue-router', () => ({ useRouter: () => router }));
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mount } from '@vue/test-utils';
import { handbackOf, handoffsOf, handoffStatus, resolveByTitle, needsInputOf } from './subChatLinks.js';
import SubChatCard from '@/views/Terminal/CenterPanel/screens/Chat/components/SubChatCard.vue';

const marker = (items) => `<!-- agnt-subchats:${Buffer.from(JSON.stringify(items)).toString('base64url')} -->`;
const report = (body, items) => ({ role: 'user', content: `[System: Sub-chat finished]\n\n${body}\n\nINSTRUCTIONS:\nTell the user.\n\n${items ? marker(items) : ''}` });
const CHAT = join(dirname(fileURLToPath(import.meta.url)), '..', 'views/Terminal/CenterPanel/screens/Chat');

describe('handbackOf', () => {
  it('reads the marker the backend writes', () => {
    expect(handbackOf(report('x', [{ outputId: 'o1', title: 'Pricing', ok: true }]))).toEqual([{ outputId: 'o1', title: 'Pricing', ok: true, needsInput: false, question: null }]);
  });

  it('falls back to the prose for reports from before the marker', () => {
    const old = { role: 'user', content: '[System: Sub-chat finished with a problem]\n\nSub-chat: "Explainer" (conversation id c1)\nStatus: failed\nError: x' };
    expect(handbackOf(old)).toEqual([{ outputId: null, title: 'Explainer', ok: false, needsInput: false, question: null }]);
    const batch = { role: 'user', content: '[System: 2 sub-chats finished]\n\n--- 1 of 2 ---\nSub-chat: "A"\nStatus: completed\n\n--- 2 of 2 ---\nSub-chat: "B" (conversation id c)\nStatus: failed' };
    expect(handbackOf(batch).map((i) => [i.title, i.ok])).toEqual([['A', true], ['B', false]]);
  });

  it('is null for anything that is not a report', () => {
    expect(handbackOf({ role: 'user', content: 'hello [System: Sub-chat finished]' })).toBe(null);
    expect(handbackOf({ role: 'assistant', content: '[System: Sub-chat finished]' })).toBe(null);
    expect(handbackOf(null)).toBe(null);
  });
});

describe('handoffsOf / handoffStatus', () => {
  const call = (result, extra = {}) => ({ role: 'assistant', toolCalls: [{ id: 't1', name: 'start_chat', args: { title: 'Pricing' }, status: 'completed', result: JSON.stringify(result), ...extra }] });

  it('a started handoff names the new chat', () => {
    expect(handoffsOf(call({ success: true, outputId: 'o1', title: 'Pricing research' }))[0]).toMatchObject({ outputId: 'o1', title: 'Pricing research', started: true });
  });

  it('a refused handoff says so and links nowhere', () => {
    expect(handoffsOf(call({ success: false, error: 'Only the Main chat can start new chats.' }))[0]).toMatchObject({ outputId: null, started: false, error: expect.stringMatching(/Main chat/) });
  });

  it('other tools and other roles are not handoffs', () => {
    expect(handoffsOf({ role: 'assistant', toolCalls: [{ name: 'web_search', result: '{}' }] })).toEqual([]);
    expect(handoffsOf({ role: 'user', toolCalls: [{ name: 'start_chat' }] })).toEqual([]);
  });

  it('status follows the conversation: started, working, then the handback settles it', () => {
    expect(handoffStatus('o1', 'Pricing', [], new Set())).toBe('started');
    expect(handoffStatus('o1', 'Pricing', [], new Set(['o1']))).toBe('working');
    expect(handoffStatus('o1', 'Pricing', [report('x', [{ outputId: 'o1', title: 'Pricing', ok: true }])], new Set())).toBe('done');
    // Streaming after a handback means it was continued: working again.
    expect(handoffStatus('o1', 'Pricing', [report('x', [{ outputId: 'o1', title: 'Pricing', ok: true }])], new Set(['o1']))).toBe('working');
    expect(handoffStatus('o1', 'Pricing', [report('x', [{ outputId: 'o1', title: 'Pricing', ok: false }])], new Set())).toBe('problem');
  });

  it('an old handback is matched to its chat by title among sub-chats only', () => {
    const outputs = [{ id: 'plain', title: 'Explainer' }, { id: 'sub', title: 'Explainer' }];
    expect(resolveByTitle('Explainer', outputs, new Set(['sub']))).toBe('sub');
    expect(resolveByTitle('Nope', outputs, new Set(['sub']))).toBe(null);
  });
});

describe('SubChatCard', () => {
  it('"Open chat" opens the other conversation', async () => {
    const w = mount(SubChatCard, { props: { kind: 'handoff', title: 'Pricing', outputId: 'o1', status: 'working' } });
    expect(w.text()).toContain('Working in a new chat');
    expect(w.text()).toContain('Pricing');
    await w.find('.scc-open').trigger('click');
    expect(router.push).toHaveBeenCalledWith({ path: '/chat', query: { 'content-id': 'o1' } });
    w.unmount();
  });

  it('a handback shows its result; no link when the chat is unknown', () => {
    const w = mount(SubChatCard, { props: { kind: 'handback', title: 'Explainer', outputId: null, status: 'problem' } });
    expect(w.text()).toContain('Hit a problem in');
    expect(w.find('.scc-open').exists()).toBe(false);
    w.unmount();
  });
});

describe('wiring', () => {
  it('Chat draws a handback as a card instead of a user bubble, before the generic message', () => {
    const chat = readFileSync(join(CHAT, 'Chat.vue'), 'utf8');
    const card = chat.indexOf('v-else-if="handbackItems(message)"');
    expect(card).toBeGreaterThan(-1);
    expect(card).toBeLessThan(chat.indexOf('<MessageItem'));
  });

  it('a sub-chat shows where it came from, with a way back', () => {
    const chat = readFileSync(join(CHAT, 'Chat.vue'), 'utf8');
    expect(chat).toMatch(/v-if="subChatParent && !showFocusedHome" class="sub-chat-origin"/);
    expect(chat).toMatch(/@click="openSubChatParent"/);
    expect(chat).toMatch(/router\.push\(\{ path: '\/chat', query: \{ 'content-id': subChatParent\.value\.id \} \}\)/);
  });

  it('an assistant message draws its handoffs', () => {
    const item = readFileSync(join(CHAT, 'components/MessageItem.vue'), 'utf8');
    expect(item).toMatch(/<SubChatCard\s+v-for="h in handoffCards"/);
  });
});

// A blocked sub-chat asks through the Main chat (2026-10-07).
describe('questions from a sub-chat', () => {
  const ask = (question) => ({ role: 'user', content: `[System: Sub-chat needs your input]\n\nx\n\n${marker([{ outputId: 'o1', title: 'Email', ok: true, needsInput: true, question }])}` });

  it('a question handback carries the question', () => {
    expect(handbackOf(ask('Who to?'))).toEqual([{ outputId: 'o1', title: 'Email', ok: true, needsInput: true, question: 'Who to?' }]);
    const old = { role: 'user', content: '[System: Sub-chat needs your input]\n\nSub-chat: "Email" (conversation id c)\nStatus: needs input\nIts question for the user: Who to?\nTo answer it: x' };
    expect(handbackOf(old)[0]).toMatchObject({ title: 'Email', needsInput: true, question: 'Who to?' });
  });

  it('the latest handback wins: waiting after the question, done after the answer', () => {
    const done = report('y', [{ outputId: 'o1', title: 'Email', ok: true }]);
    expect(handoffStatus('o1', 'Email', [ask('Who to?')], new Set())).toBe('waiting');
    expect(handoffStatus('o1', 'Email', [ask('Who to?'), done], new Set())).toBe('done');
    expect(handoffStatus('o1', 'Email', [ask('Who to?')], new Set(['o1']))).toBe('working');
  });

  it('continue_chat calls are handoffs too, marked as answers', () => {
    const msg = { role: 'assistant', toolCalls: [{ id: 'c1', name: 'continue_chat', args: { chat: 'o1', message: 'Sam' }, status: 'completed', result: JSON.stringify({ success: true, outputId: 'o1', title: 'Email' }) }] };
    expect(handoffsOf(msg)[0]).toMatchObject({ continued: true, outputId: 'o1', title: 'Email', started: true });
  });

  it('needsInputOf matches the backend', () => {
    expect(needsInputOf('done.\n**NEEDS INPUT:** Which city?')).toBe('Which city?');
    expect(needsInputOf('mentions NEEDS INPUT: inline')).toBe(null);
  });

  it('the card shows the question and links to the chat', () => {
    const w = mount(SubChatCard, { props: { kind: 'handback', title: 'Email', outputId: 'o1', status: 'needs_input', question: 'Who should it go to?' } });
    expect(w.text()).toContain('Needs you');
    expect(w.text()).toContain('Who should it go to?');
    expect(w.find('.scc-open').exists()).toBe(true);
    w.unmount();
    const sent = mount(SubChatCard, { props: { kind: 'handoff', title: 'Email', outputId: 'o1', status: 'started', continued: true } });
    expect(sent.text()).toContain('Answer sent to');
    sent.unmount();
  });

  it('a waiting sub-chat says you can answer it right there', () => {
    const chat = readFileSync(join(CHAT, 'Chat.vue'), 'utf8');
    expect(chat).toMatch(/<span v-if="subChatAsking">It needs your answer: reply here/);
  });
});
