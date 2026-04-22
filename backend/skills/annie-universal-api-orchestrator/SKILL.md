---
name: annie-universal-api-orchestrator
description: Use AGNT's stored OAuth tokens and API keys to call ANY third-party API directly from the orchestrator, without building a tool or plugin first. Use this skill whenever the user asks you to "do something with my GitHub / Gmail / Drive / Slack / Notion / Stripe / Shopify / Discord / Linear / Jira / Vercel / Netlify / [any connected provider]", wants one-off data pulled from a service they're already authenticated to, says things like "check my X", "pull my Y", "list my Z", "can you see my...", "grab data from my...", or anything that requires calling an external API on their behalf. Also trigger when the user wants to prototype an integration, explore a provider's API surface, or do something no existing AGNT tool covers but their credentials already exist in the AGNT auth vault. This is the fastest path to action — skip plugin-building entirely for read-only queries, ad-hoc reports, dashboards, and exploratory work.
---

# Annie Universal API Orchestrator

## What this skill does

AGNT stores the user's OAuth tokens and API keys in a credential vault (managed by `AuthManager`). Normally, plugins and workflow tools are the "approved hands" that reach into the vault for specific purposes. But the orchestrator runs inside the same Node.js process as the AGNT backend, which means it can bypass the tool layer entirely: dynamically `import()` AuthManager, request a valid token for any connected provider, and call that provider's API directly with `fetch`.

This turns the orchestrator into a just-in-time bridge to any API the user has authorized — with zero plugin-building, zero workflow authoring, and zero reinstalls required.

---

## ⚠️ Which runtime — READ THIS FIRST

This skill is ONLY for the orchestrator tool `execute_javascript_code`. It will NOT work inside the workflow-node tool `execute_javascript`, which runs in a sandboxed VM that blocks `import()` entirely.

| Tool | Runtime | Dynamic `import()` | Top-level `await` | File system / AuthManager | Use this skill? |
|---|---|---|---|---|---|
| **`execute_javascript_code`** (chat / orchestrator) | Full Node.js, same process as AGNT backend | ✅ Works | ✅ Works | ✅ Direct | ✅ **YES** |
| **`execute_javascript`** (workflow node) | Sandboxed VM | ❌ `Execution Error: Dynamic Import not supported` | ❌ | ❌ No module loader | ❌ **NO** — see fallback section below |

**Failure signature if you pick the wrong one:**
```
Execution Error: Dynamic Import not supported
```

If you see that error, you're in the workflow-node sandbox. Either switch to `execute_javascript_code` (orchestrator context) or use the HTTP fallback documented at the end of this skill.

---

## When to use this vs. building a plugin

Use this pattern when:
- The user wants a **one-off** query, report, or action (e.g., "what's in my GitHub issues?", "show me my Stripe revenue this month")
- The user is **exploring** an API or prototyping an integration
- A plugin doesn't exist yet and building one would be overkill for the task
- The task involves **novel aggregation** across multiple endpoints that no single tool exposes
- The user wants to **fan out** many API calls in parallel inside one custom script

Prefer building a plugin (via the `agnt-plugin-builder` skill) when:
- The behavior needs to be reused across many workflows or by other users
- The integration needs UI-facing configuration forms
- Other agents need to discover and call it as a named tool

## The core pattern

Every invocation follows the same five steps:

### Step 1 — Identify the user

All credentials are scoped by `userId`.

**The `process.env.AGNT_AUTH_TOKEN` is a JWT that contains the userId in its payload.** This is the canonical source of truth — it's always present in the orchestrator runtime, never stale, and bound to the current session. Decode it:

```js
const [, payload] = process.env.AGNT_AUTH_TOKEN.split('.');
const userId = JSON.parse(Buffer.from(payload, 'base64url')).userId;
```

