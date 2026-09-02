# AGNT One — full UI rewrite checklist

Branch `feat/agnt-one` · worktree `agnt-pro.wt/agnt-one` · design source: `%APPDATA%/AGNT/projects/agnt-one/agnt-next-v4.html` (30 frames) + `agnt-next-chat.html` (page 1, 16 frames) + coverage ledger (v3).

**Rule zero: nothing is lost.** Every component, action, filter, tab, panel, keyboard shortcut and route that exists on `main` still exists here. Things move; nothing is deleted without a row in the ledger saying where it went.

Legend: `[ ]` todo · `[~]` in progress · `[x]` done + verified · `[-]` deliberately not doing (reason)

---

## 0 · Platform (every page depends on these)

- [ ] P0.1 Worktree `feat/agnt-one`, junctions (root/frontend/backend node_modules), `.env` hardlink
- [ ] P0.2 `sections.js` re-parent: WORK = Chat(CHAT|ARTIFACTS) · Workspaces; PLAN = Dashboard · Goals · Traces; BUILD = Agents · Workflows · **Library**(TOOLS|SKILLS|PLUGINS|WIDGETS|MARKETPLACE + contextual forges); foot = Connectors · Settings
- [ ] P0.3 `tourTargets.js` + backend `tutorialTargets.js` mirror updated for the new ids (`library`), removed ids (tools/skills/plugins/widgets/marketplace/artifacts)
- [ ] P0.4 `sections.spec.js` regression locks updated to the new truth (Plugins→Library tab, Artifacts→Chat tab, Marketplace→Library tab)
- [ ] P0.5 Rail: captions 9px readable, live counts (Goals executing · Traces running · Connectors attention), unread dot kept
- [ ] P0.6 Toolbar: contextual forge tabs (`ctx` style, only while inside a forge / Skill Forge / Experiment Forge)
- [ ] P0.7 Toolbar: **Jump** field (⌘K / Ctrl-K) → `JumpPalette.vue` — Go to (sections) · Open (agents · workflows · goals · chats from stores) · Do (new chat/agent/workflow, approvals, reconnect) · fallthrough → send to Annie
- [ ] P0.8 Toolbar: live pills — running (executions) · to approve (autonomy) · provider — click → inspector / Connectors
- [ ] P0.9 `InspectorShell.vue` primitive: header (tile · title · sub · badge · ✕) · tabs · scroll body · footer actions. Two-state contract: `nothing selected` vs `selected`
- [ ] P0.10 `EntityRef.vue` + `utils/entityRefs.js` (+spec): chips in assistant messages; click → `panel-action('inspect', {kind,id})`; ⇧-click → `screen-change`
- [ ] P0.11 `ListHeader.vue` + `FilterChips.vue` primitives for the 8 list screens (title · count · search · sort · grid/table · import/export · primary)
- [ ] P0.12 Keyboard: ⌘\ left panel · ⌘⇧\ right panel · Esc pops (popover → jump → inspector selection)
- [ ] P0.13 Resources block (Docs · GitHub · Discord · Feedback) → Settings › About + Jump index. NewsPanel → About + toolbar "update" pill when an update exists
- [ ] P0.14 Route map: `/artifacts` still resolves (ArtifactsScreen owned by chat section); `/tools /skills /plugins /widget-manager /marketplace` still resolve (owned by library section); `/docs` unchanged

## 1 · Chat (page 1, approved study)

- [ ] C1 Right panel = **This conversation**: Working now · Mentioned · Context tiles · Artifacts · This chat (model · agents · tools · group) · footer (Approve / Save / Pin)
- [ ] C2 ContextTiles family (ContextMonitor · ContextManifest · SystemHealthPanel · ActivityFeed) mounted in the inspector "Context" view; strip above the thread removed
- [ ] C3 Referenced-entity inspector bodies: workflow (steps) · agent · trace · autonomy queue · memory · goal · running-now
- [ ] C4 EntityRef rendering in MessageItem for agents / workflows / runs / goals / memory Annie names
- [ ] C5 Composer: labelled buttons Attach · Agent · Tools · Voice; attachment chips row; Send ↔ Stop morph; voice bar replaces composer (⌨ Type reopens); CommandMenu + @-mention popovers restyled
- [ ] C6 First-run: one card (4 provider tiles + primary + secondary); SETUP chips + red banner + disabled placeholder collapsed; send honours disabled; toolbar red "no provider" pill
- [ ] C7 New-chat hello: four suggestion cards (initialSuggestions) + hints
- [ ] C8 Left panel: All · Unread · Groups segment; sort under ⋯; + New; chat-row context menu (Open · Open in workspace · Rename · Move to · Mark read · Copy link · Delete); meta line = agent avatar + model / live status
- [ ] C9 Message footer: time · copy · share · save · tokens/cost right; user hover: edit · resend · copy
- [ ] C10 Roster / show-earlier / skill pill / GoalProgressWidget / BrowserLiveCard / ProcessingState / error card + Retry all render in the new thread styling (760px max, centred)
- [ ] C11 Panels hidden state: edge restore tabs
- [ ] C12 ChatProviderSelector unchanged, reachable from toolbar model label and This chat › Model

## 2 · Chat › Artifacts (tab)

- [ ] A1 ARTIFACTS tab in Chat section → ArtifactsScreen; rail row removed; `/artifacts` deep link works
- [ ] A2 Left = file tree (FileTreePanel moved from right) + "From chats" + New file; Annie chat kept reachable (Ask Annie)
- [ ] A3 Centre = preview with Preview · Code · Split · ↻ · Open in app · Share
- [ ] A4 Right = file inspector (Details · Versions · Used in) + Ask Annie / Download / Make widget / Publish

