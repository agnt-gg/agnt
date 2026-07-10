# Contributing an Official (Bundled) Plugin

> ## ⚠️ Most plugins do NOT belong here.
>
> If you want to build a plugin for yourself or to share with others, you're on
> the wrong page — you do **not** need a PR, and your plugin should **not** live
> in this repo. Go to **[START-HERE-PLUGINS.md](START-HERE-PLUGINS.md)** and
> publish to the marketplace instead.
>
> This page is **only** for proposing a plugin that ships *bundled inside the
> AGNT application* as a default — a rare, maintainer-reviewed addition.

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

3. **Security requirements** (enforced in review):
   - Executable paths for spawned processes come from server config/env, **never
     from a workflow parameter** (workflow inputs are user/agent-controlled).
   - Spawned children get a **minimal env allowlist**, never `process.env`.
   - Credentials flow through **AuthManager**, scoped per user — never ambient
     CLI/login state on shared instances.
   - Clean up remote resources on timeout/error; escalate SIGTERM → SIGKILL;
     use sane default timeouts.

4. **Tests** live alongside the plugin and pass under the repo's `vitest` setup.

5. **Open the PR.** Expect a self-containment + security + "does this belong in
   core at all?" review. The most common outcome is a redirect to the
   marketplace — and that's a good outcome.

---

## A worked example

The `dev/crabbox-plugin/` plugin is a good reference for the bar a bundled
plugin must clear: credentials via AuthManager, a minimal-env spawn allowlist,
positional-argument sanitization, remote resource cleanup on timeout, and tests
that pass under `vitest`. (It also illustrates the redirect: a third-party
service integration like this is exactly the kind of plugin that belongs in the
marketplace rather than bundled — read its review history for the reasoning.)

---

## Reference

Manifest schema, parameter types, and the auth API are shared with the
standalone path → [PLUGIN-REFERENCE.md](PLUGIN-REFERENCE.md).
