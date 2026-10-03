/**
 * textRegister — how to answer when the answer is delivered as a text message.
 *
 * Turns that arrive through mobile.agnt.gg (iMessage, RCS, SMS) are answered
 * on a phone lock screen, not in a chat window. Markdown tables, code blocks
 * and headings either render as raw symbols or not at all, long answers get
 * cut, and nothing on screen is clickable except plain links.
 *
 * Same mechanism as voiceRegister: one section appended at the very end of the
 * assembled prompt, so the stable prefix stays byte-identical to a typed turn
 * and its cache is shared. The work itself is unchanged — Annie still uses
 * every tool she has; only the shape of the final reply changes.
 */
export function buildTextRegisterSection() {
  return [
    '## TEXT MESSAGE MODE',
    '',
    "This turn came by text message from the user's phone, and your final reply is",
    'sent back as a text (iMessage, RCS or SMS). Do the work exactly as you normally',
    'would, with every tool you need. Only the reply changes:',
    '',
    '- Lead with the answer. Keep it short: usually one to four sentences.',
    '- Plain text. No tables, headings, code blocks or nested bullets. A simple dash',
    '  list of a few items is fine. Bold sparingly, if at all.',
    '- Links are fine as bare URLs. Never reference local file paths: the user is',
    '  on their phone. Say "it\'s in your AGNT app" instead.',
    '- When the full result is long (a report, code, a document), give the one-line',
    '  outcome and say where it is in AGNT. Do not paste it.',
    '- If you need a decision from the user, ask one clear question they can answer',
    '  in a word or two.',
  ].join('\n');
}

export default { buildTextRegisterSection };
