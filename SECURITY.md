# Security Policy

## Reporting a vulnerability

**Please do not open a public issue or pull request for a security problem.**

Report it privately here:

**[Report a vulnerability](https://github.com/agnt-gg/agnt/security/advisories/new)**

That form is GitHub's private vulnerability reporting. Only AGNT maintainers
can see it. If the form is unavailable to you for any reason, email
**security@agnt.gg** instead.

A public pull request is the worst channel for this, even a well-intentioned
one. The description explains the flaw in detail, and it stays readable while
the fix is still unwritten and unreleased. That window is the whole problem: a
patch takes hours, and everyone running an unpatched build is exposed for all
of them.

## What to include

The more of this you can provide, the faster we can act:

- What an attacker gains — session access, another user's data, code
  execution, denial of service.
- The affected file and line, or the endpoint and method.
- Reproduction steps, or a proof-of-concept.
- Version or commit SHA you tested against.
- Whether it needs the attacker to be authenticated, and whether it needs any
  interaction from the victim.

A short report that names the impact is more useful than a long one that
does not.

## What happens next

| Stage | Target |
| --- | --- |
| Acknowledgement | 2 business days |
| Initial assessment | 5 business days |
| Fix for a confirmed high-severity issue | 30 days, usually much sooner |

We will tell you what we found, whether we agree on severity, and when the fix
ships. If we disagree that something is a vulnerability, we will explain why
rather than closing it silently.

## Disclosure

We will credit you in the release notes and the advisory by whatever name or
handle you prefer, unless you would rather stay anonymous. Just tell us which.

We ask that you hold off on public disclosure until a fix has shipped. If a fix
is taking longer than the window above, tell us and we will agree a date
together — we are not going to sit on a report indefinitely and call it
coordination.

## Scope

**In scope:** this repository — the AGNT desktop application, its local
backend, the bundled plugins, and the tooling that ships with them.

**Out of scope:**

- Anything requiring physical access to an already-unlocked machine.
- Findings that depend on the user deliberately installing hostile third-party
  plugins or tools. That is a trust decision the user makes explicitly.
- Automated scanner output with no demonstrated impact.
- Vulnerabilities in dependencies that are already public and already have an
  upstream advisory. Open a normal issue for those so we can bump the version.

AGNT runs locally and holds real credentials for whatever a user connects to
it. Anything that lets one origin, one plugin, or one tenant reach another's
tokens or data is squarely in scope, and we would rather hear about it from
you than from an incident.

## A note on fixes

Please report the issue rather than sending a patch — see the restricted areas
in [CONTRIBUTING.md](./CONTRIBUTING.md). It is not a reflection on your work.
Reviewing a security patch from outside costs us more than writing one, and the
report is the part that carries the value. You still get credit for the find.
