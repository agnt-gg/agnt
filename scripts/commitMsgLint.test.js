import { describe, it, expect } from 'vitest';
import {
  BODY_MAX,
  SUBJECT_MAX,
  isExempt,
  lintCommitMessage,
  parseMessage,
  reflowBody,
  wrapParagraph,
} from '../.githooks/commit-msg-lint.mjs';

const lint = (raw) => lintCommitMessage(parseMessage(raw));
const rejects = (raw) => lint(raw).problems.length > 0;

/**
 * Verbatim shapes of four commits that shipped truncated (agnt-pro, 2026-08-23).
 * Held here rather than read from git history so the regression survives a
 * rebase, a squash, or a fresh clone with a shallow log.
 */
const SHIPPED_TRUNCATED = {
  '642736c6': {
    subject: 'feat(llm): drive OpenRouter reasoning controls from the published catalog',
    subjectLength: 73,
    invisibleTail: 'g',
    worstBodyLine: 660,
  },
  b989ad42: {
    subject: "fix(llm): read OpenRouter's reasoning deltas, which use a different field name",
    subjectLength: 78,
    invisibleTail: 'd name',
    worstBodyLine: 507,
  },
  acb1b348: {
    subject: 'fix(auth): keep the longest-lived session credential, not the newest writer',
    subjectLength: 75,
    invisibleTail: 'ter',
    worstBodyLine: 77,
  },
  d53d734c: {
    subject: 'fix(chat): share a preview the way artifacts does - whole directory, not one file',
    subjectLength: 81,
    invisibleTail: ' one file',
    worstBodyLine: 581,
  },
};

describe('commit-msg lint: the four that shipped truncated', () => {
  for (const [sha, shape] of Object.entries(SHIPPED_TRUNCATED)) {
    it(`${sha} is rejected`, () => {
      // The fixture must still describe reality, or the test proves nothing.
      expect(shape.subject).toHaveLength(shape.subjectLength);
      expect(shape.subject.slice(SUBJECT_MAX)).toBe(shape.invisibleTail);

      const message = [
        shape.subject,
        '',
        'x'.repeat(shape.worstBodyLine),
      ].join('\n');

      const { problems } = lint(message);
      expect(problems.length).toBeGreaterThan(0);
      expect(problems.join('\n')).toContain(String(shape.subjectLength));
    });
  }
});

describe('subject', () => {
  const body = '\n\nA body that is comfortably inside the limit.';

  it(`accepts exactly ${SUBJECT_MAX} chars`, () => {
    expect(rejects('f'.repeat(SUBJECT_MAX) + body)).toBe(false);
  });

  it(`rejects ${SUBJECT_MAX + 1} chars`, () => {
    expect(rejects('f'.repeat(SUBJECT_MAX + 1) + body)).toBe(true);
  });

  it('quotes both what GitHub shows and what it drops', () => {
    const subject = `fix(chat): ${'a'.repeat(60)} TAIL`;
    const { problems } = lint(subject);
    expect(problems[0]).toContain(subject.slice(0, SUBJECT_MAX));
    expect(problems[0]).toContain(subject.slice(SUBJECT_MAX));
  });

  it('rejects an empty subject', () => {
    expect(rejects('\n\nbody only')).toBe(true);
  });

  it('notes a long-but-legal subject without blocking it', () => {
    const { problems, notes } = lint('f'.repeat(60));
    expect(problems).toHaveLength(0);
    expect(notes.join(' ')).toContain('60 chars');
  });

  it('requires a blank line 2', () => {
    expect(rejects('subject line\nbody starts immediately')).toBe(true);
    expect(rejects('subject line\n\nbody after a blank')).toBe(false);
  });
});

describe('body width', () => {
  /**
   * Exactly `length` chars, containing a wrap point so the unbreakable-token
   * exemption cannot be what decides the outcome. Built to the character
   * because the limit is a boundary, and a test that probes 79 instead of 73
   * cannot tell `> 72` from `> 73`.
   */
  const bodyLine = (length) => `${'w'.repeat(length - 2)} w`;

  it(`accepts exactly ${BODY_MAX} chars`, () => {
    const line = bodyLine(BODY_MAX);
    expect(line).toHaveLength(BODY_MAX);
    expect(isExempt(line)).toBe(false);
    expect(rejects(`subject\n\n${line}`)).toBe(false);
  });

  it(`rejects exactly ${BODY_MAX + 1} chars`, () => {
    const line = bodyLine(BODY_MAX + 1);
    expect(line).toHaveLength(BODY_MAX + 1);
    expect(isExempt(line)).toBe(false);
    expect(rejects(`subject\n\n${line}`)).toBe(true);
  });

  it('names how many lines are over and the worst one', () => {
    const long = `${'word '.repeat(30)}end`;
    const { problems } = lint(`subject\n\n${long}\n${long}`);
    expect(problems[0]).toContain('2 body line(s)');
    expect(problems[0]).toContain(String(long.length));
  });

  it('reports a 660-char single line as the -m signature', () => {
    const { problems } = lint(`subject\n\n${'x y '.repeat(165)}`.trimEnd());
    expect(problems[0]).toContain('cmd.exe');
  });
});

