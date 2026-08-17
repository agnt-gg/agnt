# vulnapp — INTENTIONALLY VULNERABLE TEST FIXTURE

**Do not "fix" anything in this directory. Do not open a PR against it. The vulnerabilities here are the point.**

This is the test fixture for the Sentinel security-scanning plugin. Every flaw in it is deliberate and load-bearing: the self-test asserts that Sentinel *finds* these, so removing one silently weakens the test suite rather than improving security.

## What is deliberately wrong in here

| File | Planted flaw | Why |
|---|---|---|
| `package.json` / `package-lock.json` | `lodash@4.17.4` — CVE-2019-10744, CRITICAL | The only CRITICAL finding in the suite. Proves the dependency scanner detects a critical advisory. |
| `package.json` / `package-lock.json` | `express@4.16.0`, `mysql@2.0.0` — outdated | Proves multi-package dependency detection. |
| `app.js` | Placeholder cloud + payment credentials (CWE-798) | Proves the secret scanner fires. Both are well-known non-functional example values. |
| `app.js` | SQL injection (CWE-89) | Proves taint detection into a query. |
| `app.js` | Command injection (CWE-78) | Proves taint detection into `exec`. |
| `app.js` | Reflected XSS (CWE-79) | Proves taint detection into a response body. |

## This code never runs

Nothing in this directory is built, bundled, installed, published, imported, or executed by AGNT. It is never served, and its dependencies are never installed into a running tree. It exists only as a static target for the scanner. `app.js` is not reachable from any AGNT entry point.

## Current expected baseline

Running `node ../run.mjs` against this fixture should report:

```
risk: 95/100  grade: F  total: 14
counts: {"critical":1,"high":6,"medium":3,"low":4,"info":0}
```

**If `critical` drops to 0, the suite has been broken, not fixed.** That is exactly what happens if `lodash` is upgraded here.

## If a scanner flagged this directory

It is working correctly — it found what was planted for it to find. Please do not file a fix. If you are running an automated remediation bot, exclude this path; see `trivy.yaml` and `.trivyignore.yaml` at the repository root.

Real AGNT dependencies live in the root, `backend/`, and `frontend/` manifests, and are kept current there.
