/**
 * legacyToolAliases.js — repair agents installed with website tool names.
 *
 * WHY THIS EXISTS. agnt.gg's first-party marketplace agents were published
 * with their tools named by website slug ("gmail", "googlesheets", "x")
 * instead of the runtime tool name the app registers ("gmail_api",
 * "google_sheets_api", "twitter_api"). A restricted agent is granted exactly
 * the names it holds, so every installed copy ran with none of its
 * integrations, and nothing reported an error. The listings are now fixed at
 * the source; the copies already saved on users' machines are repaired here,
 * at read time, without touching stored data.
 *
 * THE RULE THAT KEEPS THIS SAFE. An alias applies only when the stored name is
 * NOT itself a registered tool and its runtime name IS. A user's own tool that
 * happens to be called "gmail" is never shadowed, and an alias for a plugin the
 * user has not installed resolves to nothing rather than to a phantom.
 *
 * The keys are exactly the slugs that appeared in published first-party
 * assignedTools. Do not add to this list for new work: new listings publish
 * runtime names (agnt-server scripts/agent-listing-payload.mjs).
 */
export const LEGACY_TOOL_ALIASES = Object.freeze({
  gmail: 'gmail_api',
  slack: 'slack_api',
  notion: 'notion_api',
  github: 'github_api',
  firecrawl: 'firecrawl_api',
  googlesheets: 'google_sheets_api',
  googledrive: 'google_drive_api',
  googlecalendar: 'google_calendar_api',
  x: 'twitter_api',
  // Published on agents that are now withdrawn; their runtime tools arrive
  // with later plugins, and an installed copy lights up when they do.
  stripe: 'stripe_api',
  hubspot: 'hubspot_api',
  quickbooks: 'quickbooks_api',
  linear: 'linear_api',
});

/**
 * Resolve an agent's stored tool names against the tools registered now.
 *
 * @param {unknown} assignedTools  the agent's stored assignedTools
 * @param {Set<string>} availableNames  function names of every registered tool
 * @returns {{ resolved: string[], missing: string[] }}
 *   resolved: registered names, in stored order, de-duplicated
 *   missing: stored names that resolve to no registered tool
 */
export function resolveAssignedToolNames(assignedTools, availableNames) {
  const resolved = [];
  const missing = [];
  const seen = new Set();
  for (const name of Array.isArray(assignedTools) ? assignedTools : []) {
    if (typeof name !== 'string' || !name) continue;
    let target = null;
    if (availableNames.has(name)) target = name;
    else if (Object.hasOwn(LEGACY_TOOL_ALIASES, name) && availableNames.has(LEGACY_TOOL_ALIASES[name])) target = LEGACY_TOOL_ALIASES[name];
    if (!target) { missing.push(name); continue; }
    if (!seen.has(target)) { seen.add(target); resolved.push(target); }
  }
  return { resolved, missing };
}

/**
 * The runtime name to SHOW for a stored name when the registry is not at hand.
 * Display only: it must never be used to grant a tool.
 */
export function displayToolName(name) {
  return typeof name === 'string' && Object.hasOwn(LEGACY_TOOL_ALIASES, name) ? LEGACY_TOOL_ALIASES[name] : name;
}

/** One line for the agent's prompt naming tools it was given but cannot use here. */
export function missingToolsNotice(missing) {
  if (!missing?.length) return '';
  return `Assigned but not available here: ${missing.join(', ')}. They need the plugin or AGNT update that provides them; if a request depends on one, say so instead of attempting it.`;
}