Optional shortcut: if you've previously stored the `userId` as an agent memory fact (`User's AGNT userId is ...`), you can read it from there to skip the decode. But **the JWT is always authoritative** — prefer it, especially if memory and JWT disagree.

Do **not** rely on `process.env.AGNT_USER_ID` — it is not guaranteed to be populated in all execution contexts.

### Step 2 — Import AuthManager (read this carefully — three gotchas)

`AuthManager` lives at:
```
C:/Users/Studio/Documents/DevelopmentProjects/AGNT/repos/agnt-pro/backend/src/services/auth/AuthManager.js
```

Because the orchestrator's JavaScript runs in Node on the same machine as the backend, you can dynamically `import()` this file directly. Three gotchas, all of which will burn you if you skip them:

- **No top-level static `import` statements.** The `execute_javascript_code` eval context is not an ES module — `import X from 'y'` at the top of the script is a hard `SyntaxError`. Always use `await import(...)` (dynamic import) instead. Top-level `await` works, but the static `import` syntax does not.
- **Windows absolute paths need `file://` URLs.** Dynamic imports reject raw `C:/...` paths with `ERR_UNSUPPORTED_ESM_URL_SCHEME`. Use `pathToFileURL` from `node:url`.
- **AuthManager is a `default` export, not a named export.** You read it off `.default` after importing.

The only correct shape:

```js
const { pathToFileURL } = await import('url');
const authPath = pathToFileURL(
  'C:/Users/Studio/Documents/DevelopmentProjects/AGNT/repos/agnt-pro/backend/src/services/auth/AuthManager.js'
).href;
const AuthManager = (await import(authPath)).default;
```

### Step 3 — Request a valid token

```js
const token = await AuthManager.getValidAccessToken(userId, providerName);
if (!token) {
  throw new Error(`No ${providerName} credentials found. The user needs to connect ${providerName} in AGNT first.`);
}
```

`getValidAccessToken` handles a lot for you:
- Looks up credentials for `providerName` scoped to `userId`
- **Auto-refreshes** expired OAuth tokens using the refresh token
- Normalizes OAuth, personal access tokens, and raw API keys behind one interface
- Returns a falsy value if the user hasn't connected that provider — always check for this

Common provider names: `github`, `google`, `slack`, `notion`, `stripe`, `shopify`, `discord`, `linear`, `jira`, `vercel`, `netlify`, `openai`, `anthropic`, `figma`, `airtable`. If you're unsure, list what's connected by calling the `/api/auth/connected-apps` AGNT endpoint first (see the end of this file).

### Step 4 — Call the provider's API

From here it's just `fetch`. Build a tiny helper and go:

```js
async function callApi(endpoint) {
  const res = await fetch('https://api.github.com' + endpoint, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'AGNT-Annie'
    }
  });
  if (!res.ok) return { error: res.status, message: await res.text() };
  return res.json();
}
```

Fan out with `Promise.all` whenever you need data from multiple endpoints — this is where the pattern really shines compared to sequential tool calls.

### Step 5 — Show your work first, then run

The user prefers a **draft-and-approve workflow** for any non-trivial operation. Always:

1. Write the full code in a chat code block first
2. Explicitly note that the token will never leave the Node process (no logging, no sending back as text)
3. Wait for approval before executing
4. For destructive/write operations (POST/PATCH/PUT/DELETE), this is non-negotiable

For obviously read-only exploratory calls where the user has already said "go" or "do it," you can skip the draft step — but err on the side of showing the code.

## Full working template

Use this as the starting skeleton for any new integration. Swap the provider name, the API base URL, and the endpoints. Note: **every** import here uses `await import(...)` — there are no static `import` statements anywhere:

```js
// Step 0: dynamic imports only — no `import X from 'y'` at top level
const { pathToFileURL } = await import('url');

// Step 1: userId (prefer memory; fall back to JWT)
const userId = 'FROM_MEMORY_OR_JWT';

// Step 2: Import AuthManager (default export, file:// URL on Windows)
const authPath = pathToFileURL(
  'C:/Users/Studio/Documents/DevelopmentProjects/AGNT/repos/agnt-pro/backend/src/services/auth/AuthManager.js'
).href;
const AuthManager = (await import(authPath)).default;

// Step 3: Get a valid token for the provider
const PROVIDER = 'github'; // or google, slack, stripe, etc.
const token = await AuthManager.getValidAccessToken(userId, PROVIDER);
if (!token) {
  console.log(JSON.stringify({ error: `No ${PROVIDER} credentials connected.` }));
} else {
  // Step 4: Call the API
  async function api(endpoint, opts = {}) {
    const res = await fetch('https://api.example.com' + endpoint, {
      ...opts,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
        'User-Agent': 'AGNT-Annie',
        ...(opts.headers || {})
      }
    });
    if (!res.ok) return { __error: res.status, __message: (await res.text()).slice(0, 500) };
    return res.json();
  }

  // Fan out in parallel wherever possible
  const [a, b, c] = await Promise.all([
    api('/endpoint-one'),
    api('/endpoint-two'),
    api('/endpoint-three')
  ]);

  // Aggregate, render, respond
  console.log(JSON.stringify({ a, b, c }, null, 2));
}
```

