/**
 * The name a model is shown by on the composer's model pill.
 *
 * AGNT's own models get their product name: "agnt-flash" is the id the
 * provider API uses, but on a new account's first screen it read as jargon in
 * the one place every person looks. Every other model keeps its id, which is
 * what its provider calls it and what people search for.
 */
const OWN_MODEL_NAMES = Object.freeze({ 'agnt-flash': 'AGNT Flash' });

export function modelDisplayLabel(modelId) {
  const raw = typeof modelId === 'string' ? modelId : '';
  return OWN_MODEL_NAMES[raw.trim().toLowerCase()] || raw;
}