## 3 · Workspaces

- [ ] W1 Left panel (new): workspaces list + widget palette (22 ids) + New workspace
- [ ] W2 Layout menu (Auto · Default · Custom) replaces DEFAULT / AUTO buttons; + Widget kept
- [ ] W3 Right = selected widget inspector (Settings · Data · Layout) / this workspace when none

## 4 · Dashboard

- [ ] D1 Left panel = Pages + widget palette (today: Chat's Saved Chats — wrong screen)
- [ ] D2 Stats strip → six KPI tiles (Runs · Success · Failed · Compute · Spend · XP) fed by the same stores as Traces/Billing
- [ ] D3 Widgets kept: Automation Activity (+Cumulative) · Running now · Goals map · Agents swarm · Active Workflows · Tools Inventory · Runs Queue
- [ ] D4 Right = selected widget / page summary + Add widget · Reset layout; Integrations gauge → Connectors; Resources → About

## 5 · Goals

- [ ] G1 Board columns = filter names (Planning · Executing · Needs review · Done)
- [ ] G2 Left = stats · status · priority · quick actions; one "+ New goal" in header
- [ ] G3 Right = board summary (none) / selected goal: Tasks · Evaluation · Plan · Schedule (ScheduleGoalModal) · History; footer Ask Annie · Pause · Evaluate · Replan

## 6 · Traces

- [ ] T1 Table view default (grid toggle kept): status · name · type · started · duration · tools · tokens · cost
- [ ] T2 Left = stats · status · type · window · quick actions (Refresh · Clear · Export)
- [ ] T3 Right = live summary (none) / selected run: Timeline · Tools · Tokens · Raw; Create Multi-Agent Goal → Goals › New goal
- [ ] T4 Durations sane (no 5,517h); Active/Running one number

## 7 · Agents + Agent Forge

- [ ] AG1 Left = Status (All · Active · Inactive · Running) + categories derived from data (no (0) rows) + Marketplace link
- [ ] AG2 ListHeader: search · Sort · Group · Grid/Table · Import · Export · + New agent (all 7 toolbar icons labelled)
- [ ] AG3 Cards: Run · Chat · Edit · ⋯ + runs/success meta; select → right inspector (exists) with Overview · Runs · Tools · Skills · Config
- [ ] AG4 Agent Forge: sections Identity · Model · Tools · Skills · Workflows; left "Annie · this agent"; right Preview · Validation (after input) · Test

## 8 · Workflows + Workflow Forge

- [ ] WF1 List: same ListHeader; cards Run · Edit · Runs; right = list summary / selected workflow as steps + Open in Forge
- [ ] WF2 Forge: left panel titled "Annie"; palette · canvas · floating bar · node/edge editor UNCHANGED
- [ ] WF3 Forge right, nothing selected = **This workflow** (steps → select on canvas · last runs · versions) instead of Chat fallback
- [ ] WF4 Edge editor header names both ends; selecting an edge clears node selection (today's quirk)
- [ ] WF5 Empty canvas hint

## 9 · Library (Tools · Skills · Plugins · Widgets · Marketplace)

- [ ] L1 Tools: chips System · Custom · Plugins · Marketplace; cards Try · Edit · Fork; inspector Schema · Usage · Tests; TOOL FORGE contextual tab
- [ ] L2 Tool Forge: sections; right = Test · Output (ToolForgeResponsePanel kept)
- [ ] L3 Skills: chips Skills · Discovered · Evolution; cards Use · Edit · Assign; SKILL FORGE contextual tab (SkillForgeScreen routed)
- [ ] L4 Plugins: left panel (Installed · Build · Pack Studio · Publish · manual install); chips; inspector Overview · Tools · Settings · Logs; NewsPanel → About
- [ ] L5 Widgets: category chips; card actions (edit · capture · duplicate · export · delete); inspector Preview · Config · Used on; WIDGET FORGE contextual tab
- [ ] L6 Widget Forge: Preview · Code · Split; Config right kept
- [ ] L7 Marketplace: one filter set left, one sort in header, stats once; Publish in header; install → inspector

## 10 · Connectors + Settings + System screens

- [ ] CN1 Connectors nav + **AI providers** view (ProviderSelector · FallbackProviders · ChatBehaviorSettings · routing) — moved from Settings › AI Provider (Settings row stays as a link)
- [ ] CN2 Health summary right (none) / selected connection Status · Scopes · Used by · Log
- [ ] ST1 Settings nav + Data (Backup · Export · Reset) + About (version · resources · news · easter egg) rows
- [ ] ST2 Right = section help / spend by source etc.
- [ ] SY1 Autonomy right = approval queue; SY2 Evolution right = insights summary / selected insight; SY3 Memory right = summary / selected memory
- [ ] DO1 Docs inside the shell (left nav Startup · Patterns · Tools · Legal; right on-this-page + Ask Annie)

## 11 · Verification

- [ ] V1 `npx vite build` clean
- [ ] V2 `cd frontend && npx vitest run` green (no new failures vs main baseline)
- [ ] V3 `sections.spec.js` green with the new registry
- [ ] V4 Pixel harness: every route photographs (no blank/crashed screens), inventory diff vs main shows only intended moves
- [ ] V5 Manual QA script (docs/agnt-one/QA.md): click paths for every page + panel state
- [ ] V6 Coverage ledger reconciled: every "kept/moved/changed" row has a location in code
