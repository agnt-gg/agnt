# Frontend Consolidation Plan

Branch: `fix/fe-consolidate` · Written 2026-08-26 · Status: **PHASES 0–3 + 6 SHIPPED** (see §6)

Goal: one cohesive system under the existing UI. **Zero visual change.** Same
pixels, same behavior — fewer, shared, configurable components underneath.

---

## 1. Measured state (audit of `frontend/src`, `__old-*` excluded)

| Metric | Value |
|---|---|
| Vue components | 309 (≈185k LOC) |
| Components with any co-named spec | ~71 / 309 (23%) |
| Scoped `<style>` inside screens | 48,051 of 112,531 screen LOC (**43% is CSS**) |
| Screens hand-rolling a search input | 18 |
| Screens hand-rolling modal overlays | 14 (vs `SimpleModal` with 73 importers elsewhere) |
| Files with hand-rolled `empty-state` | 38 |
| Files with hand-rolled `spinner` | 34 |
| Files with hand-rolled `toolbar` | 14 |

### 1a. The Left/Right panel fork (largest single duplication)

`LeftPanel/types/` mirrors `RightPanel/types/` — a copy-paste fork of the
entire panel tree: **3 byte-identical files, 23 diverged copies, 8 left-only.**

| Pair | Left LOC | Right LOC | Verdict |
|---|---|---|---|
| ChatPanel/ActiveTasks, ItemsForReview, SystemResources | 126/145/108 | identical | **pure copy-paste — dedupe first** |
| GoalsPanel | 235 | 1,803 | diverged roles (nav vs detail) |
| TracesPanel | 681 | 2,746 | diverged roles |
| MarketplacePanel | 444 | 1,946 | diverged roles |
| IntegrationHealth | 394 | 1,248 | diverged — needs diff review |
| …23 diverged pairs total | | | |

The divergence pattern is consistent: left = compact nav/summary, right =
full detail/actions. These are *different components wearing the same name* —
the fix is shared subcomponents + distinct names, not blind merging.

### 1b. Five dialects for talking to BaseScreen

All 24 active screens use the same `BaseScreen` shell (good — the look IS
consistent) but configure it five different ways: static string panel,
pointless dynamic ref, explicit `:activeRightPanel="null"`, left+right combo
(newest screens), and `:hidePanels` (Settings only). `showInput` is `false`
on 22/24 — wrong default. Panel *visibility* isn't per-screen at all; it
lives in the global theme store + localStorage.

### 1c. The base kit exists but is unused

| Shared component | Importers | Should be |
|---|---|---|
| `SimpleModal` | 73 | the 14 hand-rolled modal screens too |
| `BaseButton` | 19 | everywhere |
| `BaseTable` | 5 | every tabular screen |
| `ListWithSearch` | 3 | the 18 hand-rolled search screens |
| `BaseCardGrid` | 2 | card screens (Goals, Experiments, EvalDatasets…) |
| `BaseTabControls` | 1 | tabbed screens |
| `ScreenToolbar` | ~1 | the 14 hand-rolled toolbars |
| `SkeletonLoader` | **0** | loading states |

### 1d. Monolith screens (single-file, need decomposition)

`MessageItem` 5,304 · `Artifacts` 3,744 · `Connectors` 3,677 · `Marketplace`
3,470 · `Chat` 3,241 · `Agents` 2,923 · `BaseScreen` itself 2,820 ·
`Traces` 2,570 · `Workflows` 2,404 · `Tools` 2,233 · `Skills` 1,873.

### 1e. Stray duplicates & dead weight

- `ContentActions`, `ResponseArea`, `ModelSelector` exist BOTH in
  `views/_components/feature/` and inside ToolForge locals.
- Dead: `Dashboard/_Dashboard.vue`, `screens/__old-screens/`,
  `RightPanel/types/__old-panels/`, `_DashboardPanel`.
- 5 right-only panels (FileTree, News, SecurityActivity, Dashboard,
  ToolForgeResponse) are fine — genuinely one-sided.

---

## 2. Principles

1. **Zero visual diff, proven** — every phase gates on pixel-identical
   screenshots of all 24 screens (probe harness: `nav-audit/`, Playwright via
   `channel:'msedge'`, `deviceScaleFactor:1`, wait `document.fonts.ready`).
2. **Extract verbatim, then adopt** — new shared components are lifted from
   the most common existing markup, not redesigned. Adoption is
   screen-by-screen, each its own commit, each pixel-diffed.
3. **Characterize before touching** — untested screen gets a mount/smoke
   spec first; the refactor must keep it green.
4. **Config over code** — per-screen layout differences become registry
   data, not per-file prop ceremony.
5. **Never merge diverged twins blindly** — same-name ≠ same-component.
6. **No deletions without explicit per-file consent** (§3 Phase 1 list).

## 3. Phases (each independently shippable)

### Phase 0 — Safety net (no product code)
Baseline: full vitest suites green, `vite build` clean, screenshot set of all
24 screens committed as the golden reference. Mount smoke specs for the ~15
screens with zero tests.

