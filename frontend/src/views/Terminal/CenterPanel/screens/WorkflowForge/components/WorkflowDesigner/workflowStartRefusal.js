/**
 * Why the server would not start a workflow, in words a person can act on.
 * The server's own explanation wins over its short error label; `planLimit`
 * marks a refusal that a plan upgrade lifts.
 */
export function startRefusal(status, body) {
  const data = body && typeof body === 'object' ? body : {};
  const planLimit = data.code === 'PLAN_LIMIT' || Boolean(data.requiredFeature);
  const explained = [data.message, data.error].find((text) => typeof text === 'string' && text.trim());
  const message = explained ? explained.trim() : `The workflow could not start (HTTP ${status}).`;
  return { message, planLimit };
}
