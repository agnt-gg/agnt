/**
 * Publishing a plugin: what the person sees when it cannot be published.
 *
 * The marketplace refuses a plugin whose sign-ins nobody else could connect
 * (validate-core checkPluginSignIns, run again at publish). Asking the local
 * backend first means the person learns why before uploading, in the same
 * words the marketplace would use.
 */

/** "error" plus every detail line, so a refusal names its reasons. */
export function publishFailureMessage(body, fallback = 'Publishing failed') {
  const headline = (body && typeof body.error === 'string' && body.error) || fallback;
  const details = Array.isArray(body?.details) ? body.details.filter((line) => typeof line === 'string' && line.trim()) : [];
  return details.length ? `${headline}:\n\n${details.map((line) => `• ${line}`).join('\n')}` : headline;
}

/**
 * Ask the local backend whether this package's sign-ins can be published.
 * Throws an Error that says what to fix when they cannot. When the local
 * check itself is unavailable, it stays out of the way: the marketplace runs
 * the same check and has the last word.
 *
 * @param {{ baseUrl: string, token: string, packageBase64: string, fetchImpl?: typeof fetch }} input
 */
export async function assertSignInsPublishable({ baseUrl, token, packageBase64, fetchImpl = fetch }) {
  let body;
  try {
    const response = await fetchImpl(`${baseUrl}/plugins/install-file/check-auth`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileData: packageBase64 }),
    });
    if (!response.ok) return;
    body = await response.json();
  } catch {
    return;
  }
  if (body?.publishable !== false) return;
  const reasons = [...(body.signInErrors || []), ...(body.signInPublishErrors || [])];
  throw new Error(publishFailureMessage({ error: 'This plugin can’t be published yet', details: reasons }));
}
