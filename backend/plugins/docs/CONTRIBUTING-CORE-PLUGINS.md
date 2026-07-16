# Contributing an Official (Bundled) Plugin

> ## ⚠️ Most plugins do NOT belong here.
>
> If you want to build a plugin for yourself or to share with others, you're on
> the wrong page — you do **not** need a PR, and your plugin should **not** live
> in this repo. Go to **[START-HERE-PLUGINS.md](START-HERE-PLUGINS.md)** and
> publish to the marketplace instead.
> This page is **only** for proposing a plugin that ships *bundled inside the
> AGNT application* as a default — a rare, maintainer-reviewed addition.
>
> ## ⚠️ Non-negotiable: every official plugin declares its capabilities
>
> Every bundled plugin manifest must contain the structured `permissions` block,
> even when both arrays are empty. Every capability detected in first-party
> source must be declared, intended network domains must be reviewed manually,
> and the shipped `.agnt` artifact—not only the source folder—must pass with zero
> undeclared capabilities. Official plugins are green by construction.

---

## Will this be accepted as a bundled default?

Bundled defaults are held to a higher bar because they ship inside every build
and run for every user. A plugin is **not** a candidate for bundling if it:

- ❌ Integrates a **third-party or commercial service** → publish to the
  marketplace instead.
- ❌ Serves a niche or single-user workflow → marketplace.
- ❌ Pulls in heavy dependencies, native modules, or large assets.

Bundled defaults are generally limited to broadly-useful, first-party
primitives. **When in doubt, it's a marketplace plugin.**

---

## If it genuinely belongs in core

1. **Source location.** Bundled-plugin source lives in
   `backend/plugins/dev/<your-plugin>/`. This is the core repo's staging folder
   for plugins that ship in the app — it is *not* where ordinary plugins live.

2. **Self-contained, full stop.** Every file your plugin needs lives inside
   `backend/plugins/dev/<your-plugin>/`. A plugin PR must **not** touch:
   - `.dockerignore`, root `README.md`, `docs/`, `scripts/`
   - `backend/plugins/plugin-builds/` — **never commit a built `.agnt`**;
     `plugin-builds/` is gitignored and builds are generated, not committed.
   - Plugin docs go in a **README.md inside your plugin folder**, not in `docs/`.

3. **Capability declaration is mandatory** (enforced in review and release):
   - `manifest.json` includes:
     ```json
     "permissions": {
       "capabilities": [],
       "domains": []
     }
     ```
   - Supported capability names are `network`, `filesystem`, `spawn-process`,
     `env-access`, `dynamic-eval`, and `dynamic-import`.
   - Add every detected capability; list intended network hostnames manually.
     Never add broad permissions merely to silence a finding.
   - Run `node backend/plugins/cli/doctor.js backend/plugins/dev/<your-plugin>`.
     The result must contain **zero undeclared capabilities**.
   - Full schema and detector semantics:
     [PLUGIN-REFERENCE.md § Required capability declarations](PLUGIN-REFERENCE.md#2-required-capability-declarations).

4. **Security requirements** (enforced in review):
   - Executable paths for spawned processes come from server config/env, **never
     from a workflow parameter** (workflow inputs are user/agent-controlled).
   - Spawned children get a **minimal env allowlist**, never `process.env`.
   - Credentials flow through **AuthManager**, scoped per user — never ambient
     CLI/login state on shared instances.   - Clean up remote resources on timeout/error; escalate SIGTERM → SIGKILL;
     use sane default timeouts.

5. **Tests** live alongside the plugin and pass under the repo's `vitest` setup.

6. **Open the PR.** Expect a self-containment + security + "does this belong in
   core at all?" review. The most common outcome is a redirect to the
   marketplace — and that's a good outcome.---

## Required release gate for official defaults

Source validation alone is insufficient. The bytes bundled in
`backend/plugins/marketplace-default/` are what users install, so every changed
or rebuilt official plugin must pass the artifact-level gate:

```bash
cd backend/plugins
node cli/doctor.js dev/<plugin-name>
node cli/build-plugin.js <plugin-name>
# Maintainer copies the reviewed artifact into marketplace-default/.
node cli/stamp-integrity.js
node cli/stamp-integrity.js --check
node cli/audit-catalog.js
```

Acceptance criteria for every official artifact:

- Manifest and every referenced entry point/asset are present and safe.
- The shipped artifact hash matches `marketplace.json`.
- The shipped artifact's permissions match the reviewed source manifest.
- Detected capabilities minus declared capabilities is empty.
- The catalog remains `🟢` with no yellow or red official items.

The compatibility window may leave community builds warn-grade. It does not
apply to artifacts AGNT ships by default. A stale artifact, incomplete
permission block, or source/artifact mismatch blocks release.

---

## A worked example

The `dev/crabbox-plugin/` plugin is a good reference for the bar a bundled
plugin must clear: credentials via AuthManager, a minimal-env spawn allowlist,
positional-argument sanitization, remote resource cleanup on timeout, and tests
that pass under `vitest`. (It also illustrates the redirect: a third-party
service integration like this is exactly the kind of plugin that belongs in the
marketplace rather than bundled — read its review history for the reasoning.)

---

## ReferenceManifest schema, mandatory capability declarations, parameter types, and the
auth API are shared with the standalone path →
[PLUGIN-REFERENCE.md](PLUGIN-REFERENCE.md).
