# Grok Build CLI Connector Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local **Grok Build** CLI provider to AGNT so Annie can run coding tasks through the installed `grok` binary (subscription OAuth), parallel to `openai-codex` / `codex_exec`.

**Architecture:** Mirror the existing Codex CLI stack. Auth reads `~/.grok/auth.json` (and optional `XAI_API_KEY`). Execution shells `grok -p … --output-format streaming-json --always-approve` and adapts JSON events into AGNT’s OpenAI-style chat client + a `grok_exec` orchestrator tool. UI treats `grok-build` as a local-only CLI provider (status, reconnect via `grok login --device-auth`, disconnect via `grok logout`).

**Tech Stack:** Node.js (ESM), child_process spawn, existing AuthDispatcher / ProviderAuthRoutes / LlmService patterns, Vuex `appAuth`, Vitest/Jest-style unit tests matching nearby `*.test.js` files.

**Assumptions (verified on this machine 2026-07-26):**
- Binary: `/Users/tom/.local/bin/grok` → `~/.grok/bin/grok` (v **0.1.219**)
- Creds: `~/.grok/auth.json` (OIDC; **re-authenticated** 2026-07-26)
- Headless: `grok -p "<prompt>" --output-format streaming-json --always-approve -m grok-build`
- Login: `grok login` / `grok login --device-auth` / `grok login --oauth`
- Logout: `grok logout`
- Models: `grok models` → default **`grok-4.5`** (was `grok-build` on older CLI; live verified 2026-07-26)
- Creds: re-authenticated as `rmocius@me.com` (OIDC, valid)
- Existing API provider `grokai` (bearer `XAI_API_KEY` → `api.x.ai`) stays **unchanged** and separate

---

## Architecture decision (read first)

AGNT already has two Grok-adjacent paths. Do **not** collapse them:

| Provider key | What it is | Auth | How it runs |
|---|---|---|---|
| `grokai` (existing) | xAI **API** | Remote vault / `XAI_API_KEY` | HTTP OpenAI-compat SDK → `api.x.ai` |
| **`grok-build` (new)** | **Grok Build CLI** | Local `~/.grok/auth.json` or env | Spawn `grok` binary headless |

Two integration surfaces (both in v1, same as Codex):

1. **Provider path** — select `Grok-Build` in chat model picker → messages go through `createGrokBuildCliClient` (like `createCodexCliClient`).
2. **Tool path** — orchestrator tool `grok_exec` (like `codex_exec`) so Annie can delegate a coding task while using another model as the main brain.

**Out of scope for v1:** ACP/`grok agent stdio` long-lived server, best-of-N, plan-mode TUI, MCP bridge, spoofing Grok subscription via raw HTTP (privacy/ToS risk — always go through the official CLI).

**Security note:** Grok Build may upload workspace context to xAI. Default workdir must be a dedicated sandbox (`AGNT_GROK_WORKDIR`), never the whole home dir. Prefer `--tools` allowlists for read-only runs.

---

## File map

### Create
| File | Responsibility |
|---|---|
| `backend/src/services/auth/GrokBuildAuthManager.js` | Read/validate `~/.grok/auth.json`, resolve bin, status, login/logout wrappers, optional device-auth spawn |
| `backend/src/services/ai/GrokBuildCliService.js` | Resolve bin, spawn headless `grok`, parse `streaming-json` / `json` / plain, return `{ text, sessionId, usage, exitCode }` |
| `backend/src/services/ai/GrokBuildCliClient.js` | OpenAI-compat `chat.completions.create` adapter over the service (stream + non-stream) |
| `backend/src/services/ai/GrokBuildCliSessionManager.js` | Map AGNT conversation → Grok session id (reuse `CodexCliSessionManager` pattern; can share DB table with provider prefix) |
| `backend/src/services/auth/GrokBuildAuthManager.test.js` | Unit tests for auth file parse / expiry / env override |
| `backend/src/services/ai/GrokBuildCliService.test.js` | Unit tests for arg building + event parsing (mocked spawn) |

