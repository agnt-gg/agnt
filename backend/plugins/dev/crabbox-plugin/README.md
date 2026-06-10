# Crabbox Plugin

OpenClaw Crabbox support for AGNT workflows: run remote validation commands and
collect E2E proof from a workflow node.

Crabbox is a remote execution control plane from OpenClaw. A `crabbox run`
leases or reuses a machine, syncs the current checkout, runs a command, streams
output, and reports run metadata such as provider, lease id, run id, timing, and
exit code. [crabbox.sh](https://crabbox.sh/) is the OpenClaw Crabbox docs site;
the plugin calls the local `crabbox` CLI documented there.

## Setup

Install the Crabbox CLI on the machine running AGNT:

```bash
brew install openclaw/tap/crabbox
crabbox --version
crabbox doctor
```

The plugin resolves the binary from the `CRABBOX_BIN` environment variable, or
`crabbox` on `PATH`. The binary path is intentionally **not** a node parameter:
workflow parameters are user/agent-controlled, and a configurable binary would
let any workflow author execute arbitrary programs on the host.

### Credentials

Connect Crabbox in **Settings → Integrations** with your Crabbox broker API
key (`authProvider: crabbox`). The token is passed to the CLI as
`CRABBOX_TOKEN` per execution, scoped to the workflow's user. The node never
uses the server's ambient `crabbox login` state, so on a shared instance each
user runs as themselves rather than as the server.

### Environment isolation

The Crabbox CLI is spawned with a minimal environment allowlist (`PATH`,
`HOME`, `USERPROFILE`, temp dirs, and explicit `CRABBOX_*` variables) — it does
not inherit the AGNT server environment, so workflow inputs cannot exfiltrate
server secrets. This also bounds `allowEnv` (Crabbox `--allow-env`): the CLI
can only forward variables that exist in its own minimal environment, i.e.
`CRABBOX_*` ones. To send other values to the *remote* machine, use
`envFromProfile` (Crabbox `--env-from-profile`), which reads from a profile
file rather than the server environment.

## Actions

The plugin exposes one workflow action named `Crabbox`:

- `RUN`: execute a remote command through `crabbox run`.
- `WARMUP`: create a warm reusable lease.
- `JOB_RUN`: run a named repo-local Crabbox job from `.crabbox.yaml`.
- `JOB_LIST`: list configured repo-local Crabbox jobs.
- `INIT`: run `crabbox init` to generate `.crabbox.yaml`, an optional Actions
  hydration workflow, and `.agents/skills/crabbox/SKILL.md`.
- `SYNC_PLAN`: preview the sync manifest before leasing.
- `STATUS`: inspect a lease by id or slug.
- `INSPECT`: print lease/provider details by id or slug.
- `LIST`: list active leases, optionally scoped by provider.
- `STOP`: stop a lease by id or slug.
- `DOCTOR`: run Crabbox diagnostics.
- `VERSION`: print the installed Crabbox version.

## Useful inputs

- `workingDirectory`: local repository path to sync. Leave blank to use the
  AGNT process working directory.
- `provider`: optional provider such as `aws`, `hetzner`, `azure`, `gcp`,
  `ssh`, or `local-container`.
- `leaseId`: id or slug for reuse, status, or stop.
- `command`: the command passed after `crabbox run --`.
- `shell`: enable Crabbox `--shell` for pipelines or multi-statement commands.
- `jobName`: the job name for `crabbox job run <name>`.
- `allowEnv` and `envFromProfile`: forward only explicit environment names or
  profile values. Do not rely on inherited local environment as proof intent.
- `detect`: with `INIT`, ask Crabbox to detect a broad repo check and write a
  `jobs.detected` entry.
- `extraArgs`: advanced flags inserted before the command separator. It is argv
  parsed and cannot contain `--`; command separation is managed by the tool.
- `ttl` / `idleTimeout`: lease lifetime controls, defaulting to `90m` / `30m`.
- `timeoutMs`: local timeout for the Crabbox process, defaulting to 15 minutes.

## Outputs

The tool result includes stdout, stderr, the local args used to invoke Crabbox,
exit status, parsed timing JSON, and proof fields when Crabbox prints them:
`provider`, `leaseId`, `runId`, `slug`, `stopCommand`, and `exitCode`.

### Lease cleanup

If the local CLI is timed out or killed, the plugin parses the lease id from the
output and runs `crabbox stop <leaseId>` so the remote lease does not keep
billing. The attempt is reported in the `leaseCleanup` output field. Cleanup is
skipped when `keep` or `keepOnFailure` is set.

## Repository onboarding

For a project that has not been onboarded to Crabbox yet, run the `INIT` action
or use the CLI directly:

```bash
crabbox init --detect
```

OpenClaw Crabbox writes:

```text
.crabbox.yaml
.github/workflows/crabbox.yml
.agents/skills/crabbox/SKILL.md
```

Those generated files are repository-specific; commit them only after reviewing
provider, sync, env, and job settings for the target repo. When `init --detect`
creates a job, the plugin can run it with `JOB_RUN` and `jobName=detected`.

## Development

```bash
# Unit tests (from the repo root)
npx vitest run backend/plugins/dev/crabbox-plugin/tests

# Build the marketplace package (from backend/plugins/)
node build-plugin.js ./dev/crabbox-plugin
# Output: plugin-builds/crabbox-plugin.agnt (generated, never committed)
```
