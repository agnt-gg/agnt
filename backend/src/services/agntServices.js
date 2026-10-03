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

/** This process's hosted-instance slug, or null on a desktop install. */
export function hostedInstanceSlug() {
  const slug = process.env.AGNT_TENANT_SLUG;
  return slug && /^[a-z0-9-]{1,40}$/.test(slug) ? slug : null;
}

export class ServiceError extends Error {
  constructor(service, status, code, detail) {
    super(`${service}: ${code}`);
    this.service = service;
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

/**
 * THE SERVICES' CLOCK. Read cursors compare against timestamps the service
 * assigned (an event's receivedAt, a message's createdAt). Seeding a cursor
 * with this machine's Date.now() mixes clocks: a desktop running even 100ms
 * fast skipped events posted the moment its workflow started, and one running
 * minutes fast would skip minutes of them. Every response's Date header gives
 * the offset; serverNow() is that clock, biased early so it is never ahead of
 * the service (an early cursor re-reads nothing that was delivered, because
 * nothing is delivered before a workflow listens).
 */
let serverClockOffsetMs = null;
const UNKNOWN_CLOCK_MARGIN_MS = 60_000;

function noteServerClock(res) {
  const stamped = Date.parse(res?.headers?.get?.('date') || '');
  if (Number.isFinite(stamped)) serverClockOffsetMs = stamped - Date.now();
}

export function serverNow() {
  // The Date header is truncated to the second, so the estimate already trails
  // the service; one more second covers network latency.
  return serverClockOffsetMs === null ? Date.now() - UNKNOWN_CLOCK_MARGIN_MS : Date.now() + serverClockOffsetMs - 1000;
}

export function __resetServerClockForTests() {
  serverClockOffsetMs = null;
}

/**
 * Connection failures that prove the request never reached the service.
 * A reset or a timeout is NOT here: the service may already have acted on it.
 */
const NEVER_CONNECTED = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH', 'UND_ERR_CONNECT_TIMEOUT']);

/**
 * True only when `error` proves the service never received the request: the
 * connection itself could not be made. The one condition under which sending
 * the same work elsewhere cannot do it twice. A 502 does not qualify: nginx
 * also answers 502 when the upstream drops the connection after reading it.
 */
export function neverReached(error) {
  if (!(error instanceof ServiceError)) return false;
  return error.status === 0 && !error.detail?.timedOut && NEVER_CONNECTED.has(error.detail?.causeCode);
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
/**
 * `planGate: false` skips the local Pro gate for calls a free account is entitled
 * to make: its own AGNT Flash trial balance and buying prepaid credit. The service
 * still authenticates and decides; only the local pre-emptive denial is skipped.
 */
export async function callService(service, path, { method = 'GET', body, idempotent = false, timeoutMs = 60000, query, retries = 12, planGate = true } = {}) {
  const s = SERVICES[service];
  if (!s) throw new Error('unknown service: ' + service);
  if (planGate && !(await serviceAllowed(service))) throw proRequired(service);
  if (!getSessionToken()) throw new ServiceError(service, 401, 'authentication_required', { message: 'Sign in to AGNT to use ' + service + '.' });

  const headers = { ...authHeader(), Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  // ONE key for the whole call, reused by every retry. A retry that minted a
  // fresh key would be a second billable operation rather than a retry — the
  // exact way a "harmless" backoff double-charges someone.
  if (idempotent) headers['Idempotency-Key'] = 'agnt-' + crypto.randomUUID();
  // A hosted instance and its owner's desktop are the same account, so the
  // service cannot otherwise tell whose read a pull is. It records how far
  // each INSTANCE has read, and the fleet wakes a sleeping instance only for
  // events newer than that. A desktop sends nothing and is never counted.
  const instance = hostedInstanceSlug();
  if (instance) headers['X-AGNT-Instance'] = instance;

  const url = new URL(s.base + path);
  if (query) for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));

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
      // The cause code is kept so a caller can tell "never connected" (safe to
      // try elsewhere) from "connection dropped after sending" (it may have
      // been accepted). See neverReached().
      throw new ServiceError(service, 0, 'unreachable', { message: error.message, causeCode: error.cause?.code || error.code || null, timedOut: error.name === 'TimeoutError' });
    }
    noteServerClock(res);
    const text = await res.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text.slice(0, 500) }; }
    if (res.ok) return data;

    const code = data?.error || data?.reason || ('http_' + res.status);
    // "Busy" is the service's execution pool being full, not a refusal. The
    // caller may fan out as wide as it likes — a hundred searches at once is a
    // legitimate way to spend an allowance — so a call that finds the pool
    // full waits and tries again until it gets its turn. NOTHING here caps
    // parallelism: the plan's allowance is the only limit, and burning all of
    // it in one go is the user's call to make.
    //
    // Deterministic refusals — no plan, bad input — are never retried,
    // because the answer will not change.
    if (RETRYABLE.has(code) && attempt < retries) {
      await sleep(backoffMs(attempt++, res.headers.get('retry-after')));
      continue;
    }
    // The service says this account has no plan: render it as the Pro gate.
    const normalized = res.status === 402 || code === 'pro_required' || code === 'subscription_required' ? 'pro_required' : code;
    throw new ServiceError(service, res.status, normalized, { ...data, docs: s.docs, attempts: attempt + 1 });
  }
}

/** Codes whose answer can change if we simply wait. */
const RETRYABLE = new Set(['service_busy', 'rate_limited', 'busy', 'service_unavailable', 'concurrency_limit', 'try_again_later']);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Honour Retry-After when sent; otherwise exponential with jitter, capped.
 *
 * The jitter is what makes a wide fan-out work: without it, every waiting call
 * wakes on the same tick and collides again. Spread across a window that grows
 * with the attempt, a large burst drains steadily instead of thrashing.
 */
function backoffMs(attempt, retryAfter) {
  const header = Number(retryAfter);
  if (Number.isFinite(header) && header > 0) return Math.min(header * 1000, 15000);
  const base = Math.min(500 * 2 ** attempt, 6000);
  return base + Math.floor(Math.random() * base);
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
  service_busy: (s) => `The ${s} service stayed busy after several retries. Try again in a moment.`,
  // The service throttles repeated FAILURES, so a run of failed calls puts the
  // account in a short cooldown. Retrying inside it only deepens the hole.
  failure_rate_limited: (s) => `Too many ${s} requests failed recently, so ${s} is cooling down for a few minutes. Try again shortly.`,
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
