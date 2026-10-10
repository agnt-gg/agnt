import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const MAX_MESSAGE_LENGTH = 1600;

// Gateway refusal codes (normalised by mobileOutbound.textUser) → what the user should do.
const REASONS = Object.freeze({
  no_phone: 'No phone is linked. Link one in Settings → Text Annie.',
  allowance_exhausted: "This month's texts are used up, so nothing was sent.",
  not_subscribed: 'Texting needs AGNT Pro.',
  signed_out: 'Not signed in to AGNT.',
  queue_unconfirmed: 'The text gateway did not confirm the message; delivery is unknown.',
});

const result = (sent, messageId, error) => ({ sent, messageId, error });

// The plugin reuses AGNT's own texting pipeline rather than reimplementing
// it, so billing, STOP handling and phone routing stay in one place.
async function loadBackend(appPath) {
  const load = (relative) => import(pathToFileURL(path.join(appPath, relative)).href);
  const [outbound, sessionCache] = await Promise.all([
    load('backend/src/services/mobileOutbound.js'),
    load('backend/src/services/auth/sessionTokenCache.js'),
  ]);
  return { textUser: outbound.textUser, getSessionUserId: sessionCache.getSessionUserId };
}

export class TextMe {
  constructor({ loadBackendImpl = loadBackend, env = process.env, newKey = randomUUID } = {}) {
    this.name = 'text-me';
    this.loadBackendImpl = loadBackendImpl;
    this.env = env;
    this.newKey = newKey;
  }

  async execute(params, inputData, workflowEngine) {
    const message = typeof params?.message === 'string' ? params.message.trim() : '';
    if (!message) return result(false, null, 'message is required');
    if (message.length > MAX_MESSAGE_LENGTH) return result(false, null, `message must be ${MAX_MESSAGE_LENGTH} characters or fewer`);
    if (!this.env.APP_PATH) return result(false, null, 'APP_PATH is not set; the plugin cannot reach AGNT');

    try {
      const backend = await this.loadBackendImpl(this.env.APP_PATH);
      // The text goes to the SIGNED-IN owner's phone. A workflow run by anyone
      // else (a teammate, a shared workflow) must not be able to text it.
      const ownerId = backend.getSessionUserId();
      const callerId = workflowEngine?.userId ?? workflowEngine?.user_id ?? null;
      if (!ownerId) return result(false, null, REASONS.signed_out);
      if (callerId && String(callerId) !== String(ownerId)) {
        return result(false, null, 'Only the signed-in account owner can text their phone.');
      }

      // One key per execution: a network retry inside textUser is one text,
      // a later run of the workflow is a new one.
      const outcome = await backend.textUser({ text: message, key: `text-me-${this.newKey()}` });
      if (outcome.sent) return result(true, outcome.id, null);
      return result(false, null, REASONS[outcome.reason] || `The text was not sent (${outcome.reason}).`);
    } catch (error) {
      console.error('[text-me] failed:', error);
      return result(false, null, `The text was not sent: ${error.message}`);
    }
  }
}

export default new TextMe();
