# Hermes Sub-Agent — Deep Reference

Companion to `SKILL.md`. Read this when the simple delegation pattern isn't enough — when you need to control toolsets, inspect trajectories, stream tokens, switch models mid-conversation, or wire Hermes into AGNT workflows.

All facts here are from hermes-agent **v0.12.0** as installed in the AGNT sandbox on 2026-04-30. Future versions may diverge — re-verify with `inspect.signature(AIAgent.__init__)` if behavior surprises you.

## Table of Contents

1. AIAgent constructor — full parameter reference
2. AIAgent public methods
3. Toolsets catalog
4. Recommended models on OpenRouter
5. run_conversation() — for trajectory inspection
6. Streaming and progress callbacks
7. Multi-turn sessions
8. Custom system prompts
9. Real-world error patterns (verified)
10. Sandbox operational notes
11. AGNT integration paths

---

## 1. AIAgent constructor

Verified signature:

```python
AIAgent(
    base_url: str = None,
    api_key: str = None,
    provider: str = None,
    api_mode: str = None,
    acp_command: str = None,
    acp_args: list[str] | None = None,
    command: str = None,
    args: list[str] | None = None,
    model: str = "",
    max_iterations: int = 90,
    tool_delay: float = 1.0,
    enabled_toolsets: list[str] = None,
    disabled_toolsets: list[str] = None,
    save_trajectories: bool = False,
    verbose_logging: bool = False,
    quiet_mode: bool = False,
    ephemeral_system_prompt: str = None,
    log_prefix_chars: int = 100,
    log_prefix: str = "",
    providers_allowed: list[str] = None,
    providers_ignored: list[str] = None,
    providers_order: list[str] = None,
    provider_sort: str = None,
    provider_require_parameters: bool = False,
    provider_data_collection: str = None,
    session_id: str = None,
    tool_progress_callback=None,
    tool_start_callback=None,
    tool_complete_callback=None,
    thinking_callback=None,
    reasoning_callback=None,
    clarify_callback=None,
    step_callback=None,
    stream_delta_callback=None,
    interim_assistant_callback=None,
    tool_gen_callback=None,
    status_callback=None,
    max_tokens: int = None,
    reasoning_config: dict[str, Any] = None,
    # ... more
)
```

The parameters that matter most for delegation:

| Param | When to set | Notes |
|---|---|---|
| `model` | Always | Empty default = silent failure. Use full id like `anthropic/claude-sonnet-4.5`. |
| `provider` | Always for OpenRouter | `"openrouter"` |
| `quiet_mode` | Always (for sub-agent use) | Suppresses CLI spinners that would clutter Annie's output. |
| `max_tokens` | Always | Cap to 4000–8000 to avoid HTTP 402 pre-flight rejection. |
| `max_iterations` | Long autonomous tasks | Default 90 is rarely needed; 20–30 is plenty. |
| `enabled_toolsets` | Lock-down | Use when you want a minimal Hermes (e.g. research-only). |
| `disabled_toolsets` | Soft restrictions | Use when you want most capabilities minus a few. |
| `session_id` | Multi-turn | Reuse same id across calls for continuity. |
| `save_trajectories` | Debugging | Writes ShareGPT-style trace to disk. |
| `ephemeral_system_prompt` | Role override | Replaces Hermes' personality for one call. |
| `tool_*_callback` | Streaming UI | Hooks for live progress. See section 6. |

## 2. AIAgent public methods

Verified by `dir(AIAgent)`:

| Method | Use |
|---|---|
| `chat(message, stream_callback=None)` | Single-shot. Returns the final string response. |
| `run_conversation(message, ephemeral_system_prompt=None)` | Returns dict with `final_response`, `messages`, `task_id`. |
| `switch_model(provider, model)` | Mid-conversation model swap. |
| `interrupt()` / `clear_interrupt()` | Stop a running call from another thread. |
| `steer(guidance)` | Inject a steering message during long autonomous runs. |
| `get_activity_summary()` | Returns counts of tool calls, tokens, etc. |
| `get_rate_limit_state()` | For backoff logic. |
| `commit_memory_session()` | Persist session memory immediately. |
| `reset_session_state()` | Clear in-memory session, keep persistent stores. |
| `release_clients()` / `close()` / `shutdown_memory_provider()` | Cleanup. |

`chat()` is the right call for sub-agent delegation. Use `run_conversation()` only when Annie needs the trace.

## 3. Toolsets catalog

Hermes 0.12 has 27 toolsets. Common ones, by use case:

**Research / browsing**
- `web_search` — generic web search
- `web_extract` — fetch + clean a URL's text
- `browser_tool` — full headless browser (heavyweight; only enable when you need it)

