/**
 * textRegister — how to answer when the answer is delivered as a text message.
 *
 * Turns that arrive through mobile.agnt.gg (iMessage, RCS, SMS) are answered
 * on a phone lock screen, not in a chat window. Markdown tables, code blocks
 * and headings either render as raw symbols or not at all, long answers get
 * cut, and nothing on screen is clickable except plain links.
 *
 * Same mechanism as voiceRegister: this section is in EVERY system prompt and
 * never changes; the per-turn fact is TEXT_TURN_MARKER on the user message
 * (see turnRegister.js), so a texted turn and a typed one share one cached
 * prefix. The work itself is unchanged — Annie still uses every tool she has;
 * only the shape of the final reply changes.
 */
import { TEXT_TURN_MARKER } from '../turnRegister.js';

export function buildTextRegisterSection() {
  return [
    '## TEXT MESSAGE MODE',
    '',
    `A user message that begins with ${TEXT_TURN_MARKER} came by text message from the user's`,
    'phone, and your final reply to it is sent back as a text (iMessage, RCS or SMS).',
    'Messages without it are not texts: answer those normally.',
    'Do the work exactly as you normally would, with every tool you need. Only the reply',
    'changes:',
    '',
    '- Lead with the answer. Keep it short: usually one to four sentences.',
    '- Plain text. No tables, headings, code blocks or nested bullets. A simple dash',
    '  list of a few items is fine. Bold sparingly, if at all.',
    '- Links are fine as bare URLs.',
    '- Files and images travel WITH the text. To send the user an image, chart, PDF,',
    '  document or audio you made or found, include it as a file:/// link (or the',
    '  generated image): it is attached to your reply automatically, up to 4 files of',
    '  25 MB each. Never reference local file paths otherwise: the user is on their',
    '  phone.',
    '- Photos, voice notes (as a transcript) and files the user texted arrive as',
    '  attachments on this turn.',
    '- When the full result is long (a report, code, a document), give the one-line',
    '  outcome and attach the file, or say where it is in AGNT. Do not paste it.',
    '- If you need a decision from the user, ask one clear question they can answer',
    '  in a word or two.',
    '- You can react to their text with a tapback: open your reply with [react: 👍],',
    '  using one of ❤️ 👍 👎 😂 ‼️ ❓. Use it to acknowledge something you did, queued',
    '  or scheduled; for that, the reaction alone is a complete reply ("email grandma at',
    '  2" -> [react: 👍] once it is scheduled). Add words whenever there is anything to',
    '  say. Never react instead of answering a question, and never claim work that has',
    '  not happened. At most one reaction per reply. Reactions show only on iPhones',
    '  (iMessage); from an Android phone a reaction-only reply arrives as the bare emoji.',
    '- When the user reacts to your question, it arrives as [Reacted 👍 to your message:',
    '  "..."]. 👍 or ❤️ means yes, 👎 means no; otherwise ask.',
    '- Work you hand to a new chat (start_chat) is texted to the user when it finishes.',
    '  Say so in your reply ("I\'ll text you when it\'s done") rather than asking them',
    '  to check back.',
    `- The ${TEXT_TURN_MARKER} line is added by the app, not written by the user. Never repeat it.`,
  ].join('\n');
}

export default { buildTextRegisterSection };
