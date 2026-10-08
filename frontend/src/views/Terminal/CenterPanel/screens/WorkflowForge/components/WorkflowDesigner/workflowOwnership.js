/**
 * Does the signed-in caller own this loaded workflow?
 *
 * The server decides: it already authorized the read against its own idea of
 * the caller, which on a team instance is the workspace's storage principal
 * (`scope:…`), not the person's account id. Comparing `user_id` to the token's
 * id is only a fallback for a backend too old to send `is_owner`.
 */
export function isWorkflowOwner(data, tokenUserId) {
  if (typeof data?.is_owner === 'boolean') return data.is_owner;
  return Boolean(tokenUserId) && data?.user_id === tokenUserId;
}
