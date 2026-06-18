# Proposed router edits (STAGED — not yet applied to live docs)

This file holds the two README insertions to apply once approved. Nothing in the
live `README.md` (repo root) or `backend/plugins/README.md` has been modified.

================================================================================
## BLOCK A — repo-root `README.md`
## Replace the existing `[🔌 Plugin Development]` docs-table row with this section
================================================================================

## 🔌 Plugins

A plugin is a folder of source that compiles to a single portable **`.agnt`**
file. That file is what you install, and what you publish. **You do not need to
fork or modify this repository to build one.**

**Pick your path:**

| I want to… | Go here | Fork this repo? |
|---|---|---|
| 🟢 **Build a plugin for myself or to share** (almost everyone) | **[START-HERE-PLUGINS.md](backend/plugins/START-HERE-PLUGINS.md)** | No |
| 🔵 **Propose a new *official, bundled* plugin** (rare, needs a PR) | [CONTRIBUTING-CORE-PLUGINS.md](backend/plugins/CONTRIBUTING-CORE-PLUGINS.md) | Yes |
| 📖 Look up the manifest schema, parameter types, or auth API | [PLUGIN-REFERENCE.md](backend/plugins/PLUGIN-REFERENCE.md) | — |

> **Building an integration with a third-party or commercial service?** That
> ships through the **marketplace**, not as a bundled default — follow the 🟢 path.

--------------------------------------------------------------------------------
(If you prefer to keep the compact docs-table format, this single row replaces
the old "Plugin Development" row and points at the router instead of the monolith:)

| [🔌 Build a Plugin](backend/plugins/START-HERE-PLUGINS.md) | Build & publish your own plugin (no fork needed). |


================================================================================
## BLOCK B — `backend/plugins/README.md`
## Insert this banner immediately AFTER the H1 "# AGNT Plugin System"
## (before the "Key Features" section). It routes; the existing overview stays.
================================================================================

> ### Start here
> A plugin compiles to one portable **`.agnt`** file — that file is what you
> install and publish. **You do not fork or modify this repo to build one.**
>
> - 🟢 **Build your own plugin (almost everyone):** [START-HERE-PLUGINS.md](START-HERE-PLUGINS.md)
> - 🔵 **Propose a bundled default (rare, needs a PR):** [CONTRIBUTING-CORE-PLUGINS.md](CONTRIBUTING-CORE-PLUGINS.md)
> - 📖 **Schema / parameter / auth reference:** [PLUGIN-REFERENCE.md](PLUGIN-REFERENCE.md)
>
> Third-party or commercial service integrations ship via the **marketplace**,
> not as bundled defaults.
>
> _The directory/architecture notes below describe the core repo layout and are
> mainly relevant to the 🔵 contributor path._

================================================================================
## BLOCK C — disposition of the old monolith `PLUGIN-DEVELOPMENT.md`
================================================================================

Recommended: replace its body with a short redirect stub so existing inbound
links/bookmarks (and agents that learned the old filename) land on the router
instead of the contributor-biased monolith. Proposed stub content:

    # Plugin Development — moved

    This guide has been split by intent so you land on the right path:

    - 🟢 Build & publish your own plugin → [START-HERE-PLUGINS.md](START-HERE-PLUGINS.md)
    - 🔵 Propose an official bundled plugin → [CONTRIBUTING-CORE-PLUGINS.md](CONTRIBUTING-CORE-PLUGINS.md)
    - 📖 Manifest schema, parameter types, auth API → [PLUGIN-REFERENCE.md](PLUGIN-REFERENCE.md)

(Alternatively, keep PLUGIN-DEVELOPMENT.md as-is for now and only add the
routers — but the stub is preferred so no traversal path leads back into the
old single-audience doc.)
