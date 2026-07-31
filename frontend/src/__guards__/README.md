# Repo-wide guard specs

Structural contract tests that walk the whole source tree from disk, rather
than testing a single component. They live here — NOT at `src/` root and NOT
next to any one component — because they have no single owner file.

**Convention: every new repo-wide guard spec goes in this folder.**

| Guard | Contract |
|---|---|
| `uiContracts.spec.js` | Font Awesome icons must resolve; no native `<select>` (use CustomSelect); no native `title=` (use v-tooltip, whose global registration is pinned) |
| `apiAuthContract.spec.js` | Every frontend `fetch()` to a guarded backend route must carry the Authorization token |
| `overlayStacking.spec.js` | Panel-hosted overlays must teleport to body; screen stacking-context isolation |

Notes for authors:
- Derive paths from `import.meta.url`; `src/` is `..` from here.
- Walkers must tolerate files vanishing mid-walk (parallel workers, live editors).
- Allowlists must have a staleness check so dead entries fail loudly.
- A guard's blast radius is every file it scans — land the guard in the same
  commit that makes it true.
