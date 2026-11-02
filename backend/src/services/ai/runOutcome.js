/**
 * Did a team run succeed, and what does it report?
 *
 * A provider failure (quota, billing, an unknown model) does not throw: the adapter returns the error
 * notice as the reply, flagged recoveredFromError (LlmExecutionService). Read as success, a board card
 * posted "429 Your account is not active" as the agent's work and asked a person to approve it (bravo,
 * Nov 2026). Failed runs carry the reason in `error`, which the card shows as "I could not run: ...".
 */
export function teamRunOutcome(result) {
  const providerError = result?.recoveredFromError === true ? String(result.recoveredError || 'The model provider returned an error') : null;
  const failed = result?.success === false || Boolean(result?.error) || Boolean(providerError);
  return {
    status: failed ? 'failed' : 'completed',
    result: providerError && !result?.error ? { ...result, error: providerError } : result,
  };
}
