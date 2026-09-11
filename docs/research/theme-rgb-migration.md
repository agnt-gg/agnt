---
summary: "RGB token migration research: reproducible inventory, browser/capture failures, merged guard coverage, compatibility boundaries, and next decisions."
read_when:
  - "Considering relative colors or removal of AGNT's RGB triplet tokens."
  - "Extending the theme drift guard or continuing this research."
---

# RGB token migration — research findings

**Status: research deliverable for upstream review; no production CSS changes
or migration approval.** [Upstream #118](https://github.com/agnt-gg/agnt/pull/118)
proposes preserving this document, evidence, probes and research tests as a
reviewable investigation. Accepting the research is a separate decision from
approving or implementing a production migration; unresolved migration hazards
do not require the research record to remain a draft indefinitely.

The architectural question originated in
[#98](https://github.com/agnt-gg/agnt/pull/98), merged on 2026-09-08. Its shipped
guard coverage and remaining limits are described below. This research does not
bundle the implementation changes from
[#97](https://github.com/agnt-gg/agnt/pull/97) or
[#99](https://github.com/agnt-gg/agnt/pull/99).

## Decision so far

Do not remove all `*-rgb` tokens or mechanically rewrite their consumers yet.
Some pairs have different runtime meanings, saved widgets consume the tokens,
and the bundled PDF renderer rejects the computed format produced by relative
colors in an isolated browser fixture. These are separate from syntax support.

Keep the compatibility surface while discussing whether narrower test coverage
or a future staged migration is useful. Follow [CONTRIBUTING.md](../../CONTRIBUTING.md):
agree the shape of architectural work first. Do not fold auth, renderer
replacement, theme redesign, or unrelated chart fixes into this research PR.
[DESIGN.md](../../DESIGN.md) remains unchanged; no design-token export or design
contract change is proposed here.

## Reproduce without starting AGNT

Prerequisites: the existing root and frontend dependencies installed according to
the contribution guide, plus a Playwright-compatible Chromium binary. These
commands do not install dependencies, start an app/backend server, read app data,
or invoke the repository Playwright configuration. The browser fixture blocks
network requests and uses an ephemeral browser profile.

```bash
# From the repository root. All research tests, with zero skips required.
node scripts/research/run-theme-rgb-tests.mjs

# Optional installed browser override for the isolated palette regression test.
RGB_RESEARCH_BROWSER=/path/to/chromium node scripts/research/run-theme-rgb-tests.mjs

# Parser helpers + historical baseline check only (may explicitly skip prerequisites).
node --test tests/unit/research/theme-rgb-inventory.test.js

# Fixed, auditable snapshot (fails if the ref is unavailable).
node scripts/research/theme-rgb-inventory.mjs \
  --ref 535e136c2217a1e694c71634389baca71daf1a49

# Current tracked + nonignored untracked production frontend source.
node scripts/research/theme-rgb-inventory.mjs

# Uses the browser installed for the repository's Playwright version.
node scripts/research/theme-rgb-browser-probe.mjs

# Alternatively, explicitly choose an already-installed Chromium executable.
node scripts/research/theme-rgb-browser-probe.mjs --browser /path/to/chromium
```

The inventory uses installed Vue/Babel parsers to distinguish comments from
string contents. It counts literal source occurrences, not compiled CSS,
JavaScript evaluation, validity, or runtime reachability. See its JSON `scope`
for exclusions. Tests use node:test, not the root backend Vitest runner.
The dedicated **RGB research (zero skips)** CI job installs root and frontend
dependencies plus Chromium and checks out full history for the historical
baseline. `run-theme-rgb-tests.mjs` discovers explicit `theme-rgb-*.test.js`
paths, requires the inventory/palette/gate suites to exist, and rejects
missing/ambiguous TAP totals, zero tests, skips, todos,
cancellations, failures and nonzero process exits. No `continue-on-error` is
used for this job. Repository branch-protection settings remain a maintainer
responsibility; this PR does not change them.

Direct invocation of the inventory test may explicitly skip when frontend
parsers or the historical commit are absent. Such a skip is **fatal to the
research gate**, never counted as coverage. Other module/parser failures remain
errors. The unrelated general node:test job remains report-only; its historical
quoted-glob discovery failure is not repaired or used as research evidence here.

The browser probe reports observations as JSON, including browser version,
source hashes, all comparisons and capture outcomes. **Exit 0 means collection
completed, not that migration passed.** Capture errors are expected observations
on the baseline. Unsupported capture expressions are explicitly skipped, never
reported as successful captures of a preceding fallback. Palette schema v2
checks token presence, resolved-expression support, style acceptance and Canvas
acceptance. Invalid or unsupported samples have `equalPixels: null` and status
`inconclusive`, not `equal` or `different`; their reasons are retained. The
browser regression test covers valid matches, actual differences, missing and
malformed tokens, and a simulated unsupported-syntax boundary. The probe tests eight
named theme configurations; it also adds
both Everforest faces if that palette is imported. Add new configurations
explicitly when extending it to other themes.

## Baseline and evidence

- Upstream source: `535e136c2217a1e694c71634389baca71daf1a49`.
- Collection date: 2026-09-07.
- Isolated browser: Chromium `152.0.7977.64`, not the locked Electron runtime.
- [Recorded observations](theme-rgb-observations.json) contain the inventory,
  source hashes, palette differences and capture results. Matching palette
  comparisons are omitted from that compact projection; rerun the probe for all.
- The initial exploratory checkout also included unmerged Everforest faces:
  160 comparisons, 14 differences. This clean upstream-based rerun has **128
  comparisons, 10 differences**. Do not conflate those source configurations.
- Full app E2E, minimum-browser rendering, production build, and full repository
  suites have **not** been verified by this research artifact.

The original JSON is preserved byte-for-byte. The historical inventory table
below and findings originally recorded at `535e136c` are not rewritten as
current-upstream results. A separate 2026-09-09 collection is described after
the table; upstream's later Everforest and theme-face changes must not be
attributed to the historical 128-comparison result.

### Inventory

Scope: production `frontend/src` Vue/CSS/JS/TS/HTML, comments and tests excluded.

| Metric | Occurrences | Files |
| --- | ---: | ---: |
| `var(--…-rgb)` references | 1,657 | 184 |
| Direct `rgba(var(--…-rgb), …)` calls | 1,641 | 181 |
| `--…-rgb:` declarations | 73 | 10 |

The earlier 1,610-call estimate is not the scope reproduced here. These counts
exclude backend prompts, persisted widget content and indirect aliases. File
counts are not additive across tokens. The full per-token inventory is in the
recorded JSON.

### Current-upstream collection — 2026-09-09

[Separate current-source evidence](theme-rgb-observations-5ede8e72.json) pins
production source to `5ede8e72d87fdf1d14ebab4e13512f77707c46e1` and collector
source to `45d8a698fe8371c8e2ff1784eae447a13d9e6874`. All 17 recorded source
hashes were checked against those commits; no modified production files were
used. The browser was Chromium `152.0.7977.64`.

| Measurement | Historical `535e136c` | Current source `5ede8e72` |
| --- | ---: | ---: |
| RGB references / files | 1,657 / 184 | 1,657 / 184 |
| Direct rgba calls / files | 1,641 / 181 | 1,641 / 181 |
| RGB declarations / files | 73 / 10 | 89 / 11 |
| Theme configurations / comparisons | 8 / 128 | 10 / 160 |
| Pixel matches / differences | 118 / 10 | 146 / 14 |
| Explicit inconclusive samples | not classified by v1 | 0 (v2) |

The four additional differences are orange/violet for both Everforest faces.
The custom-background mismatch and both relative-color/color-mix capture errors
reproduce; the legacy capture succeeds. These remain research findings, not a
claim that migration is safe or a demand to change existing appearance.
The fixture loads current palette sources and both Everforest faces, but does
not drive the theme store's face-pinning UI or runtime transitions.

Reproduce the current inventory with `--ref 5ede8e72d87fdf1d14ebab4e13512f77707c46e1`.
For the browser record, run the probe at the pinned collector commit; its palette
and renderer bytes match the stated upstream revision. Matching comparisons are
omitted from the compact JSON projection; the probe emits all samples.

The research gate passed **15 tests, zero skips** at the collector commit.
A separate mutation check removed invalid-sample protection and the palette
regression failed on `true` versus `null`; the unchanged implementation passed.
These checks validate research tooling, not the app's migration readiness.
Full repository CI results and their exact head commit belong in the PR's
validation section, not in the historical measurement record.

## Findings and confidence

### 1. Browser painting succeeds while PDF capture fails — reproduced fixture

[The page](../../frontend/index.html) loads the vendored
[html2canvas 1.4.1](../../frontend/public/js/libs/html2canvas.js).
[ContentActions.vue](../../frontend/src/views/Terminal/CenterPanel/screens/ToolForge/components/ContentActions/ContentActions.vue)
uses it for PDF export. The fixture isolates that same library in a fresh DOM:

| Authored background | Computed form | Capture |
| --- | --- | --- |
| `rgba(var(--green-rgb), .1)` | `rgba(25, 239, 131, 0.1)` | succeeds |
| `rgb(from var(--color-green) r g b / .1)` | `color(srgb … / 0.1)` | throws |
| `color-mix(in srgb, var(--color-green) 10%, transparent)` | `color(srgb … / 0.1)` | throws |

Error: `Attempting to parse an unsupported color function "color"`.
This establishes a library-level integration blocker, not a reproduced failure
through the complete application export flow. An earlier fallback declaration
would not help a parser consuming the winning computed value.

The dev-only [contrast auditor](../../frontend/src/utils/contrastAudit.js) also
expects hex/rgb/rgba, not `color(srgb …)`. Its assumptions need review before
using it as migration evidence.

### 2. Background triplets preserve information — source and fixture

`applyCurrentThemeBackground` in
[theme.js](../../frontend/src/store/app/theme.js) assigns
`--color-background: transparent` for custom backgrounds. The triplet remains
solid. [Theme core](../../frontend/src/styles/themes/_core.css) uses it for panel
opacity; [widgetThumbnail.js](../../frontend/src/utils/widgetThumbnail.js)
explicitly uses it to recover opaque screenshot backgrounds.

The fixture reproduces the assignment for Midnight:

- Legacy: `rgba(8, 8, 24, 0.9)`.
- Relative color derived from the transparent token: black at 0.9 alpha.

A future design needs a distinct solid-canvas color owner before deleting this
triplet. The two values are not interchangeable representations in this state.

### 3. Inherited orange/violet differ — reproduced fixture, intent undecided

[Base variables](../../frontend/src/styles/base/_variables.css) define orange
and violet triplets. Midnight, Ember, Nord, Rose and Hacker override their
full-color counterparts without overriding those triplets. Ten token/theme
comparisons differ in the eight-theme baseline. For example, Midnight's
translucent orange changes from `#ff9500` to `#e09840` if migrated.

These are behavior differences, not automatically approved bug fixes. Decide
whether to preserve appearance or make translucency follow the themed hue.
Test any approved appearance change separately from a syntax migration.

#### Merged #98 guard: coverage and limits

[#98](https://github.com/agnt-gg/agnt/pull/98) merged on 2026-09-08 as
`a05de2107ac8c7db3108c3c3577ab6f5fc81e2bc`. Its
[merged `themeRgbPairs.spec.js`](https://github.com/agnt-gg/agnt/blob/a05de2107ac8c7db3108c3c3577ab6f5fc81e2bc/frontend/src/styles/themeRgbPairs.spec.js)
is broader than the original proposed co-declared-literal-pair guard:

- It checks root brand colors and the complete resolved default light/dark
  palette maps for RGB pairs, including primary aliases.
- It resolves plain `var(--token)` alias chains against bounded palette maps.
  For custom themes it checks their own RGB declarations, using root and
  applicable default light/dark values for resolution.
- It processes palette-bearing selector blocks separately, rather than only
  the first or last block in a file.
- Its regression cases exercise actual collector drift in root, dark and
  custom-theme declarations, a wrong light-primary alias, malformed channels,
  unresolved/cyclic aliases, malformed hex colors, and a second selector block.

The source explicitly does **not** model arbitrary CSS expressions or the full
browser cascade. In custom themes it does not require overrides for inherited
RGB channels when only the corresponding full-color token changes. Thus the
historical orange/violet differences above are outside that particular guard
invariant; the merged coverage is not proof of runtime equality, custom-background
role equivalence, or migration safety throughout the app.

The merged test file was confirmed unchanged at upstream `5ede8e72` on
2026-09-09. Its scope above is derived from source; executing its tests does
not extend that scope to the complete browser cascade. Any further guard expansion should target explicitly selected
inherited cases after deciding their intended appearance, without enforcing
equality for intentionally distinct background roles.

### 4. Saved widgets consume the token surface — source evidence

[CustomWidgetRenderer.vue](../../frontend/src/canvas/CustomWidgetRenderer.vue)
copies computed custom properties into widget iframe documents.
[Widget-generation prompts](../../backend/src/services/orchestrator/system-prompts/widget-forge-chat.js)
and [widgetTools.js](../../backend/src/services/orchestrator/widgetTools.js)
advertise RGB triplets to generated code. Saved widget source is outside the
source inventory. Deleting every in-repo reference is not proof that token
removal is safe for existing content.

Retain compatibility exports unless an agreed versioning/migration policy and
saved-content tests establish otherwise. Do not inspect user databases merely
to enlarge this research inventory.

### 5. Remaining conversion hazards — static audit unless stated otherwise

- **Fallbacks:** the baseline includes literal and nested fallbacks, including
  `BaseScreen.vue`'s green-token fallbacks. Convert comma triplets to actual
  color values, preserve their existing hues, and remember that `var()` fallback
  does not recover every invalid-color case. The inventory counts references
  inside nested fallbacks, not their runtime use.
- **Historical names:** `_aliases.css` maps `--color-purple-rgb` to
  `--indigo-rgb`, so the full-color target is `--color-indigo`, not an invented
  `--color-purple`. Those aliases intentionally resolve on `body`, not `:root`.
- **Indirect aliases:** PackStudio's `LibrarySection.vue` and `PackSection.vue`
  assign triplets to `--gx`; both rgb and rgba consumers use that alias.
  Direct suffix searches do not inventory those consumers.
- **JavaScript:** Dashboard's `ChartCard.vue` and the panel
  `PerformanceOverview.vue` components pass variable-bearing strings to charts;
  `CumulativeCreditsChart.vue` instead reads a computed triplet. Other consumers
  include DOM styles. The browser fixture confirms that a
  raw `rgba(var(...))` Canvas fill assignment leaves a sentinel fill unchanged;
  it does not prove any particular chart's complete runtime behavior.
- **Resolution and repaint:** test actual theme/face changes, background
  toggles, iframe refresh and Canvas repaint timing rather than just initial
  token values.

## Browser and build boundary

The lockfile resolves Electron 33.4.11, whose
[release record](https://releases.electronjs.org/release/v33.4.11) identifies
Chromium 130. That supports the proposed syntax, but this does not establish
ordinary-browser or mobile-WebView support for AGNT.

[Self-hosting](../SELF_HOSTING.md) and the
[Mobile Lite shell](../../mobile/mobile-lite/README.md) expose those surfaces.
No minimum-browser policy authorizing a new floor was found in this audit.

For basic channel copying with a literal alpha, compatibility sources place
initial support at Chromium 119, Firefox 128, Safari/iOS 16.4. Early Chromium
and Safari implementations have partial-support caveats, especially channel
arithmetic; do not generalize this to arbitrary relative-color expressions.
A conservative full-support policy would start at Chromium 122, Firefox 128,
and Safari/iOS 18. **Neither policy is adopted by this research.** Sources checked
2026-09-07:
[MDN compatibility data](https://github.com/mdn/browser-compat-data/blob/main/css/types/color.json),
[Chrome announcement](https://developer.chrome.com/blog/css-relative-color-syntax),
[WebKit 16.4 announcement](https://webkit.org/blog/13966/webkit-features-in-safari-16-4/).

Frontend Vite 5.4.21 / esbuild 0.21.5 preserved variable-based relative colors
without generating a fallback in an earlier in-memory minifier probe. That
probe was not a full production build. Existing `color-mix()` uses do not prove
that every supported client or downstream parser accepts relative colors.

## Extension plan — proposed, not authorized migration work

1. Ask whether upstream wants further coverage beyond merged #98 or a migration
   at all.
2. If expanding the guard, name its invariant precisely; preserve intentionally
   different background roles and separate inherited-color intent decisions.
3. If migration is wanted, agree browser floors and widget compatibility first.
4. Choose one small ordinary-CSS accent pilot with explicit alias/fallback
   mapping. Keep legacy token exports and unrelated behavior unchanged.
5. Require computed-color/pixel checks, real PDF export, widget live preview and
   thumbnails, relevant Canvas consumers, and theme/background transitions.
6. Validate the production-minified build in locked Electron and agreed minimum
   browser engines. Follow the repository suites and `@ci` browser convention.
7. Consider token deletion only after both internal consumers and saved-content
   compatibility are addressed. A maintained compatibility layer may be the
   correct endpoint rather than literal zero RGB tokens.

A lower-churn alternative is to retain runtime CSS and improve consistency
coverage, or later generate pairs from an agreed palette source. Generation
also needs ownership of selector/alias/runtime distinctions; it is not assumed
necessary or implemented here.

## Continuing this research

Start with the decision and recorded evidence above, then rerun both tools at
the new source revision. Record exact source hashes, engine version, which
invariants changed, and what remains unverified. Do not replace known failing
observations with a generic "tests passed" claim. Keep production changes in
separate, agreed commits or follow-up PRs.

This document and executable probes are the portable record. Private session
lineage is retained separately by the contributor; transcripts and machine-local
session paths are deliberately not published in the public repository.
