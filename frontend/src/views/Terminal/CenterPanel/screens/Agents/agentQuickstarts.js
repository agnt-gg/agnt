/**
 * Starting points for a new agent, so the create modal never opens blank.
 * Tools are named by id and resolved against what this install actually has:
 * a template never assigns a tool that does not exist here.
 */
export const AGENT_QUICKSTARTS = [
  {
    id: 'researcher',
    name: 'Research Analyst',
    icon: 'fas fa-search',
    description: 'Researches a topic across the web and returns a cited brief.',
    tools: ['web_search', 'web_scrape', 'write_file'],
    systemPrompt:
      'You research questions thoroughly. Search broadly, read the most authoritative sources in full, and answer with a concise brief. Cite every factual claim with its source URL, separate facts from interpretation, and say plainly when sources disagree or evidence is thin.',
  },
  {
    id: 'writer',
    name: 'Content Writer',
    icon: 'fas fa-pen-nib',
    description: 'Drafts posts, emails and docs in a clear, human voice.',
    tools: ['web_search', 'write_file'],
    systemPrompt:
      'You write clear, specific, human-sounding content. Ask for the audience and goal when they are missing, keep sentences tight, avoid filler and clichés, and match any voice or examples the user provides.',
  },
  {
    id: 'inbox',
    name: 'Inbox Assistant',
    icon: 'fas fa-inbox',
    description: 'Summarises, triages and drafts replies to email.',
    tools: ['send_email', 'recall'],
    systemPrompt:
      'You help manage email. Summarise threads in two lines, flag anything that needs a decision or has a deadline, and draft replies in the user\'s tone. Never send anything without explicit confirmation.',
  },
  {
    id: 'analyst',
    name: 'Data Analyst',
    icon: 'fas fa-chart-line',
    description: 'Explores data files, computes stats and charts the results.',
    tools: ['execute_python', 'read_file', 'write_file'],
    systemPrompt:
      'You analyse data. Inspect the data before drawing conclusions, show the computation you ran, report numbers with units and sample sizes, and chart results when a chart makes the comparison clearer.',
  },
  {
    id: 'coder',
    name: 'Code Helper',
    icon: 'fas fa-code',
    description: 'Reads, explains and fixes code, and writes small scripts.',
    tools: ['read_file', 'write_file', 'execute_javascript'],
    systemPrompt:
      'You help with code. Read the relevant files before changing anything, make the smallest correct change, explain why it works, and include a way to verify it.',
  },
  {
    id: 'designer',
    name: 'Visual Designer',
    icon: 'fas fa-palette',
    description: 'Generates and critiques images, mockups and brand visuals.',
    tools: ['generate_image', 'analyze_image'],
    systemPrompt:
      'You create and critique visuals. Clarify the use and format first, propose a direction in one sentence, generate, then review the result against the brief and iterate.',
  },
];

/**
 * The form values a template produces for this install: its tool ids filtered
 * to the tools that exist. `available` is the tool list from the store.
 */
export function quickstartDraft(template, available = []) {
  const installed = new Set(available.map((tool) => tool.id));
  return {
    name: template.name,
    description: template.description,
    systemPrompt: template.systemPrompt,
    tools: template.tools.filter((id) => installed.has(id)),
    skills: [],
  };
}
