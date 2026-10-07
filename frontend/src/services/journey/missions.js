/**
 * The zero-to-hero journey: what a new AGNT user DOES, in order, and the short
 * missions that get each thing done on the page where it happens. Content
 * only; the rules that read it live in journeyEngine.js.
 *
 * WHY MISSIONS, NOT TOURS
 * ───────────────────────
 * The page tours this replaces walked people around the furniture: 107 steps
 * across 11 pages ("this is the Node ID", "this is the Logout button"), each
 * advanced by clicking Next. Nobody learns a product by being shown its
 * labels. A mission names ONE outcome, takes the person to it, and moves on
 * only when they have actually done it — the step's `until` is a fact the
 * app can observe (an agent now exists, a message was sent), never a click
 * on "Next".
 *
 * MILESTONES are the getting-started checklist. Each is done when the
 * account's real state says so (`isDone(facts, flags)`), so an existing user
 * who already has workflows is not asked to make one, and a thing Annie made
 * for them from chat counts exactly as if they had clicked through it.
 *
 * STEP SHAPE
 *   title, content   what to do, in the user's words, ending on the action
 *   route            { screen, options } — where to take them first (screenRoute.js)
 *   target           CSS selector to spotlight. Missing → the card docks; never skips
 *   placement        preferred side of the target: top | bottom | left | right
 *   prompts          starter messages; choosing one opens Chat with it typed in
 *   actions          extra buttons: { label, flag } records a choice and is a signal
 *   until            what proves the step is done (journeyEngine.stepSatisfied):
 *                      { grows: fact } | { fact, atLeast } | { event } | { flag }
 *                      { click: true }  (on the target) | { clickOn: selector }
 *                      { any: [...] } | { all: [...] }
 *                    No `until` → a manual step with a Next button.
 *
 * Every selector used here must exist in the source: journeyTargets.spec.js
 * fails the build when one does not, because a mission that points at nothing
 * is worse than no mission.
 */

const COMPOSER = '[data-tour-id="chat.composer"]';
const toChat = { screen: 'ChatScreen' };

/** Facts the journey reads. Counts, from the live store (useJourney.js). */
export const FACT_KEYS = Object.freeze([
  'aiModels', // AI providers of their own (keys, sign-ins, custom endpoints)
  'chats',
  'apps', // connected non-AI apps: Gmail, Slack, GitHub…
  'agents',
  'workflows',
  'executions',
  'goals',
  'schedules',
  'skills',
  'tools',
  'widgets',
  'memories',
]);

export const MILESTONES = Object.freeze([
  {
    id: 'model',
    title: 'Choose the brain',
    outcome: 'Pick the AI model Annie thinks with.',
    mission: 'connect-model',
    isDone: (facts, flags) => facts.aiModels > 0 || !!flags.modelChosen,
  },
  {
    id: 'chat',
    title: 'Ask Annie anything',
    outcome: 'Have your first conversation.',
    mission: 'first-chat',
    isDone: (facts, flags) => facts.chats > 0 || !!flags.chatted,
  },
  {
    id: 'apps',
    title: 'Give Annie hands',
    outcome: 'Connect an app you use every day.',
    mission: 'connect-app',
    isDone: (facts) => facts.apps > 0,
  },
  {
    id: 'agent',
    title: 'Hire your first agent',
    outcome: 'A teammate with one job and its own tools.',
    mission: 'first-agent',
    isDone: (facts) => facts.agents > 0,
  },
  {
    id: 'workflow',
    title: 'Automate a routine',
    outcome: 'Turn something you repeat into a workflow.',
    mission: 'first-workflow',
    isDone: (facts) => facts.workflows > 0,
  },
  {
    id: 'run',
    title: 'Watch it work',
    outcome: 'See every step of a run, inputs and outputs.',
    mission: 'first-run',
    isDone: (facts) => facts.executions > 0,
  },
  {
    id: 'goal',
    title: 'Hand off an outcome',
    outcome: 'Give Annie a goal and let her run with it.',
    mission: 'first-goal',
    isDone: (facts) => facts.goals > 0 || facts.schedules > 0,
  },
  {
    id: 'skill',
    title: 'Add a superpower',
    outcome: 'Install a skill or agent from the Market.',
    mission: 'first-skill',
    isDone: (facts, flags) => facts.skills > 0 || !!flags.installed,
  },
]);

