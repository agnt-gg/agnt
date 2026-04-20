// Gamma API — public market/event/tag/search endpoints.
// Docs: https://docs.polymarket.com/api-reference/introduction (Gamma section)

import { GAMMA_BASE } from './endpoints.js';
import { getJSON, qs } from './http.js';

/**
 * Search across markets, events, and profiles.
 * Note: Gamma's `/public-search` returns an `events` array; the matching
 * markets are nested *inside* each event under `event.markets[]`. We flatten
 * them here so callers always get a top-level `markets` array as well.
 *
 * https://docs.polymarket.com/api-reference/search/search-markets-events-and-profiles
 */
export async function searchMarkets({ query, tagSlug, active = 'true', closed = 'false', limit = 20, offset = 0 }) {
  const params = {
    q: query,
    limit_per_type: limit,
    events_status: active === 'true' ? 'active' : (closed === 'true' ? 'resolved' : undefined),
  };
  if (tagSlug) params.tag = tagSlug;

  const url = `${GAMMA_BASE}/public-search${qs(params)}`;
  const data = await getJSON(url);

  const events  = Array.isArray(data?.events)   ? data.events   : [];
  const profiles = Array.isArray(data?.profiles) ? data.profiles : [];

  // Flatten the nested markets out of events so consumers see them at the top level
  const markets = [];
  for (const ev of events) {
    if (Array.isArray(ev.markets)) {
      for (const m of ev.markets) {
        markets.push({
          ...m,
          eventId:    ev.id,
          eventSlug:  ev.slug,
          eventTitle: ev.title,
          // Some markets have these on the event level only
          volume24hr: m.volume24hr ?? ev.volume24hr ?? 0,
        });
      }
    }
  }

  return { events, markets, profiles };
}

/**
 * Fetch a market by numeric ID, slug, or CLOB token ID.
 * Auto-detects the kind of identifier supplied.
 */
export async function getMarket(identifier) {
  if (!identifier) throw new Error('marketId is required');

  const id = String(identifier).trim();

  // Numeric → /markets/{id}
  if (/^\d+$/.test(id) && id.length < 18) {
    return await getJSON(`${GAMMA_BASE}/markets/${id}`);
  }

  // Long numeric (token ID) → /markets/by-token/{tokenId}
  if (/^\d+$/.test(id) && id.length >= 18) {
    return await getJSON(`${GAMMA_BASE}/markets/by-token/${id}`);
  }

  // Otherwise treat as slug
  const list = await getJSON(`${GAMMA_BASE}/markets${qs({ slug: id, limit: 1 })}`);
  if (Array.isArray(list) && list.length > 0) return list[0];
  if (list && list.id) return list;
  throw new Error(`Market not found for identifier: ${id}`);
}

/**
 * Fetch an event by numeric ID or slug.
 */
export async function getEvent(identifier) {
  if (!identifier) throw new Error('eventId is required');
  const id = String(identifier).trim();

  if (/^\d+$/.test(id)) {
    return await getJSON(`${GAMMA_BASE}/events/${id}`);
  }
  // Slug lookup
  return await getJSON(`${GAMMA_BASE}/events/slug/${encodeURIComponent(id)}`);
}

/**
 * List/filter markets for trending discovery.
 * https://docs.polymarket.com/api-reference/markets/list-markets
 */
export async function listTrending({ tagSlug, active = 'true', closed = 'false', orderBy = 'volume24hr', limit = 20, offset = 0 }) {
  const params = {
    limit,
    offset,
    order: orderBy,
    ascending: 'false',
  };
  if (tagSlug) params.tag_slug = tagSlug;
  if (active !== 'any') params.active = active;
  if (closed !== 'any') params.closed = closed;

  const url = `${GAMMA_BASE}/markets${qs(params)}`;
  const data = await getJSON(url);
  return Array.isArray(data) ? data : (data?.data || []);
}
