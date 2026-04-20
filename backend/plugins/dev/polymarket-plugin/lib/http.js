// Tiny fetch wrapper with sensible error handling for Polymarket APIs.
// All Polymarket APIs return JSON; some return arrays at the top level.

/**
 * GET request → JSON.
 * @param {string} url
 * @param {object} [headers]
 * @returns {Promise<any>}
 */
export async function getJSON(url, headers = {}) {
  const res = await fetch(url, {
    method: 'GET',
    headers: { 'Accept': 'application/json', ...headers },
  });
  return parseResponse(res, url);
}

/**
 * POST request → JSON.
 * @param {string} url
 * @param {object} body
 * @param {object} [headers]
 * @returns {Promise<any>}
 */
export async function postJSON(url, body, headers = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });
  return parseResponse(res, url);
}

/**
 * DELETE request → JSON.
 */
export async function deleteJSON(url, body, headers = {}) {
  const res = await fetch(url, {
    method: 'DELETE',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return parseResponse(res, url);
}

async function parseResponse(res, url) {
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!res.ok) {
    const msg = (data && (data.error || data.message)) || text || res.statusText;
    const err = new Error(`Polymarket ${res.status} ${url.split('?')[0].split('/').slice(-2).join('/')}: ${msg}`);
    err.status = res.status;
    err.body = data;
    if (res.status === 451 || res.status === 403) {
      err.message += ' — Polymarket geoblocks US IPs and certain regions. See https://docs.polymarket.com/api-reference/geoblock';
    }
    throw err;
  }
  return data;
}

/**
 * Convert an object of params to a query string, omitting empty values.
 * Arrays are repeated (?a=1&a=2).
 */
export function qs(params = {}) {
  const parts = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '' || v === 'any') continue;
    if (Array.isArray(v)) {
      for (const item of v) parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(item)}`);
    } else {
      parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
    }
  }
  return parts.length ? '?' + parts.join('&') : '';
}
