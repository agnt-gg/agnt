# Team MVP test build

Client branch: `fix/teams-mvp`, based on `feat/agnt-one`.
Cloud API: server commit `c4a00d2` is deployed.

## Start

Quit the currently running AGNT before starting this worktree (port 3333 is a singleton). Start with the repository's normal `npm start` command. From an AGNT tool shell use `set "ELECTRON_RUN_AS_NODE=" & npm start`.

Desktop can manage Business teams, invitations, connection grants and membership against the live API. Shared resource storage and native scope migration run only in a hosted instance with `AGNT_TENANT_SLUG` and `AGNT_TENANT_OWNER` correctly configured. Do not fabricate these against a personal data directory. The tenant must run this build to test its new shared storage endpoints; deploying agnt-server alone does not update tenant application images.

## Acceptance sequence

1. With an active Business subscription, enable the team for its existing tenant slug. Free and Personal must be refused by the API.
2. Invite a second account. Check the invitation delivery status. The invitee signs in with that email and accepts the single-use token; a paid personal account is not required.
3. Create a team workspace. Open its shared canvas and add a widget. In another member session reload the workspace; the layout should match. Competing writes return a revision conflict rather than overwrite. Closing is personal; archiving is team-wide.
4. Open **native workspace**. Existing agents/tools/workflows/editors use that workspace's non-login resource owner. Existing personal assets remain personal. Return to Personal via the switcher (full reload clears scope context).
5. Owner: create an approved model connection under Connections. Supported model brokers: OpenAI, Anthropic, Groq, DeepSeek, Grok and OpenRouter. GitHub repository listing is also supported. Provider credentials remain on the cloud server.
6. Create a native agent, AI tool or workflow in the workspace. Return to Workspaces, select it, load connections, choose model and authorize the revision. Run as the second member. Runs record actor and durable principal. Editing invalidates approval.
7. Remove the member or revoke a connection/principal; subsequent access or broker operations must be refused.

## Deliberate MVP execution limits

Shared agents run through the native LLM engine with no unapproved tools/workflows/skills. Shared AI tools use the native custom-tool executor. Shared workflows use the native workflow engine with the approved trigger/model/random/stop node set. Arbitrary JS/Python, shell, plugin execution and other nodes are not enabled for ordinary shared runs. Those require isolated workers and explicit capability adapters; no personal session or environment key fallback is permitted.

## Verification scope

Full frontend suite: 4,944 passed. Serial backend baseline: 6,406 passed, 2 skipped; additional changed-path checks and hosted boot/model-matrix tests are captured in `teams-*.log` in this worktree. Provider responses and invitation delivery are mocked in integration tests; no claim of real mailbox delivery or paid model invocation is made. Production health and unauthenticated denial probes passed, and the remote isolated HTTP/principal tests passed on the production machine.

## Storage migration

Hosted boot transactionally backfills personal/inherited scopes, classifies system and FTS tables, installs scope-assignment/immutability triggers, and refuses unknown/orphan ownership rather than guessing. Test against a database backup before a production tenant upgrade. `node backend/scripts/inspect-team-ownership.mjs <database-copy-path>` performs a read-only inventory.

Once shared rows exist, do not downgrade to a pre-scope tenant build. Roll back using a pre-upgrade database backup with the matching old build. Cloud API changes are additive; reverting the server feature commit disables the new routes without deleting team records.
