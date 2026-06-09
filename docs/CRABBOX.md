# Crabbox Support

AGNT includes an OpenClaw Crabbox plugin for running remote validation from
workflows and a small repository wrapper for maintainer proof runs.

Crabbox is a remote execution control plane from OpenClaw. A `crabbox run`
leases or reuses a machine, syncs the current checkout, runs a command, streams
output, and reports run metadata such as provider, lease id, run id, timing, and
exit code. [crabbox.sh](https://crabbox.sh/) is the OpenClaw Crabbox docs site;
the integration calls the local `crabbox` CLI documented there.

## Workflow Tool

The bundled `crabbox-plugin` exposes one workflow action named `Crabbox`.

Supported actions:

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

Useful inputs:

- `workingDirectory`: local repository path to sync. Leave blank to use the
  AGNT process working directory.
- `binary`: Crabbox binary path. Leave blank to use `CRABBOX_BIN` or `crabbox`
  on `PATH`.
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

The tool result includes stdout, stderr, the local args used to invoke Crabbox,
exit status, parsed timing JSON, and proof fields when Crabbox prints them:
`provider`, `leaseId`, `runId`, `slug`, `stopCommand`, and `exitCode`.

## Repository Onboarding

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

AGNT does not vendor those generated files by default because they are
repository-specific. Commit them only after reviewing provider, sync, env, and
job settings for the target repo.

When `init --detect` creates a job, AGNT can run it with `JOB_RUN` and
`jobName=detected`, which maps to:

```bash
crabbox job run detected
```

## Maintainer Wrapper

Use `scripts/crabbox.sh` from the repository root for command-line proof:

```bash
scripts/crabbox.sh npm test
scripts/crabbox.sh npm run test:e2e
CRABBOX_PREFLIGHT=1 scripts/crabbox.sh npm run test:e2e
```

For shell features on the remote machine:

```bash
CRABBOX_SHELL=1 scripts/crabbox.sh "npm install && npm run test:e2e"
```

Common environment controls:

```bash
CRABBOX_PROVIDER=aws scripts/crabbox.sh npm run test:e2e
CRABBOX_ID=blue-crab scripts/crabbox.sh npm test
CRABBOX_FULL_RESYNC=1 scripts/crabbox.sh npm test
CRABBOX_ALLOW_ENV=OPENAI_API_KEY scripts/crabbox.sh npm run test:live
```

Always report the actual provider and lease id from the final Crabbox output.
For one-shot brokered runs, Crabbox should clean up automatically; if a run is
interrupted or uses `CRABBOX_KEEP_ON_FAILURE=1`, stop the printed lease when it
is no longer needed.

## Local Setup

Install Crabbox:

```bash
brew install openclaw/tap/crabbox
crabbox --version
crabbox doctor
```

If your team uses a broker, log in once:

```bash
crabbox login --url https://broker.example.com
```

Direct-provider and static SSH modes are also supported by Crabbox. Configure
those through Crabbox user config, `.crabbox.yaml`, or explicit wrapper/plugin
inputs.
