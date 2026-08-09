/**
 * A loopback-only, OpenAI-compatible /chat/completions endpoint backed by
 * AGNT's own provider stack.
 *
 * WHY THIS EXISTS
 * ---------------
 * Some of our providers cannot be handed to a third-party SDK at all. Claude
 * Code, Codex, Gemini CLI, Antigravity, Grok Build and Cursor authenticate with
 * refreshed OAuth sessions, spoofed CLI user-agents or a local CLI process;
 * Chutes needs an end-to-end-encrypted transport. There is no API key to give
 * away. The only way a Python child process reaches those models is by asking
 * us to make the call.
 *
 * So this route speaks the one dialect every LLM client already knows, and
 * translates it into `createLlmClient` + `createLlmAdapter` — the same path the
 * orchestrator uses, with the same retries, sanitizers and usage accounting.
 * The caller never learns that twenty providers exist.
 *
 * DELIBERATE LIMITS — each one fails loudly rather than silently degrading:
 *   - loopback callers only, with a token minted for a single run;
 *   - the token is bound to one provider and one model; a mismatch is a 400,
 *     not a quiet substitution;
 *   - no streaming (browser-use does not use it; a fake stream would be worse
 *     than an honest refusal);
 *   - `response_format` is honoured by instruction-plus-extraction, and a reply
 *     that will not parse is a 502 that says so — never a half-parsed object.
 *
 * Sampling hints in the request body (`temperature`, `top_p`,
 * `max_completion_tokens`, `frequency_penalty`) are NOT forwarded: our adapters
 * own those decisions per provider, and several of the providers reachable only
 * through here reject them outright. Callers get the provider's configured
 * behaviour, which is the same behaviour the rest of AGNT gets.
 */

import express from 'express';
import { randomUUID } from 'crypto';
import { createLlmClient } from '../services/ai/LlmService.js';
import { createLlmAdapter } from '../services/orchestrator/llmAdapters.js';
import { verifyGatewayToken } from '../services/ai/localGatewayTokens.js';
import { isSameMachineRequest } from '../services/ReachableOrigin.js';

const router = express.Router();

/** Pull the bearer token without caring about header casing. */
function presentedToken(req) {
  const header = req.headers.authorization || '';
  const [scheme, value] = header.split(' ');
  if (!scheme || scheme.toLowerCase() !== 'bearer') return null;
  return value || null;
}

/**
 * Gateway auth. Not the app's `authenticateToken`: these grants open exactly
 * one route and carry no session. See services/ai/localGatewayTokens.js.
 */
function authenticateGateway(req, res, next) {
  // The grant is handed to a child process on this machine. Nothing off-box
  // should ever present one, so refuse before even looking at the token.
  if (!isSameMachineRequest(req)) {
    return res.status(403).json({
      error: { message: 'The local LLM gateway only serves same-machine callers.', type: 'forbidden' },
    });
  }

  const grant = verifyGatewayToken(presentedToken(req));
  if (!grant) {
    return res.status(401).json({
      error: {
        message: 'Invalid or expired gateway token. Tokens live only for the run that minted them.',
        type: 'invalid_request_error',
        code: 'invalid_api_key',
      },
    });
  }

  req.gatewayGrant = grant;
  return next();
}

/**
 * Split OpenAI-shaped messages into (a) plain messages our adapters accept and
 * (b) the images they expect on a separate `context.imageData` channel.
 *
 * Our adapters do not read `image_url` parts out of message content — every one
 * of them injects images itself, in its vendor's own shape, from
 * `context.imageData`. Passing the parts through untouched is how a screenshot
 * silently becomes nothing at all, so unpack them here.
 *
 * Only the final user turn's images are forwarded, matching what the adapters
 * do with `imageData` and what browser-use itself sends: the current screenshot
 * is the one that matters, earlier ones are already-summarised history.
 */
function extractImages(messages) {
  const lastUserIndex = messages.map((m) => m.role).lastIndexOf('user');
  const images = [];
  let droppedHistorical = 0;

  const flattened = messages.map((message, index) => {
    if (!Array.isArray(message.content)) return message;

    const textParts = [];
    for (const part of message.content) {
      if (part?.type === 'text') {
        textParts.push(part.text || '');
        continue;
      }
      if (part?.type === 'image_url') {
        const url = part.image_url?.url || '';
        const match = /^data:([^;]+);base64,(.+)$/s.exec(url);
        if (!match) {
          // A remote URL, not an inline screenshot. We do not fetch it — that
          // would make this endpoint an SSRF primitive for whatever spawned it.
          textParts.push('[image omitted: the local gateway only accepts inline data: images]');
          continue;
        }
        if (index === lastUserIndex) images.push({ type: match[1], data: match[2] });
        else droppedHistorical += 1;
        continue;
      }
      if (typeof part === 'string') textParts.push(part);
    }

    return { ...message, content: textParts.join('\n') };
  });

  return { messages: flattened, images, droppedHistorical };
}

/**
 * Find the first complete JSON object in a model reply.
 *
 * Balanced scan rather than a regex, because screenshots and page text put
 * braces inside strings constantly and a greedy `/\{.*\}/s` matches the wrong
 * span the first time a page contains one.
 */
