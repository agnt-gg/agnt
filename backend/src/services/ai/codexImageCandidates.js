/** Central experimental candidates, NOT an authoritative Codex model catalog.
 * API release names are used as requested selectors; Codex may ignore them.
 * No generic latest alias is documented for the subscription route. Updating
 * this versioned profile is necessary until account-scoped discovery exists.
 */
export const CODEX_IMAGE_CANDIDATES = Object.freeze({
  'latest': 'gpt-image-2.5-sunburst',
  'latest-fast': 'gpt-image-2.5-flare',
});
export const CODEX_IMAGE_CANDIDATE_PROFILE = '2026-09-09-api-release-experiment';
export function codexImageRequestSelection(model = 'provider-default') {
  if (model === 'provider-default') return Object.freeze({requestedModel:model,resolvedModel:null,selectionMode:'provider-selected'});
  if (!Object.hasOwn(CODEX_IMAGE_CANDIDATES, model)) throw new Error('Unsupported Codex image selection. Choose latest, latest-fast (experimental requests), or provider-default explicitly.');
  return Object.freeze({requestedModel:model,resolvedModel:CODEX_IMAGE_CANDIDATES[model],selectionMode:'experimental-request'});
}
