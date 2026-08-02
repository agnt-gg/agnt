/**
 * voiceReplyPolicy — how the assistant should TALK, as opposed to write.
 *
 * THE FAILURE THIS PREVENTS
 * ------------------------
 * The single loudest "this is a machine" signal is not the voice quality. It is
 * length. A written answer that is excellent — six paragraphs, a table, a code
 * block, a numbered list — becomes intolerable when spoken, because the reader
 * can skim and the listener cannot. Ninety seconds of unskippable audio with
 * the answer buried at the end is worse than no voice at all.
 *
 * So voice mode is not "the same answer, read out". It is a different rendering
 * of the same work: a short spoken summary, with the full artifact still in the
 * transcript where it can be read, scrolled and copied. The chat is the
 * document; the voice is the conversation about it.
 *
 * WHY A PROMPT ADDENDUM AND NOT POST-PROCESSING
 * ---------------------------------------------
 * Truncating a long answer after generation produces a stump: the model spends
 * its opening sentences on preamble and the summary never arrives. Telling the
 * model up front that it is speaking changes the SHAPE of what it writes, so
 * the first sentence carries the answer. Post-processing (sentenceChunker)
 * still strips what cannot be read aloud, but that is a safety net, not the
 * mechanism.
 */

export const DEFAULT_VOICE_POLICY = Object.freeze({
  /** Target length for a spoken reply, in sentences. */
  maxSentences: 3,
  /** Hard word ceiling; past this, listeners tune out. */
  maxWords: 60,
  /** Announce long-running tool work instead of going silent. */
  narrateTools: true,
});

/**
 * The system-prompt addendum for a voice turn.
 * Appended to the existing prompt, never replacing it — the agent's identity,
 * tools and workspace context are all still in force.
 */
export function buildVoicePromptAddendum(policy = {}) {
  const p = { ...DEFAULT_VOICE_POLICY, ...policy };

  return [
    '## VOICE MODE',
    '',
    'This turn is being SPOKEN ALOUD as well as written. The user is listening, not reading.',
    '',
    `- Lead with the answer. Aim for ${p.maxSentences} sentences or fewer, under ${p.maxWords} words.`,
    '- Do not read code, tables, file paths, URLs or long numbers aloud. Produce them normally — they render in the chat — and refer to them in one short phrase ("I put the diff in the chat").',
    '- No preamble, no restating the question, no "certainly", no summary of what you are about to say.',
    '- Use plain spoken sentences. No markdown headings, bullet lists or numbered lists in the spoken part.',
    '- If the answer genuinely needs length, say the one-sentence version aloud and put the detail in the chat.',
    '- If you need something from the user, ask ONE short question and stop.',
    p.narrateTools
      ? '- Before a slow tool call, say what you are doing in a few words, then work quietly. Do not narrate every step.'
      : '',
    '',
    'The user can interrupt you at any time. If they do, they have only heard the words spoken so far — treat anything after that as unsaid.',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Would this reply be painful to listen to?
 * Used to nudge the UI ("summarised for voice") and to flag prompt drift in
 * tests, not to alter the text — rewriting a reply after the fact reads worse
 * than a long one.
 */
export function assessSpokenLength(text, policy = {}) {
  const p = { ...DEFAULT_VOICE_POLICY, ...policy };
  const clean = String(text || '').trim();
  if (!clean) return { words: 0, sentences: 0, tooLong: false };

  const words = clean.split(/\s+/).filter(Boolean).length;
  const sentences = (clean.match(/[.!?]+(\s|$)/g) || []).length || (words ? 1 : 0);

  return {
    words,
    sentences,
    tooLong: words > p.maxWords || sentences > p.maxSentences,
  };
}

export default { buildVoicePromptAddendum, assessSpokenLength, DEFAULT_VOICE_POLICY };