## Security posture (say this to the user, briefly)

- The token is retrieved **inside the Node process** — it never enters the LLM context, never gets printed, never leaks to the chat transcript.
- The orchestrator can only reach providers the user explicitly connected via AGNT's OAuth flow (or where they stored an API key).
- `getValidAccessToken` enforces the OAuth scopes granted at connection time — it can't request more access than the user approved.
- Everything runs on localhost — no data leaves the machine except the direct API call to the provider itself.

Mentioning this briefly when first using the pattern on a new provider builds user trust without being overbearing.

## Authentication-header variations

Not every provider uses `Authorization: Bearer`. A few you'll encounter:

| Provider family | Header pattern |
|---|---|
| GitHub, GitLab, most OAuth2 APIs | `Authorization: Bearer <token>` |
| Notion | `Authorization: Bearer <token>` + `Notion-Version: 2022-06-28` |
| Slack | `Authorization: Bearer <token>` |
| Google APIs | `Authorization: Bearer <token>` (access_token from OAuth) |
| Stripe | `Authorization: Bearer <token>` (API key) |
| Shopify Admin API | `X-Shopify-Access-Token: <token>` |
| Airtable | `Authorization: Bearer <token>` |
| Discord Bot | `Authorization: Bot <token>` |
| Discord User OAuth | `Authorization: Bearer <token>` |

When in doubt, check the provider's API docs with `web_search` + `web_scrape` before writing the call. Don't guess — a wrong header shape will return a 401 that looks identical whether the token is missing or the header is misnamed.

## Rendering the result

A raw JSON dump is almost never the right final answer. After the data comes back, synthesize it:

- **Tabular data** → markdown table
- **Aggregates / dashboards** → inline `html` code block with the AGNT design language (dark panels, pink/cyan/green/gold accents, base-2 spacing scale)
- **Time series** → `chartjs` code block
- **Custom visualizations** → `d3` or `threejs` code block
- **Single-value lookups** → one clean sentence

The value of this pattern isn't just "I called an API" — it's "I called several APIs in parallel, aggregated them, and handed the user something they can actually use."

## Anti-patterns

- **Don't build a plugin for a one-off question.** If the user just wants to know something, this pattern beats plugin-building by 10x on time-to-answer.
- **Don't chain sequential `fetch` calls** when `Promise.all` would do. The orchestrator can easily fire 10+ parallel calls; use that power.
- **Don't swallow errors silently.** Always log the status code and a short error message snippet — 401s, 403s, and rate-limit 429s all look different and need different responses.
- **Don't log the token.** Not even for debugging. Log `token.length` if you need to confirm it was retrieved.
- **Don't skip the draft-and-approve step for write operations.** Creating repos, sending messages, charging cards — the user sees the code first, period.
- **Don't use this skill inside `execute_javascript` (workflow node).** That sandbox blocks `import()`. Use the HTTP fallback at the end of this file instead.

## When you're not sure if the user has a provider connected

Call the AGNT connected-apps endpoint using the orchestrator's `process.env.AGNT_AUTH_TOKEN`:

```js
const res = await fetch('http://localhost:3333/api/auth/connected-apps', {
  headers: { 'Authorization': `Bearer ${process.env.AGNT_AUTH_TOKEN}` }
});
const connected = await res.json();
console.log(connected); // see what's available
```

This avoids the awkward "I tried but you haven't connected X" round-trip.

## Gotchas learned the hard way

These are the failure modes that have burned us in real runs. Internalize them — each has a ❌ form that looks plausible and a ✅ form that actually works:

### 1. Top-level static `import` → SyntaxError

The `execute_javascript_code` runtime is NOT an ES module. Static `import` statements at the top of the script fail with a syntax error, not a friendly runtime message.

```js
// ❌ WRONG — hard SyntaxError
import { pathToFileURL } from 'url';
import { AuthManager } from 'some/path.js';

// ✅ RIGHT — dynamic import with top-level await
const { pathToFileURL } = await import('url');
const AuthManager = (await import(authPath)).default;
```

