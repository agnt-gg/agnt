# Local app lifecycle with npm

Tracks #121 and [design issue #134](https://github.com/agnt-gg/agnt/issues/134).
**Review gate:** the OS-user control channel introduces a local authorization
mechanism. This patch is submitted for explicit maintainer architecture review;
issue #134 is not evidence of approval under CONTRIBUTING.md.

## Commands

| Command | Meaning |
| --- | --- |
| `npm run app:status` | Read backend health, PID, checkout and Electron ownership |
| `npm run restart:backend` | Select API/local transport, restart once, verify recovery |
| `npm run build:frontend` | Existing frontend production build |
| `npm run dev:frontend` | Existing foreground Vite dev server |

`npm start`, root `npm run dev`, desktop packaging and Docker commands retain
their meaning. Do not start another instance on port 3333. Building frontend
assets, reloading Electron's renderer and restarting a Vite server are distinct.

## Two caller paths

- **AGNT/API caller:** a supplied `AGNT_AUTH_TOKEN` or AGNT context
  (`AGNT_CONVERSATION_ID` / `AGNT_TOOL_RUNNER`) selects the authenticated HTTP API.
  Missing/malformed API credentials refuse. HTTP 401/403 never falls back to
  local control. Tokens are inherited, not read from storage or printed.
- **Ordinary terminal, e.g. Ghostty:** with no supplied token or AGNT context,
  use the private Electron supervisor socket, authorized by OS directory/socket
  permissions. No application-token copying or export is needed.

`--transport auto|api|local` makes selection explicit. `local` refuses supplied
credentials or AGNT context rather than downgrading an API caller. An empty
but present token counts as supplied and is rejected.

**Activation:** quit and relaunch the desktop app once after installing the new
Electron code. A backend-only restart cannot reload Electron's main process.
Until then local commands fail with relaunch guidance before sending a request.

```sh
npm run app:status -- --json
npm run restart:backend
npm run restart:backend -- --transport local --preflight --json
npm run restart:backend -- --timeout-ms 90000
```

The helper uses its own source checkout, not the shell working directory.
Only explicit IPv4 loopback origins such as `http://127.0.0.1:3333` are accepted;
use `--url http://127.0.0.1:PORT` for another port. No URL credentials, redirects,
remote requests, .env loading or inferred shell PORT. JSON can be obtained without
npm's banner using `npm --silent run ...`.

## Ownership and recovery

Both restart routes require **Linux source-checkout Electron** ownership:
backend cwd/argv/start identity/listening socket and direct Electron parent
cwd/executable/start identity are checked through /proc. Standalone, packaged,
container, remote, ambiguous or inaccessible ownership refuses. Status remains
read-only and can report healthy but unknown ownership; it does not grant
permission to restart. Unsupported local-control platforms fail explicitly.

The API route sends one authenticated POST to the existing endpoint. HTTP 202
means accepted, not recovered. Success requires a new PID with running status
and matching health, under the same source checkout and supervisor identity.
Electron's existing supervisor initiates renderer reload, but API success does
not certify renderer load completion.

The local route uses a checkout-hash/supervisor-PID directory beneath
`/run/user/UID` (private 0700 directory, 0600 socket). It validates OS ownership,
path type and permissions; an existing socket is never replaced. Requests bind
checkout, supervisor and owned backend PID. The supervisor signals only its
owned ChildProcess with SIGTERM, using the existing graceful shutdown handler;
no PID-search kill or backend SIGKILL fallback. The intentional successful exit
uses existing exit-42 respawn behavior. Local success additionally waits for the
renderer `did-finish-load` event; failed/destroyed renderer is not success.

Requests are bounded and single-flight. A lost response or timeout is uncertain:
inspect status before retrying; there is no automatic retry or rollback. The CLI
operation deadline is 100–300000 ms, HTTP requests at most 3000 ms, local
supervisor recovery at most 60000 ms. A longer CLI timeout does not extend the
supervisor deadline. A disconnected caller does not cancel an accepted restart.

`--preflight` checks readiness without mutation. For local control it verifies a
live matching control server. API preflight checks token shape and ownership,
**not remote authentication**: there is no auth-only restart probe. It must not
report that an expired token was validated. Rebuild wrappers can preflight before
spending time on the build and must stop if either preflight or build fails.

## Security and evidence limits

OS permissions are the local authorization boundary, not AGNT HTTP auth.
No HTTP authentication or credential-store implementation is changed. This is
not protection against malicious code running as the same OS user. No explicit
peer-credential attestation is performed. Identity checks cannot atomically
close every filesystem/process race; same-UID interference, PID reuse/stale
runtime directories and startup/shutdown races warrant maintainer review.
Socket collisions fail rather than attempt broad stale cleanup. There is no
bound on the number of same-user client connections. The code is not presented
as independently security-audited.

Tests use Given/When/Then cases, ephemeral HTTP/socket fixtures and owned-child
controller events. The operator reports a successful real Ghostty `just restart`
after desktop relaunch; a separate status check verified health and ownership.
That is not the same as CI proving real AGNT shell-tool token injection or every
production subsystem. See the PR description for exact test commands/results
and the distinction between disposable Electron tests and live observations.
