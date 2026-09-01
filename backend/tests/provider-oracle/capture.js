/**
 * Wire capture for the provider oracle.
 *
 * A fake SDK client that records the exact request object an adapter builds,
 * then throws a sentinel. By the time any `create()` is reached the request is
 * fully assembled, so aborting there captures the complete wire payload
 * WITHOUT needing four different families of believable canned responses —
 * and without a network call.
 *
 * Records TWO fingerprints per capture, because they answer different questions:
 *
 *   canonical  sorted-key JSON. Changes when the request means something
 *              different. This is the correctness signal.
 *   orderHash  hash of the natural-order JSON. Changes when key ORDER moves
 *              even though meaning did not. Not cosmetic: providers match a
 *              cache prefix on serialized bytes, so a reordering can silently
 *              destroy prefix reuse while every semantic assertion still
 *              passes. Kept separate so a reorder is reviewable rather than
 *              invisible.
 */
import crypto from 'crypto';

export class CaptureSentinel extends Error {
  constructor() {
    super('__ORACLE_CAPTURE__');
    this.name = 'CaptureSentinel';
    this.__oracleSentinel = true;
  }
}

/** Deep-sort object keys so semantic identity is order-independent. */
function sortDeep(value) {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === 'object') {
    if (value instanceof Date) return value.toISOString();
    return Object.keys(value).sort().reduce((acc, k) => {
      acc[k] = sortDeep(value[k]);
      return acc;
    }, {});
  }
  return value;
}

/**
 * NAMED EXEMPTION — the Claude Code CLI version in the billing header.
 *
 * That version is resolved live from npm (see clientVersions.js) because
 * Anthropic rejects requests that mimic a CLI it considers too old. It
 * therefore changes whenever Anthropic ships, and the 3-char fingerprint is a
 * hash OVER the version, so it moves with it. Left alone, both would turn this
 * oracle red for an upstream release rather than for anything AGNT did.
 *
 * Only those two churning values are masked. The header's structure — key
 * names, cc_entrypoint, the cch=00000 placeholder, ordering, its position as
 * the first system block — is still compared byte-for-byte. The suffix
 * ALGORITHM, which the oracle can no longer see, is guarded directly by
 * claudeBillingHeader.test.js.
 */
const CC_VERSION_RE = /cc_version=\d+(?:\.\d+)*\.[0-9a-f]{3}/g;
const maskCcVersion = (s) => s.replace(CC_VERSION_RE, 'cc_version=<cli-version>.<fp>');

/**
 * Strip values that legitimately differ run to run. Anything removed here is
 * a deliberate, named exemption — never a blanket "ignore what changed".
 */
function scrub(value) {
  const json = JSON.stringify(value, (k, v) => {
    if (typeof v === 'function') return '[Function]';
    if (v instanceof AbortSignal) return '[AbortSignal]';
    if (typeof v === 'bigint') return v.toString();
    if (typeof v === 'string' && v.includes('cc_version=')) return maskCcVersion(v);
    return v;
  });
  if (json === undefined) return undefined;
  return JSON.parse(json);
}

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);

export function fingerprint(params) {
  const clean = scrub(params);
  const canonical = JSON.stringify(sortDeep(clean));
  const natural = JSON.stringify(clean);
  return {
    canonical,
    canonicalHash: sha(canonical),
    orderHash: sha(natural),
    bytes: natural.length,
  };
}

/**
 * Build a fake client covering every SDK surface the adapters reach:
 *   chat.completions.create   OpenAI-compatible (14 providers) + Cerebras
 *   messages.create/stream    Anthropic
 *   models.generateContent*   Gemini
 *   responses.create          OpenAI Responses + Codex
 */
export function makeCaptureClient() {
  const captured = [];
  // BOTH arguments are recorded. The SDKs take (body, options) and `options`
  // carries per-request HEADERS — which are wire bytes like any other, and are
  // where several providers' cache-affinity hints live (e.g. xAI's
  // x-grok-conv-id). Capturing only the body would let a header change, or a
  // header silently disappearing, pass the oracle unnoticed.
  const record = (surface) => (params, options) => {
    captured.push({ surface, params, options });
    throw new CaptureSentinel();
  };

  const client = {
    // Common properties adapters read off the SDK client.
    baseURL: 'https://oracle.invalid/v1',
    apiKey: 'oracle-key',

    chat: { completions: { create: record('chat.completions.create') } },
    messages: {
      create: record('messages.create'),
      stream: record('messages.stream'),
    },
    models: {
      generateContent: record('models.generateContent'),
      generateContentStream: record('models.generateContentStream'),
    },
    responses: { create: record('responses.create') },
  };

  return { client, captured };
}

/**
 * Drive ONE adapter method through one scenario and return the captured wire.
 */
async function captureOne(adapter, scenario, method) {
  const { captured } = adapter.__oracleClient;
  captured.length = 0;

  const messages = JSON.parse(JSON.stringify(scenario.messages));
  const tools = JSON.parse(JSON.stringify(scenario.tools || []));

  if (typeof adapter[method] !== 'function') {
    return { ok: false, reason: `adapter has no ${method}()` };
  }

  let lastError = null;
  try {
    if (method === 'callStream') await adapter.callStream(messages, tools, () => {}, {});
    else await adapter.call(messages, tools, {});
  } catch (err) {
    if (!err?.__oracleSentinel && !String(err?.message || '').includes('__ORACLE_CAPTURE__')) {
      lastError = err;
    }
  }

  if (captured.length) {
    const first = captured[0];
    const wire = { body: first.params, options: first.options ?? null };
    return { ok: true, surface: first.surface, ...fingerprint(wire), wire: scrub(wire) };
  }
  return {
    ok: false,
    reason: lastError ? `${lastError.name}: ${String(lastError.message).slice(0, 200)}` : 'no request reached the client',
  };
}

/**
 * Capture BOTH adapter entry points for a scenario.
 *
 * callStream is the chat/orchestrator path. call() is a DIFFERENT code path
 * that eight background services use (goal evaluation, insight extraction,
 * plugin generation, eval datasets, experiments, trace analysis, skill
 * evolution, LlmExecutionService) and it frequently builds its request
 * separately.
 *
 * Capturing only the streaming path was a real blind spot in the first version
 * of this oracle — found by a negative control that mutated the non-streaming
 * request and watched the oracle stay green. Both are guarded now.
 *
 * Returns { ok:false, reason } rather than throwing, so one unsupported
 * combination cannot abort a whole recording run.
 */
export async function captureWire(adapter, scenario) {
  const stream = await captureOne(adapter, scenario, 'callStream');
  const nonStream = await captureOne(adapter, scenario, 'call');
  return {
    ok: stream.ok || nonStream.ok,
    stream,
    nonStream,
  };
}

export { scrub, sortDeep };