### Modify
| File | Change |
|---|---|
| `backend/src/services/auth/AuthDispatcher.js` | Register scheme `grok-build` → manager, local, caps |
| `backend/src/services/ai/providerConfigs.js` | Add provider config block `key: 'grok-build'` |
| `backend/src/services/ai/LlmService.js` | Branch in `_createSpecialAuthClient` / client factory to return `createGrokBuildCliClient` |
| `backend/src/services/ai/clientVersions.js` | Optional: source from `~/.grok/version.json` (not required for auth spoof — CLI is real) |
| `backend/src/routes/ProviderAuthRoutes.js` | Wire device/login/logout if scheme needs custom routes beyond generic dispatch |
| `backend/src/services/orchestrator/tools.js` | Add `grok_exec` tool next to `codex_exec` |
| `backend/src/services/orchestrator/toolSelector.js` | Include `grok_exec` in default tool list where `codex_exec` is listed |
| `backend/src/services/UserService.js` | Ensure local CLI health includes `grok-build` via `getCliProviderIds()` (automatic if dispatcher marks local) |
| `frontend/src/store/auth/appAuth.js` | Add `grok-build` to `CLI_PROVIDER_IDS` + local provider injection list |
| `frontend/src/store/app/aiProvider.js` | Display name, local-provider checks, `CLI_KEYS` |
| `frontend/src/services/providerAuthService.js` | No change if generic routes work |
| `frontend/.../Connectors.vue` / `ProviderSetup.vue` / `IntegrationHealth.vue` | Treat `grok-build` like `openai-codex` for connect UX (device/login instructions) |
| `backend/.env.example` (if present) | Document `GROK_BIN`, `AGNT_GROK_WORKDIR`, `AGNT_GROK_DEFAULT_MODEL`, `XAI_API_KEY` |

### Do not touch
- `grokai` provider config / remote API path
- Trading agent / ZeroClaw files
- Remote `api.agnt.gg` provider catalog (local-only provider)

---

## Prerequisite: re-auth on this machine

Current `~/.grok/auth.json` shows `expires_at: 2026-05-25…` and `grok models` returns **You are not authenticated.**

```bash
# Interactive (preferred on desktop)
grok login --oauth

# Or headless device code
grok login --device-auth

# Verify
grok models
grok -p "Reply with exactly: pong" --output-format plain --always-approve
```

Plan assumes this is done before Task 8 (E2E). Unit tests mock the binary and do not need live auth.

---

### Task 1: Provider config + auth scheme registration

**Files:**
- Modify: `backend/src/services/ai/providerConfigs.js`
- Modify: `backend/src/services/auth/AuthDispatcher.js`
- Test: manual `node -e` import check

- [ ] **Step 1: Add provider config**

In `providerConfigs.js`, insert near other CLI providers (after `openai-codex` or after `grokai`):

```js
{
  key: 'grok-build',
  name: 'Grok Build',
  // Not used for HTTP — CLI owns the network path. Kept for registry completeness.
  baseURL: 'https://cli-chat-proxy.grok.com/v1',
  sdkType: 'openai',
  authScheme: 'grok-build',
  capabilities: {
    text: { supportsStreaming: true, supportsTools: true },
  },
  recommendedModels: ['grok-build'],
  fallbackModels: ['grok-build'],
  modelMetadata: {
    'grok-build': {
      contextWindow: 512000,
      maxOutputTokens: 65536,
      inputCostPer1M: 0,
      outputCostPer1M: 0,
      supportsVision: false,
      supportsTools: true,
      reasoning: true,
    },
  },
  compat: {},
  sdkOptions: {},
},
```

Also add parent alias if the file has a `PARENT_PROVIDER` map:

```js
'grok-build': 'grokai', // metadata fallback only — do NOT share auth
```

- [ ] **Step 2: Register auth scheme**

In `AuthDispatcher.js`:

```js
import GrokBuildAuthManager from './GrokBuildAuthManager.js';

// inside AUTH_SCHEME_MAP:
'grok-build': {
  manager: GrokBuildAuthManager,
  local: true,
  caps: ['status', 'disconnect', 'device-auth', 'refresh'],
},
```

(Manager file is stubbed in Task 2 — commit after Task 2 if import fails mid-way.)

- [ ] **Step 3: Smoke-check config loads**

Run from `backend/`:

```bash
node --input-type=module -e "
import { getProviderConfig } from './src/services/ai/providerConfigs.js';
console.log(getProviderConfig('grok-build')?.key);
"
```

Expected: `grok-build`

- [ ] **Step 4: Commit**

```bash
git add backend/src/services/ai/providerConfigs.js backend/src/services/auth/AuthDispatcher.js
git commit -m "feat(grok-build): register provider config and auth scheme"
```

---

### Task 2: GrokBuildAuthManager

**Files:**
- Create: `backend/src/services/auth/GrokBuildAuthManager.js`
- Create: `backend/src/services/auth/GrokBuildAuthManager.test.js`

