import { describe, it, expect } from 'vitest';
import {
  createSentenceChunker,
  stripUnspeakable,
  findSentenceEnd,
  VISUAL_SUBSTITUTIONS,
} from './sentenceChunker.js';

describe('findSentenceEnd — the false-split traps', () => {
  it('does not split a version string', () => {
    expect(findSentenceEnd('upgrade to v2.17.2 today')).toBe(-1);
  });

  it('does not split a filename', () => {
    expect(findSentenceEnd('open index.js now')).toBe(-1);
  });

  it('does not split a decimal', () => {
    expect(findSentenceEnd('it costs 1.50 total')).toBe(-1);
  });

  it('does not split a domain', () => {
    expect(findSentenceEnd('go to agnt.gg for more')).toBe(-1);
  });

  it('does not split an abbreviation', () => {
    expect(findSentenceEnd('Dr. Chen said hello')).toBe(-1);
    expect(findSentenceEnd('e.g. this one')).toBe(-1);
  });

  it('does not split an initial', () => {
    expect(findSentenceEnd('J. Morency wrote it')).toBe(-1);
  });

  it('does not split an ellipsis', () => {
    expect(findSentenceEnd('well... maybe')).toBe(-1);
  });

  it('DOES split a real sentence', () => {
    const text = 'That works. Next thing.';
    expect(findSentenceEnd(text)).toBe(11);
  });

  it('splits on ? and !', () => {
    expect(findSentenceEnd('Really? Yes.')).toBe(7);
    expect(findSentenceEnd('Stop! Now.')).toBe(5);
  });

  it('keeps a closing quote with its sentence', () => {
    const text = 'He said "go." Then left.';
    expect(text.slice(0, findSentenceEnd(text))).toBe('He said "go."');
  });

  it('treats a hard newline after content as a break', () => {
    expect(findSentenceEnd('A heading\nbody text')).toBe(10);
  });

  it('returns -1 for text with no terminator', () => {
    expect(findSentenceEnd('still going')).toBe(-1);
  });
});

describe('stripUnspeakable', () => {
  it('replaces a code fence with a short spoken note', () => {
    const out = stripUnspeakable('Here it is:\n```js\nconst a = 1;\n```\nDone.');
    expect(out).toContain(VISUAL_SUBSTITUTIONS.codeBlock);
    expect(out).not.toContain('const a = 1');
    expect(out).not.toContain('```');
  });

  it('announces a chart rather than reading its JSON', () => {
    const out = stripUnspeakable('```chartjs\n{"type":"bar","data":{}}\n```');
    expect(out).toBe(VISUAL_SUBSTITUTIONS.chart);
  });

  it('replaces a markdown table', () => {
    const table = '| a | b |\n| --- | --- |\n| 1 | 2 |';
    const out = stripUnspeakable(`Results:\n${table}\nThat is all.`);
    expect(out).toContain(VISUAL_SUBSTITUTIONS.table);
    expect(out).not.toContain('---');
  });

  it('announces images and drops image refs', () => {
    expect(stripUnspeakable('![alt](x.png)')).toBe(VISUAL_SUBSTITUTIONS.image);
    expect(stripUnspeakable('<img src="y.png">')).toBe(VISUAL_SUBSTITUTIONS.image);
    expect(stripUnspeakable('see {{IMAGE_REF:abc}} here')).toBe('see here');
  });

  it('keeps inline code contents but drops the backticks', () => {
    expect(stripUnspeakable('run `npm test` now')).toBe('run npm test now');
  });

  it('keeps a link label and drops the URL', () => {
    expect(stripUnspeakable('see [the docs](https://x.com/a/b)')).toBe('see the docs');
  });

  it('does not spell out a bare URL', () => {
    const out = stripUnspeakable('go to https://agnt.gg/docs now');
    expect(out).not.toContain('https');
    expect(out).toContain('link');
  });

  it('strips markdown emphasis, headings and bullets', () => {
    expect(stripUnspeakable('## Title')).toBe('Title');
    expect(stripUnspeakable('- one\n- two')).toBe('one\ntwo');
    expect(stripUnspeakable('**bold** and *italic*')).toBe('bold and italic');
    expect(stripUnspeakable('> quoted')).toBe('quoted');
  });

  it('emits each visual note only once per kind', () => {
    const out = stripUnspeakable('```js\na\n```\ntext\n```js\nb\n```');
    const hits = out.split(VISUAL_SUBSTITUTIONS.codeBlock).length - 1;
    expect(hits).toBe(2); // one per block, but the same phrasing
    expect(out).not.toContain('```');
  });

  it('is safe on empty and non-string input', () => {
    expect(stripUnspeakable('')).toBe('');
    expect(stripUnspeakable(null)).toBe('');
    expect(stripUnspeakable(undefined)).toBe('');
  });
});

