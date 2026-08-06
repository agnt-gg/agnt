import { describe, it, expect } from 'vitest';
import { sanitizeTranscript, isFillerOnly, meaningfulTranscript } from './asrArtifacts.js';

describe('sanitizeTranscript — whisper non-speech annotations', () => {
  it.each(['[BLANK_AUDIO]', '[blank_audio]', ' [BLANK_AUDIO] ', '[silence]', '[ Silence ]', '(coughs)', '*sighs*', '[Music]', '♪', '♪♪♪', '(upbeat music)'])(
    'an annotation-only transcript sanitises to nothing: %s',
    (t) => {
      expect(sanitizeTranscript(t)).toBe('');
    }
  );

  it('strips an annotation but keeps the speech around it', () => {
    expect(sanitizeTranscript('[BLANK_AUDIO] open the repo')).toBe('open the repo');
    expect(sanitizeTranscript('open the repo (coughs) please')).toBe('open the repo please');
  });

  it.each(['you', 'You.', 'Thank you.', 'thanks for watching', 'Bye.'])(
    'a whole-utterance hallucination sanitises to nothing: %s',
    (t) => {
      expect(sanitizeTranscript(t)).toBe('');
    }
  );

  it('the same words mid-sentence are real speech, not a hallucination', () => {
    expect(sanitizeTranscript('thank you for the fix')).toBe('thank you for the fix');
    expect(sanitizeTranscript('can you open it')).toBe('can you open it');
  });

  it('ordinary speech passes through untouched', () => {
    expect(sanitizeTranscript('open the auth file no wait the session one')).toBe(
      'open the auth file no wait the session one'
    );
  });

  it('is safe on empty and non-string input', () => {
    expect(sanitizeTranscript('')).toBe('');
    expect(sanitizeTranscript(null)).toBe('');
    expect(sanitizeTranscript(undefined)).toBe('');
  });
});

describe('isFillerOnly — a sound is not a turn', () => {
  /**
   * THE BUG THIS EXISTS FOR
   * -----------------------
   * The realtime session grants permission to start a turn on the VAD event
   * `input_audio_buffer.speech_started`, which fires before any word has been
   * transcribed. A cough bought a turn, came back transcribed as "um", and the
   * voice model — correctly instructed to forward EVERY utterance — delivered
   * it. Mid-run that arrived as a steer: real work interrupted to be told "um".
   */
  it.each([
    'um', 'Um.', 'umm', 'uh', 'Uh...', 'uhh', 'er', 'erm',
    'hmm', 'Hmm?', 'hm', 'mm', 'mmm', 'ah', 'Ahh', 'eh',
  ])('rejects the hesitation sound %s', (t) => {
    expect(isFillerOnly(t)).toBe(true);
  });

  it('rejects a string of them, which is what a noisy room produces', () => {
    expect(isFillerOnly('um uh')).toBe(true);
    expect(isFillerOnly('Um, uh...')).toBe(true);
    expect(isFillerOnly('hmm, hmm')).toBe(true);
  });
});

describe('isFillerOnly — WHAT MUST SURVIVE', () => {
  /**
   * The dangerous direction. Over-filtering is silent: the user speaks, nothing
   * happens, and there is no error to notice. These are the cases that make
   * this filter safe to have at all, so they are stated explicitly rather than
   * left to follow from the implementation.
   */
  it('keeps a real request that merely STARTS with a stumble', () => {
    expect(isFillerOnly('um, check the build')).toBe(false);
    expect(isFillerOnly('uh what did that test say')).toBe(false);
    expect(isFillerOnly('hmm, try it again')).toBe(false);
  });

  it.each(['hey', 'hi', 'hello', 'Hello.', 'thanks'])(
    'keeps the greeting %s — a complete turn the model is told to forward',
    (t) => {
      // buildInstructions is explicit: "EVERY single thing the user says goes
      // to run_agnt. Every one. Including \"hello\", \"thanks\"..." Filtering
      // these here would overrule that from two layers away.
      expect(isFillerOnly(t)).toBe(false);
    }
  );

  it.each(['stop', 'wait', 'no', 'Stop!', 'cancel'])(
    'keeps %s — the most important thing a user can say mid-run',
    (t) => {
      expect(isFillerOnly(t)).toBe(false);
    }
  );

  it.each(['huh', 'what', 'oh', 'ok', 'okay', 'yeah', 'yes'])(
    'keeps %s — short is not the same as meaningless',
    (t) => {
      expect(isFillerOnly(t)).toBe(false);
    }
  );

  it('an empty string is not this function\'s business', () => {
    // sanitizeTranscript owns empty. Returning true here would make
    // meaningfulTranscript\'s two branches disagree about who handles it.
    expect(isFillerOnly('')).toBe(false);
    expect(isFillerOnly(null)).toBe(false);
    expect(isFillerOnly('   ')).toBe(false);
  });
});

describe('meaningfulTranscript — the one question both engines ask', () => {
  /**
   * Two engines used to answer this separately: the cascade called
   * sanitizeTranscript and the realtime path called nothing at all, so the
   * same room noise was discarded on one and submitted as a turn on the other.
   */
  it('drops annotations, hallucinations and fillers alike', () => {
    expect(meaningfulTranscript('[BLANK_AUDIO]')).toBe('');
    expect(meaningfulTranscript('Thank you.')).toBe('');
    expect(meaningfulTranscript('um')).toBe('');
    expect(meaningfulTranscript('(coughs) uh')).toBe('');
  });

  it('returns real speech unchanged', () => {
    expect(meaningfulTranscript('um, restart the backend')).toBe('um, restart the backend');
    expect(meaningfulTranscript('open the auth file')).toBe('open the auth file');
    expect(meaningfulTranscript('hey')).toBe('hey');
  });

  it('is safe on junk input', () => {
    for (const junk of ['', null, undefined, '   ']) {
      expect(meaningfulTranscript(junk)).toBe('');
    }
  });
});