function extractJsonObject(text) {
  if (typeof text !== 'string') return null;

  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const haystack = fenced ? fenced[1] : text;

  const start = haystack.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < haystack.length; i += 1) {
    const char = haystack[i];

    if (escaped) { escaped = false; continue; }
    if (char === '\\') { escaped = true; continue; }
    if (char === '"') { inString = !inString; continue; }
    if (inString) continue;

    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return haystack.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Ask for structured output the only way that works across every provider.
 *
 * Strict `response_format` is an OpenAI-family feature; Anthropic, Gemini's
 * Code Assist endpoint and the CLI-backed providers do not all take it, and
 * three of our adapters have no way to pass it through. Stating the schema in
 * the system turn and extracting the object afterwards works everywhere, and
 * the extraction step is what makes it safe: a reply that is not valid JSON is
 * an error, not a value.
 */
function applyResponseFormat(messages, responseFormat) {
  if (!responseFormat || responseFormat.type === 'text') return messages;

  const schema = responseFormat.json_schema?.schema ?? responseFormat.schema ?? null;
  const instruction = schema
    ? 'You must reply with a single JSON object and nothing else. No prose, no code fences. '
      + `It must validate against this JSON Schema:\n${JSON.stringify(schema)}`
    : 'You must reply with a single JSON object and nothing else. No prose, no code fences.';

  const next = messages.map((m) => ({ ...m }));
  const systemIndex = next.findIndex((m) => m.role === 'system');
  if (systemIndex === -1) return [{ role: 'system', content: instruction }, ...next];

  next[systemIndex].content = `${next[systemIndex].content || ''}\n\n${instruction}`;
  return next;
}

router.post('/v1/chat/completions', authenticateGateway, async (req, res) => {
  const { userId, provider, model: grantedModel, label } = req.gatewayGrant;
  const {
    model: requestedModel,
    messages,
    tools,
    stream = false,
    response_format: responseFormat = null,
  } = req.body || {};

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({
      error: { message: '`messages` must be a non-empty array.', type: 'invalid_request_error' },
    });
  }

  // The grant, not the request, decides which model runs. Honouring the body
  // would let a token minted for a cheap model spend on an expensive one.
  if (requestedModel && requestedModel !== grantedModel) {
    return res.status(400).json({
      error: {
        message: `This gateway token is bound to model "${grantedModel}" but "${requestedModel}" was requested.`,
        type: 'invalid_request_error',
        param: 'model',
      },
    });
  }

  if (stream) {
    return res.status(400).json({
      error: {
        message: 'The local LLM gateway does not implement streaming. Call it with stream=false.',
        type: 'invalid_request_error',
        param: 'stream',
      },
    });
  }

  try {
    const prepared = applyResponseFormat(messages, responseFormat);
    const { messages: flatMessages, images, droppedHistorical } = extractImages(prepared);

    if (droppedHistorical > 0) {
      console.log(`[LLM Gateway] ${label}: dropped ${droppedHistorical} screenshot(s) from earlier turns; forwarding ${images.length} from the current turn.`);
    }

    const client = await createLlmClient(provider, userId);
    const adapter = await createLlmAdapter(provider, client, grantedModel);

    // callStream, not call: it is the only signature every adapter shares that
    // accepts a context, and `context.imageData` is the sole channel through
    // which any of them will send a screenshot. The sink is a no-op because
    // this endpoint answers in one shot.
    const { responseMessage, toolCalls, usage } = await adapter.callStream(
      flatMessages,
      tools || [],
      () => {},
      images.length > 0 ? { imageData: images } : {},
    );

    let content = responseMessage?.content ?? '';
    if (Array.isArray(content)) {
      content = content.filter((p) => p?.type === 'text').map((p) => p.text).join('');
    }

    if (responseFormat && responseFormat.type !== 'text') {
      const json = extractJsonObject(content);
      if (!json) {
        return res.status(502).json({
          error: {
            message: `${provider}/${grantedModel} was asked for a JSON object and replied with something else. `
              + `First 200 characters: ${String(content).slice(0, 200)}`,
            type: 'api_error',
            code: 'structured_output_unparseable',
          },
        });
      }
      try {
        content = JSON.stringify(JSON.parse(json));
      } catch (parseError) {
        return res.status(502).json({
          error: {
            message: `${provider}/${grantedModel} returned malformed JSON: ${parseError.message}`,
            type: 'api_error',
            code: 'structured_output_unparseable',
          },
        });
      }
    }

    const normalizedToolCalls = (toolCalls || []).map((call, index) => ({
      id: call.id || `call_${index}`,
      type: 'function',
      function: {
        name: call.function?.name || call.name,
        arguments: typeof call.function?.arguments === 'string'
          ? call.function.arguments
          : JSON.stringify(call.function?.arguments ?? call.arguments ?? {}),
      },
    }));

    const promptTokens = usage?.prompt_tokens ?? usage?.input_tokens ?? 0;
    const completionTokens = usage?.completion_tokens ?? usage?.output_tokens ?? 0;

    return res.json({
      id: `chatcmpl-${randomUUID()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: grantedModel,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content,
          ...(normalizedToolCalls.length > 0 ? { tool_calls: normalizedToolCalls } : {}),
        },
        // Derived, not invented: our adapters report no finish reason, and the
        // only distinction any caller acts on is "did it ask for a tool".
        finish_reason: normalizedToolCalls.length > 0 ? 'tool_calls' : 'stop',
      }],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: usage?.total_tokens ?? (promptTokens + completionTokens),
        prompt_tokens_details: {
          cached_tokens: usage?.prompt_cached_tokens ?? usage?.cache_read_input_tokens ?? 0,
        },
      },
    });
  } catch (error) {
    console.error(`[LLM Gateway] ${provider}/${grantedModel} failed:`, error);
    return res.status(502).json({
      error: {
        message: `${provider}/${grantedModel} failed: ${error.message}`,
        type: 'api_error',
      },
    });
  }
});

export default router;
export const _internals = { extractJsonObject, extractImages, applyResponseFormat };
