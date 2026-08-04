/**
 * voiceRegister — how to answer when the answer is also being spoken.
 *
 * THE PROBLEM WITH READING THE ANSWER ALOUD
 * -----------------------------------------
 * A written answer and a spoken answer are not the same artifact, because the
 * two channels have opposite economics:
 *
 *   reading   ~250 wpm, skimmable, re-readable, random access
 *   listening ~150 wpm, linear, no skipping, no going back
 *
 * So a 600-word answer is a two-and-a-half minute read and a four minute
 * monologue — and the listener cannot skim past the part they already know,
 * cannot jump to the code block, cannot re-hear the one line that mattered.
 * Reading the full answer aloud takes the detail and forces it through the
 * channel that is worst at carrying detail.
 *
 * The other half of the asymmetry matters just as much: people SPEAK faster
 * than they type. Voice should therefore be a faster way to DRIVE an answer,
 * not a slower way to receive one.
 *
 * THE MODEL: A PRESENTER, NOT A SCREEN READER
 * -------------------------------------------
 * A good presenter does not read their slide. The slide carries the detail;
 * the presenter says the finding. They never disagree, because one person
 * produced both — which is exactly why this is a prompt instruction and not a
 * summariser bolted downstream. A summariser reading a stream cannot know at
 * sentence three whether sentence nine reverses it; the author knows the shape
 * of the answer before writing a word of it. One pass, two registers.
 *
 * WHY THE BOUNDARY IS A BLANK LINE AND NOT A MARKER
 * -------------------------------------------------
 * The spoken register is the answer's OPENING PARAGRAPH — not a separate field,
 * not a tagged block. That choice does real work:
 *
 *   - Nothing has to be stripped before rendering, so the chat needs no
 *     special-casing and no marker can leak into the transcript.
 *   - The spoken text is a literal prefix of the written text, so "the voice
 *     and the screen must never contradict" holds by construction rather than
 *     by good behaviour.
 *   - Leading with the finding is simply good writing, so the instruction
 *     costs nothing when the answer is read instead of heard.
 */

/**
 * The system-prompt section appended to a voice turn.
 *
 * Appended at the very END of the assembled prompt, deliberately: it is the
 * only per-turn-varying part, and keeping it at the tail leaves the whole
 * stable prefix ahead of it untouched.
 */
export function buildVoiceRegisterSection() {
  return [
    '## VOICE MODE — ONE ANSWER, TWO REGISTERS',
    '',
    'This turn is being SPOKEN ALOUD as well as rendered on screen. These are not two',
    'answers. They are one answer, told at the two lengths the two channels are good at.',
    '',
    'Open with the SPOKEN REGISTER: the finding, in as few sentences as it genuinely',
    'takes. Then a blank line. Everything after that blank line belongs to the screen —',
    'detail, code, tables, links, the reasoning.',
    '',
    'ONLY THE OPENING PARAGRAPH IS READ ALOUD. The rest is read by eye.',
    '',
    'The opening paragraph:',
    '- Leads with the ANSWER, never the approach. "Three tests were failing, same root',
    '  cause — fixed." not "I started by looking at the test output."',
    '- Is as short as the answer truly is. "Yes, that already merged." is a complete',
    '  spoken register. Do not pad it to sound thorough.',
    '- Never speaks code, file paths, tables, URLs or long numbers. Point at them',
    '  instead: "the diff is on screen", "I put the comparison in the chat".',
    '- Is plain speech. No markdown, no bullets, no headings — those are for the eye.',
    '',
    'When the detail IS the answer — a comparison, ten options, a long diff — say that',
    'and let them read it. They read far faster than you can speak, so pointing at the',
    'screen is the faster answer, not the lazy one.',
    '',
    'The two registers may differ in LENGTH. They must never differ in CLAIM. If the',
    'spoken part says it is fixed, the screen cannot say it is partly fixed.',
    '',
    'The user can interrupt you at any moment, so a short spoken register loses them',
    'nothing — anything you left on screen, they can simply ask about.',
  ].join('\n');
}

export default { buildVoiceRegisterSection };
