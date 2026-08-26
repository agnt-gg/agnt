// Deterministic API fixtures.
//
// Screenshots must be a function of the CODE, not of whatever happens to be in
// the live database today. Every /api/** call is intercepted and answered from
// here, so a diff between two runs can only mean the frontend changed.
//
// Matching is longest-prefix on the pathname (after /api). `null` from a
// resolver means "fall through to the generic empty-ok response".

const iso = (d) => new Date(Date.UTC(2026, 0, 15, 12, d, 0)).toISOString();

const AGENTS = [
  { id: 'agent-01', name: 'Research Scout', description: 'Finds and summarizes primary sources on demand.', category: 'research', icon: '🔎', status: 'active', creditLimit: 1000, creditsUsed: 240, successRate: 94, lastActive: iso(1), assignedTools: ['web_search', 'web_scrape'], assignedWorkflows: [] },
  { id: 'agent-02', name: 'Release Marshal', description: 'Runs the deploy checklist and reports drift.', category: 'devops', icon: '🚀', status: 'active', creditLimit: 2000, creditsUsed: 1310, successRate: 88, lastActive: iso(2), assignedTools: ['execute_shell_command'], assignedWorkflows: ['wf-02'] },
  { id: 'agent-03', name: 'Ledger Clerk', description: 'Reconciles invoices against the books nightly.', category: 'finance', icon: '📒', status: 'inactive', creditLimit: 500, creditsUsed: 500, successRate: 71, lastActive: iso(3), assignedTools: [], assignedWorkflows: [] },
  { id: 'agent-04', name: 'Support Triage', description: 'Reads the inbox and routes what matters.', category: 'support', icon: '🎧', status: 'active', creditLimit: 1500, creditsUsed: 640, successRate: 91, lastActive: iso(4), assignedTools: ['send_email'], assignedWorkflows: [] },
  { id: 'agent-05', name: 'Copy Editor', description: 'Rewrites drafts to house voice.', category: 'content', icon: '✍️', status: 'active', creditLimit: 800, creditsUsed: 120, successRate: 97, lastActive: iso(5), assignedTools: [], assignedWorkflows: [] },
  { id: 'agent-06', name: 'Data Janitor', description: 'Normalizes and de-dupes imported records.', category: 'data', icon: '🧹', status: 'inactive', creditLimit: 600, creditsUsed: 90, successRate: 83, lastActive: iso(6), assignedTools: [], assignedWorkflows: [] },
];

const TOOLS = [
  { id: 'tool-01', name: 'Invoice Parser', description: 'Extracts line items from a PDF invoice.', category: 'finance', icon: 'fas fa-file-invoice', type: 'custom', isShareable: true, createdAt: iso(1) },
  { id: 'tool-02', name: 'Sitemap Crawler', description: 'Walks a sitemap and returns page titles.', category: 'web', icon: 'fas fa-sitemap', type: 'custom', isShareable: false, createdAt: iso(2) },
  { id: 'tool-03', name: 'Slack Digest', description: 'Summarizes a channel into one message.', category: 'comms', icon: 'fas fa-comments', type: 'custom', isShareable: true, createdAt: iso(3) },
  { id: 'tool-04', name: 'CSV Reshaper', description: 'Pivots and cleans a delimited file.', category: 'data', icon: 'fas fa-table', type: 'custom', isShareable: false, createdAt: iso(4) },
  { id: 'tool-05', name: 'Screenshot Diff', description: 'Compares two images and reports drift.', category: 'qa', icon: 'fas fa-images', type: 'custom', isShareable: true, createdAt: iso(5) },
  { id: 'tool-06', name: 'Token Counter', description: 'Estimates prompt cost before you send it.', category: 'ai', icon: 'fas fa-calculator', type: 'custom', isShareable: false, createdAt: iso(6) },
];

