/**
 * Starting points for an empty Workflow Forge canvas.
 *
 * A template names node TYPES, the few parameters worth pre-filling, and the
 * wiring. The designer builds it with its own createNode/createEdge, so every
 * node gets the installed schema's defaults and nothing here can drift from
 * what the engine expects. Node names are set explicitly because parameters
 * reference upstream outputs by name: {{Summarize.generatedText}} resolves via
 * the lower-cased, space-stripped node name (WorkflowEngine nodeNameToId).
 */
export const WORKFLOW_QUICKSTARTS = [
  {
    id: 'daily-brief',
    name: 'Daily news brief',
    icon: 'fas fa-newspaper',
    description: 'Every morning, search a topic and summarise what changed.',
    nodes: [
      { key: 'timer', type: 'trigger-timer', name: 'Every Morning', params: { scheduleType: 'Interval', schedule: 'Daily', fireOnStart: 'No' } },
      { key: 'search', type: 'web-search', name: 'Search News', params: { searchQuery: 'AI agents news this week', numResults: 8, sort: 'date' } },
      {
        key: 'summary',
        type: 'generate-with-ai-llm',
        name: 'Summarize',
        params: { prompt: 'Write a five-bullet brief of what is new, one line each, with the source link:\n\n{{SearchNews.results}}' },
      },
      { key: 'view', type: 'markdown-preview', name: 'Brief', params: { markdownSource: '{{Summarize.generatedText}}' } },
    ],
    edges: [
      ['timer', 'search'],
      ['search', 'summary'],
      ['summary', 'view'],
    ],
  },
  {
    id: 'page-watch',
    name: 'Watch a web page',
    icon: 'fas fa-eye',
    description: 'Check a page on a schedule and report what it says now.',
    nodes: [
      { key: 'timer', type: 'trigger-timer', name: 'Every Hour', params: { scheduleType: 'Interval', schedule: 'Hourly', fireOnStart: 'Yes' } },
      { key: 'scrape', type: 'web-scrape', name: 'Read Page', params: { url: 'https://news.ycombinator.com' } },
      {
        key: 'summary',
        type: 'generate-with-ai-llm',
        name: 'Summarize',
        params: { prompt: 'List the five most important items on this page, one line each:\n\n{{ReadPage.textContent}}' },
      },
      { key: 'view', type: 'markdown-preview', name: 'Report', params: { markdownSource: '{{Summarize.generatedText}}' } },
    ],
    edges: [
      ['timer', 'scrape'],
      ['scrape', 'summary'],
      ['summary', 'view'],
    ],
  },
  {
    id: 'email-drafts',
    name: 'Draft email replies',
    icon: 'fas fa-reply',
    description: 'When an email arrives, draft a reply for you to review.',
    nodes: [
      { key: 'mail', type: 'receive-email', name: 'New Email', params: {} },
      {
        key: 'draft',
        type: 'generate-with-ai-llm',
        name: 'Draft Reply',
        params: {
          prompt:
            'Draft a short, friendly reply to this email. Do not invent facts or commitments.\n\nFrom: {{NewEmail.from}}\nSubject: {{NewEmail.subject}}\n\n{{NewEmail.body}}',
        },
      },
      { key: 'view', type: 'markdown-preview', name: 'Draft', params: { markdownSource: '{{DraftReply.generatedText}}' } },
    ],
    edges: [
      ['mail', 'draft'],
      ['draft', 'view'],
    ],
  },
  {
    id: 'weekly-report',
    name: 'Weekly research email',
    icon: 'fas fa-envelope-open-text',
    description: 'Research a topic every Monday and email yourself the report.',
    nodes: [
      {
        key: 'timer',
        type: 'trigger-timer',
        name: 'Every Monday',
        params: { scheduleType: 'Specific Time', specificTime: '08:00', specificDays: ['Monday'], fireOnStart: 'No' },
      },
      { key: 'search', type: 'web-search', name: 'Research', params: { searchQuery: 'competitor product launches this week', numResults: 10, sort: 'date' } },
      {
        key: 'report',
        type: 'generate-with-ai-llm',
        name: 'Write Report',
        params: { prompt: 'Write a short weekly report with headings and source links from these results:\n\n{{Research.results}}' },
      },
      { key: 'email', type: 'send-email', name: 'Email Me', params: { subject: 'Weekly research report', body: '{{WriteReport.generatedText}}' } },
    ],
    edges: [
      ['timer', 'search'],
      ['search', 'report'],
      ['report', 'email'],
    ],
  },
];

/** Every node type a template needs is installed. */
export function quickstartAvailable(template, installedTypes) {
  return template.nodes.every((node) => installedTypes.has(node.type));
}

/** The name a {{Name.field}} reference must use for a node called `name`. */
export const referenceName = (name) => String(name).replace(/\s+/g, '');

/**
 * Left-to-right layout in canvas space. Returns [{ node, x, y }] where x/y are
 * the centre points createNode expects.
 */
export function layoutQuickstart(template, { startX = 200, stepX = 280, y = 240 } = {}) {
  return template.nodes.map((node, index) => ({ node, x: startX + index * stepX, y }));
}