- [ ] **Step 1: Write failing tests**

```js
// GrokBuildAuthManager.test.js
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Test against a temp GROK_HOME override once implemented
describe('GrokBuildAuthManager', () => {
  it('returns available:false when auth.json missing', async () => {
    // set GROK_HOME to empty temp dir
    // expect (await manager.checkApiUsable({ forceRefresh: true })).available === false
  });

  it('detects expired OIDC entry', async () => {
    // write auth.json with expires_at in the past and refresh_token present
    // expect available true (file exists) but apiUsable false OR needsRefresh true
  });

  it('prefers XAI_API_KEY env over file', async () => {
    process.env.XAI_API_KEY = 'xai-test-key';
    // expect getAccessToken() === 'xai-test-key'
    // expect source === 'env-xai-api-key'
  });
});
```

- [ ] **Step 2: Run tests — expect fail**

```bash
cd /Users/tom/.agnt-server/backend && npm test -- GrokBuildAuthManager.test.js
```

Expected: FAIL (module missing)

- [ ] **Step 3: Implement manager**

Mirror `CodexAuthManager` surface so `ProviderAuthRoutes` stays generic:

```js
// backend/src/services/auth/GrokBuildAuthManager.js
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import generateUUID from '../../utils/generateUUID.js';

const API_CHECK_TTL_MS = 2 * 60 * 1000;

function expandUserPath(p) { /* same as Codex */ }

function resolveGrokHome() {
  const configured = process.env.GROK_HOME;
  return configured
    ? expandUserPath(configured)
    : path.join(os.homedir(), '.grok');
}

function resolveAuthPath() {
  return path.join(resolveGrokHome(), 'auth.json');
}

function resolveGrokBin() {
  if (process.env.GROK_BIN?.trim()) return process.env.GROK_BIN.trim();
  const home = os.homedir();
  const candidates = [
    path.join(home, '.local', 'bin', 'grok'),
    path.join(home, '.grok', 'bin', 'grok'),
    '/opt/homebrew/bin/grok',
    '/usr/local/bin/grok',
    'grok',
  ];
  for (const c of candidates) {
    if (c !== 'grok' && fs.existsSync(c)) return c;
  }
  return 'grok';
}

function readAuthFile() {
  const authPath = resolveAuthPath();
  try {
    return { authPath, data: JSON.parse(fs.readFileSync(authPath, 'utf8')) };
  } catch {
    return { authPath, data: null };
  }
}

/** Pick the first OIDC entry from auth.json (keys look like https://auth.x.ai::<clientId>) */
function getPrimaryEntry(data) {
  if (!data || typeof data !== 'object') return null;
  const keys = Object.keys(data);
  if (keys.length === 0) return null;
  return { key: keys[0], entry: data[keys[0]] };
}

class GrokBuildAuthManager {
  constructor() {
    this.apiCheckCache = null;
    this.deviceSessions = new Map();
    this.grokBin = resolveGrokBin();
  }

  getAuthPath() { return resolveAuthPath(); }
  getGrokBin() { return this.grokBin; }

  getAccessToken() {
    const envKey = process.env.XAI_API_KEY?.trim();
    if (envKey) return envKey;

    const { data } = readAuthFile();
    const primary = getPrimaryEntry(data);
    if (!primary) return null;
    const { entry } = primary;
    // File stores bearer under "key" for OIDC sessions
    if (typeof entry.key === 'string' && entry.key.trim()) return entry.key.trim();
    if (typeof entry.access_token === 'string') return entry.access_token.trim();
    return null;
  }

  getTokenExpiry() {
    const { data } = readAuthFile();
    const primary = getPrimaryEntry(data);
    if (!primary?.entry?.expires_at) return null;
    const expiresAtMs = Date.parse(primary.entry.expires_at);
    if (Number.isNaN(expiresAtMs)) return null;
    return {
      expiresAt: new Date(expiresAtMs).toISOString(),
      expiresInMs: expiresAtMs - Date.now(),
      expired: Date.now() >= expiresAtMs,
      hasRefreshToken: Boolean(primary.entry.refresh_token),
      email: primary.entry.email || null,
      authMode: primary.entry.auth_mode || null,
    };
  }

  /**
   * Health check.
   * Prefer: spawn `grok models` (proves CLI + auth refresh path).
   * Fallback: file presence + non-expired token / env key.
   */
  async checkApiUsable({ forceRefresh = false } = {}) {
    const authPath = this.getAuthPath();
    const now = Date.now();
    if (!forceRefresh && this.apiCheckCache && now - this.apiCheckCache.checkedAtMs < API_CHECK_TTL_MS) {
      return this.apiCheckCache.value;
    }

    const envKey = process.env.XAI_API_KEY?.trim();
    const token = this.getAccessToken();
    const expiry = this.getTokenExpiry();

    if (!token && !envKey) {
      const value = {
        available: false,
        cliUsable: fs.existsSync(this.grokBin) || this.grokBin === 'grok',
        apiUsable: false,
        apiStatus: null,
        source: null,
        authPath,
        checkedAt: new Date().toISOString(),
        tokenExpiry: expiry?.expiresAt || null,
      };
      this.apiCheckCache = { checkedAtMs: now, value };
      return value;
    }

    // Probe CLI if binary resolves
    let apiUsable = false;
    let apiStatus = null;
    let probeError = null;
    try {
      const result = await this._runGrok(['models'], { timeoutMs: 15000 });
      // Authenticated output lists models; unauthenticated prints "You are not authenticated."
      const out = `${result.stdout}\n${result.stderr}`;
      if (/not authenticated/i.test(out)) {
        apiUsable = false;
        apiStatus = 401;
      } else if (result.exitCode === 0) {
        apiUsable = true;
        apiStatus = 200;
      } else {
        apiUsable = false;
        apiStatus = result.exitCode;
        probeError = out.trim().slice(0, 300);
      }
    } catch (e) {
      // If CLI probe fails but env key exists, treat as usable for API-key mode
      if (envKey) {
        apiUsable = true;
        apiStatus = 200;
      } else {
        apiUsable = false;
        probeError = e.message;
      }
    }

    const value = {
      available: true,
      cliUsable: true,
      apiUsable,
      apiStatus,
      source: envKey ? 'env-xai-api-key' : 'grok-auth-oidc',
      authPath,
      checkedAt: new Date().toISOString(),
      tokenExpiry: expiry?.expiresAt || null,
      email: expiry?.email || null,
      error: probeError,
    };
    this.apiCheckCache = { checkedAtMs: now, value };
    return value;
  }

  async _runGrok(args, { timeoutMs = 30000 } = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn(this.grokBin, args, {
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`grok ${args.join(' ')} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      child.stdout.on('data', (d) => { stdout += d.toString(); });
      child.stderr.on('data', (d) => { stderr += d.toString(); });
      child.on('error', (err) => { clearTimeout(timer); reject(err); });
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({ exitCode: code ?? 1, stdout, stderr });
      });
    });
  }

  /**
   * Device auth: spawn `grok login --device-auth` and capture device URL/code from stderr/stdout.
   * Grok CLI owns the OIDC client — we do not reimplement xAI OAuth.
   */
  async startDeviceAuth() {
    const sessionId = generateUUID();
    const session = {
      id: sessionId,
      startedAtMs: Date.now(),
      state: 'pending',
      deviceUrl: null,
      deviceCode: null,
      lastError: null,
      child: null,
    };
    this.deviceSessions.set(sessionId, session);

    // Non-blocking spawn; poll parses accumulated output
    const child = spawn(this.grokBin, ['login', '--device-auth'], {
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    session.child = child;
    session.buffer = '';

    const onData = (chunk) => {
      session.buffer += chunk.toString();
      // Heuristics — refine against real CLI output during Task 8:
      // look for URL + user code patterns
      const urlMatch = session.buffer.match(/https:\/\/[^\s]+/);
      if (urlMatch) session.deviceUrl = urlMatch[0];
      const codeMatch = session.buffer.match(/\b([A-Z0-9]{4,}-[A-Z0-9]{4,}|[A-Z0-9]{6,8})\b/);
      if (codeMatch) session.deviceCode = codeMatch[1];
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('close', (code) => {
      if (session.state === 'pending') {
        // Re-check auth file — login may have completed
        const token = this.getAccessToken();
        const expiry = this.getTokenExpiry();
        if (token && expiry && !expiry.expired) {
          session.state = 'success';
        } else if (code !== 0) {
          session.state = 'error';
          session.lastError = `grok login exited ${code}`;
        }
      }
      this.apiCheckCache = null;
    });

    // Small delay so first output can arrive
    await new Promise((r) => setTimeout(r, 800));

    return {
      success: true,
      sessionId,
      deviceUrl: session.deviceUrl || 'https://accounts.x.ai', // fallback label
      deviceCode: session.deviceCode || null,
      state: session.state,
      message: session.deviceCode
        ? 'Open the URL and enter the code to finish Grok Build login.'
        : 'Grok Build login started. Complete sign-in in the browser if prompted.',
    };
  }

  async getDeviceSessionStatus(sessionId) {
    const session = this.deviceSessions.get(sessionId);
    if (!session) {
      return { success: false, state: 'error', message: 'Session not found or expired.' };
    }
    if (session.state === 'success') {
      const apiStatus = await this.checkApiUsable({ forceRefresh: true });
      return { success: true, state: 'success', message: 'Grok Build connected.', apiStatus };
    }
    if (session.state === 'error') {
      return { success: false, state: 'error', message: session.lastError || 'Login failed.' };
    }

    // Opportunistic: auth file became valid mid-flow
    const expiry = this.getTokenExpiry();
    if (this.getAccessToken() && expiry && !expiry.expired) {
      session.state = 'success';
      this.apiCheckCache = null;
      return this.getDeviceSessionStatus(sessionId);
    }

    return {
      success: true,
      state: 'pending',
      deviceUrl: session.deviceUrl,
      deviceCode: session.deviceCode,
      message: 'Waiting for Grok Build login to complete…',
    };
  }

  async refreshAccessToken() {
    // CLI auto-refreshes via refresh_token on next invocation.
    // Force a probe which should rotate tokens into auth.json.
    this.apiCheckCache = null;
    const status = await this.checkApiUsable({ forceRefresh: true });
    if (status.apiUsable) return { success: true, ...status };
    return {
      success: false,
      error: 'Token refresh failed. Run: grok login --oauth',
      revoked: true,
    };
  }

  async logout() {
    try {
      await this._runGrok(['logout'], { timeoutMs: 15000 });
      this.apiCheckCache = null;
      return { success: true };
    } catch (error) {
      // Fallback: delete auth.json keys carefully
      try {
        const authPath = resolveAuthPath();
        if (fs.existsSync(authPath)) fs.unlinkSync(authPath);
        this.apiCheckCache = null;
        return { success: true, method: 'file-delete' };
      } catch (e) {
        return { success: false, error: e.message };
      }
    }
  }
}

export default new GrokBuildAuthManager();
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd /Users/tom/.agnt-server/backend && npm test -- GrokBuildAuthManager.test.js
```

- [ ] **Step 5: Manual status check**

```bash
# After server restart, or via node:
node --input-type=module -e "
import m from './src/services/auth/GrokBuildAuthManager.js';
console.log(await m.checkApiUsable({ forceRefresh: true }));
"
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/auth/GrokBuildAuthManager.js backend/src/services/auth/GrokBuildAuthManager.test.js backend/src/services/auth/AuthDispatcher.js
git commit -m "feat(grok-build): add GrokBuildAuthManager for local CLI credentials"
```

---

### Task 3: GrokBuildCliService (spawn + parse)

**Files:**
- Create: `backend/src/services/ai/GrokBuildCliService.js`
- Create: `backend/src/services/ai/GrokBuildCliService.test.js`

- [ ] **Step 1: Capture one real streaming-json sample (after re-login)**

```bash
grok -p "Reply with exactly: hello-agnt" \
  --output-format streaming-json \
  --always-approve \
  --max-turns 1 \
  -m grok-build \
  2>/tmp/grok-err.txt | tee /tmp/grok-stream-sample.jsonl
```

Save a redacted copy of event shapes into the test fixtures:
`backend/src/services/ai/fixtures/grok-build-stream-sample.jsonl`

If streaming-json schema is unclear, also capture:

```bash
grok -p "Reply with exactly: hello-agnt" --output-format json --always-approve --max-turns 1
```

- [ ] **Step 2: Write parser tests against the fixture**

Assert: final assistant text extracted, session id captured if present, non-zero exit without text → throws.

- [ ] **Step 3: Implement service**

Key spawn args (v1 defaults):

```js
const args = [
  '-p', promptStr,                 // or --prompt-file for long prompts
  '--output-format', 'streaming-json',
  '--always-approve',              // AGNT is the outer approval layer
  '--no-plan',
  '--max-turns', String(maxTurns ?? 30),
];
if (model) args.push('-m', model);
if (cwd) args.push('--cwd', cwd);
if (resumeSessionId) args.push('--resume', resumeSessionId);
if (effort) args.push('--effort', effort);
// Optional safety defaults for orchestrator tool path:
// args.push('--disallowed-tools', 'run_terminal_cmd'); // only if caller wants read-only
```

Long prompts: write to temp file and use `--prompt-file` (avoids OS arg limits).

Default workdir:

```js
const DEFAULT_GROK_WORKDIR =
  process.env.AGNT_GROK_WORKDIR ||
  path.join(os.homedir(), 'services', 'agnt-grok-work');
```

Return shape (match Codex for drop-in tool wiring):

```js
{
  text: string,
  sessionId: string | null,  // Grok session id for --resume
  usage: object | null,
  exitCode: number,
  stderr: string | null,
  rawEvents?: object[],      // debug only
}
```

Parser strategy:
1. Prefer `streaming-json` line events; accumulate assistant message deltas.
2. On parse failure, fall back to treating stdout as plain text.
3. Map common event field names defensively (`type`, `event`, `message`, `delta`, `session_id`, `sessionId`).

- [ ] **Step 4: Run unit tests**

```bash
cd /Users/tom/.agnt-server/backend && npm test -- GrokBuildCliService.test.js
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/ai/GrokBuildCliService.js \
        backend/src/services/ai/GrokBuildCliService.test.js \
        backend/src/services/ai/fixtures/grok-build-stream-sample.jsonl
git commit -m "feat(grok-build): add headless CLI service with streaming-json parser"
```

---

### Task 4: Session manager + OpenAI-compat client

**Files:**
- Create: `backend/src/services/ai/GrokBuildCliSessionManager.js`
- Create: `backend/src/services/ai/GrokBuildCliClient.js`
- Modify: `backend/src/services/ai/LlmService.js`

- [ ] **Step 1: Session manager**

Copy `CodexCliSessionManager.js` → rename class/exports. Keep using `CodexThreadModel` **or** generalize provider field (already stores provider in session key). Session key format:

```
grok-build::user::<userId>::conversation::<conversationId>
```

Methods: `getSessionKey`, `getThreadId` (stores Grok session id), `setThreadId`.

- [ ] **Step 2: Client factory**

Copy `CodexCliClient.js` patterns:
- `messagesToGrokPrompt(messages)` — flatten roles into one prompt string
- stream path: async queue of OpenAI-style `{ choices: [{ delta: { content } }] }`
- non-stream: single completion object
- set `__provider: 'grok-build'`

- [ ] **Step 3: Wire LlmService**

In `_createSpecialAuthClient` (or wherever `openai-codex` returns a CLI client — note Codex currently uses HTTP OAuth for chat; AGNT’s **tool** path uses CLI. For Grok Build we always want CLI):

Find where chat clients are created for providers. Add:

```js
if (lowerCaseProvider === 'grok-build') {
  const status = await GrokBuildAuthManager.checkApiUsable();
  if (!status.apiUsable) {
    throw new Error(
      'Grok Build CLI is not authenticated. Run: grok login --oauth (or connect via Settings).'
    );
  }
  return createGrokBuildCliClient({
    defaultModel: process.env.AGNT_GROK_DEFAULT_MODEL || 'grok-build',
    cwd: options.cwd || GrokBuildCliService.getDefaultWorkdir(),
    userId: options.userId,
    conversationId: options.conversationId,
    authToken: options.authToken,
    fullAuto: true,
  });
}
```

Also ensure model listing for `grok-build` returns at least `['grok-build']` (static fallback from providerConfigs) and optionally shells `grok models` when authenticated.

- [ ] **Step 4: Commit**

```bash
git add backend/src/services/ai/GrokBuildCliSessionManager.js \
        backend/src/services/ai/GrokBuildCliClient.js \
        backend/src/services/ai/LlmService.js
git commit -m "feat(grok-build): OpenAI-compat client and LlmService wiring"
```

---

### Task 5: Orchestrator tool `grok_exec`

**Files:**
- Modify: `backend/src/services/orchestrator/tools.js`
- Modify: `backend/src/services/orchestrator/toolSelector.js`

- [ ] **Step 1: Add tool definition** (clone `codex_exec` block)

```js
grok_exec: {
  schema: {
    type: 'function',
    function: {
      name: 'grok_exec',
      description:
        'Runs a prompt using the local Grok Build CLI (xAI). Requires `grok` installed and authenticated (`grok login`). Best for multi-file coding tasks, refactors, and repo-aware edits inside a sandboxed workdir.',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'Task prompt for Grok Build.' },
          model: {
            type: 'string',
            description: "Model id (default 'grok-build').",
          },
          cwd: {
            type: 'string',
            description: 'Working directory. Defaults to AGNT_GROK_WORKDIR sandbox.',
          },
          resume: { type: 'boolean', default: true },
          sessionScope: {
            type: 'string',
            enum: ['conversation', 'user'],
            default: 'conversation',
          },
          sessionId: {
            type: 'string',
            description: 'Explicit Grok session id to --resume.',
          },
          alwaysApprove: {
            type: 'boolean',
            default: true,
            description: 'Pass --always-approve (default true).',
          },
          maxTurns: { type: 'number', default: 30 },
          effort: {
            type: 'string',
            enum: ['low', 'medium', 'high', 'xhigh', 'max'],
          },
          readOnly: {
            type: 'boolean',
            default: false,
            description:
              'If true, restrict tools to read_file,grep,list_dir (no shell/edits).',
          },
          extraArgs: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        required: ['prompt'],
      },
    },
  },
  execute: async (args, authToken, context) => {
    // 1. check GrokBuildAuthManager.getAccessToken / checkApiUsable
    // 2. resolve cwd (default sandbox)
    // 3. session key via GrokBuildCliSessionManager
    // 4. GrokBuildCliService.run(...); persist sessionId
    // 5. return JSON { success, text, sessionId, model, cwd, usage }
  },
},
```

- [ ] **Step 2: Register in toolSelector** next to `codex_exec`

- [ ] **Step 3: Commit**

```bash
git add backend/src/services/orchestrator/tools.js backend/src/services/orchestrator/toolSelector.js
git commit -m "feat(grok-build): add grok_exec orchestrator tool"
```

---

### Task 6: Frontend — local provider visibility + health

**Files:**
- Modify: `frontend/src/store/auth/appAuth.js`
- Modify: `frontend/src/store/app/aiProvider.js`
- Modify: `frontend/src/views/Terminal/CenterPanel/screens/Connectors/Connectors.vue` (connect branch if needed)
- Modify: `frontend/src/views/Terminal/RightPanel/types/ChatPanel/components/IntegrationHealth.vue` (optional label)
- Modify: `frontend/src/views/Terminal/CenterPanel/screens/Chat/components/ProviderSetup.vue` (optional)

- [ ] **Step 1: appAuth**

```js
const CLI_PROVIDER_IDS = [
  'openai-codex',
  'claude-code',
  'gemini-cli',
  'antigravity',
  'grok-build',
];
```

Inject local provider card:

```js
{
  id: 'grok-build',
  name: 'Grok Build',
  icon: 'grok', // or 'xai' — reuse existing asset if any, else text fallback
  categories: ['AI'],
  connectionType: 'oauth',
  instructions:
    'Uses the local Grok Build CLI (~/.grok). Sign in with grok login (OAuth or device code). Separate from the Grok AI API key provider.',
  localOnly: true,
},
```

- [ ] **Step 2: aiProvider.js**

```js
{ key: 'grok-build', displayName: 'Grok-Build' },
```

Add to every `isLocalProvider` / `CLI_KEYS` array that lists `openai-codex`.

- [ ] **Step 3: Connect UX**

Reuse Codex device-auth UI path: `startProviderDeviceAuth('grok-build')` → poll → refresh health.  
Fallback copy if device code parse fails: “Run `grok login --oauth` in a terminal, then click Refresh.”

- [ ] **Step 4: Commit**

```bash
git add frontend/src/store/auth/appAuth.js frontend/src/store/app/aiProvider.js \
  frontend/src/views/Terminal/CenterPanel/screens/Connectors/Connectors.vue \
  frontend/src/views/Terminal/CenterPanel/screens/Chat/components/ProviderSetup.vue \
  frontend/src/views/Terminal/RightPanel/types/ChatPanel/components/IntegrationHealth.vue