**File / code**
- `file_tools` — read/write/list local files
- `code_execution` — Python execution sandbox
- `terminal` — shell command execution

**Memory & skills**
- `memory_tool` — explicit memory writes
- `skills_tool` — load/save procedural skills
- `session_search` — full-text search over past sessions

**Coordination**
- `delegate_tool` — Hermes spawns its own sub-sub-agents
- `wait_tool` — pause for time-based scheduling

**Communication**
- `send_message` — gateway send (Telegram/Discord/Slack — only if gateway configured)

**Vision**
- `vision_tool` — image understanding

**MCP integration**
- `mcp_*` — auto-registered from any MCP servers in `~/.hermes/config.yaml`

To enable only research tools:

```python
AIAgent(
    enabled_toolsets=["web_search", "web_extract", "file_tools"],
    ...
)
```

To run Hermes with everything except the heavy browser:

```python
AIAgent(
    disabled_toolsets=["browser_tool"],
    ...
)
```

## 4. Recommended OpenRouter models

| Model id | When | Cost ratio (in/out) |
|---|---|---|
| `anthropic/claude-sonnet-4.5` | Default sub-agent — best reasoning | $3/$15 per M |
| `anthropic/claude-3.5-haiku` | Fast / cheap iteration | $0.80/$4 per M |
| `openai/gpt-4o-mini` | Cheapest serious sub-agent | $0.15/$0.60 per M |
| `google/gemini-2.5-flash` | Massive context, very cheap | $0.075/$0.30 per M |
| `meta-llama/llama-3.3-70b-instruct` | Sometimes free-tier | varies |
| `anthropic/claude-opus-4.1` | Heavy reasoning, expensive | $15/$75 per M |

For batch / "do this 50 times" workloads, GPT-4o-mini or Gemini 2.5 Flash are 80% as good at 5–10% the cost.

## 5. run_conversation() — for trajectory inspection

When Annie needs to *see* what Hermes did (tool calls, intermediate reasoning, retries):

```python
result = agent.run_conversation(message="Research X and tell me Y.")
# result is a dict:
#   final_response : str   - Hermes' final reply
#   messages       : list  - full ShareGPT-style trace
#   task_id        : str   - VM-isolation identifier

print(result["final_response"])
for m in result["messages"]:
    print(m["role"], "→", str(m.get("content", ""))[:120])
```

Useful for: debugging a failed delegation, surfacing tool usage to the user, or training/eval data collection.

## 6. Streaming and progress callbacks

To stream tokens to Annie while Hermes runs:

```python
def on_delta(delta_text):
    sys.stdout.write(delta_text)
    sys.stdout.flush()

agent = AIAgent(
    quiet_mode=True,
    model="anthropic/claude-sonnet-4.5",
    provider="openrouter",
    max_tokens=4000,
    stream_delta_callback=on_delta,
)
agent.chat("...")
```

Other useful callbacks:
- `tool_start_callback(name, args)` — fired when Hermes starts a tool call.
- `tool_complete_callback(name, result)` — fired when a tool finishes.
- `status_callback(text)` — Hermes' own status updates.
- `thinking_callback(text)` — internal reasoning (useful for transparency).

For Annie's chat surface, callbacks aren't needed — the helper script just blocks and prints the final answer. Use callbacks only if you're building a richer UI integration.

## 7. Multi-turn sessions

Hermes persists session state to its own SQLite store under the user's Hermes profile dir. To continue a session across multiple Annie chats:

1. Pick a stable session id (e.g. `agnt-research-{topic-slug}`).
2. Pass `session_id="..."` to every AIAgent call for that conversation.
3. Hermes loads prior turns automatically.

The bundled helper supports `--session-id`. Annie should:
- Use a fresh session id for each new task.
- Reuse an existing one only when the user is clearly continuing a prior thread.
- Tell the user the session id used, so they can ask Annie to "continue session X".

## 8. Custom system prompts

To override Hermes' personality / role for a single run:

```python
result = agent.run_conversation(
    message="Critique this paragraph: ...",
    ephemeral_system_prompt=(
        "You are a sharp editor. Be terse, no compliments, "
        "focus on structural problems first."
    ),
)
```

Or set it on the constructor for the whole agent's lifetime:

```python
AIAgent(
    ephemeral_system_prompt="...",
    ...
)
```

Use this when Annie wants to lend Hermes a specific voice or persona for a delegation. Don't override the system prompt for routine sub-agent work — Hermes' default personality is well-tuned for autonomous tasks.

## 9. Real-world error patterns (verified)

These were all hit during the install/verify session for this skill. Each entry includes the exact symptom and the fix.

### `TypeError: AIAgent.chat() got an unexpected keyword argument 'quiet_mode'`

