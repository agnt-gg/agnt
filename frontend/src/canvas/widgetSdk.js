/**
 * Widget SDK Bridge
 * ─────────────────
 * Lets widget iframes call authenticated AGNT APIs without ever seeing the
 * user's JWT. Inside a widget, code looks like this:
 *
 *     const joke = await agnt.tool('chucknorris-get-joke', { category: 'dev' });
 *     const agents = await agnt.fetch('/api/agents');
 *     console.log(agnt.user);   // { id, email, name } | null
 *
 * Under the hood every call is a postMessage to this parent module, which
 * performs the request via the parent's authenticated axios instance and
 * posts the result back to the originating iframe. The widget JS never has
 * direct access to the token — even malicious widget code can't exfiltrate it.
 */

import axios from 'axios';
import { API_CONFIG } from '@/tt.config.js';

const ALLOWED_FETCH_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

let initialized = false;
const widgetWindows = new WeakSet();

async function callTool({ name, args }) {
  if (typeof name !== 'string' || !name) {
    throw new Error('agnt.tool: tool name required');
  }
  const url = `${API_CONFIG.BASE_URL}/tools/${encodeURIComponent(name)}/execute`;
  const res = await axios.post(url, { args: args || {} });
  const data = res.data;
  if (data && data.success === false) {
    const err = new Error(data.error || 'Tool execution failed');
    err.tool = data.tool;
    err.details = data.details;
    throw err;
  }
  return (data && data.result !== undefined) ? data.result : data;
}

async function proxyFetch({ url, opts }) {
  if (typeof url !== 'string' || !url.startsWith('/api/')) {
    throw new Error('agnt.fetch: only /api/* URLs are allowed');
  }
  const o = opts || {};
  const method = String(o.method || 'GET').toUpperCase();
  if (!ALLOWED_FETCH_METHODS.has(method)) {
    throw new Error(`agnt.fetch: method '${method}' not allowed`);
  }

  // Body normalisation: accept either an object (axios-style) or a JSON
  // string (fetch-style) so widget authors can use either idiom.
  let data = o.body;
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch (_) { /* leave as raw string */ }
  }

  // BASE_URL already ends in /api, so strip the leading /api from caller's path
  const path = url.replace(/^\/api/, '');
  const res = await axios.request({
    url: `${API_CONFIG.BASE_URL}${path}`,
    method,
    headers: o.headers,
    data,
    params: o.params,
  });
  return res.data;
}

async function dispatch(kind, payload) {
  if (kind === 'tool') return callTool(payload);
  if (kind === 'fetch') return proxyFetch(payload);
  throw new Error(`Unknown agnt request kind: ${kind}`);
}

function unwrapAxiosError(err) {
  if (err && err.response && err.response.data && err.response.data.error) {
    return err.response.data.error;
  }
  if (err && err.message) return err.message;
  return String(err);
}

function onMessage(event) {
  const data = event.data;
  if (!data || data.__agnt !== true) return;
  if (!widgetWindows.has(event.source)) return;

  const { id, kind, payload } = data;
  dispatch(kind, payload).then(
    (result) => {
      try { event.source.postMessage({ __agnt_response: true, id, ok: true, result }, '*'); }
      catch (_) { /* iframe may have been unmounted */ }
    },
    (err) => {
      try {
        event.source.postMessage({
          __agnt_response: true,
          id,
          ok: false,
          error: unwrapAxiosError(err),
        }, '*');
      } catch (_) { /* iframe may have been unmounted */ }
    },
  );
}

/**
 * Initialise the parent-side message listener. Idempotent — safe to call
 * from every widget mount.
 */
export function ensureBridgeInitialized() {
  if (initialized) return;
  window.addEventListener('message', onMessage);
  initialized = true;
}

/**
 * Authorise a widget iframe's contentWindow to use the agnt SDK. Call after
 * the iframe's `load` event fires. Old contentWindows are cleaned up
 * automatically by the WeakSet when the iframe is unmounted/replaced.
 */
export function registerWidgetWindow(contentWindow) {
  if (contentWindow) widgetWindows.add(contentWindow);
}

/**
 * Build the SDK preamble <script> tag that gets injected into the widget's
 * srcdoc <head>. Embeds user context so widgets can read `agnt.user`
 * synchronously without a round-trip.
 *
 * @param {object} ctx
 * @param {object|null} ctx.user - { id, email, name } or null
 */
export function buildSdkPreamble(ctx = {}) {
  // JSON-in-script escape: turn '<' into a safe unicode escape so a value
  // containing '</script>' can't break out of the surrounding script tag.
  const safeUser = JSON.stringify(ctx.user || null).replace(/</g, '\\u003c');
  return `<script>(function(){
  if (window.agnt) return;
  var pending = new Map();
  var lastId = 0;

  function send(kind, payload) {
    var id = ++lastId;
    return new Promise(function(resolve, reject) {
      pending.set(id, { resolve: resolve, reject: reject });
      try {
        parent.postMessage({ __agnt: true, id: id, kind: kind, payload: payload }, '*');
      } catch (e) {
        pending.delete(id);
        reject(e);
      }
    });
  }

  window.addEventListener('message', function(event) {
    if (event.source !== parent) return;
    var data = event.data;
    if (!data || data.__agnt_response !== true) return;
    var slot = pending.get(data.id);
    if (!slot) return;
    pending.delete(data.id);
    if (data.ok) slot.resolve(data.result);
    else slot.reject(new Error(data.error || 'Request failed'));
  });

  Object.defineProperty(window, 'agnt', {
    value: Object.freeze({
      user: ${safeUser},
      tool: function(name, args) {
        if (typeof name !== 'string' || !name) {
          return Promise.reject(new Error('agnt.tool: tool name required'));
        }
        return send('tool', { name: name, args: args || {} });
      },
      fetch: function(url, opts) {
        if (typeof url !== 'string' || !url) {
          return Promise.reject(new Error('agnt.fetch: url required'));
        }
        return send('fetch', { url: url, opts: opts || {} });
      },
    }),
    writable: false,
    configurable: false,
  });
})();</script>`;
}
