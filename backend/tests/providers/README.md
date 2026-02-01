# Provider Test Suite

Comprehensive integration test suite for all AGNT AI providers. Tests run through the real `LlmService` → `LlmAdapter` stack — the exact same code path the production app uses.

## Quick Start

```bash
# List available providers
node backend/tests/providers/runner.js --list

# Run all suites for a single provider
node backend/tests/providers/runner.js --provider claude-code --verbose

# Run only CLI providers
node backend/tests/providers/runner.js --category cli --verbose

# Run a single suite across all providers
node backend/tests/providers/runner.js --suite connection

# Dry run (see what would execute)
node backend/tests/providers/runner.js --dry-run

# Generate JSON report
node backend/tests/providers/runner.js --provider openai --report backend/tests/providers/results/openai-report.json
```

## Options

| Flag | Description |
|---|---|
| `--provider <name>` | Run tests for a single provider (e.g. `claude-code`, `openai`) |
| `--category <api\|cli>` | Run only API or CLI providers |
| `--suite <name>` | Run a single suite (see suite list below) |
| `--report <path>` | Write JSON report to file |
| `--verbose` | Show all test results including passed tests |
| `--list` | List available providers and exit |
| `--dry-run` | Show what would run without executing |
| `--timeout <ms>` | Per-test timeout in milliseconds (default: 60000) |
| `--user-id <id>` | User ID for auth lookups (default: `AGNT_TEST_USER_ID` env var) |
| `--help` | Show help |

## Test Suites

| Suite | What It Tests |
|---|---|
| `connection` | Client creation, auth, adapter selection, capability resolution |
| `models` | Model listing, fallback models, cache, provider service methods |
| `response` | Basic text completion, multi-turn, no-system-prompt |
| `streaming` | Streaming chunks, monotonic accumulation, final consistency |
| `tool-calls` | Single tool, multi-tool, argument parsing, tool result formatting |
| `tool-streaming` | Streaming with tool calls, delta accumulation, AJV validation |
| `mcp` | MCP-style tool invocation, tool selection, streaming MCP |
| `vision` | Image input (provider-specific format), streaming vision |
| `image-gen` | Image generation capabilities, model validation (metadata only) |
| `context` | Long messages, many-turn conversations, context management |
| `error-handling` | Empty messages, invalid schemas, recovery responses, never-stop guarantee |

### Provider-Specific Suites

These run automatically when the matching provider is tested:

| Suite | Provider | Tests |
|---|---|---|
| `claude-code-specific` | `claude-code` | OAuth Bearer auth, beta headers, Anthropic tool format, system identity |
| `codex-cli-specific` | `openai-codex-cli` | OpenAI SDK client, CodexResponsesAdapter, ChatGPT backend auth, Responses API routing |
| `codex-api-specific` | `openai-codex` | CodexAuthManager, Responses API routing for GPT-5/o-series |
| `kimi-code-specific` | Custom (Kimi Code) | KimiCLI headers, developer role mapping, reasoning_content |

## Provider Categories

### API Providers
Standard cloud-hosted LLM APIs using remote auth:

`openai`, `anthropic`, `gemini`, `cerebras`, `groq`, `deepseek`, `grokai`, `openrouter`, `togetherai`, `kimi`, `minimax`, `zai`

### CLI / Hybrid Providers
Local-auth or subprocess-based providers:

| Provider | Auth | Execution |
|---|---|---|
| `claude-code` | OAuth token from `~/.claude/.credentials.json` | Anthropic API with Bearer auth |
| `openai-codex` | OAuth token from `~/.codex/auth.json` | OpenAI Chat Completions API |
| `openai-codex-cli` | OAuth token from `~/.codex/auth.json` | ChatGPT backend Codex Responses API (`chatgpt.com/backend-api/codex/responses`) |
| Kimi Code | Custom provider in DB | OpenAI-compatible API with `KimiCLI` header |

