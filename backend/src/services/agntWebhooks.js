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

/** Stored events after `since` (epoch ms), oldest first, WITH bodies. */
export async function pullEvents(endpointId, since, limit = 50) {
  const list = await callService('webhooks', `/endpoints/${endpointId}/events`, { query: { since, limit } });
  const events = list.events || [];
  const full = [];
  for (const e of events) {
    // The list omits bodies; each event is fetched for its payload.
    const detail = await callService('webhooks', `/events/${e.id}`);
    full.push(detail);
  }
  return full;
}

/** Parse an event body by its content type into the shape workflows expect. */
export function eventToTrigger(event) {
  let body = event.body;
  if (typeof body === 'string' && /json/i.test(event.contentType || '')) {
    try { body = JSON.parse(body); } catch { /* leave as text */ }
  }
  return {
    id: event.id,
    receivedAt: event.receivedAt,
    contentType: event.contentType,
    headers: event.headers || {},
    body,
    method: 'POST',
    source: event.source,
  };
}
