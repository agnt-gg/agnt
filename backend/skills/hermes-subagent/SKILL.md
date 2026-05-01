---
name: hermes-subagent
description: Delegate complex, autonomous, or tool-heavy tasks to a Hermes Agent sub-agent running in the AGNT sandbox. Hermes is Nous Research's self-improving Python agent (47 built-in tools, persistent memory, skills system, sub-agent delegation). Use this skill whenever the user asks Annie to "delegate to Hermes", "have Hermes do X", "run this through a sub-agent", "offload this task", "use a sub-agent for autonomous research", "let Hermes handle this", or any phrasing that hands a substantial, multi-step, or tool-heavy task off to an external agent. Also trigger when the user mentions Hermes Agent, Nous Research's agent, the AIAgent class, run_agent.py, or wants to spawn an autonomous sub-process to do research, multi-tool work, code analysis, code execution, or long-running browsing while keeping Annie's main context clean. Encodes the verified working invocation pattern (sandbox path, OpenRouter default, correct API signature, max_tokens cap, common error fixes) so delegation works on the first try.
version: 1.0.0
---

# Hermes Sub-Agent Delegation

Delegate substantial work to Hermes Agent (Nous Research) running in an isolated AGNT sandbox. Hermes acts as a heavyweight sub-agent: it has its own toolset, persistent memory, skills system, and can spawn its own sub-agents in turn.

## When To Delegate vs. Handle In Chat

| Task shape                                           | Where to handle     |
| ---------------------------------------------------- | ------------------- |
| Quick lookup, single tool call, conversational reply | Annie (this chat)   |
| Multi-step research with synthesis                   | Hermes              |
| Long-running autonomous browsing                     | Hermes              |
| Heavy code execution + iteration in a sandbox        | Hermes              |
| Cross-session continuity (resume work tomorrow)      | Hermes (session_id) |
| Anything that would burn 20+ Annie turns             | Hermes              |
| Image/video generation, AGNT-specific tools          | Annie               |

If unsure, ask the user one quick clarifier rather than guessing.

## Verified Sandbox Layout

Hermes lives in an isolated venv at:

```
C:\Users\Studio\AppData\Roaming\AGNT\hermes-sandbox\
├── .env                         # OPENROUTER_API_KEY=...
└── .venv\
    ├── Scripts\
    │   ├── python.exe           # use absolute path, never activate
    │   ├── hermes.exe
    │   ├── hermes-agent.exe
    │   └── hermes-acp.exe
    └── Lib\site-packages\
        ├── run_agent.py         # AIAgent lives here
        └── hermes_agent\        # full package
```

Never modify the global Python or npm globals. Always call the sandbox python.exe by absolute path. The venv is intentionally isolated from system Python.

## Preflight (run once per session before first delegation)

If anything below is missing, fix it before invoking Hermes:

```bat
:: 1. sandbox exists?
dir "C:\Users\Studio\AppData\Roaming\AGNT\hermes-sandbox\.venv\Scripts\python.exe"

:: 2. hermes-agent installed?
"C:\Users\Studio\AppData\Roaming\AGNT\hermes-sandbox\.venv\Scripts\python.exe" -m pip show hermes-agent

:: 3. .env has OPENROUTER_API_KEY?
type "C:\Users\Studio\AppData\Roaming\AGNT\hermes-sandbox\.env"
```

If `hermes-agent` is missing, install with:

```bat
"C:\Users\Studio\AppData\Roaming\AGNT\hermes-sandbox\.venv\Scripts\python.exe" -m pip install "git+https://github.com/NousResearch/hermes-agent.git"
```

If `.env` is missing or empty, ask the user for an OpenRouter key (or Anthropic / OpenAI / Nous Portal key) and write it as a single line `OPENROUTER_API_KEY=sk-or-v1-...` to `C:\Users\Studio\AppData\Roaming\AGNT\hermes-sandbox\.env`. Never paste keys into source code.

## The Canonical Invocation (this is the right one — others fail)

Use the bundled helper in `scripts/delegate.py`:

```bat
"C:\Users\Studio\AppData\Roaming\AGNT\hermes-sandbox\.venv\Scripts\python.exe" "C:\Users\Studio\AppData\Roaming\AGNT\skills\hermes-subagent\scripts\delegate.py" "your task here"
```

The script:

- Loads `.env` from the sandbox.
- Constructs `AIAgent(quiet_mode=True, model='anthropic/claude-sonnet-4.5', provider='openrouter', max_tokens=4000)` — these are the verified working defaults.
- Calls `agent.chat(message)` and prints the result on stdout.
- Accepts `--model`, `--max-tokens`, `--max-iterations`, and `--toolsets` flags.

Why these defaults matter (each one was a real failure mode in testing):

- `quiet_mode=True` belongs in the **constructor**, not in `chat()`. The published docs say otherwise. They are wrong for v0.12.0.
- `model` and `provider` must both be set explicitly — without them Hermes' default model resolution returns `None` silently and your call appears to hang.
- `max_tokens=4000` prevents OpenRouter's pre-flight credit check from rejecting the request as HTTP 402 ("requires more credits"). Hermes defaults to 64,000 reserved output tokens, which is too aggressive for low-balance accounts.

## Delegation Patterns

### Pattern 1 — Fire-and-forget (most common)

For any single task where you want one final answer:

```bat
"C:\Users\Studio\AppData\Roaming\AGNT\hermes-sandbox\.venv\Scripts\python.exe" ^
  "C:\Users\Studio\AppData\Roaming\AGNT\skills\hermes-subagent\scripts\delegate.py" ^
  "Research the top 3 open-source agent frameworks released in 2026 and summarize their differentiators in 200 words."
```

Run this with `_executeAsync: true` and an `_estimatedMinutes` value (typical 1–3 min for ~4k token tasks, 3–10 min for tool-heavy work). The result message comes back automatically when Hermes finishes.

### Pattern 2 — Multi-turn with session continuity

When the user wants to continue a Hermes conversation across multiple Annie turns, pass a stable `session_id`:

```bat
... delegate.py --session-id agnt-research-2026-04-30 "follow up: now compare them on cost"
```

Hermes persists session state in its own SQLite store. Reusing a session id lets Hermes recall prior turns without re-summarizing.

### Pattern 3 — Parallel sub-agents

Hermes itself can spawn sub-agents via its `delegate` toolset. For Annie's purposes, spawn multiple Hermes processes in parallel only when the tasks are genuinely independent. Use `_executeAsync: true` on each call so they run concurrently. Costs add linearly, so cap at 3–5 parallel runs unless the user explicitly approves more.

## Cost & Performance Guidelines

| Task complexity            | Typical cost (Sonnet 4.5 via OpenRouter) | Wall time |
| -------------------------- | ---------------------------------------- | --------- |
| Simple chat / summary      | $0.02 – $0.05                            | 30–60s    |
| Research + synthesis       | $0.05 – $0.15                            | 1–3 min   |
| Multi-tool autonomous work | $0.15 – $0.50                            | 3–10 min  |
| Long autonomous loop       | $0.50 – $2+                              | 10+ min   |

For repeated cheap delegation, switch to `--model openai/gpt-4o-mini` or `--model anthropic/claude-3.5-haiku`. They handle 80% of sub-agent work at ~10% of Sonnet's cost.

## Common Errors And Their Fixes

These are real errors observed during the install/verify session for this skill — handle them inline rather than escalating to the user.

**`TypeError: AIAgent.chat() got an unexpected keyword argument 'quiet_mode'`**
Move `quiet_mode=True` to the `AIAgent(...)` constructor. The chat() method only accepts `message` and an optional `stream_callback`.

**`agent.chat(...)` returns `None` after a long pause**
The model isn't being resolved. Pass both `model='anthropic/claude-sonnet-4.5'` and `provider='openrouter'` to the constructor.

**`HTTP 402: This request requires more credits, or fewer max_tokens. You requested up to 64000 tokens, but can only afford X`**
Either add credits at https://openrouter.ai/settings/credits, or pass `max_tokens=4000` to the constructor (or `--max-tokens 4000` to `delegate.py`). The bundled helper already does this.

**`ImportError: cannot import name 'AIAgent' from 'run_agent'`**
You're using the wrong python. Use the absolute sandbox path:
`C:\Users\Studio\AppData\Roaming\AGNT\hermes-sandbox\.venv\Scripts\python.exe`. Do not use `python` from PATH.

**`OPENROUTER_API_KEY` env var is empty inside the script**
The `.env` wasn't loaded. The bundled helper calls `load_dotenv()` against the sandbox `.env` explicitly. If you're invoking Hermes directly (without the helper), you must replicate that.

**Hermes hangs forever, no tokens reported**
The model is unreachable or the API key is invalid. Test with a curl to `https://openrouter.ai/api/v1/auth/key` using the same key. Fix the key in `.env`.

## Reporting Results Back To The User

When you get Hermes' response:

1. Quote the substantive output, don't paraphrase. Hermes did the work — show it.
2. Include a single status line: model used, tokens in/out, wall time, cost estimate.
3. If Hermes used tools, mention which ones briefly (its trace is interesting).
4. Offer next steps: refine the answer, dig deeper, or move on.

Format example:

> **Hermes (sub-agent) returned:**
>
> [verbatim output from Hermes]
>
> ⏱ Sonnet 4.5 · 3,200 in / 410 out · 47s · ~$0.02

## When Hermes Is The Wrong Tool

Don't delegate when:

- The task is a single image/video generation — use Annie's `generate_image` or `seedance_api` directly.
- The task needs an AGNT-specific tool (workflow operations, plugin install, AGNT API calls).
- The task is conversational ("how should I name this?") — Annie is faster.
- The task is < 30 seconds of straightforward work.

In those cases, do it inline and don't burn the Hermes round-trip.

## Deeper Reference

For full Hermes API surface (toolsets, run_conversation, callbacks, multi-turn patterns, model selection, MCP integration), see `reference.md` in this skill folder. Read it when:

- The user wants Hermes to use specific toolsets only.
- You need to inspect Hermes' tool trace, not just the final answer.
- You're integrating Hermes deeper (e.g., scaffolding the AGNT plugin).
- A subtask requires features not covered above.

## AGNT Integration Path (Beyond Chat)

Annie can call Hermes from chat using the helper script. To make Hermes callable from inside AGNT workflows, Goals, and scheduled jobs, build the `hermes-subagent` AGNT plugin — its `execute()` body wraps the same delegate.py invocation. The plugin scaffold was drafted earlier; activate `agnt-plugin-builder` skill when ready to ship it.
