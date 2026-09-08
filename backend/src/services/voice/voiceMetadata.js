/** Bound voice provenance on both persistence and hydration. Never infer verbatim
 * status from missing/unknown provenance. Other features retain their metadata.
 */
export function normalizeVoiceMetadata(metadata) {
  if (!Array.isArray(metadata)) return [];
  let voiceEntries = 0;
  return metadata.flatMap(entry => {
    if (entry?.type !== 'voice-input') return [entry];
    if (++voiceEntries > 8) return [];
    const text = (value, max) => typeof value === 'string' ? value.slice(0, max) : null;
    return [{
      type: 'voice-input',
      kind: ['native-final', 'correlated-delegation', 'local-asr-hard-final'].includes(entry.kind) ? entry.kind : 'unknown',
      utteranceId: text(entry.utteranceId, 256) || '',
      observedTranscript: text(entry.observedTranscript, 16384),
      delegatedInterpretation: text(entry.delegatedInterpretation, 16384),
    }];
  });
}
