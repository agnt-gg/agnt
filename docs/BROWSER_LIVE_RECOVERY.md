# Browser live-view recovery: protocol and acceptance

## Scope
This change repairs observation startup/recovery, not browser task retries. HTTP acquisition, socket authentication, owned subscription, frame receipt and canvas paint are distinct states. Browser instance names may be reused; stream generation and viewer lease IDs fence asynchronous work.

Backend and frontend must deploy together. GET `/api/browser-agent/view-capabilities` advertises protocolVersion 2; POST `/view` requires it. Old clients receive 426 before acquisition. Refresh the client after deployment. Do not deploy only one side or relax authentication to accommodate stale clients.

## Lifecycle
- Pending leases expire at 15 seconds. Registered leases expire at 60 seconds and renew every 15 seconds; failed renewal has a 5-second client deadline.
- Acquisition limits include in-flight reservations: 16 per user, 128 globally. Acquisition is serialized per browser instance.
- Watch registration requests a fresh screenshot. At most one capture per stream and four globally; one capture start per second per stream. Captures scale to 1280x800 without resizing the target viewport. Encoded image payloads are capped.
- Bootstrap delivery retains at most one snapshot per lease and retries volatile delivery at 750ms intervals, at most eight sends, with an independent six-second deadline. Retries retain original capturedAt and remain labeled snapshots, not new captures.
- Confirmed canvas paint cancels bootstrap delivery work. Live-frame priority is established by successful paint, not receipt or decode failure.
- Streaming image delivery addresses registered viewer socket IDs, not the entire user room. Multiple widgets sharing a socket deduplicate delivery. Non-image status/navigation events retain their user-room route.
- One decoder and one newest pending image bound the application queue. Decode deadlines invalidate late callbacks. Shared capture advances on the first viewer ACK or watchdog; independent per-viewer backpressure is not promised.
- Release/expiry/disconnect/authentication revocation removes image recipients and cancels bootstrap state. Release is scoped to its original stream generation and never closes the browser.
- Identity changes/rejection erase old canvas bitmap and navigation state before replacement work. Late HTTP/decode/control results cannot act on a newer subscription. Recovery does not replay input/navigation or open a replacement after a view was established.

## Regression evidence
Development used Gherkin-style RED–GREEN tests over successive isolated revisions. Tests cover missing first frame, auth/HTTP ordering, reconnect/unmount races, retired streams, malformed-image fallback, late identity responses, duplicate registrations, lost cleanup, resource limits, dropped bootstrap and joining-viewer cooldown.

Fresh isolated upstream-base verification on 2026-09-10:
- 104 backend tests across the ten BrowserViewer/BrowserScreencast/route/socketIdentity suites.
- 46 frontend tests across the seven BrowserStream suites plus BrowserUsability, streamGeometry and the unchanged BrowserToolbar suite.
- Production frontend build passes. Unrelated Vue selector and large-chunk warnings are outside this PR; selector migration is PR #135.
- Build/test dependencies reused from the local installed directories; dependency verification passed. This is not a fresh npm-ci installation claim.

## Local acceptance against the running backend
A separate temporary Chromium and narrow loopback bridge were registered through the real authenticated surface route in a unique test workspace. The real Vue component ran in a test UI against the running backend on port 3333, with the existing token supplied at execution time (not saved in source/results). Existing user tabs were not navigated or closed.

Passed with expected canvas pixel checks:
1. Initial image on the already-running test page.
2. Real canvas click changes the target page and the changed pixels arrive.
3. Second viewer receives the same current page.
4. Closing one viewer leaves the remaining viewer able to display further changes.
5. Socket disconnect/reconnect repaints the current page.
6. A 65-second CDP renderer lifecycle frozen/active interval followed by a fresh page change recovers.
7. Invalid-token reauthentication clears old canvas pixels; valid reauthentication repaints.
8. Non-viewing same-user socket receives zero image events.
9. Unmount leaves streaming:false; registered test surface is removed and only fixture browsers are closed.

### Evidence boundaries
This used production backend authentication/routes and actual Chromium rendering, but a temporary component host rather than the user's existing Electron renderer. Two-account switching remains covered by deterministic tests, not two real accounts. CDP freeze is not OS suspension and did not force the expected lease-expiry/Retry path. Do not claim OS sleep or full account-switch end-to-end acceptance.

Initial test-host attempts failed before mounting because dependency optimization was disabled; the corrected host explicitly prebundled Vue/socket.io-client. A later test incorrectly required Retry after freeze; corrected acceptance checks actual changed pixels after resume instead. Earlier failures remain in local evidence, not counted as passes.

Observed second-viewer first paint was approximately 1.53 seconds, consistent with cooldown/retry timing. This is a single local observation, not a p95 or an optimization win. Click/recovery checks assert expected pixels; generic first-draw timestamps can precede the expected changed pixels, so no precise interaction latency is claimed.

## Remaining work and rollout
- Real OS suspension and two-account UI acceptance remain manual deployment gates.
- Joining-viewer latency merits a separate measured optimization campaign. Do not lower deadlines or remove resource limits merely to improve a timing score.
- Publish matching frontend/backend, preserve prior assets for rollback, inspect concurrent work before any restart. Reverse only the scoped change with drift checks; do not reset a dirty checkout.
- This patch has been installed and tested locally. The upstream PR remains draft for review, not merge authorization.
