# AGNT performance harness

This harness compares running AGNT frontend variants by URL. Start each variant on a different port, then point the harness at those ports. That keeps measurement separate from git checkout/rebase work.

Example:

```sh
npm run perf:compare -- \
  --variant base=http://127.0.0.1:5301 \
  --variant lazy-loading=http://127.0.0.1:5302 \
  --variant lazy-global-libs=http://127.0.0.1:5303 \
  --runs 3 \
  --sample-ms 10000
```

Outputs are written under `perf-results/<timestamp>/`:

- `results.json`: full probe data, resource lists, console/page/request failures, runtime samples.
- `summary.csv`: median/average comparison table for spreadsheet import.
- `report.html`: self-contained HTML report with comparison charts and heap-over-time graph.

The default page set is in `scripts/perf/default-pages.json`. Use `--pages /settings,/chat,/tools` for a smaller run.

Single page probe:

```sh
npm run perf:probe -- --url http://127.0.0.1:5301/settings --label base
```

Recommended three-variant workflow:

1. Run upstream `main` on one port.
2. Run the first performance PR branch on a second port.
3. Run the stacked performance PR branch on a third port.
4. Run `npm run perf:compare` from this harness branch.
5. Open the generated `report.html` and compare wall time, transfer size, blocking time, and JS heap curves.