// The orchestrator's own suite. Separate IDs from the custom tools, because
// the store merges both lists into one Map keyed by id and drops collisions.
const BUILTIN_TOOLS = [
  { id: 'web_search', name: 'web_search', title: 'Web Search', description: 'Search the web for current information.', category: 'research', icon: 'fas fa-magnifying-glass', is_builtin: true, is_plugin: false },
  { id: 'web_scrape', name: 'web_scrape', title: 'Web Scrape', description: 'Fetch and clean the text of a page.', category: 'research', icon: 'fas fa-globe', is_builtin: true, is_plugin: false },
  { id: 'execute_javascript_code', name: 'execute_javascript_code', title: 'Execute JavaScript', description: 'Run JavaScript in a Node sandbox.', category: 'code', icon: 'fas fa-code', is_builtin: true, is_plugin: false },
  { id: 'file_operations', name: 'file_operations', title: 'File Operations', description: 'Read, write and list files.', category: 'system', icon: 'fas fa-folder-open', is_builtin: true, is_plugin: false },
  { id: 'send_email', name: 'send_email', title: 'Send Email', description: 'Send a message through the mail service.', category: 'comms', icon: 'fas fa-envelope', is_builtin: true, is_plugin: false },
  { id: 'generate_image', name: 'generate_image', title: 'Generate Image', description: 'Create an image from a prompt.', category: 'media', icon: 'fas fa-image', is_builtin: true, is_plugin: false },
];

const WORKFLOWS = [
  { id: 'wf-01', name: 'Nightly Backup', description: 'Snapshot, verify, and rotate archives.', status: 'active', isActive: true, nodes: [], edges: [], createdAt: iso(1), updatedAt: iso(7), lastRun: iso(8), runCount: 214 },
  { id: 'wf-02', name: 'Deploy Gate', description: 'Runs the suite, then promotes the build.', status: 'active', isActive: true, nodes: [], edges: [], createdAt: iso(2), updatedAt: iso(6), lastRun: iso(9), runCount: 87 },
  { id: 'wf-03', name: 'Weekly Digest', description: 'Collects metrics and mails the summary.', status: 'inactive', isActive: false, nodes: [], edges: [], createdAt: iso(3), updatedAt: iso(5), lastRun: iso(10), runCount: 52 },
  { id: 'wf-04', name: 'Lead Enricher', description: 'Fills missing fields from public sources.', status: 'inactive', isActive: false, nodes: [], edges: [], createdAt: iso(4), updatedAt: iso(4), lastRun: null, runCount: 0 },
  { id: 'wf-05', name: 'Incident Fanout', description: 'Pages the on-call rotation with context.', status: 'active', isActive: true, nodes: [], edges: [], createdAt: iso(5), updatedAt: iso(3), lastRun: iso(11), runCount: 9 },
];

const GOALS = [
  { id: 'goal-01', title: 'Cut render time below 16ms', description: 'Profile the dashboard and remove the two worst offenders.', status: 'executing', priority: 'high', progress: 62, created_at: iso(1), tasks: [], success_criteria: { metric: 'frame time', target: '<16ms' } },
  { id: 'goal-02', title: 'Document the plugin API', description: 'Every public entry point gets an example.', status: 'completed', priority: 'medium', progress: 100, created_at: iso(2), tasks: [], success_criteria: { metric: 'coverage', target: '100%' } },
  { id: 'goal-03', title: 'Migrate legacy webhooks', description: 'Move the last six integrations onto the new signer.', status: 'planning', priority: 'low', progress: 8, created_at: iso(3), tasks: [], success_criteria: {} },
  { id: 'goal-04', title: 'Reduce cold start', description: 'Trim the boot path to under two seconds.', status: 'paused', priority: 'high', progress: 41, created_at: iso(4), tasks: [], success_criteria: {} },
];

const SKILLS = [
  { id: 'skill-01', name: 'code-review', description: 'Reviews code for bugs, security and style violations.', category: 'engineering', source: 'system', enabled: true, usageCount: 42 },
  { id: 'skill-02', name: 'frontend-design', description: 'Creates distinctive production-grade interfaces.', category: 'design', source: 'system', enabled: true, usageCount: 18 },
  { id: 'skill-03', name: 'humanizer', description: 'Removes patterns typical of generated text.', category: 'writing', source: 'user', enabled: false, usageCount: 7 },
  { id: 'skill-04', name: 'xlsx', description: 'Reads and writes spreadsheet files.', category: 'data', source: 'system', enabled: true, usageCount: 31 },
];

