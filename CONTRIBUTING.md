# Contributing to AGNT

Thanks for being here. AGNT is source-available and we genuinely want outside
contributions — this document exists so you can tell, before you spend an
evening on something, whether it is likely to be merged.

Two things to read first:

- **[Restricted areas](#restricted-areas)** — a short list of paths we do not
  accept outside patches for. Auth is on it.
- **[SECURITY.md](./SECURITY.md)** — if you found a vulnerability, report it
  privately. Do not open a pull request.

---

## Quick start

```bash
# 1. Fork, then clone your fork
git clone https://github.com/<you>/agnt.git
cd agnt

# 2. Install
npm install
npm --prefix frontend install

# 3. Branch
git checkout -b fix/short-description

# 4. Run the suites before you change anything, so you know what green looks like
npm test                      # backend  (vitest)
npm --prefix frontend test    # frontend (vitest + jsdom)
```

Development mode needs two terminals:

```bash
# Terminal 1 — frontend dev server with Vite HMR
npm --prefix frontend run dev

# Terminal 2 — Electron app and backend on port 3333
npm start
```

Port 3333 is a singleton. Only one instance can hold it, so quit a running
AGNT before starting another.

---

## Restricted areas

**We do not accept outside pull requests that modify authentication,
authorization, session handling, or credential storage.** This is a standing
policy about the category, not a judgment on any particular submission.

Concretely, that means these paths:

```
backend/src/services/auth/**
backend/src/routes/AuthRoutes.js
backend/src/routes/ProviderAuthRoutes.js
backend/src/routes/Middleware.js
backend/src/utils/authGuard.js
backend/src/services/security/**
backend/src/config/oauthClients.js
backend/src/services/MCPOAuthService.js

frontend/src/store/auth/**
frontend/src/router/authGuard.js
frontend/src/services/providerAuthService.js
frontend/src/utils/oauthMessageOrigin.js
frontend/src/__guards__/**
```

It also covers changes anywhere else that alter how a token is obtained,
stored, validated, or handed between windows — including `message` event
handlers, OAuth callback plumbing, and anything that reads or writes a
credentials file.

### Why

Not gatekeeping for its own sake. Three honest reasons:

**Review cost is asymmetric and does not scale.** A careful auth review is a
day of senior time for a few hundred lines, and that cost does not drop when
the contributor is good. It is a cost we have to pay every time, and we cannot
pay it reliably enough to promise you a fair turnaround.

**A plausible auth patch is the highest-leverage way to attack a project like
this.** Well-argued, well-tested, cites a real defect. That profile is
indistinguishable from one built deliberately. Refusing the whole category
fails safe; reviewing case by case relies on us never having a bad week.

**We inherit it at 3am.** Design decisions in auth code become our maintenance
burden for years, and the person paged is not the person who wrote it.

### What to do instead

**Found a security bug?** [Report it privately.](https://github.com/agnt-gg/agnt/security/advisories/new)
We will fix it and credit you in the advisory and release notes. The find is
the valuable part, and you keep credit for it.

**Found a non-security bug in auth code?** Open an issue with reproduction
steps. Those get triaged like anything else and we are usually quick on them.

**Not sure whether your idea touches auth?** Open an issue and ask before you
write the code. We would much rather answer that question in advance than
decline finished work.

---

## What we do want

- Bug fixes anywhere outside the restricted list.
- Plugins and tools — see
  [Plugin Development](./backend/plugins/README.md).
- Provider integrations — see
  [Adding a Provider](./docs/ADDING-A-PROVIDER.md).
- Performance work, with a before-and-after measurement.
- Documentation, including fixing things this file gets wrong.
- Test coverage for existing behaviour, especially edge cases.
- Accessibility and UX fixes.

Small, focused pull requests get reviewed fastest. If a change is large or
architectural, open an issue first and let us agree the shape before you build
it — that protects your time more than ours.

---

## Standards

**Correctness first.** Handle the edge cases: null and undefined, empty
collections, concurrent access, partial failure, hostile input. An error should
never be silently swallowed.

**Names should reveal intent.** Avoid `data`, `temp`, `obj`. Functions should
do one thing, and the name is a contract the body has to keep.

**Comments explain _why_.** What the code does should be readable from the
code.

**Match what is already there.** Consistency with the surrounding file beats
personal preference.

**Backend** is ES modules and `async`/`await`. **Frontend** is Vue 3
Composition API for new components.

### Tests

Every bug fix should ship with the test that would have caught it. Write it
first and watch it fail — a test that has never been red has not been shown to
test anything.

```bash
npm test                              # backend
npm --prefix frontend test            # frontend
npx playwright test --grep @ci        # browser suite
```

The browser suite needs a build first (`npm --prefix frontend run build`) and
Chromium (`npx playwright install chromium`).

Tag any new Playwright spec `@ci` in its title if it should gate merges. CI
runs `--grep @ci`, so an untagged spec never runs and will quietly rot.

### Commits

- Present tense, imperative: `fix(auth): reject an expired session token`.
- Subject line **72 characters maximum**, 50 preferred. GitHub truncates the
  subject in list views, and the tail is not shown anywhere you browse history.
- Wrap the body at 72 columns. `git log` indents by four spaces and never
  re-wraps, so a single long line runs off the terminal.
- One logical change per commit.

Writing a body from a shell that cannot embed newlines produces one enormous
line. Put the message in a file and use `git commit -F <file>`.

---

## Pull requests

Before opening one:

- [ ] It does not touch a [restricted area](#restricted-areas).
- [ ] Both suites pass locally.
- [ ] New behaviour has tests.
- [ ] Docs updated if the surface changed.
- [ ] Line endings are LF — the repo is `* text=auto eol=lf` and CI checks it
      with `node scripts/normalize-eol.mjs --check`.

In the description, tell us **what problem this solves** and **how you
verified it**. Paste the test output. A claim that something works is worth
much less than the run that shows it.

### CI gates

| Check | What it runs |
| --- | --- |
| Backend (vitest) | `npm test` |
| Frontend (vitest + jsdom) | `npm --prefix frontend test`, then a production build |
| Browser suite (Playwright) | `npx playwright test --grep @ci` |
| Line endings match .gitattributes | `node scripts/normalize-eol.mjs --check` |
| node:test suite | Report only — has known failures, does not block |

---

## Licence

AGNT is under the [AGNT Community Core License](./LICENSE.md). By contributing
you agree your contribution is licensed under the same terms.

---

## Questions

Open an issue. Asking before you build is always welcome, and it is the single
best way to avoid having good work declined for a reason you could not have
known about.
