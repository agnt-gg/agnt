/**
 * The hosted agent services, from the desktop's point of view.
 *
 * models.agnt.gg, search.agnt.gg, sandbox.agnt.gg, mail.agnt.gg and
 * webhooks.agnt.gg all take the same credential this backend already holds —
 * the user's api.agnt.gg session token — and all bill against the plan that
 * token belongs to. So there is exactly one way to call them, and it lives
 * here: base URL, auth header, idempotency key, plan gate, error shape.
 *
 * Every tool that talks to a service goes through `callService`. None of them
 * carry their own fetch, their own header, or their own idea of what a denial
 * looks like.
 *
 * PLAN GATE. The services are included with AGNT Pro and above; free gets a
 * `pro_required` refusal before any network call. The gate reads the same
 * entitlement the pairing gate does (planEntitlements), so it fails open the
 * same way and for the same reason: the SERVICE is the authority on whether
 * this account may run — it will answer 401/402/403 itself — and a desktop
 * that cannot reach the cloud to ask should not invent a denial.
 */
import { authHeader, getSessionToken } from './auth/sessionTokenCache.js';
import { hasFeature, isEnforcing } from './auth/planEntitlements.js';
import { planDenialMessageFor } from './auth/planDenial.js';
import crypto from 'crypto';

export const SERVICES = Object.freeze({
  models: { base: 'https://models.agnt.gg/models/v1', feature: 'models', docs: 'https://models.agnt.gg/docs.html' },
  search: { base: 'https://search.agnt.gg/search/v1', feature: 'search', docs: 'https://search.agnt.gg/docs.html' },
  sandbox: { base: 'https://sandbox.agnt.gg/sandbox/v1', feature: 'sandbox', docs: 'https://sandbox.agnt.gg/docs.html' },
  mail: { base: 'https://mail.agnt.gg/mail/v1', feature: 'mail', docs: 'https://mail.agnt.gg/docs.html' },
  webhooks: { base: 'https://webhooks.agnt.gg/hooks/v1', feature: 'hostedWebhooks', docs: 'https://webhooks.agnt.gg/docs.html' },
});

export class ServiceError extends Error {
  constructor(service, status, code, detail) {
    super(`${service}: ${code}`);
    this.service = service;
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

/** A refusal the UI can render as the Pro gate, with no network round trip. */
export function proRequired(service) {
  const s = SERVICES[service];
  return new ServiceError(service, 402, 'pro_required', {
    message: planDenialMessageFor(s.feature),
    docs: s.docs,
  });
}

/**
 * Is this install allowed to call `service` right now?
 * Fails open (see planEntitlements): only a confirmed `free` plan denies.
 */
export async function serviceAllowed(service) {
  const s = SERVICES[service];
  if (!s) throw new Error('unknown service: ' + service);
  // Shadow mode (gates not enforced) never denies locally; the service still
  // answers for itself. Enforced: a confirmed free plan is refused up front.
  if (!isEnforcing()) return true;
  return hasFeature(s.feature);
}

/**
 * One call to one service. Throws ServiceError on any non-2xx, with the
 * service's own error code preserved so the caller can show the right thing:
 * `pro_required` (no plan), `allowance_exhausted` / `spending_not_authorized`
 * (plan used up), `authentication_required` (no session yet).
 */
export async function callService(service, path, { method = 'GET', body, idempotent = false, timeoutMs = 60000, query } = {}) {
  const s = SERVICES[service];
  if (!s) throw new Error('unknown service: ' + service);
  if (!(await serviceAllowed(service))) throw proRequired(service);
  if (!getSessionToken()) throw new ServiceError(service, 401, 'authentication_required', { message: 'Sign in to AGNT to use ' + service + '.' });

  const headers = { ...authHeader(), Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (idempotent) headers['Idempotency-Key'] = 'agnt-' + crypto.randomUUID();

  const url = new URL(s.base + path);
  if (query) for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));

  let res;
  try {
    res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    throw new ServiceError(service, 0, 'unreachable', { message: error.message });
  }
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text.slice(0, 500) }; }
  if (!res.ok) {
    const code = data?.error || data?.reason || ('http_' + res.status);
    // The service says this account has no plan: render it as the Pro gate.
    const normalized = res.status === 402 || code === 'pro_required' || code === 'subscription_required' ? 'pro_required' : code;
    throw new ServiceError(service, res.status, normalized, { ...data, docs: s.docs });
  }
  return data;
}

/**
 * Sentences for the service codes a user can act on. Anything not listed falls
 * back to the code itself, which is still better than a bare status.
 */
const SERVICE_MESSAGES = {
  endpoint_limit: () => 'Your plan\'s webhook endpoints are all in use. Stop a webhook workflow you no longer need, or add endpoints from Settings > Billing.',
  inbox_limit_reached: () => 'Your plan\'s inboxes are all in use. Remove one, or add inboxes from Settings > Billing.',
  allowance_exhausted: (s) => `This month's included ${s} allowance is used up. It resets next month, or add credit from Settings > Billing.`,
  spending_not_authorized: (s) => `This ${s} call would cost beyond the included allowance and spending is off. Turn it on from Settings > Billing.`,
  authentication_required: () => 'Sign in to AGNT to use hosted services.',
  unreachable: (s) => `Could not reach ${s}.agnt.gg. Check your connection and try again.`,
};

/** Tool-friendly failure shape. Tools return this instead of throwing. */
export function serviceFailure(error) {
  if (error instanceof ServiceError) {
    // `error` is what a workflow node shows the user, so it carries the human
    // sentence when there is one; the machine code lives in `code`. A plan
    // refusal from the service (402) reads the same as a local one.
    const message = error.detail?.message || SERVICE_MESSAGES[error.code]?.(error.service)
      || (error.code === 'pro_required' ? `This is included with AGNT Pro. Upgrade at agnt.gg/pricing to use ${error.service}.` : null);
    return { success: false, error: message || error.code, code: error.code, service: error.service, status: error.status, ...(message ? { message } : {}), ...(error.detail?.docs ? { docs: error.detail.docs } : {}) };
  }
  return { success: false, error: error?.message || String(error) };
}
