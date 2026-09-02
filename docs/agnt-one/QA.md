# AGNT One — manual QA script

Run from the worktree: quit AGNT, `cd backend && npm start` (port 3333 is a singleton), then `cd frontend && npx vite build`, Ctrl-R the app. Every line is a click path with the expected result. Tick as you go.

## Shell (every page)
- [ ] Rail shows four readable captions WORK · REVIEW · BUILD · CONNECT; rows Chat · Workspaces / Dashboard · Runs · Outputs · Goals / Agents · Workflows · Library / Connections · AI Providers · Plugins; foot Settings alone.
- [ ] Goals row shows a count while a goal is executing; Runs while a run is running; Connections shows an amber count when a connection needs attention.
- [ ] Toolbar: centred "Jump to anything…" field. Press ⌘K / Ctrl-K anywhere → palette. Type "agents" → Go to › Agents; type an agent's name → Open › that agent; type nonsense → "send to Annie" (↵ sends it in Chat; ⇧↵ drops it in the composer).
- [ ] Toolbar pills: "N running" appears while runs are live (click → Traces, Running tab); "N to approve" while insights are escalated (click → Autonomy); red "no provider" when none is connected (click → CONNECT › AI Providers); "update" when an update exists (click → Settings › About).
- [ ] ⌘\ toggles the left panel, ⌘⇧\ the right. Esc clears a right-panel selection back to the summary.
- [ ] Library row lands on Tools; toolbar tabs TOOLS · SKILLS · WIDGETS · MARKETPLACE (Plugins is under CONNECT). Open Tool Forge from a tool → an amber TOOL FORGE tab appears while inside, disappears when you leave. Same for WIDGET FORGE.
- [ ] Chat row → one tab, CHAT. REVIEW › Outputs opens the Artifacts screen (`/artifacts`); left panel "By source" shows Recent (newest 8) then groups (This chat · workflow names · tool names · chat titles · Loose) with counts; Annie tab switches to the chat; clicking a row opens the file (or that chat). Runs › a run and Goals › a goal show an Outputs section when that run/goal produced files. Chat inspector › Artifacts: click opens, ⇧-click → Outputs; "all outputs →" link.

## Chat
- [ ] Right panel reads THIS CONVERSATION: Working now (stop works), Mentioned (appears once Annie names an agent/workflow/goal), Awaiting approval (when any), Context & cost (tiles appear after the first turn; expanding a tile shows Cost/Inventory/Health/Activity), Artifacts (file links from replies), This chat (Model row opens the provider popover; Tools row opens the tool popover). Footer: Save chat · New chat · Open in workspace.
- [ ] In a reply, an agent/workflow/goal name is a chip. Click → right panel shows it (✕ / Esc returns). ⇧-click → navigates to its screen with it selected.
- [ ] Composer buttons read Attach · Model · Tools · Voice when the composer is ≥900px wide; icons only below that. Send becomes Stop while streaming.
- [ ] First run (no provider): one welcome card, red "no provider" pill, composer placeholder says connect a provider; no red banner, no "Setup Required" chips.
- [ ] Saved chats: All · Unread · Groups segment; Unread shows only unread with "Mark all read"; Groups shows the tree + New Group; sort arrow flips date order; "+ New" in the header.

## Workflows · Workflow Forge
- [ ] Workflows list, nothing selected → right panel summary (counts + Active Workflows + New workflow). Click a card → its detail.
- [ ] Forge: left panel is "/ Annie". Nothing selected → right panel THIS WORKFLOW: steps (click a step → selects that node on the canvas), last runs, hint. Click a node → "/ Node name" with Parameters · Outputs · Docs. Click an edge → "/ From → To" with conditions. Click empty canvas → back to This workflow.

## List screens (Agents · Tools · Skills · Widgets · Marketplace · Goals · Traces · Memory · Evolution)
- [ ] Nothing selected → right panel is a summary with live counts and ONE primary button; no "Select an X" text; no Resources block.
- [ ] Left categories show no "(0)" rows.
- [ ] Header toolbar buttons carry words (Collapse · Empty hidden · Sort A–Z · Grid | Table) when the header is ≥900px.
- [ ] Traces opens in table view; Grid toggle remembered. Traces summary "New goal" → Goals with the composer open.

## Dashboard · Autonomy · Connectors · Settings
- [ ] Dashboard left: Pages (custom pages + New page), Go to, Quick actions. Right: Right-now stats (Running → inspector; To approve → queue), Active Workflows, Open Traces / Connectors.
- [ ] Autonomy right: approval queue with Approve / Reject per item.
- [ ] CONNECT › Connections: left nav API/OAuth · Emails · MCP · Vault · Webhooks; right shows connection health (Check health works). CONNECT › AI Providers: three cards (model · fallback · behaviour), no left panel, health on the right. CONNECT › Plugins: right shows a plugins summary; selecting a plugin shows its detail. `/providers` deep link works.
- [ ] Settings left has Data (Backup & Export · Reset) and About (About & Resources · Leaderboard) groups; About shows version, update check, releases and Docs · GitHub · Discord · Feedback. `?section=about` deep link opens it.

## Nothing lost — spot checks
- [ ] Active Workflows: Workflows summary + Dashboard right. Integration Health: Connectors right. Resources: Settings › About + ⌘K. News & updates: Settings › About + toolbar pill.
- [ ] Traces "Create multi-agent goal": Goals › New goal (from Traces summary, Dashboard quick action, ⌘K).
- [ ] Every route in tools/pixel/shoot-one.mjs renders without page errors.