**Note on `openai-codex-cli`:** This provider uses the ChatGPT backend Responses API (not the standard OpenAI API). The Codex OAuth token authorizes against `chatgpt.com`, not `api.openai.com`. The `CodexResponsesAdapter` always streams internally (the endpoint requires `stream: true`) and adds Codex-specific headers (`chatgpt-account-id`, `OpenAI-Beta: responses=experimental`).

## Capability-Gated Tests

Tests are automatically **skipped** when a provider doesn't support the feature:

- **Streaming**: Skipped if `supportsStreaming: false`
- **Vision**: Skipped if no vision models registered
- **Image Gen**: Skipped if `imageGen` is null

## Architecture

```
backend/tests/providers/
├── runner.js              # CLI entry point + report generation
├── config.js              # Provider definitions + defaults
├── core/
│   ├── TestHarness.js     # Per-provider harness (setup, runTest, skipTest)
│   ├── assertions.js      # Custom assertion helpers (ok, eq, isValidToolCall, ...)
│   └── mocks.js           # Tool schemas, message fixtures, test data
├── suites/
│   ├── 01-connection.test.js  through  11-error-handling.test.js
├── providers/
│   ├── claude-code.test.js
│   ├── codex-cli.test.js
│   ├── codex-api.test.js
│   └── kimi-code.test.js
└── results/               # JSON reports (gitignored except .gitkeep)
```

### How It Works

1. **Runner** parses CLI args, selects providers and suites
2. For each provider, creates a **TestHarness** which calls `createLlmClient()` and `createLlmAdapter()` from the production code
3. Each **suite** receives the harness and runs tests through `harness.runTest()`
4. Tests return `{ passed, message }` assertion arrays — no exceptions for test failures
5. Results are printed to console and optionally written as JSON

### Adding a New Provider

When adding a new provider to AGNT, run the full suite to validate:

```bash
# 1. Add the provider to ProviderRegistry.js, LlmService.js, llmAdapters.js
# 2. Run connection + models first
node backend/tests/providers/runner.js --provider my-new-provider --suite connection
node backend/tests/providers/runner.js --provider my-new-provider --suite models

# 3. Run all suites
node backend/tests/providers/runner.js --provider my-new-provider --verbose

# 4. If CLI-type, add a provider-specific test file:
#    backend/tests/providers/providers/my-new-provider.test.js
```

**Checklist for new providers:**
- [ ] Entry in `PROVIDER_CAPABILITIES` with correct `supportsStreaming`, `supportsTools`, `vision`, `imageGen`
- [ ] Case in `createLlmClient()` returns correct SDK client
- [ ] Case in `createLlmAdapter()` maps to correct adapter class
- [ ] Provider service file with `fetchModels()` / `getFallbackModels()`
- [ ] Add to `config.js` `PROVIDERS` with default test model
- [ ] All applicable suites pass (or expected skips)

## JSON Report Format

```json
{
  "timestamp": "2026-02-01T18:14:00.000Z",
  "summary": {
    "total": 50,
    "passed": 47,
    "failed": 0,
    "skipped": 3,
    "errored": 0
  },
  "providers": {
    "claude-code": {
      "connection": {
        "suite": "connection",
        "provider": "claude-code",
        "summary": { "total": 5, "passed": 5, ... },
        "tests": [
          { "name": "client created successfully", "status": "pass", "durationMs": 1 },
          ...
        ]
      },
      ...
    }
  }
}
```

## Environment

- **User ID**: Set `AGNT_TEST_USER_ID` env var or use `--user-id` flag
- **Backend**: The runner loads backend modules directly — no running server needed
- **Auth**: Providers must be authenticated before running tests:
  - API providers: configured via AGNT UI (tokens in database)
  - `claude-code`: `~/.claude/.credentials.json` (run `claude login` first)
  - `openai-codex`/`openai-codex-cli`: `~/.codex/auth.json` (run `codex login` first)
  - Custom providers: created via AGNT UI (stored in `custom_openai_providers` table)
