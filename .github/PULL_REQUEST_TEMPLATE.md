<!--
  Before you fill this in:

  SECURITY ISSUE? Close this and report it privately instead:
  https://github.com/agnt-gg/agnt/security/advisories/new
  A public PR describes the flaw while the fix is still unreleased.

  TOUCHING AUTH? We do not accept outside PRs for authentication,
  authorization, sessions, or credential storage. See CONTRIBUTING.md
  ("Restricted areas") for the paths and the reasoning. Open an issue
  instead and we will take it from there.
-->

## What problem does this solve?

<!-- The symptom, and who hits it. Link the issue if there is one. -->

## How does it solve it?

<!-- The approach, and anything you deliberately chose not to do. -->

## How did you verify it?

<!-- Paste the test output. A run beats a claim. -->

```
```

## Checklist

- [ ] This does not modify auth, sessions, or credential handling
      (see [Restricted areas](../CONTRIBUTING.md#restricted-areas))
- [ ] This is not a fix for a security vulnerability
      (those go to [private reporting](https://github.com/agnt-gg/agnt/security/advisories/new))
- [ ] `npm test` passes
- [ ] `npm --prefix frontend test` passes
- [ ] New behaviour has tests, and I watched them fail before the fix
- [ ] Docs updated if the surface changed
- [ ] Commit subjects are 72 characters or fewer