### 2. Windows absolute path as import specifier → ERR_UNSUPPORTED_ESM_URL_SCHEME

Node's ESM loader rejects raw Windows paths. Convert to a `file://` URL first.

```js
// ❌ WRONG
const mod = await import('C:/Users/.../AuthManager.js');

// ✅ RIGHT
const { pathToFileURL } = await import('url');
const href = pathToFileURL('C:/Users/.../AuthManager.js').href;
const mod = await import(href);
```

### 3. Destructuring a default export → undefined

AuthManager is exported as `export default AuthManager`, not `export { AuthManager }`. Destructuring a named export that doesn't exist silently gives you `undefined` and then crashes later with `Cannot read properties of undefined (reading 'getValidAccessToken')`.

```js
// ❌ WRONG — AuthManager is undefined, fails on the next line
const { AuthManager } = await import(authPath);
const token = await AuthManager.getValidAccessToken(userId, 'github');

// ✅ RIGHT
const AuthManager = (await import(authPath)).default;
```

### 4. Wrong AuthManager path

Make sure you use the correct, verified path. An older incorrect memory had `src/auth/AuthManager.js` — that path does NOT exist on disk and will throw `ERR_MODULE_NOT_FOUND`.

```js
// ❌ WRONG — this path does not exist
'C:/Users/Studio/Documents/DevelopmentProjects/AGNT/repos/agnt-pro/backend/src/auth/AuthManager.js'

// ✅ CORRECT
'C:/Users/Studio/Documents/DevelopmentProjects/AGNT/repos/agnt-pro/backend/src/services/auth/AuthManager.js'
```

If `ERR_MODULE_NOT_FOUND` appears, don't start guessing — confirm the path first:

```js
const { execSync } = await import('child_process');
console.log(execSync(
  'where /r C:\\Users\\Studio\\Documents\\DevelopmentProjects\\AGNT AuthManager.js',
  { encoding: 'utf8' }
));
```

### 5. `execute_javascript` (workflow node) blocks dynamic `import()`

The workflow-node JavaScript tool is NOT the same runtime as the chat orchestrator. It is a sandboxed VM that blocks module loading entirely.

**Failure signature:**
```
Execution Error: Dynamic Import not supported
```

If you see that error, you are in the wrong runtime. This skill's pattern cannot work there — the sandbox has no module system, no file access, no way to reach AuthManager. The fix is to use the HTTP fallback (below) or switch back to the orchestrator context (`execute_javascript_code`).

### Debug tip: when in doubt, log the module keys

If an import succeeds but something feels off (wrong shape, missing methods), log the module's keys immediately. This catches named-vs-default export mistakes in one line:

```js
const mod = await import(authPath);
console.log('Module keys:', Object.keys(mod));        // e.g. [ 'default' ]
console.log('Has method:', typeof mod.default?.getValidAccessToken);
```

---

## Workflow-node fallback (for `execute_javascript` only)

If you are running inside a workflow node and can't import AuthManager, you can still reach user-connected APIs — but only via HTTP calls to the AGNT backend, which proxies through AuthManager for you.

The workflow sandbox typically has `process.env.AGNT_AUTH_TOKEN` available (or an equivalent). Use it to hit AGNT's backend, which in turn can call providers with the user's stored credentials.

Sketch:

```js
// Inside execute_javascript (workflow node) — no imports, no file access
const r = await fetch('http://localhost:3333/api/auth/connected-apps', {
  headers: { 'Authorization': 'Bearer ' + process.env.AGNT_AUTH_TOKEN }
});
const apps = await r.json();
return { apps };
```

For actually proxying a provider API call, the right move in the workflow-node context is usually to:

1. Expose an AGNT backend route that accepts `{ provider, endpoint, method, body }` and internally does the `AuthManager.getValidAccessToken` + `fetch` dance server-side.
2. Have the workflow node call that route.

If no such route exists yet and the user needs this often, that's a strong signal to build a real plugin (via the `agnt-plugin-builder` skill) rather than keep hacking at the sandbox.

**Bottom line:** this skill is orchestrator-first. Workflow-node callers should either use an existing plugin, build a new one, or have the orchestrator do the work and pipe results into the workflow.
