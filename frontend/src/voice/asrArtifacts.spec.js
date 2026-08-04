import { describe, it, expect } from 'vitest';
import { sanitizeTranscript } from './asrArtifacts.js';

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