**Cause:** The published Hermes docs page show `chat(message, quiet_mode=True)`. That is wrong for v0.12.0. `quiet_mode` is a constructor arg.

**Fix:** Move `quiet_mode=True` into `AIAgent(...)`.

### `chat()` returns `None` after a long pause

**Cause:** No model resolved. Hermes silently fails the underlying provider call.

**Fix:** Pass both `model='anthropic/claude-sonnet-4.5'` and `provider='openrouter'` to the constructor. Never rely on default model resolution.

### `HTTP 402: This request requires more credits, or fewer max_tokens. You requested up to 64000 tokens, but can only afford X`

**Cause:** OpenRouter pre-flights every request against your balance. Hermes defaults to a very high reserved-output-tokens limit.

**Fix #1:** Pass `max_tokens=4000` (or `--max-tokens 4000` in delegate.py).
**Fix #2:** Add credits at https://openrouter.ai/settings/credits.
**Fix #3:** Switch to a cheaper model that has lower per-token cost.

### `ImportError: cannot import name 'AIAgent' from 'run_agent'`

**Cause:** Wrong python interpreter. The system or PATH python doesn't have hermes-agent installed.

**Fix:** Always use the absolute sandbox python:
`C:\Users\Studio\AppData\Roaming\AGNT\hermes-sandbox\.venv\Scripts\python.exe`

### `OPENROUTER_API_KEY` empty inside the script

**Cause:** `.env` not loaded. Hermes does not load it for you.

**Fix:** Always call `load_dotenv(ENV_PATH)` before instantiating `AIAgent`. The bundled helper does this.

### Hermes hangs forever, no tokens reported

**Cause:** Bad API key, or network egress blocked.

**Fix:** Validate the key with a curl to `https://openrouter.ai/api/v1/auth/key` using the same key value. Check Windows firewall / VPN.

### Async wrapper reports `success:false` but pip says "Successfully installed"

**Cause:** A Windows shell quirk where the post-install subprocess gets `SIGTERM` after pip itself has finished printing success. The wrapper conflates exit signal with install failure.

**Fix:** Verify with `pip show hermes-agent` directly rather than trusting the wrapper status.

## 10. Sandbox operational notes

- The sandbox lives under `%APPDATA%\AGNT\hermes-sandbox\` — outside any git repo, outside the AGNT backend, isolated from system Python.
- Never add the sandbox `.venv\Scripts\` to PATH. Always invoke by absolute path.
- The `.env` is the only file with secrets — keep it out of any git, sync, or backup that exposes it.
- To wipe and reinstall:
  ```bat
  rmdir /s /q "C:\Users\Studio\AppData\Roaming\AGNT\hermes-sandbox"
  mkdir "C:\Users\Studio\AppData\Roaming\AGNT\hermes-sandbox"
  cd /d "C:\Users\Studio\AppData\Roaming\AGNT\hermes-sandbox"
  python -m venv .venv
  .venv\Scripts\python.exe -m pip install --upgrade pip
  .venv\Scripts\python.exe -m pip install "git+https://github.com/NousResearch/hermes-agent.git"
  echo OPENROUTER_API_KEY=sk-or-v1-XXX > .env
  ```
- Hermes' own data (session memory, skills, FTS5 index) is in its profile dir, *not* in the venv. Wiping the venv preserves Hermes' learned skills and memory. To wipe those too, also remove `~\.hermes\` (Windows: `C:\Users\Studio\.hermes\`).

## 11. AGNT integration paths

There are three layers at which Hermes can live inside AGNT. Understand the trade-offs before recommending one.

### Layer A — Annie chat-only (current, working today)

- Annie calls `delegate.py` via `execute_shell_command`.
- Output is shown to the user inline.
- No AGNT plugin needed.
- Limitation: not callable from inside a Goal, workflow node, or scheduled job.
- Best for: ad-hoc delegation while iterating with the user.

### Layer B — AGNT plugin `hermes-subagent` (proposed)

- Plugin exposes a `hermes-run` tool.
- Plugin's `execute()` body wraps the same `delegate.py` invocation.
- Now callable from workflows, Goals, agents.
- Activate `agnt-plugin-builder` skill to scaffold + install it.
- Best for: production / autonomous AGNT loops.

### Layer C — Bidirectional MCP bridge

- Hermes consumes AGNT's MCP server (so Hermes can call AGNT tools).
- AGNT consumes Hermes via plugin or MCP (Hermes ships `hermes mcp serve`).
- True two-way delegation: AGNT → Hermes → AGNT tools → back to AGNT.
- Best for: deep agent ecosystems where both sides need each other's tools.

For most user requests, Layer A is enough. Recommend Layer B only when the user wants Hermes inside a Goal/workflow. Layer C is for the rare "I want them fully integrated" case.

---

End of reference.
