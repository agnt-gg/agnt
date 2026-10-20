# Source-checkout npm shortcuts

Use Node 20+ and install root and frontend dependencies as described in
[CONTRIBUTING.md](../CONTRIBUTING.md). npm is the only command interface;
no Justfile or extra executable is required.

| Command | Action |
| --- | --- |
| `npm run build:frontend` | Run the existing frontend production build once. |
| `npm run dev:frontend` | Run the existing Vite development server. |
| `npm run app:status` | Read the local backend status and health endpoints. |

Frontend arguments are forwarded: `npm run dev:frontend -- --host 127.0.0.1`
or `npm run build:frontend -- --mode production`. The frontend scripts retain
control of Vite and its memory settings. Child failures remain nonzero; these
aliases do not load `.env` themselves (Vite still applies its normal env rules).

Existing commands are unchanged: `npm run build` packages the desktop app,
`npm run dev` runs the backend, and `npm start` launches Electron. A frontend
build neither restarts the backend nor reloads an already-open renderer.
Development still needs two terminals: `npm run dev:frontend` and `npm start`.

## Backend status

`npm run app:status -- --json` returns machine-readable output (use
`npm --silent run app:status -- --json` to suppress npm's banner).
Optional `--url http://127.0.0.1:3334` selects another local backend; only plain
IPv4 loopback HTTP origins are accepted. `--timeout-ms 3000` sets the total
request deadline (100–30000 ms). `--help` requires no running backend.

The helper performs GETs to `/api/system/status` and `/api/health`, sends no
credentials, does not read credential files or `.env`, and does not follow
redirects. It works without Linux `/proc` or a supervisor socket. JSON includes
`success`, `url`, `state`, `pid`, `uptimeMs`, and `healthy`. Errors report
`success: false` and a bounded diagnostic, never the response body.

Exit 0 means the backend was running and health reported the same PID. Draining,
an unavailable backend, timeout, malformed response or disagreeing health is
exit 1. A drain/restart between the two reads can produce a mismatch; rerun
status to get a new observation. This is a snapshot, not a readiness monitor.
It does not establish checkout ownership, frontend readiness, or ability to
restart. There is no restart command or alternate authorization mechanism in
these shortcuts.

Tests are part of the existing backend Vitest gate:
`npm test -- scripts/npm-shortcuts.test.js`. They use disposable npm recorders
and loopback HTTP fixtures; they never build, launch or restart the real app.
