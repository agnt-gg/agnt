# Frontend bundle measurement and regression baseline (PR 2)

## Run locally
From an isolated checkout with the installed lockfile dependencies. The committed baseline is checkout-specific: `check` deliberately rejects a report built at a different canonical checkout root. For another checkout, use the paired-build procedure below rather than relabeling the baseline.

    node --test tests/unit/bundle/*.test.js
    node scripts/bundle/report.mjs build /absolute/path/to/NEW-report.json
    node scripts/bundle/report.mjs check /absolute/path/to/NEW-report.json docs/bundle-baseline/baseline.json docs/bundle-baseline/budgets.json

Build reports are create-only; checks never refresh the baseline. Build runs the normal frontend command and captures its exit status/log. Ordinary `npm --prefix frontend run build` emits `.bundle-graph.json`. Do not run against a live served dist for measurement. No chunking, runtime loading, dependencies or warning thresholds change.

Optional browser smoke, with an explicitly installed executable:

    BUNDLE_CHROMIUM=/usr/bin/chromium node scripts/bundle/browser-sample.mjs /absolute/path/to/NEW-browser.json

This starts a temporary static server and three fresh Chromium contexts, blocks external/API requests and records content appearance, page errors and resource timing. It does not contact the live backend. It is anonymous-content smoke, not authenticated readiness or lazy-feature acceptance. Blocked requests and failed samples remain recorded. Timing is not budget-enforced.

## Pinned baseline
Original schema-1 source `be18eaf37444341b47476492344ce38fc40d94bf`, upstream `ca0c61f9`. Schema 2 requires a fresh, explicitly reviewed provenance refresh at the original canonical checkout root `/home/tryinget/agnt/projects/bundle-measurement-forward`; see baseline.json for the refreshed source, patch hash, build identity and repeatability receipts. The original three builds produced these metrics, which the identity-only refresh must preserve:

| Metric | Bytes |
|---|---:|
| Conservative initial raw inventory | 11,197,433 |
| Sum of per-file gzip initial inventory | 4,693,130 |
| Current generated + public raw inventory | 29,784,049 |
| Sum of per-file gzip current inventory | 16,033,826 |

Whole build command times: 15.612s, 15.799s, 15.338s. Fresh process, populated isolated dist, OS/dependency cache uncontrolled. These are not p95 evidence. Installed dependencies were reused without npm upgrades.

Budget policy: zero unexplained growth in these deterministic byte metrics. Three runs showed zero byte variance, so timing noise is not a reason to permit byte growth. This is a regression gate, not an assertion that current sizes are desirable. Intentional growth requires an explicitly reviewed baseline update with rationale. Config, lockfile, measurement semantics and environment must match; changes require a reviewed refresh, not silent comparison. Do not replace the baseline during `check`.

## Build identity and paired comparisons (schema 2)
Production Vue chunks currently embed absolute `__file` paths. Two clean builds of `a8dd222030b7612904c78bd68ffa551899fd7af1` with identical schema-1 metadata differed across checkout roots: initial raw 11,197,433 versus 11,197,115 bytes. Both contained 274 occurrences of their checkout path; the latter path was six characters shorter. A passing growth budget was therefore not exact baseline reproduction, nor an optimization win.

Schema 2 records the canonical real checkout root and npm, Rollup, platform and architecture alongside the existing config/lockfile, Node/zlib/Vite and scenario identity. Missing, blank, malformed or mismatched identity is refused before budget evaluation. Legacy reports must be rebuilt; do not add an invented identity, compare path lengths, normalize emitted bytes, or silently overwrite the pinned baseline. Reports now disclose the absolute build path; review it before sharing. This gate addresses known recorded confounds, not hermetic reproducibility: dependency installation integrity, ambient environment and OS caches are not fully controlled.

For work in a different isolated checkout:
1. Preserve existing work and interrupted-worker artifacts. Build the unchanged control twice at the **same canonical path** that will host the candidate. Save create-only reports outside the checkout and confirm exact metrics/current-file inventory equality, not merely a passing growth budget.
2. Only then apply the authorized candidate in that isolated checkout, keeping lockfile, build configuration, measurement tooling and environment unchanged. Save the candidate report and compare it with that local control using the budget CLI. Different source revisions are expected and remain provenance, not a compatibility rejection.
3. Record the two source revisions/patch hashes and all report paths. A local paired control is not permission to refresh the committed baseline. Build-config/tooling changes require a separately reviewed control/refresh; do not bypass config identity to obtain a green check.
4. Validate feature-specific runtime scenarios before claiming latency or user-experience gains. Equal recorded identity and static budget acceptance alone do not establish those gains.

This correction changes measurement tooling only, not Vite configuration, emitted paths, runtime loading or dependencies. Automatic CI budget enforcement remains undelivered.

## Accounting
- Graph traversal follows static and dynamic edges, terminates cycles, deduplicates URLs, and retains independent nested lazy boundaries. Lazy groups are not additive.
- HTML's directly linked local scripts/styles/preloads and recursively referenced CSS resources are included separately from the JS graph. Associated fonts/images are potential costs, not evidence every variant is requested.
- Public inventory comes from current public/icon sources, not all files left in dist. Historical files are reported separately, never added to payload budgets. A real-dist retained-file injection left all metrics unchanged.
- Missing directly referenced files/generated imports fail closed. Missing conditional CSS font URLs are listed under unresolvedCss, not assigned invented byte sizes. The current Font Awesome CSS names nine absent legacy eot/svg/ttf resources. Modern woff resources exist; no claim is made about browser fallback behavior.
- Runtime-computed imports/resources, MathJax extensions and conditional font requests are not fully measurable from this static inventory. HTML/CSS reference extraction supports ordinary quoted references, not arbitrary script evaluation.
- Per-file gzip level9 sums are not network transfer, parsing time or application startup time. Source module renderedLength is attribution, not final minified/gzip contribution.
- IDs normalize node_modules paths to npm-relative identifiers. Hash changes across dependency versions still require baseline review.
- Symlink file reads and unsafe relative paths are refused. Reports contain source/build metadata, not credentials or page contents.

## Validation and evidence boundaries
64 node:test cases pass, preserving the original 45 cases. The identity correction added 19 failing-before/passing-after cases covering checkout/toolchain mismatch, absent or malformed identity, equal-length different paths and legacy schema rejection. The prior 45 included the original 38 contract cases. Four inventory cases initially failed on absent module (capability RED). Two additional review cases reproduced inherited-property graph confusion and failed-report budget acceptance; fixed GREEN. Missing conditional-CSS reporting test is post-fix verification. Original contract/RED document is retained as history, not current implementation status.

Three real builds agree. Browser smoke: three successful anonymous samples (approximately 256–322ms to nonempty app content), variable resource counts, no percentile/performance-win claim. This sample preceded normalization-only graph source-ID changes; no runtime bundle behavior changed. Authenticated shell and lazy feature scenarios remain to be validated before claiming PR 3 user-experience improvements.

## Ranked PR 3 investigation targets
1. Direct public libraries: mathjax.js 2,140,384 raw / 322,611 gzip; jspdf.js 637,018 raw / 138,760 gzip, plus html2canvas and PDF helpers. Measure deferral against actual math/PDF feature readiness; never remove capabilities.
2. Main entry: 1,245,552 raw / 369,648 gzip. Use captured graph/contributors to locate eager feature dependencies.
3. Emoji font: 4,991,984 raw / 2,817,658 gzip among potential CSS costs. Confirm actual glyph/font request behavior before optimization; do not assume all bytes block startup or remove emoji coverage.
4. Mermaid/Three/editor lazy costs: examine first-use sequences rather than splitting chunks only to remove the 500kB warning.

PR 3 must use paired baseline/candidate runs, preserve failure rates and feature coverage, and validate its own runtime scenario. Current three anonymous smoke samples do not authorize claims about authenticated feature latency.

## Prior interrupted attempt
This forward-only branch reused four explicitly inspected local artifacts from the stopped PR2 worker. No historical action was replayed, old task marked completed, or unknown-effect barrier cleared. Work is isolated from the running checkout and its database. The old goal row may still report interrupted; this PR is the durable forward-work handoff. No deployment or merge.