export const MISSIONS = Object.freeze({
  // ── The journey, in milestone order ────────────────────────────────────
  'connect-model': {
    title: 'Choose the brain',
    pitch: 'AGNT Flash is already on. Want Claude, GPT or your own model instead? One click.',
    milestone: 'model',
    screens: ['SettingsScreen'],
    steps: [
      {
        route: { screen: 'SettingsScreen', options: { section: 'providers' } },
        target: '[data-section="providers"]',
        placement: 'left',
        title: 'Pick the brain behind Annie',
        content:
          'AGNT Flash is already switched on and comes with your account. Prefer your own? Click a provider below and sign in or paste a key. Plans you already pay for, like ChatGPT or Claude, work too.',
        actions: [{ label: 'Keep AGNT Flash', flag: 'modelChosen' }],
        until: { any: [{ grows: 'aiModels' }, { flag: 'modelChosen' }] },
      },
    ],
  },
  'first-chat': {
    title: 'Ask Annie anything',
    pitch: 'Research, documents, automations: it all starts with one message.',
    milestone: 'chat',
    screens: ['ChatScreen'],
    steps: [
      {
        route: toChat,
        target: COMPOSER,
        placement: 'top',
        title: 'Say hi to Annie',
        content: 'Ask for anything: research, a document, an automation. Pick a starter or type your own, then press Enter.',
        prompts: [
          'What can you do for me?',
          'Research the top 3 competitors of my business and summarize them',
          'Write me a one-page plan for launching a newsletter',
        ],
        until: { event: 'chat.sent' },
      },
    ],
  },
  'connect-app': {
    title: 'Give Annie hands',
    pitch: 'Connect Gmail, Slack or GitHub and Annie can act there for you.',
    milestone: 'apps',
    screens: ['ConnectorsScreen'],
    steps: [
      {
        route: { screen: 'ConnectorsScreen', options: { section: 'apps' } },
        target: '[data-tour-id="plugins.catalog"]',
        placement: 'top',
        title: 'Connect an app you live in',
        content: 'Open Gmail, Slack, GitHub, Calendar, whichever you use most, then press Connect and sign in.',
        until: { grows: 'apps' },
      },
      {
        route: toChat,
        target: COMPOSER,
        placement: 'top',
        title: 'Now put it to work',
        content: 'Connected. Ask Annie to use it.',
        prompts: ['Summarize my unread emails from today', 'What is on my calendar this week?', 'List my open GitHub pull requests'],
        until: { event: 'chat.sent' },
      },
    ],
  },
  'first-agent': {
    title: 'Hire your first agent',
    pitch: 'A teammate with one job, its own tools, and its own memory.',
    milestone: 'agent',
    screens: ['AgentsScreen'],
    steps: [
      {
        route: { screen: 'AgentsScreen', options: { newAgent: true } },
        title: 'Give it a name and one job',
        content:
          'For example: “Inbox triager. Every morning, sort my email and flag what needs me.” Add the tools it needs, then save. It shows up here, ready to chat or run.',
        until: { grows: 'agents' },
      },
    ],
  },
  'first-workflow': {
    title: 'Automate a routine',
    pitch: 'Pick a template or describe it. Three clicks to something that runs on its own.',
    milestone: 'workflow',
    screens: ['WorkflowsScreen', 'WorkflowForgeScreen'],
    steps: [
      {
        route: { screen: 'WorkflowForgeScreen', options: { workflowId: null } },
        target: '[data-tour-id="workflows.quickstarts"]',
        placement: 'top',
        title: 'Start from a template',
        content:
          'Pick one and a working workflow lands on the canvas. Rather describe it? Press the magic wand at the top and say what should happen, e.g. “Every morning, email me the top 5 Hacker News posts.”',
        until: { any: [{ click: true }, { clickOn: '#workflow-magic-button' }, { grows: 'workflows' }] },
      },
      {
        target: '#save-workflow',
        placement: 'bottom',
        title: 'Save it',
        content: 'Happy with it? Save. Edit any node first by clicking it.',
        until: { any: [{ click: true }, { grows: 'workflows' }] },
      },
      {
        target: '[data-tour-id="workflows.run-button"]',
        placement: 'bottom',
        title: 'Switch it on',
        content: 'Press play. It runs now, then every time its trigger fires.',
        until: { any: [{ click: true }, { event: 'workflow.activated' }] },
      },
    ],
  },
  'first-run': {
    title: 'Watch it work',
    pitch: 'Every run, step by step, with what went in and what came out.',
    milestone: 'run',
    screens: ['TracesScreen'],
    steps: [
      {
        route: { screen: 'TracesScreen' },
        target: '[data-tour-id="traces.list"]',
        placement: 'top',
        title: 'Open a run',
        content:
          'Workflows, goals and agents all land here. Open one to see each step and its inputs and outputs. When something goes wrong, this is where you find out why.',
        until: { click: true },
      },
    ],
  },
  'first-goal': {
    title: 'Hand off an outcome',
    pitch: 'Bigger than a chat: describe a result and Annie plans, works and checks in.',
    milestone: 'goal',
    screens: ['GoalsScreen'],
    steps: [
      {
        route: { screen: 'GoalsScreen', options: { newGoal: true } },
        title: 'Describe the result you want',
        content:
          'For example: “Find 20 podcasts in my niche and draft a pitch for each.” Annie breaks it into tasks, runs them, and asks you before anything risky.',
        until: { grows: 'goals' },
      },
    ],
  },
  'first-skill': {
    title: 'Add a superpower',
    pitch: 'Skills, agents and workflows other builders made, one click to install.',
    milestone: 'skill',
    screens: ['MarketplaceScreen', 'SkillsScreen'],
    steps: [
      {
        route: { screen: 'MarketplaceScreen' },
        target: '[data-tour-id="market.grid"]',
        placement: 'top',
        title: 'Install one thing',
        content: 'Open anything that looks useful and press Install. It works in your chats straight away.',
        until: { any: [{ event: 'market.installed' }, { grows: 'skills' }] },
      },
    ],
  },

  // ── Every other page: one useful thing to do there ─────────────────────
  'build-tool': {
    title: 'Build a tool in one sentence',
    pitch: 'Describe a tool and the Forge writes it. Every agent can use it after.',
    screens: ['ToolsScreen', 'ToolForgeScreen'],
    steps: [
      {
        route: { screen: 'ToolForgeScreen' },
        title: 'Describe what it should do',
        content: 'For example: “Turn any URL into a clean, five-bullet summary.” Test it once, then save. Your agents and workflows can call it from then on.',
        until: { grows: 'tools' },
      },
    ],
  },
  'build-widget': {
    title: 'Make a live widget',
    pitch: 'Describe a card and it is built with live data, ready for your dashboard.',
    screens: ['WidgetManagerScreen', 'WidgetForgeScreen'],
    steps: [
      {
        route: { screen: 'WidgetForgeScreen' },
        title: 'Describe the card you want',
        content: 'For example: “My open GitHub pull requests” or “Today’s runs and their status.” Save it and it can sit on your dashboard.',
        until: { grows: 'widgets' },
      },
    ],
  },
  'teach-memory': {
    title: 'Teach Annie about you',
    pitch: 'Tell her once. She remembers in every chat after.',
    screens: ['MemoryScreen'],
    steps: [
      {
        title: 'Tell Annie something worth remembering',
        content: 'Pick one, finish the sentence, and send. It lands here and shapes every answer from then on.',
        prompts: ['Remember that I prefer short, direct answers', 'Remember that my business is … and my customers are …'],
        until: { any: [{ grows: 'memories' }, { event: 'chat.sent' }] },
      },
    ],
  },
  'make-file': {
    title: 'Make your first file',
    pitch: 'Annie writes real files into your workspace: docs, sheets, code.',
    screens: ['ArtifactsScreen'],
    steps: [
      {
        title: 'Ask for a file',
        content: 'Whatever Annie writes in chat, runs, goals or agents lands here, ready to open, edit or share.',
        prompts: ['Write a one-page project plan and save it as plan.md', 'Make a CSV of 10 quick dinner ideas with prep times'],
        until: { event: 'chat.sent' },
      },
    ],
  },
  'build-plugin': {
    title: 'Build a plugin by describing it',
    pitch: 'Say what to connect to and what it should do. The Forge writes, tests and installs it.',
    screens: ['PluginsScreen'],
    steps: [
      {
        title: 'Describe the plugin',
        content: 'For example: “A plugin that posts a message to my Discord channel.” The Forge builds it and installs it for every agent.',
        until: { any: [{ event: 'plugin.built' }, { event: 'chat.sent' }] },
      },
    ],
  },
  workspace: {
    title: 'Make this space yours',
    pitch: 'A canvas that builds itself as you talk.',
    screens: ['WorkspaceScreen'],
    steps: [
      {
        title: 'Ask the chat here for something',
        content: 'Try “Add a checklist for this week” or “Add a widget with my open goals.” The canvas updates as you go.',
        until: { event: 'chat.sent' },
      },
    ],
  },
  learning: {
    title: 'See what Annie has learned',
    pitch: 'Annie studies every run and proposes improvements here.',
    screens: ['LearningScreen'],
    steps: [
      {
        title: 'Ask her what she has noticed',
        content: 'Approve an improvement here and every future run uses it.',
        prompts: ['What have you learned about how I work?'],
        until: { event: 'chat.sent' },
      },
    ],
  },
});

/** The Dashboard offers the next unfinished milestone, whatever it is. */
export const JOURNEY_SCREEN = 'DashboardScreen';

/** Where a prompt chip takes the person: the main chat. */
export const PROMPT_ROUTE = toChat;