const EXECUTIONS = [
  { id: 'exec-01', execution_id: 'exec-01', agent_name: 'Research Scout', status: 'completed', started_at: iso(1), finished_at: iso(2), duration_ms: 48120, total_tokens: 14203, cost: 0.14, tool_calls: 6 },
  { id: 'exec-02', execution_id: 'exec-02', agent_name: 'Release Marshal', status: 'running', started_at: iso(3), finished_at: null, duration_ms: null, total_tokens: 3120, cost: 0.03, tool_calls: 2 },
  { id: 'exec-03', execution_id: 'exec-03', agent_name: 'Support Triage', status: 'failed', started_at: iso(4), finished_at: iso(5), duration_ms: 9110, total_tokens: 880, cost: 0.01, tool_calls: 1 },
  { id: 'exec-04', execution_id: 'exec-04', agent_name: 'Copy Editor', status: 'completed', started_at: iso(6), finished_at: iso(7), duration_ms: 21400, total_tokens: 5210, cost: 0.05, tool_calls: 3 },
  { id: 'exec-05', execution_id: 'exec-05', agent_name: 'Ledger Clerk', status: 'stopped', started_at: iso(8), finished_at: iso(9), duration_ms: 4200, total_tokens: 410, cost: 0.0, tool_calls: 0 },
];

const MEMORIES = [
  { id: 'mem-01', memory_type: 'preference', content: 'Prefers dense, expert-level summaries over tutorials.', created_at: iso(1) },
  { id: 'mem-02', memory_type: 'fact', content: 'Runs Windows with the Electron desktop build.', created_at: iso(2) },
  { id: 'mem-03', memory_type: 'pattern', content: 'Verification before claiming a fix is non-negotiable.', created_at: iso(3) },
  { id: 'mem-04', memory_type: 'context', content: 'Frontend consolidation is tracked on a dedicated worktree.', created_at: iso(4) },
];

const WIDGETS = [
  { id: 'wid-01', name: 'Run Rate', description: 'Executions per hour, last 24h.', category: 'dashboard', icon: 'fas fa-chart-line', widget_type: 'html', default_size: { cols: 2, rows: 2 } },
  { id: 'wid-02', name: 'Credit Burn', description: 'Spend against the monthly cap.', category: 'dashboard', icon: 'fas fa-coins', widget_type: 'html', default_size: { cols: 2, rows: 1 } },
  { id: 'wid-03', name: 'Failing Agents', description: 'Anything under 80% success.', category: 'system', icon: 'fas fa-triangle-exclamation', widget_type: 'html', default_size: { cols: 1, rows: 2 } },
];

const MARKET = [
  { id: 'mk-01', name: 'Notion Sync', description: 'Two-way sync between AGNT and Notion.', author: 'agnt', category: 'connectors', installs: 4120, rating: 4.6, price: 0, type: 'tool' },
  { id: 'mk-02', name: 'PDF Toolkit', description: 'Split, merge and OCR documents.', author: 'community', category: 'documents', installs: 2870, rating: 4.4, price: 0, type: 'tool' },
  { id: 'mk-03', name: 'Standup Bot', description: 'Collects and posts daily updates.', author: 'community', category: 'comms', installs: 1960, rating: 4.1, price: 0, type: 'agent' },
  { id: 'mk-04', name: 'SEO Auditor', description: 'Crawls a site and grades every page.', author: 'agnt', category: 'marketing', installs: 1502, rating: 4.8, price: 0, type: 'workflow' },
];

const CONNECTORS = [
  { id: 'google', name: 'Google', icon: 'fab fa-google', categories: ['productivity'], connectionType: 'oauth', connected: true },
  { id: 'github', name: 'GitHub', icon: 'fab fa-github', categories: ['engineering'], connectionType: 'oauth', connected: true },
  { id: 'slack', name: 'Slack', icon: 'fab fa-slack', categories: ['comms'], connectionType: 'oauth', connected: false },
  { id: 'openai', name: 'OpenAI', icon: 'fas fa-brain', categories: ['ai'], connectionType: 'apikey', connected: true },
  { id: 'stripe', name: 'Stripe', icon: 'fab fa-stripe', categories: ['finance'], connectionType: 'apikey', connected: false },
];