describe('exemptions', () => {
  const over = (text) => `subject\n\n${text}`;

  it('leaves indented code and pasted logs alone', () => {
    const code = `    const x = ${'y'.repeat(90)};`;
    expect(isExempt(code)).toBe(true);
    expect(rejects(over(code))).toBe(false);
  });

  it('leaves trailers alone', () => {
    const trailer = `Co-authored-by: Somebody With A Notably Long Name <${'a'.repeat(50)}@example.com>`;
    expect(trailer.length).toBeGreaterThan(BODY_MAX);
    expect(rejects(over(trailer))).toBe(false);
  });

  it('leaves an unbreakable URL alone', () => {
    const url = `https://github.com/agnt/agnt-pro/commit/${'0'.repeat(80)}`;
    expect(rejects(over(url))).toBe(false);
  });

  it('does NOT exempt prose that merely contains a URL', () => {
    const prose = `See https://example.com/a for the details, ${'and more prose '.repeat(4)}`;
    expect(isExempt(prose)).toBe(false);
    expect(rejects(over(prose))).toBe(true);
  });

  it('skips generated subjects entirely', () => {
    for (const subject of [
      `Merge branch 'feature/${'x'.repeat(80)}'`,
      `Revert "${'x'.repeat(80)}"`,
      `fixup! ${'x'.repeat(80)}`,
      `squash! ${'x'.repeat(80)}`,
    ]) {
      expect(lint(subject).skipped).toBe(true);
      expect(rejects(subject)).toBe(false);
    }
  });

  it('does not skip a subject that merely starts with the word Merged', () => {
    expect(rejects(`Merged${'x'.repeat(80)}`)).toBe(true);
  });
});

describe('parseMessage', () => {
  it('drops comments and the --verbose diff', () => {
    const raw = [
      'subject',
      '',
      'body',
      '# Please enter the commit message for your changes.',
      '# ------------------------ >8 ------------------------',
      `diff --git a/x b/x with a very long line ${'z'.repeat(200)}`,
    ].join('\n');
    expect(parseMessage(raw)).toEqual(['subject', '', 'body']);
    expect(rejects(raw)).toBe(false);
  });

  it('handles CRLF input', () => {
    expect(parseMessage('subject\r\n\r\nbody\r\n')).toEqual(['subject', '', 'body']);
  });
});

describe('reflow', () => {
  const words = (text) => text.split(/\s+/).filter(Boolean);

  it('brings a 660-char line under the limit without losing a word', () => {
    const original = `${'reasoning controls come from the published catalog '.repeat(13)}end`;
    expect(original.length).toBeGreaterThan(600);

    const out = reflowBody(['subject', '', original]);
    for (const line of out) expect(line.length).toBeLessThanOrEqual(BODY_MAX);
    expect(words(out.slice(2).join(' '))).toEqual(words(original));
    expect(lintCommitMessage(out).problems).toHaveLength(0);
  });

  it('preserves paragraph breaks', () => {
    const out = reflowBody(['subject', '', 'first para '.repeat(12), '', 'second para '.repeat(12)]);
    expect(out.filter((line) => line === '')).toHaveLength(2);
  });

  it('gives list items a hanging indent', () => {
    const out = wrapParagraph(`- ${'item text '.repeat(15)}end`);
    expect(out[0].startsWith('- ')).toBe(true);
    for (const line of out.slice(1)) expect(line.startsWith('  ')).toBe(true);
    for (const line of out) expect(line.length).toBeLessThanOrEqual(BODY_MAX);
  });

  it('never merges two list items into one paragraph', () => {
    const out = reflowBody(['subject', '', '- alpha', '- bravo']);
    expect(out).toEqual(['subject', '', '- alpha', '- bravo']);
  });

  it('leaves preformatted blocks and trailers byte-identical', () => {
    const code = `    const veryLongIdentifier = ${'x'.repeat(90)};`;
    const trailer = 'Co-authored-by: A <a@example.com>';
    const out = reflowBody(['subject', '', 'prose '.repeat(20), '', code, '', trailer]);
    expect(out).toContain(code);
    expect(out).toContain(trailer);
  });

  it('emits an over-long unbreakable token on its own line rather than dropping it', () => {
    const url = `https://example.com/${'a'.repeat(90)}`;
    const out = wrapParagraph(`see ${url} now`);
    expect(out).toContain(url);
    expect(out.join(' ')).toContain('now');
  });

  it('never touches the subject', () => {
    const subject = 'f'.repeat(SUBJECT_MAX + 20);
    const out = reflowBody([subject, '', 'body '.repeat(30)]);
    expect(out[0]).toBe(subject);
    // ...and therefore still fails the lint, which is the point.
    expect(lintCommitMessage(out).problems).toHaveLength(1);
  });

  it('is idempotent', () => {
    const once = reflowBody(['subject', '', 'some prose that needs wrapping '.repeat(9)]);
    expect(reflowBody(once)).toEqual(once);
  });
});

describe('anti-vacuity', () => {
  it('accepts a well-formed message', () => {
    const message = [
      'fix(llm): read the reasoning field OpenRouter actually sends',
      '',
      'OpenRouter streams thinking as delta.reasoning. The transport read',
      'only delta.reasoning_content, which is DeepSeek\'s spelling, so the',
      'buffer stayed empty and the thinking panel never opened.',
      '',
      '  chatCompletions.js:558',
      '',
      'Co-authored-by: Nathan <nathan@agnt.gg>',
    ].join('\n');
    const { problems, notes } = lint(message);
    expect(problems).toHaveLength(0);
    expect(notes.join(' ')).toContain('60 chars');
  });
});