git commit -m "feat(grok-build): expose Grok Build as local CLI provider in UI"
```

---

### Task 7: Env docs + defaults

**Files:**
- Modify: `backend/.env.example` (or create notes in plan README)
- Optionally set in local `.env` (do **not** commit secrets)

```bash
# Grok Build CLI connector
GROK_BIN=/Users/tom/.local/bin/grok
GROK_HOME=/Users/tom/.grok
AGNT_GROK_WORKDIR=/Users/tom/services/agnt-grok-work
AGNT_GROK_DEFAULT_MODEL=grok-build
# Optional fallback if CLI OIDC unavailable:
# XAI_API_KEY=xai-...
```

- [ ] **Step 1: Ensure sandbox workdir exists**

```bash
mkdir -p /Users/tom/services/agnt-grok-work
```

- [ ] **Step 2: Commit env example only**

```bash
git add backend/.env.example
git commit -m "docs(grok-build): document CLI env vars"
```

---

### Task 8: End-to-end verification

- [ ] **Step 1: Re-auth CLI**

```bash
grok login --oauth
grok models
```

Expected: lists `grok-build` without “not authenticated”.

- [ ] **Step 2: Restart AGNT backend** so new modules load.

- [ ] **Step 3: Auth status API**

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  http://localhost:3333/api/providers/grok-build/auth/status | jq
```

