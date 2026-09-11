> Historical RED-phase contract. Implemented scope, accounting exceptions, baseline and reproduction: [BUNDLE_MEASUREMENTS.md](BUNDLE_MEASUREMENTS.md). Planned runtime scenarios below are not claimed completed.

# Frontend bundle measurement contract v1 (RED phase)

## Scope and observed pipeline
Pinned upstream: 8b116452ff302d0532db9863b1316d04da21fc2b. No runtime or loading optimization changes.
Frontend build uses Vite 5, Vue, manual vendor chunks, 10240-byte asset inlining,
public-directory copying, explicit icon copying, and emptyOutDir:false.
`frontend/build/assetRetention.js` captures current Rollup bundle keys in writeBundle;
its retirement ledger is NOT a graph and does not inventory public assets.
A diagnostic `npm --prefix frontend run build -- --manifest` succeeded in the isolated
checkout: Vite printed 14.32s, 405 current hashed assets, zero retained; manifest has
320 records, one entry (`index.html`) marked BOTH isEntry and isDynamicEntry.
Duplicate dynamic edges and imports back to index.html occur. Classify by edges, not
flags, filenames, manual-chunk comments, sizes, or source import regexes.
No baseline is established by this single diagnostic build. --manifest is an observation
option, not a change to the checked-in build config. Actual implementation must emit
measurement metadata when running `npm --prefix frontend run build`.

## Authoritative inputs and adapter obligations
Use a versioned snapshot of the current Rollup output bundle (fileName, type, imports,
dynamicImports, isEntry, facadeModuleId, Vite imported CSS/assets) or current Vite
manifest plus a current-emission inventory. Manifest imports refer to MANIFEST KEYS,
not necessarily file paths. Resolve them before mapping to emitted URLs.
Retain stable source entry/feature identifiers separately from changing hashed URLs.
Snapshot final bytes after writers finish; assert every referenced local file exists.
Snapshot provenance includes source SHA and dirty patch hash, lock SHA256, config SHA256,
Node/npm/Vite/Rollup/zlib versions, platform/arch, command/mode, build start/end, elapsed
wall time and exit status. Vite's printed timing is not whole-command wall time.
Do not overwrite the baseline during a check. Unknown metadata and incomplete graphs
must fail, not silently produce zero. Reject traversal, absolute filesystem paths and
symlink escapes when reading dist. External URLs are exclusions, not local reads.

## Graph semantics and pure API for the next task
Module to implement: `scripts/bundle/measurement.mjs`.

- `classify(manifest, entryKey)` returns sorted unique `initial`, `lazy` (map keyed by
  dynamic target manifest key), and `sharedLazy` arrays of dist-relative filenames.
- Static closure S(e) is the least fixed point containing e and all nodes reached only
  through imports. A visited set terminates cycles; another entry is included only if
  statically reachable, not just because it is an entry.
- Expand a closure to files F(S): emitted node files plus associated css and assets.
  These associated asset bytes are a conservative inventory, not proof of requests.
- `initial = F(S(e))`. Discover dynamic edges recursively through reachable static AND
  dynamic nodes, retaining nested boundaries separately. For every discovered target d,
  `lazy[d] = F(S(d)) minus initial`. Never traverse dynamic edges inside S(d).
  A statically loaded dynamic target has an empty incremental group. Deduplicate edges.
- sharedLazy contains files in at least two nonempty incremental lazy groups. Sharing
  across entries is their file-set intersection and must be labelled per entry pair.
  Shared is a membership annotation, never an extra additive cost category.
- `incremental(requiredFiles, loadedFiles)` returns sorted unique set difference. For a
  real sequence, union all triggered roots, then subtract actual loaded URLs (including
  prior feature use). Independent lazy group totals are NOT additive. Nested first use
  requires the parent plus specifically activated nested boundary, not every alternative.
- `account(paths, files)` consumes a filename -> Buffer map; returns rawBytes, gzipBytes,
  fileCount. Unique identity is canonical dist-relative URL, not content digest. Equal
  bytes at different URLs cost twice; multiple aliases to one URL cost once.
- rawBytes is Buffer length. gzipBytes is SUM of gzipSync(buffer,{level:9}).length for
  each unique file, with Node/zlib versions recorded. Never gzip a concatenation or sum
  rounded KB. Embedded data URLs already belong to their containing file, never add the
  original source asset. Compress even incompressible assets consistently; category
  subtotals and contributor rows must reconcile exactly to the unique union.

## Ancillary and retained accounting
Publish distinct sets: current generated graph files; HTML document; explicit public
scripts/styles linked by HTML; associated CSS/images/fonts; other current public and
copied icons; retained historical hashes; measurement/retention metadata; source maps;
external/runtime URLs whose costs are unknown. Overall current inventory is a unique
union, NOT a sum of overlapping graph groups. Retained, maps and metadata are excluded
from payload budgets but disclosed as disk costs. Public inventory must come from current
public/copy source lists, not all files lingering in dist. Resolve HTML local src/href
and CSS url/@import paths; record unresolved/dynamic resources explicitly. CSS font/image
references are potential costs, not evidence all variants were requested.

