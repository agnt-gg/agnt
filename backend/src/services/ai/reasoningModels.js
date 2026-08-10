/**
 * Anthropic reasoning-capability detection.
 *
 * The regexes themselves now live in the SHARED DESCRIPTOR
 * (./descriptor/reasoningPredicates.js), which is isomorphic and imported by
 * the Vue frontend through a Vite alias as well as by this backend.
 *
 * This module remains as the stable import path its existing consumers already
 * use. It previously carried the note "the frontend has a mirrored copy in
 * frontend/src/store/app/aiProvider.js — they must stay in sync", which was a
 * maintenance instruction standing in for a shared module. There is now a
 * shared module, so there is nothing left to keep in sync.
 *
 * isOpenRouterAnthropicReasoningModel used to be exported here too. It had ZERO
 * importers and was NOT equivalent to the live definition (which also
 * recognises claude-3.7 and the whole opus-4.x line when routed through
 * OpenRouter). Deleted rather than "unified", since unifying would have
 * silently narrowed live behaviour — the descriptor keeps the broader one.
 */

export {
  isAnthropicReasoningModel,
  anthropicSupportsXHigh,
  ANTHROPIC_VERSIONED_REASONING_RE,
  ANTHROPIC_FAMILY_REASONING_RE,
  ANTHROPIC_XHIGH_RE,
} from './descriptor/reasoningPredicates.js';
