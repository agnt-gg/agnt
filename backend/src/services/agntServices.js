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
export async function callService(service, path, { method = 'GET', body, idempotent = false, timeoutMs = 60000, query, retries = 4 } = {}) {
  const s = SERVICES[service];
  if (!s) throw new Error('unknown service: ' + service);
  if (!(await serviceAllowed(service))) throw proRequired(service);
  if (!getSessionToken()) throw new ServiceError(service, 401, 'authentication_required', { message: 'Sign in to AGNT to use ' + service + '.' });

  const headers = { ...authHeader(), Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  // ONE key for the whole call, reused by every retry. A retry that minted a
  // fresh key would be a second billable operation rather than a retry — the
  // exact way a "harmless" backoff double-charges someone.
  if (idempotent) headers['Idempotency-Key'] = 'agnt-' + crypto.randomUUID();

  const url = new URL(s.base + path);
  if (query) for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));

  return withLane(service, async () => {
  let attempt = 0;
  for (;;) {
    let res;
    try {
      res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      if (attempt < retries && error.name !== 'TimeoutError') {
        await sleep(backoffMs(attempt++, null));
        continue;
      }
      throw new ServiceError(service, 0, 'unreachable', { message: error.message });
    }
    const text = await res.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text.slice(0, 500) }; }
    if (res.ok) return data;

    const code = data?.error || data?.reason || ('http_' + res.status);
    // The services run a small pool: one concurrent scrape on most plans, and
    // a burst of parallel calls is ORDINARY here (the orchestrator fans out
    // several scrapes per turn). Waiting our turn is the correct behaviour;
    // surfacing "service_busy" to the user for a queue that clears in a second
    // is not. Deterministic refusals — blocked page, no plan, bad input — are
    // never retried, because the answer will not change.
    if (RETRYABLE.has(code) && attempt < retries) {
      await sleep(backoffMs(attempt++, res.headers.get('retry-after')));
      continue;
    }
    // The service says this account has no plan: render it as the Pro gate.
    const normalized = res.status === 402 || code === 'pro_required' || code === 'subscription_required' ? 'pro_required' : code;
    throw new ServiceError(service, res.status, normalized, { ...data, docs: s.docs, attempts: attempt + 1 });
  }
  });
}

/** Test seam: how many calls are queued or running for a service. */
export function laneDepth(service) {
  const l = lanes.get(service);
  return l ? { active: l.active, queued: l.queue.length, limit: l.limit } : { active: 0, queued: 0, limit: CONCURRENCY[service] ?? 2 };
}

/**
 * In-flight limit per service, client side.
 *
 * The services run a small execution pool and refuse the overflow rather than
 * queueing it — search is one concurrent scrape on most plans. The orchestrator
 * routinely fans out several scrapes in a turn, so without a gate here the
 * first one wins and the rest 429. Retrying alone does not fix that: the
 * retries collide with each other too. Queueing locally means every call still
 * happens, just in order, and the retry below is left to handle genuine
 * contention from ANOTHER process sharing the account.
 */
const CONCURRENCY = { search: 1, models: 2, sandbox: 2, mail: 4, webhooks: 4 };
const lanes = new Map();

function lane(service) {
  if (!lanes.has(service)) lanes.set(service, { active: 0, queue: [], limit: CONCURRENCY[service] ?? 2 });
  return lanes.get(service);
}

async function withLane(service, run) {
  const l = lane(service);
  if (l.active >= l.limit) await new Promise((resolve) => l.queue.push(resolve));
  l.active++;
  try {
    return await run();
  } finally {
    l.active--;
    const next = l.queue.shift();
    if (next) next();
  }
}

/** Codes whose answer can change if we simply wait. */
const RETRYABLE = new Set(['service_busy', 'rate_limited', 'busy', 'worker_unavailable', 'service_unavailable', 'concurrency_limit', 'try_again_later']);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Honour Retry-After when sent; otherwise exponential with jitter, capped. */
function backoffMs(attempt, retryAfter) {
  const header = Number(retryAfter);
  if (Number.isFinite(header) && header > 0) return Math.min(header * 1000, 15000);
  return Math.min(700 * 2 ** attempt, 8000) + Math.floor(Math.random() * 400);
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
  page_blocked: () => 'That site refuses automated visitors, so it cannot be scraped. Reddit, X and some news sites do this. Try an alternate host for the same content (for Reddit, append .json to the URL), or open it yourself.',
  service_busy: (s) => `The ${s} service stayed busy after several retries. Try again in a moment.`,
  destination_not_allowed: () => 'That address cannot be fetched: it is private, local, or not a public web page.',
  invalid_url: () => 'That does not look like a public http(s) URL.',
  extraction_failed: () => 'The page loaded but no readable content could be extracted from it.',
  // The service throttles repeated FAILURES, so a run of blocked sites puts the
  // account in a short cooldown. Retrying inside it only deepens the hole.
  failure_rate_limited: () => 'Too many pages failed recently, so scraping is cooling down for a minute. The last few URLs were probably blocked or unreachable.',
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