Expected: `available: true`, `apiUsable: true`.

- [ ] **Step 4: Connection health**

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  http://localhost:3333/api/users/connection-health | jq '.data.providers[] | select(.provider=="grok-build")'
```

Expected: `status: "healthy"`.

- [ ] **Step 5: Tool path**

In Annie chat (any model with tools):

> Use grok_exec with prompt: "In the current workdir, create hello.txt containing hi" and cwd set to the grok sandbox.

Expected: `hello.txt` appears under `AGNT_GROK_WORKDIR`, tool returns success text.

- [ ] **Step 6: Provider path**

Select provider **Grok-Build** / model `grok-build` in chat. Send “What is 2+2?”. Expect streamed answer.

- [ ] **Step 7: Disconnect / reconnect**

Settings → Grok Build → Disconnect → status unhealthy → Device login / `grok login` → healthy again.

- [ ] **Step 8: Commit any parser fixes discovered during E2E**

```bash
git add -A
git commit -m "fix(grok-build): align streaming-json parser with live CLI output"
```

---

### Task 9: Hardening (same PR or fast follow)

- [ ] **Timeouts:** kill spawn after `AGNT_GROK_TIMEOUT_MS` (default 15 min); surface partial text.
- [ ] **Concurrency:** max 1–2 concurrent `grok` children per user (CLI is heavy).
- [ ] **Prompt size:** auto `--prompt-file` when prompt > 80KB.
- [ ] **Redaction:** never log `auth.json` contents or bearer tokens.
- [ ] **Read-only default for untrusted prompts:** orchestrator may set `readOnly: true` unless user opts into edits.
- [ ] **Version gate:** if `grok --version` < 0.1.200, warn about missing flags.
- [ ] **Distinguish from grokai** in UI copy everywhere (“CLI subscription” vs “API key”).

---

## Implementation order (summary)

```
1 providerConfigs + AuthDispatcher scheme
2 GrokBuildAuthManager + tests
3 GrokBuildCliService + fixtures/tests
4 SessionManager + CliClient + LlmService
5 grok_exec tool + toolSelector
6 Frontend local provider lists + connect UX
7 Env / sandbox workdir
8 E2E (re-login first)
9 Hardening
```

---

## Risk register

| Risk | Mitigation |
|---|---|
| OIDC expired / refresh fails silently | `checkApiUsable` shells `grok models`; surface reconnect CTA |
| streaming-json schema drifts | Fixture tests + plain-text fallback |
| CLI uploads whole repo | Default sandbox workdir; document risk; optional `--tools` allowlist |
| Confuse with `grokai` | Separate keys, names, instructions |
| `grok login --device-auth` output hard to parse | Fallback: manual terminal login + Refresh button |
| Long-running agents block event loop | spawn + streaming; timeout; concurrency cap |
| Windows path/bin differences | Same candidate path list as Codex; `GROK_BIN` override |

---

## Done criteria

1. Settings shows **Grok Build** as local connector with healthy/unhealthy status.
2. `GET /api/providers/grok-build/auth/status` reflects real CLI auth.
3. Annie can call `grok_exec` and get a completion from the local binary.
4. Chat can use provider `grok-build` / model `grok-build` end-to-end.
5. `grokai` API provider still works unchanged.
6. Unit tests for auth + stream parser pass without network.

---

## Quick reference — commands the connector will shell

```bash
# status probe
grok models

# headless task
grok -p "<prompt>" -m grok-build \
  --output-format streaming-json \
  --always-approve \
  --no-plan \
  --cwd "$AGNT_GROK_WORKDIR" \
  --max-turns 30

# resume
grok -p "<prompt>" --resume "$SESSION_ID" --output-format streaming-json --always-approve

# auth
grok login --oauth
grok login --device-auth
grok logout
```