### Phase 1 — Garbage collection (needs Nathan's per-file OK)
Delete: `__old-screens/` (5 dirs), `__old-panels/` (4 dirs),
`Dashboard/_Dashboard.vue`, `_DashboardPanel`. Zero imports reference them
(verified). Recovery = git history.

### Phase 2 — Kill byte-identical + stray duplicates
- `ChatPanel/components/{ActiveTasks,ItemsForReview,SystemResources}.vue` →
  one copy in `views/Terminal/_components/panelParts/`, both sides import it.
- ToolForge locals of `ContentActions`/`ResponseArea`/`ModelSelector` →
  diff against `views/_components/feature/*`; converge or rename honestly.
- Rename diverged left twins to their true role (`GoalsNavPanel` etc.) —
  same file, honest name — so the fork stops looking mergeable.

### Phase 3 — Screen registry (the layout consolidation)
`views/Terminal/screenRegistry.js`: one entry per screen —
`{ rightPanel, leftPanel, input, hideWhen }` — values extracted **verbatim**
from what each screen passes today. BaseScreen reads defaults from it;
screens shrink to `<BaseScreen screenId="X">` + slots. Prop still wins over
registry (Workflows' dynamic panel switching keeps working). Registry caps
the global show/hide toggles: `rightPanel: null` means *never*, ending the
empty-panel problem. Mirror-spec asserts every route's screen has an entry.

### Phase 4 — Primitive adoption (the 90% of duplication)
One primitive at a time, extracted verbatim, adopted screen-by-screen:
1. `SearchInput` (18 screens) — likely fold into `ListWithSearch`.
2. Modals → `SimpleModal` (14 screens).
3. `EmptyState` (38 files) · `LoadingState`/`SkeletonLoader` (34) ·
   `StatusBadge` (12) · `ScreenToolbar` adoption (14).
Each adoption: characterization spec + pixel diff + own commit.

### Phase 5 — Monolith decomposition + CSS dedupe
Split the 2k+ LOC screens into local components (pure extraction, no
behavior change). Then measure repeated scoped-CSS blocks across screens and
lift *identical* rules into `styles/components/` — carefully; scoped→global
moves are the highest visual-risk step, so this phase is last and most
heavily pixel-gated.

### Phase 6 — Guard rails (make regression impossible)
Specs that enforce the end state: no `<BaseScreen` prop dialects outside the
registry; no new `modal-overlay` classes outside SimpleModal; no
byte-identical .vue twins; screens under a LOC budget. Same pattern as the
existing `themeTokens.spec.js` guards — that system already works.

## 4. Order & effort

P0 → P1 → P2 are cheap and immediately valuable (P2 alone deletes ~400
duplicated lines). P3 is the keystone — small code, big consistency win.
P4 is the long tail, mechanical, safely incremental. P5 is optional polish
per-screen. Nothing blocks on anything outside its phase.

## 5. Risks

| Risk | Mitigation |
|---|---|
| Scoped-CSS extraction changes cascade | Phase 5 last; per-rule pixel gate |
| Diverged twins wrongly merged | Phase 2 renames instead of merges |
| Registry misses a dynamic panel case | Prop-wins-over-registry override |
| Untested screens regress silently | Phase 0 smoke specs first |
| Another branch touches same files | Small commits, rebase often |

---

## 6. Execution log (2026-08-26)

All shipped on `fix/fe-consolidate`, suite green (236 files / 4,159+ tests,
zero regressions), `vite build` clean.

| Phase | Status | Commits | Net |
|---|---|---|---|
| 0 Baseline | ✅ | — | 235 files / 4,149 tests green before any change |
| 1 Dead code | ✅ | `c3c4dfc9` | −7,213 lines (`__old-screens/`, `__old-panels/`, `_Dashboard.vue`, `_DashboardPanel.vue`) + stale guard allowlists emptied |
| 2 Duplicate files | ✅ | `5bdd00d7` | −1,244 lines: 3 byte-identical ChatPanel parts → one shared copy in `_components/chatPanel/`; dead `feature/ContentActions.vue` + `feature/ResponseArea.vue` deleted, their specs repointed at the live ToolForge copies (one test rewritten to characterize live behavior). **Tree now has ZERO byte-identical non-spec files** (md5-verified). |
| 3 Screen registry | ✅ | `27bf07b4` | `CenterPanel/screenRegistry.js` = single source of truth for every screen's panels + input line. BaseScreen resolves prop → registry → historical default; explicitly passed props still win (the 6 dynamic-panel screens keep theirs). 23 screens stripped of static layout ceremony. |
| 6 Guards | ✅ | `27bf07b4` | `__guards__/screenRegistry.spec.js`: every screen has a registry entry, no orphan entries, no static layout props in templates, every named panel type exists on disk, resolution semantics pinned. |
| — Kit hygiene | ✅ | (this commit) | dead `SkeletonLoader.vue` deleted; `ScreenTemplate.vue` rewritten to teach the registry pattern (its old imports were broken — it never compiled). |
| Pixel harness | ✅ | `c97a40aa` | `tools/pixel/` — deterministic screenshots of all 21 routes, self-verified at **0.000% across two runs**. Every consolidation below is gated on it. |
| 4 Primitive adoption | ◑ in progress | `4a399ca6`, `+2` | `CategoryNavPanel` (5 left panels → 1), `FilterTabs` (5 screens → 1), shared screen layout + card grid (9 screens). All **0 pixels changed** except one deliberate normalization. |
| 5 CSS dedupe | ⏸ next | | Measured: **86 byte-identical CSS rules appear in ≥3 screens** (~25 KB duplicated), incl. a whole `.wm-tabs` tab-bar family copy-pasted across 5 screens and `.empty-state` blocks across 7. NOT hoisted yet — scoped→global moves change cascade/specificity per theme, and per this plan's own rule that step ships only behind a render-diff gate. |

---

## 7. The pixel gate (2026-08-26)

`frontend/tools/pixel/` builds `dist/`, serves it in-process, answers every
`/api/**` call from fixtures, and photographs all 21 routes. Two runs of the
same build diff to **0.000% on 21/21 routes**, so any non-zero number is a real
change rather than noise. See `tools/pixel/README.md` for the six sources of
nondeterminism that had to be killed to get there.

### Results

| Change | Routes changed |
|---|---|
| `CategoryNavPanel` — 5 left panels collapse to 1 (−948 lines) | **0 / 21** |
| `FilterTabs` — 5 screens stop carrying identical tab CSS (−123 lines) | **0 / 21** |
| Shared `.screen-content` / `.screen-main-content` / `.card-grid` / `.card-row` | **1 / 21** — Skills only, deliberate |
| `EntityCard` — 3 lab cards collapse onto one frame | **0 / 23** |

The one intentional change: Skills' card grid used `padding: 16px 0` where
every other collection screen used `16px`, and Memory used a 320px minimum
column where everything else used 300px. Both now come from one rule. The diff
image confirms only the grid's outer edge moved — inner gutters, card sizes and
row positions are untouched.

### The entity cards

ExperimentCard, InsightCard and DatasetCard shared one skeleton — header (icon,
title, subtitle, hover actions), description, body — with **six byte-identical
CSS rules** between them. They now render through
`_components/cards/EntityCard.vue` and supply only what actually differs: the
icon, the middle band (progress bar / confidence meter / stat row) and the
footer badges. `GoalCard` was measured and deliberately left alone — it shares
**zero** selectors with the other three and is a genuinely different design.

**Be honest about the size of this one.** The three cards go 762 → 522 lines and
the shared frame costs 217, so the net is **−23 lines** — not a saving worth
quoting. The win is that the frame now has ONE definition instead of three
drifting ones, and the fourth card costs a caller instead of a file. Judge this
change on that, not on a line count.

Two things made this safe rather than merely smaller:

- **The icon, body and footer are slots, including their wrapper divs.** Slotted
  content is styled by the CALLER's scope, so each card keeps its own
  `.card-icon`, `.card-footer` and middle-band rules exactly where they were. A
  `.card-footer` div declared inside EntityCard would carry EntityCard's scope
  and silently orphan three stylesheets.
- **`.insight-card.applied` is doubled to `.insight-card.insight-card.applied`.**
  EntityCard's `:hover` sets the `border-color` shorthand, which includes the
  left edge; at equal specificity the winner would be decided by stylesheet
  injection order, so the decided-state stripe could disappear on hover.

The gate only proves this because the lab fixtures were filled in first: the
harness previously photographed three empty tabs, and `shoot.mjs` gained a
`prepare` step so `/experiments` is shot three times — insights, experiments and
datasets. **A card that is never photographed is a card the gate does not
cover.**

### Known gate caveat

`/chat` diffed 1.45% once across two runs of an identical build (a ~204px column
shifting vertically, no content change) and has been byte-identical on every run
before and since. It is an intermittent layout race in the chat welcome screen,
not a harness defect — but if `/chat` is the only route showing a diff, re-shoot
before believing it.

### Anti-decay

`__guards__/sharedScreenParts.spec.js` fails if a screen re-declares
`.wm-tab*`, re-declares a shared layout class, hand-rolls a tab button, or if a
browse panel stops delegating to `CategoryNavPanel` / grows its own `<style>`.

---

### Why the remaining CSS work still waits
A scoped rule carries `[data-v-…]` specificity and is invisible to other
screens; a hoisted global is neither. With 8 themes and the documented
`_tables.css`-style bleed history, an unverified hoist is exactly the class
of silent visual change this branch promised not to make. The harness
(Playwright over all 24 routes × themes, before/after diff — probe pattern
already proven in `nav-audit/`) needs a bootable app outside the live 3333
singleton, then Phases 4–5 become mechanical.
