# Prompt Caching Architecture

## Why Prompt Caching Matters

LLM providers cache the **prefix** of each request. When consecutive calls share the same prefix (system prompt + tools + earlier messages), the provider returns cached tokens at 10% of the normal input cost (Anthropic) or for free (OpenAI automatic caching).

AGNT makes multiple LLM calls per conversation turn (initial response + tool loop rounds). Without caching, every call re-processes the full system prompt (~20KB), tool schemas (~5-15KB), and message history from scratch. With caching, only new tokens (the latest message + tool results) are processed at full price.

**Impact**: ~90% reduction in input token costs after the first turn.

## How AGNT's Caching Works

### Frozen System Prompt

The system prompt is **100% deterministic** within a conversation:

- **No dynamic date** — `currentDate` is injected into the latest user message, not the system prompt
- **No tool list** — tools are provided via the API `tools` parameter, not embedded in prompt text
- **No dynamic guidance** — all guidance sections are always included (no keyword-based filtering)
- **Frozen memory** — user memories are loaded once on the first turn and reused
- **Frozen skill catalog** — skill catalog is loaded once and cached on the conversation context

### Additive-Only Tools

Tool schemas only **grow** during a conversation, never shrink:

```
Turn 1: "show me an image" → DEFAULT_TOOLS + media + core = 30 tools (cache write)
Turn 2: "now run a shell command" → DEFAULT_TOOLS + media + core + shell = 33 tools (extends, cache write)
Turn 3: "what about this?" → same 33 tools (CACHE HIT)
```

Previously loaded tool groups are tracked on `conversationContext._loadedToolGroups` and merged with newly matched groups each turn. The `discover_tools` flow also adds groups additively.

### Append-Only Messages

Within a tool loop, context management is **gated** — it only runs when utilization exceeds 95%. This prevents message truncation between rounds, keeping the message prefix stable for cache hits.

### Date Injection

Instead of embedding `new Date().toString()` in the system prompt (which changes every second), the current date is prepended to the latest user message:

```
[Current date: Wed Mar 19 2026 14:30:00 GMT-0500]

What's the weather like today?
```

This keeps the system prompt byte-identical across calls while the LLM still knows the current date.

## Provider-Specific Behavior

### Anthropic

Explicit `cache_control: { type: 'ephemeral' }` breakpoints are placed on:

1. **System prompt** — the full system prompt text block
2. **Last tool** — the final tool in the tools array (caches all tools as a block)
3. **Rolling messages** — the last 2 conversation messages (creates a sliding cache window)

Anthropic supports up to 4 cache breakpoints. Cached tokens cost 0.1x on reads, 1.25x on writes. The 5-minute TTL refreshes on each request.

### OpenAI

OpenAI uses **automatic prefix caching** — no explicit markers needed. A stable prefix automatically triggers cache hits. All Phase 1 changes ensure the prefix is stable, so OpenAI caching works out of the box.

Cached tokens are free (0x cost). Check `usage.prompt_tokens_details.cached_tokens` in responses.

### Gemini

Google's implicit caching benefits from stable prefixes. No explicit cache control is available for the standard API. Phase 1 changes help but cache behavior is provider-managed.

### Others (Groq, DeepSeek, Cerebras, Together AI, OpenRouter)

No provider-side caching, but stable prefixes don't hurt. The Phase 1 changes are 100% provider-agnostic.

## Cache-Preserving Rules for Developers

### DO NOT:

- **Inject dynamic data into system prompts** — no timestamps, random IDs, or per-request values
- **Remove tools mid-conversation** — tool groups are additive-only
- **Modify old messages** in the message array during a tool loop
- **Rebuild the system prompt** on subsequent turns with different parameters
- **Add per-turn keyword filtering** for guidance sections or memory

### DO:

- Put dynamic per-turn data in the **latest user message** (date, context updates)
- Use `context._frozenMemorySection` and `context._frozenSkillsCatalog` for once-per-conversation data
- Append new tool groups via `context._loadedToolGroups` — never remove
- Gate context management in tool loops to >95% utilization

## Monitoring & Debugging

### Backend Logs

```
[Token Usage] 12450 in (cache: 11200 read, 1250 write, 0 uncached) / 1203 out = 13653 total, est. cost: $0.004200
[Cache] Tool groups: [core, media, shell] → 33 tools (additive-only)
[Cache] Skipping context management in tool loop to preserve cache (utilization: 72.3%)
```

- **cache read** — tokens served from cache (0.1x cost on Anthropic)
- **cache write** — tokens written to cache this call (1.25x cost, amortized over future reads)
- **uncached** — tokens processed at full price

### Frontend ContextMonitor

The Context Monitor panel shows:
- **Last Call**: input/output token counts
- **Cache**: read (green if >80% hit rate), new (blue), miss (dim)
- **Cost**: estimated cost for the execution

### Verifying Cache Hits

1. Start a multi-turn Anthropic conversation
2. Check `[Token Usage]` log on turn 2+ — `cache read` should be > 0
3. Tool count should only grow across turns (check `[Cache] Tool groups` log)
4. For OpenAI, check `prompt_tokens_details.cached_tokens > 0` in response

## How the Tool Selector Works with Caching

```
User message → selectTools() → keyword-matched groups
                                      ↓
                              merge with _loadedToolGroups (additive)
                                      ↓
                              filter allSchemas by union of groups
                                      ↓
                              stable tool array (only grows)
```

The `discover_tools load` flow adds new groups to `_loadedToolGroups` in the tool loop, ensuring they persist for subsequent turns.

## Trade-offs

| Decision | Benefit | Cost |
|----------|---------|------|
| Include all guidance sections | 100% stable system prompt | ~12KB extra tokens on first turn |
| Additive-only tools | Stable tool array after 1-2 turns | Slightly larger tool payload |
| Frozen memory per conversation | Stable prefix, no semantic search per turn | New memories only appear next conversation |
| Gate context management in tool loop | Cache preserved within turns | Slightly higher token usage in tool loops |
| Date in user message vs system prompt | System prompt never changes | Tiny overhead in user message |

The cache savings (90%+ on input tokens) massively outweigh the small increase in per-turn token count.
