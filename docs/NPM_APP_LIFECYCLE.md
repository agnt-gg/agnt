# Local app lifecycle with npm

Tracking: [issue #121](https://github.com/agnt-gg/agnt/issues/121).

## Usage

From the source checkout that launched Electron:

```sh
npm run app:status
npm run app:status -- --json
# With an existing AGNT_AUTH_TOKEN securely supplied in your environment:
npm run restart:backend
npm run restart:backend -- --timeout-ms 90000
npm run build:frontend
npm run dev:frontend -- --host 127.0.0.1 --port 5173
```

Use `--url http://127.0.0.1:PORT` on either lifecycle command if this instance
uses a non-default port. The helper does not load `.env` or infer `PORT` from
your shell: the printed target is the exact target it probes. `--timeout-ms`
(100-300000) bounds the whole operation, including preflight; each HTTP request
is additionally capped at 3000 ms. `--json` produces structured output (use
`npm --silent run app:status -- --json` to suppress npm's own banner).

Status exits 0 for a running, healthy backend even when ownership is unknown;
inspect `ownership.verified` separately. Draining, errors and unverified
restart attempts exit nonzero. Help performs no network requests.

## Design packet

Keep npm as the existing task runner; do not add just, concurrently, a daemon,
or a second supervisor. Electron already owns its backend and interprets exit
code 42 as an intentional restart. The existing authenticated
`POST /api/system/restart` initiates drain; `GET /api/system/status` and
`GET /api/health` observe recovery. A 202 response is not proof of recovery.

Root entry points:

| Command | Operation |
| --- | --- |
| `npm run app:status` | Read backend state, health, PID, local checkout and supervision |
| `npm run restart:backend` | Request one verified Electron-supervised backend restart and wait |
| `npm run build:frontend` | Run the existing frontend production build |
| `npm run dev:frontend` | Run the existing Vite development server in this terminal |

Existing `npm start`, `npm run dev`, and Docker Make targets retain their
semantics. There is deliberately no npm `restart` lifecycle override and no
ambiguous "restart both" command. Building frontend files is not a backend
restart or a renderer reload. After building, reload the app window yourself.
The Vite command stays in the foreground; Ctrl+C stops your development server.
Do not start a second backend on port 3333.

## Ownership and safety contract

The helper acts on its own source checkout (resolved from the script, not the
caller's working directory). All requests use explicit IPv4 loopback
`http://127.0.0.1:3333` unless a different loopback port is supplied. Remote
origins, URL credentials, paths, queries, fragments, and HTTP redirects are
rejected. It never searches credential files, shells out to process-kill
commands, guesses a systemd unit, or invokes Docker.

Restart verification supports **Linux source-checkout Electron only** initially.
It verifies the backend command, cwd, process start time, listening socket,
and its direct parent's cwd, command, executable, and start time via `/proc`.
The parent must be this checkout's installed Electron executable. A plain
`npm run dev`, other checkout, packaged Electron, container, inaccessible
`/proc`, or unsupported OS is not restartable through this helper. Status
still reports health and explicitly distinguishes unknown ownership. Use the
existing app UI / installation supervisor for unsupported restart modes.
This is a local accident-prevention guard, not a security boundary against a
malicious process running as your own OS user. A process can exit between
preflight and POST; no client-only check can make those atomic.

The only credential input is the caller's existing `AGNT_AUTH_TOKEN`
environment variable (an AGNT application bearer token, not a provider key).
No token CLI argument, .env loading, login changes, token minting, or credential
storage is introduced. Do not paste tokens into shell history or PRs. Use your
existing secure environment injection. Auth errors are returned without
printing tokens or server response bodies.

## Failure and recovery

Restart requires valid running status and health, the token, and verified local
ownership **before** any POST. It sends at most one POST; network uncertainty
never causes a retry that might restart twice. A conflict, rejection, timeout,
malformed status or unavailable service exits nonzero with an actionable error.
After acceptance it polls across the expected connection gap. Success requires
a new backend PID, the same Electron supervisor identity and source checkout,
valid running status, and a healthy response. Same-PID health is insufficient.
Timeout does not imply rollback: inspect status before deciding to try again.

Requests and the overall recovery wait have finite deadlines. Status does not
send credentials or mutate the running instance. Frontend aliases simply
forward npm arguments and retain upstream behavior; they do not supervise or
restart an existing Vite process.

## Verification plan

Tests belong to the existing blocking root Vitest suite (`scripts/*.test.js`),
not the report-only node:test job. Cover parsing, invalid states, ownership
refusals, socket ownership, auth rejection, redirects, request deadlines,
transient recovery gaps, same-PID timeout, and CLI exit/output behavior.
Use ephemeral loopback HTTP fixtures and fake process records for deterministic
coverage. Read-only live status is separate from fixture restart evidence.
Never target the contributor's live port in a restart test.