describe('createSentenceChunker — incremental speaking', () => {
  it('emits nothing until a sentence completes', () => {
    const c = createSentenceChunker();
    expect(c.push('The build is')).toEqual([]);
    expect(c.push('The build is green')).toEqual([]);
  });

  it('emits the first sentence while the rest is still streaming', () => {
    const c = createSentenceChunker();
    expect(c.push('The build is green.')).toEqual(['The build is green.']);
    expect(c.push('The build is green. Three tests')).toEqual([]);
    expect(c.push('The build is green. Three tests were added.')).toEqual(['Three tests were added.']);
  });

  it('never re-emits text it already released', () => {
    const c = createSentenceChunker();
    const all = [];
    for (const s of ['One two three.', 'One two three. Four five six.', 'One two three. Four five six. Seven eight nine.']) {
      all.push(...c.push(s));
    }
    expect(all).toEqual(['One two three.', 'Four five six.', 'Seven eight nine.']);
  });

  it('handles a fence arriving across several deltas without leaking it', () => {
    const c = createSentenceChunker();
    const spoken = [];
    spoken.push(...c.push('Here you go.'));
    spoken.push(...c.push('Here you go.\n```js\n'));
    spoken.push(...c.push('Here you go.\n```js\nconst a = 1;\n'));
    spoken.push(...c.push('Here you go.\n```js\nconst a = 1;\n```\nThat is the fix.'));
    spoken.push(...c.flush());

    const joined = spoken.join(' ');
    expect(joined).toContain('Here you go.');
    expect(joined).toContain('That is the fix.');
    expect(joined).not.toContain('const a = 1');
    expect(joined).not.toContain('```');
  });

  it('flush releases an unterminated tail', () => {
    const c = createSentenceChunker();
    expect(c.push('Everything is working fine. And one more thing')).toEqual([
      'Everything is working fine.',
    ]);
    expect(c.flush()).toEqual(['And one more thing']);
  });

  it('flush is empty when everything was already emitted', () => {
    const c = createSentenceChunker();
    expect(c.push('Everything is working fine.')).toEqual(['Everything is working fine.']);
    expect(c.flush()).toEqual([]);
  });

  it('does not emit a tiny fragment mid-stream — it merges forward instead', () => {
    // REGRESSION: the first implementation bailed on a short sentence and
    // re-examined it on every push, so a short opener stalled the queue and
    // NOTHING was ever spoken until the stream ended.
    const c = createSentenceChunker({ minChunkChars: 12 });
    expect(c.push('Ok.')).toEqual([]);
    expect(c.push('Ok. Here is the longer part now.')).toEqual(['Ok. Here is the longer part now.']);
  });

  it('a short opener never blocks the rest of the answer', () => {
    const c = createSentenceChunker({ minChunkChars: 12 });
    const emitted = [];
    emitted.push(...c.push('Yes.'));
    emitted.push(...c.push('Yes. The build is green and all tests pass.'));
    emitted.push(...c.push('Yes. The build is green and all tests pass. I also bumped the version.'));
    expect(emitted.join(' ')).toContain('The build is green');
    expect(emitted.length).toBeGreaterThan(0);
  });

  it('breaks a run-on sentence at maxChunkChars so speech can start', () => {
    const c = createSentenceChunker({ maxChunkChars: 60 });
    const runOn = 'first thing happened, then another thing happened, and then a third thing happened as well';
    const out = c.push(runOn);
    expect(out.length).toBeGreaterThan(0);
    expect(out[0].length).toBeLessThanOrEqual(60);
  });

  it('never splits inside a word', () => {
    const c = createSentenceChunker({ maxChunkChars: 40 });
    const text = 'supercalifragilistic expialidocious antidisestablishmentarianism words continue here';
    const out = c.push(text);
    for (const chunk of out) {
      expect(text).toContain(chunk);
      expect(chunk).not.toMatch(/^\s|\s$/);
    }
  });

  it('reset clears all state', () => {
    const c = createSentenceChunker();
    c.push('One thing done.');
    c.reset();
    expect(c.push('One thing done.')).toEqual(['One thing done.']);
  });

  it('tracks the spoken-form text emitted so far', () => {
    const c = createSentenceChunker();
    c.push('The build is green. More coming');
    expect(c.emittedText).toContain('The build is green.');
    expect(c.emittedText).not.toContain('More coming');
  });

  it('never speaks the body of a fence that has not closed yet', () => {
    // REGRESSION: an open fence does not match the strip regex, so its code
    // body read as prose and was spoken aloud before the fence ever closed.
    const c = createSentenceChunker();
    const spoken = [
      ...c.push('Answer here. ```\n'),
      ...c.push('Answer here. ```\nconst thing = require("x"). more code here.\n'),
    ].join(' ');
    expect(spoken).toContain('Answer here.');
    expect(spoken).not.toContain('require');
    expect(spoken).not.toContain('more code here');
  });

  it('is robust to an accumulated string that shrinks after stripping', () => {
    // REGRESSION: when the fence closed, the speakable string shrank. Rebasing
    // by CLAMPING to the new length put the cursor past real text, so every
    // sentence after the code block was silently dropped — no error, no audio.
    const c = createSentenceChunker();
    const all = [];
    all.push(...c.push('Answer here. ```\nlots and lots of code that looks like prose. more.\n'));
    all.push(...c.push('Answer here. ```\nlots and lots of code that looks like prose. more.\n``` Final word here.'));
    all.push(...c.flush());

    const joined = all.join(' ');
    expect(joined).not.toContain('lots and lots of code');
    expect(joined).toContain('Final word here.');
  });
});

describe('createSentenceChunker — realistic AGNT answer', () => {
  it('speaks the prose and announces the visuals', () => {
    const answer = [
      'I checked the repo and the build is green.',
      '',
      '```js',
      "const x = require('./thing');",
      '```',
      '',
      'Three tests were added. See [the PR](https://github.com/x/y) for details.',
    ].join('\n');

    const c = createSentenceChunker();
    const spoken = [...c.push(answer), ...c.flush()].join(' ');

    expect(spoken).toContain('the build is green');
    expect(spoken).toContain(VISUAL_SUBSTITUTIONS.codeBlock);
    expect(spoken).toContain('Three tests were added');
    expect(spoken).toContain('the PR');
    expect(spoken).not.toContain('require');
    expect(spoken).not.toContain('github.com');
  });
});
