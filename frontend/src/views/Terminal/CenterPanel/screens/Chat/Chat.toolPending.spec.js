import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// WHAT HAPPENED (2026-09-03): every tool card in a fifteen-tool round said
// "running" from the moment the model NAMED the tool until the whole message
// finished — while the store, and the conversation after a reload, said
// "pending". Chat.vue's `tool_pending` handler set the same local
// `runningToolCalls` flag `tool_start` sets, and MessageItem's pill reads that
// flag before anything else. Nothing was running; the model was still writing
// arguments. The handler lives in a 3,000-line component wired to the store,
// socket and router, so the source is pinned here rather than mounted.
const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'Chat.vue'), 'utf8');

const caseBody = (name) => {
  const start = src.indexOf(`case '${name}':`);
  expect(start, `case '${name}' exists`).toBeGreaterThan(-1);
  const end = src.indexOf('\n        case ', start + 1);
  // Code only — the comment explaining the bug is allowed to name it.
  return src.slice(start, end).split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
};

describe('Chat.vue — a tool is not running until tool_start says so', () => {
  it('tool_pending updates the status line only', () => {
    const body = caseBody('tool_pending');
    expect(body).toContain('Preparing ${data.toolCall.name}');
    expect(body).not.toContain('runningToolCalls');
  });

  it('tool_start is what marks the tool running', () => {
    const body = caseBody('tool_start');
    expect(body).toMatch(/runningToolCalls\.value\[`\$\{data\.assistantMessageId\}-\$\{data\.toolCall\.id\}`\] = true;/);
  });

  it('tool_end clears it for that one tool, nothing else', () => {
    const body = caseBody('tool_end');
    expect(body).toMatch(/runningToolCalls\.value\[`\$\{data\.assistantMessageId\}-\$\{data\.toolCall\.id\}`\] = false;/);
  });
});
