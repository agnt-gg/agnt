/**
 * Per-action TTL (milliseconds) for `withFreshness`-wrapped Vuex fetches.
 *
 * Centralized so we can tune any individual TTL without grep-and-replace.
 * The shape is one value per fetch action, named to match. Anything not in
 * this table falls back to `DEFAULT_STALE_AFTER` from `withFreshness.js`
 * (5 min).
 *
 * How to choose a TTL:
 *   - "Live-ish counter" (credits, stats): 30 sec
 *   - "User edits this often" (agents, workflows, goals): 1 min
 *   - "Connection state can change" (connectedApps): 1 min
 *   - "Catalog data, changes rarely" (tools, providers): 5 min
 *   - "Identity / subscription state": 5–30 min
 *   - "Aligned with a server poll cadence" (license refresh): 1 hr
 *
 * Bypass for explicit reloads or post-write refresh:
 *   dispatch('agents/fetchAgents', { forceRefresh: true })
 */

const SEC = 1000;
const MIN = 60 * SEC;
const HR = 60 * MIN;

export const TTL = {
  // Auth / identity
  userAuthFetchUserData:        30 * MIN,
  userAuthFetchSubscription:     5 * MIN,
  userAuthValidateLicense:       1 * HR,
  userAuthFetchPseudonym:       30 * MIN,

  // App auth (provider catalog + connection state)
  appAuthFetchAllProviders:     30 * MIN,
  appAuthFetchConnectedApps:     1 * MIN,

  // AI provider config
  aiProviderFetchCustomProviders: 5 * MIN,

  // Feature data
  agents:                        1 * MIN,
  workflows:                     1 * MIN,
  tools:                         5 * MIN,
  goals:                         1 * MIN,
  goalTemplates:                10 * MIN,
  groups:                        5 * MIN,
  skills:                        5 * MIN,
  contentOutputs:                1 * MIN,
  marketplace:                  10 * MIN,
  mcpServers:                    1 * MIN,
  widgetDefinitions:             1 * MIN,
  widgetLayout:                  5 * MIN,
  insights:                      1 * MIN,
  experiments:                   1 * MIN,
  emailListeners:                5 * MIN,
  webhooks:                      5 * MIN,
  connectors:                    5 * MIN,

  // User stats / live counters
  userStats:                    30 * SEC,
  executionHistory:             30 * SEC,
};