const ARTIFACTS = [
  { id: 'art-01', name: 'consolidation-report.md', path: '/artifacts/consolidation-report.md', size: 8120, type: 'markdown', updated_at: iso(1) },
  { id: 'art-02', name: 'run-rate.png', path: '/artifacts/run-rate.png', size: 44210, type: 'image', updated_at: iso(2) },
  { id: 'art-03', name: 'export.csv', path: '/artifacts/export.csv', size: 1902, type: 'csv', updated_at: iso(3) },
];

// ── the Evolution screen ────────────────────────────────────────────────────
// Insights, experiments and datasets each render through their own card. The
// harness photographs all three tabs, so these have to exercise every optional
// branch the cards draw: progress bars, deltas, decisions, confidence meters,
// occurrence counts, and each status/source badge colour.
const INSIGHTS = [
  { id: 'ins-01', title: 'Batch the tool calls that never depend on each other', category: 'pattern', description: 'Runs that fan out independent tool calls in one message finish 38% sooner than the sequential equivalent.', confidence: 0.92, occurrence_count: 14, status: 'pending', source_type: 'agent_chat', target_type: 'agent' },
  { id: 'ins-02', title: 'Retry storms on the connector health poll', category: 'antipattern', description: 'A failing provider is polled every 4s with no backoff, which burns quota and hides the original error.', confidence: 0.78, occurrence_count: 6, status: 'pending', source_type: 'tool_call', target_type: 'tool' },
  { id: 'ins-03', title: 'Name the output file before writing it', category: 'prompt_refinement', description: 'Prompts that state the destination path up front avoid a second clarifying turn almost every time.', confidence: 0.64, occurrence_count: 3, status: 'applied', source_type: 'goal', target_type: 'skill' },
  { id: 'ins-04', title: 'Prefer the spreadsheet skill for tabular exports', category: 'skill_recommendation', description: 'Hand-rolled CSV writing loses number formatting that the skill preserves for free.', confidence: 0.55, occurrence_count: 1, status: 'rejected', source_type: 'workflow', target_type: 'workflow' },
  { id: 'ins-05', title: 'Long context rebuilds dominate cold starts', category: 'bottleneck', description: 'Rehydrating the conversation accounts for most of the delay before the first token.', confidence: 0.83, occurrence_count: 9, status: 'pending', source_type: 'agent_chat', target_type: 'agent' },
  { id: 'ins-06', title: 'Lower temperature for extraction tasks', category: 'parameter_tune', description: 'Structured extraction is measurably more stable below 0.3.', confidence: 0.71, occurrence_count: 4, status: 'applied', source_type: 'tool_call', target_type: 'tool' },
];

const EXPERIMENTS = [
  { id: 'exp-01', name: 'Parallel tool dispatch', type: 'ab_test', status: 'running', hypothesis: 'Dispatching independent tool calls in one message cuts wall-clock time without hurting answer quality.', progress: { completed: 7, total: 10 }, result: null, created_at: iso(1) },
  { id: 'exp-02', name: 'Shorter system preamble', type: 'ab_test', status: 'completed', hypothesis: 'Trimming the preamble by 40% leaves task success unchanged and saves tokens on every turn.', progress: { completed: 20, total: 20 }, result: { delta: 0.042, decision: 'keep' }, created_at: iso(2) },
  { id: 'exp-03', name: 'Aggressive context trimming', type: 'ablation', status: 'completed', hypothesis: 'Dropping turns older than ten exchanges will not measurably reduce answer quality.', progress: { completed: 15, total: 15 }, result: { delta: -0.118, decision: 'discard' }, created_at: iso(3) },
  { id: 'exp-04', name: 'Retrieval before planning', type: 'ab_test', status: 'planned', hypothesis: 'Fetching sources before the plan is written reduces mid-task replanning.', progress: null, result: null, created_at: iso(4) },
  { id: 'exp-05', name: 'Tool-choice temperature sweep', type: 'sweep', status: 'failed', hypothesis: 'There is a temperature band where tool selection accuracy peaks.', progress: { completed: 2, total: 12 }, result: { delta: 0.006, decision: 'iterate' }, created_at: iso(5) },
];

