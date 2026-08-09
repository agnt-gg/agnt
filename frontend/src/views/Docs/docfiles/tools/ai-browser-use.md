# Browser Agent 🤖

## Id

`ai-browser-use`

## Description

Runs a browser automation task with [browser-use](https://github.com/browser-use/browser-use), driven by any connected AI provider. The agent sees the page, decides what to do, and clicks, types and navigates until the task is done or it runs out of steps.

The first run creates a private Python environment under your AGNT data directory and installs a pinned browser-use release into it. Later runs reuse it.

## Tags

ai, browser, automation, web, scraping, agent

## Providers

Every built-in AGNT provider works, plus any custom OpenAI-compatible provider you have added.

Most providers are driven directly by browser-use. Seven are routed back through AGNT instead, because they have no API key to hand over — they authenticate with a refreshed OAuth session, a local CLI login, or an encrypted transport:

`Claude Code` · `OpenAI Codex` · `Gemini CLI` · `Antigravity` · `Grok Build` · `Cursor` · `Kimi Code` · `Chutes`

That routing is automatic. You pick a provider; the node works out how to reach it.

**Vision matters.** browser-use decides what to do from screenshots. With `useVision: auto` the node enables vision only for providers that support it, so a text-only provider like DeepSeek runs without pretending to see the page. Providers with vision give noticeably better results.

## Input Parameters

### Required

- **instructions** (string): What the agent should do. Be specific about the goal and about what "done" looks like.

### Optional

- **provider** (string, default `OpenAI`): Which AI provider drives the browser.
- **model** (string): Defaults to the provider's first vision-capable model.
- **maxSteps** (number, default `100`): Step budget before the agent gives up.
- **timeoutMinutes** (number, default `15`): Hard wall-clock limit for the whole run.
- **useVision** (`auto` | `on` | `off`, default `auto`): Whether to send screenshots.
- **headless** (boolean, default `false`): Run without a visible browser window.
- **generateGif** (boolean, default `true`): Record the session as a GIF.
- **allowedDomains** (string): Comma-separated domains the agent may visit. Anything else is blocked. Worth setting for any task that handles credentials.
- **outputSchema** (JSON): A JSON Schema. When set, `structuredOutput` holds data matching it.
- **sensitiveData** (JSON): A map of placeholder → secret, e.g. `{"x_password": "hunter2"}`. The agent can type the value into a field but only ever sees the placeholder, so the secret never reaches the model or the logs.

## Output Format

- **success** (boolean): Whether the run completed.
- **result** (string): The agent's final answer.
- **structuredOutput** (object|null): Parsed result when `outputSchema` is set.
- **isSuccessful** (boolean|null): The agent's own judgement of whether it achieved the task. `null` when it could not tell.
- **urls** (array): Pages visited, in order.
- **steps** (number): How many steps it took.
- **agentErrors** (array): Errors the agent hit and recovered from mid-run.
- **gifPath** (string|null): Filename of the recording.
- **error** (string|null): Why the run could not be completed.

## Structured extraction

Set `outputSchema` and the agent returns data instead of prose:

```json
{
  "type": "object",
  "properties": {
    "title":  { "type": "string" },
    "price":  { "type": "number" },
    "inStock": { "type": "boolean" }
  },
  "required": ["title", "price"]
}
```

`{{aIBrowserUse.structuredOutput.price}}` is then usable directly by the next node — no second LLM call to parse the answer out of a paragraph.

Supported schema constructs: objects with `properties`/`required`, `string`, `integer`, `number`, `boolean`, arrays with `items`, nested objects, `enum`, nullable unions, and local `$ref`s into `$defs`. Anything else is rejected by name before the run starts.

## Notes

- browser-use needs **Python 3.11 or newer** on your PATH. The node reports it clearly if it cannot find one.
- Telemetry and cloud sync are disabled for every run.
- Concurrent runs are safe: each gets its own recording and its own browser.
