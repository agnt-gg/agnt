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
  const wanted = name || 'workflow-' + String(workflowId).slice(0, 8);
  // The endpoint is named for the workflow, so the service is the record of
  // truth: if one already exists (local row lost, app reinstalled, restart
  // before the row was written) adopt it rather than minting a duplicate that
  // eats the plan's endpoint allowance.
  const existing = await findEndpointByName(wanted);
  if (existing) return existing;
  const endpoint = await callService('webhooks', '/endpoints', { method: 'POST', idempotent: true, body: { name: wanted } });
  return { id: endpoint.id, slug: endpoint.slug, url: endpoint.url, state: endpoint.state };
}

async function findEndpointByName(name) {
  const list = await callService('webhooks', '/endpoints');
  const hit = (list.endpoints || []).find((e) => e.name === name && e.state === 'active');
  return hit ? { id: hit.id, slug: hit.slug, url: hit.url, state: hit.state } : null;
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
