import { getContextBudget, estimateMessagesTokens, estimateToolTokens } from '../../utils/contextManager.js';

export const isLocalProvider = (provider) => ['local', 'lm-studio', 'ollama'].includes(String(provider || '').toLowerCase());
// Cold-start guard for servers without a chat-template/tokenize API. This is
// an estimate, NOT the model's tokenizer. Measured local tool templates can
// cost almost three times the shared cloud-oriented estimator.
export const LOCAL_ESTIMATE_CALIBRATION = 3;
const positiveInteger = (value) => Number.isSafeInteger(value) && value > 0;

export function localContextError(message) {
  return Object.assign(new Error(`${message} No cloud fallback was used. Load the model with a larger context, use AGNT's managed local runner, or reduce the active tools/context.`), {
    code: 'LOCAL_CONTEXT_LIMIT', status: 400,
  });
}

export function assertLocalInstructionsPreserved(original, managed) {
  const required = original.filter((entry) => entry.role === 'system' || entry.role === 'developer');
  const latestUser = original.findLast((entry) => entry.role === 'user');
  if (latestUser) required.push(latestUser);
  for (const entry of required) {
    if (!managed.some((candidate) => candidate.role === entry.role && JSON.stringify(candidate.content) === JSON.stringify(entry.content))) {
      throw localContextError('The loaded local context cannot fit the instructions and current request without truncation.');
    }
  }
}

// Leave room for the current request and the next tool result before admitting
// schemas. A long user prompt must displace tools, not get silently truncated.
export function getLocalToolBudget(model, profile, messages) {
  const mandatory = messages.filter((entry) => entry.role === 'system' || entry.role === 'developer');
  const latestUser = messages.findLast((entry) => entry.role === 'user');
  if (latestUser) mandatory.push(latestUser);
  const { availableTokens } = getContextBudget(model, 'local', profile);
  return Math.max(0, Math.floor(availableTokens / profile.calibration) - estimateMessagesTokens(mandatory) - 2048);
}

/** Request-scoped: never put a loaded window into the global model catalog. */
export function createLocalInference({ resolve, fetchImpl = (...args) => fetch(...args) }) {
  async function json(baseURL, endpoint, body) {
    const response = await fetchImpl(`${baseURL.replace(/\/v1\/?$/, '')}${endpoint}`, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(5000), cache: 'no-store',
    });
    if (!response.ok) throw new Error(`Local server returned HTTP ${response.status} for ${endpoint}`);
    const result = await response.json();
    // LM Studio returns HTTP 200 with an error for unknown llama.cpp endpoints.
    if (result?.error) throw new Error(`Local server does not support ${endpoint}`);
    return result;
  }

  async function inspect(model, provider = 'local') {
    const baseURL = provider === 'lm-studio' ? 'http://127.0.0.1:1234/v1'
      : provider === 'ollama' ? 'http://127.0.0.1:11434/v1' : await resolve({ model });
    let contextWindow;
    let tokenizer = false;
    const failures = [];
    // The routed base may be a managed server on any free port. Probe server
    // capabilities rather than guessing its protocol from the port number.
    try {
      const props = await json(baseURL, '/props');
      contextWindow = props?.default_generation_settings?.n_ctx;
      tokenizer = positiveInteger(contextWindow);
    } catch (error) { failures.push(error.message); }
    if (!positiveInteger(contextWindow)) {
      try {
        const body = await json(baseURL, '/api/v1/models');
        const instance = body?.models?.flatMap((entry) => entry.loaded_instances || []).find((entry) => entry.id === model);
        contextWindow = instance?.config?.context_length;
      } catch (error) { failures.push(error.message); }
    }
    if (!positiveInteger(contextWindow)) {
      try {
        const body = await json(baseURL, '/api/v0/models');
        const loaded = body?.data?.find((entry) => entry.id === model && entry.state === 'loaded');
        contextWindow = loaded?.loaded_context_length;
      } catch (error) { failures.push(error.message); }
    }
    if (!positiveInteger(contextWindow)) {
      try {
        const body = await json(baseURL, '/api/ps');
        const loaded = body?.models?.find((entry) => entry.name === model || entry.model === model
          || (!model.includes(':') && entry.name === `${model}:latest`));
        contextWindow = loaded?.context_length;
      } catch (error) { failures.push(error.message); }
    }
    if (!positiveInteger(contextWindow)) {
      console.warn(`[localModels] Cannot read loaded context for ${model}: ${failures.join('; ')}`);
      throw localContextError(`Cannot verify the loaded context window for local model "${model}". It may not be loaded yet.`);
    }
    return {
      baseURL, contextWindow, tokenizer,
      outputBuffer: Math.min(4096, Math.max(256, Math.floor(contextWindow / 8))),
      calibration: LOCAL_ESTIMATE_CALIBRATION,
    };
  }

  async function count(profile, request) {
    if (!profile.tokenizer) return null;
    const template = await json(profile.baseURL, '/apply-template', request);
    if (typeof template?.prompt !== 'string') throw localContextError('The local server did not return a usable chat template.');
    const tokenized = await json(profile.baseURL, '/tokenize', { content: template.prompt, add_special: true, parse_special: true });
    if (!Array.isArray(tokenized?.tokens)) throw localContextError('The local server did not return a usable token count.');
    return tokenized.tokens.length;
  }

  async function measure(model, messages, tools, provider = 'local') {
    const profile = await inspect(model, provider);
    const actual = await count(profile, { model, messages, ...(tools?.length ? { tools } : {}) });
    if (actual !== null) {
      const estimated = estimateMessagesTokens(messages) + estimateToolTokens(tools);
      profile.calibration = Math.max(1, actual / Math.max(1, estimated) * 1.1);
    }
    return profile;
  }

  /** Check the ACTUAL wire request each round, including after a model reload. */
  async function preflight(model, request, provider = 'local') {
    const profile = await inspect(model, provider);
    const budget = getContextBudget(model, provider, profile);
    const actual = await count(profile, request);
    const estimated = estimateMessagesTokens(request.messages) + estimateToolTokens(request.tools);
    const tokens = actual ?? Math.ceil(estimated * profile.calibration);
    if (tokens > budget.availableTokens) {
      throw localContextError(`Local model "${model}" has ${profile.contextWindow} loaded context tokens; this request needs ${actual === null ? 'an estimated ' : ''}${tokens} input tokens plus ${budget.outputBuffer} reserved for the response.`);
    }
    request.max_tokens = Math.min(positiveInteger(request.max_tokens) ? request.max_tokens : budget.outputBuffer, budget.outputBuffer);
    return profile;
  }

  return { inspect, measure, count, preflight };
}