const DATASETS = [
  { id: 'ds-01', name: 'Support triage — golden set', source: 'golden', description: 'Hand-labelled tickets with the routing a senior agent chose.', example_count: 240, items: [], skill_name: 'code-review', category: 'support', created_at: iso(1) },
  { id: 'ds-02', name: 'Synthetic invoice variants', source: 'synthetic', description: 'Generated invoices covering odd currencies, missing totals and multi-page layouts.', example_count: 1200, items: [], skill_name: 'xlsx', category: 'finance', created_at: iso(2) },
  { id: 'ds-03', name: 'Replayed production runs', source: 'historical', description: 'Six weeks of real orchestrator traces with their outcomes attached.', example_count: 860, items: [], category: 'ops', created_at: iso(3) },
  { id: 'ds-04', name: 'Edge cases from review', source: 'manual', description: 'Cases a reviewer flagged as wrong, kept as a regression floor.', example_count: 37, items: [], created_at: iso(4) },
];

const INSIGHT_STATS = {
  statusCounts: { pending: 3, applied: 2, rejected: 1, superseded: 0 },
  targetCounts: { agent: 2, tool: 2, skill: 1, workflow: 1 },
  total: 6,
};

const USER = {
  id: 'user-01',
  username: 'nathan',
  email: 'nathan@agnt.gg',
  pseudonym: 'nathan',
  credits: 12450,
  plan: 'pro',
  created_at: iso(0),
  onboardingCompleted: true,
  settings: {},
};

// A decodable (unsigned) JWT so the userFromJwt fallback path also succeeds
// when the status endpoint is bypassed.
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const FIXTURE_TOKEN = [
  b64u({ alg: 'HS256', typ: 'JWT' }),
  b64u({ id: 'user-01', sub: 'user-01', email: 'nathan@agnt.gg', name: 'nathan', authMethod: 'email', exp: 4102444800 }),
  'harness',
].join('.');

const USER_STATS = {
  totalAgents: 6, activeAgents: 4, totalTools: 6, totalWorkflows: 5,
  totalExecutions: 5, successfulExecutions: 3, failedExecutions: 1,
  creditsUsed: 7550, creditsRemaining: 12450, successRate: 87,
  runsToday: 12, tokensToday: 24031, costToday: 0.23,
};

