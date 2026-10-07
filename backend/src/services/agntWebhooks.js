/**
 * The desktop's inbound endpoints on webhooks.agnt.gg.
 *
 * One hosted endpoint per workflow that has a Webhook Listener trigger. The
 * endpoint's public URL (https://webhooks.agnt.gg/in/<slug>) is what the
 * trigger shows and what the outside world posts to. Events are stored on the
 * service before they are acknowledged; the desktop pulls them.
 *
 * The local `webhooks` table keeps { workflow_id → endpoint id, url, last
 * received_at } so a restart resumes where it left off and no event is
 * delivered twice.
 */
import { callService } from './agntServices.js';

/** Create the hosted endpoint for a workflow. Name is informational on the service. */
export async function createEndpoint(workflowId, name) {
  const wanted = name || endpointName(workflowId);
  // The endpoint is named for the workflow, so the service is the record of
  // truth: if one already exists (local row lost, app reinstalled, restart
  // before the row was written) adopt it rather than minting a duplicate that
  // eats the plan's endpoint allowance.
  const existing = await findEndpointByName(wanted);
  const endpoint = existing || (await callService('webhooks', '/endpoints', { method: 'POST', idempotent: true, body: { name: wanted } }));
  return untilActive({ id: endpoint.id, slug: endpoint.slug, url: endpoint.url, state: endpoint.state });
}

// A new endpoint is `provisioning` for a few seconds, and its public URL
// answers 404 until it is `active` (measured: ~3s). Handing the URL out before
// then means a sender that fires at once loses its event.
const ACTIVATION_TIMEOUT_MS = 20_000;
const ACTIVATION_POLL_MS = 500;

async function untilActive(endpoint, { timeoutMs = ACTIVATION_TIMEOUT_MS, pollMs = ACTIVATION_POLL_MS } = {}) {
  const deadline = Date.now() + timeoutMs;
  let current = endpoint;
  while (current.state === 'provisioning' && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, pollMs));
    const list = await callService('webhooks', '/endpoints');
    const hit = (list.endpoints || []).find((e) => e.id === endpoint.id);
    if (hit) current = { ...current, state: hit.state };
  }
  // Still provisioning past the deadline: return it anyway. Events cannot
  // arrive before it is active, and the poll reads it fine meanwhile.
  if (current.state === 'provisioning') console.warn(`agntWebhooks: endpoint ${endpoint.slug} still provisioning after ${timeoutMs}ms`);
  return current;
}

async function findEndpointByName(name) {
  const list = await callService('webhooks', '/endpoints');
  // Provisioning counts: a crash between create and activation must adopt it,
  // not mint a second one.
  const hit = (list.endpoints || []).find((e) => e.name === name && (e.state === 'active' || e.state === 'provisioning'));
  return hit ? { id: hit.id, slug: hit.slug, url: hit.url, state: hit.state } : null;
}

/** The service-side name of a workflow's endpoint; the only link between the two. */
export function endpointName(workflowId) {
  return 'workflow-' + String(workflowId).slice(0, 8);
}

/**
 * Retire EVERY live endpoint for a workflow, not only the one the local row
 * recorded. Two overlapping registrations used to mint two endpoints; the row
 * kept one, deleting the workflow retired that one, and the other stayed
 * active: it answered senders 202 "stored" and nothing ever read it
 * (measured on charlie 2026-10-07, endpoint drnellw5nkr6). Returns how many
 * were retired.
 */
export async function retireEndpointsFor(workflowId, knownEndpointId = null) {
  const name = endpointName(workflowId);
  const list = await callService('webhooks', '/endpoints');
  const ids = new Set((list.endpoints || [])
    .filter((e) => e.name === name && (e.state === 'active' || e.state === 'provisioning'))
    .map((e) => e.id));
  if (knownEndpointId) ids.add(knownEndpointId);
  for (const id of ids) await retireEndpoint(id);
  return ids.size;
}

export async function retireEndpoint(endpointId) {
  try {
    await callService('webhooks', `/endpoints/${endpointId}`, { method: 'DELETE' });
  } catch (error) {
    // Already gone is fine; anything else surfaces.
    if (error.status !== 404) throw error;
  }
}

/**
 * Stored events received strictly after `since` (epoch ms), oldest first, WITH bodies.
 *
 * The service filters on `after` and ignores any other parameter name — asking
 * with `since` returned the whole retention window on every poll, and each
 * stored event re-triggered its workflow every ten seconds. The cursor is also
 * enforced here, so a service that stops filtering degrades to extra reads,
 * never to re-delivery. Filtering before the detail fetch keeps it to one
 * request per genuinely new event.
 */
export async function pullEvents(endpointId, since, limit = 50) {
  const cursor = Number(since) || 0;
  const list = await callService('webhooks', `/endpoints/${endpointId}/events`, { query: { after: cursor, limit } });
  const events = (list.events || []).filter((e) => (e.received_at ?? e.receivedAt ?? 0) > cursor);
  const full = [];
  for (const e of events) {
    // The list omits bodies; each event is fetched for its payload.
    const detail = await callService('webhooks', `/events/${e.id}`);
    full.push(detail);
  }
  return full;
}

/** `a=1&t=x&t=y` -> { a: '1', t: ['x', 'y'] }, the shape Express gave workflows on the relay. */
function parseQuery(raw) {
  const out = {};
  for (const [key, value] of new URLSearchParams(raw || '')) {
    if (!(key in out)) out[key] = value;
    else out[key] = [].concat(out[key], value);
  }
  return out;
}

function lowerCaseKeys(headers) {
  const out = {};
  if (headers && typeof headers === 'object') for (const [k, v] of Object.entries(headers)) out[k.toLowerCase()] = v;
  return out;
}

/**
 * The body as workflows received it on the relay: parsed JSON or form as an
 * object, anything else (text, arrays, unparseable JSON) as `{ data }`, and `{}`
 * for a bodyless request.
 */
function normaliseBody(raw, contentType) {
  if (raw == null || raw === '') return {};
  let parsed = raw;
  if (typeof raw === 'string') {
    if (/json/i.test(contentType || '')) {
      try { parsed = JSON.parse(raw); } catch { parsed = raw; }
    } else if (/x-www-form-urlencoded/i.test(contentType || '')) {
      parsed = parseQuery(raw);
    }
  }
  return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : { data: parsed };
}

/**
 * A stored hosted event as the trigger payload workflows expect: the real
 * method, query and headers the sender used, so the node's method filter, header
 * auth and `{{webhook.query}}` behave as they did on the relay. Events stored
 * before the service kept the request envelope read as the bare POST they were.
 */
export function eventToTrigger(event) {
  return {
    id: event.id,
    receivedAt: event.receivedAt,
    contentType: event.contentType,
    method: String(event.method || 'POST').toUpperCase(),
    headers: lowerCaseKeys(event.headers),
    query: parseQuery(event.query),
    body: normaliseBody(event.body, event.contentType),
    source: event.source,
  };
}
