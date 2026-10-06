/**
 * Test kit: the client's REAL history builder, executed in Node.
 *
 * The server must reason about the exact bytes the client will send next
 * turn, and the only honest model of that is the client's own code. This
 * extracts buildChatHistory (and the helpers it closes over) from the
 * frontend source and runs it in a VM — the same technique the existing
 * OrchestratorService.historyCacheStability test uses — so a client change
 * that alters the projection is picked up by the server's tests on the next
 * run instead of drifting silently.
 */
import fs from 'node:fs';
import vm from 'node:vm';
import { WIRE_PREAMBLE, WIRE_ACK } from '../../utils/compactedTranscript.js';
import { serverMessagesToUi } from './chatStreamReducer.mirror.js';

const read = (relative) => fs.readFileSync(new URL(relative, import.meta.url), 'utf8');

const chatSource = read('../../../../frontend/src/store/features/chat.js');
const compactionSource = read('../../../../frontend/src/services/conversationCompaction.js')
  .replace(/^import .*;$/gm, '')
  .replace(/^export \{[^}]+\};$/gm, '')
  .replace(/export default \{[\s\S]*$/, '')
  .replace(/export /g, '');
const foldHistorySource = vm.runInNewContext(`${compactionSource}\nfoldHistorySource;`, { WIRE_PREAMBLE, WIRE_ACK });

function extractFunction(name) {
  const start = chatSource.search(new RegExp(`(?:export )?function ${name}\\(`));
  if (start < 0) throw new Error(`clientHistoryBuilder.testkit: ${name} not found in chat.js`);
  return chatSource.slice(start, chatSource.indexOf('\n}', start) + 2).replace(/^export /, '');
}
const maxToolResultChars = Number(/const MAX_TOOL_RESULT_CHARS = (\d+)/.exec(chatSource)?.[1]);
if (!Number.isFinite(maxToolResultChars)) throw new Error('clientHistoryBuilder.testkit: MAX_TOOL_RESULT_CHARS not found');

/** frontend chat.js buildChatHistory, verbatim. */
export const buildChatHistory = vm.runInNewContext(
  ['speakerOfMessage', 'isOwnAssistantMessage', 'splitIntoRounds'].map(extractFunction).join('\n')
    + `\n(${extractFunction('buildChatHistory')})`,
  { MAX_TOOL_RESULT_CHARS: maxToolResultChars, foldHistorySource },
);

/** What the server's request handler keeps of each client message ("Prepare messages"). */
export const serverMap = (messages) => messages.map((m) => ({
  role: m.role, content: m.content, name: m.name, tool_calls: m.tool_calls, tool_call_id: m.tool_call_id,
}));

/**
 * The next turn's history exactly as the server receives it: the stored
 * transcript, reloaded into the UI, rebuilt by the client, mapped by the server.
 */
export function clientNextTurn(storedMessages, provider, newUserText) {
  const rebuilt = JSON.parse(JSON.stringify(buildChatHistory(serverMessagesToUi(storedMessages), provider)));
  return serverMap([...rebuilt, { role: 'user', content: newUserText }]);
}