The current HTML directly loads /js/libs/{highlight,mathjax,showdown,html2canvas,jspdf,
jspdf-autotable}.js, /js/common.js and /vendor/fontawesome/css/all.min.css.
These are outside the module graph and must not disappear from initial-document reports.
MathJax runtime extensions/fonts and conditional CSS fonts need browser evidence or an
explicit unknown/excluded runtime-cost entry. Favicon, webmanifest, apple-touch icon are
ancillary potential requests, not guaranteed critical-path requests. Inline scripts are
already counted in HTML. Modulepreload links must not double-charge existing graph files;
preload targets outside the closure must be reported separately.

## Scenarios (planned, not browser measurements)
Each scenario has a stable versioned ID, entry key, route, auth/data fixture, action sequence,
completion assertion, timeout, viewport and loaded-file precondition. Do not store secrets.

| ID | Initial/precondition | Action and completion |
| --- | --- | --- |
| shell-anonymous-v1 | index.html, fresh anonymous app storage | Navigate root; shell/sign-in visible, no uncaught load failure |
| shell-auth-chat-v1 | fixed permitted local auth/data fixture | Navigate chat; composer and fixed conversation visible |
| dashboard-first-v1 | completed authenticated shell, dashboard unused | Open Dashboard; chart canvas and fixed data render |
| toolforge-first-v1 | completed shell, editor unused | Open ToolForge; JS/Python editor accepts text |
| mermaid-flow-first-v1 | fixed artifact view, Mermaid unused | Render fixed flowchart; SVG contains expected nodes |
| mermaid-sequence-after-flow-v1 | flow scenario complete | Render fixed sequence diagram; nested boundary delta only |
| three-first-v1 | fixed artifact view, Three unused | Render fixed 3D scene; expected canvas frame and controls work |

Map targets using emitted source identifiers, never hardcode hashed filenames. Route names
and browser selectors must be verified by the browser task; table is not execution evidence.
Graph-only app-initial measures S(index.html); runtime-selected chat/dashboard may add
immediate dynamic loads and must not be mislabelled static startup.

Browser cold = new context with HTTP cache and service worker state empty, specified app
storage fixture. Browser warm = same version/profile primed by a specified successful run;
record memory/disk cache and service-worker response flags. Lazy-first-use = app already
loaded but feature not used, NOT a wholly cold browser. Repeat-use is separate. Cache-disabled
DevTools is a distinct profile, not interchangeable with empty cache.
Build state separately records fresh process, empty/populated dist, dependency installation,
Vite cache present/absent and OS filesystem cache unknown unless controlled. npm download
cache is not browser cache; fresh build process does not imply cold disk cache. Do not clear
shared caches or live state. Record network/CPU throttle, browser version, viewport, requests,
encoded/decoded/transfer sizes and timings. Failed attempts remain in the denominator.
Per-file gzip sums exclude HTTP/TLS overhead, cache effects and server compression policy;
they are NEVER observed network transfer, startup duration or execution cost.

## Baseline enforcement API
`enforce(candidate, baseline, budgets)` returns `{pass, ...diagnostics}` or throws a
validation error. Each report has metadata, sourceRevision and metrics. Required equality
keys: schemaVersion, graphSemantics, assetPolicy, gzip, node, zlib, vite, mode, configHash,
lockHash, scenario, browserCache, buildCache. Both sides must supply them. Revision and
run timestamp intentionally differ. Additional provenance is retained; browser performance
budgets additionally require exact browser/network/CPU/viewport/data-profile compatibility.
A dependency/config change requires a deliberate reviewed baseline refresh (or separately
labelled non-enforcing comparison), not bypassing equality silently.
For each budgeted metric: candidate <= baseline + absolute + baseline * relative.
absolute and relative must be finite nonnegative; metrics finite nonnegative; missing
baseline/metric/metadata fails closed. Equality passes; one byte over fails. Baseline zero
uses only the absolute allowance. Do not round before comparison. All budgets must pass.
The synthetic test allowance 10 bytes + 5% is ONLY a boundary fixture, not a justified
production threshold. Production allowances await repeatability/noise and risk evidence.
No chunk-warning threshold changes are part of this work.

## RED execution and next steps
Run from repo root:

```sh
node --test tests/unit/bundle/measurement.bdd.test.js
```

Dependency-free node:test scenarios have executable Given/When/Then names and assertions.
The implementation module is intentionally absent; RED must report ERR_MODULE_NOT_FOUND
for that exact module, not a syntax error or failed npm install. This establishes an absent
capability, not a claim that an existing implementation violates assertions. Next task
implements the API, makes assertions GREEN, then adds emitted adapter/HTML/CSS inventory
integration tests against a real build (including retained files). Keep original RED log.
Do not claim the graph unit fixtures validate browser behavior or full ancillary extraction.