// path (after /api) -> payload. Longest matching prefix wins.
//
// THE ENVELOPE IS NOT DECORATION. Every store unwraps a specific key
// (`data.agents || []`, `data.tools || []`, …). A bare array where the store
// expects `{ agents }` renders an EMPTY screen that looks like a real empty
// state — the most expensive kind of wrong fixture, because the screenshot
// still succeeds. Each envelope below was read off the store that consumes it.
const ROUTES = [
  // ── identity ──────────────────────────────────────────────────────────
  ['/users/auth/status', { isAuthenticated: true, user: USER }],
  ['/users/user-stats', USER_STATS],
  ['/users/credits', { credits: USER.credits, limit: 20000, used: 7550 }],
  ['/users/settings', { settings: {} }],
  ['/users/preferences', { preferences: {} }],
  ['/users/connection-health', { healthy: true, providers: [] }],
  ['/users/sync-token', { token: FIXTURE_TOKEN }],
  ['/users/me', USER],
  ['/auth/verify', { isAuthenticated: true, user: USER }],
  ['/auth/me', { user: USER }],
  ['/auth/session', { isAuthenticated: true, user: USER }],
  ['/auth/connected', { connected: CONNECTORS.filter((c) => c.connected) }],
  ['/auth/providers', { providers: CONNECTORS }],
  ['/credits', { credits: USER.credits, limit: 20000, used: 7550 }],

  // ── the collections ───────────────────────────────────────────────────
  ['/agents/activities', { activities: [] }],
  ['/agents', { agents: AGENTS }],
  ['/custom-tools', { tools: TOOLS }],
  ['/tools/orchestrator-tools', { tools: BUILTIN_TOOLS }],
  ['/tools/workflow-tools', { tools: BUILTIN_TOOLS }],
  ['/tools', { tools: [...BUILTIN_TOOLS, ...TOOLS] }],
  ['/workflows/summary', { workflows: WORKFLOWS }],
  ['/workflows', { workflows: WORKFLOWS }],
  ['/goals/summary', { goals: GOALS }],
  ['/goals', { goals: GOALS }],
  ['/goal-templates', { templates: [] }],
  ['/skills/discovered', { skills: [] }],
  ['/skills', { skills: SKILLS }],
  ['/memories', { memories: MEMORIES }],
  ['/memory', { memories: MEMORIES }],
  ['/widget-definitions', { widgets: WIDGETS }],
  ['/widgets', { widgets: WIDGETS }],
  ['/layouts', { pages: [] }],
  ['/marketplace', { items: MARKET, assets: MARKET, results: MARKET }],
  ['/connectors', { connectors: CONNECTORS }],
  ['/custom-providers', { providers: [] }],
  ['/providers', { providers: CONNECTORS }],
  ['/artifacts', { artifacts: ARTIFACTS, files: ARTIFACTS }],
  ['/filesystem/settings', { rootDirectory: 'C:/workspace', settings: {} }],
  ['/files', { files: ARTIFACTS }],

  // ── runs & telemetry ──────────────────────────────────────────────────
  ['/executions/agents/list', { executions: EXECUTIONS, runs: EXECUTIONS }],
  ['/executions', { executions: EXECUTIONS, runs: EXECUTIONS }],
  ['/orchestrator/runs', { runs: EXECUTIONS }],
  ['/traces', { traces: EXECUTIONS, executions: EXECUTIONS }],
  ['/runs', { runs: EXECUTIONS }],

  // ── lab ───────────────────────────────────────────────────────────────
  ['/experiments/datasets', { datasets: DATASETS }],
  ['/experiments', { experiments: EXPERIMENTS }],
  ['/eval-datasets', { datasets: DATASETS }],
  ['/datasets', { datasets: DATASETS }],
  ['/insights/stats', { stats: INSIGHT_STATS, ...INSIGHT_STATS }],
  ['/insights', { insights: INSIGHTS }],
  ['/skillforge/stats', { stats: {} }],
  ['/skillforge/leaderboard', { leaderboard: [] }],
  ['/skillforge/evaluations', { evaluations: [] }],
  ['/skillforge/settings', { settings: {} }],
  ['/skillforge/eligible-goals', { goals: [] }],

  // ── plumbing ──────────────────────────────────────────────────────────
  ['/groups', { groups: [] }],
  ['/schedules', { schedules: [] }],
  ['/webhooks', { webhooks: [] }],
  ['/wallets', { wallets: [] }],
  ['/contracts', { contracts: [] }],
  ['/mutations', { history: [] }],
  ['/email-listeners', { listeners: [] }],
  ['/mcp/servers', { servers: [] }],
  ['/conversations', { conversations: [] }],
  ['/chat/conversations', { conversations: [] }],
  ['/content-outputs', { outputs: [], contentOutputs: [], total: 0 }],
  ['/notifications', { notifications: [] }],
  ['/plugins/installed', { plugins: [] }],
  ['/plugins', { plugins: [] }],
  ['/extensions', { extensions: [] }],
  ['/import/detect', { detected: [] }],
  ['/releases', { releases: [] }],
  ['/models/schema-version', { version: 3 }],
  ['/updates/check', { updateAvailable: false, version: '2.4.0' }],
  ['/autonomy', { enabled: false, rules: [] }],
  ['/settings', { settings: {} }],
  ['/version', { version: '2.4.0' }],
  ['/health', { ok: true }],
];

export function resolveFixture(pathname) {
  const p = pathname.replace(/^.*\/api/, '') || '/';
  let best = null;
  for (const [prefix, payload] of ROUTES) {
    if (p === prefix || p.startsWith(prefix + '/') || p.startsWith(prefix + '?')) {
      if (!best || prefix.length > best[0].length) best = [prefix, payload];
    }
  }
  return best ? best[1] : null;
}

export const FIXTURE_USER = USER;
